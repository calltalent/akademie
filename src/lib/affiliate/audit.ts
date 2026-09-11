import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AffiliateAuditActorKind, AffiliateAuditEntity } from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B1 — das Auditprotokoll
 * (PLAN_Affiliate-System.md 3.16, 7.8, 11.11, 11.15, G15).
 *
 * `affiliate_audit_log` ist der Prüfpfad des Moduls: jede Änderung an
 * Programm, Partner, Kondition, Buchung, Auszahlung und Zuordnung. Die
 * Tabelle ist unveränderlich — ein `before update or delete`-Trigger weist
 * jede Änderung ab, auch die des `service_role`-Clients (Migration
 * 20260910120000_affiliate_core.sql). Daraus folgt die wichtigste Regel
 * dieser Datei: was einmal hier steht, steht dauerhaft hier. Es gibt kein
 * nachträgliches Schwärzen, also muss vor dem Schreiben geschwärzt werden.
 *
 * Zwei Gründe, die über die wörtliche Liste aus 3.16 hinausgehen und die
 * längere Redaktionsliste unten tragen:
 *
 * 1. Die SELECT-Policy lautet `affiliate_is_manager(tenant_id) or entity_id =
 *    affiliate_partner_id(tenant_id)` — ein Partner liest also jede Zeile, die
 *    seine eigene Partner-ID trägt. Spalten, die die Spaltenrechte aus 3.3 dem
 *    Partner ausdrücklich vorenthalten (`internal_note`, `status_reason`,
 *    `application`, `terms_accepted_ip_hash`), dürfen deshalb nicht über
 *    `before`/`after` zurückkommen. RLS trennt keine Spalten, jsonb erst recht
 *    nicht.
 * 2. Der Löschantrag (7.8) anonymisiert die Partnerzeile (`display_name`,
 *    `company`, `applicant_email`, `application`, `terms_accepted_ip_hash`)
 *    und löscht das Abrechnungsprofil, lässt Buchungsbelege aber stehen. Stünde
 *    derselbe Personenbezug im unveränderlichen Protokoll, liefe die
 *    Anonymisierung ins Leere — Art. 17 DSGVO wäre mit einem Verweis auf § 147
 *    AO nicht mehr zu rechtfertigen, denn das Protokoll ist kein Buchungsbeleg.
 *
 * Was der Prüfpfad dadurch verliert, ist gering: der Änderungsmarker
 * `"*** (geändert)"` zeigt weiterhin, DASS ein geschütztes Feld geändert
 * wurde, von wem und wann — und genau das ist die Frage, die ein Prüfpfad
 * beantworten muss. Der aktuelle Wert steht ohnehin in der Zeile selbst.
 *
 * Geschrieben wird ausschließlich über `createAdminClient()`: die Tabelle hat
 * bewusst keine INSERT-Policy für Clients. `tenantId` kommt deshalb IMMER aus
 * einem Gate (`requireAffiliate*` in access.ts), nie aus einer
 * client-gelieferten ID — der Admin-Client umgeht RLS (CLAUDE.md §2.10/§2.15).
 */

// --- Redaktion: Schlüssel -----------------------------------------------

/** Wert eines geschützten Feldes, unverändert. */
export const AFFILIATE_AUDIT_REDACTED = "***";

/** Wert eines geschützten Feldes, das sich zwischen `before` und `after` unterscheidet. */
export const AFFILIATE_AUDIT_REDACTED_CHANGED = "*** (geändert)";

