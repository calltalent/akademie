import "server-only";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { buildDedupKey, computeReversalDelta } from "./compute";
import { applyOrderRefundState } from "./orders";
import type {
  AffiliateCommissionKind,
  AffiliateCommissionStatus,
  AffiliateConditionSnapshot,
} from "./types";

/**
 * Affiliate-System, Block B5 — STORNO, CHARGEBACK UND WIEDERGUTSCHRIFT
 * (PLAN_Affiliate-System.md 5.8, 5.9 Beispiel C, 6.1 bis 6.3, 10/B5).
 *
 * Ohne diese Datei gibt es Provisionen, die man nicht zurückholen kann: der
 * Verarbeiter bucht (B4), aber eine Erstattung, eine Rückbuchung und ein
 * gewonnener Streitfall bleiben folgenlos. Drei Einstiegspunkte, einer je
 * Stripe-Ereignis:
 *
 *   `reverseForRefund()`        — `charge.refunded`
 *   `reverseForDispute()`       — `charge.dispute.created`
 *   `recreditForWonDispute()`   — `charge.dispute.closed` mit `status='won'`
 *
 * SECHS REGELN, die diese Datei trägt:
 *
 *  1. G6 — DER STATUS EINER GEBUCHTEN ZEILE WIRD NIE GEÄNDERT. Eine Rücknahme
 *     ist immer eine ZWEITE Zeile (`kind='reversal'`, negativer Betrag). Würde
 *     stattdessen die Ursprungszeile auf `cancelled` gesetzt, verschwände ihr
 *     Betrag aus dem Saldo UND die Gegenbuchung zöge ihn ein zweites Mal ab.
 *     Deshalb gibt es auch keinen Status `reversed` (6.1).
 *
 *  2. G7 — STRIPE ZÄHLT KUMULATIV. `charge.amount_refunded` ist der GESAMTE
 *     bisher erstattete Betrag, nicht das Delta dieses Ereignisses. Gerechnet
 *     wird deshalb ein ZIELWERT je Zeile, gebucht nur die Differenz zum
 *     bereits Gegengebuchten. Zwei Teilerstattungen zu je 20 % ergäben sonst
 *     60 % Storno (5.9 Beispiel C).
 *
 *  3. DIE DIFFERENZ ENTSTEHT IN DER DATENBANK. `computeReversalDelta()` rechnet
 *     hier den Zielwert (mit BigInt, siehe dort); die Differenz zum bereits
 *     Gegengebuchten zieht `book_affiliate_reversals()` unter einer Sperre aus
 *     frischem Stand (Migration 20260911140000). Der hier gerechnete
 *     `delta_cents` entscheidet nur, OB ein Aufruf lohnt — und das ist sicher:
 *     der gelesene Stand kann nie höher sein als der der Datenbank, weil
 *     Gegenbuchungen nur hinzukommen. Ein zu kleiner gelesener Stand führt zum
 *     Aufruf, und dort wird die Zeile sauber übersprungen.
 *
 *  4. ÜBERSTORNIERUNG IST UNMÖGLICH — zweifach. Hier, weil der Zielwert nie
 *     über `amount_cents` der Ursprungszeile liegen kann (`refunded` ist auf
 *     den Charge gedeckelt), und in der RPC, die denselben Deckel noch einmal
 *     zieht. Eine Rechenregel allein wäre eine Absichtserklärung.
 *
 *  5. DIE ZWEITE STUFE FOLGT DER ERSTEN. `tier2`-Zeilen tragen dieselbe
 *     Herkunft (`order_id`/`stripe_invoice_id`) wie ihre erste Stufe und
 *     werden deshalb von derselben Abfrage erfasst. Das Verhältnis wird auf
 *     JEDE Zeile einzeln angewandt (5.8) — nicht etwa die Zweitstufe aus der
 *     stornierten Erstprovision neu gerechnet: sonst liefen Rundung und
 *     Deckel der ursprünglichen Rechnung ein zweites Mal und ließen einen
 *     Restcent stehen.
 *
 *  6. KEINE FEHLERTEXTE NACH AUSSEN. Geworfen werden ausschließlich die
 *     stabilen Kennungen aus `AFFILIATE_EVENT_REASONS` (`db_error`,
 *     `booking_failed`); der Verarbeiter schreibt sie unverändert nach
 *     `affiliate_events.last_error`. Eine durchgereichte PostgREST-Meldung
 *     trüge bei einer Constraint-Verletzung den Schlüsselwert im Klartext —
 *     hier Bestellnummern und Rechnungskennungen (CLAUDE.md §2.11).
 *
 * EINHÄNGUNG. Der Aufrufer ist `processAffiliateQueue()`
 * (`src/lib/affiliate/process.ts`, Schritt 1): dort stehen die drei
 * Ereignisarten heute in `DEFERRED_EVENT_TYPES` und warten. Diese Datei ändert
 * `process.ts` NICHT — die Verdrahtung ist ein eigener Arbeitsschritt, damit
 * die Gegenbuchungslogik erst dann scharf wird, wenn Migration
 * 20260911140000 angewendet ist. Bis dahin ist der Zustand der bestmögliche:
 * die Ereignisse sind AUFGENOMMEN (verlustfrei) und unverarbeitet.
 */

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Die stornierbaren Arten (5.8). ERLAUBNISLISTE: eine künftige Buchungsart
 * wird nicht automatisch mitstorniert, sondern muss hier eingetragen werden.
 * `reversal`/`recredit` fehlen bewusst (eine Gegenbuchung auf eine
 * Gegenbuchung ist eine Wiedergutschrift und läuft über einen eigenen Pfad),
 * `manual` ebenfalls (eine Handbuchung korrigiert ein Mensch, nicht ein
 * Stripe-Ereignis).
 */
