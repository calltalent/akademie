"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAffiliatePartner } from "@/lib/affiliate/access";
import { writeAuditEntry } from "@/lib/affiliate/audit";
import {
  affiliateBillingProfileSchema,
  affiliatePartnerSelfSchema,
  affiliateTermsAcceptanceSchema,
} from "@/lib/affiliate/schema";
import type {
  AffiliateBillingProfileActionState,
  AffiliatePartnerSelfActionState,
  AffiliateTermsActionState,
} from "@/lib/affiliate/state";
import { getServerEnv } from "@/lib/env";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Affiliate-System, Block B7-A — die Server Actions des Partnerbereichs
 * (PLAN_Affiliate-System.md 8.2 Zeilen „/partner/stammdaten" und
 * „/partner/bedingungen", 3.3, 3.13, 11.3, 11.9, 11.11, 11.15; CLAUDE.md
 * §2.3/§2.9/§2.11/§2.15).
 *
 * FÜNF REGELN, DIE HIER FÜR JEDE FUNKTION GELTEN:
 *
 * 1. GATE ZUERST. Erste Zeile ist immer `requireAffiliatePartner()`. Es
 *    liefert `partnerId` aus `affiliate_partner_id(tenant)` — der
 *    Security-Definer-Funktion, die den Partner an `auth.uid()` UND an den
 *    Mandanten des Hosts bindet und nur für `status='active'` etwas liefert
 *    (G9). Das Gate prüft zugleich den Feature-Schalter, den RLS nicht kennt
 *    (9.8).
 *
 * 2. DIE PARTNER-ID KOMMT NIE AUS DEM FORMULAR. Sie stammt ausschließlich
 *    aus dem Gate. Ein `partnerId`-Feld im `FormData` gibt es in diesem
 *    Modul nicht und darf es nie geben — das ist die konkrete Form von
 *    CLAUDE.md §2.15 („nie ungeprüft `where id = :clientId`") an dieser
 *    Stelle. Jede Abfrage trägt zusätzlich `.eq("tenant_id", tenant.id)`.
 *
 * 3. SESSION-CLIENT, WO ER REICHT. Stammdaten und Abrechnungsprofil
 *    schreibt der Partner über seinen eigenen Client: die Policies
 *    (`affiliate_partners_update`, `affiliate_billing_self_*`) und der
 *    Guard-Trigger sind dabei aktiv und setzen alles zurück, was ihm nicht
 *    gehört (Status, Code, Gruppe, Werber, Auszahlungssperre, VIES-Ergebnis).
 *    Nur die Zustimmung läuft über `createAdminClient()` — siehe Punkt 4.
 *
 * 4. DEN ZUSTIMMUNGSNACHWEIS SCHREIBT DER SERVER, NIE DER NACHZUWEISENDE.
 *    `terms_version_accepted`, `terms_accepted_at` und
 *    `terms_accepted_ip_hash` sind seit der B9-Korrektur überhaupt nicht
 *    mehr im UPDATE-Spaltenrecht von `authenticated` (Migration
 *    20260910120000, Abschnitt 4). Ein Nachweis nach Art. 7 Abs. 1 DSGVO,
 *    den der Nachzuweisende selbst schreiben kann, ist keiner. Deshalb
 *    bestimmt diese Datei die Fassung serverseitig aus der Programmzeile und
 *    den Zeitpunkt aus `now()`; aus dem Formular kommt nur die Fassung, die
 *    dem Partner ANGEZEIGT wurde — und sie muss übereinstimmen, sonst hätte
 *    er einem anderen Text zugestimmt als dem gespeicherten.
 *
 * 5. KEINE SDK-MELDUNG AN DIE OBERFLÄCHE. `error.message` erreicht nie den
 *    Zustand (§2.11): dafür `translateDbError()` bzw. `genericErrorMessage()`.
 *    Protokolliert wird höchstens der SQLSTATE, nie die Nutzlast — eine
 *    PostgREST-Meldung trägt bei einer Constraint-Verletzung den
 *    verletzenden Wert im Klartext, hier also IBAN oder Steuernummer.
 *
 * `"use server"`-Dateien dürfen in Next.js 16 ausschließlich async Funktionen
 * exportieren: Zustandstypen liegen in `state.ts`, Schemata in `schema.ts`,
 * und von hier wird nichts re-exportiert (ein Typ-RE-Export bricht unter
 * Turbopack zur Laufzeit, siehe `state.ts`).
 */

const PARTNER_PATHS = ["/partner", "/partner/stammdaten", "/partner/bedingungen"] as const;

const PROGRAM_MISSING = "Für diese Akademie ist kein Partnerprogramm eingerichtet.";
/** WORTGLEICH mit `access.ts` und `actions.ts` (11.15: eine Meldung für „gibt es nicht" und „gehört jemand anderem"). */
const PARTNER_NOT_FOUND = "Der Partner wurde in dieser Akademie nicht gefunden.";
const TERMS_CHANGED =
  "Die Partnerbedingungen wurden inzwischen geändert. Bitte die Seite neu laden und die aktuelle Fassung lesen.";

/**
 * Die einzigen Meldungen, die aus einem `throw` heraus unverändert in die
 * Oberfläche dürfen — gleiche Bauart wie `actions.ts`. Alles andere fällt auf
 * `genericErrorMessage()`, damit kein SDK-Text mit Bestell-, Rechnungs- oder
 * Zahlungsdaten in der UI landet (§2.11).
 *
 * Die fünf Gate-Texte stehen hier, weil `requireAffiliatePartner()` sie wirft
 * und ein Partner sonst statt „Das Partnerprogramm ist für diese Akademie
 * nicht aktiviert." eine nichtssagende Sammelmeldung bekäme.
 */
const USER_FACING_MESSAGES: ReadonlySet<string> = new Set([
  "Kein Mandant zu diesem Host gefunden.",
  "Das Partnerprogramm ist für diese Akademie nicht aktiviert.",
  "Nicht angemeldet.",
  "Kein Zugriff — nur für freigeschaltete Partner.",
  "Der Vorgang konnte nicht protokolliert werden.",
  PROGRAM_MISSING,
  PARTNER_NOT_FOUND,
  TERMS_CHANGED,
]);

/** Kein `error.message`, nie (§2.11). */
function actionMessage(e: unknown): string {
  if (e instanceof Error && USER_FACING_MESSAGES.has(e.message)) return e.message;
  return genericErrorMessage(e);
}

/** Für einen Datenbankfehler: übersetzter SQLSTATE, nie die PostgREST-Meldung. */
function dbMessage(error: { code?: string | null; message?: string }): string {
  return translateDbError(error);
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Ungültige Eingabe.";
}

// --- Zustimmungsnachweis: IP-Hash mit STATISCHEM Salz -------------------

/**
 * Domänenpräfix. Derselbe `SUPABASE_SERVICE_ROLE_KEY` trägt in diesem Projekt
 * vier verschiedene Hashes (Klick-IP, Einwilligungsnachweis,
 * Kontaktformular-Token, dieser hier); das Präfix macht sie gegeneinander
 * unaustauschbar, sodass ein Hash aus einem Bereich in einem anderen nicht
 * als Nachweis durchgeht.
 */
const TERMS_IP_HASH_DOMAIN = "calltalent:affiliate-terms-ip";

/** „keine IP ermittelbar" — ein fester Marker statt eines Hashes über "". */
const NO_IP_MARKER = "no-ip";

let cachedTermsIpKey: CryptoKey | null = null;

/**
 * Das Salz ist STATISCH und ausdrücklich NICHT tagesrotierend wie das der
 * Klicktabelle (Plan 11.6): ein Nachweis, der nach 24 Stunden nicht mehr
 * überprüfbar ist, ist keiner. Dieselbe Entscheidung und dieselbe Bauart wie
 * in `src/lib/consent/actions.ts`.
 *
 * Web Crypto statt `node:crypto`: der Webpack-Fallback des Builds bricht
 * beim Bündeln von `node:crypto` hart ab (siehe Kopfkommentar von
 * `src/lib/affiliate/hash.ts`).
 */
async function termsIpHashKey(): Promise<CryptoKey> {
  if (cachedTermsIpKey) return cachedTermsIpKey;
  const secret = new TextEncoder().encode(
    `${TERMS_IP_HASH_DOMAIN}:${getServerEnv().SUPABASE_SERVICE_ROLE_KEY}`,
  );
  cachedTermsIpKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return cachedTermsIpKey;
}

/**
 * HMAC-SHA-256 der IP als Hex. Die IP selbst wird nirgends gespeichert und
 * erscheint auch im Auditprotokoll nur redigiert (`terms_accepted_ip_hash`
 * steht in `AFFILIATE_AUDIT_REDACTED_KEYS`).
 */
async function hashTermsIp(): Promise<string> {
  const h = await headers();
  const ip =
    h.get("cf-connecting-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    NO_IP_MARKER;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await termsIpHashKey(),
    new TextEncoder().encode(ip),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// --- Stammdaten (Name, Firma, Benachrichtigungen) -----------------------

/**
 * Selbstpflege des Partners. Genau die fünf Felder, die der Guard-Trigger
 * dem Partner offen lässt (3.3) — jedes weitere Feld hier wäre still
 * wirkungslos, weil der Trigger es auf `old` zurücksetzt, und genau diese
 * stille Wirkungslosigkeit ist die Art Fehler, die niemand bemerkt.
 *
 * Geschrieben wird über den SESSION-Client: so entscheiden Policy und Guard,
 * nicht diese Datei. `.eq("id", partnerId)` mit der ID aus dem Gate plus
 * `.eq("tenant_id", …)` ist die zweite Linie.
 */
export async function saveAffiliatePartnerSelf(
  _prev: AffiliatePartnerSelfActionState,
  formData: FormData,
): Promise<AffiliatePartnerSelfActionState> {
  try {
    const { tenant, user, partnerId, supabase } = await requireAffiliatePartner();

    const parsed = affiliatePartnerSelfSchema.safeParse({
      displayName: text(formData, "displayName"),
      company: text(formData, "company"),
      notifySale: formData.get("notifySale"),
      notifyReversal: formData.get("notifyReversal"),
      notifyPayout: formData.get("notifyPayout"),
    });
    if (!parsed.success) return { error: firstIssue(parsed.error) };

    const { error } = await supabase
      .from("affiliate_partners")
      .update({
        display_name: parsed.data.displayName,
        company: parsed.data.company,
        notify_sale: parsed.data.notifySale,
        notify_reversal: parsed.data.notifyReversal,
        notify_payout: parsed.data.notifyPayout,
      })
      .eq("tenant_id", tenant.id)
      .eq("id", partnerId);

    if (error) {
      console.error(
        `[affiliate/partner-actions] Stammdaten speichern fehlgeschlagen (Code ${error.code ?? "unbekannt"}).`,
      );
      return { error: dbMessage(error) };
    }

    // Der Name steht auf dem Auszahlungsbeleg und in der Partnerliste des
    // Händlers; eine Änderung gehört deshalb in den Prüfpfad. `display_name`
    // und `company` sind in `AFFILIATE_AUDIT_REDACTED_KEYS` — im Protokoll
    // steht also DASS, nicht WAS.
    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "partner",
      actorUserId: user.id,
      entity: "partner",
      entityId: partnerId,
      action: "partner.self_update",
      after: {
        display_name: parsed.data.displayName,
        company: parsed.data.company,
        notify_sale: parsed.data.notifySale,
        notify_reversal: parsed.data.notifyReversal,
        notify_payout: parsed.data.notifyPayout,
      },
    });

    for (const path of PARTNER_PATHS) revalidatePath(path);
    return { error: null, success: true };
  } catch (e) {
    return { error: actionMessage(e) };
  }
}

// --- Abrechnungsprofil (Anschrift, Steuerstatus, Zahlungsverbindung) ----

/**
 * Anschrift, Steuerstatus und Zahlungsverbindung — geschrieben
 * ausschließlich vom Partner selbst (3.13). Ein Händler, der die Bankdaten
 * seiner Partner ändern kann, ist der klassische Weg, Auszahlungen
 * umzuleiten, sobald ein Händler-Konto übernommen wurde; deshalb steht diese
 * Funktion hier und nicht in `actions.ts`.
 *
 * `upsert` statt `insert`/`update`: das Profil hat `partner_id` als
 * Primärschlüssel, es gibt also genau eine Zeile je Partner, und der Partner
 * legt sie beim ersten Speichern selbst an (Policy
 * `affiliate_billing_self_insert`). Der Guard nullt dabei jedes
 * VIES-Ergebnis — ein Partner kann sich weder `valid` setzen noch Reverse
 * Charge erzeugen.
 *
 * WAS HIER BEWUSST NICHT PASSIERT: die Werte werden nicht zurückgelesen und
 * nicht in den Zustand geschrieben. `iban`, `bic`, `account_holder`,
 * `paypal_email` und `tax_number` stehen nicht im SELECT-Spaltenrecht von
 * `authenticated` (Migration 20260910120000, Abschnitt 6) — eine Bestätigung
 * „gespeichert: DE89…" wäre der Weg, auf dem sie doch wieder in einer
 * Antwort landen.
 */
export async function saveAffiliateBillingProfile(
  _prev: AffiliateBillingProfileActionState,
  formData: FormData,
): Promise<AffiliateBillingProfileActionState> {
  try {
    const { tenant, user, partnerId, supabase } = await requireAffiliatePartner();

    const parsed = affiliateBillingProfileSchema.safeParse({
      entityKind: text(formData, "entityKind"),
      legalName: text(formData, "legalName"),
      street: text(formData, "street"),
      postalCode: text(formData, "postalCode"),
      city: text(formData, "city"),
      country: text(formData, "country"),
      smallBusiness: formData.get("smallBusiness"),
      vatId: text(formData, "vatId"),
      taxNumber: text(formData, "taxNumber"),
      payoutMethod: text(formData, "payoutMethod"),
      accountHolder: text(formData, "accountHolder"),
      iban: text(formData, "iban"),
      bic: text(formData, "bic"),
      paypalEmail: text(formData, "paypalEmail"),
    });
    if (!parsed.success) return { error: firstIssue(parsed.error) };

    const { error } = await supabase.from("affiliate_billing_profiles").upsert(
      {
        partner_id: partnerId,
        tenant_id: tenant.id,
        entity_kind: parsed.data.entityKind,
        legal_name: parsed.data.legalName,
        street: parsed.data.street,
        postal_code: parsed.data.postalCode,
        city: parsed.data.city,
        country: parsed.data.country,
        small_business: parsed.data.smallBusiness,
        vat_id: parsed.data.vatId,
        tax_number: parsed.data.taxNumber,
        payout_method: parsed.data.payoutMethod,
        account_holder: parsed.data.accountHolder,
        iban: parsed.data.iban,
        bic: parsed.data.bic,
        paypal_email: parsed.data.paypalEmail,
      },
      { onConflict: "partner_id" },
    );

    if (error) {
      // NUR der SQLSTATE. Die PostgREST-Meldung einer Constraint-Verletzung
      // enthält den verletzenden Wert — hier also IBAN oder Steuernummer
      // (§2.11).
      console.error(
        `[affiliate/partner-actions] Abrechnungsprofil speichern fehlgeschlagen (Code ${error.code ?? "unbekannt"}).`,
      );
      return { error: dbMessage(error) };
    }

    // Im Protokoll stehen nur die NAMEN der gesetzten Felder, keine Werte.
    // Die Redaktion in `audit.ts` würde IBAN und Steuernummer ohnehin
    // ersetzen; sie gar nicht erst zu übergeben ist die kürzere Kette.
    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "partner",
      actorUserId: user.id,
      entity: "profile",
      entityId: partnerId,
      action: "profile.self_update",
      after: {
        entity_kind: parsed.data.entityKind,
        country: parsed.data.country,
        small_business: parsed.data.smallBusiness,
        payout_method: parsed.data.payoutMethod,
        has_vat_id: parsed.data.vatId !== null,
        has_iban: parsed.data.iban !== null,
        has_paypal: parsed.data.paypalEmail !== null,
      },
    });

    for (const path of PARTNER_PATHS) revalidatePath(path);
    return { error: null, success: true };
  } catch (e) {
    return { error: actionMessage(e) };
  }
}