/**
 * Schlüssel werden vor dem Vergleich normalisiert (klein, ohne Trennzeichen),
 * damit `paypal_email`, `paypalEmail` und `PayPal-Email` derselbe Schlüssel
 * sind. Die Zeilentypen dieses Moduls sind snake_case (siehe types.ts), aber
 * ein Aufrufer kann auch ein aufbereitetes Objekt übergeben.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Vier Gruppen, jede mit eigenem Anlass:
 *
 * (a) Zahlungsverbindung und Steuerdaten — wörtlich aus Plan 3.16, ergänzt um
 *     `bic` und `account_holder`: sie stehen in derselben Zeile wie die IBAN
 *     und sind derselbe Datensatz; die Admin-Oberfläche zeigt Bankdaten
 *     ausdrücklich nie an (8.1), das Protokoll darf sie dann nicht nachreichen.
 *     `vat_check_log` ist die rohe VIES-Antwort und enthält Name und Anschrift.
 * (b) Spalten, die die Spaltenrechte aus 3.3 dem Partner vorenthalten,
 *     während er seine eigenen Protokollzeilen lesen darf (Grund 1 oben).
 *     `payout_hold_reason` gehört seit der zweiten Gegenlese-Runde dazu: die
 *     Spalte stand weder hier noch traf eine der Endungen unten, und der
 *     Freitext einer Auszahlungssperre („Verdacht auf Eigenbestellungen,
 *     Anwalt eingeschaltet") erreichte den Partner damit über `before`/`after`
 *     im Klartext — während `internal_note` und `status_reason` derselben
 *     Zeile korrekt als „***" erschienen. Gegenstück in der Migration
 *     20260910120000_affiliate_core.sql, Abschnitt 4: die Spalte ist dort aus
 *     dem SELECT-Spaltenrecht von `authenticated` entfernt, sonst hätte der
 *     Partner sie ohnehin an der Quelle gelesen und die Redaktion wäre
 *     Theater gewesen.
 * (c) Personenbezug, den der Löschantrag anonymisiert (Grund 2 oben).
 * (d) Geheimnisse, die in einer Zeile dieses Moduls nie vorkommen sollten —
 *     Gürtel und Hosenträger für den Fall, dass ein späterer Aufrufer ein
 *     ganzes Anfrage- oder Fehlerobjekt durchreicht.
 */
const AFFILIATE_AUDIT_REDACTED_KEYS: ReadonlySet<string> = new Set(
  [
    // (a)
    "iban",
    "bic",
    "account_holder",
    "paypal_email",
    "vat_id",
    "tax_number",
    "vat_check_log",
    // (b)
    "internal_note",
    "status_reason",
    "payout_hold_reason",
    "application",
    "terms_accepted_ip_hash",
    "ip_hash",
    // (c)
    "applicant_email",
    "display_name",
    "company",
    "legal_name",
    "street",
    "postal_code",
    "city",
    // (d)
    "password",
    "passwort",
    "secret",
    "token",
    "api_key",
    "authorization",
    "cookie",
  ].map(normalizeKey),
);

/**
 * Endungen statt vollständiger Namen für die Fälle, die je Block neu
 * entstehen: `customer_email`, `buyer_email`, `referral_token`,
 * `webhook_secret`. Bewusst KEINE Endung `key` — `dedup_key` ist die
 * Idempotenzachse (G3) und gehört als Klartext in den Prüfpfad.
 */
const AFFILIATE_AUDIT_REDACTED_SUFFIXES = [
  "email",
  "token",
  "secret",
  "password",
  "iban",
  "iphash",
  "apikey",
] as const;

/** Trägt dieser Schlüssel einen Wert, der nie im Klartext ins Protokoll darf? */
export function isRedactedAuditKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (AFFILIATE_AUDIT_REDACTED_KEYS.has(normalized)) return true;
  return AFFILIATE_AUDIT_REDACTED_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

// --- Redaktion: Werte ---------------------------------------------------

/**
 * Zweite Linie hinter der Schlüsselliste: ein freies Textfeld (`note`,
 * `flag_reason`, `status_reason` einer anderen Tabelle, eine
 * Fehlerzeichenkette) kann dieselben Daten enthalten, ohne so zu heißen.
 * Dieselbe Anforderung wie bei `affiliate_events.last_error` (Plan 11.11).
 *
 * Reihenfolge ist bedeutsam: erst der Stripe-Geheimschlüssel, dann
 * E-Mail-Adressen (sonst zerlegt das IBAN- oder Token-Muster den lokalen Teil
 * einer Adresse), dann IBAN vor USt-IdNr. (die IBAN ist das längere Muster und
 * beginnt ebenfalls mit zwei Buchstaben), zuletzt die langen Hex-Ketten.
 *
 * Stripe-OBJEKT-Kennungen (`cs_…`, `sub_…`, `in_…`, `ch_…`) werden bewusst
 * NICHT ersetzt: sie sind kein Geheimnis, sondern der Beleg, aus dem eine
 * Buchung reproduzierbar bleiben muss (G4). Ersetzt werden nur Schlüssel.
 */
