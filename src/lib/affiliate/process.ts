import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CALENDAR_TIME_ZONE, shiftIsoDate } from "@/lib/calendar/date";
import { detectSelfReferral } from "@/lib/affiliate/attribution";
import {
  buildDedupKey,
  computeBaseCents,
  computeCommissionParts,
  computeTier2Cents,
  resolveCondition,
  type AffiliateConditionCandidate,
} from "@/lib/affiliate/compute";
import type { AffiliateEventPayload } from "@/lib/affiliate/intake";
import {
  recreditForWonDispute,
  reverseForDispute,
  reverseForRefund,
  type AffiliateReversalResult,
} from "@/lib/affiliate/reversal";
import type {
  AffiliateBasisKind,
  AffiliateCancelReason,
  AffiliateCommissionKind,
  AffiliateCommissionStatus,
  AffiliateConditionSnapshot,
  AffiliateProgramRow,
  AffiliateRateKind,
  AffiliateRecurringMode,
} from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B4 — der VERARBEITER
 * (PLAN_Affiliate-System.md 6.5 und 6.6, Rechenregeln 5.1 bis 5.7,
 * Grundsatzentscheidungen G1, G3, G5, G12, G13, G14).
 *
 * `processAffiliateQueue()` läuft als vierte Warteschlange im bestehenden
 * `Promise.all` von `src/app/api/admin/ki/process/route.ts:48-56`, alle zwei
 * Minuten. Kein zweiter Cron-Trigger — er holte die dort dokumentierte
 * 522-Fehlerklasse zurück (9.7).
 *
 * ## Was hier NICHT passiert: rechnen
 *
 * Die Rechenregeln stehen vollständig in `compute.ts` und sind dort ohne
 * Datenbank getestet. Diese Datei liefert die Eingaben, schreibt das Ergebnis
 * und entscheidet über den Zustand des Ereignisses — sie rechnet keine
 * Provision nach. Wer hier eine Multiplikation findet, hat einen Fehler
 * gefunden.
 *
 * ## Die fünf Schritte (6.5), jeder einzeln idempotent und gedeckelt
 *
 *   1. Ereignisse verarbeiten (max. 20)
 *   2. Freigabelauf (max. 500, 6.4)
 *   3. Tagesaggregation (Vortag + laufender Tag je Mandant mit Aktivität)
 *   4. Auszahlungsentwürfe (7.1) — siehe Kasten „Schritt 4" unten
 *   5. Datenläufe: Klickzeilen > 90 Tage, ungebundene Zuordnungen
 *
 * Ein Lauf, der am Zeitbudget abbricht, wird zwei Minuten später fortgesetzt;
 * das Ergebnis jedes Schritts wird als JSON zurückgegeben und landet im
 * Cloudflare-Cron-Log.
 *
 * ## Warten ist ein gültiger Zustand (6.6)
 *
 * Stripe liefert Ereignisse mehrfach und nicht in Reihenfolge. Der Verarbeiter
 * ist dagegen immun, weil er nicht auf Reihenfolge, sondern auf VORHANDENSEIN
 * prüft: fehlt für ein `invoice.paid` die Bindungszeile, bleibt das Ereignis
 * `pending` mit `last_error='binding_missing'` und wird im nächsten Tick
 * erneut versucht; nach fünf Versuchen wechselt es auf `error` und erscheint
 * in der Admin-Oberfläche. Das ist der eigentliche Gewinn der Outbox gegenüber
 * einem 500 gegen Stripe.
 *
 * ## Vertrag mit der B4-Migration (die vier RPCs)
 *
 * Diese Datei ruft vier Datenbankfunktionen, die zur selben Blockhälfte
 * gehören. Der Vertrag steht hier, damit beide Seiten dieselbe Form meinen:
 *
 *   `book_affiliate_commissions(jsonb) -> jsonb`
 *      Eingabe  `{ tenant_id, program_id, rows: [ … ] }`. Jede Zeile trägt
 *               zusätzlich zu ihren Spalten ein `ref` (Bezeichner innerhalb
 *               des Aufrufs) und optional ein `parent_ref` auf das `ref` einer
 *               anderen Zeile DESSELBEN Aufrufs; die Funktion löst es in
 *               `parent_id` auf, nachdem sie die Elternzeile eingefügt hat.
 *      Schreibt alle Zeilen in EINER Transaktion, jede mit
 *               `on conflict (tenant_id, dedup_key) do nothing` (G3).
 *      Rückgabe `{ inserted, existing, rows: [ { ref, id, dedup_key, inserted } ] }`
 *               — `inserted` ist `false`, wenn die Zeile schon existierte;
 *               `id` ist dann die der BESTEHENDEN Zeile, damit ein Retry
 *               dieselben Verweise auflöst und keine zweite Zeilengruppe
 *               entsteht.
 *      Verlangt   zusätzlich `lock_key` — den VORGANG, nicht die Zeile. Darauf
 *               liegt der `pg_advisory_xact_lock`, der zwei gleichzeitige
 *               Verarbeitungen desselben Vorgangs serialisiert; fehlt er,
 *               wirft die Funktion `affiliate_book_payload_incomplete`.
 *
 *   `approve_due_affiliate_commissions(int) -> jsonb`
 *      Das eine bedingte UPDATE aus 6.4, damit zwei gleichzeitige Cron-Ticks
 *      nicht doppelt freigeben. Rückgabe
 *      `{ approved, limit, rows: [ { id, tenant_id, partner_id, … } ] }`.
 *
 *   `affiliate_clicks_purge(int, int) -> integer` (liegt vor, B3)
 *   `affiliate_referrals_purge(int, int) -> integer` (LIEGT NOCH NICHT VOR)
 *      Wie `affiliate_clicks_purge()` (Migration 20260911120000, 5.3):
 *      `security definer`, weil der Guard auf `affiliate_referrals`
 *      `service_role` das Löschen ausdrücklich verbietet und die Kaskade nur
 *      über `pg_trigger_depth() > 1` freigibt. Ohne diese Funktion gibt es
 *      keinen Weg, die Frist einzuhalten — der Lauf meldet das dann als
 *      Fehlschlag im Cron-Log, statt still nichts zu tun. Der Aufruf steht
 *      deshalb ABSICHTLICH schon hier: er ist die sichtbare Schuld.
 *
 * Fehlt eine dieser Funktionen, scheitert AUSSCHLIESSLICH ihr Schritt; der
 * Lauf geht weiter. Ein fehlender Aufräumlauf darf keine Buchung kosten.
 *
 * Den Zähler der Abo-Bindung (3.9) setzt diese Datei ohne RPC hoch — die
 * Begründung steht an `claimSubscriptionPeriod()`.
 */

type Admin = ReturnType<typeof createAdminClient>;

// --- Deckel und Fristen -------------------------------------------------

/** Ereignisse je Lauf (6.5 Schritt 1). */
export const AFFILIATE_EVENT_BATCH_SIZE = 20;
/** Danach wechselt ein wartendes Ereignis auf `error` und wird sichtbar (6.6). */
export const AFFILIATE_EVENT_MAX_ATTEMPTS = 5;
/** Zeilen je Freigabelauf (6.4, CPU-Zeit-Grenze des Workers). */
export const AFFILIATE_APPROVAL_LIMIT = 500;
/** Zeilen je Datenlauf (6.5 Schritt 5). */
export const AFFILIATE_PURGE_LIMIT = 5000;
/** Aufbewahrung der Klickzeilen (3.6). */
export const AFFILIATE_CLICK_RETENTION_DAYS = 90;
/**
 * Nachlauf für ungebundene Zuordnungen: `expires_at` trägt bereits
 * `cookie_ttl_days`, hier kommen die 30 Tage aus 6.5 obendrauf.
 */
export const AFFILIATE_REFERRAL_GRACE_DAYS = 30;
/**
 * Eigenes Zeitbudget (9.7). Wird es überschritten, bricht der Lauf ZWISCHEN
 * zwei Schritten ab und meldet `truncated: true` — damit die drei
 * KI-Warteschlangen im selben `Promise.all` nicht mitleiden.
 */
export const AFFILIATE_QUEUE_TIME_BUDGET_MS = 8_000;
/**
 * Mandanten je Aggregationslauf. Der Schritt ist idempotent und wiederholt
 * sich alle zwei Minuten; ein Deckel kostet also höchstens Aktualität.
 */
export const AFFILIATE_STATS_TENANT_LIMIT = 25;
/**
 * Fenster, in dem ein Mandant als „aktiv seit dem letzten Lauf" gilt.
 * Großzügig gegenüber dem Zwei-Minuten-Takt, damit ein ausgefallener Tick
 * keine Lücke in der Tagesaggregation hinterlässt; doppelt gerechnete Tage
 * sind folgenlos, weil der Schritt überschreibt statt zu addieren.
 */
export const AFFILIATE_STATS_LOOKBACK_MS = 30 * 60 * 1000;

// --- Ergebnisform -------------------------------------------------------

export type AffiliateEventStepResult = {
  picked: number;
  done: number;
  skipped: number;
  /** Bleibt `pending` und wird erneut versucht (Warten ist gültig, 6.6). */
  deferred: number;
  error: number;
};

export type AffiliateQueueResult = {
  events: AffiliateEventStepResult;
  approved: number;
  stats: { tenants: number; rows: number };
  payouts: { drafted: number; pending: boolean };
  cleanup: { clicks: number; referrals: number };
  /** Zeitbudget erschöpft, der Rest folgt im nächsten Tick. */
  truncated: boolean;
};

// --- Kurze, stabile Kennungen statt Fehlertexten ------------------------

/**
 * `affiliate_events.last_error` ist eine KENNUNG, kein Fließtext (6.5,
 * „kurze, stabile Kennung (redigiert)"). Zwei Gründe: die Admin-Oberfläche
 * gruppiert danach, und eine durchgereichte PostgREST-Meldung trüge bei einer
 * Constraint-Verletzung den Schlüsselwert im Klartext — hier also
 * Bestellnummern und Referral-Token (CLAUDE.md §2.11, Plan 11.11).
 */