// --- Zustimmung zu den Partnerbedingungen -------------------------------

/**
 * Die Neuzustimmung (8.2: „bei erhöhter `terms_version` blockiert ein Dialog
 * alle anderen Partnerseiten bis zur Neuzustimmung").
 *
 * Drei Dinge macht diese Funktion anders als die beiden darüber, jedes aus
 * einem eigenen Grund:
 *
 *   - Sie liest die Programmzeile SERVERSEITIG und vergleicht die dort
 *     stehende `terms_version` mit der aus dem Formular. Stimmen sie nicht
 *     überein, hat der Händler den Text geändert, während das Formular offen
 *     war — dann wird nichts gespeichert, sondern neu geladen. Sonst stünde
 *     im Buch eine Zustimmung zu einer Fassung, die der Partner nie gesehen
 *     hat. Die Formularfassung ist damit eine Übereinstimmungsprüfung, kein
 *     Eingabewert (11.3/11.15).
 *   - Sie schreibt über `createAdminClient()`, weil die drei
 *     Zustimmungsspalten nicht im UPDATE-Recht von `authenticated` stehen
 *     (Regel 4 im Kopfkommentar). Das ist eine der in 11.10 einzeln
 *     aufgeführten Admin-Client-Verwendungen: Gate ist
 *     `requireAffiliatePartner()`, die geschriebene Zeile ist die eigene, und
 *     `.eq("tenant_id", …)` bindet den Mandanten, weil RLS hier nicht greift.
 *   - Sie ist EINSEITIG: gespeichert wird nur, wenn die neue Fassung neuer
 *     ist als die bereits akzeptierte. Eine Zustimmung zurückzudatieren
 *     entwertete den Nachweis; derselbe Riegel steht zusätzlich im
 *     Guard-Trigger.
 */
