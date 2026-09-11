import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Affiliate-System, Block B4 — Tests des VERARBEITERS
 * (`src/lib/affiliate/process.ts`, Plan 6.5 und 6.6, Rechenregeln 5.1 bis
 * 5.7, Grundsatzentscheidungen G1, G3, G5, G13).
 *
 * Mock-Muster wie in `src/lib/marketplace/fulfil.test.ts:42-134` — das
 * einzige Muster im Repo, um Supabase ohne echte Datenbank zu prüfen: ein
 * In-Memory-Array je Tabelle, ECHT angewandte Filter, echte
 * `onConflict`-Auswertung und Fehler-Injektion über `db.errors`. Hier auf das
 * erweitert, was der Verarbeiter zusätzlich braucht: `in`/`lt`/`gte`/`is`/
 * `not`/`order`, den Compare-and-Swap `update(...).eq(...).select(...)` und
 * die vier RPCs.
 *
 * Die RPC `book_affiliate_commissions` ist im Mock NACHGEBAUT und nicht bloß
 * eine Attrappe: sie entdoppelt über `(tenant_id, dedup_key)`, löst
 * `parent_ref` innerhalb des Stapels auf und liefert bei einer bereits
 * vorhandenen Zeile deren BESTEHENDE Kennung zurück (`inserted: false`). Ohne
 * diese drei Eigenschaften prüfte der Idempotenz-Test nichts.
 *
 * Was hier bewusst NICHT geprüft wird: die Rechenregeln selbst. Die stehen in
 * `compute.ts` und sind dort ohne Datenbank getestet (`compute.test.ts`).
 * Geprüft wird, dass der Verarbeiter die richtigen EINGABEN liefert und das
 * Ergebnis richtig ablegt — und vor allem sein eigentlicher Auftrag: dass
 * kein Geldereignis verloren geht (6.6).
 */

type Row = Record<string, unknown>;
type MockError = { code?: string; message: string };

