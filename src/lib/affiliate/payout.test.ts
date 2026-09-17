import { beforeEach, describe, expect, it } from "vitest";
import {
  approveAffiliatePayout,
  createAffiliatePayoutDrafts,
  markAffiliatePayoutFailed,
  markAffiliatePayoutPaid,
  planAffiliatePayoutRun,
  resolveAffiliatePayoutPeriod,
} from "./payout";

/**
 * Affiliate-System, Block B8 — DER AUSZAHLUNGSLAUF
 * (PLAN_Affiliate-System.md 7.1, 7.2, 7.6, 7.7; G8, G15).
 *
 * Mock-Muster wie `reversal.test.ts` und `process.test.ts`: ein In-Memory-
 * Array je Tabelle mit ECHT angewandten Filtern. Der Compare-and-Swap ist
 * deshalb ein echter Compare-and-Swap — `update(...).is("payout_id", null)`
 * greift im Mock nur, solange die Zeile ungestempelt ist. Ohne diese
 * Eigenschaft prüfte der Test „zwei gleichzeitige Läufe" nichts.
 *
 * Nachgebaut sind außerdem zwei Regeln der Datenbank, weil die Tests sonst
 * etwas behaupten, das im Betrieb nicht gilt:
 *   - `select("*")` bricht auf den Affiliate-Tabellen mit 42501 ab
 *     (Spalten-Grant); der Mock liefert dafür eine leere Menge.
 *   - `approve_affiliate_payout()` zieht die Belegnummer lückenlos je Mandant
 *     und Jahr und setzt den Status nur aus `draft` heraus (7.2/7.3).
 *
 * Geprüft werden die sechs Fälle aus dem Bauplan: Mindestbetrag, Negativsaldo,
 * blockiertes Profil, Währungstrennung, zwei gleichzeitige Läufe, G15.
 */

type Row = Record<string, unknown>;
type MockError = { code?: string; message: string };

const db: {
  tables: Record<string, Row[]>;
  errors: Record<string, MockError | undefined>;
  nextId: number;
  counters: Record<string, number>;
} = { tables: {}, errors: {}, nextId: 0, counters: {} };

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

type Predicate = (row: Row) => boolean;

/** Die Filterkette, die Lesen, Schreiben und Löschen teilen. */
class Filters {
  protected predicates: Predicate[] = [];

  eq(column: string, value: unknown): this {
    this.predicates.push((r) => r[column] === value);
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    this.predicates.push((r) => values.includes(r[column]));
    return this;
  }
  is(column: string, value: null): this {
    this.predicates.push((r) => (r[column] ?? null) === value);
    return this;
  }
  lte(column: string, value: unknown): this {
    this.predicates.push((r) => compare(r[column], value) <= 0);
    return this;
  }
  gt(column: string, value: unknown): this {
    this.predicates.push((r) => compare(r[column] ?? 0, value) > 0);
    return this;
  }
  protected matches(rows: readonly Row[]): Row[] {
    return rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
  }
}

class MockSelect extends Filters {
  private sortColumn: string | null = null;

  constructor(
    private tableName: string,
    private columns: string,
  ) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().select().order(col, opts) passen; der Mock sortiert nur nach Spalte
  order(column: string, _options?: { ascending?: boolean }): this {
    this.sortColumn = column;
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu .range(from, to) passen; der Test bleibt unter der Seitengroesse
  range(_from: number, _to: number): this {
    // Der Test bleibt bewusst unter der Seitengröße; die Schleife in payout.ts
    // bricht damit nach der ersten Seite ab.
    return this;
  }

  private resolve(): { data: Row[] | null; error: MockError | null } {
    const error = db.errors[this.tableName];
    if (error) return { data: null, error };
    if (this.columns.trim() === "*") {
      return { data: null, error: { code: "42501", message: "permission denied for column" } };
    }
    const rows = this.matches(table(this.tableName)).map((row) => ({ ...row }));
    if (this.sortColumn !== null) {
      const column = this.sortColumn;
      rows.sort((a, b) => compare(a[column], b[column]));
    }
    return { data: rows, error: null };
  }

  maybeSingle<T = Row>(): Promise<{ data: T | null; error: MockError | null }> {
    const { data, error } = this.resolve();
    return Promise.resolve({ data: (data?.[0] ?? null) as T | null, error });
  }
  then<T>(onFulfilled: (v: { data: Row[] | null; error: MockError | null }) => T): Promise<T> {
    return Promise.resolve(onFulfilled(this.resolve()));
  }
}

class MockUpdate extends Filters {
  constructor(
    private tableName: string,
    private patch: Row,
  ) {
    super();
  }