export async function acceptAffiliateTerms(
  _prev: AffiliateTermsActionState,
  formData: FormData,
): Promise<AffiliateTermsActionState> {
  try {
    const { tenant, user, partnerId } = await requireAffiliatePartner();

    const parsed = affiliateTermsAcceptanceSchema.safeParse({
      termsVersion: text(formData, "termsVersion"),
      acceptTerms: formData.get("acceptTerms"),
    });
    if (!parsed.success) return { error: firstIssue(parsed.error) };

    const admin = createAdminClient();

    const { data: program, error: programError } = await admin
      .from("affiliate_programs")
      .select("id, terms_version")
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    if (programError || program === null) {
      if (programError) {
        console.error(
          `[affiliate/partner-actions] Programm lesen fehlgeschlagen (Code ${programError.code ?? "unbekannt"}).`,
        );
      }
      return { error: PROGRAM_MISSING };
    }

    const currentVersion = Number(program.terms_version);
    if (currentVersion !== parsed.data.termsVersion) {
      return { error: TERMS_CHANGED };
    }

    const { data: partner, error: partnerError } = await admin
      .from("affiliate_partners")
      .select("id, terms_version_accepted")
      .eq("tenant_id", tenant.id)
      .eq("id", partnerId)
      .maybeSingle();

    if (partnerError || partner === null) {
      return { error: PARTNER_NOT_FOUND };
    }

    // Einseitig: nie auf eine ältere Fassung zurück.
    if ((partner.terms_version_accepted ?? 0) >= currentVersion) {
      for (const path of PARTNER_PATHS) revalidatePath(path);
      return { error: null, success: true };
    }

    const ipHash = await hashTermsIp();

    const { error } = await admin
      .from("affiliate_partners")
      .update({
        terms_version_accepted: currentVersion,
        terms_accepted_at: new Date().toISOString(),
        terms_accepted_ip_hash: ipHash,
      })
      .eq("tenant_id", tenant.id)
      .eq("id", partnerId);

    if (error) {
      console.error(
        `[affiliate/partner-actions] Zustimmung speichern fehlgeschlagen (Code ${error.code ?? "unbekannt"}).`,
      );
      return { error: dbMessage(error) };
    }

    // Der Hash geht NICHT ins Protokoll: er steht in
    // `AFFILIATE_AUDIT_REDACTED_KEYS` und würde ohnehin ersetzt. Was zählt,
    // ist die Fassung.
    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "partner",
      actorUserId: user.id,
      entity: "partner",
      entityId: partnerId,
      action: "partner.accept_terms",
      before: { terms_version_accepted: partner.terms_version_accepted },
      after: { terms_version_accepted: currentVersion },
    });

    for (const path of PARTNER_PATHS) revalidatePath(path);
    return { error: null, success: true };
  } catch (e) {
    return { error: actionMessage(e) };
  }
}
