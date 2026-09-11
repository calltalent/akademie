import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAffiliateEnabled } from "@/lib/affiliate/access";
import { writeAuditEntry } from "@/lib/affiliate/audit";
import { AFFILIATE_COOKIE_NAME } from "@/lib/affiliate/cookie";
import { affiliateReferralTokenSchema } from "@/lib/affiliate/schema";
import {
  resolveAttribution,
  type AffiliateAttributionPartner,
  type AffiliateAttributionProgram,
  type AffiliateBindingCandidate,
  type AffiliateReferralCandidate,
} from "@/lib/affiliate/attribution";
import type { PublicTenant } from "@/lib/tenant/types";

/**
 * Affiliate-System, Block B3 — die Momentaufnahme der Zuordnung für die
 * Stripe-Checkout-Session (PLAN_Affiliate-System.md 4.3, 4.4, 4.7, 9.1, 9.2).
 *
 * ## Warum es diese Datei gibt
 *
 * `resolveAttribution()` (attribution.ts) ist rein: sie entscheidet über
 * bereits geladene Kandidaten. Hier steht die andere Hälfte — das Laden. Die
 * Trennung ist Absicht (siehe Kopfkommentar dort): die Regelkette bleibt ohne
 * Datenbank prüfbar, und diese Datei enthält keine einzige Regel, nur
 * Abfragen.
 *
 * ## Warum EINMAL beim Erzeugen der Session und nicht im Webhook
 *
 * Plan 4.4, erster Satz. Beim Erzeugen der Session ist der Käufer angemeldet
 * (`stripe/checkout.ts:88-94`), Cookie und `?aff=` liegen vor, das Programm
 * ist im aktuellen Stand lesbar. Im Webhook ist nichts davon mehr da: Stripe
 * ruft aus einem fremden Kontext ohne Cookies auf, und zwischen Kauf und
 * Zustellung können Tage liegen (Retry). Das Ergebnis wandert deshalb als
 * Momentaufnahme in die Session-Metadata; eine Entscheidung, die zweimal an
 * verschiedenen Orten fällt, fällt irgendwann verschieden aus.
 *
 * ## Was in die Metadata geht — und was nicht
 *
 * Genau ein Schlüssel: `affiliate_ref_token` (Plan 9.1/9.2). Das ist der
 * Token der tragenden Referral-Zeile, und `affiliate_events.referral_token`
 * (3.10) ist das Feld, in dem B4 ihn wiederfindet. Keine Partner-ID, kein
 * Satz, kein Betrag: alles andere wird beim Buchen aus der Zeile gelesen, die
 * zu diesem Token gehört, und ein zweiter Träger derselben Aussage wäre die
 * zweite Wahrheit, die es hier nicht geben darf.
 *
 * BEFUND FÜR B4 (nicht hier behebbar, gehört in den Buchungsblock): eine
 * Zuordnung aus R3 (Gutscheincode), R4 oder R8 (Lifetime-Bindung) hat gar
 * keine Referral-Zeile und damit keinen Token — `resolveAttribution()` gibt
 * `token: null` zurück. Diese Fälle erzeugen hier also KEINE Metadata,
 * obwohl ein Partner gewonnen hat. Das ist keine Nachlässigkeit dieser Datei,
 * sondern die Form, die der Plan für Metadata und Outbox vorgibt: dort ist
 * ausschließlich `referral_token` vorgesehen. Der Verarbeiter in B4 muss die
 * Bindung deshalb selbst nachschlagen (`affiliate_customer_bindings` über
 * `orders.user_id`), sonst fällt die Lifetime-Zusage beim Buchen still unter
 * den Tisch. R3 spielt heute ohnehin keine Rolle: der Gutscheincode wird erst
 * auf der gehosteten Stripe-Seite eingelöst, also NACH diesem Aufruf — auch
 * das ist ein Fall für den Webhook, nicht für diese Datei.
 *
 * ## Warum `createAdminClient()`
 *
 * `affiliate_referrals` und `affiliate_customer_bindings` geben
 * `authenticated` nichts heraus, was ein Käufer sehen dürfte (Migration
 * 20260911120000: SELECT nur für Manager, `token` nicht einmal für die),
 * und `affiliate_partners.applicant_email` steht bewusst nicht im
 * SELECT-Spaltenrecht (`AFFILIATE_PARTNER_CLIENT_COLUMNS`, types.ts) — ohne
 * sie fiele die halbe Selbst-Empfehlungssperre aus. Die Autorisierung
 * passiert deshalb im Code und VOR jeder Abfrage (CLAUDE.md §2.10): der
 * Mandant kommt aus `getTenant()` an der Aufrufstelle, der Nutzer aus der
 * geprüften Session, und JEDE Abfrage hier filtert zusätzlich auf
 * `tenant_id`. `resolveAttribution()` prüft die Mandantenbindung danach ein
 * zweites Mal (CLAUDE.md §2.15).
 *
 * Jede Abfrage nennt ihre Spalten. Das ist im Affiliate-Modul keine
 * Stilfrage: auf `affiliate_partners` liegt ein SPALTEN-Grant, ein
 * `select("*")` bricht dort mit 42501 ab, sobald es je über einen
 * Session-Client läuft.
 */