  private resolve(): { data: Row[] | null; error: MockError | null } {
    const error = db.errors[this.tableName];
    if (error) return { data: null, error };
    const matched = this.matches(table(this.tableName));
    for (const row of matched) {
      Object.assign(row, this.patch);
      // Der Guard-Trigger setzt `paid_at` selbst (G8, zweite Hälfte).
      if (this.tableName === "affiliate_commissions" && this.patch.status === "paid") {
        row.paid_at = "2026-10-01T00:00:00.000Z";
      }
    }
    return { data: matched.map((row) => ({ ...row })), error: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().update().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
  select(_columns: string): { then: MockUpdate["then"] } {
    return { then: (onFulfilled) => this.then(onFulfilled) };
  }
  then<T>(onFulfilled: (v: { data: Row[] | null; error: MockError | null }) => T): Promise<T> {
    return Promise.resolve(onFulfilled(this.resolve()));
  }
}

class MockDelete extends Filters {
  constructor(private tableName: string) {
    super();
  }

  then<T>(onFulfilled: (v: { data: Row[] | null; error: MockError | null }) => T): Promise<T> {
    const error = db.errors[this.tableName];
    if (error) return Promise.resolve(onFulfilled({ data: null, error }));
    const rows = table(this.tableName);
    const removed = this.matches(rows);
    db.tables[this.tableName] = rows.filter((row) => !removed.includes(row));
    return Promise.resolve(onFulfilled({ data: removed, error: null }));
  }
}

class MockInsert {
  constructor(
    private tableName: string,
    private values: Row,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().insert().select(cols) passen
  select(_columns: string): {
    maybeSingle: <T = Row>() => Promise<{ data: T | null; error: MockError | null }>;
  } {
    return {
      maybeSingle: <T = Row>() => {
        const error = db.errors[this.tableName];
        if (error) return Promise.resolve({ data: null, error });
        const row: Row = { id: nextId("pay"), ...this.values };
        table(this.tableName).push(row);
        return Promise.resolve({ data: { ...row } as T, error: null });
      },
    };
  }
}

/** Nachbau von `approve_affiliate_payout()` samt `next_affiliate_document_no()` (7.2/7.3). */
function approveRpc(payoutId: string): { data: unknown; error: MockError | null } {
  const payout = table("affiliate_payouts").find((row) => row.id === payoutId);
  if (!payout) return { data: null, error: { code: "P0001", message: "payout_not_found" } };
  if (payout.status !== "draft") {
    return { data: null, error: { code: "P0001", message: "payout_not_draft" } };
  }

  const year = String(payout.period_to ?? "").slice(0, 4);
  const key = `${payout.tenant_id}|${year}`;
  const no = (db.counters[key] ?? 0) + 1;
  db.counters[key] = no;

  payout.status = "approved";
  payout.approved_at = "2026-10-01T00:00:00.000Z";
  payout.document_no = `GS-DEMO-${year}-${String(no).padStart(6, "0")}`;
  payout.document_issued_at = "2026-10-01T00:00:00.000Z";
  return { data: { document_no: payout.document_no }, error: null };
}

const mockAdmin = {
  from(tableName: string) {
    return {
      select: (columns: string) => new MockSelect(tableName, columns),
      update: (patch: Row) => new MockUpdate(tableName, patch),
      insert: (values: Row) => new MockInsert(tableName, values),
      delete: () => new MockDelete(tableName),
    };
  },
  rpc(name: string, args: Record<string, unknown>) {
    if (name !== "approve_affiliate_payout") {
      return Promise.resolve({ data: null, error: { code: "42883", message: "unknown rpc" } });
    }
    return Promise.resolve(approveRpc(String(args.p_payout_id)));
  },
};

type Admin = Parameters<typeof planAffiliatePayoutRun>[0];
const admin = mockAdmin as unknown as Admin;

// --- Ausgangsbestand ----------------------------------------------------

const TENANT = "tenant-1";
const PROGRAM = "program-1";
const NOW = new Date("2026-10-01T06:00:00.000Z");
const PERIOD = { from: "2026-09-01", to: "2026-09-30" };

const LEGAL_ENTITY = {
  name: "Calltalent LLC",
  addressLines: ["1309 Coffeen Avenue STE 1200", "Sheridan, WY 82801", "United States"],
  email: "office@calltalent.ai",
  registrationNumber: "2026-002057636",
};

/** Vollständiges Inlandsprofil mit gültiger Testnummer (keine echte Bankverbindung). */
function billingProfile(partnerId: string, patch: Row = {}): Row {
  return {
    partner_id: partnerId,
    tenant_id: TENANT,
    entity_kind: "business",
    legal_name: "Beispiel Partner GmbH",
    street: "Musterweg 1",
    postal_code: "10115",
    city: "Berlin",
    country: "DE",
    small_business: false,
    vat_id: null,
    vat_check_result: null,
    vat_checked_at: null,
    payout_method: "sepa",
    account_holder: "Beispiel Partner GmbH",
    iban: "DE02120300000000202051",
    bic: "BYLADEM1001",
    paypal_email: null,
    ...patch,
  };
}

function partner(id: string, patch: Row = {}): Row {
  return {
    id,
    tenant_id: TENANT,
    program_id: PROGRAM,
    user_id: `user-${id}`,
    display_name: `Partner ${id}`,
    company: null,
    status: "active",
    payout_hold: false,
    ...patch,
  };
}

/** Eine auszahlungsreife Provisionszeile. */
function commission(patch: Row = {}): Row {
  return {
    id: nextId("com"),
    tenant_id: TENANT,
    program_id: PROGRAM,
    partner_id: "p1",
    kind: "sale",
    order_id: null,
    amount_cents: 10_000,
    currency: "eur",
    status: "approved",
    payout_id: null,
    reverses_id: null,
    hold_until: "2026-09-20",
    booked_at: "2026-09-15",
    is_test: false,
    ...patch,
  };
}

beforeEach(() => {
  db.tables = {};
  db.errors = {};
  db.counters = {};
  db.nextId = 0;

  table("tenants").push({ id: TENANT, legal: { entity: LEGAL_ENTITY } });
  table("affiliate_programs").push({
    id: PROGRAM,
    tenant_id: TENANT,
    min_payout_cents: 2500,
    payout_schedule: "monthly",
    currency: "eur",
  });
  table("affiliate_payouts");
  table("affiliate_daily_stats");
  table("orders");
});

async function plan() {
  return planAffiliatePayoutRun(admin, { tenantId: TENANT, programId: PROGRAM, now: NOW });
}

// --- 1. Mindestbetrag ---------------------------------------------------

describe("Mindestbetrag (7.1)", () => {
  it("erzeugt keinen Entwurf unter dem Mindestbetrag und meldet den Grund", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 2400 }));

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(0);
    expect(result.blocked).toEqual([
      {
        partner_id: "p1",
        currency: "eur",
        available_cents: 2400,
        reason: "below_minimum",
        field: null,
        messageKey: "affiliate.payoutRun.blocked.below_minimum",
      },
    ]);
  });