export const AFFILIATE_EVENT_REASONS = [
  /** Kein Programm für diesen Mandanten — der Mandant nutzt das Modul nicht. */
  "no_program",
  /** Programm ist `draft`/`paused`: Pause staut, verliert nicht, zählt nicht hoch. */
  "program_inactive",
  /** Keine Zuordnung an diesem Kauf (Hausverkauf). */
  "no_attribution",
  /** Mandant über `payment_intent`/`invoice` nicht auflösbar (kein Affiliate-Bezug). */
  "tenant_unresolved",
  /** Die Bestellung zur Aufnahme fehlt (noch). */
  "order_missing",
  /** Das Token der Aufnahme zeigt auf keine Zuordnungszeile. */
  "referral_missing",
  /** Die Zuordnung zeigt auf keinen Partner. */
  "partner_missing",
  /** `invoice.paid` vor `checkout.session.completed` — Warten, nicht verlieren (6.6). */
  "binding_missing",
  /** Erste Rate eines Abos; die hat der Checkout bereits gebucht (5.7). */
  "subscription_create",
  /** Rechnung ohne Abo-Bezug. */
  "no_subscription",
  /** Abo-Deckel erreicht oder Abo beendet (5.7). */
  "recurring_exhausted",
  /** Ein anderer Lauf hat dieselbe Rate genommen — warten, nicht verwerfen (3.9). */
  "counter_conflict",
  /** Währung der Rate weicht von der eingefrorenen Abo-Währung ab (5.11). */
  "currency_mismatch",
  /** Die Ursprungszeile mit dem Satz-Schnappschuss fehlt (5.7). */
  "origin_missing",
  /** Die Buchungs-RPC hat abgelehnt. */
  "booking_failed",
  /** Eine Leseabfrage ist fehlgeschlagen. */
  "db_error",
  /**
   * HISTORISCH. Zwischen B4 und B5 hatten `charge.refunded` und die beiden
   * Dispute-Ereignisse noch keinen Verarbeiter und wurden mit diesem Grund
   * zurückgestellt. Seit B5 werden sie behandelt; der Grund bleibt in der
   * Liste, weil er in `affiliate_events.last_error` bereits gebuchter Zeilen
   * steht und die Admin-Oberfläche ihn weiter auflösen können muss. Solche
   * Zeilen holt `POST /api/admin/affiliate/reprocess` in einem Zug nach (6.6).
   */
  "handler_missing",
  /** Ereignisart, die dieses Modul nicht verarbeitet. */
  "unsupported_event",
  /** Unerwarteter Fehler im Verarbeiter (Giftzeile). */
  "unexpected",
] as const;
export type AffiliateEventReason = (typeof AFFILIATE_EVENT_REASONS)[number];

/**
 * Was mit dem Ereignis geschieht.
 *
 * `defer` heißt: die Zeile bleibt `pending` und wird erneut versucht.
 * `releaseAttempt` gibt den Versuch zusätzlich zurück — das ist der Fall
 * „Programm pausiert" aus 6.5 c: die Pause staut, verliert nicht und zählt
 * nicht hoch. Bei allen anderen Wartegründen zählt der Versuch, damit ein
 * dauerhaft unerfüllbares Ereignis nach fünf Versuchen sichtbar wird und
 * nicht für immer im Stapel mitfährt.
 */
type EventOutcome =
  | { kind: "done" }
  | { kind: "skipped"; reason: AffiliateEventReason }
  | { kind: "defer"; reason: AffiliateEventReason; releaseAttempt?: boolean }
  | { kind: "error"; reason: AffiliateEventReason };

const DONE: EventOutcome = { kind: "done" };

// --- Spaltenlisten (nie `select("*")`) ----------------------------------

/**
 * Das SELECT-Recht auf `affiliate_partners`, `affiliate_conditions` und
 * `affiliate_referrals` ist ein SPALTEN-Grant (Migrationen 20260910120000 und
 * 20260911120000). `select("*")` bricht dort mit 42501 ab, sobald dieselbe
 * Abfrage später mit dem Session-Client wiederverwendet wird. Jede Abfrage
 * benennt ihre Spalten — und holt ohnehin nur, was sie braucht.
 */
const EVENT_COLUMNS =
  "id, stripe_event_id, event_type, tenant_id, order_id, stripe_invoice_id, " +
  "stripe_subscription_id, stripe_charge_id, stripe_payment_intent, referral_token, " +
  "payload, occurred_at, status, attempts";

const PROGRAM_COLUMNS =
  "id, tenant_id, status, rate_kind, rate_bp, fixed_cents, min_commission_cents, " +
  "max_commission_cents, basis_kind, fee_deduction_bp, currency, self_referral, " +
  "recurring_mode, recurring_max_periods, tier2_enabled, tier2_basis, tier2_rate_bp, " +
  "hold_days, reserve_bp, reserve_days, test_mode";

const PARTNER_COLUMNS =
  "id, tenant_id, program_id, user_id, applicant_email, status, group_id, referred_by";

const CONDITION_COLUMNS =
  "id, partner_id, group_id, product_id, rate_kind, rate_bp, fixed_cents, valid_from, valid_to";

const REFERRAL_COLUMNS = "id, tenant_id, program_id, partner_id, campaign";

const ORDER_COLUMNS = "id, tenant_id, user_id, product_id, amount_cents, currency";

const BINDING_COLUMNS =
  "stripe_subscription_id, tenant_id, program_id, partner_id, referral_id, " +
  "origin_commission_id, recurring_mode, max_periods, periods_booked, currency, ended_at";

const ORIGIN_COLUMNS =
  "id, tenant_id, program_id, partner_id, product_id, campaign, referral_id, " +
  "condition_id, condition_snapshot, currency";

// --- Zeilenformen -------------------------------------------------------

type EventRow = {
  id: string;
  stripe_event_id: string;
  event_type: string;
  tenant_id: string | null;
  order_id: string | null;
  stripe_invoice_id: string | null;
  stripe_subscription_id: string | null;
  stripe_charge_id: string | null;
  stripe_payment_intent: string | null;
  referral_token: string | null;
  payload: AffiliateEventPayload | null;
  occurred_at: string;
  status: string;
  attempts: number;
};

type ProgramRow = Pick<
  AffiliateProgramRow,
  | "id"
  | "tenant_id"
  | "status"
  | "rate_kind"
  | "rate_bp"
  | "fixed_cents"
  | "min_commission_cents"
  | "max_commission_cents"
  | "basis_kind"
  | "fee_deduction_bp"
  | "currency"
  | "self_referral"
  | "recurring_mode"
  | "recurring_max_periods"
  | "tier2_enabled"
  | "tier2_basis"
  | "tier2_rate_bp"
  | "hold_days"
  | "reserve_bp"
  | "reserve_days"
  | "test_mode"
>;

type PartnerRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  user_id: string | null;
  applicant_email: string | null;
  status: string;
  group_id: string | null;
  referred_by: string | null;
};

type ReferralRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  partner_id: string;
  campaign: string | null;
};

type OrderRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  product_id: string | null;
  amount_cents: number | null;
  currency: string | null;
};

type SubscriptionBindingRow = {
  stripe_subscription_id: string;
  tenant_id: string;
  program_id: string;
  partner_id: string;
  referral_id: string | null;
  origin_commission_id: string | null;
  recurring_mode: AffiliateRecurringMode;
  max_periods: number;
  periods_booked: number;
  currency: string;
  ended_at: string | null;
};

type OriginCommissionRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  partner_id: string;
  product_id: string | null;
  campaign: string | null;
  referral_id: string | null;
  condition_id: string | null;
  condition_snapshot: AffiliateConditionSnapshot | null;
  currency: string;
};

// --- Die Buchungs-Nutzlast (Vertrag mit `book_affiliate_commissions`) ---

/**
 * Eine zu buchende Zeile. `ref` und `parent_ref` existieren ausschließlich
 * INNERHALB eines Aufrufs: eine Reserve-Zeile braucht `parent_id` (CHECK in
 * 3.11), und die Kennung ihrer `sale`-Zeile entsteht erst beim Einfügen.
 */
export type AffiliateBookingRow = {
  ref: string;
  kind: AffiliateCommissionKind;
  partner_id: string;
  parent_ref: string | null;
  order_id: string | null;
  stripe_invoice_id: string | null;
  stripe_subscription_id: string | null;
  stripe_charge_id: string | null;
  product_id: string | null;
  campaign: string | null;
  referral_id: string | null;
  parent_id: string | null;
  base_cents: number;
  basis_kind: AffiliateBasisKind;
  rate_kind: AffiliateRateKind;
  rate_bp: number;
  fixed_cents: number;
  amount_cents: number;
  currency: string;
  condition_id: string | null;
  condition_snapshot: AffiliateConditionSnapshot;
  status: AffiliateCommissionStatus;
  cancel_reason: AffiliateCancelReason | null;
  hold_until: string;
  flagged: boolean;
  flag_reason: string | null;
  is_test: boolean;
  note: string | null;
  dedup_key: string;
};

export type AffiliateBookingRequest = {
  tenant_id: string;
  program_id: string;
  /**
   * Der Sperrschlüssel des VORGANGS (`order:<id>`, `invoice:<id>`,
   * `tier2:<parent_id>`). Die RPC legt darauf einen
   * `pg_advisory_xact_lock` und serialisiert damit zwei gleichzeitige
   * Verarbeitungen desselben Vorgangs; ohne ihn wirft sie
   * `affiliate_book_payload_incomplete`
   * (Migration 20260911130000, Abschnitt 4).
   *
   * Bewusst der Vorgang und nicht der `dedup_key` einer einzelnen Zeile: die
   * Sperre soll den ganzen Stapel zusammenhalten, und die Zeilen eines
   * Stapels tragen verschiedene Schlüssel.
   */
  lock_key: string;
  rows: AffiliateBookingRow[];
};

export type AffiliateBookedRow = {
  ref: string;
  id: string;
  dedup_key: string;
  /**
   * `false` = die Zeile existierte bereits (Retry, G3). Der Feldname ist der
   * der RPC-Rückgabe (`inserted`), nicht einer, der hier neu erfunden wird.
   */
  inserted: boolean;
};

// --- Kleine Helfer ------------------------------------------------------

/**
 * Protokolliert einen Datenbankfehler OHNE Nutzlast und ohne `error.message`
 * (CLAUDE.md §2.11): die PostgREST-Meldung trägt bei einer
 * Constraint-Verletzung den Schlüsselwert im Klartext — hier Bestellnummern,
 * Rechnungskennungen und Referral-Token.
 */
