import type {
  AffiliateAttributionModel,
  AffiliatePartnerStatus,
  AffiliateProgramRow,
} from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B3 — die Attributionsentscheidung
 * (PLAN_Affiliate-System.md 4.1, 4.3, 4.4, 4.5, 4.7, 3.7, 3.8).
 *
 * Hier wird entschieden, wer die Provision bekommt. Die Datei ist deshalb
 * REIN: sie bekommt bereits geladene Kandidaten und gibt eine Entscheidung
 * zurück. Kein Supabase, kein `next/headers`, kein `Date.now()` — der
 * Zeitpunkt wird hereingereicht wie im Rechenkern (`compute.ts`).
 *
 * Warum das Laden ausdrücklich NICHT hierher gehört: eine Regelkette, die nur
 * mit Datenbank prüfbar ist, wird in der Praxis nicht geprüft. Ein
 * Attributionsstreit („mein Link hat den Kunden gebracht, nicht seiner") ist
 * kein seltener Grenzfall, sondern der Alltag jedes Partnerprogramms, und er
 * ist nur entscheidbar, wenn die Regel als ausführbarer, für jeden Fall
 * getesteter Text existiert. `attribution.test.ts` fährt deshalb jede der
 * zehn Regeln einzeln durch — ohne einen einzigen Mock.
 *
 * Der zweite Grund für die Reinheit steht in 4.4: ausgewertet wird EINMAL
 * beim Erzeugen der Checkout-Session, nicht im Webhook. Das Ergebnis wandert
 * als Momentaufnahme (`affiliate_ref_token` bzw. Partner-ID) in die
 * Session-Metadata. Eine Entscheidung, die zweimal an verschiedenen Orten
 * fällt, fällt irgendwann verschieden aus.
 *
 * `meta.reason` ist Pflichtbestandteil des Ergebnisses und keine Zierde: die
 * Buchungszeile trägt sie weiter, und ohne sie ist im Streitfall nicht mehr
 * feststellbar, OB der Gutscheincode, das Cookie oder die Lifetime-Bindung
 * gewonnen hat — drei Träger, die im Ergebnis identisch aussehen.
 *
 * Marketplace (4.7): diese Funktion wird auf dem Marketplace-Host gar nicht
 * erst aufgerufen. Er löst keinen Mandanten auf, das host-only Cookie reist
 * nicht mit, und `src/lib/marketplace/checkout.ts` bekommt bewusst keinen
 * Metadata-Zusatz — er wäre toter Code, und die naheliegende „Reparatur" über
 * ein `domain`-Attribut wäre eine mandantenübergreifende Zuordnung.
 */

// --- Aufzählungen -------------------------------------------------------

/**
 * Die zehn Regeln aus 4.4 in ihrer Rangfolge. Sie stehen als Werte im
 * Ergebnis, damit ein Test (und später die Admin-Ansicht einer strittigen
 * Zeile) benennen kann, WELCHE Regel entschieden hat — „kein Partner" aus R0
 * (Modul aus), R1 (Selbst-Empfehlung gesperrt) und R9 (Hausverkauf) sind drei
 * verschiedene Sachverhalte mit demselben Geldbetrag.
 */
export const AFFILIATE_ATTRIBUTION_RULES = [
  "R0",
  "R1",
  "R2",
  "R3",
  "R4",
  "R5",
  "R6",
  "R7",
  "R8",
  "R9",
] as const;
export type AffiliateAttributionRule = (typeof AFFILIATE_ATTRIBUTION_RULES)[number];

/**
 * `meta.reason` wörtlich aus der Tabelle in 4.4. R0 und R9 haben dort
 * ausdrücklich keinen Grund („—") — das ist hier `null` und kein leerer
 * String, damit der Unterschied „keine Zuordnung" zu „Zuordnung ohne
 * angegebenen Grund" nicht durch einen Tippfehler verschwindet.
 */
export const AFFILIATE_ATTRIBUTION_REASONS = [
  "self_referral",
  "self_referral_flagged",
  "coupon",
  "lifetime",
  "url_token",
  "cookie_token",
  "server_state",
  "lifetime_fallback",
] as const;
export type AffiliateAttributionReason = (typeof AFFILIATE_ATTRIBUTION_REASONS)[number];

/**
 * Die Vorgänge, die der Aufrufer nach der Entscheidung ins Prüfprotokoll
 * schreibt (`writeAuditEntry`, entity `"referral"`). Sie stehen als
 * Konstanten hier, weil die Entscheidung darüber HIER fällt und nicht an der
 * Aufrufstelle — dort wäre sie eine zweite, stillschweigend abweichende
 * Regel. Schreibweise nach `AFFILIATE_AUDIT_ACTION_PATTERN` (audit.ts).
 *
 * `overridden_by_click` ist der vom Plan (4.4, letzter Absatz der
 * Rangfolge-Begründung) wörtlich vorgegebene Name für JEDE Abweichung von
 * einer bestehenden Lifetime-Bindung. Er wird deshalb auch dann benutzt, wenn
 * die Abweichung ausnahmsweise nicht von einem Klick kommt, sondern von einem
 * Gutscheincode (R3) — ein zweiter Name wäre genauer, aber der Plan legt
 * diesen fest, und ein Prüfprotokoll mit zwei Namen für denselben Vorgang ist
 * schlechter durchsuchbar als eines mit einem leicht unscharfen.
 */
export const AFFILIATE_ATTRIBUTION_AUDIT_ACTIONS = {
  selfReferralBlocked: "referral.self_referral_blocked",
  selfReferralFlagged: "referral.self_referral_flagged",
  overriddenByClick: "referral.overridden_by_click",
} as const;

// --- Eingabeformen ------------------------------------------------------

/**
 * Die Programmfelder, die die Entscheidung braucht. Ein `Pick` auf
 * `AffiliateProgramRow` statt eines eigenen Typs: so kann der Aufrufer die
 * geladene Zeile direkt durchreichen, und ein umbenanntes Feld bricht den
 * Compiler statt still eine Regel zu entwerten.
 */
export type AffiliateAttributionProgram = Pick<
  AffiliateProgramRow,
  "id" | "tenant_id" | "status" | "attribution_model" | "lifetime_binding" | "self_referral" | "test_mode"
>;

/**
 * Der Partner eines Kandidaten, so schmal wie die Entscheidung ihn braucht.
 *
 * `applicant_email` ist NULLBAR, obwohl die Spalte es nicht ist: das
 * SELECT-Spaltenrecht auf `affiliate_partners` gibt sie `authenticated` nicht
 * heraus (sie fehlt in `AFFILIATE_PARTNER_CLIENT_COLUMNS`, types.ts). Wer den
 * Abgleich über die E-Mail braucht — und das ist die halbe
 * Selbst-Empfehlungssperre —, muss die Spalte über `createAdminClient()` mit
 * ausdrücklicher Spaltenliste nachladen. `null` heißt hier folglich „nicht
 * geladen" und wird als „kein Treffer" behandelt; die Sperre fällt dann auf
 * den Abgleich über die Konto-ID zurück, statt mit einem Laufzeitfehler
 * abzubrechen.
 */
export type AffiliateAttributionPartner = {
  id: string;
  tenant_id: string;
  program_id: string;
  /** `null`, solange sich der Partner nie angemeldet hat (3.3). */
  user_id: string | null;
  /** Siehe oben: `null` = nicht geladen, nicht „leer". */
  applicant_email: string | null;
  status: AffiliatePartnerStatus;
};

/**
 * Eine Referral-Zeile (3.7) mit ihrem Partner. Der Partner hängt am
 * Kandidaten und wird nicht über eine zweite Nachschlagetabelle gereicht:
 * jede Regel braucht beides zusammen, und eine Kandidatenliste, deren Partner
 * woanders steht, lässt sich in einem Test nicht als ein Objektliteral
 * hinschreiben.
 */
export type AffiliateReferralCandidate = {
  id: string;
  tenant_id: string;
  program_id: string;
  partner_id: string;
  /** 32 Zufallsbytes hex; geht als `affiliate_ref_token` in die Metadata. */
  token: string;
  campaign: string | null;
  /** Gesetzt von `bindReferral()` (4.3). */
  user_id: string | null;
  status: "active" | "superseded" | "revoked";
  expires_at: string;
  created_at: string;
  /**
   * `is_bot` der auslösenden Klickzeile (4.4 R5). `null` ist ausdrücklich
   * KEIN Ausschlussgrund: `affiliate_clicks` wird nach 90 Tagen gelöscht
   * (3.6), `cookie_ttl_days` darf bis 365 gehen — eine noch lebende
   * Zuordnung verlöre sonst allein durch den Ablauf der Aufbewahrungsfrist
   * ihre Gültigkeit, und der Partner bekäme für einen echten Klick kein Geld.
   * Ein Bot-Klick erzeugt ohnehin gar keine Referral-Zeile (4.2 Schritt 4);
   * die Prüfung hier ist die zweite Linie für den Fall, dass er es doch tut.
   */
  is_bot: boolean | null;
  partner: AffiliateAttributionPartner | null;
};

/** Die Lifetime-Bindung (3.8) mit ihrem Partner, Begründung wie oben. */
export type AffiliateBindingCandidate = {
  tenant_id: string;
  program_id: string;
  user_id: string;
  partner_id: string;
  source: "click" | "coupon" | "manual";
  partner: AffiliateAttributionPartner | null;
};

/**
 * Alles, was die Entscheidung braucht — vollständig geladen, bevor diese
 * Funktion läuft.
 *
 * `tenantId` kommt IMMER aus einem Gate (`access.ts`), nie aus einer
 * client-gelieferten Angabe: er ist hier das Prüfmaß für jeden Kandidaten
 * (CLAUDE.md §2.15). Ein Token, ein Gutscheincode oder eine Bindung aus einem
 * fremden Mandanten scheitert damit an dieser Funktion auch dann, wenn die
 * ladende Abfrage einen Filter vergessen hat.
 */
export type AffiliateAttributionInput = {
  tenantId: string;
  /** `tenant.settings.affiliate_enabled === true` (access.ts, R0). */
  featureEnabled: boolean;
  /** `null`, wenn der Mandant gar kein Programm hat (R0). */
  program: AffiliateAttributionProgram | null;
  /** Der Käufer ist beim Checkout immer angemeldet (4.4, erster Satz). */
  buyer: { userId: string; email: string | null };
  /** Bestellzeitpunkt, hereingereicht — nie `new Date()` in dieser Datei. */
  at: Date;
  /** R3: Partner zum eingelösten Gutscheincode, bereits über den Code geladen. */
  couponPartner?: AffiliateAttributionPartner | null;
  /** R5: Referral zum `?aff=`-Token aus der URL. */
  urlReferral?: AffiliateReferralCandidate | null;
  /** R6: Referral zum `ct_aff`-Cookie. */
  cookieReferral?: AffiliateReferralCandidate | null;
  /** R7: alle Referral-Zeilen mit `user_id = Käufer`, Reihenfolge egal. */
  userReferrals?: readonly AffiliateReferralCandidate[];
  /** R4/R8: die Lifetime-Bindung des Käufers in diesem Programm. */
  binding?: AffiliateBindingCandidate | null;
};

// --- Ergebnisform -------------------------------------------------------

export type AffiliateAttributionResult = {
  /** `null` = Hausverkauf: gar keine Provisionszeile (R0, R1, R9). */
  partnerId: string | null;
  /** Die tragende Referral-Zeile; `null` bei Gutschein- und Bindungstreffern. */
  referralId: string | null;
  /** `affiliate_ref_token` für die Stripe-Metadata; `null` ohne Referral-Zeile. */
  token: string | null;
  /** Kampagne der tragenden Referral-Zeile, für die Buchungszeile. */
  campaign: string | null;
  /**
   * 4.5: Testbestellung. Hier nur der Anteil, der beim Checkout bekannt ist
   * (`program.test_mode`). Der Webhook ODER-t später `event.livemode === false`
   * dazu — der Wert ist beim Erzeugen der Session noch nicht bekannt und darf
   * hier deshalb nicht vorgetäuscht werden.
   */
  isTest: boolean;
  /** R2: Buchung entsteht mit `flagged = true` und bleibt `pending`. */
  flagged: boolean;
  flagReason: "self_referral" | null;
  /**
   * R1: der Verkauf zählt in `affiliate_daily_stats.orders_count`, aber mit
   * `commission_cents = 0`. Ohne dieses Feld wäre die Kennzahl „Bestellungen"
   * eines Partners um genau die Fälle zu niedrig, in denen er selbst gekauft
   * hat — und niemand könnte erklären, warum.
   */
  countsAsOrderWithoutCommission: boolean;
  /** R3: die Lifetime-Bindung wird beim Buchen mit `source = 'coupon'` gesetzt. */
  setsLifetimeBinding: boolean;
  /** Vom Aufrufer zu schreibende Prüfprotokoll-Vorgänge, siehe Konstanten oben. */
  auditActions: readonly string[];
  meta: {
    rule: AffiliateAttributionRule;
    reason: AffiliateAttributionReason | null;
  };
};

// --- E-Mail-Normalisierung (4.4, letzter Absatz) ------------------------

/**
 * `normalize(e) = lower(trim(e))`, im lokalen Teil alles ab `+` abgeschnitten
 * und bei `gmail.com` zusätzlich die Punkte entfernt.
 *
 * Diese Funktion entscheidet über Geld: sie ist die eine Hälfte der
 * Selbst-Empfehlungssperre. Wer sie zu eng baut, lässt die Umgehung
 * `partner+kauf@…` durch; wer sie zu weit baut, sperrt zwei verschiedene
 * Menschen, die zufällig ähnliche Adressen haben. Sie steht deshalb als
 * eigene, einzeln getestete Funktion hier und nicht als Ausdruck mitten in
 * der Regelkette.
 *
 * Bewusst NUR `gmail.com` und nicht zusätzlich `googlemail.com` oder andere
 * Anbieter mit Punkt-Toleranz: der Plan nennt genau diese eine Domain. Jede
 * eigenmächtig ergänzte Domain wäre eine Regel, die weder im Programmtext
 * steht noch dem Partner gegenüber begründbar ist — und die im Zweifel eine
 * echte Empfehlung als Selbstkauf sperrt.
 *
 * Rückgabe `null` heißt „nicht vergleichbar" und führt NIE zu einem Treffer:
 * eine unbrauchbare Adresse darf keine Sperre auslösen, aber auch keine
 * umgehen (der Abgleich über die Konto-ID läuft unabhängig davon weiter).
 */
export function normalizeAffiliateEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return null;

  // `lastIndexOf`, nicht `indexOf`: der lokale Teil einer Adresse darf in
  // Anführungszeichen ein `@` enthalten. Das Trennzeichen ist immer das
  // letzte. Ohne `@`, mit leerem lokalem Teil oder leerer Domain ist die
  // Adresse nicht vergleichbar.
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);

  if (domain === "gmail.com") local = local.replaceAll(".", "");

  // Ein lokaler Teil, der erst durch die Normalisierung leer wird
  // (`+tag@example.com`, `...@gmail.com`), ist nicht vergleichbar. Ihn als
  // `"@example.com"` zurückzugeben wäre der gefährlichste Fall überhaupt:
  // ZWEI solche Adressen wären dann gleich, und eine fremde Bestellung fiele
  // als Selbstkauf aus der Provision.
  if (local === "") return null;

  return `${local}@${domain}`;
}