// --- Grenzen und Konstanten ---------------------------------------------

/**
 * Stripes harte Grenzen für `metadata` (Stripe-API: höchstens 50 Schlüssel,
 * je Wert höchstens 500 Zeichen; Schlüssel höchstens 40 Zeichen). Sie stehen
 * hier als Zahlen, weil die Prüfung unten sonst eine unbelegte Behauptung
 * wäre.
 *
 * Rechnung für den Direktkauf: `stripe/checkout.ts` setzt drei Schlüssel
 * (`tenant_id`, `product_id`, `user_id`), dieser Beitrag ist der vierte —
 * 4 von 50. Der Wert ist ein Token aus 64 Hex-Zeichen, also 64 von 500, und
 * der Schlüsselname hat 19 von 40 Zeichen. Es gibt damit keinen Weg, über
 * diesen Beitrag an eine Grenze zu stoßen; geprüft wird trotzdem, weil ein
 * überschrittenes Limit den gesamten `sessions.create()`-Aufruf mit einem
 * Stripe-Fehler beendet — der Kauf fiele aus, und zwar wegen einer
 * Provisionsangabe. Diese Reihenfolge der Übel ist nicht verhandelbar: im
 * Zweifel lieber keine Zuordnung als kein Kauf.
 */
const STRIPE_METADATA_MAX_VALUE_LENGTH = 500;

/** Der einzige Schlüssel, den dieses Modul zur Metadata beisteuert (Plan 9.2). */
export const AFFILIATE_CHECKOUT_METADATA_KEY = "affiliate_ref_token";

/**
 * Obergrenze für R7 (Serverzustand, alle Referral-Zeilen des Käufers). Ohne
 * Grenze wäre das eine unbegrenzte Abfrage: jeder Klick auf einen
 * Partnerlink erzeugt eine Zeile, und die Zeilen eines Vielklickers sammeln
 * sich über die gesamte Cookie-Laufzeit (bis 365 Tage).
 *
 * Die Grenze allein wäre gefährlich — sie könnte das falsche Ende
 * abschneiden. Deshalb wird die Reihenfolge der Abfrage nach
 * `program.attribution_model` gedreht (siehe `loadUserReferrals()`): bei
 * `last` die jüngsten zuerst, bei `first` die ältesten. Das Ende, auf das es
 * für das Modell ankommt, ist damit immer im Ergebnis; sortiert wird
 * anschließend ohnehin `resolveAttribution()` selbst.
 */
const USER_REFERRAL_LIMIT = 200;

// --- Spaltenlisten (nie `select("*")`) ----------------------------------

const PROGRAM_COLUMNS =
  "id, tenant_id, status, attribution_model, lifetime_binding, self_referral, test_mode";
const REFERRAL_COLUMNS =
  "id, tenant_id, program_id, partner_id, click_id, token, campaign, user_id, status, expires_at, created_at";