const STRIPE_SECRET_PATTERN = /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g;

/** Form wie `EMAIL_PATTERN` in `src/lib/contact/patterns.ts`. */
const EMAIL_PATTERN = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[a-z]{2,}/gi;

/** Zwei Buchstaben, zwei Prüfziffern, danach 11–30 Zeichen — Leerzeichen erlaubt. */
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g;

/** USt-IdNr. der EU-Mitgliedstaaten inklusive Nordirland (`XI`). */
const VAT_ID_PATTERN =
  /\b(?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)[0-9A-Z]{8,12}\b/g;

/** Referral-Token sind 64 Hex-Zeichen (4.2); UUIDs mit Bindestrichen treffen nicht zu. */
const LONG_HEX_PATTERN = /\b[0-9a-f]{32,}\b/gi;

/** Länger braucht kein Protokolleintrag; hält einen versehentlich durchgereichten Dateiinhalt klein. */
const MAX_STRING_LENGTH = 2000;

/** Schutz gegen tief verschachtelte oder zyklische Objekte. */
const MAX_DEPTH = 6;

/** Mehr Einträge sagen über eine Änderung nichts mehr aus. */
const MAX_ARRAY_ITEMS = 100;

function redactString(value: string): string {
  const scrubbed = value
    .replace(STRIPE_SECRET_PATTERN, "[Schlüssel]")
    .replace(EMAIL_PATTERN, "[E-Mail]")
    .replace(IBAN_PATTERN, "[IBAN]")
    .replace(VAT_ID_PATTERN, "[USt-IdNr.]")
    .replace(LONG_HEX_PATTERN, "[Token]");

  return scrubbed.length > MAX_STRING_LENGTH
    ? `${scrubbed.slice(0, MAX_STRING_LENGTH)} … (gekürzt)`
    : scrubbed;
}

/**
 * Ein geschütztes Feld wird zu `"***"`, ein leeres bleibt `null`: ob ein Feld
 * überhaupt gefüllt ist, ist die Auskunft, die der Manager für die
 * Vollständigkeitsampel der Auszahlung braucht (8.1) — der Wert ist es nicht.
 */
function redactProtectedValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return AFFILIATE_AUDIT_REDACTED;
}

function redactUnknown(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (depth >= MAX_DEPTH) return "[…]";

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactUnknown(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`… (${value.length - MAX_ARRAY_ITEMS} weitere)`);
    }
    return items;
  }

  if (typeof value === "object") return redactObject(value as Record<string, unknown>, depth + 1);

  // Alles andere (Funktion, Symbol, bigint) hat in einer Zeile nichts zu
  // suchen und wird nicht geraten.
  return null;
}

function redactObject(payload: Record<string, unknown>, depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    result[key] = isRedactedAuditKey(key)
      ? redactProtectedValue(value)
      : redactUnknown(value, depth);
  }
  return result;
}

/** Vergleich der ROHEN Werte für den Änderungsmarker; DB-Zeilen sind reines JSON. */
function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Redigiert beide Nutzlasten gemeinsam, weil der Änderungsmarker nur aus dem
 * Vergleich entsteht: unterscheidet sich ein geschütztes Feld zwischen `before`
 * und `after`, trägt `after` `"*** (geändert)"` statt `"***"`.
 *
 * Der Marker gilt nur für die oberste Ebene. Das ist kein Versehen: `before`
 * und `after` sind Tabellenzeilen, also flach; ein verschachteltes jsonb-Feld
 * (`application`, `vat_check_log`, `condition_snapshot`) ist entweder ohnehin
 * geschützt oder wird als Ganzes ersetzt, und ein Marker je Blattknoten wäre
 * eine Genauigkeit, die niemand liest.
 *
 * Exportiert, damit die Redaktion ohne Datenbank prüfbar ist (`server-only`
 * ist in Vitest auf ein leeres Stub-Modul aliasiert, siehe vitest.config.ts).
 */