/**
 * Der Selbst-Empfehlungsabgleich aus 4.4: `partner.user_id = order.user_id`
 * ODER `normalize(partner.applicant_email) = normalize(käufer_email)`.
 *
 * Was hier ausdrücklich NICHT geprüft wird, ist die IP-Adresse — und das ist
 * keine Auslassung, sondern die Vorgabe des Plans („Selbst-Empfehlung wird
 * nie über die IP erkannt"). Zwei Gründe, beide praktisch:
 *   1. Fehlalarme. Ein Firmennetz, eine Schule, ein Mobilfunk-CGNAT und
 *      jedes öffentliche WLAN legen hunderte fremde Menschen hinter dieselbe
 *      Adresse. Der Partner, der seinen Kollegen wirbt, würde gesperrt.
 *   2. Wirkungslosigkeit. Die Umgehung kostet einen Mobilfunk-Hotspot oder
 *      einen Browser im privaten Modus über ein anderes Netz — eine Regel,
 *      die nur die Ehrlichen trifft, ist keine.
 * Die Klicktabelle führt `ip_hash` deshalb ausschließlich zur Entdoppelung
 * und als Betrugsheuristik für Menschen (3.6), nie als Entscheidungsgrundlage
 * für Geld.
 */
export function detectSelfReferral(
  partner: AffiliateAttributionPartner | null,
  buyer: { userId: string; email: string | null },
): "account" | "email" | null {
  if (partner === null) return null;

  // Konto-ID zuerst: sie ist die belastbare Kennung. Die E-Mail ist nur der
  // Notnagel für den Partner, der sich nie angemeldet hat (`user_id = null`).
  if (partner.user_id !== null && partner.user_id === buyer.userId) return "account";

  const partnerEmail = normalizeAffiliateEmail(partner.applicant_email);
  if (partnerEmail === null) return null;

  const buyerEmail = normalizeAffiliateEmail(buyer.email);
  if (buyerEmail === null) return null;

  return partnerEmail === buyerEmail ? "email" : null;
}