function logDbError(context: string, error: { code?: string } | null): void {
  console.error(
    `[affiliate/process] ${context} fehlgeschlagen (Code ${error?.code ?? "unbekannt"}).`,
  );
}

/** Eine Frist in Tagen ab einem Zeitpunkt, als ISO-Zeitstempel. */
function addDaysIso(fromIso: string, days: number): string {
  const base = Date.parse(fromIso);
  const anchor = Number.isNaN(base) ? Date.now() : base;
  return new Date(anchor + Math.max(0, Math.trunc(days)) * 86_400_000).toISOString();
}

/**
 * Der BERICHTSTAG in `Europe/Berlin` — dieselbe Tagesgrenze wie
 * `public.affiliate_stats_day()` (Migration 20260911120000, 5.1). Die
 * Zeitzone ist keine neue Entscheidung, sondern die des Hauses
 * (`CALENDAR_TIME_ZONE`).
 *
 * NICHT zu verwechseln mit dem UTC-Tag in `hash.ts`: der bestimmt die
 * Rotation des IP-Salzes und ist dort zu Recht UTC. Wer beides
 * „vereinheitlicht", bricht entweder die Entdopplung oder die Tagesgrenze der
 * Auswertung.
 */
function berlinDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Der Rechenweg, wie er eingefroren in jeder Zeile steht (3.11, 5.7). */
function buildSnapshot(
  program: ProgramRow,
  resolution: { condition_id: string | null; source: "condition" | "program_default"; rate_kind: AffiliateRateKind; rate_bp: number; fixed_cents: number },
): AffiliateConditionSnapshot {
  return {
    condition_id: resolution.condition_id,
    source: resolution.source,
    rate_kind: resolution.rate_kind,
    rate_bp: resolution.rate_bp,
    fixed_cents: resolution.fixed_cents,
    basis_kind: program.basis_kind,
    fee_deduction_bp: program.fee_deduction_bp,
    min_commission_cents: program.min_commission_cents,
    max_commission_cents: program.max_commission_cents,
    reserve_bp: program.reserve_bp,
    hold_days: program.hold_days,
    reserve_days: program.reserve_days,
    tier2_enabled: program.tier2_enabled,
    tier2_basis: program.tier2_basis,
    tier2_rate_bp: program.tier2_rate_bp,
  };
}

/** Vorlage für eine Buchungszeile; die Aufrufer überschreiben, was sie betrifft. */
function emptyBookingRow(): Omit<AffiliateBookingRow, "ref" | "kind" | "partner_id" | "amount_cents" | "dedup_key" | "hold_until" | "condition_snapshot"> {
  return {
    parent_ref: null,
    order_id: null,
    stripe_invoice_id: null,
    stripe_subscription_id: null,
    stripe_charge_id: null,
    product_id: null,
    campaign: null,
    referral_id: null,
    parent_id: null,
    base_cents: 0,
    basis_kind: "net",
    rate_kind: "percent",
    rate_bp: 0,
    fixed_cents: 0,
    currency: "eur",
    condition_id: null,
    status: "pending",
    cancel_reason: null,
    flagged: false,
    flag_reason: null,
    is_test: false,
    note: null,
  };
}

// --- Die vier RPC-Aufrufe ----------------------------------------------

/**
 * Bucht eine Gruppe zusammengehörender Zeilen in EINER Transaktion.
 *
 * ABWEICHUNG vom Plan-Wortlaut („EIN Aufruf, alle Zeilen atomar", 6.5 d):
 * eine `tier2`-Zeile folgt in einem ZWEITEN Aufruf. Ihr `dedup_key` ist
 * `tier2:<parent_id>` (3.11) und hängt damit an der Kennung der `sale`-Zeile,
 * die erst beim Einfügen entsteht. Die Alternativen sind beide schlechter:
 * den Schlüssel in der RPC zusammenbauen hieße, die eine Stelle aufzugeben,
 * an der Schlüssel entstehen (`buildDedupKey()`, G3); die Kennung im
 * Anwendungscode vorzugeben bräche beim Retry, weil dann eine ANDERE
 * Kennung entstünde als die der bereits vorhandenen Elternzeile — und die
 * Zweitstufe hinge an einer Zeile, die es nicht gibt.
 *
 * Die tragende Gruppe (`sale` + `reserve` bzw. `recurring` +
 * `recurring_reserve`) bleibt atomar; das ist der Teil, bei dem eine halbe
 * Buchung den Saldo verfälschte. Bleibt die Zweitstufe aus, wiederholt der
 * nächste Lauf das Ereignis: die erste Gruppe fällt in `do nothing`, die
 * Zweitstufe entsteht nach. Beides ist über `unique (tenant_id, dedup_key)`
 * idempotent.
 */