const { db, rpcCalls, MockAdminClient } = vi.hoisted(() => {
  const db: {
    tables: Record<string, Row[]>;
    /** Fehler-Injektion je Tabelle (wie `tablesRef.errors` im Vorbild). */
    errors: Record<string, MockError | undefined>;
    /** Fehler-Injektion je RPC-Name. */
    rpcErrors: Record<string, MockError | undefined>;
    /** Giftzeilen-Simulation: die nächsten n Lesezugriffe auf die Tabelle WERFEN. */
    throwOnSelect: { table: string; remaining: number } | null;
    /** Nebenläufigkeit: läuft VOR jedem Update und darf die Tabelle verändern. */
    beforeUpdate: ((table: string) => void) | null;
    nextId: number;
  } = {
    tables: {},
    errors: {},
    rpcErrors: {},
    throwOnSelect: null,
    beforeUpdate: null,
    nextId: 0,
  };

  function tableRows(table: string): Row[] {
    return db.tables[table] ?? (db.tables[table] = []);
  }

  function nextId(prefix: string): string {
    db.nextId += 1;
    return `${prefix}_${db.nextId}`;
  }

  /** Der Berliner Berichtstag — dieselbe Grenze wie `berlinDay()` im Verarbeiter. */
  function berlinDay(at: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  }

  function compare(left: unknown, right: unknown): number {
    if (typeof left === "number" && typeof right === "number") return left - right;
    return String(left ?? "").localeCompare(String(right ?? ""));
  }

  /**
   * Eine Lesekette. Jeder Filter wird SOFORT auf die Kopie angewandt, damit
   * der Test denselben Weg nimmt wie PostgREST und nicht nur zählt, dass ein
   * Filter gesetzt wurde.
   */
  class MockSelect {
    constructor(
      private table: string,
      private rows: Row[],
    ) {}

    eq(column: string, value: unknown): this {
      this.rows = this.rows.filter((r) => r[column] === value);
      return this;
    }
    in(column: string, values: readonly unknown[]): this {
      this.rows = this.rows.filter((r) => values.includes(r[column]));
      return this;
    }
    lt(column: string, value: number): this {
      this.rows = this.rows.filter((r) => Number(r[column] ?? 0) < value);
      return this;
    }
    gte(column: string, value: unknown): this {
      this.rows = this.rows.filter((r) => r[column] != null && compare(r[column], value) >= 0);
      return this;
    }
    lte(column: string, value: unknown): this {
      this.rows = this.rows.filter((r) => r[column] != null && compare(r[column], value) <= 0);
      return this;
    }
    is(column: string, value: null): this {
      this.rows = this.rows.filter((r) => (value === null ? r[column] == null : r[column] === value));
      return this;
    }
    not(column: string, operator: string, value: null): this {
      if (operator === "is" && value === null) {
        this.rows = this.rows.filter((r) => r[column] != null);
      }
      return this;
    }
    order(column: string, options?: { ascending?: boolean }): this {
      const direction = options?.ascending === false ? -1 : 1;
      this.rows = [...this.rows].sort((a, b) => direction * compare(a[column], b[column]));
      return this;
    }
    limit(count: number): this {
      this.rows = this.rows.slice(0, count);
      return this;
    }

    private resolve(): { data: Row[] | null; error: MockError | null } {
      const thrown = db.throwOnSelect;
      if (thrown !== null && thrown.table === this.table && thrown.remaining > 0) {
        thrown.remaining -= 1;
        // KEIN `{ error }`, sondern ein echter Wurf: genau so verhält sich ein
        // Netzabbruch, und genau das ist die Giftzeile aus 6.5 a.
        throw new Error("mock: Verbindung abgebrochen");
      }
      const error = db.errors[this.table];
      if (error) return { data: null, error };
      return { data: this.rows.map((r) => ({ ...r })), error: null };
    }

    maybeSingle(): Promise<{ data: Row | null; error: MockError | null }> {
      const { data, error } = this.resolve();
      return Promise.resolve({ data: data?.[0] ?? null, error });
    }
    then<T>(onFulfilled: (v: { data: Row[] | null; error: MockError | null }) => T): Promise<T> {
      return Promise.resolve(onFulfilled(this.resolve()));
    }
  }

  /**
   * Ein `update`. `select()` macht daraus den Compare-and-Swap: die Rückgabe
   * trägt genau die Zeilen, die der Filter GETROFFEN hat — leer heißt, ein
   * anderer Lauf war schneller.
   */
  class MockUpdate {
    private predicates: Array<(row: Row) => boolean> = [];
    constructor(
      private table: string,
      private patch: Row,
    ) {}

    eq(column: string, value: unknown): this {
      this.predicates.push((r) => r[column] === value);
      return this;
    }
    is(column: string, value: null): this {
      this.predicates.push((r) => (value === null ? r[column] == null : r[column] === value));
      return this;
    }
    /**
     * `lt` und `in` am UPDATE — `applyOrderRefundState()` baut damit den
     * Compare-and-Swap auf `orders.refunded_cents` (Monotonie, 5.8) und die
     * Erlaubnisliste der Bestellzustände.
     *
     * `lt` bildet ausdrücklich die SQL-Semantik ab: ein Vergleich gegen
     * `null` ist in Postgres `null` und damit NICHT wahr — die Zeile fällt
     * heraus. Ein Mock, der hier `0 < x` annähme, verspräche eine Monotonie,
     * die die Datenbank so nicht hat.
     */
    lt(column: string, value: number): this {
      this.predicates.push((r) => typeof r[column] === "number" && (r[column] as number) < value);
      return this;
    }
    in(column: string, values: readonly unknown[]): this {
      this.predicates.push((r) => values.includes(r[column]));
      return this;
    }
    /** Fenstergrenze des Betrugsflags: `flagPartnerCommissions()`, 30 Tage (5.8). */
    gte(column: string, value: unknown): this {
      this.predicates.push((r) => r[column] != null && String(r[column]) >= String(value));
      return this;
    }

    private resolve(): { data: Row[] | null; error: MockError | null } {
      const error = db.errors[this.table];
      if (error) return { data: null, error };
      db.beforeUpdate?.(this.table);
      const matched = tableRows(this.table).filter((r) => this.predicates.every((p) => p(r)));
      for (const row of matched) Object.assign(row, this.patch);
      return { data: matched.map((r) => ({ ...r })), error: null };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().update().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
    select(_columns: string): { then: MockUpdate["then"] } {
      return { then: (onFulfilled) => this.then(onFulfilled) };
    }
    then<T>(onFulfilled: (v: { data: Row[] | null; error: MockError | null }) => T): Promise<T> {
      return Promise.resolve(onFulfilled(this.resolve()));
    }
  }

  class MockUpsert {
    constructor(
      private table: string,
      private payload: Row | Row[],
      private options: { onConflict: string; ignoreDuplicates?: boolean },
    ) {}

    private resolve(): { error: MockError | null } {
      const error = db.errors[this.table];
      if (error) return { error };
      const keys = this.options.onConflict.split(",").map((k) => k.trim());
      const rows = tableRows(this.table);
      for (const entry of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const index = rows.findIndex((r) => keys.every((k) => r[k] === entry[k]));
        if (index >= 0) {
          if (!this.options.ignoreDuplicates) rows[index] = { ...rows[index], ...entry };
        } else {
          rows.push({ ...entry });
        }
      }
      return { error: null };
    }
    then<T>(onFulfilled: (v: { error: MockError | null }) => T): Promise<T> {
      return Promise.resolve(onFulfilled(this.resolve()));
    }
  }

  class MockTable {
    constructor(private table: string) {}
    select(columns: string): MockSelect {
      // Das SELECT-Recht auf den Affiliate-Tabellen ist ein SPALTEN-Grant
      // (Migrationen 20260910120000 und 20260911120000): `select("*")` bricht
      // dort mit 42501 ab. Der Mock hält die Regel fest, damit sie nicht erst
      // in der Produktion auffällt.
      if (columns.trim() === "*") {
        return new MockSelect(this.table, []) as MockSelect & { __denied: true };
      }
      return new MockSelect(this.table, [...tableRows(this.table)]);
    }
    update(patch: Row): MockUpdate {
      return new MockUpdate(this.table, patch);
    }
    upsert(payload: Row | Row[], options: { onConflict: string; ignoreDuplicates?: boolean }): MockUpsert {
      return new MockUpsert(this.table, payload, options);
    }
  }

  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  /**
   * Nachbau von `book_affiliate_commissions` (Migration 20260911130000,
   * Abschnitt 4) — mit den drei Eigenschaften, auf denen die Idempotenz
   * beruht: Pflichtfeld `lock_key`, `on conflict (tenant_id, dedup_key) do
   * nothing` und die Auflösung von `parent_ref` INNERHALB des Stapels.
   */
  function bookAffiliateCommissions(payload: {
    tenant_id?: string;
    program_id?: string;
    lock_key?: string;
    rows?: Array<Record<string, unknown>>;
  }): { data: Row | null; error: MockError | null } {
    if (!payload?.tenant_id || !payload?.program_id || !payload?.lock_key) {
      return { data: null, error: { code: "P0001", message: "affiliate_book_payload_incomplete" } };
    }
    const rows = payload.rows ?? [];
    if (rows.length === 0) {
      return { data: null, error: { code: "P0001", message: "affiliate_book_rows_empty" } };
    }

    const refs: Record<string, string> = {};
    const result: Row[] = [];
    let inserted = 0;
    let existing = 0;

    for (const entry of rows) {
      const { ref, parent_ref: parentRef, ...columns } = entry as Record<string, unknown> & {
        ref: string;
        parent_ref: string | null;
      };
      const dedupKey = String(columns.dedup_key ?? "");
      const stored = tableRows("affiliate_commissions");
      const found = stored.find(
        (r) => r.tenant_id === payload.tenant_id && r.dedup_key === dedupKey,
      );
      if (found) {
        refs[ref] = String(found.id);
        existing += 1;
        result.push({ ref, id: found.id, dedup_key: dedupKey, inserted: false });
        continue;
      }

      let parentId = (columns.parent_id as string | null) ?? null;
      if (typeof parentRef === "string" && parentRef.length > 0) {
        if (!(parentRef in refs)) {
          return { data: null, error: { code: "P0001", message: "affiliate_book_parent_ref_unknown" } };
        }
        parentId = refs[parentRef];
      }

      const id = nextId("com");
      stored.push({
        ...columns,
        id,
        tenant_id: payload.tenant_id,
        program_id: payload.program_id,
        parent_id: parentId,
        booked_at: berlinDay(new Date()),
        created_at: new Date().toISOString(),
      });
      refs[ref] = id;
      inserted += 1;
      result.push({ ref, id, dedup_key: dedupKey, inserted: true });
    }

    return {
      data: { tenant_id: payload.tenant_id, lock_key: payload.lock_key, inserted, existing, rows: result },
      error: null,
    };
  }

  /** Nachbau von `approve_due_affiliate_commissions` — Rückgabe ist ein OBJEKT. */
  function approveDue(limit: number): { data: Row; error: null } {
    const now = Date.now();
    const due = tableRows("affiliate_commissions")
      .filter(
        (r) =>
          r.status === "pending" &&
          r.flagged !== true &&
          r.is_test !== true &&
          Date.parse(String(r.hold_until)) <= now,
      )
      .slice(0, limit);
    for (const row of due) row.status = "approved";
    return {
      data: { approved: due.length, limit, rows: due.map((r) => ({ id: r.id, tenant_id: r.tenant_id })) },
      error: null,
    };
  }

  /**
   * Nachbau von `book_affiliate_reversals()` (Migration 20260911140000) —
   * hier bewusst SCHMAL: die Storno-ARITHMETIK (Deckel, kumulative Differenz,
   * Entdopplung) ist in `reversal.test.ts` gegen einen vollständigen Nachbau
   * geprüft und wird hier nicht zum zweiten Mal nachgebaut. Was diese Datei
   * prüft, ist die VERDRAHTUNG: dass `processAffiliateQueue()` ein
   * `charge.refunded` überhaupt an den Storno-Pfad reicht, statt es — wie
   * zwischen B4 und B5 — zurückzustellen.
   *
   * Die beiden Pflichtfelder werden trotzdem geprüft: ein Aufruf ohne
   * `tenant_id`/`lock_key` ist in der Migration ein Fehler und darf hier
   * nicht als Erfolg durchgehen.
   */
  function bookAffiliateReversals(payload: {
    tenant_id?: string;
    lock_key?: string;
    rows?: Array<Record<string, unknown>>;
  }): { data: Row | null; error: MockError | null } {
    if (!payload?.tenant_id || !payload?.lock_key) {
      return { data: null, error: { code: "P0001", message: "affiliate_reversal_payload_incomplete" } };
    }
    const rows = payload.rows ?? [];
    const stored = table("affiliate_commissions");
    const booked: Row[] = [];
    for (const entry of rows) {
      const parent = stored.find(
        (r) => r.id === entry.reverses_id && r.tenant_id === payload.tenant_id,
      );
      if (!parent) continue;
      const amount = -Math.min(Number(entry.target_cents ?? 0), Number(parent.amount_cents ?? 0));
      const row: Row = {
        id: `rev_${stored.length + booked.length + 1}`,
        tenant_id: payload.tenant_id,
        program_id: parent.program_id,
        partner_id: parent.partner_id,
        kind: "reversal",
        amount_cents: amount,
        currency: parent.currency,
        reverses_id: parent.id,
        dedup_key: entry.dedup_key,
        status: entry.status,
        inserted: true,
      };
      booked.push(row);
      stored.push({ ...row });
    }
    return {
      data: {
        booked: booked.length,
        existing: 0,
        skipped: rows.length - booked.length,
        reversed_cents: booked.reduce((sum, r) => sum + Math.abs(Number(r.amount_cents)), 0),
        rows: booked,
      },
      error: null,
    };
  }

  class MockAdminClient {
    from(table: string): MockTable {
      return new MockTable(table);
    }
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: MockError | null }> {
      rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) as Record<string, unknown> });
      const error = db.rpcErrors[name];
      if (error) return Promise.resolve({ data: null, error });
      if (name === "book_affiliate_commissions") {
        return Promise.resolve(
          bookAffiliateCommissions(args.p_payload as Parameters<typeof bookAffiliateCommissions>[0]),
        );
      }
      if (name === "book_affiliate_reversals") {
        return Promise.resolve(
          bookAffiliateReversals(args.p_payload as Parameters<typeof bookAffiliateReversals>[0]),
        );
      }
      if (name === "approve_due_affiliate_commissions") {
        return Promise.resolve(approveDue(Number(args.p_limit ?? 500)));
      }
      // Die beiden Löschläufe: im Mock ohne Wirkung, aber mit Rückgabeform.
      return Promise.resolve({ data: 0, error: null });
    }
  }

  return { db, rpcCalls, MockAdminClient };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => new MockAdminClient(),
}));