// --- Gültigkeitsprüfungen der Kandidaten --------------------------------

/**
 * Ein Kandidat, dessen Partner mitgeladen und brauchbar ist. Die beiden Typen
 * existieren nur, damit die Typwächter unten nicht bloß „die Zeile ist gültig"
 * sagen, sondern auch „ihr Partner steht da" — sonst bräuchte jede
 * Regelverzweigung ein `!` auf `.partner`, und das ist die Stelle, an der ein
 * `null` später unbemerkt durchrutscht.
 */
type UsableReferral = AffiliateReferralCandidate & { partner: AffiliateAttributionPartner };
type UsableBinding = AffiliateBindingCandidate & { partner: AffiliateAttributionPartner };

/**
 * Mandant, Programm und Status eines Partners. Die Mandantenprüfung ist hier
 * nicht redundant zur Abfrage: sie ist die Stelle, an der ein Kandidat aus
 * einem fremden Mandanten sicher ausfällt, auch wenn die ladende Abfrage
 * einen Filter verliert (CLAUDE.md §2.15).
 *
 * `status = 'active'` ist dieselbe Grenze wie im Klick-Endpunkt (4.2
 * Schritt 3): ein gesperrter (`suspended`), abgelehnter oder noch nicht
 * freigeschalteter Partner verdient nichts. Der Käufer merkt davon nichts —
 * der Kauf läuft, nur ohne Zuordnung.
 */