const PARTNER_COLUMNS = "id, tenant_id, program_id, user_id, applicant_email, status";
const BINDING_COLUMNS = "tenant_id, program_id, user_id, partner_id, source";
const CLICK_COLUMNS = "id, is_bot";

// --- Formen der geladenen Zeilen ----------------------------------------

type ProgramRow = AffiliateAttributionProgram;

/** Die Referral-Zeile, wie sie aus der Tabelle kommt — ohne Partner, ohne `is_bot`. */
type ReferralRow = Omit<AffiliateReferralCandidate, "partner" | "is_bot"> & {
  click_id: string | null;
};

type PartnerRow = AffiliateAttributionPartner;

type BindingRow = Omit<AffiliateBindingCandidate, "partner">;

export type AffiliateCheckoutMetadata = { affiliate_ref_token?: string };

/** Das leere Ergebnis. Eigene Konstante, damit jeder Rückweg gleich aussieht. */
const NO_METADATA: AffiliateCheckoutMetadata = {};

// --- Träger lesen -------------------------------------------------------

/**
 * Der Token aus dem `ct_aff`-Cookie, geprüft (CLAUDE.md §2.3). Exportiert,
 * weil ihn drei Aufrufer brauchen und keiner den Cookie-Namen ein zweites Mal
 * hinschreiben soll: diese Datei selbst (R6), die Kaufseite und die
 * Anmeldung/Registrierung (`bindReferral()`, Plan 4.3). Der Name kommt aus
 * `cookie.ts` und damit letztlich aus `TRACKING_COOKIES_ON_CONSENT`
 * (consent/schema.ts) — der einen Stelle, an der ein Träger eingetragen wird.
 *
 * Das Cookie existiert nur mit erteilter Einwilligung (Plan 4.2 Schritt 8);
 * ohne sie gibt es hier schlicht nichts zu lesen, und die Zuordnung läuft
 * über `?aff=` und den Serverzustand weiter. Es wird hier NICHT gesetzt und
 * nicht gelöscht: in einer Server Component ist `cookies()` nur lesbar, und
 * das Setzen gehört ausschließlich dem Klick-Endpunkt.
 */
export async function readAffiliateCookieToken(): Promise<string | null> {
  try {
    const store = await cookies();
    return parseReferralToken(store.get(AFFILIATE_COOKIE_NAME)?.value);
  } catch {
    // `cookies()` wirft außerhalb eines Anfrage-Kontexts (z. B. beim
    // statischen Vorrendern). Kein Cookie ist hier kein Fehler, sondern der
    // Normalfall ohne Einwilligung.
    return null;
  }
}

/**
 * Ein Token aus fremder Hand (Query-Parameter, Cookie) auf das vereinbarte
 * Muster prüfen. `unknown` als Eingabe, weil `searchParams` bei doppeltem
 * Parameter (`?aff=a&aff=b`) ein Array liefert — zod lehnt das ab, und genau
 * das ist gewollt: welcher der beiden Werte „gemeint" war, ist nicht
 * entscheidbar, und raten heißt hier, die Provision zu raten.
 */
export function parseReferralToken(raw: unknown): string | null {
  const parsed = affiliateReferralTokenSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// --- Laden --------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Das Programm des Mandanten. `affiliate_programs` hat `unique (tenant_id)`
 * (Migration 20260910120000): genau eines je Mandant, deshalb
 * `maybeSingle()` ohne weitere Auswahl.
 */
async function loadProgram(admin: Admin, tenantId: string): Promise<ProgramRow | null> {
  const { data, error } = await admin
    .from("affiliate_programs")
    .select(PROGRAM_COLUMNS)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("[affiliate-checkout-meta] Programm nicht gelesen", { code: error.code });
    return null;
  }
  return (data as ProgramRow | null) ?? null;
}