  it("zahlt genau auf dem Mindestbetrag aus — die Grenze ist inklusiv", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 2500 }));

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      partner_id: "p1",
      currency: "eur",
      available_cents: 2500,
      tax_mode: "regular",
      tax_rate_bp: 1900,
      // 2500 netto + 19 % = 475 -> 2975 brutto.
      preview_total_cents: 2975,
    });
  });

  it("lässt den Restbetrag stehen, statt ihn zu verfallen", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 2400 }));

    await plan();

    // Kein Stempel, kein Statuswechsel: die Zeile läuft in den nächsten Lauf.
    expect(table("affiliate_commissions")[0]).toMatchObject({
      status: "approved",
      payout_id: null,
    });
  });
});

// --- 2. Negativsaldo ----------------------------------------------------

describe("Negativsaldo (5.10)", () => {
  it("erzeugt keinen Satz und keine Schuldenmechanik, meldet den Fall aber", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    const sale = commission({ amount_cents: 10_000 });
    table("affiliate_commissions").push(
      sale,
      commission({ kind: "reversal", amount_cents: -10_500, reverses_id: sale.id }),
    );

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(0);
    expect(result.blocked[0]).toMatchObject({
      reason: "negative_balance",
      available_cents: -500,
    });
    // Beide Zeilen bleiben unangetastet und verrechnen sich mit der nächsten
    // Provision — der Saldo wird vorgetragen.
    expect(table("affiliate_commissions").every((row) => row.payout_id === null)).toBe(true);
  });

  it("meldet einen Saldo von genau 0 gar nicht — das wäre nur Lärm", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    const sale = commission({ amount_cents: 10_000 });
    table("affiliate_commissions").push(
      sale,
      commission({ kind: "reversal", amount_cents: -10_000, reverses_id: sale.id }),
    );

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
  });
});