function isPartnerUsable(
  partner: AffiliateAttributionPartner | null,
  tenantId: string,
  programId: string,
): partner is AffiliateAttributionPartner {
  if (partner === null) return false;
  if (partner.tenant_id !== tenantId) return false;
  if (partner.program_id !== programId) return false;
  return partner.status === "active";
}

/**
 * Die Prüfliste für ein frisches Token aus 4.4 R5/R6, wörtlich: gleicher
 * Mandant, `status = 'active'`, `expires_at > now()`, `is_bot = false`,
 * Partner und Programm aktiv. Das Programm ist an dieser Stelle bereits
 * geprüft (R0), es bleibt die Zugehörigkeit der Zeile zu genau diesem
 * Programm.
 *
 * Ein unlesbares `expires_at` ergibt `NaN`; jeder Vergleich damit ist
 * `false`, die Zeile fällt also heraus statt mit einem stillen Standardwert
 * zu gelten — gleiche Richtung wie bei den Konditionsfenstern in
 * `compute.ts`.
 */
function isFreshTokenUsable(
  candidate: AffiliateReferralCandidate | null | undefined,
  input: AffiliateAttributionInput,
  program: AffiliateAttributionProgram,
): candidate is UsableReferral {
  if (candidate === null || candidate === undefined) return false;
  if (candidate.tenant_id !== input.tenantId) return false;
  if (candidate.program_id !== program.id) return false;
  if (candidate.status !== "active") return false;
  if (candidate.is_bot === true) return false;
  if (!(Date.parse(candidate.expires_at) > input.at.getTime())) return false;
  if (candidate.partner_id !== candidate.partner?.id) return false;
  return isPartnerUsable(candidate.partner, input.tenantId, program.id);
}