import { processAffiliateQueue } from "./process";

// --- Grunddaten ---------------------------------------------------------

// ECHTE UUIDs, keine sprechenden Platzhalter: alle diese Spalten sind in der
// Migration `uuid`, und der Storno-Pfad (`reversal.ts`) prüft sie mit zod
// genau so (CLAUDE.md §2.3). Mit „tenant-1" liefe dieser Pfad im Test in
// einen `ZodError` und damit an der Sache vorbei — die Fixtures müssen die
// Typen der Datenbank haben, sonst prüfen sie eine Welt, die es nicht gibt.
const TENANT = "11111111-1111-4111-8111-111111111111";
const PROGRAM = "22222222-2222-4222-8222-222222222222";
const PARTNER = "33333333-3333-4333-8333-333333333333";
const REFERRAL = "44444444-4444-4444-8444-444444444444";
const ORDER = "55555555-5555-4555-8555-555555555555";
const BUYER = "66666666-6666-4666-8666-666666666666";
const TOKEN = "b".repeat(64);

/** Eine Stunde vor „jetzt", damit `hold_until` in der Zukunft liegt. */
function occurredAt(): string {
  return new Date(Date.now() - 3_600_000).toISOString();
}

function table(name: string): Row[] {
  return db.tables[name] ?? (db.tables[name] = []);
}

function program(overrides: Row = {}): Row {
  return {
    id: PROGRAM,
    tenant_id: TENANT,
    status: "active",
    rate_kind: "percent",
    rate_bp: 2000,
    fixed_cents: 0,
    min_commission_cents: null,
    max_commission_cents: null,
    basis_kind: "net",
    fee_deduction_bp: 0,
    currency: "eur",
    self_referral: "block",
    recurring_mode: "n_periods",
    recurring_max_periods: 3,
    tier2_enabled: false,
    tier2_basis: "commission",
    tier2_rate_bp: 0,
    hold_days: 30,
    reserve_bp: 1000,
    reserve_days: 60,
    test_mode: false,
    ...overrides,
  };
}

function partner(overrides: Row = {}): Row {
  return {
    id: PARTNER,
    tenant_id: TENANT,
    program_id: PROGRAM,
    user_id: "user-partner",
    applicant_email: "partner@example.invalid",
    status: "active",
    group_id: null,
    referred_by: null,
    ...overrides,
  };
}

function seedBaseData(overrides: { program?: Row; partner?: Row; order?: Row } = {}): void {
  table("affiliate_programs").push(program(overrides.program));
  table("affiliate_partners").push(partner(overrides.partner));
  table("affiliate_referrals").push({
    id: REFERRAL,
    tenant_id: TENANT,
    program_id: PROGRAM,
    partner_id: PARTNER,
    token: TOKEN,
    campaign: "sommer",
    user_id: null,
    bound_at: null,
  });
  table("orders").push({
    id: ORDER,
    tenant_id: TENANT,
    user_id: BUYER,
    product_id: "product-1",
    amount_cents: 11900,
    currency: "eur",
    stripe_payment_intent: "pi_1",
    ...overrides.order,
  });
  table("profiles").push({ id: BUYER, email: "kaeufer@example.invalid" });
}

function checkoutEventRow(overrides: Row = {}): Row {
  return {
    id: "evt-row-checkout",
    stripe_event_id: "evt_checkout_1",
    event_type: "checkout.session.completed",
    tenant_id: TENANT,
    order_id: ORDER,
    stripe_invoice_id: null,
    stripe_subscription_id: null,
    stripe_charge_id: null,
    stripe_payment_intent: "pi_1",
    referral_token: TOKEN,
    // 11900 brutto, 1900 Steuer -> Basis 10000 (netto), 20 % = 2000 Provision,
    // davon 10 % Reserve = 200 -> sale 1800 / reserve 200.
    payload: { amount_total: 11900, amount_tax: 1900, amount_shipping: 0, currency: "eur", livemode: true },
    occurred_at: occurredAt(),
    status: "pending",
    attempts: 0,
    created_at: "2026-09-11T09:00:00.000Z",
    last_error: null,
    processed_at: null,
    ...overrides,
  };
}

function invoiceEventRow(overrides: Row = {}): Row {
  return {
    id: "evt-row-invoice",
    stripe_event_id: "evt_invoice_1",
    event_type: "invoice.paid",
    tenant_id: null,
    order_id: null,
    stripe_invoice_id: "in_1",
    stripe_subscription_id: "sub_1",
    stripe_charge_id: null,
    stripe_payment_intent: null,
    referral_token: null,
    payload: {
      amount_paid: 11900,
      amount_total: 11900,
      amount_tax: 1900,
      currency: "eur",
      billing_reason: "subscription_cycle",
      livemode: true,
    },
    occurred_at: occurredAt(),
    status: "pending",
    attempts: 0,
    created_at: "2026-09-11T09:05:00.000Z",
    last_error: null,
    processed_at: null,
    ...overrides,
  };
}

