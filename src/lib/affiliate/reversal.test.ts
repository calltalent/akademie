import { beforeEach, describe, expect, it } from "vitest";
import {
  affiliateRefundInputSchema,
  inheritReversalState,
  recreditForWonDispute,
  reverseForDispute,
  reverseForRefund,
} from "./reversal";
import { applyOrderRefundState } from "./orders";

/**
 * Affiliate-System, Block B5 — STORNO, RÜCKBUCHUNG, WIEDERGUTSCHRIFT
 * (PLAN_Affiliate-System.md 5.8, 5.9 Beispiel C, 6.1 bis 6.3, 10/B5).
 *
 * Mock-Muster wie `src/lib/affiliate/process.test.ts` und
 * `src/lib/marketplace/fulfil.test.ts`: ein In-Memory-Array je Tabelle mit
 * ECHT angewandten Filtern. Die beiden RPCs sind NACHGEBAUT und keine
 * Attrappen — `book_affiliate_reversals()` rechnet im Mock dieselbe Differenz
 * aus demselben gespeicherten Stand wie in der Migration, deckelt den
 * Zielwert auf die Ursprungszeile und entdoppelt über
 * `(tenant_id, dedup_key)`. Ohne diese drei Eigenschaften prüfte der
 * Mehrfach-Teilerstattungs-Test nichts.
 *
 * Die Rechenregel selbst (`computeReversalDelta()`, BigInt) steht in
 * `compute.ts` und ist dort ohne Datenbank geprüft. Hier wird geprüft, was
 * nur im Zusammenspiel sichtbar wird: dass aus dem KUMULATIVEN Stripe-Betrag
 * ein Delta wird, dass die Summe aller Gegenbuchungen bei Vollstorno EXAKT
 * dem Ursprungsbetrag entspricht, dass die zweite Stufe mitgeht und dass der
 * Status-Eimer vom Elternteil kommt (G6).
 *
 * Zahlenbasis ist durchgehend Beispiel A/C aus 5.9: Charge 44910,
 * sale 11888, reserve 1320, tier2 2641.
 */

type Row = Record<string, unknown>;
type MockError = { code?: string; message: string };

const db: { tables: Record<string, Row[]>; errors: Record<string, MockError | undefined>; nextId: number } = {
  tables: {},
  errors: {},
  nextId: 0,
};

function table(name: string): Row[] {
  return db.tables[name] ?? (db.tables[name] = []);
}