// --- 3. Blockiertes Profil ----------------------------------------------

describe("Blockiertes Profil (7.1, 7.4)", () => {
  beforeEach(() => {
    table("affiliate_commissions").push(commission({ amount_cents: 50_000 }));
  });

  it("blockiert eine Privatperson mit eigenem Grund, nicht als Warnung", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1", { entity_kind: "private" }));

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(0);
    expect(result.blocked[0]).toMatchObject({
      reason: "tax_private_entity",
      field: "entity_kind",
      messageKey: "affiliate.payoutRun.blocked.tax_private_entity",
    });
  });

  it("blockiert einen EU-Partner ohne geprüfte USt-IdNr. und verlinkt auf das Feld", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1", { country: "AT", vat_id: null }));

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocked[0]).toMatchObject({ reason: "tax_eu_vat_missing", field: "vat_id" });
  });

  it("nennt bei unvollständiger Anschrift GENAU das erste fehlende Feld", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1", { postal_code: "  " }));

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocked[0]).toMatchObject({
      reason: "address_incomplete",
      field: "postal_code",
    });
  });

  it("blockiert ein gesperrtes Konto und einen nicht aktiven Partner", async () => {
    table("affiliate_partners").push(partner("p1", { payout_hold: true }));
    table("affiliate_billing_profiles").push(billingProfile("p1"));

    const held = await plan();
    expect(held.ok && held.blocked[0].reason).toBe("payout_hold");

    db.tables.affiliate_partners = [partner("p1", { status: "suspended" })];
    const suspended = await plan();
    expect(suspended.ok && suspended.blocked[0].reason).toBe("partner_inactive");
  });

  it("blockiert eine unbrauchbare IBAN, bevor eine Bankdatei daraus entsteht", async () => {
    table("affiliate_partners").push(partner("p1"));
    // Ein Zahlendreher in der Prüfziffer.
    table("affiliate_billing_profiles").push(
      billingProfile("p1", { iban: "DE03120300000000202051" }),
    );

    const result = await plan();

    expect(result.ok && result.blocked[0]).toMatchObject({ reason: "iban_invalid", field: "iban" });
  });

  it("blockiert ein fehlendes Abrechnungsprofil ganz", async () => {
    table("affiliate_partners").push(partner("p1"));

    const result = await plan();

    expect(result.ok && result.blocked[0].reason).toBe("billing_profile_missing");
  });

  it("sperrt den GESAMTEN Lauf, wenn der Mandant keinen Rechtsträger hinterlegt hat", async () => {
    db.tables.tenants = [{ id: TENANT, legal: {} }];
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));

    expect(await plan()).toEqual({ ok: false, reason: "tenant_legal_entity_missing" });
  });

  it("liefert keinen Saldo, wenn die Zeilen nicht vollständig geladen werden konnten", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    db.errors.affiliate_commissions = { code: "57014", message: "canceling statement" };

    expect(await plan()).toEqual({ ok: false, reason: "balances_incomplete" });
  });
});

// --- 4. Währungstrennung ------------------------------------------------