export const AFFILIATE_REVERSIBLE_KINDS = [
  "sale",
  "reserve",
  "recurring",
  "recurring_reserve",
  "tier2",
] as const;

/**
 * Spaltenlisten, nie `select("*")`: das SELECT-Recht auf den Affiliate-Tabellen
 * ist ein SPALTEN-Grant (Migrationen 20260910120000 und 20260911120000),
 * `select("*")` bricht dort mit 42501 ab.
 */
const PARENT_COLUMNS =
  "id, tenant_id, program_id, partner_id, kind, amount_cents, currency, status, " +
  "hold_until, is_test, order_id, stripe_invoice_id";

/**
 * Die Gegenbuchungen selbst — für den bereits gegengebuchten Stand und, im
 * Wiedergutschriftspfad, als Vorlage der `recredit`-Zeile. Deshalb die volle
 * Herkunft und der eingefrorene Rechenweg.
 */
const REVERSAL_COLUMNS =
  "id, tenant_id, program_id, partner_id, kind, reverses_id, amount_cents, currency, " +
  "status, hold_until, dedup_key, order_id, stripe_invoice_id, stripe_subscription_id, " +
  "stripe_charge_id, product_id, campaign, referral_id, condition_id, condition_snapshot, " +
  "base_cents, basis_kind, rate_kind, rate_bp, fixed_cents, is_test";

type ParentRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  partner_id: string;
  kind: AffiliateCommissionKind;
  amount_cents: number;
  currency: string;
  status: AffiliateCommissionStatus;
  hold_until: string;
  is_test: boolean;
  order_id: string | null;
  stripe_invoice_id: string | null;
};

type ReversalRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  partner_id: string;
  kind: AffiliateCommissionKind;
  reverses_id: string | null;
  amount_cents: number;
  currency: string;
  status: AffiliateCommissionStatus;
  hold_until: string;
  dedup_key: string;
  order_id: string | null;
  stripe_invoice_id: string | null;
  stripe_subscription_id: string | null;
  stripe_charge_id: string | null;
  product_id: string | null;
  campaign: string | null;
  referral_id: string | null;
  condition_id: string | null;
  condition_snapshot: AffiliateConditionSnapshot | null;
  base_cents: number;
  basis_kind: "net" | "gross";
  rate_kind: "percent" | "fixed";
  rate_bp: number;
  fixed_cents: number;
  is_test: boolean;
};

// --- Ergebnisform -------------------------------------------------------

/** Eine Zeile, wie die RPC sie zurückmeldet. */
export type AffiliateReversalBooking = {
  reverses_id: string;
  /** `null` nur bei einer übersprungenen Zeile. */
  id: string | null;
  parent_kind: AffiliateCommissionKind;
  partner_id: string;
  currency: string;
  target_cents: number;
  already_cents: number;
  /** Der gebuchte Betrag, NEGATIV (`0` bei einer übersprungenen Zeile). */
  amount_cents: number;
  /** `false` = die Gegenbuchung gab es schon (Stripes zweite Zustellung). */
  inserted: boolean;
  skipped_reason: string | null;
};

/**
 * Was der Partner erfährt: je `(partner_id, currency)` eine Summe. Nie eine
 * Summe über Währungen hinweg (5.11).
 */
export type AffiliateReversalNotification = {
  partner_id: string;
  currency: string;
  /** Positiv, in Cent — der zurückgenommene bzw. wiedergutgeschriebene Betrag. */
  amount_cents: number;
};

export type AffiliateReversalResult = {
  /**
   * `false` = zu diesem Vorgang gibt es überhaupt keine stornierbare
   * Provisionszeile. Das ist NICHT gleichbedeutend mit „nichts zu tun": es
   * kann auch heißen, dass die Buchung noch aussteht (Stripe stellt nicht in
   * Reihenfolge zu, 6.6). Die Entscheidung „warten oder abhaken" trifft der
   * Verarbeiter, nicht diese Datei — sie kennt den Zustand der Outbox nicht.
   */
  matched: boolean;
  /** Neu entstandene Zeilen. */
  booked: number;
  /** Zeilen, die es schon gab (Idempotenz, G3). */
  existing: number;
  /** Zeilen ohne Delta oder ohne Wert (Testbuchung, storniert, 0 Cent). */
  skipped: number;
  /** Summe der NEU gebuchten Gegenbuchungen, POSITIV. */
  reversed_cents: number;
  rows: AffiliateReversalBooking[];
  notifications: AffiliateReversalNotification[];
  /** Nur im Erstattungspfad gesetzt: was mit `orders` geschehen ist. */
  order_state?: Awaited<ReturnType<typeof applyOrderRefundState>>;
};

// --- Eingaben (CLAUDE.md §2.3: zod auf alles, was von außen kommt) ------