/**
 * Die Referral-Zeilen zu den mitgebrachten Trägern (R5 `?aff=`, R6 Cookie).
 *
 * Bewusst OHNE Filter auf `status` und `expires_at`: die Prüfliste steht
 * vollständig in `isFreshTokenUsable()` (attribution.ts, wörtlich nach Plan
 * 4.4 R5). Zwei Prüfungen an zwei Orten wären zwei Gelegenheiten, sie
 * verschieden zu ändern. Was diese Abfrage sicherstellen muss, ist der
 * Mandant — und das tut sie.
 *
 * `.in()` mit einer Liste geprüfter Token: der Query-Builder parametrisiert,
 * es wird nichts zusammengesetzt (CLAUDE.md §2.12). Ein `.or()` über zwei
 * Token wäre genau die verbotene Zeichenkettenbastelei gewesen.
 */
async function loadReferralsByToken(
  admin: Admin,
  tenantId: string,
  tokens: readonly string[],
): Promise<ReferralRow[]> {
  if (tokens.length === 0) return [];

  const { data, error } = await admin
    .from("affiliate_referrals")
    .select(REFERRAL_COLUMNS)
    .eq("tenant_id", tenantId)
    .in("token", tokens);

  if (error) {
    // Nie das Token selbst ins Log (CLAUDE.md §2.11): wer es kennt, hängt
    // fremde Bestellungen an diesen Partner.
    console.error("[affiliate-checkout-meta] Zuordnung zum Token nicht gelesen", {
      code: error.code,
    });
    return [];
  }
  return (data as ReferralRow[] | null) ?? [];
}

/**
 * R7: die am Konto hängenden Zeilen (`bindReferral()`, 4.3). Gefiltert wird
 * hier, weil der Plan die Kandidatenmenge für R7 wörtlich so beschreibt:
 * `user_id = Käufer`, `expires_at > now()`, `status <> 'revoked'`.
 * `superseded` bleibt ausdrücklich drin — beim First-Click-Modell ist genau
 * die abgelöste Zeile die richtige Antwort.
 *
 * Zur Sortierrichtung siehe `USER_REFERRAL_LIMIT`.
 */
async function loadUserReferrals(
  admin: Admin,
  tenantId: string,
  program: ProgramRow,
  userId: string,
  nowIso: string,
): Promise<ReferralRow[]> {
  const { data, error } = await admin
    .from("affiliate_referrals")
    .select(REFERRAL_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("program_id", program.id)
    .eq("user_id", userId)
    .neq("status", "revoked")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: program.attribution_model === "first" })
    .limit(USER_REFERRAL_LIMIT);

  if (error) {
    console.error("[affiliate-checkout-meta] Serverzustand nicht gelesen", { code: error.code });
    return [];
  }
  return (data as ReferralRow[] | null) ?? [];
}