export function redactAuditPayloads(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown> | null; after: Record<string, unknown> | null } {
  const redactedBefore = before ? redactObject(before, 0) : null;
  const redactedAfter = after ? redactObject(after, 0) : null;

  if (before && after && redactedAfter) {
    for (const key of Object.keys(after)) {
      if (!isRedactedAuditKey(key)) continue;
      if (redactedAfter[key] === null && (before[key] ?? null) === null) continue;
      if (!isSameValue(before[key], after[key])) {
        redactedAfter[key] = AFFILIATE_AUDIT_REDACTED_CHANGED;
      }
    }
  }

  return { before: redactedBefore, after: redactedAfter };
}

// --- Schreiben ----------------------------------------------------------

/**
 * `affiliate_audit_log.action` hat in der Datenbank bewusst kein CHECK, weil
 * die Liste der Vorgänge mit jedem Block wächst. Damit daraus kein Freitextfeld
 * wird, in dem irgendwann ein deutscher Satz oder gar eine Nutzereingabe
 * landet, gilt hier die Konvention aus types.ts als Muster: `<gegenstand>.<verb>`
 * in Englisch, klein, z. B. `partner.approve`, `commission.flag`,
 * `payout.mark_paid`.
 */
export const AFFILIATE_AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export type AffiliateAuditEntry = {
  /** Immer aus einem Gate (access.ts), nie aus einer client-gelieferten ID. */
  tenantId: string;
  actorKind: AffiliateAuditActorKind;
  /** `null` bei `actor_kind = 'system'` (Cron-Verarbeiter, Webhook-Outbox). */
  actorUserId?: string | null;
  entity: AffiliateAuditEntity;
  entityId?: string | null;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

/**
 * Schreibt einen Protokolleintrag. Wirft, wenn der Eintrag nicht geschrieben
 * werden konnte — bewusst kein stilles `console.error` und weiter im Text: das
 * ist genau der Fehler, den G1/G2 an der Marketplace-Erfüllung benennen
 * (`src/lib/marketplace/fulfil.ts:229-231`, Zeile dauerhaft verloren). Ein
 * Prüfpfad mit Lücken, die niemand bemerkt, ist keiner.
 *
 * Aufrufreihenfolge in einer Server Action: erst die Änderung, dann der
 * Eintrag, beides im selben `try` — schlägt das Protokoll fehl, sieht der
 * Mensch eine Fehlermeldung und der Vorgang gilt als unvollständig. Wer davon
 * abweichen muss, fängt den Fehler ausdrücklich und begründet das an der
 * Aufrufstelle.
 *
 * Die rohe Fehlermeldung erreicht weder die Oberfläche noch das Log
 * (CLAUDE.md §2.11/§2.15): protokolliert werden nur der SQLSTATE-Code und der
 * Vorgangsname, beide ohne Werte.
 */
export async function writeAuditEntry(entry: AffiliateAuditEntry): Promise<void> {
  if (!AFFILIATE_AUDIT_ACTION_PATTERN.test(entry.action)) {
    // Programmierfehler, kein Nutzerfehler — fällt in Tests und Review auf,
    // bevor ein unbrauchbarer Vorgangsname dauerhaft im Protokoll steht.
    throw new Error(`Ungültiger Audit-Vorgang: ${entry.action}`);
  }

  const { before, after } = redactAuditPayloads(entry.before, entry.after);

  const admin = createAdminClient();
  const { error } = await admin.from("affiliate_audit_log").insert({
    tenant_id: entry.tenantId,
    actor_user_id: entry.actorUserId ?? null,
    actor_kind: entry.actorKind,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    action: entry.action,
    before,
    after,
  });

  if (error) {
    console.error("[affiliate-audit] Eintrag nicht geschrieben", {
      code: error.code,
      action: entry.action,
      entity: entry.entity,
    });
    throw new Error("Der Vorgang konnte nicht protokolliert werden.");
  }
}