async function bookAffiliateRows(
  admin: Admin,
  request: AffiliateBookingRequest,
): Promise<AffiliateBookedRow[]> {
  const { data, error } = await admin.rpc("book_affiliate_commissions", {
    p_payload: request,
  });

  if (error) {
    logDbError("book_affiliate_commissions", error);
    throw new Error("booking_failed");
  }

  const rows = (data as { rows?: AffiliateBookedRow[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Das Ergebnis des Zähler-Anspruchs aus 3.9.
 *
 *   `claimed`   — die Rate gehört diesem Lauf, es darf gebucht werden;
 *   `exhausted` — Deckel erreicht oder Abo beendet, es wird nie gebucht;
 *   `conflict`  — ein anderer Lauf war schneller; das Ereignis WARTET und
 *                 wird im nächsten Tick erneut versucht. Dann greift die
 *                 Vorprüfung auf den `dedup_key` und meldet `done`.
 */
type SubscriptionClaim = "claimed" | "exhausted" | "conflict";

/**
 * Der bedingte Zähler-Update aus 3.9.
 *
 * ABWEICHUNG VOM PLAN-WORTLAUT, mit Anlass. 3.9 schreibt ein einzelnes
 * SQL-Statement vor („Der Zähler wird nie in TypeScript gelesen und dann
 * geschrieben"), und der Dateikopf hat dafür eine RPC
 * `affiliate_claim_subscription_period` angekündigt. Die B4-Migration
 * (20260911130000) legt diese Funktion NICHT an — sie kennt nur
 * `book_affiliate_commissions` und `approve_due_affiliate_commissions`. Ein
 * Aufruf ins Leere hieße: keine einzige Abo-Folgerate wird je gebucht, und
 * zwar still, weil der Fehler nur im Cron-Log steht.
 *
 * Statt in eine fremde Migrationsdatei zu schreiben, steht hier dasselbe
 * Statement als Compare-and-Swap über PostgREST — Muster `markPayoutPaid()`
 * (`src/lib/platform/marketplace.ts:561`):
 *
 *   update … set periods_booked = <gelesen> + 1
 *    where stripe_subscription_id = $1
 *      and periods_booked = <gelesen>      ← die Bedingung, die zählt
 *      and ended_at is null
 *
 * Die Sorge aus 3.9 ist damit erfüllt und nicht bloß umgangen: zwei
 * gleichzeitig zugestellte `invoice.paid` lesen denselben Stand, aber nur
 * EINE der beiden Anweisungen findet ihn noch vor — die andere trifft null
 * Zeilen und bucht nicht. Ein blindes `read, then write` wäre genau das, was
 * der Plan verbietet; ein CAS ist es nicht. Der Deckel wird auf dem
 * GELESENEN Stand geprüft, was zulässig ist, weil der CAS genau diesen Stand
 * festnagelt.
 *
 * Nebeneffekt gegenüber der geplanten RPC: dort verbrauchten zwei
 * gleichzeitige Zustellungen derselben Rechnung ZWEI Perioden (beide
 * Statements erhöhen, nur eine Zeile entsteht). Hier verbraucht die
 * Doppelzustellung eine.
 *
 * B5/B8 dürfen die RPC nachreichen; dann tritt sie an genau diese Stelle.
 */
async function claimSubscriptionPeriod(
  admin: Admin,
  binding: SubscriptionBindingRow,
): Promise<SubscriptionClaim> {
  // 5.7: `first_only` nach der ersten Rate, `n_periods` nach der letzten,
  // beendetes Abo — in allen drei Fällen wird nicht gebucht.
  if (binding.ended_at !== null) return "exhausted";
  if (binding.recurring_mode !== "all" && binding.periods_booked >= binding.max_periods) {
    return "exhausted";
  }

  const { data, error } = await admin
    .from("affiliate_subscription_bindings")
    .update({ periods_booked: binding.periods_booked + 1 })
    .eq("stripe_subscription_id", binding.stripe_subscription_id)
    .eq("periods_booked", binding.periods_booked)
    .is("ended_at", null)
    .select("stripe_subscription_id");

  if (error) {
    logDbError("Abo-Zähler hochsetzen", error);
    throw new Error("db_error");
  }
  return Array.isArray(data) && data.length > 0 ? "claimed" : "conflict";
}

// --- Schritt 1: Ereignisse verarbeiten (6.5) ----------------------------

/**
 * Schritt 1b: den Mandanten nachtragen. Für `charge.refunded` und die
 * Dispute-Ereignisse ist er zum Aufnahmezeitpunkt nicht bekannt — ein
 * `Stripe.Charge` trägt keine Session-Metadata (3.10).
 *
 * Zwei Brücken, in dieser Reihenfolge:
 *   `charge.payment_intent` → `orders.stripe_payment_intent` (eindeutig seit 3.0c)
 *   `charge.invoice`        → `affiliate_commissions.stripe_invoice_id`
 *
 * Die zweite Brücke zeigt auf eine Zeile, die nur existiert, wenn zu dieser
 * Rechnung überhaupt schon eine Provision gebucht wurde — genau die Fälle,
 * für die sich die Auflösung lohnt.
 */
async function resolveEventTenant(
  admin: Admin,
  row: EventRow,
): Promise<{ tenantId: string; orderId: string | null } | null> {
  if (row.stripe_payment_intent !== null) {
    const { data, error } = await admin
      .from("orders")
      .select("id, tenant_id")
      .eq("stripe_payment_intent", row.stripe_payment_intent)
      .maybeSingle<{ id: string; tenant_id: string }>();
    if (error) {
      logDbError("Mandant über payment_intent auflösen", error);
      throw new Error("db_error");
    }
    if (data) return { tenantId: data.tenant_id, orderId: data.id };
  }

  if (row.stripe_invoice_id !== null) {
    const { data, error } = await admin
      .from("affiliate_commissions")
      .select("tenant_id")
      .eq("stripe_invoice_id", row.stripe_invoice_id)
      .limit(1)
      .maybeSingle<{ tenant_id: string }>();
    if (error) {
      logDbError("Mandant über Rechnung auflösen", error);
      throw new Error("db_error");
    }
    if (data) return { tenantId: data.tenant_id, orderId: null };
  }

  return null;
}

/** Das Programm des Mandanten (`unique (tenant_id)`, 3.2). */
async function loadProgram(admin: Admin, tenantId: string): Promise<ProgramRow | null> {
  const { data, error } = await admin
    .from("affiliate_programs")
    .select(PROGRAM_COLUMNS)
    .eq("tenant_id", tenantId)
    .maybeSingle<ProgramRow>();
  if (error) {
    logDbError("Programm laden", error);
    throw new Error("db_error");
  }
  return data ?? null;
}

/**
 * Die Konditionen des Programms. Gefiltert wird nur nach Mandant und
 * Programm; die Vorrangkette (5.2) entscheidet `resolveCondition()` als reine
 * Funktion — die sechs Spezifitätsstufen und die Fenstergrenzen sind dort
 * ohne Datenbank geprüft.
 */
async function loadConditions(
  admin: Admin,
  tenantId: string,
  programId: string,
): Promise<AffiliateConditionCandidate[]> {
  const { data, error } = await admin
    .from("affiliate_conditions")
    .select(CONDITION_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("program_id", programId)
    .limit(1000);
  if (error) {
    logDbError("Konditionen laden", error);
    throw new Error("db_error");
  }
  return (data ?? []) as AffiliateConditionCandidate[];
}

/**
 * Die Zweitstufe (5.5): sie entsteht nur, wenn der Partner geworben wurde UND
 * der Werber `active` ist. Beides wird hier geprüft und als EIN Schalter an
 * `computeTier2Cents()` gereicht.
 */
async function loadActiveReferrer(
  admin: Admin,
  tenantId: string,
  referredBy: string | null,
): Promise<PartnerRow | null> {
  if (referredBy === null) return null;
  const { data, error } = await admin
    .from("affiliate_partners")
    .select(PARTNER_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", referredBy)
    .maybeSingle<PartnerRow>();
  if (error) {
    logDbError("Werber laden", error);
    throw new Error("db_error");
  }
  return data && data.status === "active" ? data : null;
}

/**
 * Bucht die Zweitstufe nach, wenn eine entsteht. Getrennter Aufruf, siehe die
 * Begründung an `bookAffiliateRows()`.
 */
async function bookTier2(
  admin: Admin,
  params: {
    program: ProgramRow;
    parentKind: AffiliateCommissionKind;
    parentId: string;
    referrer: PartnerRow;
    snapshot: AffiliateConditionSnapshot;
    baseCents: number;
    commissionCents: number;
    currency: string;
    holdUntil: string;
    isTest: boolean;
    status: AffiliateCommissionStatus;
    cancelReason: AffiliateCancelReason | null;
    origin: Pick<AffiliateBookingRow, "order_id" | "stripe_invoice_id" | "stripe_subscription_id" | "product_id" | "campaign" | "referral_id">;
  },
): Promise<void> {
  const amount = computeTier2Cents({
    enabled: params.snapshot.tier2_enabled,
    referrer_active: true,
    parent_kind: params.parentKind,
    basis: params.snapshot.tier2_basis,
    rate_bp: params.snapshot.tier2_rate_bp,
    base_cents: params.baseCents,
    commission_cents: params.commissionCents,
  });
  if (amount <= 0) return;

  await bookAffiliateRows(admin, {
    tenant_id: params.program.tenant_id,
    program_id: params.program.id,
    // Eigener Vorgang: die Zweitstufe folgt in einem zweiten Aufruf (siehe
    // `bookAffiliateRows()`), und sie hängt an der Kennung der Elternzeile.
    lock_key: `tier2:${params.parentId}`,
    rows: [
      {
        ...emptyBookingRow(),
        ...params.origin,
        ref: "tier2",
        kind: "tier2",
        partner_id: params.referrer.id,
        parent_id: params.parentId,
        base_cents: params.baseCents,
        basis_kind: params.snapshot.basis_kind,
        // Die Zweitstufe ist IMMER prozentual auf ihre eigene Bezugsgröße —
        // `rate_kind='fixed'` gibt es dort nicht (5.5).
        rate_kind: "percent",
        rate_bp: params.snapshot.tier2_rate_bp,
        fixed_cents: 0,
        amount_cents: amount,
        currency: params.currency,
        condition_snapshot: params.snapshot,
        status: params.status,
        cancel_reason: params.cancelReason,
        hold_until: params.holdUntil,
        is_test: params.isTest,
        dedup_key: buildDedupKey({ kind: "tier2", parent_id: params.parentId }),
      },
    ],
  });
}

/**
 * `checkout.session.completed` — der Einmalkauf und die erste Rate eines Abos
 * (5.1 bis 5.6, 5.7 erste Spalte).
 */
async function handleCheckoutCompleted(admin: Admin, row: EventRow): Promise<EventOutcome> {
  const tenantId = row.tenant_id;
  if (tenantId === null) return { kind: "skipped", reason: "tenant_unresolved" };

  const program = await loadProgram(admin, tenantId);
  if (program === null) return { kind: "skipped", reason: "no_program" };
  // 6.5 c: Pause staut, verliert nicht, zählt nicht hoch.
  if (program.status !== "active") {
    return { kind: "defer", reason: "program_inactive", releaseAttempt: true };
  }

  // Kein Token = Hausverkauf (4.4 R9). Es entsteht ausdrücklich gar keine
  // Provisionszeile — nicht etwa eine über 0 Cent.
  if (row.referral_token === null) return { kind: "skipped", reason: "no_attribution" };
  if (row.order_id === null) return { kind: "defer", reason: "order_missing" };

  const [referralQuery, orderQuery] = await Promise.all([
    admin
      .from("affiliate_referrals")
      .select(REFERRAL_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("token", row.referral_token)
      .maybeSingle<ReferralRow>(),
    admin
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("id", row.order_id)
      .maybeSingle<OrderRow>(),
  ]);

  if (referralQuery.error) {
    logDbError("Zuordnung laden", referralQuery.error);
    throw new Error("db_error");
  }
  if (orderQuery.error) {
    logDbError("Bestellung laden", orderQuery.error);
    throw new Error("db_error");
  }

  const referral = referralQuery.data;
  // Das Token stammt aus der eigenen Metadata. Findet sich dazu keine Zeile,
  // ist das kein Wartefall, sondern ein Datenfehler — der löst sich nicht von
  // selbst und gehört sichtbar gemacht.
  if (!referral) return { kind: "error", reason: "referral_missing" };
  if (referral.program_id !== program.id) return { kind: "error", reason: "referral_missing" };

  const order = orderQuery.data;
  // Die Bestellung wird VOR der Aufnahme geschrieben (9.4). Fehlt sie
  // trotzdem, ist der Retry der richtige Weg — nicht das Verwerfen.
  if (!order) return { kind: "defer", reason: "order_missing" };

  const [partnerQuery, conditions, buyerQuery] = await Promise.all([
    admin
      .from("affiliate_partners")
      .select(PARTNER_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("id", referral.partner_id)
      .maybeSingle<PartnerRow>(),
    loadConditions(admin, tenantId, program.id),
    order.user_id === null
      ? Promise.resolve(null)
      : admin
          .from("profiles")
          .select("id, email")
          .eq("id", order.user_id)
          .maybeSingle<{ id: string; email: string | null }>(),
  ]);

  if (partnerQuery.error) {
    logDbError("Partner laden", partnerQuery.error);
    throw new Error("db_error");
  }
  const partner = partnerQuery.data;
  if (!partner) return { kind: "error", reason: "partner_missing" };

  const referrer = await loadActiveReferrer(admin, tenantId, partner.referred_by);

  const occurredAt = new Date(row.occurred_at);
  const payload = row.payload ?? {};

  // 5.2: aufgelöst wird zum EREIGNIS-Zeitpunkt, nicht zu `now()`. Zwischen
  // dem Kauf bei Stripe und seiner Verarbeitung können bei einem Retry Tage
  // liegen, und eine befristete Aktionskondition gilt nach dem Kaufzeitpunkt.
  const resolution = resolveCondition(
    conditions,
    {
      partner_id: partner.id,
      group_id: partner.group_id,
      product_id: order.product_id,
      at: occurredAt,
    },
    program,
  );

  const base = computeBaseCents({
    // G13: der tatsächlich vereinnahmte Betrag. `amount_total` der Session,
    // ersatzweise der in der Bestellung festgehaltene Betrag.
    gross_cents: payload.amount_total ?? order.amount_cents ?? 0,
    tax_cents: payload.amount_tax ?? 0,
    shipping_cents: payload.amount_shipping ?? 0,
    // Beim Einmalkauf bezieht sich die Steuer auf genau diesen Betrag — keine
    // anteilige Kürzung (5.1).
    invoice_total_cents: null,
    basis_kind: program.basis_kind,
    fee_deduction_bp: program.fee_deduction_bp,
  });

  const parts = computeCommissionParts({
    base_cents: base.base_cents,
    rate_kind: resolution.rate_kind,
    rate_bp: resolution.rate_bp,
    fixed_cents: resolution.fixed_cents,
    min_commission_cents: program.min_commission_cents,
    max_commission_cents: program.max_commission_cents,
    reserve_bp: program.reserve_bp,
  });

  // 4.4 R1/R2, hier NEU GEPRÜFT und nicht aus der Metadata übernommen: die
  // Metadata entsteht im Browser-Anfragepfad des Käufers, der Flag entscheidet
  // aber über Geld. Was hier steht, ist aus den Daten reproduzierbar (G4).
  const selfReferral =
    order.user_id === null
      ? null
      : detectSelfReferral(
          {
            id: partner.id,
            tenant_id: partner.tenant_id,
            program_id: partner.program_id,
            user_id: partner.user_id,
            applicant_email: partner.applicant_email,
            status: partner.status as PartnerRow["status"] & "active",
          },
          { userId: order.user_id, email: buyerQuery?.data?.email ?? null },
        );
  const selfBlocked = selfReferral !== null && program.self_referral === "block";
  const selfFlagged = selfReferral !== null && program.self_referral === "allow_flagged";

  // 4.5: Testbestellung. Die Buchung entsteht trotzdem — der Partner soll
  // sehen, dass die Zuordnung funktioniert —, aber wertlos.
  const isTest = program.test_mode || payload.livemode === false;

  const status: AffiliateCommissionStatus =
    isTest || selfBlocked || parts.zero_base ? "cancelled" : "pending";
  const cancelReason: AffiliateCancelReason | null = isTest
    ? "test_order"
    : selfBlocked
      ? "self_referral"
      : parts.zero_base
        ? "zero_amount"
        : null;

  const currency = order.currency ?? payload.currency ?? program.currency;
  const snapshot = buildSnapshot(program, resolution);
  const origin = {
    order_id: order.id,
    stripe_invoice_id: null,
    stripe_subscription_id: row.stripe_subscription_id,
    product_id: order.product_id,
    campaign: referral.campaign,
    referral_id: referral.id,
  };

  const shared = {
    ...emptyBookingRow(),
    ...origin,
    partner_id: partner.id,
    base_cents: base.base_cents,
    basis_kind: program.basis_kind,
    rate_kind: resolution.rate_kind,
    rate_bp: resolution.rate_bp,
    fixed_cents: resolution.fixed_cents,
    currency,
    condition_id: resolution.condition_id,
    condition_snapshot: snapshot,
    status,
    cancel_reason: cancelReason,
    flagged: selfFlagged || parts.flagged,
    flag_reason: selfFlagged ? "self_referral" : parts.flag_reason,
    is_test: isTest,
  };

  const rows: AffiliateBookingRow[] = [
    {
      ...shared,
      ref: "sale",
      kind: "sale",
      amount_cents: parts.sale_cents,
      hold_until: addDaysIso(row.occurred_at, program.hold_days),
      dedup_key: buildDedupKey({ kind: "sale", order_id: order.id }),
    },
  ];

  // G5: der Sicherheitseinbehalt ist eine eigene physische Zeile, kein
  // Attribut — sonst wiche der angezeigte Saldo zwangsläufig vom
  // Auszahlungslauf ab. Bei `reserve_bp = 0` entsteht keine zweite Zeile.
  if (parts.reserve_cents > 0) {
    rows.push({
      ...shared,
      ref: "reserve",
      kind: "reserve",
      parent_ref: "sale",
      amount_cents: parts.reserve_cents,
      hold_until: addDaysIso(row.occurred_at, program.reserve_days),
      dedup_key: buildDedupKey({ kind: "reserve", order_id: order.id }),
    });
  }

  const booked = await bookAffiliateRows(admin, {
    tenant_id: tenantId,
    program_id: program.id,
    // Der Vorgang ist die BESTELLUNG, nicht die einzelne Zeile: `sale` und
    // `reserve` tragen verschiedene `dedup_key`, gehören aber unter dieselbe
    // Sperre.
    lock_key: `order:${order.id}`,
    rows,
  });

  const saleId = booked.find((entry) => entry.ref === "sale")?.id ?? null;

  // Die Abo-Bindung trägt die Regel des Programms als KOPIE (3.9): eine
  // spätere Programmänderung darf laufende Abos nicht rückwirkend
  // umdefinieren. `first_only` bekommt `max_periods = 1` bei
  // `periods_booked = 1` — die erste Rate ist mit dem Checkout gebucht (5.7).
  if (row.stripe_subscription_id !== null && saleId !== null && status === "pending") {
    const { error: bindingError } = await admin
      .from("affiliate_subscription_bindings")
      .upsert(
        {
          stripe_subscription_id: row.stripe_subscription_id,
          tenant_id: tenantId,
          program_id: program.id,
          partner_id: partner.id,
          referral_id: referral.id,
          origin_commission_id: saleId,
          recurring_mode: program.recurring_mode,
          max_periods:
            program.recurring_mode === "first_only" ? 1 : program.recurring_mode === "n_periods" ? program.recurring_max_periods : 0,
          periods_booked: 1,
          currency,
        },
        { onConflict: "stripe_subscription_id", ignoreDuplicates: true },
      );
    if (bindingError) {
      logDbError("Abo-Bindung anlegen", bindingError);
      throw new Error("db_error");
    }
  }

  if (referrer !== null && saleId !== null) {
    await bookTier2(admin, {
      program,
      parentKind: "sale",
      parentId: saleId,
      referrer,
      snapshot,
      baseCents: base.base_cents,
      commissionCents: parts.amount_cents,
      currency,
      holdUntil: addDaysIso(row.occurred_at, program.hold_days),
      isTest,
      status,
      cancelReason,
      origin,
    });
  }

  return DONE;
}

/** `invoice.paid` — die Abo-Folgerate (5.7). */
async function handleInvoicePaid(admin: Admin, row: EventRow): Promise<EventOutcome> {
  const payload = row.payload ?? {};

  // 5.7: die erste Rate hat der Checkout bereits gebucht. Ohne diesen Zweig
  // entstünde zu jedem Abo-Start eine zweite Gruppe.
  if (payload.billing_reason === "subscription_create") {
    return { kind: "skipped", reason: "subscription_create" };
  }
  if (row.stripe_subscription_id === null) {
    return { kind: "skipped", reason: "no_subscription" };
  }
  if (row.stripe_invoice_id === null) {
    return { kind: "skipped", reason: "no_subscription" };
  }

  const { data: binding, error: bindingError } = await admin
    .from("affiliate_subscription_bindings")
    .select(BINDING_COLUMNS)
    .eq("stripe_subscription_id", row.stripe_subscription_id)
    .maybeSingle<SubscriptionBindingRow>();
  if (bindingError) {
    logDbError("Abo-Bindung laden", bindingError);
    throw new Error("db_error");
  }
  // 6.6, der Kern der Reihenfolgen-Immunität: keine Bindung heißt NICHT
  // „keine Provision", sondern „noch nicht". Stripe stellt `invoice.paid`
  // gelegentlich vor `checkout.session.completed` zu; das Ereignis bleibt
  // liegen und wird im nächsten Tick erneut versucht.
  if (!binding) return { kind: "defer", reason: "binding_missing" };

  const program = await loadProgram(admin, binding.tenant_id);
  if (program === null) return { kind: "skipped", reason: "no_program" };
  if (program.status !== "active") {
    return { kind: "defer", reason: "program_inactive", releaseAttempt: true };
  }

  // 5.11: die Währung des Abos ist eingefroren. Weicht die Rate davon ab,
  // wird NICHT gebucht — eine Umrechnung findet nirgends statt, und eine
  // Zeile in der falschen Währung verfälschte Saldo und Auszahlung.
  const invoiceCurrency = payload.currency ?? binding.currency;
  if (invoiceCurrency !== binding.currency) {
    return { kind: "error", reason: "currency_mismatch" };
  }

  // 5.7: der Satz wird für Folgeraten NICHT neu aufgelöst, sondern aus dem
  // Schnappschuss der Ursprungszeile gelesen — die Bedingungen bei
  // Vertragsschluss regieren die ganze Laufzeit. Andernfalls könnte ein
  // Händler laufende Abos rückwirkend billiger machen.
  if (binding.origin_commission_id === null) return { kind: "error", reason: "origin_missing" };
  const { data: origin, error: originError } = await admin
    .from("affiliate_commissions")
    .select(ORIGIN_COLUMNS)
    .eq("tenant_id", binding.tenant_id)
    .eq("id", binding.origin_commission_id)
    .maybeSingle<OriginCommissionRow>();
  if (originError) {
    logDbError("Ursprungszeile laden", originError);
    throw new Error("db_error");
  }
  if (!origin || !origin.condition_snapshot) return { kind: "error", reason: "origin_missing" };
  const snapshot = origin.condition_snapshot;

  const referrer = await (async () => {
    const { data, error } = await admin
      .from("affiliate_partners")
      .select(PARTNER_COLUMNS)
      .eq("tenant_id", binding.tenant_id)
      .eq("id", binding.partner_id)
      .maybeSingle<PartnerRow>();
    if (error) {
      logDbError("Partner der Bindung laden", error);
      throw new Error("db_error");
    }
    if (!data) return null;
    return loadActiveReferrer(admin, binding.tenant_id, data.referred_by);
  })();

  const base = computeBaseCents({
    // G13: `invoice.amount_paid`, NIE `invoice.total`. Wird ein
    // Kundenguthaben angerechnet, zahlte der Händler sonst Provision auf
    // Geld, das nie geflossen ist.
    gross_cents: payload.amount_paid ?? 0,
    tax_cents: payload.amount_tax ?? 0,
    shipping_cents: 0,
    // Die Steuer ist auf `invoice.total` ausgewiesen; weicht `amount_paid`
    // davon ab, wird sie anteilig gekürzt (5.1).
    invoice_total_cents: payload.amount_total ?? null,
    basis_kind: snapshot.basis_kind,
    fee_deduction_bp: snapshot.fee_deduction_bp,
  });

  const parts = computeCommissionParts({
    base_cents: base.base_cents,
    rate_kind: snapshot.rate_kind,
    rate_bp: snapshot.rate_bp,
    fixed_cents: snapshot.fixed_cents,
    min_commission_cents: snapshot.min_commission_cents,
    max_commission_cents: snapshot.max_commission_cents,
    reserve_bp: snapshot.reserve_bp,
  });

  const recurringKey = buildDedupKey({
    kind: "recurring",
    stripe_invoice_id: row.stripe_invoice_id,
  });

  // Der Zähler wird erst GANZ AM ENDE hochgesetzt, und vorher wird geprüft,
  // ob diese Rechnung schon gebucht ist. Grund: der bedingte Update ist der
  // einzige Weg, den Abo-Deckel unter Nebenläufigkeit zu halten (3.9), aber
  // er ist nicht zurücknehmbar. Ohne diese Vorprüfung zöge jeder Retry nach
  // einer erfolgreichen Buchung eine weitere Periode ab, ohne eine Zeile zu
  // erzeugen (die fiele in `do nothing`) — der Partner verlöre am Ende der
  // Laufzeit genau so viele Raten, wie es Retries gab.
  const { data: existing, error: existingError } = await admin
    .from("affiliate_commissions")
    .select("id")
    .eq("tenant_id", binding.tenant_id)
    .eq("dedup_key", recurringKey)
    .maybeSingle<{ id: string }>();
  if (existingError) {
    logDbError("Bestehende Rate prüfen", existingError);
    throw new Error("db_error");
  }
  if (existing) return DONE;

  const claim = await claimSubscriptionPeriod(admin, binding);
  if (claim === "exhausted") return { kind: "skipped", reason: "recurring_exhausted" };
  // Ein anderer Lauf hat dieselbe Rate genommen. WARTEN, nicht verwerfen: im
  // nächsten Tick greift die Vorprüfung auf den `dedup_key` und meldet `done`.
  if (claim === "conflict") return { kind: "defer", reason: "counter_conflict" };

  const isTest = program.test_mode || payload.livemode === false;
  const status: AffiliateCommissionStatus = isTest || parts.zero_base ? "cancelled" : "pending";
  const cancelReason: AffiliateCancelReason | null = isTest
    ? "test_order"
    : parts.zero_base
      ? "zero_amount"
      : null;

  const origins = {
    order_id: null,
    stripe_invoice_id: row.stripe_invoice_id,
    stripe_subscription_id: row.stripe_subscription_id,
    product_id: origin.product_id,
    campaign: origin.campaign,
    referral_id: origin.referral_id,
  };

  const shared = {
    ...emptyBookingRow(),
    ...origins,
    partner_id: binding.partner_id,
    base_cents: base.base_cents,
    basis_kind: snapshot.basis_kind,
    rate_kind: snapshot.rate_kind,
    rate_bp: snapshot.rate_bp,
    fixed_cents: snapshot.fixed_cents,
    currency: binding.currency,
    condition_id: snapshot.condition_id,
    condition_snapshot: snapshot,
    status,
    cancel_reason: cancelReason,
    flagged: parts.flagged,
    flag_reason: parts.flag_reason,
    is_test: isTest,
  };

  const rows: AffiliateBookingRow[] = [
    {
      ...shared,
      ref: "recurring",
      kind: "recurring",
      amount_cents: parts.sale_cents,
      hold_until: addDaysIso(row.occurred_at, snapshot.hold_days),
      dedup_key: recurringKey,
    },
  ];

  if (parts.reserve_cents > 0) {
    rows.push({
      ...shared,
      ref: "recurring_reserve",
      kind: "recurring_reserve",
      parent_ref: "recurring",
      amount_cents: parts.reserve_cents,
      hold_until: addDaysIso(row.occurred_at, snapshot.reserve_days),
      dedup_key: buildDedupKey({
        kind: "recurring_reserve",
        stripe_invoice_id: row.stripe_invoice_id,
      }),
    });
  }

  const booked = await bookAffiliateRows(admin, {
    tenant_id: binding.tenant_id,
    program_id: binding.program_id,
    // Der Vorgang ist die RECHNUNG — eine Rate je Rechnung.
    lock_key: `invoice:${row.stripe_invoice_id}`,
    rows,
  });

  const recurringId = booked.find((entry) => entry.ref === "recurring")?.id ?? null;
  if (referrer !== null && recurringId !== null) {
    await bookTier2(admin, {
      program,
      parentKind: "recurring",
      parentId: recurringId,
      referrer,
      snapshot,
      baseCents: base.base_cents,
      commissionCents: parts.amount_cents,
      currency: binding.currency,
      holdUntil: addDaysIso(row.occurred_at, snapshot.hold_days),
      isTest,
      status,
      cancelReason,
      origin: origins,
    });
  }

  return DONE;
}

// --- Schritt 1c: Storno, Rückbuchung, Wiedergutschrift (B5, 5.8) --------

/**
 * Die HERKUNFT eines Storno-Ereignisses: an welcher Bestellung bzw. Rechnung
 * die zurückzunehmenden Provisionszeilen hängen.
 *
 * `reverseForRefund()`/`reverseForDispute()`/`recreditForWonDispute()`
 * verlangen mindestens eine der beiden Kennungen (zod-`refine` in
 * `reversal.ts`) — und zwar aus einem handfesten Grund: ein Aufruf ohne
 * Herkunftsfilter fände ALLE Provisionszeilen des Mandanten und stornierte
 * sie. Die Prüfung steht hier ein zweites Mal, damit der fehlende Fall als
 * benannter Grund in `last_error` landet statt als `ZodError` im
 * Giftzeilen-Fang (`unexpected`), wo niemand ihm ansieht, was fehlt.
 */
function reversalOrigin(row: EventRow): { order_id: string | null; stripe_invoice_id: string | null } | null {
  if (row.order_id === null && row.stripe_invoice_id === null) return null;
  return { order_id: row.order_id, stripe_invoice_id: row.stripe_invoice_id };
}

/**
 * Das Ergebnis einer Rücknahme auf einen Ereigniszustand abbilden.
 *
 * `matched: false` heißt: zu dieser Bestellung gibt es keine rücknehmbare
 * Provisionszeile. Das ist der NORMALFALL und kein Fehler — die allermeisten
 * Erstattungen betreffen Bestellungen ohne Partnerbezug (Hausverkauf), und
 * eine Provision, die es nie gab, kann nicht zurückgenommen werden.
 *
 * Warum das `skipped` sein darf und nicht `defer` sein muss: die
 * Warteschlange arbeitet streng `created_at` aufsteigend ab (Schritt 1), und
 * das Kauf-Ereignis ist IMMER älter als die Erstattung desselben Charge. Die
 * Provisionszeile ist also bereits gebucht, wenn die Erstattung an die Reihe
 * kommt. Ein `defer` hier hieße dagegen: jede Erstattung einer
 * partnerfreien Bestellung liefe fünf Versuche leer und landete danach als
 * „Nicht verarbeitetes Zahlungsereignis" in der Aufsicht — eine Meldung, die
 * bei jedem zweiten Storno erschiene und deshalb nach kurzer Zeit niemand
 * mehr läse.
 *
 * Bleibt der eine Fall, in dem das Kauf-Ereignis selbst nicht durchkam (es
 * steht dann auf `error` und ist als solches sichtbar): nach seiner Reparatur
 * über `POST /api/admin/affiliate/reprocess` muss auch das Storno-Ereignis
 * mitgesetzt werden. Das ist genau der Zweck dieses Endpunkts, und er setzt
 * `error`-Zeilen ohnehin gemeinsam zurück.
 */
function reversalOutcome(result: AffiliateReversalResult): EventOutcome {
  return result.matched ? DONE : { kind: "skipped", reason: "no_attribution" };
}

/**
 * `charge.refunded` — (Teil-)Erstattung (5.8, 5.9 Beispiel C).
 *
 * Der Verarbeiter reicht die beiden KUMULATIVEN Zahlen durch und rechnet
 * selbst nichts: `amount_refunded` ist der gesamte bisher erstattete Betrag,
 * nicht das Delta dieses Ereignisses (G7). Die Differenz zum bereits
 * Gegengebuchten zieht `book_affiliate_reversals()` unter der Sperre aus
 * frischem Stand — deshalb ist eine doppelte Zustellung folgenlos und eine
 * zweite Erstattungsstufe exakt das Delta.
 *
 * `orders.refunded_cents`/`orders.status` werden in `reverseForRefund()`
 * AUCH DANN nachgeführt, wenn es zu der Bestellung keine Provision gibt: die
 * Spalten gehören der Bestellung, nicht dem Affiliate-Modul (5.8, letzter
 * Absatz). Genau deshalb ruft dieser Zweig die Funktion auch bei einem
 * Mandanten ohne Programm — der einzige Ort, an dem der Bestellzustand nach
 * einer Erstattung überhaupt geschrieben wird.
 */
async function handleChargeRefunded(admin: Admin, row: EventRow): Promise<EventOutcome> {
  const payload = row.payload ?? {};

  // Ohne Mandant gibt es keine Bestellung und keine Provisionszeile, die zu
  // diesem Charge gehören könnte (Schritt 1b hat beide Brücken vergeblich
  // versucht): der Charge stammt dann nicht aus diesem System.
  if (row.tenant_id === null) return { kind: "skipped", reason: "tenant_unresolved" };
  if (row.stripe_charge_id === null) return { kind: "skipped", reason: "tenant_unresolved" };

  const origin = reversalOrigin(row);
  if (origin === null) return { kind: "skipped", reason: "order_missing" };

  const refundedTotal = payload.amount_refunded ?? 0;
  const chargeTotal = payload.charge_amount ?? 0;
  // Eine Erstattung über 0 Cent gibt es bei Stripe nicht; käme sie doch,
  // wäre das Verhältnis 0 und jede Zielgröße 0 — der Aufruf schriebe nichts
  // und kostete nur eine Sperre.
  if (refundedTotal <= 0 || chargeTotal <= 0) {
    return { kind: "skipped", reason: "no_attribution" };
  }

  return reversalOutcome(
    await reverseForRefund(
      admin,
      {
        tenant_id: row.tenant_id,
        ...origin,
        stripe_charge_id: row.stripe_charge_id,
        refunded_total_cents: refundedTotal,
        charge_total_cents: chargeTotal,
      },
      // Die STRIPE-Zeit des Vorgangs, nicht die Verarbeitungszeit: `hold_until`
      // der Gegenbuchung erbt vom Elternteil (G6), aber der `approved`-Zweig
      // setzt `hold_until = jetzt`. Bei einem Retry nach drei Tagen darf sich
      // dieser Zeitpunkt nicht verschieben (3.10).
      new Date(row.occurred_at),
    ),
  );
}

/**
 * `charge.dispute.created` — Rückbuchung (5.8).
 *
 * Wie eine Erstattung über `dispute.amount`, zusätzlich wird das Betrugsflag
 * auf allen Zeilen des Partners der letzten 30 Tage gesetzt (das erledigt
 * `reverseForDispute()`).
 *
 * `charge_amount` steht auf einem `Stripe.Dispute` NICHT zur Verfügung und
 * wird deshalb als `null` gereicht — `reverseForDispute()` nimmt dann den
 * Streitbetrag selbst als Bezugsgröße, was das Verhältnis 1 und damit die
 * Vollrücknahme ergibt, die 5.8 für einen Chargeback ohnehin vorsieht.
 */
async function handleDisputeCreated(admin: Admin, row: EventRow): Promise<EventOutcome> {
  const payload = row.payload ?? {};

  if (row.tenant_id === null) return { kind: "skipped", reason: "tenant_unresolved" };
  if (row.stripe_charge_id === null) return { kind: "skipped", reason: "tenant_unresolved" };

  const origin = reversalOrigin(row);
  if (origin === null) return { kind: "skipped", reason: "order_missing" };

  // Ohne die Kennung des STREITFALLS (nicht die des Charge) gäbe es keinen
  // eigenen Schlüsselraum: `dedup_key` und Sperrschlüssel fielen mit denen
  // einer danebenliegenden Erstattung desselben Charge zusammen, und die
  // Wiedergutschrift eines gewonnenen Streitfalls holte deren Gegenbuchungen
  // mit zurück. Lieber sichtbar liegen bleiben als falsch buchen.
  const disputeId = payload.dispute_id ?? null;
  if (disputeId === null) return { kind: "error", reason: "booking_failed" };

  const disputeAmount = payload.dispute_amount ?? 0;
  if (disputeAmount <= 0) return { kind: "skipped", reason: "no_attribution" };

  return reversalOutcome(
    await reverseForDispute(
      admin,
      {
        tenant_id: row.tenant_id,
        ...origin,
        stripe_charge_id: row.stripe_charge_id,
        dispute_id: disputeId,
        dispute_amount_cents: disputeAmount,
        charge_total_cents: payload.charge_amount ?? null,
      },
      new Date(row.occurred_at),
    ),
  );
}

/**
 * `charge.dispute.closed` — nur der GEWONNENE Streitfall erzeugt etwas (5.8).
 *
 * Bei jedem anderen Ausgang (`lost`, `warning_closed`, …) bleibt die
 * Gegenbuchung aus `charge.dispute.created` bestehen: der Händler hat sein
 * Geld nicht zurückbekommen, also behält der Partner seine Provision auch
 * nicht. Es gibt dann NICHTS zu tun — und das ist ein Endzustand, kein
 * Warten.
 */
async function handleDisputeClosed(admin: Admin, row: EventRow): Promise<EventOutcome> {
  const payload = row.payload ?? {};

  if (payload.dispute_status !== "won") {
    return { kind: "skipped", reason: "no_attribution" };
  }
  if (row.tenant_id === null) return { kind: "skipped", reason: "tenant_unresolved" };

  const origin = reversalOrigin(row);
  if (origin === null) return { kind: "skipped", reason: "order_missing" };

  // Siehe `handleDisputeCreated()`: die Wiedergutschrift findet ihre
  // Gegenbuchungen AUSSCHLIESSLICH über diese Kennung wieder.
  const disputeId = payload.dispute_id ?? null;
  if (disputeId === null) return { kind: "error", reason: "booking_failed" };

  return reversalOutcome(
    await recreditForWonDispute(
      admin,
      { tenant_id: row.tenant_id, ...origin, dispute_id: disputeId },
      new Date(row.occurred_at),
    ),
  );
}

/**
 * Ereignisart → Verarbeiter.
 *
 * ERLAUBNISLISTE, keine Sperrliste: eine hier unbekannte Art wird als
 * `unsupported_event` abgelegt und nicht still mitgeschleppt. Wer eine Art
 * ergänzt, trägt sie zusätzlich in `AFFILIATE_EVENT_TYPES`
 * (`src/lib/affiliate/intake.ts`) ein — sonst nimmt die Erlaubnisliste dort
 * sie gar nicht erst auf und dieser Zweig wird nie erreicht.
 */
async function dispatchEvent(admin: Admin, row: EventRow): Promise<EventOutcome> {
  switch (row.event_type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(admin, row);
    case "invoice.paid":
      return handleInvoicePaid(admin, row);
    case "charge.refunded":
      return handleChargeRefunded(admin, row);
    case "charge.dispute.created":
      return handleDisputeCreated(admin, row);
    case "charge.dispute.closed":
      return handleDisputeClosed(admin, row);
    default:
      return { kind: "skipped", reason: "unsupported_event" };
  }
}

/**
 * Der Abschluss einer Ereigniszeile. Die Zustände stehen in 3.10; `skipped`
 * trägt den Grund in `last_error` — dieselbe Spalte, dieselbe Kennungsform,
 * damit die Admin-Oberfläche nur einen Ort auswerten muss.
 */
async function finishEvent(
  admin: Admin,
  row: EventRow,
  attempts: number,
  outcome: EventOutcome,
): Promise<void> {
  const patch: Record<string, unknown> =
    outcome.kind === "done"
      ? { status: "done", last_error: null, processed_at: new Date().toISOString() }
      : outcome.kind === "skipped"
        ? { status: "skipped", last_error: outcome.reason, processed_at: new Date().toISOString() }
        : outcome.kind === "error"
          ? { status: "error", last_error: outcome.reason }
          : {
              // `defer`: die Zeile bleibt liegen. Erst wenn die Versuche
              // aufgebraucht sind, wird daraus ein sichtbarer Fehler (6.6) —
              // sonst bliebe sie `pending` und fiele aus dem Auswahlfilter
              // `attempts < 5`, also lautlos aus der Warteschlange.
              status:
                !outcome.releaseAttempt && attempts >= AFFILIATE_EVENT_MAX_ATTEMPTS
                  ? "error"
                  : "pending",
              last_error: outcome.reason,
              ...(outcome.releaseAttempt ? { attempts: Math.max(0, attempts - 1) } : {}),
            };

  const { error } = await admin.from("affiliate_events").update(patch).eq("id", row.id);
  if (error) logDbError("Ereigniszustand schreiben", error);
}

/**
 * Schritt 1 (6.5): bis zu 20 Ereignisse, älteste zuerst.
 *
 * `attempts` wird SOFORT und VOR der Arbeit hochgesetzt — eine Zeile, die den
 * Verarbeiter zum Absturz bringt, darf ihn nicht in jedem Lauf erneut zum
 * Absturz bringen (Giftzeilen-Schutz). Der Update ist zusätzlich ein
 * Compare-and-Swap auf `attempts` (Muster `markPayoutPaid()`,
 * `src/lib/platform/marketplace.ts:561`): zwei gleichzeitige Cron-Ticks
 * greifen damit nie dieselbe Zeile.
 */
async function processEventQueue(
  admin: Admin,
  deadline: number,
): Promise<{ result: AffiliateEventStepResult; tenants: Set<string>; truncated: boolean }> {
  const result: AffiliateEventStepResult = { picked: 0, done: 0, skipped: 0, deferred: 0, error: 0 };
  const tenants = new Set<string>();

  const { data, error } = await admin
    .from("affiliate_events")
    .select(EVENT_COLUMNS)
    .in("status", ["pending", "error"])
    .lt("attempts", AFFILIATE_EVENT_MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(AFFILIATE_EVENT_BATCH_SIZE);

  if (error) {
    logDbError("Warteschlange lesen", error);
    return { result, tenants, truncated: false };
  }

  // Über `unknown`, weil der generierte Supabase-Typ für eine so lange
  // Spaltenliste `GenericStringError[]` ableitet; die Form steht in
  // `EVENT_COLUMNS` und `EventRow` direkt nebeneinander.
  const rows = (data ?? []) as unknown as EventRow[];
  for (const row of rows) {
    if (Date.now() > deadline) return { result, tenants, truncated: true };

    const attempts = row.attempts + 1;
    const { data: claimed, error: claimError } = await admin
      .from("affiliate_events")
      .update({ attempts })
      .eq("id", row.id)
      .eq("attempts", row.attempts)
      .select("id");
    if (claimError) {
      logDbError("Versuch hochsetzen", claimError);
      continue;
    }
    // Leeres Ergebnis = ein anderer Tick hat die Zeile bereits genommen.
    if (!claimed || (Array.isArray(claimed) && claimed.length === 0)) continue;

    result.picked += 1;
    let current = row;

    let outcome: EventOutcome;
    try {
      // Schritt 1b: Mandant nachtragen, falls er fehlt.
      if (current.tenant_id === null) {
        const resolved = await resolveEventTenant(admin, current);
        if (resolved !== null) {
          current = {
            ...current,
            tenant_id: resolved.tenantId,
            order_id: current.order_id ?? resolved.orderId,
          };
          const { error: patchError } = await admin
            .from("affiliate_events")
            .update({ tenant_id: current.tenant_id, order_id: current.order_id })
            .eq("id", current.id);
          if (patchError) logDbError("Mandant nachtragen", patchError);
        }
      }

      outcome = await dispatchEvent(admin, current);
    } catch (e) {
      // Giftzeilen-Schutz, zweite Hälfte: ein unerwarteter Fehler beendet
      // dieses Ereignis, nicht den Lauf. Die Kennung kommt aus der geworfenen
      // Meldung, sofern sie eine bekannte ist — nie der Fließtext (11.11).
      const reason = e instanceof Error ? e.message : "unexpected";
      outcome = {
        kind: "error",
        reason: (AFFILIATE_EVENT_REASONS as readonly string[]).includes(reason)
          ? (reason as AffiliateEventReason)
          : "unexpected",
      };
    }

    if (outcome.kind === "done") result.done += 1;
    else if (outcome.kind === "skipped") result.skipped += 1;
    else if (outcome.kind === "defer") result.deferred += 1;
    else result.error += 1;

    if (current.tenant_id !== null && outcome.kind === "done") tenants.add(current.tenant_id);
    await finishEvent(admin, current, attempts, outcome);
  }

  return { result, tenants, truncated: false };
}

// --- Schritt 2: Freigabelauf (6.4) --------------------------------------

/**
 * Ein einziges bedingtes UPDATE in der Datenbank, damit zwei gleichzeitige
 * Cron-Ticks nicht doppelt freigeben. Die Bedingungen (`hold_until <= now()`,
 * `flagged = false`, `is_test = false`, Programm `active`) stehen dort und
 * nicht hier — sie entscheiden über Geld und gehören in dieselbe Transaktion
 * wie der Statuswechsel.
 */
async function runApprovalPass(admin: Admin): Promise<number> {
  const { data, error } = await admin.rpc("approve_due_affiliate_commissions", {
    p_limit: AFFILIATE_APPROVAL_LIMIT,
  });
  if (error) {
    logDbError("Freigabelauf", error);
    return 0;
  }
  // Rückgabe ist ein jsonb-OBJEKT `{ approved, limit, rows }` und kein Array
  // (Migration 20260911130000, Abschnitt 5). Ein `Array.isArray(data)` hier
  // meldete jeden Lauf als „0 freigegeben" — die Zahl geht ins Cron-Log und
  // wäre damit dauerhaft falsch.
  const approved = (data as { approved?: unknown } | null)?.approved;
  return typeof approved === "number" && Number.isFinite(approved) ? approved : 0;
}

// --- Schritt 3: Tagesaggregation ---------------------------------------

type StatsBucket = {
  tenant_id: string;
  program_id: string;
  partner_id: string;
  day: string;
  campaign: string;
  orders_count: number;
  revenue_cents: number;
  commission_cents: number;
  reversal_cents: number;
  leads: number;
};

type StatsCommissionRow = {
  tenant_id: string;
  program_id: string;
  partner_id: string;
  campaign: string | null;
  kind: AffiliateCommissionKind;
  amount_cents: number;
  base_cents: number;
  booked_at: string;
  is_test: boolean;
};

/**
 * Schritt 3 (6.5): für jeden Mandanten mit Aktivität werden Vortag und
 * laufender Tag NEU berechnet und per Upsert überschrieben.
 *
 * Überschreiben statt Fortschreiben ist der Punkt: eine Gegenbuchung oder
 * eine Handbuchung ändert die Zahlen eines vergangenen Tages, und ein
 * addierender Zähler liefe dabei auseinander. Die drei KLICK-Zähler bleiben
 * ausdrücklich unberührt — sie stehen nicht in der Nutzlast, ihre Quelle ist
 * nach 90 Tagen gelöscht und der Guard der Tabelle lässt sie ohnehin nur
 * wachsen (Migration 20260911120000, Abschnitt 4).
 *
 * `is_test`-Zeilen zählen nirgends mit (4.5).
 */
async function rebuildDailyStats(
  admin: Admin,
  seedTenants: ReadonlySet<string>,
  now: Date,
): Promise<{ tenants: number; rows: number }> {
  const since = new Date(now.getTime() - AFFILIATE_STATS_LOOKBACK_MS).toISOString();
  const tenants = new Set(seedTenants);

  const { data: recent, error: recentError } = await admin
    .from("affiliate_commissions")
    .select("tenant_id")
    .gte("created_at", since)
    .limit(2000);
  if (recentError) {
    logDbError("Aktive Mandanten ermitteln", recentError);
  } else {
    for (const entry of (recent ?? []) as Array<{ tenant_id: string }>) tenants.add(entry.tenant_id);
  }

  const today = berlinDay(now);
  const days = [shiftIsoDate(today, -1), today];
  let written = 0;
  let handled = 0;

  for (const tenantId of [...tenants].slice(0, AFFILIATE_STATS_TENANT_LIMIT)) {
    handled += 1;

    const { data, error } = await admin
      .from("affiliate_commissions")
      .select("tenant_id, program_id, partner_id, campaign, kind, amount_cents, base_cents, booked_at, is_test")
      .eq("tenant_id", tenantId)
      .in("booked_at", days)
      .limit(5000);
    if (error) {
      logDbError("Tageszahlen lesen", error);
      continue;
    }

    const buckets = new Map<string, StatsBucket>();
    for (const commission of (data ?? []) as StatsCommissionRow[]) {
      if (commission.is_test) continue;
      const campaign = commission.campaign ?? "";
      const key = `${commission.partner_id} ${commission.booked_at} ${campaign}`;
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = {
          tenant_id: tenantId,
          program_id: commission.program_id,
          partner_id: commission.partner_id,
          day: commission.booked_at,
          campaign,
          orders_count: 0,
          revenue_cents: 0,
          commission_cents: 0,
          reversal_cents: 0,
          leads: 0,
        };
        buckets.set(key, bucket);
      }

      // „Bestellungen" zählt die tragenden Zeilen: je Bestellung genau eine
      // `sale`, je Abo-Rate genau eine `recurring`. Die Reserve-Zeile gehört
      // zur selben Bestellung und darf nicht mitzählen (G5).
      if (commission.kind === "sale" || commission.kind === "recurring") {
        bucket.orders_count += 1;
        bucket.revenue_cents += commission.base_cents;
      }
      if (commission.kind === "reversal" || commission.kind === "recredit") {
        bucket.reversal_cents += commission.amount_cents;
      }
      bucket.commission_cents += commission.amount_cents;
    }

    // Leads sind Zuordnungen mit Konto, aber ohne Bestellung (3.7) — sie
    // brauchen keine eigene Tabelle. Gezählt wird am Bindungstag.
    const { data: leads, error: leadsError } = await admin
      .from("affiliate_referrals")
      .select("partner_id, program_id, campaign, bound_at")
      .eq("tenant_id", tenantId)
      .not("user_id", "is", null)
      .gte("bound_at", `${days[0]}T00:00:00Z`)
      .limit(5000);
    if (leadsError) {
      logDbError("Leads lesen", leadsError);
    } else {
      for (const lead of (leads ?? []) as Array<{
        partner_id: string;
        program_id: string;
        campaign: string | null;
        bound_at: string | null;
      }>) {
        if (lead.bound_at === null) continue;
        const day = berlinDay(new Date(lead.bound_at));
        if (!days.includes(day)) continue;
        const campaign = lead.campaign ?? "";
        const key = `${lead.partner_id} ${day} ${campaign}`;
        let bucket = buckets.get(key);
        if (bucket === undefined) {
          bucket = {
            tenant_id: tenantId,
            program_id: lead.program_id,
            partner_id: lead.partner_id,
            day,
            campaign,
            orders_count: 0,
            revenue_cents: 0,
            commission_cents: 0,
            reversal_cents: 0,
            leads: 0,
          };
          buckets.set(key, bucket);
        }
        bucket.leads += 1;
      }
    }

    if (buckets.size === 0) continue;
    const { error: upsertError } = await admin
      .from("affiliate_daily_stats")
      .upsert([...buckets.values()], { onConflict: "tenant_id,partner_id,day,campaign" });
    if (upsertError) {
      logDbError("Tageszahlen schreiben", upsertError);
      continue;
    }
    written += buckets.size;
  }

  return { tenants: handled, rows: written };
}

// --- Schritt 4: Auszahlungsentwürfe (7.1) -------------------------------

/**
 * SCHRITT 4 IST IN B4 NOCH LEER — und zwar nicht aus Versehen.
 *
 * Ein Auszahlungsentwurf schreibt in `affiliate_payouts` und
 * `affiliate_document_counters` (3.12). Beide Tabellen entstehen erst mit B8;
 * bis dahin gäbe es hier nichts zu schreiben. Der Schritt steht trotzdem als
 * benannte Stelle im Lauf, damit B8 ihn füllt statt einen neuen zu erfinden —
 * und damit das Ergebnis-JSON im Cron-Log von Anfang an die Fünf zeigt, die
 * 6.5 beschreibt.
 *
 * `pending: true` heißt: dieser Schritt wartet auf B8, nicht „nichts zu tun".
 */
function draftPayouts(): { drafted: number; pending: boolean } {
  return { drafted: 0, pending: true };
}

// --- Schritt 5: Datenläufe ----------------------------------------------

/**
 * Aufbewahrungsfristen als ausführbarer Weg statt als Satz im Fließtext
 * (Art. 5 Abs. 1 lit. e DSGVO). Beide Läufe sind gedeckelt und wiederholen
 * sich alle zwei Minuten; ein Rückstand baut sich über wenige Stunden ab.
 *
 * Beide laufen über `security definer`-Funktionen, weil die Guards auf
 * `affiliate_clicks` und `affiliate_referrals` `service_role` das Löschen
 * ausdrücklich verbieten: Zeilen, an denen Geld hängt, verschwinden
 * ausschließlich über DIESEN benannten, begrenzten Weg — nicht über einen
 * `delete`-Aufruf mit einem falschen Filter irgendwo in einer Route.
 */
async function runDataRetention(admin: Admin): Promise<{ clicks: number; referrals: number }> {
  const result = { clicks: 0, referrals: 0 };

  const clicks = await admin.rpc("affiliate_clicks_purge", {
    p_retention_days: AFFILIATE_CLICK_RETENTION_DAYS,
    p_limit: AFFILIATE_PURGE_LIMIT,
  });
  if (clicks.error) logDbError("Klickzeilen löschen", clicks.error);
  else result.clicks = typeof clicks.data === "number" ? clicks.data : 0;

  const referrals = await admin.rpc("affiliate_referrals_purge", {
    p_grace_days: AFFILIATE_REFERRAL_GRACE_DAYS,
    p_limit: AFFILIATE_PURGE_LIMIT,
  });
  if (referrals.error) logDbError("Zuordnungen löschen", referrals.error);
  else result.referrals = typeof referrals.data === "number" ? referrals.data : 0;

  return result;
}

// --- Der Lauf -----------------------------------------------------------

/**
 * Die vierte Warteschlange im Cron-Tick (9.7). Wirft NIE: ein Fehler in einem
 * Schritt darf weder die anderen Schritte noch die drei KI-Warteschlangen im
 * selben `Promise.all` mitreißen.
 */
export async function processAffiliateQueue(): Promise<AffiliateQueueResult> {
  const started = Date.now();
  const deadline = started + AFFILIATE_QUEUE_TIME_BUDGET_MS;
  const result: AffiliateQueueResult = {
    events: { picked: 0, done: 0, skipped: 0, deferred: 0, error: 0 },
    approved: 0,
    stats: { tenants: 0, rows: 0 },
    payouts: { drafted: 0, pending: true },
    cleanup: { clicks: 0, referrals: 0 },
    truncated: false,
  };

  try {
    const admin = createAdminClient();

    const events = await processEventQueue(admin, deadline);
    result.events = events.result;
    if (events.truncated) {
      result.truncated = true;
      return result;
    }

    if (Date.now() > deadline) return { ...result, truncated: true };
    result.approved = await runApprovalPass(admin);

    if (Date.now() > deadline) return { ...result, truncated: true };
    result.stats = await rebuildDailyStats(admin, events.tenants, new Date());

    result.payouts = draftPayouts();

    if (Date.now() > deadline) return { ...result, truncated: true };
    result.cleanup = await runDataRetention(admin);

    return result;
  } catch (e) {
    console.error(
      "[affiliate/process] Unerwarteter Fehler im Lauf:",
      e instanceof Error ? e.message : "unbekannt",
    );
    return result;
  }
}