/**
 * Der Serverzustand aus 4.4 R7. Zwei Unterschiede zu R5/R6, beide beabsichtigt:
 *
 *   - `status <> 'revoked'` statt `status = 'active'`: eine `superseded`
 *     Zeile ist kein Fehler, sondern die Vorgeschichte. Beim
 *     First-Click-Modell ist genau sie die richtige Antwort — der erste
 *     Klick wurde von einem späteren abgelöst und soll trotzdem gewinnen.
 *     `revoked` dagegen ist die ausdrückliche Rücknahme und bleibt draußen.
 *   - `user_id = Käufer`: R7 ist der Gerätewechsel. Die Zuordnung hängt hier
 *     am Konto, nicht am Träger, und ohne Kontobindung (`bindReferral()`,
 *     4.3) gibt es diesen Weg nicht.
 */
function isServerStateUsable(
  candidate: AffiliateReferralCandidate,
  input: AffiliateAttributionInput,
  program: AffiliateAttributionProgram,
): boolean {
  if (candidate.tenant_id !== input.tenantId) return false;
  if (candidate.program_id !== program.id) return false;
  if (candidate.user_id !== input.buyer.userId) return false;
  if (candidate.status === "revoked") return false;
  if (candidate.is_bot === true) return false;
  if (!(Date.parse(candidate.expires_at) > input.at.getTime())) return false;
  if (candidate.partner_id !== candidate.partner?.id) return false;
  return isPartnerUsable(candidate.partner, input.tenantId, program.id);
}

/**
 * R4/R8: die Bindung muss zum Mandanten, zum Programm und zum Käufer
 * gehören.
 *
 * ZUSATZ ZUM PLAN, bewusst: der gebundene Partner muss AKTIV sein. Der Plan
 * nennt die Statusprüfung nur bei R3, R5 und R6. Sie hier auszulassen hieße,
 * dass ein wegen Betrugsverdachts gesperrter Partner über seine Altbindungen
 * weiterverdient — und zwar unbefristet, denn die Bindung läuft nie ab. Das
 * widerspricht der Sperre selbst; die Sperre ist die einzige Handhabe, die
 * ein Händler gegen einen Partner hat. Fällt die Bindung hier heraus,
 * entscheidet die Kette weiter unten (R5–R7) oder es bleibt beim Hausverkauf.
 */
