import { beforeEach, describe, expect, it } from "vitest";
import {
  countPendingReversals,
  hasCriticalIntegrityFinding,
  verifyAffiliateIntegrity,
} from "./integrity";

/**
 * Affiliate-System, Block B8 — KONTROLLABGLEICH (PLAN_Affiliate-System.md 7.6).
 *
 * Geprüft werden alle drei Gleichungen, jeweils in beide Richtungen: der
 * saubere Bestand meldet NICHTS, der manipulierte meldet genau einen Befund
 * mit der richtigen Differenz. Ein Abgleich, der nur „findet Fehler" kann,
 * aber im Normalbetrieb rauscht, wird nach zwei Wochen ignoriert — deshalb
 * steht hinter jedem Fehlerfall ein Gegenbeispiel.
 *
 * Mock-Muster wie `payout.test.ts`: In-Memory-Arrays mit echt angewandten
 * Filtern, `select("*")` bricht mit 42501 ab.
 */

type Row = Record<string, unknown>;
type MockError = { code?: string; message: string };

const db: { tables: Record<string, Row[]>; errors: Record<string, MockError | undefined> } = {
  tables: {},
  errors: {},
};

function table(name: string): Row[] {
  return db.tables[name] ?? (db.tables[name] = []);
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

class Chain {
  protected predicates: Array<(row: Row) => boolean> = [];

  eq(column: string, value: unknown): this {
    this.predicates.push((r) => r[column] === value);
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    this.predicates.push((r) => values.includes(r[column]));
    return this;
  }
  gt(column: string, value: unknown): this {
    this.predicates.push((r) => compare(r[column] ?? 0, value) > 0);
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().select().order(col, opts) passen; die Reihenfolge prueft dieser Test nicht
  order(_column: string, _options?: { ascending?: boolean }): this {
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu .range(from, to) passen; der Test bleibt unter der Seitengroesse
  range(_from: number, _to: number): this {
    return this;
  }
  protected matches(rows: readonly Row[]): Row[] {
    return rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
  }
}

class MockSelect extends Chain {
  constructor(
    private tableName: string,
    private columns: string,
  ) {
    super();
  }

  then<T>(onFulfilled: (v: { data: Row[] | null; error: MockError | null }) => T): Promise<T> {
    const error = db.errors[this.tableName];
    if (error) return Promise.resolve(onFulfilled({ data: null, error }));
    if (this.columns.trim() === "*") {
      return Promise.resolve(
        onFulfilled({ data: null, error: { code: "42501", message: "permission denied" } }),
      );
    }
    return Promise.resolve(
      onFulfilled({ data: this.matches(table(this.tableName)).map((r) => ({ ...r })), error: null }),
    );
  }

  /** Einzelzeile für das Nachladen des Belegs vor dem Storno-Entwurf (N3). */
  maybeSingle<T = Row>(): Promise<{ data: T | null; error: MockError | null }> {
    const error = db.errors[this.tableName];
    if (error) return Promise.resolve({ data: null, error });
    if (this.columns.trim() === "*") {
      return Promise.resolve({
        data: null,
        error: { code: "42501", message: "permission denied" },
      });
    }
    const hit = this.matches(table(this.tableName))[0];
    return Promise.resolve({ data: (hit === undefined ? null : { ...hit }) as T | null, error: null });
  }
}

/**
 * INSERT für den Storno-Entwurf (Abnahme, Befund N3). Bewusst schmal — die
 * CHECK-Bedingungen der Tabelle prüft `payout.test.ts`; hier geht es allein
 * darum, DASS der Quarantäneweg den Entwurf anlegt.
 */
class MockInsert {
  constructor(
    private tableName: string,
    private values: Row,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().insert().select(cols) passen
  select(_columns: string): MockInsert {
    return this;
  }
  maybeSingle<T = Row>(): Promise<{ data: T | null; error: MockError | null }> {
    const error = db.errors[`${this.tableName}:insert`] ?? db.errors[this.tableName];
    if (error) return Promise.resolve({ data: null, error });
    insertCounter += 1;
    const row: Row = { id: `ins_${insertCounter}`, ...this.values };
    table(this.tableName).push(row);
    return Promise.resolve({ data: { ...row } as T, error: null });
  }
}

let insertCounter = 0;

class MockUpdate extends Chain {
  constructor(
    private tableName: string,
    private patch: Row,
  ) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().update().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
  select(_columns: string): { then: MockUpdate["then"] } {
    return { then: (onFulfilled) => this.then(onFulfilled) };
  }
  then<T>(onFulfilled: (v: { data: Row[] | null; error: MockError | null }) => T): Promise<T> {
    const error = db.errors[this.tableName];
    if (error) return Promise.resolve(onFulfilled({ data: null, error }));
    const matched = this.matches(table(this.tableName));
    for (const row of matched) Object.assign(row, this.patch);
    return Promise.resolve(onFulfilled({ data: matched.map((r) => ({ ...r })), error: null }));
  }
}

const mockAdmin = {
  from(tableName: string) {
    return {
      select: (columns: string) => new MockSelect(tableName, columns),
      update: (patch: Row) => new MockUpdate(tableName, patch),
      insert: (values: Row) => new MockInsert(tableName, values),
    };
  },
};

type Admin = Parameters<typeof verifyAffiliateIntegrity>[0];
const admin = mockAdmin as unknown as Admin;

const TENANT = "tenant-1";
const NOW = new Date("2026-10-01T06:00:00.000Z");

let idCounter = 0;
function commission(patch: Row = {}): Row {
  idCounter += 1;
  return {
    id: `com_${idCounter}`,
    tenant_id: TENANT,
    partner_id: "p1",
    currency: "eur",
    kind: "sale",
    status: "approved",
    amount_cents: 10_000,
    payout_id: null,
    reverses_id: null,
    is_test: false,
    order_id: null,
    booked_at: "2026-09-15",
    ...patch,
  };
}

function payout(patch: Row = {}): Row {
  return {
    id: "pay_1",
    tenant_id: TENANT,
    program_id: "prog-1",
    partner_id: "p1",
    period_from: "2026-09-01",
    period_to: "2026-09-30",
    currency: "eur",
    status: "approved",
    gross_cents: 10_000,
    reversal_cents: 0,
    subtotal_cents: 10_000,
    tax_mode: "regular",
    tax_rate_bp: 1900,
    tax_cents: 1_900,
    total_cents: 11_900,
    method: "sepa",
    // Ein freigegebener Satz TRÄGT eine Belegnummer (CHECK der Tabelle).
    // Genau daran hängt die Storno-Pflicht beim Stilllegen (N3).
    document_no: "GS-DEMO-2026-000001",
    reverses_payout_id: null,
    recipient_snapshot: null,
    ...patch,
  };
}

beforeEach(() => {
  db.tables = {};
  db.errors = {};
  idCounter = 0;
  insertCounter = 0;
  table("affiliate_commissions");
  table("affiliate_payouts");
  table("affiliate_daily_stats");
  table("orders");
});

function verify(options?: { quarantine?: boolean }) {
  return verifyAffiliateIntegrity(admin, TENANT, { now: NOW, ...options });
}

// --- Gleichung 1 --------------------------------------------------------

describe("Gleichung 1: Belegkopf gegen seine Positionen", () => {
  /**
   * Die Befunde der anderen beiden Gleichungen werden hier ausgeblendet: die
   * Fixtures buchen Provisionen ohne Tagesaggregat, was Gleichung 2 zu Recht
   * meldet. Jeder Test prüft genau seine eigene Gleichung.
   */
  const payoutFindings = (report: Awaited<ReturnType<typeof verify>>) =>
    report.findings.filter((finding) => finding.check === "payout_subtotal");

  it("meldet nichts, wenn die Positionen den Belegkopf ergeben", async () => {
    table("affiliate_payouts").push(payout({ subtotal_cents: 12_000 }));
    table("affiliate_commissions").push(
      commission({ payout_id: "pay_1", amount_cents: 14_000 }),
      commission({ payout_id: "pay_1", amount_cents: -2_000, kind: "reversal" }),
    );

    const report = await verify();

    expect(report.ok).toBe(true);
    expect(payoutFindings(report)).toHaveLength(0);
    expect(report.counts.payouts).toBe(1);
  });

  it("findet eine nachträglich entstempelte Zeile — genau das, was kein CHECK sieht", async () => {
    table("affiliate_payouts").push(payout({ subtotal_cents: 12_000 }));
    // Von 12 000 sind nur noch 9 000 zugeordnet.
    table("affiliate_commissions").push(commission({ payout_id: "pay_1", amount_cents: 9_000 }));

    const report = await verify();

    expect(payoutFindings(report)).toHaveLength(1);
    expect(payoutFindings(report)[0]).toMatchObject({
      check: "payout_subtotal",
      severity: "critical",
      entity: "payout",
      entity_id: "pay_1",
      expected_cents: 12_000,
      actual_cents: 9_000,
      difference_cents: -3_000,
      messageKey: "affiliate.integrity.payoutSubtotalMismatch",
    });
    expect(hasCriticalIntegrityFinding(report)).toBe(true);
  });

  it("zählt bezahlte Zeilen mit — sonst schlüge der Abgleich beim Bankabgleich an", async () => {
    table("affiliate_payouts").push(payout({ status: "paid", subtotal_cents: 10_000 }));
    table("affiliate_commissions").push(
      commission({ payout_id: "pay_1", amount_cents: 10_000, status: "paid" }),
    );

    expect(payoutFindings(await verify())).toHaveLength(0);
  });

  it("legt einen abweichenden Satz nur mit quarantine: true still", async () => {
    table("affiliate_payouts").push(payout({ subtotal_cents: 12_000 }));
    table("affiliate_commissions").push(commission({ payout_id: "pay_1", amount_cents: 9_000 }));

    const readOnly = await verify();
    expect(payoutFindings(readOnly)[0].quarantined).toBeUndefined();
    expect(table("affiliate_payouts")[0].status).toBe("approved");

    const enforcing = await verify({ quarantine: true });
    expect(payoutFindings(enforcing)[0].quarantined).toBe(true);
    expect(table("affiliate_payouts")[0].status).toBe("failed");
  });

  it("lässt die Stempel bei der Stilllegung stehen — sie sind der Beweis", async () => {
    table("affiliate_payouts").push(payout({ subtotal_cents: 12_000 }));
    table("affiliate_commissions").push(commission({ payout_id: "pay_1", amount_cents: 9_000 }));

    await verify({ quarantine: true });

    expect(table("affiliate_commissions")[0].payout_id).toBe("pay_1");
  });

  // --- Die Stornogutschrift am Quarantäneweg (Abnahme, Befund N3) --------
  //
  // Der Quarantäneweg setzt einen bereits NUMMERIERTEN Beleg auf 'failed'.
  // 'failed' hat im Guard keine ausgehende Kante, und `markAffiliatePayoutFailed()`
  // verlangt approved/exported — ohne Storno-Entwurf an genau dieser Stelle
  // bleibt ein Beleg mit ausgewiesener Steuer dauerhaft unneutralisierbar
  // (§ 14c UStG).

  it("legt beim Stilllegen eines nummerierten Belegs den Storno-Entwurf an", async () => {
    table("affiliate_payouts").push(payout({ subtotal_cents: 12_000 }));
    table("affiliate_commissions").push(commission({ payout_id: "pay_1", amount_cents: 9_000 }));

    const report = await verify({ quarantine: true });
    const finding = payoutFindings(report)[0];

    expect(finding.quarantined).toBe(true);
    expect(finding.reversal_pending).toBe(false);
    expect(finding.reversal_payout_id).not.toBeNull();

    const reversal = table("affiliate_payouts").find(
      (row) => row.reverses_payout_id === "pay_1",
    );
    expect(reversal).toBeDefined();
    // Gespiegelte Summen, gleicher Zeitraum, gleicher Steuermodus, Entwurf
    // ohne eigene Nummer — die Nummer zieht er erst bei seiner Freigabe.
    expect(reversal).toMatchObject({
      tenant_id: TENANT,
      partner_id: "p1",
      program_id: "prog-1",
      currency: "eur",
      status: "draft",
      gross_cents: -10_000,
      subtotal_cents: -12_000,
      tax_cents: -1_900,
      total_cents: -11_900,
      method: "sepa",
    });
    expect(reversal?.document_no).toBeUndefined();
  });

  it("meldet einen NICHT angelegten Storno als eigenen Zustand", async () => {
    table("affiliate_payouts").push(payout({ subtotal_cents: 12_000 }));
    table("affiliate_commissions").push(commission({ payout_id: "pay_1", amount_cents: 9_000 }));
    // Nur der INSERT scheitert; Lesen und Stilllegen laufen weiter.
    db.errors["affiliate_payouts:insert"] = { code: "23505", message: "duplicate key" };

    const report = await verify({ quarantine: true });
    const finding = payoutFindings(report)[0];

    expect(finding.quarantined).toBe(true);
    expect(finding.reversal_pending).toBe(true);
    expect(finding.reversal_payout_id).toBeNull();
    // Die Zahl, die die Freigabeaktion ausspricht statt sie zu protokollieren.
    expect(countPendingReversals(report)).toBe(1);
  });

  it("legt für einen VERWORFENEN Entwurf keinen Storno an — er hat nie eine Nummer", async () => {
    // Gegenrichtung: 'draft' -> 'cancelled' neutralisiert keinen Beleg. Ein
    // Storno darauf wäre ein Minus-Beleg über eine Leistung, die nie
    // abgerechnet wurde.
    table("affiliate_payouts").push(
      payout({ status: "draft", document_no: null, subtotal_cents: 12_000 }),
    );
    table("affiliate_commissions").push(commission({ payout_id: "pay_1", amount_cents: 9_000 }));

    const finding = payoutFindings(await verify({ quarantine: true }))[0];

    expect(finding.quarantined).toBe(true);
    expect(table("affiliate_payouts")[0].status).toBe("cancelled");
    // Gar nicht gesetzt statt `false`: für einen verworfenen Entwurf stellt
    // sich die Frage nach einem Storno nicht — dieselbe Form wie bei
    // `quarantined`, das nur auftaucht, wo stillgelegt wurde.
    expect(finding.reversal_pending).toBeUndefined();
    expect(table("affiliate_payouts").some((row) => row.reverses_payout_id === "pay_1")).toBe(
      false,
    );
  });

  it("fasst einen bereits bezahlten Satz nicht mehr an", async () => {
    table("affiliate_payouts").push(payout({ status: "paid", subtotal_cents: 12_000 }));
    table("affiliate_commissions").push(
      commission({ payout_id: "pay_1", amount_cents: 9_000, status: "paid" }),
    );

    const report = await verify({ quarantine: true });

    expect(payoutFindings(report)[0].quarantined).toBeUndefined();
    expect(table("affiliate_payouts")[0].status).toBe("paid");
  });

  it("vergleicht einen stornierten oder fehlgeschlagenen Satz gar nicht", async () => {
    table("affiliate_payouts").push(
      payout({ id: "pay_x", status: "failed", subtotal_cents: 12_000 }),
      payout({ id: "pay_y", status: "cancelled", subtotal_cents: 5_000 }),
    );

    expect(payoutFindings(await verify())).toHaveLength(0);
  });
});

// --- Gleichung 2 --------------------------------------------------------

describe("Gleichung 2: Tagesaggregat gegen das Buch", () => {
  it("meldet nichts, wenn das Aggregat die positiven Buchungen des Tages trifft", async () => {
    table("affiliate_commissions").push(
      commission({ amount_cents: 6_000, booked_at: "2026-09-15" }),
      commission({ amount_cents: 4_000, booked_at: "2026-09-15", campaign: "newsletter" }),
    );
    // Zwei Kampagnenzeilen desselben Tages summieren sich auf denselben Wert.
    table("affiliate_daily_stats").push(
      { tenant_id: TENANT, partner_id: "p1", day: "2026-09-15", campaign: "", commission_cents: 6_000 },
      {
        tenant_id: TENANT,
        partner_id: "p1",
        day: "2026-09-15",
        campaign: "newsletter",
        commission_cents: 4_000,
      },
    );

    const report = await verify();

    expect(report.findings).toHaveLength(0);
    expect(report.counts.daily_stats).toBe(2);
  });

  it("meldet eine Abweichung als Warnung, nicht als kritischen Befund", async () => {
    table("affiliate_commissions").push(commission({ amount_cents: 10_000, booked_at: "2026-09-15" }));
    table("affiliate_daily_stats").push({
      tenant_id: TENANT,
      partner_id: "p1",
      day: "2026-09-15",
      campaign: "",
      commission_cents: 7_000,
    });

    const report = await verify();

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      check: "daily_stats",
      severity: "warning",
      entity_id: "p1/2026-09-15",
      expected_cents: 10_000,
      actual_cents: 7_000,
      difference_cents: -3_000,
      messageKey: "affiliate.integrity.dailyStatsMismatch",
    });
    // Eine falsche Anzeige hält keine Auszahlung auf.
    expect(hasCriticalIntegrityFinding(report)).toBe(false);
  });

  it("zählt Testbestellungen, stornierte Zeilen und Gegenbuchungen nicht mit", async () => {
    table("affiliate_commissions").push(
      commission({ amount_cents: 10_000, booked_at: "2026-09-15" }),
      commission({ amount_cents: 5_000, booked_at: "2026-09-15", is_test: true }),
      commission({ amount_cents: 5_000, booked_at: "2026-09-15", status: "cancelled" }),
      commission({ amount_cents: -3_000, booked_at: "2026-09-15", kind: "reversal" }),
    );
    table("affiliate_daily_stats").push({
      tenant_id: TENANT,
      partner_id: "p1",
      day: "2026-09-15",
      campaign: "",
      commission_cents: 10_000,
    });

    expect((await verify()).findings).toHaveLength(0);
  });

  it("meldet auch einen Tag, an dem gebucht wurde, aber gar kein Aggregat steht", async () => {
    table("affiliate_commissions").push(commission({ amount_cents: 10_000, booked_at: "2026-09-16" }));

    const report = await verify();

    expect(report.findings[0]).toMatchObject({
      check: "daily_stats",
      entity_id: "p1/2026-09-16",
      expected_cents: 10_000,
      actual_cents: 0,
    });
  });
});

// --- Gleichung 3 --------------------------------------------------------

describe("Gleichung 3: Überstornierung", () => {
  it("meldet nichts bei einer regulären Teilerstattung", async () => {
    table("orders").push({ id: "order-1", tenant_id: TENANT, refunded_cents: 5_000 });
    const sale = commission({ amount_cents: 10_000, order_id: "order-1" });
    table("affiliate_commissions").push(
      sale,
      commission({ kind: "reversal", amount_cents: -4_000, reverses_id: sale.id }),
    );

    const report = await verify();

    expect(report.findings.filter((finding) => finding.check === "over_reversal")).toHaveLength(0);
    expect(report.counts.orders).toBe(1);
  });

  it("meldet nichts bei einer Vollstornierung auf den Cent genau", async () => {
    table("orders").push({ id: "order-1", tenant_id: TENANT, refunded_cents: 10_000 });
    const sale = commission({ amount_cents: 10_000, order_id: "order-1" });
    table("affiliate_commissions").push(
      sale,
      commission({ kind: "reversal", amount_cents: -10_000, reverses_id: sale.id }),
    );

    expect(
      (await verify()).findings.filter((finding) => finding.check === "over_reversal"),
    ).toHaveLength(0);
  });

  it("findet eine Gegenbuchung über den Ursprungsbetrag hinaus", async () => {
    table("orders").push({ id: "order-1", tenant_id: TENANT, refunded_cents: 10_000 });
    const sale = commission({ amount_cents: 10_000, order_id: "order-1" });
    table("affiliate_commissions").push(
      sale,
      commission({ kind: "reversal", amount_cents: -8_000, reverses_id: sale.id }),
      commission({ kind: "reversal", amount_cents: -4_000, reverses_id: sale.id }),
    );

    const report = await verify();
    const finding = report.findings.find((entry) => entry.check === "over_reversal");

    expect(finding).toMatchObject({
      severity: "critical",
      entity: "order",
      entity_id: "order-1",
      expected_cents: 10_000,
      actual_cents: 12_000,
      difference_cents: 2_000,
      messageKey: "affiliate.integrity.overReversal",
    });
  });

  it("rechnet NETTO: eine Wiedergutschrift senkt den gegengebuchten Stand wieder", async () => {
    table("orders").push({ id: "order-1", tenant_id: TENANT, refunded_cents: 10_000 });
    const sale = commission({ amount_cents: 10_000, order_id: "order-1" });
    const reversal = commission({ kind: "reversal", amount_cents: -12_000, reverses_id: sale.id });
    table("affiliate_commissions").push(
      sale,
      reversal,
      // Gewonnener Streitfall: 2 000 kommen zurück, netto sind es wieder 10 000.
      commission({ kind: "recredit", amount_cents: 2_000, reverses_id: reversal.id }),
    );

    expect(
      (await verify()).findings.filter((finding) => finding.check === "over_reversal"),
    ).toHaveLength(0);
  });

  it("sieht nur Bestellungen mit Erstattung an", async () => {
    // Keine Erstattung auf der Bestellung -> die Gleichung gilt nicht für sie.
    const sale = commission({ amount_cents: 10_000, order_id: "order-2" });
    table("affiliate_commissions").push(
      sale,
      commission({ kind: "reversal", amount_cents: -20_000, reverses_id: sale.id }),
    );

    expect(
      (await verify()).findings.filter((finding) => finding.check === "over_reversal"),
    ).toHaveLength(0);
  });
});

// --- Ehrlichkeit --------------------------------------------------------

describe("Unvollständige Datengrundlage", () => {
  it("liefert ok: false und KEINE Befunde, wenn eine Abfrage abbricht", async () => {
    table("affiliate_payouts").push(payout({ subtotal_cents: 12_000 }));
    table("affiliate_commissions").push(commission({ payout_id: "pay_1", amount_cents: 9_000 }));
    db.errors.affiliate_daily_stats = { code: "57014", message: "canceling statement" };

    const report = await verify();

    expect(report.ok).toBe(false);
    // Entscheidend: kein Befund. Aus einem Netzwerkfehler darf kein
    // Buchungsfehler werden, sonst legte der Abgleich saubere Sätze still.
    expect(report.findings).toHaveLength(0);
    expect(table("affiliate_payouts")[0].status).toBe("approved");
  });

  it("legt bei ok: false auch mit quarantine: true nichts still", async () => {
    table("affiliate_payouts").push(payout({ subtotal_cents: 12_000 }));
    db.errors.affiliate_commissions = { code: "57014", message: "canceling statement" };

    const report = await verify({ quarantine: true });

    expect(report.ok).toBe(false);
    expect(table("affiliate_payouts")[0].status).toBe("approved");
  });

  it("meldet einen sauberen, leeren Bestand als geprüft", async () => {
    const report = await verify();

    expect(report).toMatchObject({
      ok: true,
      findings: [],
      counts: { payouts: 0, daily_stats: 0, orders: 0 },
    });
    expect(report.checked_at).toBe(NOW.toISOString());
  });
});