const tenantId = z.string().uuid();
const stripeId = z.string().min(1).max(255);
const cents = z.number().int().min(0);

/**
 * Die Herkunft des Vorgangs. MINDESTENS eine der beiden Kennungen muss stehen,
 * sonst gäbe es keine Abfrage, die die betroffenen Zeilen findet — und ein
 * Aufruf ohne Filter fände ALLE Zeilen des Mandanten. Genau das schließt die
 * Prüfung unten aus.
 */
const originShape = {
  tenant_id: tenantId,
  order_id: z.string().uuid().nullable().default(null),
  stripe_invoice_id: stripeId.nullable().default(null),
};

function requireOrigin(value: { order_id: string | null; stripe_invoice_id: string | null }): boolean {
  return value.order_id !== null || value.stripe_invoice_id !== null;
}

const ORIGIN_MESSAGE = "order_id oder stripe_invoice_id wird gebraucht.";

export const affiliateRefundInputSchema = z
  .object({
    ...originShape,
    stripe_charge_id: stripeId,
    /** `charge.amount_refunded` — KUMULATIV (G7). */
    refunded_total_cents: cents,
    /** `charge.amount` — die Bezugsgröße des Verhältnisses. */
    charge_total_cents: cents,
  })
  .refine(requireOrigin, { message: ORIGIN_MESSAGE });

export type AffiliateRefundInput = z.input<typeof affiliateRefundInputSchema>;

export const affiliateDisputeInputSchema = z
  .object({
    ...originShape,
    stripe_charge_id: stripeId,
    dispute_id: stripeId,
    /** `dispute.amount` — laut Typdefinition möglicherweise ein Teilbetrag (5.8). */
    dispute_amount_cents: cents,
    /**
     * `charge.amount`, sofern der Aufrufer ihn kennt. Ein `Stripe.Dispute`
     * trägt ihn NICHT. Fehlt er, wird der Streitbetrag selbst als Bezugsgröße
     * genommen — das ergibt ein Verhältnis von 1 und damit die Vollrücknahme,
     * die 5.8 für einen Chargeback ohnehin vorsieht.
     */
    charge_total_cents: cents.nullable().default(null),
  })
  .refine(requireOrigin, { message: ORIGIN_MESSAGE });

export type AffiliateDisputeInput = z.input<typeof affiliateDisputeInputSchema>;

export const affiliateRecreditInputSchema = z
  .object({
    ...originShape,
    dispute_id: stripeId,
  })
  .refine(requireOrigin, { message: ORIGIN_MESSAGE });

export type AffiliateRecreditInput = z.input<typeof affiliateRecreditInputSchema>;

// --- Kleine Helfer ------------------------------------------------------

/**
 * Protokolliert einen Datenbankfehler OHNE Nutzlast und ohne `error.message`
 * (CLAUDE.md §2.11) — identisch zu `logDbError()` im Verarbeiter.
 */
function logDbError(context: string, error: { code?: string } | null): void {
  console.error(
    `[affiliate/reversal] ${context} fehlgeschlagen (Code ${error?.code ?? "unbekannt"}).`,
  );
}

/**
 * Der Status-Eimer der Gegenbuchung, geerbt vom Elternteil (G6, 5.8):
 *
 *   `pending`/`on_hold` → derselbe Status, dasselbe `hold_until`. Die
 *       Gegenbuchung liegt im selben Eimer wie die Ursprungszeile, der Saldo
 *       „offen" bzw. „in Reserve" sinkt sofort, ausgezahlt wird am Ende der
 *       Frist nur der Rest (5.9 Beispiel D).
 *   `approved`/`paid`   → `approved` mit `hold_until = jetzt`, damit die
 *       Schuld die nächste Auszahlung sofort mindert. Es gibt keinen Rückweg
 *       von `paid` (6.3): Geld, das den Mandanten verlassen hat, wird nicht
 *       durch einen Statuswechsel zurückgeholt.
 *   `cancelled`         → `null`. Was nie werthaltig war, wird nicht
 *       zurückgenommen; der Aufrufer überspringt die Zeile.
 *
 * Rein und exportiert, weil genau hier der Fehler säße, den man im Saldo erst
 * Wochen später sieht.
 */
export function inheritReversalState(
  parent: { status: AffiliateCommissionStatus; hold_until: string },
  now: Date = new Date(),
): { status: "pending" | "on_hold" | "approved"; hold_until: string } | null {
  switch (parent.status) {
    case "pending":
      return { status: "pending", hold_until: parent.hold_until };
    case "on_hold":
      return { status: "on_hold", hold_until: parent.hold_until };
    case "approved":
    case "paid":
      return { status: "approved", hold_until: now.toISOString() };
    case "cancelled":
      return null;
  }
}