function nextId(prefix: string): string {
  db.nextId += 1;
  return `${prefix}_${db.nextId}`;
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

/** Eine Lesekette; jeder Filter wird SOFORT angewandt, wie PostgREST es täte. */
class MockSelect {
  constructor(
    private tableName: string,
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
  gte(column: string, value: unknown): this {
    this.rows = this.rows.filter((r) => r[column] != null && compare(r[column], value) >= 0);
    return this;
  }

  private resolve(): { data: Row[] | null; error: MockError | null } {
    const error = db.errors[this.tableName];
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

/** Ein `update`; `select()` macht daraus den Compare-and-Swap. */
class MockUpdate {
  private predicates: Array<(row: Row) => boolean> = [];
  constructor(
    private tableName: string,
    private patch: Row,
  ) {}

  eq(column: string, value: unknown): this {
    this.predicates.push((r) => r[column] === value);
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    this.predicates.push((r) => values.includes(r[column]));
    return this;
  }
  gte(column: string, value: unknown): this {
    this.predicates.push((r) => r[column] != null && compare(r[column], value) >= 0);
    return this;
  }
  lt(column: string, value: number): this {
    this.predicates.push((r) => Number(r[column] ?? 0) < value);
    return this;
  }

  private resolve(): { data: Row[] | null; error: MockError | null } {
    const error = db.errors[this.tableName];
    if (error) return { data: null, error };
    const matched = table(this.tableName).filter((r) => this.predicates.every((p) => p(r)));
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

class MockTable {
  constructor(private tableName: string) {}
  select(columns: string): MockSelect {
    // Das SELECT-Recht auf den Affiliate-Tabellen ist ein SPALTEN-Grant:
    // `select("*")` bricht dort mit 42501 ab. Der Mock hält die Regel fest.
    if (columns.trim() === "*") return new MockSelect(this.tableName, []);
    return new MockSelect(this.tableName, [...table(this.tableName)]);
  }
  update(patch: Row): MockUpdate {
    return new MockUpdate(this.tableName, patch);
  }
}

const REVERSIBLE = new Set(["sale", "reserve", "recurring", "recurring_reserve", "tier2"]);

/**
 * Nachbau von `book_affiliate_reversals()` (Migration 20260911140000): Deckel
 * auf `parent.amount_cents`, NETTO bereits gegengebucht (Gegenbuchungen minus
 * Wiedergutschriften), Differenz statt Zielwert, `on conflict do nothing`.
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
  if (rows.length === 0) {
    return { data: null, error: { code: "P0001", message: "affiliate_reversal_rows_empty" } };
  }

  const stored = table("affiliate_commissions");
  const result: Row[] = [];
  let booked = 0;
  let existing = 0;
  let skipped = 0;
  let sum = 0;

  for (const entry of rows) {
    const parent = stored.find((r) => r.id === entry.reverses_id && r.tenant_id === payload.tenant_id);
    if (!parent) {
      return { data: null, error: { code: "P0001", message: "affiliate_reversal_parent_tenant_mismatch" } };
    }
    if (!REVERSIBLE.has(String(parent.kind))) {
      return { data: null, error: { code: "P0001", message: "affiliate_reversal_parent_kind_invalid" } };
    }
    if (!entry.note) {
      return { data: null, error: { code: "P0001", message: "affiliate_reversal_note_missing" } };
    }

    let reason: string | null = null;
    if (parent.status === "cancelled") reason = "parent_cancelled";
    else if (parent.is_test === true) reason = "parent_test";
    else if (Number(parent.amount_cents) <= 0) reason = "parent_not_positive";

    let target = 0;
    let already = 0;
    let delta = 0;
    let id: string | null = null;
    let inserted = false;

    if (reason === null) {
      target = Math.min(Math.max(Number(entry.target_cents), 0), Number(parent.amount_cents));

      const reversals = stored.filter((r) => r.kind === "reversal" && r.reverses_id === parent.id);
      const recreditSum = stored
        .filter((r) => r.kind === "recredit" && reversals.some((rev) => rev.id === r.reverses_id))
        .reduce((acc, r) => acc + Number(r.amount_cents), 0);
      already = Math.max(
        0,
        reversals.reduce((acc, r) => acc - Number(r.amount_cents), 0) - recreditSum,
      );

      delta = target - already;
      if (delta <= 0) reason = "no_delta";
    }

    if (reason === null) {
      const found = stored.find(
        (r) => r.tenant_id === payload.tenant_id && r.dedup_key === entry.dedup_key,
      );
      if (found) {
        id = String(found.id);
        delta = -Number(found.amount_cents);
        existing += 1;
      } else {
        id = nextId("rev");
        stored.push({
          id,
          tenant_id: payload.tenant_id,
          program_id: parent.program_id,
          partner_id: parent.partner_id,
          kind: "reversal",
          order_id: parent.order_id ?? null,
          stripe_invoice_id: parent.stripe_invoice_id ?? null,
          stripe_subscription_id: parent.stripe_subscription_id ?? null,
          stripe_charge_id: entry.stripe_charge_id ?? parent.stripe_charge_id ?? null,
          product_id: parent.product_id ?? null,
          campaign: parent.campaign ?? null,
          referral_id: parent.referral_id ?? null,
          parent_id: null,
          reverses_id: parent.id,
          base_cents: parent.base_cents ?? 0,
          basis_kind: parent.basis_kind ?? "net",
          rate_kind: parent.rate_kind ?? "percent",
          rate_bp: parent.rate_bp ?? 0,
          fixed_cents: parent.fixed_cents ?? 0,
          amount_cents: -delta,
          currency: parent.currency,
          condition_id: parent.condition_id ?? null,
          condition_snapshot: parent.condition_snapshot ?? {},
          status: entry.status,
          hold_until: entry.hold_until,
          is_test: parent.is_test === true,
          note: entry.note,
          dedup_key: entry.dedup_key,
          flagged: false,
          created_at: new Date().toISOString(),
        });
        booked += 1;
        sum += delta;
        inserted = true;
      }
    } else {
      skipped += 1;
      delta = 0;
    }

    result.push({
      reverses_id: parent.id,
      id,
      dedup_key: entry.dedup_key,
      parent_kind: parent.kind,
      partner_id: parent.partner_id,
      currency: parent.currency,
      target_cents: target,
      already_cents: already,
      amount_cents: reason === null ? -delta : 0,
      inserted,
      skipped_reason: reason,
    });
  }

  return {
    data: {
      tenant_id: payload.tenant_id,
      lock_key: payload.lock_key,
      booked,
      existing,
      skipped,
      reversed_cents: sum,
      rows: result,
    },
    error: null,
  };
}

/** Nachbau von `book_affiliate_commissions()` — hier nur für `recredit` gebraucht. */
function bookAffiliateCommissions(payload: {
  tenant_id?: string;
  program_id?: string;
  lock_key?: string;
  rows?: Array<Record<string, unknown>>;
}): { data: Row | null; error: MockError | null } {
  if (!payload?.tenant_id || !payload?.program_id || !payload?.lock_key) {
    return { data: null, error: { code: "P0001", message: "affiliate_book_payload_incomplete" } };
  }
  const stored = table("affiliate_commissions");
  const result: Row[] = [];
  for (const entry of payload.rows ?? []) {
    // `parent_ref` loest die RPC innerhalb des Stapels auf; die
    // recredit-Zeilen dieses Blocks tragen keins und lassen es fallen.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { ref, parent_ref: _parentRef, ...columns } = entry as Record<string, unknown> & { ref: string };
    const found = stored.find(
      (r) => r.tenant_id === payload.tenant_id && r.dedup_key === columns.dedup_key,
    );
    if (found) {
      result.push({ ref, id: found.id, dedup_key: columns.dedup_key, inserted: false });
      continue;
    }
    const id = nextId("com");
    stored.push({ ...columns, id, tenant_id: payload.tenant_id, program_id: payload.program_id });
    result.push({ ref, id, dedup_key: columns.dedup_key, inserted: true });
  }
  return { data: { rows: result }, error: null };
}

class MockAdminClient {
  from(name: string): MockTable {
    return new MockTable(name);
  }
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: MockError | null }> {
    if (name === "book_affiliate_reversals") {
      return Promise.resolve(
        bookAffiliateReversals(args.p_payload as Parameters<typeof bookAffiliateReversals>[0]),
      );
    }
    if (name === "book_affiliate_commissions") {
      return Promise.resolve(
        bookAffiliateCommissions(args.p_payload as Parameters<typeof bookAffiliateCommissions>[0]),
      );
    }
    return Promise.resolve({ data: null, error: { code: "42883", message: "unbekannte RPC" } });
  }
}

type Admin = Parameters<typeof reverseForRefund>[0];
const admin = new MockAdminClient() as unknown as Admin;

// --- Grunddaten (5.9 Beispiel A) ----------------------------------------

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const PARTNER = "44444444-4444-4444-8444-444444444444";
const REFERRER = "55555555-5555-4555-8555-555555555555";
const ORDER = "66666666-6666-4666-8666-666666666666";
const CHARGE = "ch_beispielA";
const DISPUTE = "dp_beispielA";

const CHARGE_TOTAL = 44910;
const SALE = 11888;
const RESERVE = 1320;
const TIER2 = 2641;

/** Eine Stunde in der Zukunft — die Sperrfrist läuft noch. */
const HOLD_UNTIL = new Date(Date.now() + 3_600_000).toISOString();
const NOW = new Date("2026-09-11T12:00:00.000Z");

function commission(overrides: Row = {}): Row {
  return {
    id: nextId("com"),
    tenant_id: TENANT,
    program_id: PROGRAM,
    partner_id: PARTNER,
    kind: "sale",
    order_id: ORDER,
    stripe_invoice_id: null,
    stripe_subscription_id: null,
    stripe_charge_id: CHARGE,
    product_id: null,
    campaign: null,
    referral_id: null,
    parent_id: null,
    reverses_id: null,
    base_cents: 37739,
    basis_kind: "net",
    rate_kind: "percent",
    rate_bp: 3500,
    fixed_cents: 0,
    amount_cents: SALE,
    currency: "eur",
    condition_id: null,
    condition_snapshot: {},
    status: "pending",
    hold_until: HOLD_UNTIL,
    is_test: false,
    flagged: false,
    note: null,
    dedup_key: `sale:${ORDER}`,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Die drei Zeilen aus Beispiel A: sale, reserve, tier2 (anderer Partner). */
function seedBeispielA(status: string = "pending"): { sale: Row; reserve: Row; tier2: Row } {
  const sale = commission({ kind: "sale", amount_cents: SALE, status, dedup_key: `sale:${ORDER}` });
  const reserve = commission({
    kind: "reserve",
    amount_cents: RESERVE,
    status,
    parent_id: sale.id,
    dedup_key: `reserve:${ORDER}`,
  });
  const tier2 = commission({
    kind: "tier2",
    partner_id: REFERRER,
    amount_cents: TIER2,
    status,
    parent_id: sale.id,
    rate_bp: 2000,
    dedup_key: `tier2:${sale.id as string}`,
  });
  table("affiliate_commissions").push(sale, reserve, tier2);
  return { sale, reserve, tier2 };
}

function seedOrder(overrides: Row = {}): void {
  table("orders").push({
    id: ORDER,
    tenant_id: TENANT,
    amount_cents: CHARGE_TOTAL,
    status: "paid",
    refunded_cents: 0,
    stripe_payment_intent: "pi_beispielA",
    ...overrides,
  });
}

function reversalsOf(parentId: unknown): Row[] {
  return table("affiliate_commissions").filter(
    (r) => r.kind === "reversal" && r.reverses_id === parentId,
  );
}

function reversedSum(parentId: unknown): number {
  return reversalsOf(parentId).reduce((acc, r) => acc + Number(r.amount_cents), 0);
}

function refund(refundedTotal: number, now: Date = NOW) {
  return reverseForRefund(
    admin,
    {
      tenant_id: TENANT,
      order_id: ORDER,
      stripe_invoice_id: null,
      stripe_charge_id: CHARGE,
      refunded_total_cents: refundedTotal,
      charge_total_cents: CHARGE_TOTAL,
    },
    now,
  );
}

beforeEach(() => {
  db.tables = {};
  db.errors = {};
  db.nextId = 0;
});

// =======================================================================

describe("reverseForRefund — Vollstorno (5.8)", () => {
  it("nimmt jede Zeile vollständig zurück und lässt keinen Restcent", async () => {
    const { sale, reserve, tier2 } = seedBeispielA();
    seedOrder();

    const result = await refund(CHARGE_TOTAL);

    expect(result.matched).toBe(true);
    expect(result.booked).toBe(3);
    // EXAKT der Ursprungsbetrag, nicht „ungefähr": das Zielwert-Verfahren
    // rechnet bei Vollerstattung floor(x * n / n) = x.
    expect(reversedSum(sale.id)).toBe(-SALE);
    expect(reversedSum(reserve.id)).toBe(-RESERVE);
    expect(reversedSum(tier2.id)).toBe(-TIER2);
    expect(result.reversed_cents).toBe(SALE + RESERVE + TIER2);
  });

  it("ändert den Status der Ursprungszeilen NICHT (G6)", async () => {
    const { sale, reserve, tier2 } = seedBeispielA();
    seedOrder();

    await refund(CHARGE_TOTAL);

    for (const row of [sale, reserve, tier2]) {
      const stored = table("affiliate_commissions").find((r) => r.id === row.id);
      expect(stored?.status).toBe("pending");
      expect(stored?.amount_cents).toBe(row.amount_cents);
    }
  });

  it("setzt die Bestellung auf 'refunded' mit kumulativem Betrag", async () => {
    seedBeispielA();
    seedOrder();

    const result = await refund(CHARGE_TOTAL);

    expect(result.order_state).toBe("updated");
    const order = table("orders")[0];
    expect(order.status).toBe("refunded");
    expect(order.refunded_cents).toBe(CHARGE_TOTAL);
  });
});

describe("reverseForRefund — Teilstorno (5.9 Beispiel C, erste Stufe)", () => {
  it("bucht exakt die im Plan gerechneten Beträge", async () => {
    const { sale, reserve, tier2 } = seedBeispielA();
    seedOrder();

    await refund(10000);

    expect(reversedSum(sale.id)).toBe(-2647);
    expect(reversedSum(reserve.id)).toBe(-293);
    expect(reversedSum(tier2.id)).toBe(-588);
  });

  it("setzt die Bestellung auf 'partially_refunded'", async () => {
    seedBeispielA();
    seedOrder();

    const result = await refund(10000);

    expect(result.order_state).toBe("updated");
    expect(table("orders")[0].status).toBe("partially_refunded");
    expect(table("orders")[0].refunded_cents).toBe(10000);
  });
});

describe("reverseForRefund — mehrfache Teilerstattung, KUMULATIV (G7, 5.9 Beispiel C)", () => {
  it("bucht je Stufe das Delta und nicht den Zielwert", async () => {
    const { sale, reserve, tier2 } = seedBeispielA();
    seedOrder();

    await refund(10000);
    // Stripe meldet den GESAMTEN Stand, nicht die zweiten 100,00 EUR.
    await refund(20000);

    // Erste und zweite Stufe in Buchungsreihenfolge, laut Plan 5.9 Beispiel C.
    const amounts = (parent: unknown) => reversalsOf(parent).map((r) => Number(r.amount_cents));

    expect(amounts(sale.id)).toEqual([-2647, -2647]);
    // Die Reserve zeigt den Unterschied am deutlichsten: 293 + 294, nicht
    // zweimal derselbe Betrag — der Zielwert 587 minus bereits 293.
    expect(amounts(reserve.id)).toEqual([-293, -294]);
    expect(amounts(tier2.id)).toEqual([-588, -588]);

    // Wäre `amount_refunded` als Delta missverstanden worden, stünden hier
    // 5294 / 587 / 1176 — 60 % Storno bei 44,5 % Erstattung.
    expect(reversedSum(sale.id)).toBe(-5294);
    expect(reversedSum(reserve.id)).toBe(-587);
    expect(reversedSum(tier2.id)).toBe(-1176);
  });

  it("lässt nach der dritten Stufe (voll) keinen Restcent stehen", async () => {
    const { sale, reserve, tier2 } = seedBeispielA();
    seedOrder();

    await refund(10000);
    await refund(20000);
    await refund(CHARGE_TOTAL);

    // Die dritte Stufe bucht -6594 / -733 / -1465 (Plan 5.9 Beispiel C).
    expect(reversedSum(sale.id)).toBe(-SALE);
    expect(reversedSum(reserve.id)).toBe(-RESERVE);
    expect(reversedSum(tier2.id)).toBe(-TIER2);
    expect(reversalsOf(sale.id)).toHaveLength(3);
  });

  it("ist bei derselben Stufe zweimal folgenlos (G3, gleicher dedup_key)", async () => {
    const { sale } = seedBeispielA();
    seedOrder();

    await refund(10000);
    const again = await refund(10000);

    expect(again.booked).toBe(0);
    expect(reversalsOf(sale.id)).toHaveLength(1);
    expect(reversedSum(sale.id)).toBe(-2647);
    // Keine zweite Benachrichtigung an den Partner.
    expect(again.notifications).toEqual([]);
  });
});

describe("Überstornierung ist unmöglich", () => {
  it("deckelt einen Erstattungsbetrag über dem Charge auf 100 %", async () => {
    const { sale, reserve, tier2 } = seedBeispielA();
    seedOrder();

    await refund(CHARGE_TOTAL * 3);

    expect(reversedSum(sale.id)).toBe(-SALE);
    expect(reversedSum(reserve.id)).toBe(-RESERVE);
    expect(reversedSum(tier2.id)).toBe(-TIER2);
  });

  it("bucht nach dem Vollstorno nichts mehr nach", async () => {
    const { sale } = seedBeispielA();
    seedOrder();

    await refund(CHARGE_TOTAL);
    // Ein zweiter Vorgang auf denselben Zeilen, mit falscher (zu kleiner)
    // Bezugsgröße: das Verhältnis ergäbe erneut 100 %, die Differenz ist 0.
    const again = await reverseForRefund(
      admin,
      {
        tenant_id: TENANT,
        order_id: ORDER,
        stripe_invoice_id: null,
        stripe_charge_id: "ch_zweiter",
        refunded_total_cents: 22455,
        charge_total_cents: 22455,
      },
      NOW,
    );

    expect(again.booked).toBe(0);
    expect(reversedSum(sale.id)).toBe(-SALE);
  });

  it("greift nie auf die Zeilen eines anderen Mandanten zu (11.15)", async () => {
    seedBeispielA();
    seedOrder();

    const result = await reverseForRefund(
      admin,
      {
        tenant_id: OTHER_TENANT,
        order_id: ORDER,
        stripe_invoice_id: null,
        stripe_charge_id: CHARGE,
        refunded_total_cents: CHARGE_TOTAL,
        charge_total_cents: CHARGE_TOTAL,
      },
      NOW,
    );

    expect(result.matched).toBe(false);
    expect(result.booked).toBe(0);
    expect(table("affiliate_commissions").filter((r) => r.kind === "reversal")).toHaveLength(0);
  });
});

describe("Die zweite Stufe folgt der ersten (5.5, 5.8)", () => {
  it("storniert die tier2-Zeile des Werbers mit ihrem eigenen Verhältnis", async () => {
    const { tier2 } = seedBeispielA();
    seedOrder();

    const result = await refund(10000);

    const booked = result.rows.find((row) => row.reverses_id === tier2.id);
    expect(booked?.parent_kind).toBe("tier2");
    expect(booked?.partner_id).toBe(REFERRER);
    // floor(2641 * 10000 / 44910) = 588 — NICHT aus der stornierten
    // Erstprovision neu gerechnet.
    expect(booked?.amount_cents).toBe(-588);
  });

  it("meldet je (partner_id, currency) eine eigene Summe (5.11)", async () => {
    seedBeispielA();
    seedOrder();

    const result = await refund(CHARGE_TOTAL);

    expect(result.notifications).toEqual([
      { partner_id: PARTNER, currency: "eur", amount_cents: SALE + RESERVE },
      { partner_id: REFERRER, currency: "eur", amount_cents: TIER2 },
    ]);
  });
});

describe("Der Status-Eimer wird vom Elternteil geerbt (G6, 5.8)", () => {
  it("pending erbt Status und hold_until", async () => {
    const { sale } = seedBeispielA("pending");
    seedOrder();

    await refund(10000);

    const [reversal] = reversalsOf(sale.id);
    expect(reversal.status).toBe("pending");
    expect(reversal.hold_until).toBe(HOLD_UNTIL);
  });

  it("on_hold erbt Status und hold_until", async () => {
    const { sale } = seedBeispielA("on_hold");
    seedOrder();

    await refund(10000);

    const [reversal] = reversalsOf(sale.id);
    expect(reversal.status).toBe("on_hold");
    expect(reversal.hold_until).toBe(HOLD_UNTIL);
  });

  it("approved wird sofort approved mit hold_until = jetzt", async () => {
    const { sale } = seedBeispielA("approved");
    seedOrder();

    await refund(10000);

    const [reversal] = reversalsOf(sale.id);
    expect(reversal.status).toBe("approved");
    expect(reversal.hold_until).toBe(NOW.toISOString());
  });

  it("paid wird approved — es gibt keinen Rückweg von paid (6.3)", async () => {
    const { sale } = seedBeispielA("paid");
    seedOrder();

    await refund(10000);

    const [reversal] = reversalsOf(sale.id);
    expect(reversal.status).toBe("approved");
    expect(reversal.hold_until).toBe(NOW.toISOString());
  });

  it("cancelled und Testbuchungen werden nicht storniert", async () => {
    const cancelled = commission({ status: "cancelled", dedup_key: `sale:${ORDER}` });
    const test = commission({
      status: "cancelled",
      is_test: true,
      amount_cents: 500,
      dedup_key: `reserve:${ORDER}`,
      kind: "reserve",
      parent_id: cancelled.id,
    });
    table("affiliate_commissions").push(cancelled, test);
    seedOrder();

    const result = await refund(CHARGE_TOTAL);

    expect(result.booked).toBe(0);
    expect(table("affiliate_commissions").filter((r) => r.kind === "reversal")).toHaveLength(0);
  });

  it("inheritReversalState ist die reine Regel dahinter", () => {
    const at = new Date("2026-09-11T12:00:00.000Z");
    expect(inheritReversalState({ status: "pending", hold_until: HOLD_UNTIL }, at)).toEqual({
      status: "pending",
      hold_until: HOLD_UNTIL,
    });
    expect(inheritReversalState({ status: "on_hold", hold_until: HOLD_UNTIL }, at)).toEqual({
      status: "on_hold",
      hold_until: HOLD_UNTIL,
    });
    expect(inheritReversalState({ status: "approved", hold_until: HOLD_UNTIL }, at)).toEqual({
      status: "approved",
      hold_until: at.toISOString(),
    });
    expect(inheritReversalState({ status: "paid", hold_until: HOLD_UNTIL }, at)).toEqual({
      status: "approved",
      hold_until: at.toISOString(),
    });
    expect(inheritReversalState({ status: "cancelled", hold_until: HOLD_UNTIL }, at)).toBeNull();
  });
});

describe("reverseForDispute — Rückbuchung (5.8)", () => {
  it("behandelt den Streitbetrag wie eine Erstattung über diesen Betrag", async () => {
    const { sale, reserve, tier2 } = seedBeispielA();
    seedOrder();

    const result = await reverseForDispute(
      admin,
      {
        tenant_id: TENANT,
        order_id: ORDER,
        stripe_invoice_id: null,
        stripe_charge_id: CHARGE,
        dispute_id: DISPUTE,
        dispute_amount_cents: CHARGE_TOTAL,
        charge_total_cents: CHARGE_TOTAL,
      },
      NOW,
    );

    expect(result.booked).toBe(3);
    expect(reversedSum(sale.id)).toBe(-SALE);
    expect(reversedSum(reserve.id)).toBe(-RESERVE);
    expect(reversedSum(tier2.id)).toBe(-TIER2);
    // Der Streitfall steht im Schlüssel, nicht der Charge — nur so findet die
    // Wiedergutschrift später genau diese Gegenbuchungen wieder.
    expect(String(reversalsOf(sale.id)[0].dedup_key)).toBe(
      `reversal:${sale.id as string}:${DISPUTE}:${CHARGE_TOTAL}`,
    );
  });

  it("nimmt ohne bekannten Charge-Betrag die volle Provision zurück", async () => {
    const { sale } = seedBeispielA();
    seedOrder();

    await reverseForDispute(
      admin,
      {
        tenant_id: TENANT,
        order_id: ORDER,
        stripe_invoice_id: null,
        stripe_charge_id: CHARGE,
        dispute_id: DISPUTE,
        dispute_amount_cents: 20000,
        charge_total_cents: null,
      },
      NOW,
    );

    expect(reversedSum(sale.id)).toBe(-SALE);
  });

  it("setzt das Betrugsflag auf den Zeilen der letzten 30 Tage", async () => {
    seedBeispielA();
    seedOrder();
    // Beide gehoeren zu einer ANDEREN Bestellung: sie werden nicht
    // gegengebucht, es geht hier allein um das Flag.
    const otherOrder = "99999999-9999-4999-8999-999999999999";
    const old = commission({
      order_id: otherOrder,
      amount_cents: 700,
      dedup_key: "sale:alt",
      created_at: new Date(NOW.getTime() - 40 * 86_400_000).toISOString(),
    });
    const foreign = commission({
      order_id: otherOrder,
      partner_id: "77777777-7777-4777-8777-777777777777",
      dedup_key: "sale:fremd",
      created_at: NOW.toISOString(),
    });
    table("affiliate_commissions").push(old, foreign);

    await reverseForDispute(
      admin,
      {
        tenant_id: TENANT,
        order_id: ORDER,
        stripe_invoice_id: null,
        stripe_charge_id: CHARGE,
        dispute_id: DISPUTE,
        dispute_amount_cents: CHARGE_TOTAL,
        charge_total_cents: CHARGE_TOTAL,
      },
      NOW,
    );

    const stored = table("affiliate_commissions");
    expect(stored.find((r) => r.dedup_key === `sale:${ORDER}`)?.flagged).toBe(true);
    expect(stored.find((r) => r.dedup_key === "sale:alt")?.flagged).toBe(false);
    expect(stored.find((r) => r.dedup_key === "sale:fremd")?.flagged).toBe(false);
  });

  it("ändert den Status der Ursprungszeilen nicht (G6)", async () => {
    const { sale } = seedBeispielA("approved");
    seedOrder();

    await reverseForDispute(
      admin,
      {
        tenant_id: TENANT,
        order_id: ORDER,
        stripe_invoice_id: null,
        stripe_charge_id: CHARGE,
        dispute_id: DISPUTE,
        dispute_amount_cents: CHARGE_TOTAL,
        charge_total_cents: CHARGE_TOTAL,
      },
      NOW,
    );

    expect(table("affiliate_commissions").find((r) => r.id === sale.id)?.status).toBe("approved");
  });
});

describe("recreditForWonDispute — gewonnener Streitfall (5.8)", () => {
  async function disputeThenWin() {
    const seeded = seedBeispielA("approved");
    seedOrder();
    await reverseForDispute(
      admin,
      {
        tenant_id: TENANT,
        order_id: ORDER,
        stripe_invoice_id: null,
        stripe_charge_id: CHARGE,
        dispute_id: DISPUTE,
        dispute_amount_cents: CHARGE_TOTAL,
        charge_total_cents: CHARGE_TOTAL,
      },
      NOW,
    );
    return seeded;
  }

  it("schreibt jede Gegenbuchung dieses Streitfalls exakt wieder gut", async () => {
    const { sale, reserve, tier2 } = await disputeThenWin();

    const result = await recreditForWonDispute(
      admin,
      { tenant_id: TENANT, order_id: ORDER, stripe_invoice_id: null, dispute_id: DISPUTE },
      NOW,
    );

    expect(result.booked).toBe(3);
    expect(result.reversed_cents).toBe(SALE + RESERVE + TIER2);

    const recredits = table("affiliate_commissions").filter((r) => r.kind === "recredit");
    expect(recredits).toHaveLength(3);
    for (const parent of [sale, reserve, tier2]) {
      const reversal = reversalsOf(parent.id)[0];
      const recredit = recredits.find((r) => r.reverses_id === reversal.id);
      expect(recredit?.amount_cents).toBe(-Number(reversal.amount_cents));
      expect(recredit?.partner_id).toBe(parent.partner_id);
      expect(recredit?.dedup_key).toBe(`recredit:${reversal.id as string}:${DISPUTE}`);
      // Der Zustand der Gegenbuchung, nicht der der Ursprungszeile.
      expect(recredit?.status).toBe("approved");
    }
  });

  it("ist bei zweiter Zustellung folgenlos (G3)", async () => {
    await disputeThenWin();

    await recreditForWonDispute(
      admin,
      { tenant_id: TENANT, order_id: ORDER, stripe_invoice_id: null, dispute_id: DISPUTE },
      NOW,
    );
    const again = await recreditForWonDispute(
      admin,
      { tenant_id: TENANT, order_id: ORDER, stripe_invoice_id: null, dispute_id: DISPUTE },
      NOW,
    );

    expect(again.booked).toBe(0);
    expect(again.notifications).toEqual([]);
    expect(table("affiliate_commissions").filter((r) => r.kind === "recredit")).toHaveLength(3);
  });

  it("rührt die Gegenbuchungen einer Erstattung nicht an", async () => {
    const { sale } = seedBeispielA("approved");
    seedOrder();
    await refund(10000);

    const result = await recreditForWonDispute(
      admin,
      { tenant_id: TENANT, order_id: ORDER, stripe_invoice_id: null, dispute_id: DISPUTE },
      NOW,
    );

    expect(result.booked).toBe(0);
    expect(reversedSum(sale.id)).toBe(-2647);
    expect(table("affiliate_commissions").filter((r) => r.kind === "recredit")).toHaveLength(0);
  });

  it("gibt den Weg für eine spätere echte Erstattung wieder frei", async () => {
    const { sale } = await disputeThenWin();
    await recreditForWonDispute(
      admin,
      { tenant_id: TENANT, order_id: ORDER, stripe_invoice_id: null, dispute_id: DISPUTE },
      NOW,
    );

    // Netto ist nichts mehr gegengebucht — eine echte Erstattung muss wieder
    // vollständig durchgreifen können.
    await refund(CHARGE_TOTAL);

    const reversals = reversalsOf(sale.id);
    expect(reversals).toHaveLength(2);
    expect(reversals.map((r) => Number(r.amount_cents))).toEqual([-SALE, -SALE]);
  });
});

describe("Kein Affiliate-Bezug", () => {
  it("meldet `matched: false`, wenn es keine Provisionszeile gibt", async () => {
    seedOrder();

    const result = await refund(CHARGE_TOTAL);

    expect(result.matched).toBe(false);
    expect(result.booked).toBe(0);
    // Der Bestellzustand wird trotzdem nachgeführt: `refunded_cents` gehört
    // der Bestellung, nicht dem Affiliate-Modul.
    expect(result.order_state).toBe("updated");
    expect(table("orders")[0].status).toBe("refunded");
  });

  it("verlangt mindestens eine Herkunftskennung", () => {
    expect(() =>
      affiliateRefundInputSchema.parse({
        tenant_id: TENANT,
        order_id: null,
        stripe_invoice_id: null,
        stripe_charge_id: CHARGE,
        refunded_total_cents: 1,
        charge_total_cents: 2,
      }),
    ).toThrow();
  });
});

describe("applyOrderRefundState — Monotonie (5.8)", () => {
  it("senkt einen bereits erreichten Stand nicht wieder ab", async () => {
    seedOrder({ refunded_cents: 20000, status: "partially_refunded" });

    const state = await applyOrderRefundState(admin, {
      tenant_id: TENANT,
      order_id: ORDER,
      refunded_total_cents: 10000,
      charge_total_cents: CHARGE_TOTAL,
    });

    expect(state).toBe("unchanged");
    expect(table("orders")[0].refunded_cents).toBe(20000);
  });

  it("meldet eine fremde Bestellung als `missing` statt sie zu ändern", async () => {
    seedOrder();

    const state = await applyOrderRefundState(admin, {
      tenant_id: OTHER_TENANT,
      order_id: ORDER,
      refunded_total_cents: 10000,
      charge_total_cents: CHARGE_TOTAL,
    });

    expect(state).toBe("missing");
    expect(table("orders")[0].refunded_cents).toBe(0);
  });

  it("lässt eine nie bezahlte Bestellung unangetastet (Erlaubnisliste)", async () => {
    seedOrder({ status: "failed" });

    const state = await applyOrderRefundState(admin, {
      tenant_id: TENANT,
      order_id: ORDER,
      refunded_total_cents: 10000,
      charge_total_cents: CHARGE_TOTAL,
    });

    expect(state).toBe("unchanged");
    expect(table("orders")[0].status).toBe("failed");
  });
});