describe("Währungstrennung (5.11)", () => {
  beforeEach(() => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(
      commission({ amount_cents: 120_000, currency: "eur" }),
      commission({ amount_cents: 80_000, currency: "chf" }),
    );
  });

  it("macht aus einem Partner mit zwei Währungen zwei Kandidaten", async () => {
    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.currency).sort()).toEqual(["chf", "eur"]);
  });

  it("erzeugt zwei Sätze, und kein Satz sammelt die Zeile der anderen Währung ein", async () => {
    const result = await plan();
    if (!result.ok) return;

    const outcomes = await createAffiliatePayoutDrafts(admin, {
      tenantId: TENANT,
      candidates: result.candidates,
      minPayoutCents: result.minPayoutCents,
      periodFrom: PERIOD.from,
      periodTo: PERIOD.to,
    });

    expect(outcomes.filter((outcome) => outcome.status === "created")).toHaveLength(2);

    const payouts = table("affiliate_payouts");
    expect(payouts).toHaveLength(2);

    const chf = payouts.find((row) => row.currency === "chf");
    const eur = payouts.find((row) => row.currency === "eur");
    expect(chf).toMatchObject({ gross_cents: 80_000, subtotal_cents: 80_000, total_cents: 95_200 });
    expect(eur).toMatchObject({ gross_cents: 120_000, subtotal_cents: 120_000, total_cents: 142_800 });

    // Jede Provisionszeile trägt den Stempel des Satzes IHRER Währung.
    for (const row of table("affiliate_commissions")) {
      const payout = payouts.find((candidate) => candidate.id === row.payout_id);
      expect(payout?.currency).toBe(row.currency);
    }
  });
});

// --- 5. Zwei gleichzeitige Läufe ----------------------------------------

describe("Zwei gleichzeitige Läufe (G8, 7.1)", () => {
  beforeEach(() => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 60_000 }));
  });

  it("greifen nie dieselbe Zeile: einer sammelt ein, der andere bleibt leer", async () => {
    const first = await plan();
    const second = await plan();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const [a, b] = await Promise.all([
      createAffiliatePayoutDrafts(admin, {
        tenantId: TENANT,
        candidates: first.candidates,
        minPayoutCents: first.minPayoutCents,
        periodFrom: PERIOD.from,
        periodTo: PERIOD.to,
      }),
      createAffiliatePayoutDrafts(admin, {
        tenantId: TENANT,
        candidates: second.candidates,
        minPayoutCents: second.minPayoutCents,
        periodFrom: PERIOD.from,
        periodTo: PERIOD.to,
      }),
    ]);

    const statuses = [...a, ...b].map((outcome) => outcome.status).sort();
    expect(statuses).toEqual(["created", "skipped"]);
    expect([...a, ...b].find((outcome) => outcome.status === "skipped")).toMatchObject({
      reason: "no_rows",
    });

    // Genau EIN Satz bleibt stehen; der leere Entwurf des Verlierers ist
    // entfernt, damit keine Belegnummer auf ein Nichts gezogen wird.
    expect(table("affiliate_payouts")).toHaveLength(1);
    expect(table("affiliate_payouts")[0]).toMatchObject({
      subtotal_cents: 60_000,
      total_cents: 71_400,
      status: "draft",
    });
  });

  it("sammelt weder Testbestellungen noch Zeilen mit laufender Sperrfrist ein", async () => {
    table("affiliate_commissions").push(
      commission({ amount_cents: 9_000, is_test: true }),
      commission({ amount_cents: 7_000, hold_until: "2026-10-20" }),
      commission({ amount_cents: 5_000, status: "pending" }),
    );

    const result = await plan();
    if (!result.ok) return;

    await createAffiliatePayoutDrafts(admin, {
      tenantId: TENANT,
      candidates: result.candidates,
      minPayoutCents: result.minPayoutCents,
      periodFrom: PERIOD.from,
      periodTo: PERIOD.to,
    });

    // Nur die 60 000 aus dem Ausgangsbestand; die Belegsumme stammt aus den
    // TATSÄCHLICH reservierten Zeilen, nicht aus der Vorschau.
    expect(table("affiliate_payouts")[0]).toMatchObject({ subtotal_cents: 60_000 });
    const stamped = table("affiliate_commissions").filter((row) => row.payout_id !== null);
    expect(stamped).toHaveLength(1);
    expect(stamped[0].amount_cents).toBe(60_000);
  });

  it("löst die Stempel wieder, wenn nach dem Einsammeln zu wenig zusammenkommt", async () => {
    // Die Vorschau sieht 60 000; bis zur Reservierung ist eine Gegenbuchung
    // dazwischengekommen, die den Satz unter den Mindestbetrag drückt.
    const result = await plan();
    if (!result.ok) return;

    const sale = table("affiliate_commissions")[0];
    table("affiliate_commissions").push(
      commission({ kind: "reversal", amount_cents: -59_000, reverses_id: sale.id }),
    );

    const outcomes = await createAffiliatePayoutDrafts(admin, {
      tenantId: TENANT,
      candidates: result.candidates,
      minPayoutCents: result.minPayoutCents,
      periodFrom: PERIOD.from,
      periodTo: PERIOD.to,
    });

    expect(outcomes[0]).toMatchObject({ status: "skipped", reason: "below_minimum_after_claim" });
    expect(table("affiliate_payouts")).toHaveLength(0);
    expect(table("affiliate_commissions").every((row) => row.payout_id === null)).toBe(true);
  });
});