/** Je `(partner_id, currency)` eine Summe, stabil sortiert. */
function summarise(
  entries: ReadonlyArray<{ partner_id: string; currency: string; amount_cents: number }>,
): AffiliateReversalNotification[] {
  const buckets = new Map<string, AffiliateReversalNotification>();
  for (const entry of entries) {
    if (entry.amount_cents === 0) continue;
    const key = `${entry.partner_id} ${entry.currency}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { partner_id: entry.partner_id, currency: entry.currency, amount_cents: entry.amount_cents });
    } else {
      bucket.amount_cents += entry.amount_cents;
    }
  }
  return [...buckets.values()].sort(
    (a, b) => a.partner_id.localeCompare(b.partner_id) || a.currency.localeCompare(b.currency),
  );
}

/**
 * Das leere Ergebnis. Bewusst eine FUNKTION und keine Konstante: eine
 * Konstante gäbe bei jedem Aufruf dieselben `rows`/`notifications`-Arrays
 * heraus, und der erste Aufrufer, der eines davon anfasst, veränderte sie für
 * alle folgenden Aufrufe.
 */
function emptyResult(): AffiliateReversalResult {
  return { matched: false, booked: 0, existing: 0, skipped: 0, reversed_cents: 0, rows: [], notifications: [] };
}

// --- Lesen --------------------------------------------------------------

/**
 * Die stornierbaren Zeilen eines Vorgangs.
 *
 * ZWEI Abfragen statt einer `or`-Bedingung: `order_id` und
 * `stripe_invoice_id` sind zwei verschiedene Herkünfte desselben Charge (die
 * erste Rate eines Abos hat beide), und ein `or`-Filter in PostgREST wäre
 * eine zusammengesetzte Zeichenkette aus client-gelieferten Werten — genau
 * die String-Konkatenation, die CLAUDE.md §2.12 ausschließt. Beide Abfragen
 * sind an `tenant_id` gebunden (Plan 11.15).
 */
async function loadReversibleRows(
  admin: Admin,
  input: { tenant_id: string; order_id: string | null; stripe_invoice_id: string | null },
): Promise<ParentRow[]> {
  const found = new Map<string, ParentRow>();

  if (input.order_id !== null) {
    const { data, error } = await admin
      .from("affiliate_commissions")
      .select(PARENT_COLUMNS)
      .eq("tenant_id", input.tenant_id)
      .eq("order_id", input.order_id)
      .in("kind", AFFILIATE_REVERSIBLE_KINDS);
    if (error) {
      logDbError("Provisionszeilen zur Bestellung lesen", error);
      throw new Error("db_error");
    }
    for (const row of (data ?? []) as unknown as ParentRow[]) found.set(row.id, row);
  }

  if (input.stripe_invoice_id !== null) {
    const { data, error } = await admin
      .from("affiliate_commissions")
      .select(PARENT_COLUMNS)
      .eq("tenant_id", input.tenant_id)
      .eq("stripe_invoice_id", input.stripe_invoice_id)
      .in("kind", AFFILIATE_REVERSIBLE_KINDS);
    if (error) {
      logDbError("Provisionszeilen zur Rechnung lesen", error);
      throw new Error("db_error");
    }
    for (const row of (data ?? []) as unknown as ParentRow[]) found.set(row.id, row);
  }

  // Stabile Reihenfolge: der Stapel soll bei gleicher Ausgangslage gleich
  // aussehen, damit ein Vergleich zweier Läufe etwas aussagt.
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Die Gegenbuchungen zu einer Menge von Ursprungszeilen. */
async function loadReversalRows(admin: Admin, tenantIdValue: string, parentIds: string[]): Promise<ReversalRow[]> {
  if (parentIds.length === 0) return [];
  const { data, error } = await admin
    .from("affiliate_commissions")
    .select(REVERSAL_COLUMNS)
    .eq("tenant_id", tenantIdValue)
    .eq("kind", "reversal")
    .in("reverses_id", parentIds);
  if (error) {
    logDbError("Gegenbuchungen lesen", error);
    throw new Error("db_error");
  }
  return (data ?? []) as unknown as ReversalRow[];
}

/** Die Wiedergutschriften zu einer Menge von Gegenbuchungen. */
async function loadRecreditRows(admin: Admin, tenantIdValue: string, reversalIds: string[]): Promise<ReversalRow[]> {
  if (reversalIds.length === 0) return [];
  const { data, error } = await admin
    .from("affiliate_commissions")
    .select(REVERSAL_COLUMNS)
    .eq("tenant_id", tenantIdValue)
    .eq("kind", "recredit")
    .in("reverses_id", reversalIds);
  if (error) {
    logDbError("Wiedergutschriften lesen", error);
    throw new Error("db_error");
  }
  return (data ?? []) as unknown as ReversalRow[];
}

/**
 * Der bereits gegengebuchte Stand je Ursprungszeile, NETTO und POSITIV.
 *
 * Netto heißt: minus die Wiedergutschriften zu eben diesen Gegenbuchungen.
 * Ohne diesen Abzug bliebe nach einem gewonnenen Streitfall ein Stand stehen,
 * der fachlich zurückgenommen ist — eine spätere echte Erstattung derselben
 * Bestellung buchte dann nichts mehr. Dieselbe Rechnung steht in
 * `book_affiliate_reversals()`; dort ist sie verbindlich, hier entscheidet sie
 * nur, ob der Aufruf lohnt.
 *
 * K3 (Gegenlesen 11.09.2026): STORNIERTE Zeilen zählen in KEINEM Saldo (6.1)
 * — auch nicht in diesem. Vorher zählten sie mit, und zwar auf beiden Seiten:
 * eine stornierte Gegenbuchung ließ die spätere echte Erstattung als
 * `no_delta` durchfallen, eine stornierte Wiedergutschrift senkte den Stand
 * fälschlich. Die verbindliche Rechnung in `book_affiliate_reversals()` filtert
 * seit derselben Korrektur ebenso; weichen die beiden voneinander ab, enthält
 * der Stapel Zeilen, die die RPC dann überspringt.
 */
function netReversedByParent(
  reversals: readonly ReversalRow[],
  recredits: readonly ReversalRow[],
): Map<string, number> {
  const byReversalId = new Map<string, ReversalRow>();
  const net = new Map<string, number>();

  for (const row of reversals) {
    if (row.reverses_id === null) continue;
    if (row.status === "cancelled") continue;
    byReversalId.set(row.id, row);
    net.set(row.reverses_id, (net.get(row.reverses_id) ?? 0) - row.amount_cents);
  }
  for (const row of recredits) {
    if (row.reverses_id === null) continue;
    if (row.status === "cancelled") continue;
    // Eine Wiedergutschrift zu einer stornierten Gegenbuchung findet ihren
    // Elternteil hier nicht mehr — genau wie in der RPC, wo der `join` an
    // `r2.status <> 'cancelled'` scheitert. Das Paar fällt komplett heraus.
    const reversal = byReversalId.get(row.reverses_id);
    if (reversal === undefined || reversal.reverses_id === null) continue;
    net.set(reversal.reverses_id, (net.get(reversal.reverses_id) ?? 0) - row.amount_cents);
  }

  for (const [key, value] of net) net.set(key, Math.max(0, value));
  return net;
}

// --- Schreiben ----------------------------------------------------------

type ReversalPayloadRow = {
  reverses_id: string;
  target_cents: number;
  status: "pending" | "on_hold" | "approved";
  hold_until: string;
  note: string;
  stripe_charge_id: string | null;
  dedup_key: string;
};

type ReversalRpcResult = {
  booked?: number;
  existing?: number;
  skipped?: number;
  reversed_cents?: number;
  rows?: AffiliateReversalBooking[];
};

/**
 * Der Aufruf von `book_affiliate_reversals()` (Migration 20260911140000). Die
 * RPC hält die Sperre, rechnet die Differenz aus frischem Stand und deckelt
 * den Zielwert auf die Ursprungszeile — hier wird nur zusammengesetzt und
 * ausgewertet.
 */
async function bookReversalRows(
  admin: Admin,
  request: { tenant_id: string; lock_key: string; rows: ReversalPayloadRow[] },
): Promise<AffiliateReversalResult> {
  const { data, error } = await admin.rpc("book_affiliate_reversals", { p_payload: request });
  if (error) {
    logDbError("book_affiliate_reversals", error);
    throw new Error("booking_failed");
  }

  const result = (data ?? {}) as ReversalRpcResult;
  const rows = Array.isArray(result.rows) ? result.rows : [];
  return {
    matched: true,
    booked: result.booked ?? 0,
    existing: result.existing ?? 0,
    skipped: result.skipped ?? 0,
    reversed_cents: result.reversed_cents ?? 0,
    rows,
    // Nur NEU gebuchte Zeilen lösen eine Nachricht aus: eine zweite Zustellung
    // desselben Stripe-Ereignisses darf den Partner nicht ein zweites Mal
    // anschreiben (G3).
    notifications: summarise(
      rows
        .filter((row) => row.inserted)
        .map((row) => ({
          partner_id: row.partner_id,
          currency: row.currency,
          amount_cents: Math.abs(row.amount_cents),
        })),
    ),
  };
}

/**
 * Der gemeinsame Rumpf von Erstattung und Rückbuchung: Zeilen lesen, Zielwert
 * je Zeile rechnen, Stapel bauen, buchen.
 */
async function reverseAgainstCharge(
  admin: Admin,
  params: {
    tenant_id: string;
    order_id: string | null;
    stripe_invoice_id: string | null;
    stripe_charge_id: string | null;
    /** Der kumulative Erstattungs- bzw. der Streitbetrag. */
    refunded_total_cents: number;
    charge_total_cents: number;
    /** Geht in den `dedup_key`: `charge.id` bei der Erstattung, `dispute.id` beim Streitfall. */
    source_id: string;
    note: (parent: ParentRow) => string;
    lock_key: string;
    now: Date;
  },
): Promise<AffiliateReversalResult> {
  const parents = await loadReversibleRows(admin, params);
  if (parents.length === 0) return emptyResult();

  const parentIds = parents.map((row) => row.id);
  const reversals = await loadReversalRows(admin, params.tenant_id, parentIds);
  const recredits = await loadRecreditRows(
    admin,
    params.tenant_id,
    reversals.map((row) => row.id),
  );
  const already = netReversedByParent(reversals, recredits);

  const rows: ReversalPayloadRow[] = [];
  for (const parent of parents) {
    // Eine Testbuchung ist per CHECK immer `cancelled`; beide Fälle fallen
    // hier heraus, ohne dass es dafür zwei Regeln braucht.
    const state = inheritReversalState(parent, params.now);
    if (state === null || parent.is_test) continue;

    const delta = computeReversalDelta({
      amount_cents: parent.amount_cents,
      refunded_total_cents: params.refunded_total_cents,
      charge_total_cents: params.charge_total_cents,
      already_reversed_cents: already.get(parent.id) ?? 0,
    });
    if (!delta.should_book) continue;

    rows.push({
      reverses_id: parent.id,
      // Der ZIELWERT, nicht das Delta: die Differenz zieht die RPC unter der
      // Sperre aus frischem Stand (G7).
      target_cents: delta.target_cents,
      status: state.status,
      hold_until: state.hold_until,
      note: params.note(parent),
      stripe_charge_id: params.stripe_charge_id,
      dedup_key: buildDedupKey({
        kind: "reversal",
        reverses_id: parent.id,
        source_id: params.source_id,
        // Der kumulative Stand macht jede Stufe einer Teilerstattung zu einem
        // eigenen Schlüssel — und jede Wiederholung derselben Stufe zu
        // derselben Zeile (G3/G7).
        refunded_total_cents: params.refunded_total_cents,
      }),
    });
  }

  if (rows.length === 0) {
    return { ...emptyResult(), matched: true };
  }

  return bookReversalRows(admin, {
    tenant_id: params.tenant_id,
    lock_key: params.lock_key,
    rows,
  });
}

// --- 1. Erstattung: `charge.refunded` -----------------------------------

/**
 * Eine (Teil-)Erstattung (5.8, 5.9 Beispiel C).
 *
 * `refunded_total_cents` ist `charge.amount_refunded` und damit KUMULATIV.
 * Die Funktion ist deshalb auch bei mehrfacher Zustellung DESSELBEN Standes
 * folgenlos (gleicher `dedup_key`) und bei einem NEUEN Stand exakt die
 * Differenz — nie mehr.
 *
 * Zusätzlich wird `orders.refunded_cents`/`orders.status` nachgeführt (5.8,
 * letzter Absatz). Das geschieht NACH der Buchung und ist ausdrücklich nicht
 * fehlertolerant: schlüge es still fehl, stünde in der Bestellübersicht des
 * Mandanten dauerhaft „bezahlt", während das Geld zurück ist. Der Wurf führt
 * zu einem erneuten Versuch, und die Buchung darüber ist idempotent.
 */
export async function reverseForRefund(
  admin: Admin,
  input: AffiliateRefundInput,
  now: Date = new Date(),
): Promise<AffiliateReversalResult> {
  const parsed = affiliateRefundInputSchema.parse(input);

  const result = await reverseAgainstCharge(admin, {
    tenant_id: parsed.tenant_id,
    order_id: parsed.order_id,
    stripe_invoice_id: parsed.stripe_invoice_id,
    stripe_charge_id: parsed.stripe_charge_id,
    refunded_total_cents: parsed.refunded_total_cents,
    charge_total_cents: parsed.charge_total_cents,
    source_id: parsed.stripe_charge_id,
    lock_key: `charge:${parsed.stripe_charge_id}`,
    now,
    note: (parent) =>
      `Storno (${parent.kind}) zur Erstattung: ${parsed.refunded_total_cents} von ` +
      `${parsed.charge_total_cents} Cent erstattet (Charge ${parsed.stripe_charge_id}).`,
  });

  // Der Bestellzustand wird auch dann nachgeführt, wenn es zu dieser
  // Bestellung gar keine Provision gibt: `refunded_cents` gehört der
  // Bestellung, nicht dem Affiliate-Modul (5.8).
  if (parsed.order_id !== null) {
    result.order_state = await applyOrderRefundState(admin, {
      tenant_id: parsed.tenant_id,
      order_id: parsed.order_id,
      refunded_total_cents: parsed.refunded_total_cents,
      charge_total_cents: parsed.charge_total_cents,
    });
  }

  return result;
}

// --- 2. Rückbuchung: `charge.dispute.created` ---------------------------

/**
 * Eine Rückbuchung (5.8): wie eine Erstattung über `dispute.amount` — der
 * Betrag kann laut Typdefinition ein Teilbetrag sein, deshalb wird er nicht
 * als „voller Charge" angenommen.
 *
 * Zusätzlich wird auf ALLEN Zeilen des betroffenen Partners aus den letzten 30
 * Tagen `flagged = true` gesetzt: ein Chargeback ist auch ein Betrugssignal.
 * Die Wirkung ist genau eine — der Freigabelauf lässt geflaggte Zeilen liegen
 * (6.4), ein Mensch entscheidet. Es wird KEIN Status geändert (G6).
 */
export async function reverseForDispute(
  admin: Admin,
  input: AffiliateDisputeInput,
  now: Date = new Date(),
): Promise<AffiliateReversalResult> {
  const parsed = affiliateDisputeInputSchema.parse(input);
  const chargeTotal =
    parsed.charge_total_cents !== null && parsed.charge_total_cents > 0
      ? parsed.charge_total_cents
      : parsed.dispute_amount_cents;

  const result = await reverseAgainstCharge(admin, {
    tenant_id: parsed.tenant_id,
    order_id: parsed.order_id,
    stripe_invoice_id: parsed.stripe_invoice_id,
    stripe_charge_id: parsed.stripe_charge_id,
    refunded_total_cents: parsed.dispute_amount_cents,
    charge_total_cents: chargeTotal,
    // Die STREITFALL-Kennung, nicht die des Charge: nur so findet der
    // Wiedergutschriftspfad später genau die Gegenbuchungen wieder, die dieser
    // Streitfall ausgelöst hat — und nicht die einer daneben laufenden
    // Erstattung desselben Charge.
    source_id: parsed.dispute_id,
    lock_key: `dispute:${parsed.dispute_id}`,
    now,
    note: (parent) =>
      `Storno (${parent.kind}) zur Rückbuchung: ${parsed.dispute_amount_cents} von ` +
      `${chargeTotal} Cent (Dispute ${parsed.dispute_id}).`,
  });

  const partnerIds = [...new Set(result.rows.map((row) => row.partner_id))];
  await flagPartnerCommissions(admin, parsed.tenant_id, partnerIds, parsed.dispute_id, now);

  return result;
}

/** Der Aufbewahrungszeitraum des Betrugsflags aus 5.8. */
export const AFFILIATE_DISPUTE_FLAG_DAYS = 30;

/**
 * Setzt das Betrugsflag auf den Zeilen der letzten 30 Tage (5.8).
 *
 * `flagged`/`flag_reason` sind die einzigen Felder, die der
 * Unveränderlichkeits-Guard an einer gebuchten Zeile noch zulässt
 * (Migration 20260911130000) — der Lebenslauf der Zeile bleibt unberührt.
 * Der Fehler wird protokolliert und NICHT geworfen: das Flag ist ein Hinweis
 * an einen Menschen, die Gegenbuchung darüber ist das Geld. Ein misslungener
 * Hinweis darf keine bereits gebuchte Rücknahme wiederholen lassen.
 */
async function flagPartnerCommissions(
  admin: Admin,
  tenantIdValue: string,
  partnerIds: readonly string[],
  disputeId: string,
  now: Date,
): Promise<void> {
  if (partnerIds.length === 0) return;
  const since = new Date(now.getTime() - AFFILIATE_DISPUTE_FLAG_DAYS * 86_400_000).toISOString();

  const { error } = await admin
    .from("affiliate_commissions")
    .update({ flagged: true, flag_reason: `chargeback:${disputeId}` })
    .eq("tenant_id", tenantIdValue)
    .in("partner_id", partnerIds)
    .gte("created_at", since)
    .eq("flagged", false);
  if (error) logDbError("Betrugsflag setzen", error);
}

// --- 3. Wiedergutschrift: `charge.dispute.closed` (won) -----------------

/**
 * Ein GEWONNENER Streitfall (5.8): der Händler hat sein Geld, also bekommt der
 * Partner seine Provision zurück. Ohne diesen Pfad bliebe die Gegenbuchung
 * dauerhaft stehen.
 *
 * Je Gegenbuchung DIESES Streitfalls entsteht eine `recredit`-Zeile mit dem
 * exakten Gegenbetrag und `reverses_id` auf die Gegenbuchung. Es wird nichts
 * neu gerechnet: der Betrag ist bekannt, ein Verhältnis gäbe nur die
 * Gelegenheit, einen Cent zu verlieren.
 *
 * Erkannt werden „die Gegenbuchungen dieses Streitfalls" am `dedup_key`
 * (`reversal:<reverses_id>:<dispute_id>:<betrag>`, 3.11). Der Vergleich läuft
 * im TypeScript über die zerlegten Bestandteile und NICHT als
 * `like`-Filter aus zusammengesetzten Zeichenketten (CLAUDE.md §2.12); der
 * Filter an die Datenbank bleibt die Mengenabfrage `in (...)`.
 *
 * ABWEICHUNG VOM PLAN-WORTLAUT, mit Anlass: 6.2 schreibt für die
 * Wiedergutschrift `status='approved'`. Hier erbt sie stattdessen den Zustand
 * IHRER Gegenbuchung (dieselbe Regel wie G6). Grund: stand die Gegenbuchung
 * noch auf `pending`, weil auch die Ursprungsprovision noch in der Sperrfrist
 * ist, machte ein sofortiges `approved` aus einer zurückgenommenen Rücknahme
 * auszahlbares Geld — die Sperrfrist der Ursprungsprovision wäre umgangen. Für
 * den im Plan gemeinten Regelfall (Rückbuchung auf bereits freigegebenes oder
 * ausgezahltes Geld) liefert die Regel genau das, was dort steht: `approved`
 * mit `hold_until = jetzt`.
 */
export async function recreditForWonDispute(
  admin: Admin,
  input: AffiliateRecreditInput,
  now: Date = new Date(),
): Promise<AffiliateReversalResult> {
  const parsed = affiliateRecreditInputSchema.parse(input);

  const parents = await loadReversibleRows(admin, parsed);
  if (parents.length === 0) return emptyResult();

  const reversals = await loadReversalRows(
    admin,
    parsed.tenant_id,
    parents.map((row) => row.id),
  );
  // `status !== "cancelled"`: eine stornierte Gegenbuchung zählt in keinem
  // Saldo (6.1), sie wiedergutzuschreiben hieße Geld ohne Gegenstück zu
  // buchen. Seit K2 weist der Unveränderlichkeits-Guard genau das ab
  // (`affiliate_commission_recredit_parent_cancelled`) — ohne diesen Filter
  // risse eine einzige von Hand stornierte Gegenbuchung den ganzen Stapel
  // dieses Streitfalls mit.
  const fromDispute = reversals.filter(
    (row) => row.status !== "cancelled" && dedupSourceId(row.dedup_key) === parsed.dispute_id,
  );
  if (fromDispute.length === 0) return { ...emptyResult(), matched: true };

  // Bereits vorhandene Wiedergutschriften: sie werden nicht ein zweites Mal
  // gebaut. Die Idempotenz hinge ohnehin am `dedup_key`, aber ein Stapel, der
  // ausschließlich aus `do nothing` besteht, meldete dem Partner eine
  // Wiedergutschrift über 0 Cent.
  const existing = new Set(
    (await loadRecreditRows(admin, parsed.tenant_id, fromDispute.map((row) => row.id))).map(
      (row) => row.reverses_id,
    ),
  );

  // `book_affiliate_commissions()` nimmt EIN `program_id` je Aufruf (Migration
  // 20260911130000) — bei mehreren Programmen entsteht je Programm ein Stapel.
  // In der Praxis hat ein Mandant genau ein Programm; die Gruppierung kostet
  // nichts und verhindert eine falsche Zuordnung, falls das je anders ist.
  const byProgram = new Map<string, ReversalRow[]>();
  for (const row of fromDispute) {
    if (existing.has(row.id)) continue;
    if (row.amount_cents >= 0) continue;
    const group = byProgram.get(row.program_id);
    if (group === undefined) byProgram.set(row.program_id, [row]);
    else group.push(row);
  }

  if (byProgram.size === 0) return { ...emptyResult(), matched: true };

  const bookings: AffiliateReversalBooking[] = [];
  let booked = 0;
  let existingCount = 0;
  let sum = 0;

  for (const [programId, group] of byProgram) {
    const payloadRows = group.map((row, index) => {
      const state = inheritReversalState(row, now) ?? { status: "approved" as const, hold_until: now.toISOString() };
      return {
        ref: `recredit_${index}`,
        kind: "recredit" as const,
        partner_id: row.partner_id,
        parent_ref: null,
        order_id: row.order_id,
        stripe_invoice_id: row.stripe_invoice_id,
        stripe_subscription_id: row.stripe_subscription_id,
        stripe_charge_id: row.stripe_charge_id,
        product_id: row.product_id,
        campaign: row.campaign,
        referral_id: row.referral_id,
        parent_id: null,
        reverses_id: row.id,
        base_cents: row.base_cents,
        basis_kind: row.basis_kind,
        rate_kind: row.rate_kind,
        rate_bp: row.rate_bp,
        fixed_cents: row.fixed_cents,
        // Der exakte Gegenbetrag der Gegenbuchung, positiv (CHECK der Tabelle).
        amount_cents: -row.amount_cents,
        currency: row.currency,
        condition_id: row.condition_id,
        condition_snapshot: row.condition_snapshot ?? ({} as AffiliateConditionSnapshot),
        status: state.status,
        cancel_reason: null,
        hold_until: state.hold_until,
        flagged: false,
        flag_reason: null,
        is_test: row.is_test,
        note: `Wiedergutschrift zum gewonnenen Streitfall ${parsed.dispute_id}.`,
        dedup_key: buildDedupKey({ kind: "recredit", reverses_id: row.id, dispute_id: parsed.dispute_id }),
      };
    });

    const { data, error } = await admin.rpc("book_affiliate_commissions", {
      p_payload: {
        tenant_id: parsed.tenant_id,
        program_id: programId,
        lock_key: `recredit:${parsed.dispute_id}`,
        rows: payloadRows,
      },
    });
    if (error) {
      logDbError("book_affiliate_commissions (recredit)", error);
      throw new Error("booking_failed");
    }

    const returned = ((data ?? {}) as { rows?: Array<{ ref: string; id: string; inserted: boolean }> }).rows ?? [];
    for (const entry of returned) {
      const source = payloadRows.find((row) => row.ref === entry.ref);
      if (source === undefined) continue;
      if (entry.inserted) {
        booked += 1;
        sum += source.amount_cents;
      } else {
        existingCount += 1;
      }
      bookings.push({
        reverses_id: source.reverses_id,
        id: entry.id,
        // Die Art der Zeile, auf die sich die Wiedergutschrift bezieht: das
        // ist die GEGENBUCHUNG, nicht die Ursprungsprovision (3.11).
        parent_kind: "reversal",
        partner_id: source.partner_id,
        currency: source.currency,
        target_cents: source.amount_cents,
        already_cents: 0,
        amount_cents: source.amount_cents,
        inserted: entry.inserted,
        skipped_reason: null,
      });
    }
  }

  return {
    matched: true,
    booked,
    existing: existingCount,
    skipped: 0,
    reversed_cents: sum,
    rows: bookings,
    notifications: summarise(
      bookings
        .filter((row) => row.inserted)
        .map((row) => ({ partner_id: row.partner_id, currency: row.currency, amount_cents: row.amount_cents })),
    ),
  };
}

/**
 * Der Quellenteil eines Gegenbuchungs-Schlüssels
 * (`reversal:<reverses_id>:<source_id>:<betrag>`, 3.11). `null`, wenn der
 * Schlüssel nicht dieser Form folgt — dann gehört die Zeile nicht zu einem
 * Streitfall, den dieser Pfad kennt.
 */
function dedupSourceId(dedupKey: string): string | null {
  const parts = dedupKey.split(":");
  return parts.length === 4 && parts[0] === "reversal" ? parts[2] : null;
}