/** R4/R8: die Lifetime-Bindung des Käufers in diesem Programm (3.8). */
async function loadBinding(
  admin: Admin,
  tenantId: string,
  programId: string,
  userId: string,
): Promise<BindingRow | null> {
  const { data, error } = await admin
    .from("affiliate_customer_bindings")
    .select(BINDING_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("program_id", programId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[affiliate-checkout-meta] Lifetime-Bindung nicht gelesen", { code: error.code });
    return null;
  }
  return (data as BindingRow | null) ?? null;
}

/**
 * Die Partner der Kandidaten, in EINER Abfrage. `applicant_email` ist dabei
 * die eine Spalte, die es wirklich braucht und die ein Session-Client nicht
 * bekäme (siehe Kopfkommentar) — sie verlässt diese Datei nicht, sie geht nur
 * in den E-Mail-Abgleich der Selbst-Empfehlungssperre (4.4).
 */
async function loadPartners(
  admin: Admin,
  tenantId: string,
  partnerIds: readonly string[],
): Promise<Map<string, PartnerRow>> {
  const map = new Map<string, PartnerRow>();
  if (partnerIds.length === 0) return map;

  const { data, error } = await admin
    .from("affiliate_partners")
    .select(PARTNER_COLUMNS)
    .eq("tenant_id", tenantId)
    .in("id", partnerIds);

  if (error) {
    console.error("[affiliate-checkout-meta] Partner nicht gelesen", { code: error.code });
    return map;
  }

  for (const row of (data as PartnerRow[] | null) ?? []) {
    map.set(row.id, row);
  }
  return map;
}

/**
 * `is_bot` der auslösenden Klickzeilen (4.4 R5). Eigene Abfrage statt einer
 * eingebetteten Ressource: der Fremdschlüssel `affiliate_referrals.click_id`
 * ist zusammengesetzt (`(click_id, tenant_id)`), und eine PostgREST-Einbettung
 * darüber braucht einen Beziehungs-Hinweis, der bei jeder Schema-Änderung
 * still kippen kann. Zwei klare Abfragen sind hier mehr wert als eine
 * clevere.
 *
 * Fehlt die Klickzeile (nach 90 Tagen gelöscht, 3.6) oder die Abfrage
 * scheitert, bleibt der Wert `null` — und `null` ist ausdrücklich KEIN
 * Ausschlussgrund (siehe `AffiliateReferralCandidate.is_bot`): eine noch
 * lebende Zuordnung darf nicht allein durch den Ablauf der
 * Aufbewahrungsfrist verfallen.
 */
async function loadClickBotFlags(
  admin: Admin,
  tenantId: string,
  clickIds: readonly string[],
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (clickIds.length === 0) return map;

  const { data, error } = await admin
    .from("affiliate_clicks")
    .select(CLICK_COLUMNS)
    .eq("tenant_id", tenantId)
    .in("id", clickIds);

  if (error) {
    console.error("[affiliate-checkout-meta] Klickzeilen nicht gelesen", { code: error.code });
    return map;
  }

  for (const row of (data as { id: string; is_bot: boolean }[] | null) ?? []) {
    map.set(row.id, row.is_bot);
  }
  return map;
}

/** Setzt Partner und `is_bot` an eine geladene Zeile (Form für attribution.ts). */
function toCandidate(
  row: ReferralRow,
  partners: Map<string, PartnerRow>,
  botFlags: Map<string, boolean>,
): AffiliateReferralCandidate {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    program_id: row.program_id,
    partner_id: row.partner_id,
    token: row.token,
    campaign: row.campaign,
    user_id: row.user_id,
    status: row.status,
    expires_at: row.expires_at,
    created_at: row.created_at,
    is_bot: row.click_id === null ? null : (botFlags.get(row.click_id) ?? null),
    partner: partners.get(row.partner_id) ?? null,
  };
}

// --- Der Beitrag zur Metadata -------------------------------------------

/**
 * Baut die Momentaufnahme für `stripe.checkout.sessions.create({ metadata })`
 * (Plan 9.1). Liefert `{}`, wenn es nichts zuzuordnen gibt — und `{}` ist ein
 * gültiges Ergebnis, kein Fehlerfall: der Hausverkauf ist der Normalfall
 * jedes Mandanten ohne Partnerprogramm.
 *
 * WIRFT NIE. Der gesamte Rumpf liegt in einem `try/catch` mit Rückgabe `{}`
 * (Plan 9.1 wörtlich). Ein Affiliate-Fehler darf keinen Kauf verhindern: die
 * Zuordnung kostet im schlimmsten Fall eine Provision, ein abgebrochener
 * Checkout kostet den Umsatz und den Kunden.
 *
 * Reihenfolge der Prüfungen nach Kosten: der Feature-Schalter kostet keine
 * Abfrage, das Programm eine. Erst wenn beide stehen, werden die Kandidaten
 * geladen. Für einen Mandanten ohne Partnerprogramm — das ist heute jeder —
 * bleibt der Kaufweg damit exakt so schnell wie vorher.
 *
 * `productId` geht nicht in die Entscheidung ein (4.4 kennt keine
 * produktabhängige Regel), sondern ausschließlich in den Protokolleintrag:
 * ein gesperrter Selbstkauf ohne Angabe, worum es ging, ist im Streitfall
 * wertlos.
 */