// --- 6. G15 und der weitere Lebenslauf ----------------------------------

describe("Freigabe, G15 und Bankabgleich (7.2, 7.7)", () => {
  async function createDraft(): Promise<string> {
    const result = await plan();
    if (!result.ok) throw new Error("Plan fehlgeschlagen");
    const outcomes = await createAffiliatePayoutDrafts(admin, {
      tenantId: TENANT,
      candidates: result.candidates,
      minPayoutCents: result.minPayoutCents,
      periodFrom: PERIOD.from,
      periodTo: PERIOD.to,
    });
    const created = outcomes.find((outcome) => outcome.status === "created");
    if (created === undefined || created.status !== "created") throw new Error("Kein Entwurf");
    return created.payout_id;
  }

  beforeEach(() => {
    table("affiliate_partners").push(partner("p1", { user_id: "manager-1" }));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 60_000 }));
  });

  it("G15: der Manager gibt eine Auszahlung an sich selbst NICHT frei", async () => {
    const payoutId = await createDraft();

    const result = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId,
      actorUserId: "manager-1",
    });

    expect(result).toEqual({ ok: false, reason: "self_approval" });
    // Kein Statuswechsel, keine Belegnummer — der Vorgang bleibt offen für
    // eine andere Person.
    expect(table("affiliate_payouts")[0]).toMatchObject({ status: "draft" });
    expect(table("affiliate_payouts")[0].document_no).toBeUndefined();
  });

  it("G15 greift nicht bei einer fremden Partnerzeile", async () => {
    const payoutId = await createDraft();

    const result = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId,
      actorUserId: "manager-2",
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.document_no).toBe("GS-DEMO-2026-000001");
    expect(table("affiliate_payouts")[0]).toMatchObject({ status: "approved" });
  });

  it("vergibt lückenlos fortlaufende Belegnummern", async () => {
    const firstId = await createDraft();
    table("affiliate_commissions").push(commission({ partner_id: "p2", amount_cents: 30_000 }));
    table("affiliate_partners").push(partner("p2", { user_id: "user-p2" }));
    table("affiliate_billing_profiles").push(billingProfile("p2"));
    const secondPlan = await plan();
    if (!secondPlan.ok) return;
    const outcomes = await createAffiliatePayoutDrafts(admin, {
      tenantId: TENANT,
      candidates: secondPlan.candidates,
      minPayoutCents: secondPlan.minPayoutCents,
      periodFrom: PERIOD.from,
      periodTo: PERIOD.to,
    });
    const secondId = outcomes.find((outcome) => outcome.status === "created");
    if (secondId === undefined || secondId.status !== "created") throw new Error("Kein Entwurf");

    const a = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId: firstId,
      actorUserId: "manager-2",
    });
    const b = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId: secondId.payout_id,
      actorUserId: "manager-2",
    });

    expect(a.ok && a.document_no).toBe("GS-DEMO-2026-000001");
    expect(b.ok && b.document_no).toBe("GS-DEMO-2026-000002");
  });

  it("gibt einen bereits freigegebenen Satz kein zweites Mal frei", async () => {
    const payoutId = await createDraft();
    await approveAffiliatePayout(admin, { tenantId: TENANT, payoutId, actorUserId: "manager-2" });

    const second = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId,
      actorUserId: "manager-2",
    });

    expect(second).toEqual({ ok: false, reason: "not_draft" });
  });

  it("findet einen Satz eines fremden Mandanten nicht (§2.15)", async () => {
    const payoutId = await createDraft();

    const result = await approveAffiliatePayout(admin, {
      tenantId: "tenant-fremd",
      payoutId,
      actorUserId: "manager-2",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("verweigert die Freigabe, wenn die Positionssumme vom Belegkopf abweicht (7.6)", async () => {
    const payoutId = await createDraft();
    // Eine Zeile wird nachträglich entstempelt — genau der Fall, für den es
    // Gleichung 1 gibt.
    table("affiliate_commissions")[0].payout_id = null;

    const result = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId,
      actorUserId: "manager-2",
    });

    expect(result).toEqual({ ok: false, reason: "integrity_mismatch" });
    expect(table("affiliate_payouts")[0]).toMatchObject({ status: "draft" });
  });

  it("setzt nach dem Bankabgleich Satz und Zeilen auf bezahlt", async () => {
    const payoutId = await createDraft();
    await approveAffiliatePayout(admin, { tenantId: TENANT, payoutId, actorUserId: "manager-2" });

    const result = await markAffiliatePayoutPaid(admin, {
      tenantId: TENANT,
      payoutId,
      reference: "SEPA-2026-10-01/17",
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, affected_rows: 1 });
    expect(table("affiliate_payouts")[0]).toMatchObject({
      status: "paid",
      reference: "SEPA-2026-10-01/17",
    });
    expect(table("affiliate_commissions")[0]).toMatchObject({ status: "paid" });
  });

  it("weist eine Referenz mit unzulässigen Zeichen ab", async () => {
    const payoutId = await createDraft();
    await approveAffiliatePayout(admin, { tenantId: TENANT, payoutId, actorUserId: "manager-2" });

    await expect(
      markAffiliatePayoutPaid(admin, {
        tenantId: TENANT,
        payoutId,
        reference: "<script>alert(1)</script>",
      }),
    ).rejects.toThrow();
  });

  it("gibt die Zeilen nach einer fehlgeschlagenen Überweisung frei, behält aber den Beleg", async () => {
    const payoutId = await createDraft();
    await approveAffiliatePayout(admin, { tenantId: TENANT, payoutId, actorUserId: "manager-2" });

    const result = await markAffiliatePayoutFailed(admin, { tenantId: TENANT, payoutId });

    expect(result).toMatchObject({ ok: true, affected_rows: 1 });
    expect(table("affiliate_payouts")).toHaveLength(1);
    expect(table("affiliate_payouts")[0]).toMatchObject({
      status: "failed",
      document_no: "GS-DEMO-2026-000001",
    });
    // Die Zeile ist wieder frei und läuft in den nächsten Entwurf — Status
    // bleibt `approved`, sie war nie bezahlt.
    expect(table("affiliate_commissions")[0]).toMatchObject({
      status: "approved",
      payout_id: null,
    });
  });
});