/**
 * Ein `charge.refunded` (B5, 5.8). Ohne `tenant_id`/`order_id` — genau so
 * nimmt der Webhook es auf: ein `Stripe.Charge` trägt keine Session-Metadata,
 * die Brücke über `orders.stripe_payment_intent` zieht erst der Verarbeiter
 * (Schritt 1b).
 *
 * Zahlenbasis: Charge 11900, davon 11900 erstattet = Vollstorno.
 */
function chargeRefundedEventRow(overrides: Row = {}): Row {
  return {
    id: "evt-row-charge",
    stripe_event_id: "evt_charge_1",
    event_type: "charge.refunded",
    tenant_id: null,
    order_id: null,
    stripe_invoice_id: null,
    stripe_subscription_id: null,
    stripe_charge_id: "ch_1",
    stripe_payment_intent: "pi_1",
    referral_token: null,
    payload: { amount_refunded: 11900, charge_amount: 11900, currency: "eur", livemode: true },
    occurred_at: occurredAt(),
    status: "pending",
    attempts: 0,
    created_at: "2026-09-11T09:10:00.000Z",
    last_error: null,
    processed_at: null,
    ...overrides,
  };
}

/**
 * Ein Dispute-Ereignis (B5, 5.8). `dispute_id` ist das Feld, ohne das der
 * ganze Pfad nicht arbeiten darf — es bildet `dedup_key` und Sperrschlüssel.
 */
function disputeEventRow(type: "created" | "closed", overrides: Row = {}): Row {
  const payload: Row =
    type === "created"
      ? { dispute_amount: 11900, dispute_status: "needs_response", dispute_id: "dp_1", currency: "eur" }
      : { dispute_amount: 11900, dispute_status: "won", dispute_id: "dp_1", currency: "eur" };
  return {
    id: `evt-row-dispute-${type}`,
    stripe_event_id: `evt_dispute_${type}`,
    event_type: `charge.dispute.${type}`,
    tenant_id: null,
    order_id: null,
    stripe_invoice_id: null,
    stripe_subscription_id: null,
    stripe_charge_id: "ch_1",
    stripe_payment_intent: "pi_1",
    referral_token: null,
    payload,
    occurred_at: occurredAt(),
    status: "pending",
    attempts: 0,
    created_at: "2026-09-11T09:11:00.000Z",
    last_error: null,
    processed_at: null,
    ...overrides,
  };
}

/**
 * Eine bereits gebuchte, rücknehmbare Provisionszeile zur Bestellung — die
 * Voraussetzung dafür, dass ein Storno überhaupt etwas findet.
 */
function seedSaleCommission(overrides: Row = {}): void {
  table("affiliate_commissions").push({
    id: "comm-sale-1",
    tenant_id: TENANT,
    program_id: PROGRAM,
    partner_id: PARTNER,
    kind: "sale",
    amount_cents: 1800,
    base_cents: 10000,
    currency: "eur",
    status: "pending",
    hold_until: "2026-10-11T00:00:00.000Z",
    is_test: false,
    order_id: ORDER,
    stripe_invoice_id: null,
    booked_at: "2026-09-11",
    created_at: "2026-09-11T09:00:00.000Z",
    ...overrides,
  });
}

/** Die Ursprungszeile mit dem eingefrorenen Satz (5.7). */
function seedSubscription(overrides: { binding?: Row } = {}): void {
  table("affiliate_commissions").push({
    id: "com-origin",
    tenant_id: TENANT,
    program_id: PROGRAM,
    partner_id: PARTNER,
    product_id: "product-1",
    campaign: "sommer",
    referral_id: REFERRAL,
    condition_id: null,
    currency: "eur",
    kind: "sale",
    amount_cents: 1800,
    base_cents: 10000,
    status: "pending",
    is_test: false,
    dedup_key: `sale:${ORDER}`,
    hold_until: new Date(Date.now() + 86_400_000).toISOString(),
    booked_at: "2026-09-01",
    created_at: "2026-09-01T10:00:00.000Z",
    condition_snapshot: {
      condition_id: null,
      source: "program_default",
      rate_kind: "percent",
      rate_bp: 2000,
      fixed_cents: 0,
      basis_kind: "net",
      fee_deduction_bp: 0,
      min_commission_cents: null,
      max_commission_cents: null,
      reserve_bp: 1000,
      hold_days: 30,
      reserve_days: 60,
      tier2_enabled: false,
      tier2_basis: "commission",
      tier2_rate_bp: 0,
    },
  });
  table("affiliate_subscription_bindings").push({
    stripe_subscription_id: "sub_1",
    tenant_id: TENANT,
    program_id: PROGRAM,
    partner_id: PARTNER,
    referral_id: REFERRAL,
    origin_commission_id: "com-origin",
    recurring_mode: "n_periods",
    max_periods: 3,
    periods_booked: 1,
    currency: "eur",
    ended_at: null,
    ...overrides.binding,
  });
}

function commissions(kind?: string): Row[] {
  const rows = table("affiliate_commissions").filter((r) => r.id !== "com-origin");
  return kind === undefined ? rows : rows.filter((r) => r.kind === kind);
}

function eventRow(id: string): Row {
  const row = table("affiliate_events").find((r) => r.id === id);
  if (row === undefined) throw new Error(`Ereigniszeile ${id} fehlt`);
  return row;
}