export async function affiliateCheckoutMetadata(
  tenant: PublicTenant,
  user: { id: string; email?: string | null },
  productId: string,
  /**
   * Der Token aus `?aff=` der Kaufseite (4.3). Vierter Parameter statt der
   * drei aus Plan 9.1: der Träger kommt aus der URL und ist an dieser Stelle
   * nicht mehr aus einem Cookie oder Header rekonstruierbar — die Kaufseite
   * reicht ihn über `BuyButton` und die Server Action durch. Ungeprüft aus
   * Client-Hand, deshalb `unknown` und zod.
   */
  urlToken?: unknown,
): Promise<AffiliateCheckoutMetadata> {
  try {
    // R0, erster Teil: Modul aus -> keine Abfrage, keine Metadata.
    if (!isAffiliateEnabled(tenant)) return NO_METADATA;

    const admin = createAdminClient();

    // R0, zweiter Teil: kein oder kein aktives Programm.
    const program = await loadProgram(admin, tenant.id);
    if (!program || program.status !== "active" || program.tenant_id !== tenant.id) {
      return NO_METADATA;
    }

    const urlReferralToken = parseReferralToken(urlToken);
    const cookieReferralToken = await readAffiliateCookieToken();

    // Beide Träger können denselben Token tragen (der Klick-Endpunkt setzt
    // das Cookie und hängt `?aff=` an) — dann ist es EIN Wert für die
    // Abfrage, aber weiterhin zwei Kandidaten für die Regelkette.
    const tokens = [...new Set([urlReferralToken, cookieReferralToken].filter(
      (value): value is string => value !== null,
    ))];

    const now = new Date();
    const [tokenRows, userRows, binding] = await Promise.all([
      loadReferralsByToken(admin, tenant.id, tokens),
      loadUserReferrals(admin, tenant.id, program, user.id, now.toISOString()),
      loadBinding(admin, tenant.id, program.id, user.id),
    ]);

    // Partner und Klick-Merkmale für ALLE Kandidaten in je einer Abfrage.
    const allRows = [...tokenRows, ...userRows];
    const partnerIds = [
      ...new Set([...allRows.map((row) => row.partner_id), ...(binding ? [binding.partner_id] : [])]),
    ];
    const clickIds = [
      ...new Set(allRows.map((row) => row.click_id).filter((id): id is string => id !== null)),
    ];

    const [partners, botFlags] = await Promise.all([
      loadPartners(admin, tenant.id, partnerIds),
      loadClickBotFlags(admin, tenant.id, clickIds),
    ]);

    const byToken = new Map<string, AffiliateReferralCandidate>();
    for (const row of tokenRows) {
      byToken.set(row.token, toCandidate(row, partners, botFlags));
    }

    const result = resolveAttribution({
      tenantId: tenant.id,
      featureEnabled: true,
      program,
      buyer: { userId: user.id, email: user.email ?? null },
      at: now,
      // R3 ist beim Erzeugen der Session strukturell nicht entscheidbar: der
      // Gutscheincode wird erst auf der gehosteten Stripe-Seite eingelöst.
      // Bewusst `null` statt eines Rateversuchs.
      couponPartner: null,
      urlReferral: urlReferralToken ? (byToken.get(urlReferralToken) ?? null) : null,
      cookieReferral: cookieReferralToken ? (byToken.get(cookieReferralToken) ?? null) : null,
      userReferrals: userRows.map((row) => toCandidate(row, partners, botFlags)),
      binding: binding
        ? { ...binding, partner: partners.get(binding.partner_id) ?? null }
        : null,
    });

    await writeAttributionAudit(result.auditActions, {
      tenantId: tenant.id,
      userId: user.id,
      productId,
      referralId: result.referralId,
      partnerId: result.partnerId,
      rule: result.meta.rule,
      reason: result.meta.reason,
    });

    // Ohne tragende Referral-Zeile gibt es keinen Token und damit keinen
    // Metadata-Beitrag (siehe BEFUND FÜR B4 im Kopfkommentar).
    const token = parseReferralToken(result.token);
    if (token === null) return NO_METADATA;

    // Stripe-Grenze. Sie kann mit einem 64-Zeichen-Token nicht greifen; wenn
    // sie es doch tut, ist etwas anderes kaputt, und dann ist der stille
    // Verzicht auf die Zuordnung die richtige Richtung (siehe Kommentar bei
    // `STRIPE_METADATA_MAX_VALUE_LENGTH`).
    if (token.length > STRIPE_METADATA_MAX_VALUE_LENGTH) {
      console.error("[affiliate-checkout-meta] Token überschreitet die Stripe-Metadata-Grenze", {
        length: token.length,
      });
      return NO_METADATA;
    }

    return { [AFFILIATE_CHECKOUT_METADATA_KEY]: token };
  } catch (e) {
    // Nur die Meldung, keine Werte, kein Token (CLAUDE.md §2.11).
    console.error("[affiliate-checkout-meta] Zuordnung nicht ermittelt", {
      tenantId: tenant.id,
      error: e instanceof Error ? e.message : "Unbekannter Fehler",
    });
    return NO_METADATA;
  }
}