// --- Fälligkeit ---------------------------------------------------------

describe("resolveAffiliatePayoutPeriod (7.1)", () => {
  it("weekly: montags, Zeitraum Montag bis Sonntag davor", () => {
    // 2026-10-05 ist ein Montag.
    expect(resolveAffiliatePayoutPeriod("weekly", new Date("2026-10-05T03:00:00Z"))).toEqual({
      due: true,
      from: "2026-09-28",
      to: "2026-10-04",
    });
    expect(resolveAffiliatePayoutPeriod("weekly", new Date("2026-10-06T03:00:00Z")).due).toBe(false);
  });

  it("semi_monthly: am 16. die erste Monatshälfte, am 1. die zweite des Vormonats", () => {
    expect(resolveAffiliatePayoutPeriod("semi_monthly", new Date("2026-10-16T03:00:00Z"))).toEqual({
      due: true,
      from: "2026-10-01",
      to: "2026-10-15",
    });
    expect(resolveAffiliatePayoutPeriod("semi_monthly", new Date("2026-10-01T03:00:00Z"))).toEqual({
      due: true,
      from: "2026-09-16",
      to: "2026-09-30",
    });
    expect(resolveAffiliatePayoutPeriod("semi_monthly", new Date("2026-10-07T03:00:00Z")).due).toBe(
      false,
    );
  });

  it("monthly: am 1. der volle Vormonat, auch über einen Jahreswechsel", () => {
    expect(resolveAffiliatePayoutPeriod("monthly", new Date("2027-01-01T03:00:00Z"))).toEqual({
      due: true,
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("trifft den Februar eines Schaltjahrs", () => {
    expect(resolveAffiliatePayoutPeriod("monthly", new Date("2028-03-01T03:00:00Z"))).toEqual({
      due: true,
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });
});