beforeEach(() => {
  db.tables = {};
  db.errors = {};
  db.rpcErrors = {};
  db.throwOnSelect = null;
  db.beforeUpdate = null;
  db.nextId = 0;
  rpcCalls.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// --- Schritt 1: die Buchung ---------------------------------------------

describe("processAffiliateQueue — Direktkauf (5.1 bis 5.6)", () => {
  it("bucht `sale` und `reserve` als getrennte Zeilen unter EINEM Sperrschlüssel (G5)", async () => {
    seedBaseData();
    table("affiliate_events").push(checkoutEventRow());

    const result = await processAffiliateQueue();

    expect(result.events).toMatchObject({ picked: 1, done: 1, error: 0, deferred: 0 });
    expect(commissions()).toHaveLength(2);
    expect(commissions("sale")[0]).toMatchObject({
      partner_id: PARTNER,
      base_cents: 10000,
      amount_cents: 1800,
      currency: "eur",
      status: "pending",
      campaign: "sommer",
      referral_id: REFERRAL,
      order_id: ORDER,
      dedup_key: `sale:${ORDER}`,
    });
    // G5: die Reserve ist eine eigene physische Zeile mit EIGENER Frist und
    // hängt über `parent_ref` an der `sale`-Zeile desselben Stapels.
    expect(commissions("reserve")[0]).toMatchObject({
      amount_cents: 200,
      parent_id: commissions("sale")[0].id,
      dedup_key: `reserve:${ORDER}`,
    });
    expect(
      Date.parse(String(commissions("reserve")[0].hold_until)) >
        Date.parse(String(commissions("sale")[0].hold_until)),
    ).toBe(true);

    // Der Sperrschlüssel ist der VORGANG. Ohne ihn wirft die RPC
    // `affiliate_book_payload_incomplete` und es entstünde gar keine Zeile.
    const booking = rpcCalls.find((call) => call.name === "book_affiliate_commissions");
    expect((booking?.args.p_payload as { lock_key?: string }).lock_key).toBe(`order:${ORDER}`);

    expect(eventRow("evt-row-checkout")).toMatchObject({ status: "done", last_error: null });
  });

  it("bucht die Zweitstufe in einem zweiten Aufruf an die Kennung der Elternzeile (5.5)", async () => {
    seedBaseData({
      program: { tier2_enabled: true, tier2_basis: "commission", tier2_rate_bp: 1000 },
      partner: { referred_by: "partner-werber" },
    });
    table("affiliate_partners").push(
      partner({ id: "partner-werber", user_id: "user-werber", applicant_email: "werber@example.invalid" }),
    );
    table("affiliate_events").push(checkoutEventRow());

    await processAffiliateQueue();

    const sale = commissions("sale")[0];
    const tier2 = commissions("tier2")[0];
    // 10 % der Gesamtprovision (2000) = 200, dem WERBER gutgeschrieben.
    expect(tier2).toMatchObject({ partner_id: "partner-werber", amount_cents: 200, parent_id: sale.id });
    expect(tier2.dedup_key).toBe(`tier2:${sale.id}`);
  });

  it("bucht ohne Token gar nichts — Hausverkauf ist keine Zeile über 0 Cent (4.4 R9)", async () => {
    seedBaseData();
    table("affiliate_events").push(checkoutEventRow({ referral_token: null }));

    const result = await processAffiliateQueue();

    expect(commissions()).toHaveLength(0);
    expect(result.events.skipped).toBe(1);
    expect(eventRow("evt-row-checkout")).toMatchObject({ status: "skipped", last_error: "no_attribution" });
  });

  it("schreibt eine Testbestellung sichtbar, aber wertlos (4.5)", async () => {
    seedBaseData();
    table("affiliate_events").push(
      checkoutEventRow({
        payload: { amount_total: 11900, amount_tax: 1900, amount_shipping: 0, currency: "eur", livemode: false },
      }),
    );

    await processAffiliateQueue();

    expect(commissions("sale")[0]).toMatchObject({
      is_test: true,
      status: "cancelled",
      cancel_reason: "test_order",
    });
  });

  it("storniert die Eigenbestellung, statt sie zu bezahlen (4.4 R1, `self_referral='block'`)", async () => {
    // Der Käufer IST der Partner. Der Verarbeiter prüft das aus den Daten neu
    // und übernimmt es nicht aus der Metadata — dort entstünde es im Browser
    // des Käufers.
    seedBaseData({ partner: { user_id: BUYER } });
    table("affiliate_events").push(checkoutEventRow());

    await processAffiliateQueue();

    expect(commissions("sale")[0]).toMatchObject({
      status: "cancelled",
      cancel_reason: "self_referral",
    });
  });
});

// --- G3: Idempotenz ------------------------------------------------------

describe("processAffiliateQueue — doppelte Zustellung (G3)", () => {
  it("erzeugt bei zweiter Verarbeitung desselben Ereignisses genau EINE Zeilengruppe", async () => {
    seedBaseData({ program: { tier2_enabled: true, tier2_rate_bp: 1000 }, partner: { referred_by: "partner-werber" } });
    table("affiliate_partners").push(partner({ id: "partner-werber", user_id: "user-werber" }));
    table("affiliate_events").push(checkoutEventRow());

    await processAffiliateQueue();
    const firstIds = commissions()
      .map((r) => String(r.id))
      .sort();
    expect(firstIds).toHaveLength(3);

    // Der Nachhol-/Reprocess-Weg aus 6.6: dieselbe Zeile wird erneut
    // verarbeitet. Das ist ausdrücklich gefahrlos — die Idempotenz hängt an
    // `unique (tenant_id, dedup_key)` und NICHT an einem `isNewOrder`-Flag.
    eventRow("evt-row-checkout").status = "pending";
    eventRow("evt-row-checkout").attempts = 0;
    await processAffiliateQueue();

    expect(
      commissions()
        .map((r) => String(r.id))
        .sort(),
    ).toEqual(firstIds);
    // Die Zweitstufe hängt beim zweiten Lauf an DERSELBEN Elternzeile — die
    // RPC hat deren bestehende Kennung zurückgegeben, nicht eine neue.
    expect(commissions("tier2")[0].parent_id).toBe(commissions("sale")[0].id);
  });
});

// --- 6.6: Reihenfolge ----------------------------------------------------

describe("processAffiliateQueue — vertauschte Reihenfolge (6.6)", () => {
  it("lässt `invoice.paid` vor `checkout.session.completed` auf `pending` WARTEN", async () => {
    // Der Kern der Outbox: ohne Bindung ist die Rate nicht zuordenbar. Das
    // heißt „noch nicht", nicht „keine Provision" — ein `skipped` wäre ein
    // Endzustand, und die Rate wäre endgültig verloren.
    seedBaseData();
    table("affiliate_events").push(invoiceEventRow());

    const result = await processAffiliateQueue();

    expect(result.events).toMatchObject({ picked: 1, deferred: 1, done: 0, skipped: 0, error: 0 });
    expect(commissions()).toHaveLength(0);
    expect(eventRow("evt-row-invoice")).toMatchObject({
      status: "pending",
      last_error: "binding_missing",
      attempts: 1,
    });
  });

  it("holt die Rate nach, sobald der Checkout die Bindung angelegt hat", async () => {
    seedBaseData();
    table("affiliate_events").push(invoiceEventRow());
    await processAffiliateQueue();
    expect(commissions()).toHaveLength(0);

    seedSubscription();
    const result = await processAffiliateQueue();

    expect(result.events.done).toBe(1);
    expect(commissions("recurring")[0]).toMatchObject({
      partner_id: PARTNER,
      base_cents: 10000,
      amount_cents: 1800,
      stripe_invoice_id: "in_1",
      dedup_key: "recurring:in_1",
    });
    expect(eventRow("evt-row-invoice")).toMatchObject({ status: "done", last_error: null });
  });

  it("macht ein dauerhaft unerfüllbares Ereignis nach fünf Versuchen sichtbar", async () => {
    // Sonst führe es für immer im Stapel mit und verdrängte echte Arbeit aus
    // den 20 Plätzen je Lauf.
    seedBaseData();
    table("affiliate_events").push(invoiceEventRow({ attempts: 4 }));

    await processAffiliateQueue();

    expect(eventRow("evt-row-invoice")).toMatchObject({
      status: "error",
      last_error: "binding_missing",
      attempts: 5,
    });
  });

  it("trägt den Mandanten über den `payment_intent` nach (6.5 Schritt 1b)", async () => {
    // `charge.refunded` trägt keine Session-Metadata; die Brücke läuft über
    // `orders.stripe_payment_intent`. Geprüft wird hier NUR das Nachtragen —
    // dass die Erstattung danach auch verarbeitet wird, steht im Block
    // „Storno" weiter unten.
    seedBaseData();
    table("affiliate_events").push(chargeRefundedEventRow());

    await processAffiliateQueue();

    expect(eventRow("evt-row-charge")).toMatchObject({
      tenant_id: TENANT,
      order_id: ORDER,
    });
  });
});

// --- 5.8: Storno, Rückbuchung, Wiedergutschrift (B5) --------------------

/**
 * DIE REGRESSION, DIE DIESER BLOCK FESTHÄLT: zwischen B4 und B5 lagen
 * `charge.refunded` und die beiden Dispute-Ereignisse in einer Liste
 * zurückgestellter Arten und liefen in `defer/handler_missing` — der ganze
 * Storno-Pfad aus `reversal.ts` war fertig, getestet und von `dispatchEvent()`
 * aus schlicht nicht erreichbar. Das ist ein Fehler, den weder `tsc` noch
 * ESLint noch die Unit-Tests von `reversal.ts` sehen können: toter Code
 * übersetzt, lintet und besteht seine eigenen Tests.
 *
 * Geprüft wird deshalb die VERDRAHTUNG, nicht die Arithmetik (die steht in
 * `reversal.test.ts`): kommt das Ereignis am Storno-Pfad an, und wird es
 * danach als erledigt abgelegt statt zurückgestellt?
 */
describe("processAffiliateQueue — Storno und Rückbuchung (5.8)", () => {
  it("reicht `charge.refunded` an den Storno-Pfad und legt es als erledigt ab", async () => {
    seedBaseData();
    seedSaleCommission();
    table("affiliate_events").push(chargeRefundedEventRow());

    const result = await processAffiliateQueue();

    const booking = rpcCalls.find((call) => call.name === "book_affiliate_reversals");
    expect(booking).toBeDefined();
    expect((booking?.args.p_payload as { lock_key?: string }).lock_key).toBe("charge:ch_1");
    expect(result.events.done).toBe(1);
    expect(result.events.deferred).toBe(0);
    expect(eventRow("evt-row-charge")).toMatchObject({ status: "done", last_error: null });
  });

  it("schreibt `orders.refunded_cents` und den Bestellzustand fort (5.8)", async () => {
    // Die Spalten gehören der BESTELLUNG, nicht dem Affiliate-Modul: sie
    // werden auch dann geführt, wenn keine Provision daran hängt — und sie
    // wurden vor B5 von keiner einzigen Codestelle je geschrieben.
    seedBaseData();
    seedSaleCommission();
    table("orders")[0].status = "paid";
    table("orders")[0].refunded_cents = 0;
    table("affiliate_events").push(chargeRefundedEventRow());

    await processAffiliateQueue();

    expect(table("orders")[0]).toMatchObject({ refunded_cents: 11900, status: "refunded" });
  });

  it("bucht eine Erstattung ohne Provisionszeile nicht, verliert sie aber auch nicht still", async () => {
    // Der Normalfall: Hausverkauf. `skipped/no_attribution` ist ein
    // Endzustand MIT Grund — kein `defer`, das jede zweite Erstattung als
    // „nicht verarbeitet" in die Aufsicht spülte.
    seedBaseData();
    table("affiliate_events").push(chargeRefundedEventRow());

    const result = await processAffiliateQueue();

    expect(result.events.skipped).toBe(1);
    expect(eventRow("evt-row-charge")).toMatchObject({
      status: "skipped",
      last_error: "no_attribution",
    });
  });

  it("reicht `charge.dispute.created` mit der STREITFALL-Kennung durch, nicht mit der des Charge", async () => {
    // Fiele der Sperr-/Dedup-Schlüssel mit dem einer Erstattung desselben
    // Charge zusammen, holte die Wiedergutschrift später deren
    // Gegenbuchungen mit zurück.
    seedBaseData();
    seedSaleCommission();
    table("affiliate_events").push(disputeEventRow("created"));

    await processAffiliateQueue();

    const booking = rpcCalls.find((call) => call.name === "book_affiliate_reversals");
    expect((booking?.args.p_payload as { lock_key?: string }).lock_key).toBe("dispute:dp_1");
    expect(eventRow("evt-row-dispute-created")).toMatchObject({ status: "done" });
  });

  it("lässt ein Dispute-Ereignis OHNE `dispute_id` sichtbar stehen statt falsch zu buchen", async () => {
    seedBaseData();
    seedSaleCommission();
    table("affiliate_events").push(
      disputeEventRow("created", {
        payload: { dispute_amount: 11900, dispute_status: "needs_response", currency: "eur" },
      }),
    );

    const result = await processAffiliateQueue();

    expect(rpcCalls.some((call) => call.name === "book_affiliate_reversals")).toBe(false);
    expect(result.events.error).toBe(1);
    expect(eventRow("evt-row-dispute-created")).toMatchObject({ last_error: "booking_failed" });
  });

  it("tut bei einem VERLORENEN Streitfall nichts — die Gegenbuchung bleibt bestehen", async () => {
    seedBaseData();
    seedSaleCommission();
    table("affiliate_events").push(
      disputeEventRow("closed", {
        payload: { dispute_status: "lost", dispute_id: "dp_1", currency: "eur" },
      }),
    );

    const result = await processAffiliateQueue();

    expect(rpcCalls.some((call) => call.name === "book_affiliate_reversals")).toBe(false);
    expect(result.events.skipped).toBe(1);
    expect(eventRow("evt-row-dispute-closed")).toMatchObject({
      status: "skipped",
      last_error: "no_attribution",
    });
  });

  it("verarbeitet eine unbekannte Ereignisart weiterhin als `unsupported_event`", async () => {
    // Die Erlaubnisliste bleibt eine Erlaubnisliste: das Streichen der
    // zurückgestellten Arten darf den Standardzweig nicht mit aufgeweicht
    // haben.
    seedBaseData();
    table("affiliate_events").push(
      chargeRefundedEventRow({ id: "evt-row-other", event_type: "charge.succeeded" }),
    );

    await processAffiliateQueue();

    expect(eventRow("evt-row-other")).toMatchObject({
      status: "skipped",
      last_error: "unsupported_event",
    });
  });
});

// --- 6.5 a: Giftzeilen-Schutz -------------------------------------------

describe("processAffiliateQueue — Giftzeile (6.5 a)", () => {
  it("blockiert die Warteschlange nicht: die Nachbarzeile wird im selben Lauf fertig", async () => {
    seedBaseData();
    // Die ältere Zeile bringt den Verarbeiter zum Absturz (echter Wurf, kein
    // `{ error }`), die jüngere ist gesund.
    table("affiliate_events").push(
      checkoutEventRow({
        id: "evt-row-gift",
        stripe_event_id: "evt_gift",
        created_at: "2026-09-11T08:00:00.000Z",
      }),
      checkoutEventRow({ created_at: "2026-09-11T09:00:00.000Z" }),
    );
    db.throwOnSelect = { table: "affiliate_programs", remaining: 1 };

    const result = await processAffiliateQueue();

    expect(result.events).toMatchObject({ picked: 2, error: 1, done: 1 });
    expect(eventRow("evt-row-gift")).toMatchObject({
      status: "error",
      last_error: "unexpected",
      // Der Versuch wurde VOR der Arbeit hochgesetzt — sonst risse dieselbe
      // Zeile jeden Lauf erneut mit.
      attempts: 1,
    });
    expect(eventRow("evt-row-checkout").status).toBe("done");
    expect(commissions()).toHaveLength(2);
  });

  it("beendet den Lauf nicht: Freigabe und Datenläufe laufen trotzdem", async () => {
    seedBaseData();
    table("affiliate_events").push(checkoutEventRow());
    db.throwOnSelect = { table: "affiliate_programs", remaining: 1 };
    table("affiliate_commissions").push({
      id: "com-faellig",
      tenant_id: TENANT,
      program_id: PROGRAM,
      partner_id: PARTNER,
      kind: "sale",
      amount_cents: 500,
      base_cents: 2500,
      status: "pending",
      flagged: false,
      is_test: false,
      hold_until: new Date(Date.now() - 1000).toISOString(),
      dedup_key: "sale:order-alt",
      booked_at: "2026-09-01",
      created_at: "2026-08-01T10:00:00.000Z",
    });

    const result = await processAffiliateQueue();

    expect(result.events.error).toBe(1);
    expect(result.approved).toBe(1);
    expect(table("affiliate_commissions").find((r) => r.id === "com-faellig")?.status).toBe("approved");
  });
});

// --- 6.5 c: Pause --------------------------------------------------------

describe("processAffiliateQueue — pausiertes Programm (6.5 c)", () => {
  it("bucht nicht, staut die Zeile und zählt den Versuch NICHT hoch", async () => {
    seedBaseData({ program: { status: "paused" } });
    table("affiliate_events").push(checkoutEventRow());

    const result = await processAffiliateQueue();

    expect(commissions()).toHaveLength(0);
    expect(result.events.deferred).toBe(1);
    expect(eventRow("evt-row-checkout")).toMatchObject({
      status: "pending",
      last_error: "program_inactive",
      // Die Pause staut, verliert nicht und zählt nicht hoch: sonst liefe ein
      // wochenlang pausiertes Programm nach fünf Ticks in `error`.
      attempts: 0,
    });
  });

  it("hält auch eine Abo-Folgerate an, statt sie zu verwerfen", async () => {
    seedBaseData({ program: { status: "paused" } });
    seedSubscription();
    table("affiliate_events").push(invoiceEventRow());

    await processAffiliateQueue();

    expect(commissions()).toHaveLength(0);
    // Der Zähler bleibt unangetastet — eine Pause darf keine Periode kosten.
    expect(table("affiliate_subscription_bindings")[0].periods_booked).toBe(1);
    expect(eventRow("evt-row-invoice")).toMatchObject({ status: "pending", attempts: 0 });
  });
});

// --- 5.7/3.9: der Abo-Zähler --------------------------------------------

describe("processAffiliateQueue — Abo-Zähler (3.9, 5.7)", () => {
  it("setzt den Zähler genau einmal hoch und bucht eine Rate", async () => {
    seedBaseData();
    seedSubscription();
    table("affiliate_events").push(invoiceEventRow());

    await processAffiliateQueue();

    expect(commissions("recurring")).toHaveLength(1);
    expect(commissions("recurring_reserve")).toHaveLength(1);
    expect(table("affiliate_subscription_bindings")[0].periods_booked).toBe(2);
  });

  it("bucht unter Nebenläufigkeit KEINE zweite Rate, wenn ein anderer Lauf schneller war", async () => {
    seedBaseData();
    seedSubscription();
    table("affiliate_events").push(invoiceEventRow());

    // Der Nebenbuhler erhöht den Zähler zwischen Lesen und Schreiben. Der
    // Compare-and-Swap trifft damit null Zeilen — ein blindes `read, then
    // write` hätte hier eine Rate zu viel gebucht.
    let interfered = false;
    db.beforeUpdate = (tableName) => {
      if (tableName !== "affiliate_subscription_bindings" || interfered) return;
      interfered = true;
      const binding = db.tables.affiliate_subscription_bindings[0];
      binding.periods_booked = Number(binding.periods_booked) + 1;
    };

    const result = await processAffiliateQueue();

    expect(commissions("recurring")).toHaveLength(0);
    expect(table("affiliate_subscription_bindings")[0].periods_booked).toBe(2);
    expect(result.events.deferred).toBe(1);
    // WARTEN, nicht verwerfen: der nächste Tick holt die Rate nach.
    expect(eventRow("evt-row-invoice")).toMatchObject({
      status: "pending",
      last_error: "counter_conflict",
    });

    db.beforeUpdate = null;
    await processAffiliateQueue();
    expect(commissions("recurring")).toHaveLength(1);
    expect(table("affiliate_subscription_bindings")[0].periods_booked).toBe(3);
  });

  it("verbraucht bei einem Retry nach erfolgreicher Buchung keine weitere Periode", async () => {
    // Ohne die Vorprüfung auf den `dedup_key` zöge jeder Retry eine Periode
    // ab, ohne eine Zeile zu erzeugen — der Partner verlöre am Ende der
    // Laufzeit genau so viele Raten, wie es Retries gab.
    seedBaseData();
    seedSubscription();
    table("affiliate_events").push(invoiceEventRow());

    await processAffiliateQueue();
    eventRow("evt-row-invoice").status = "pending";
    eventRow("evt-row-invoice").attempts = 0;
    await processAffiliateQueue();

    expect(commissions("recurring")).toHaveLength(1);
    expect(table("affiliate_subscription_bindings")[0].periods_booked).toBe(2);
  });

  it("bucht nach dem Deckel nicht mehr (`n_periods` erschöpft, 5.7)", async () => {
    seedBaseData();
    seedSubscription({ binding: { periods_booked: 3, max_periods: 3 } });
    table("affiliate_events").push(invoiceEventRow());

    const result = await processAffiliateQueue();

    expect(commissions()).toHaveLength(0);
    expect(table("affiliate_subscription_bindings")[0].periods_booked).toBe(3);
    expect(result.events.skipped).toBe(1);
    expect(eventRow("evt-row-invoice")).toMatchObject({
      status: "skipped",
      last_error: "recurring_exhausted",
    });
  });

  it("bucht nach dem Ende des Abos nicht mehr", async () => {
    seedBaseData();
    seedSubscription({ binding: { ended_at: "2026-09-05T00:00:00.000Z" } });
    table("affiliate_events").push(invoiceEventRow());

    await processAffiliateQueue();

    expect(commissions()).toHaveLength(0);
    expect(table("affiliate_subscription_bindings")[0].periods_booked).toBe(1);
  });

  it("überspringt die erste Rate eines Abos — die hat der Checkout gebucht (5.7)", async () => {
    seedBaseData();
    seedSubscription();
    table("affiliate_events").push(
      invoiceEventRow({
        payload: {
          amount_paid: 11900,
          amount_total: 11900,
          amount_tax: 1900,
          currency: "eur",
          billing_reason: "subscription_create",
          livemode: true,
        },
      }),
    );

    await processAffiliateQueue();

    expect(commissions()).toHaveLength(0);
    expect(table("affiliate_subscription_bindings")[0].periods_booked).toBe(1);
    expect(eventRow("evt-row-invoice")).toMatchObject({
      status: "skipped",
      last_error: "subscription_create",
    });
  });
});

// --- 5.11: Währung -------------------------------------------------------

describe("processAffiliateQueue — Währung (5.11)", () => {
  it("bucht eine Rate in fremder Währung NICHT und verbraucht dafür keine Periode", async () => {
    // Es wird nirgends umgerechnet. Eine Zeile in der falschen Währung
    // verfälschte Saldo und Auszahlung; der Fall gehört sichtbar gemacht.
    seedBaseData();
    seedSubscription();
    table("affiliate_events").push(
      invoiceEventRow({
        payload: {
          amount_paid: 11900,
          amount_total: 11900,
          amount_tax: 1900,
          currency: "usd",
          billing_reason: "subscription_cycle",
          livemode: true,
        },
      }),
    );

    const result = await processAffiliateQueue();

    expect(commissions()).toHaveLength(0);
    expect(table("affiliate_subscription_bindings")[0].periods_booked).toBe(1);
    expect(result.events.error).toBe(1);
    expect(eventRow("evt-row-invoice")).toMatchObject({
      status: "error",
      last_error: "currency_mismatch",
    });
  });
});

// --- Die Bindung, die der Checkout anlegt (3.9) --------------------------

describe("processAffiliateQueue — Abo-Bindung aus dem Checkout (3.9)", () => {
  it("kopiert die Abo-Regel des Programms und zählt die erste Rate mit", async () => {
    seedBaseData();
    table("affiliate_events").push(checkoutEventRow({ stripe_subscription_id: "sub_neu" }));

    await processAffiliateQueue();

    expect(table("affiliate_subscription_bindings")[0]).toMatchObject({
      stripe_subscription_id: "sub_neu",
      tenant_id: TENANT,
      partner_id: PARTNER,
      recurring_mode: "n_periods",
      max_periods: 3,
      // 5.7: die erste Rate ist mit dem Checkout gebucht.
      periods_booked: 1,
      origin_commission_id: commissions("sale")[0].id,
      currency: "eur",
    });
  });

  it("legt für eine stornierte Buchung gar keine Bindung an", async () => {
    seedBaseData({ program: { test_mode: true } });
    table("affiliate_events").push(checkoutEventRow({ stripe_subscription_id: "sub_neu" }));

    await processAffiliateQueue();

    expect(table("affiliate_subscription_bindings")).toHaveLength(0);
  });
});

// --- Schritt 2 und 3 -----------------------------------------------------

describe("processAffiliateQueue — Freigabelauf und Tagesaggregation", () => {
  it("liest die Zahl der freigegebenen Zeilen aus dem RPC-Objekt (6.4)", async () => {
    // Die RPC liefert `{ approved, limit, rows }` und KEIN Array. Ein
    // `Array.isArray(data)` meldete jeden Lauf als „0 freigegeben" — die Zahl
    // geht ins Cron-Log und wäre dauerhaft falsch.
    seedBaseData();
    table("affiliate_commissions").push(
      {
        id: "com-faellig",
        tenant_id: TENANT,
        program_id: PROGRAM,
        partner_id: PARTNER,
        kind: "sale",
        amount_cents: 500,
        base_cents: 2500,
        status: "pending",
        flagged: false,
        is_test: false,
        hold_until: new Date(Date.now() - 1000).toISOString(),
        dedup_key: "sale:order-alt",
        booked_at: "2026-09-01",
        created_at: "2026-08-01T10:00:00.000Z",
      },
      {
        id: "com-markiert",
        tenant_id: TENANT,
        program_id: PROGRAM,
        partner_id: PARTNER,
        kind: "sale",
        amount_cents: 900,
        base_cents: 4500,
        status: "pending",
        // Ein Verdachtsfall wird von einem Menschen entschieden, nicht von
        // der Uhr.
        flagged: true,
        is_test: false,
        hold_until: new Date(Date.now() - 1000).toISOString(),
        dedup_key: "sale:order-verdacht",
        booked_at: "2026-09-01",
        created_at: "2026-08-01T10:00:00.000Z",
      },
    );

    const result = await processAffiliateQueue();

    expect(result.approved).toBe(1);
    expect(table("affiliate_commissions").find((r) => r.id === "com-markiert")?.status).toBe("pending");
  });

  it("schreibt die Tageszahlen des gebuchten Mandanten fort und zählt die Reserve nicht als Bestellung", async () => {
    seedBaseData();
    table("affiliate_events").push(checkoutEventRow());

    const result = await processAffiliateQueue();

    expect(result.stats.tenants).toBeGreaterThanOrEqual(1);
    const stats = table("affiliate_daily_stats").find((r) => r.partner_id === PARTNER);
    expect(stats).toMatchObject({
      tenant_id: TENANT,
      campaign: "sommer",
      // G5: `sale` und `reserve` gehören zur selben Bestellung.
      orders_count: 1,
      revenue_cents: 10000,
      // Beide Zeilen zusammen sind die Provision des Tages.
      commission_cents: 2000,
    });
  });

  it("lässt Testbuchungen aus der Auswertung heraus (4.5)", async () => {
    seedBaseData({ program: { test_mode: true } });
    table("affiliate_events").push(checkoutEventRow());

    await processAffiliateQueue();

    expect(table("affiliate_daily_stats")).toHaveLength(0);
  });
});

// --- Der Lauf als Ganzes -------------------------------------------------

describe("processAffiliateQueue — der Lauf", () => {
  it("wirft nie, auch wenn die Warteschlange gar nicht lesbar ist", async () => {
    // Der Lauf hängt im selben `Promise.all` wie die drei KI-Warteschlangen
    // (9.7); ein Wurf hier risse sie mit.
    db.errors.affiliate_events = { code: "42501", message: "permission denied" };

    await expect(processAffiliateQueue()).resolves.toMatchObject({
      events: { picked: 0, done: 0 },
    });
  });

  it("meldet Schritt 4 als offen, statt Vollzug zu behaupten (7.1/B8)", async () => {
    const result = await processAffiliateQueue();
    expect(result.payouts).toEqual({ drafted: 0, pending: true });
  });

  it("überspringt die Datenläufe, ohne den Lauf zu beschädigen, wenn eine Löschfunktion fehlt", async () => {
    // `affiliate_referrals_purge()` liegt noch nicht vor (siehe Dateikopf des
    // Verarbeiters). Der Schritt meldet 0 und der Lauf geht weiter — ein
    // fehlender Aufräumlauf darf keine Buchung kosten.
    seedBaseData();
    table("affiliate_events").push(checkoutEventRow());
    db.rpcErrors.affiliate_referrals_purge = { code: "PGRST202", message: "not found" };

    const result = await processAffiliateQueue();

    expect(result.cleanup).toEqual({ clicks: 0, referrals: 0 });
    expect(result.events.done).toBe(1);
  });

  it("schreibt weder Token noch Datenbankmeldung ins Log (CLAUDE.md §2.11)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    seedBaseData();
    table("affiliate_events").push(checkoutEventRow());
    db.errors.affiliate_referrals = {
      code: "23503",
      message: `Key (token)=(${TOKEN}) is not present`,
    };

    await processAffiliateQueue();

    const output = logged.mock.calls.flat().join(" ");
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain("is not present");
    expect(output).toContain("23503");
  });
});