/**
 * Schreibt die von `resolveAttribution()` gemeldeten Vorgänge ins
 * Prüfprotokoll (R1 gesperrter Selbstkauf, R2 markierter Selbstkauf,
 * Abweichung von einer Lifetime-Bindung).
 *
 * ABWEICHUNG von der Regel in `audit.ts` („erst die Änderung, dann der
 * Eintrag, beides im selben try"), ausdrücklich begründet, weil die dortige
 * Regel genau das verlangt: hier gibt es keine Änderung, die
 * zurückzunehmen wäre — die Entscheidung ist eine Momentaufnahme, und der
 * einzige „Vorgang" ist ein Kauf, den ein fehlgeschlagener Protokolleintrag
 * nicht abbrechen darf. Ein `throw` aus `writeAuditEntry()` liefe hier in
 * den äußeren `catch` und würde die Zuordnung des Partners kosten, obwohl
 * die Entscheidung bereits korrekt gefallen ist. Protokolliert wird der
 * Fehlschlag deshalb im Log — sichtbar, aber ohne Folgen für den Kauf.
 *
 * `actor_kind = 'system'`: es drückt niemand einen Knopf, die Regelkette
 * entscheidet. `actor_user_id` trägt trotzdem den Käufer (abweichend vom
 * Hinweis „null bei system" in audit.ts, der Cron und Outbox meint) — ein
 * gesperrter Selbstkauf ohne die Person, die gekauft hat, ist kein Beleg.
 *
 * Bekannte und hingenommene Eigenschaft: wer den Kaufknopf dreimal drückt,
 * erzeugt drei Einträge. Eine Entdopplung bräuchte einen Schlüssel, den es
 * vor der Bestellung noch gar nicht gibt; drei ehrliche Zeilen sind besser
 * als eine geratene.
 *
 * BEKANNTE GRENZE, hier nicht behebbar: bei R1 (Selbstkauf gesperrt) gibt
 * `resolveAttribution()` weder `referralId` noch `partnerId` zurück — die
 * Entscheidung lautet ja „kein Partner". Der Eintrag trägt dann nur Regel,
 * Grund, Produkt und den Käufer. Für die Rekonstruktion reicht das (der
 * Käufer IST in diesem Fall der Partner); wer mehr braucht, müsste
 * `AffiliateAttributionResult` um den geblockten Kandidaten erweitern, und
 * das ist eine Änderung an attribution.ts, nicht an der Aufrufstelle.
 */
async function writeAttributionAudit(
  actions: readonly string[],
  context: {
    tenantId: string;
    userId: string;
    productId: string;
    referralId: string | null;
    partnerId: string | null;
    rule: string;
    reason: string | null;
  },
): Promise<void> {
  for (const action of actions) {
    try {
      await writeAuditEntry({
        tenantId: context.tenantId,
        actorKind: "system",
        actorUserId: context.userId,
        entity: "referral",
        // Der Gegenstand ist die Zuordnung; der Partner steht in der Nutzlast.
        entityId: context.referralId,
        action,
        after: {
          rule: context.rule,
          reason: context.reason,
          product_id: context.productId,
          partner_id: context.partnerId,
        },
      });
    } catch {
      // Siehe Kopfkommentar dieser Funktion. `writeAuditEntry()` hat den
      // SQLSTATE bereits protokolliert; hier bleibt nur der Hinweis, WELCHER
      // Vorgang nicht festgehalten wurde.
      console.error("[affiliate-checkout-meta] Prüfprotokoll nicht geschrieben", { action });
    }
  }
}