function isBindingUsable(
  binding: AffiliateBindingCandidate | null | undefined,
  input: AffiliateAttributionInput,
  program: AffiliateAttributionProgram,
): binding is UsableBinding {
  if (binding === null || binding === undefined) return false;
  if (binding.tenant_id !== input.tenantId) return false;
  if (binding.program_id !== program.id) return false;
  if (binding.user_id !== input.buyer.userId) return false;
  if (binding.partner_id !== binding.partner?.id) return false;
  return isPartnerUsable(binding.partner, input.tenantId, program.id);
}

/**
 * Sortierschlüssel für R7. `last` → jüngste Zeile zuerst, `first` → älteste.
 * Bei gleichem `created_at` entscheidet die `id` aufsteigend, damit das
 * Ergebnis stabil ist — zwei Klicks in derselben Millisekunde sind bei einem
 * Doppelklick auf denselben Link der Normalfall, und eine Zuordnung, die je
 * nach Ladereihenfolge der Datenbank anders ausfällt, ist im Streitfall
 * nicht erklärbar. Gleiche Begründung wie beim `id`-Vergleich in
 * `resolveCondition()` (compute.ts).
 */
function compareByAttributionModel(
  a: AffiliateReferralCandidate,
  b: AffiliateReferralCandidate,
  model: AffiliateAttributionModel,
): number {
  const aAt = Date.parse(a.created_at);
  const bAt = Date.parse(b.created_at);
  // Unlesbare Zeitstempel dürfen die Reihenfolge nicht zufällig machen: sie
  // zählen als ältestmöglich und landen damit bei `last` hinten.
  const aMs = Number.isNaN(aAt) ? Number.NEGATIVE_INFINITY : aAt;
  const bMs = Number.isNaN(bAt) ? Number.NEGATIVE_INFINITY : bAt;

  if (aMs !== bMs) return model === "last" ? bMs - aMs : aMs - bMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// --- Die Regelkette -----------------------------------------------------

/** Zwischenergebnis von R3 bis R8, bevor R1/R2 darüber entscheiden. */
type AttributionCandidate = {
  rule: AffiliateAttributionRule;
  reason: AffiliateAttributionReason;
  partner: AffiliateAttributionPartner;
  referral: AffiliateReferralCandidate | null;
  setsLifetimeBinding: boolean;
};

/**
 * R3 bis R8 der Reihe nach; `null` ist R9 (Hausverkauf).
 *
 * Zur Rangfolge, weil sie der strittigste Teil des ganzen Systems ist und
 * wörtlich so in `program.terms_text` gehört (4.4):
 *
 * R3 (Gutscheincode) steht oben, weil der Code eine bewusste, sichtbare
 * Handlung des Käufers ist und der einzige Träger für Podcast, Print und
 * Influencer ohne klickbaren Link. Der bekannte Missbrauch — Gutscheinseiten
 * schöpfen am Ende des Funnels die Provision dessen ab, der den Kauf
 * ausgelöst hat — ist gedämpft, weil Block B10 (echter Rabatt) nicht gebaut
 * wird: ein Code ohne Preisvorteil wird auf Gutscheinseiten nicht verbreitet.
 * WIRD B10 JE GEBAUT, MUSS R3 UNTER R5 RUTSCHEN.
 *
 * R4 steht über dem Token, R8 darunter. Das ist kein Widerspruch, sondern die
 * Auflösung des klassischen Konflikts: eine bestehende Lifetime-Bindung
 * schlägt einen frischen Klick nur dann, wenn beide Regeln denselben Kunden
 * meinen — sie ist eine dauerhafte Zusage an den ersten Partner. R4 greift
 * deshalb nur, wenn gar kein gültiges frisches Token vorliegt; existiert
 * eines, entscheidet R5/R6, und R8 fängt nur den Fall ab, dass das Token
 * ungültig geworden ist.
 *
 * `program.lifetime_binding` steht in R4 und bewusst NICHT in R8 — so
 * steht es im Plan, und es ergibt eine Regel: ist die Lifetime-Bindung
 * abgeschaltet, gewinnt frischer Verkehr (R5–R7) über die Altbindung, aber
 * die Altbindung bleibt der letzte Auffangfall, statt ersatzlos zu
 * verfallen. Eine einmal gegebene Zusage verschwindet nicht dadurch, dass
 * der Händler die Einstellung umlegt.
 */
function resolveCandidate(
  input: AffiliateAttributionInput,
  program: AffiliateAttributionProgram,
): AttributionCandidate | null {
  // Die vier Kandidaten als lokale `const`-Bindungen. Das ist keine
  // Bequemlichkeit: nur über eine `const`-Variable verengt TypeScript den Typ
  // durch eine gespeicherte Typwächter-Bedingung (`const x = isUsable(y)`).
  // Über `input.binding` direkt bliebe der Wert `… | null | undefined`, und
  // der Zugriff auf `.partner` bräuchte ein `!` — also genau die Stelle, an
  // der ein späterer Umbau still einen Laufzeitfehler einbaut.
  const couponPartner = input.couponPartner ?? null;
  const urlReferral = input.urlReferral ?? null;
  const cookieReferral = input.cookieReferral ?? null;
  const binding = input.binding ?? null;

  // --- R3: Gutscheincode des Partners eingelöst --------------------------
  if (isPartnerUsable(couponPartner, input.tenantId, program.id)) {
    return {
      rule: "R3",
      reason: "coupon",
      partner: couponPartner,
      referral: null,
      // 4.4 R3: „dieser Partner, Lifetime-Bindung wird gesetzt".
      setsLifetimeBinding: true,
    };
  }

  const urlUsable = isFreshTokenUsable(urlReferral, input, program);
  const cookieUsable = isFreshTokenUsable(cookieReferral, input, program);
  const bindingUsable = isBindingUsable(binding, input, program);

  // --- R4: Lifetime-Bindung, aber nur ohne gültiges frisches Token -------
  if (bindingUsable && program.lifetime_binding && !urlUsable && !cookieUsable) {
    return {
      rule: "R4",
      reason: "lifetime",
      partner: binding.partner,
      referral: null,
      setsLifetimeBinding: false,
    };
  }

  // --- R5: `?aff=`-Token aus der URL -------------------------------------
  if (urlUsable) {
    return {
      rule: "R5",
      reason: "url_token",
      partner: urlReferral.partner,
      referral: urlReferral,
      setsLifetimeBinding: false,
    };
  }

  // --- R6: `ct_aff`-Cookie ----------------------------------------------
  if (cookieUsable) {
    return {
      rule: "R6",
      reason: "cookie_token",
      partner: cookieReferral.partner,
      referral: cookieReferral,
      setsLifetimeBinding: false,
    };
  }

  // --- R7: Serverzustand am Konto des Käufers ---------------------------
  const serverState = (input.userReferrals ?? [])
    .filter((candidate) => isServerStateUsable(candidate, input, program))
    .sort((a, b) => compareByAttributionModel(a, b, program.attribution_model));

  const best = serverState[0];
  if (best !== undefined && best.partner !== null) {
    return {
      rule: "R7",
      reason: "server_state",
      partner: best.partner,
      referral: best,
      setsLifetimeBinding: false,
    };
  }

  // --- R8: Lifetime-Bindung als Auffangfall ------------------------------
  if (bindingUsable) {
    return {
      rule: "R8",
      reason: "lifetime_fallback",
      partner: binding.partner,
      referral: null,
      setsLifetimeBinding: false,
    };
  }

  // --- R9: Hausverkauf ---------------------------------------------------
  return null;
}

/** Das Ergebnis „keine Zuordnung" in seinen drei Ausprägungen (R0, R1, R9). */
function noAttribution(
  rule: AffiliateAttributionRule,
  reason: AffiliateAttributionReason | null,
  options: {
    isTest: boolean;
    countsAsOrderWithoutCommission?: boolean;
    auditActions?: readonly string[];
  },
): AffiliateAttributionResult {
  return {
    partnerId: null,
    referralId: null,
    token: null,
    campaign: null,
    isTest: options.isTest,
    flagged: false,
    flagReason: null,
    countsAsOrderWithoutCommission: options.countsAsOrderWithoutCommission ?? false,
    setsLifetimeBinding: false,
    auditActions: options.auditActions ?? [],
    meta: { rule, reason },
  };
}

/**
 * Die Entscheidung. Erste zutreffende Regel gewinnt (4.4).
 *
 * Eine Anmerkung zur Reihenfolge, die beim Lesen der Tabelle sonst stolpern
 * lässt: R1/R2 stehen dort ÜBER R3–R8, lassen sich aber erst entscheiden,
 * wenn feststeht, WELCHER Partner gewonnen hätte — „der Käufer ist selbst der
 * Partner" ist eine Aussage über den Sieger, nicht über die Kandidatenmenge.
 * Der Code ermittelt deshalb zuerst den Sieger aus R3–R8 und wendet R1/R2
 * darauf an. Das Ergebnis ist exakt die Tabelle: die Selbst-Empfehlung
 * überstimmt jede Zuordnungsregel, die sie ausgelöst hätte.
 */
export function resolveAttribution(
  input: AffiliateAttributionInput,
): AffiliateAttributionResult {
  const program = input.program;

  // --- R0: Modul aus oder Programm nicht aktiv ---------------------------
  // Zuerst und ohne jede weitere Prüfung. `test_mode` eines nicht aktiven
  // Programms interessiert nicht — es entsteht gar keine Zeile, in die es
  // geschrieben werden könnte, und `isTest: false` ist hier die ehrlichere
  // Angabe als ein Wert aus einer Zeile, die niemand anwendet.
  if (
    !input.featureEnabled ||
    program === null ||
    program.status !== "active" ||
    program.tenant_id !== input.tenantId
  ) {
    return noAttribution("R0", null, { isTest: false });
  }

  const isTest = program.test_mode === true;

  const candidate = resolveCandidate(input, program);

  // --- R9: kein Kandidat -------------------------------------------------
  if (candidate === null) {
    return noAttribution("R9", null, { isTest });
  }

  // --- R1/R2: Selbst-Empfehlung ------------------------------------------
  const selfReferral = detectSelfReferral(candidate.partner, input.buyer);
  if (selfReferral !== null && program.self_referral === "block") {
    // R1: keine Zuordnung. Der Verkauf zählt trotzdem in `orders_count` mit
    // `commission_cents = 0`, und der Vorgang wird protokolliert — ein
    // gesperrter Selbstkauf, den niemand sieht, ist ein Streit mit dem
    // Partner, der sich später nicht mehr rekonstruieren lässt.
    return noAttribution("R1", "self_referral", {
      isTest,
      countsAsOrderWithoutCommission: true,
      auditActions: [AFFILIATE_ATTRIBUTION_AUDIT_ACTIONS.selfReferralBlocked],
    });
  }

  const auditActions: string[] = [];

  // R2: Zuordnung entsteht, aber markiert und `pending` — die Entscheidung
  // trifft ein Mensch (6.2). Der Modus heißt `allow_flagged` und nicht
  // `allow`: eine unmarkierte Selbst-Empfehlung wäre dasselbe wie gar keine
  // Prüfung.
  const flagged = selfReferral !== null && program.self_referral === "allow_flagged";
  if (flagged) {
    auditActions.push(AFFILIATE_ATTRIBUTION_AUDIT_ACTIONS.selfReferralFlagged);
  }

  // Abweichung von einer bestehenden Lifetime-Bindung (4.4, letzter Absatz
  // der Rangfolge-Begründung). Geprüft wird gegen die BINDUNG selbst, nicht
  // gegen ihre Brauchbarkeit: auch eine Bindung an einen gesperrten Partner
  // ist eine Zusage, über die hier hinweggegangen wird, und genau das soll im
  // Protokoll stehen.
  const binding = input.binding ?? null;
  if (
    binding !== null &&
    binding.user_id === input.buyer.userId &&
    binding.partner_id !== candidate.partner.id
  ) {
    auditActions.push(AFFILIATE_ATTRIBUTION_AUDIT_ACTIONS.overriddenByClick);
  }

  return {
    partnerId: candidate.partner.id,
    referralId: candidate.referral?.id ?? null,
    token: candidate.referral?.token ?? null,
    campaign: candidate.referral?.campaign ?? null,
    isTest,
    flagged,
    flagReason: flagged ? "self_referral" : null,
    countsAsOrderWithoutCommission: false,
    setsLifetimeBinding: candidate.setsLifetimeBinding,
    auditActions,
    meta: {
      rule: flagged ? "R2" : candidate.rule,
      reason: flagged ? "self_referral_flagged" : candidate.reason,
    },
  };
}

/**
 * Kleine Lesehilfe für Aufrufer und Tests: trägt das Ergebnis eine Zuordnung?
 * Bewusst `partnerId !== null` und nicht `meta.reason !== null` — R2 hat einen
 * Grund UND eine Zuordnung, R1 einen Grund und KEINE. Wer die falsche Frage
 * stellt, bucht in einem der beiden Fälle falsch.
 */
export function hasAffiliateAttribution(result: AffiliateAttributionResult): boolean {
  return result.partnerId !== null;
}
