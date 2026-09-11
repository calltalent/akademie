import { describe, expect, it } from "vitest";
import {
  buildStatement,
  deriveStats,
  groupStats,
  statementCurrencies,
  statementKindKey,
  sumStats,
  type AffiliateStatementRow,
} from "./statement";
import { AFFILIATE_COMMISSION_KINDS } from "./types";

/**
 * Affiliate-System, Block B7-A — Tests des Kontoauszugs
 * (`src/lib/affiliate/statement.ts`, PLAN_Affiliate-System.md 8.2, 5.10,
 * 5.11).
 *
 * Stil wie `compute.test.ts`: reine Funktionen, keine Mocks, jede Erwartung
 * eine ausgerechnete Zahl. Zwei Dinge hält diese Datei besonders fest, weil
 * sie beide Geld bzw. Personendaten betreffen:
 *
 *   1. Der laufende Saldo folgt denselben zwei Ausschlüssen wie
 *      `computeBalances()` — `is_test` und `cancelled`. Laufen die beiden
 *      auseinander, sieht der Partner im Auszug einen anderen Stand als auf
 *      den Saldo-Karten derselben Seite, und jede Erklärung dafür ist falsch.
 *   2. Der Eingabetyp trägt keine Käuferspalte. Der letzte Test hält das
 *      maschinell fest: er sucht in einer JSON-Fassung des gesamten
 *      Auszugs nach E-Mail-Mustern und nach den Spaltennamen, die es hier
 *      nicht geben darf.
 */

const CURRENCY = "eur";

/** Eine Buchungszeile mit sinnvollen Vorgabewerten; jeder Test ändert nur, worum es ihm geht. */
function row(overrides: Partial<AffiliateStatementRow> & { id: string }): AffiliateStatementRow {
  return {
    kind: "sale",
    amount_cents: 10_000,
    currency: CURRENCY,
    status: "pending",
    booked_at: "2026-09-01",
    hold_until: "2026-10-01T00:00:00.000Z",
    product_id: null,
    campaign: null,
    payout_id: null,
    reverses_id: null,
    base_cents: 50_000,
    basis_kind: "net",
    rate_kind: "percent",
    rate_bp: 2000,
    fixed_cents: 0,
    is_test: false,
    ...overrides,
  };
}

describe("buildStatement", () => {
  it("rechnet den Saldo chronologisch, auch wenn die Eingabe unsortiert ist", () => {
    const statement = buildStatement(
      [
        row({ id: "c", booked_at: "2026-09-03", amount_cents: 2_500 }),
        row({ id: "a", booked_at: "2026-09-01", amount_cents: 10_000 }),
        row({ id: "b", booked_at: "2026-09-02", amount_cents: -4_000, kind: "reversal" }),
      ],
      { currency: CURRENCY, order: "asc" },
    );

    expect(statement.entries.map((entry) => entry.row.id)).toEqual(["a", "b", "c"]);
    expect(statement.entries.map((entry) => entry.balance_cents)).toEqual([10_000, 6_000, 8_500]);
    expect(statement.closing_balance_cents).toBe(8_500);
    expect(statement.counted_rows).toBe(3);
  });

  it("gibt standardmäßig die neueste Zeile zuerst aus, behält aber den chronologischen Saldo", () => {
    const statement = buildStatement(
      [
        row({ id: "a", booked_at: "2026-09-01", amount_cents: 10_000 }),
        row({ id: "b", booked_at: "2026-09-02", amount_cents: 5_000 }),
      ],
      { currency: CURRENCY },
    );

    expect(statement.entries.map((entry) => entry.row.id)).toEqual(["b", "a"]);
    // Die oberste Zeile trägt den aktuellen Stand, die darunter den Stand davor.
    expect(statement.entries.map((entry) => entry.balance_cents)).toEqual([15_000, 10_000]);
  });

  it("sortiert Buchungen desselben Tages stabil nach id", () => {
    const statement = buildStatement(
      [
        row({ id: "0000-b", booked_at: "2026-09-01", amount_cents: 1 }),
        row({ id: "0000-a", booked_at: "2026-09-01", amount_cents: 2 }),
      ],
      { currency: CURRENCY, order: "asc" },
    );
    expect(statement.entries.map((entry) => entry.row.id)).toEqual(["0000-a", "0000-b"]);
  });

  it("zeigt stornierte Zeilen an, zählt sie aber nicht in den Saldo (G6/6.1)", () => {
    const statement = buildStatement(
      [
        row({ id: "a", booked_at: "2026-09-01", amount_cents: 10_000 }),
        row({ id: "b", booked_at: "2026-09-02", amount_cents: 7_000, status: "cancelled" }),
      ],
      { currency: CURRENCY, order: "asc" },
    );

    expect(statement.entries).toHaveLength(2);
    expect(statement.entries[1].counts).toBe(false);
    expect(statement.entries[1].balance_cents).toBe(10_000);
    expect(statement.closing_balance_cents).toBe(10_000);
    expect(statement.counted_rows).toBe(1);
  });

  it("lässt Testbuchungen vollständig weg (4.5)", () => {
    const statement = buildStatement(
      [
        row({ id: "a", amount_cents: 10_000 }),
        row({ id: "t", amount_cents: 99_999, is_test: true }),
      ],
      { currency: CURRENCY },
    );

    expect(statement.entries.map((entry) => entry.row.id)).toEqual(["a"]);
    expect(statement.closing_balance_cents).toBe(10_000);
  });

  it("trennt Währungen strikt — es gibt keinen währungsübergreifenden Saldo (5.11)", () => {
    const rows = [
      row({ id: "a", amount_cents: 10_000, currency: "eur" }),
      row({ id: "b", amount_cents: 30_000, currency: "chf" }),
    ];

    expect(buildStatement(rows, { currency: "eur" }).closing_balance_cents).toBe(10_000);
    expect(buildStatement(rows, { currency: "chf" }).closing_balance_cents).toBe(30_000);
    expect(statementCurrencies(rows)).toEqual(["chf", "eur"]);
  });

  it("zählt eine Testwährung nicht als eigene Währung", () => {
    expect(
      statementCurrencies([
        row({ id: "a", currency: "eur" }),
        row({ id: "t", currency: "usd", is_test: true }),
      ]),
    ).toEqual(["eur"]);
  });

  it("begrenzt nur die Ausgabe, nie die Rechnung", () => {
    const statement = buildStatement(
      [
        row({ id: "a", booked_at: "2026-09-01", amount_cents: 1_000 }),
        row({ id: "b", booked_at: "2026-09-02", amount_cents: 2_000 }),
        row({ id: "c", booked_at: "2026-09-03", amount_cents: 4_000 }),
      ],
      { currency: CURRENCY, limit: 1 },
    );

    expect(statement.entries).toHaveLength(1);
    expect(statement.entries[0].row.id).toBe("c");
    // Der Saldo der jüngsten Zeile ist der Stand des GESAMTEN Kontos.
    expect(statement.entries[0].balance_cents).toBe(7_000);
    expect(statement.closing_balance_cents).toBe(7_000);
  });

  it("liefert für ein leeres Konto einen Saldo von 0 und keine Zeilen", () => {
    const statement = buildStatement([], { currency: CURRENCY });
    expect(statement.entries).toEqual([]);
    expect(statement.closing_balance_cents).toBe(0);
    expect(statement.counted_rows).toBe(0);
  });

  it("verschiebt den Saldo nicht durch einen nicht ganzzahligen Betrag (G12)", () => {
    const statement = buildStatement(
      [row({ id: "a", amount_cents: 10_000.9 as number })],
      { currency: CURRENCY },
    );
    expect(statement.closing_balance_cents).toBe(10_000);
  });

  it("netzt Verkauf, Reserve, Storno und Wiedergutschrift zum erwarteten Stand", () => {
    // Plan 5.4/5.8: aus einer Bestellung entstehen zwei Zeilen (sale +
    // reserve), eine Erstattung erzeugt eine dritte (negativ), eine
    // gewonnene Rückbuchung eine vierte (positiv).
    const statement = buildStatement(
      [
        row({ id: "1", kind: "sale", booked_at: "2026-09-01", amount_cents: 9_000 }),
        row({ id: "2", kind: "reserve", booked_at: "2026-09-01", amount_cents: 1_000 }),
        row({
          id: "3",
          kind: "reversal",
          booked_at: "2026-09-10",
          amount_cents: -4_500,
          reverses_id: "1",
        }),
        row({
          id: "4",
          kind: "recredit",
          booked_at: "2026-09-20",
          amount_cents: 4_500,
          reverses_id: "3",
        }),
      ],
      { currency: CURRENCY, order: "asc" },
    );

    expect(statement.entries.map((entry) => entry.balance_cents)).toEqual([
      9_000, 10_000, 5_500, 10_000,
    ]);
  });
});

describe("statementKindKey", () => {
  it("führt beide Reserve-Arten auf denselben Text", () => {
    expect(statementKindKey("reserve")).toBe("kindReserve");
    expect(statementKindKey("recurring_reserve")).toBe("kindReserve");
  });

  it("hat für jede Buchungsart einen Schlüssel", () => {
    for (const kind of AFFILIATE_COMMISSION_KINDS) {
      expect(statementKindKey(kind)).toMatch(/^kind[A-Z]/);
    }
  });
});

describe("deriveStats", () => {
  const empty = {
    clicks: 0,
    unique_clicks: 0,
    leads: 0,
    orders_count: 0,
    revenue_cents: 0,
    commission_cents: 0,
    reversal_cents: 0,
  };

  it("rechnet Conversion, EPC und Stornoquote", () => {
    const derived = deriveStats({
      ...empty,
      clicks: 400,
      orders_count: 8,
      commission_cents: 20_000,
      reversal_cents: 2_000,
    });

    // 8/400 = 2 % = 200 bp
    expect(derived.conversion_bp).toBe(200);
    // (20000 - 2000) / 400 = 45 Cent
    expect(derived.epc_cents).toBe(45);
    // 2000/20000 = 10 % = 1000 bp
    expect(derived.reversal_rate_bp).toBe(1000);
  });

  it("liefert null statt einer erfundenen Null, wenn der Nenner 0 ist", () => {
    const derived = deriveStats(empty);
    expect(derived.conversion_bp).toBeNull();
    expect(derived.epc_cents).toBeNull();
    expect(derived.reversal_rate_bp).toBeNull();
  });

  it("lässt den EPC negativ werden, wenn mehr storniert als gebucht wurde", () => {
    const derived = deriveStats({
      ...empty,
      clicks: 100,
      commission_cents: 1_000,
      reversal_cents: 3_000,
    });
    expect(derived.epc_cents).toBe(-20);
    // Über 100 % Storno ist keine Fehlmessung, sondern der Fall „Erstattung
    // im Folgemonat" — die Quote sagt das, statt bei 10000 bp zu deckeln.
    expect(derived.reversal_rate_bp).toBe(30_000);
  });
});

describe("groupStats", () => {
  const base = {
    clicks: 0,
    unique_clicks: 0,
    leads: 0,
    orders_count: 0,
    revenue_cents: 0,
    commission_cents: 0,
    reversal_cents: 0,
  };

  it("verdichtet mehrere Zeilen desselben Tages und sortiert aufsteigend", () => {
    const grouped = groupStats(
      [
        { ...base, day: "2026-09-02", clicks: 5 },
        { ...base, day: "2026-09-01", clicks: 3 },
        { ...base, day: "2026-09-01", clicks: 4 },
      ],
      (r) => r.day,
    );

    expect(grouped.map((g) => g.key)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(grouped[0].stats.clicks).toBe(7);
    expect(grouped[1].stats.clicks).toBe(5);
  });

  it("summiert alle Felder", () => {
    const total = sumStats([
      { ...base, clicks: 1, unique_clicks: 1, leads: 1, orders_count: 1, revenue_cents: 100, commission_cents: 10, reversal_cents: 1 },
      { ...base, clicks: 2, unique_clicks: 2, leads: 2, orders_count: 2, revenue_cents: 200, commission_cents: 20, reversal_cents: 2 },
    ]);

    expect(total).toEqual({
      clicks: 3,
      unique_clicks: 3,
      leads: 3,
      orders_count: 3,
      revenue_cents: 300,
      commission_cents: 30,
      reversal_cents: 3,
    });
  });
});

describe("Datenschutzgrenze", () => {
  /**
   * Abnahmekriterium aus Block B7: „der Kontoauszug enthält keine
   * Käuferdaten (automatisch geprüft, indem der Test die Antwort auf
   * E-Mail-Muster durchsucht)". Hier auf der Ebene der reinen Funktion —
   * der E2E-Test prüft dasselbe später an der gerenderten Seite.
   */
  it("reicht keine Käufer- oder Bestellspalte durch", () => {
    const statement = buildStatement(
      [row({ id: "a", campaign: "newsletter-kw36", product_id: "11111111-1111-4111-8111-111111111111" })],
      { currency: CURRENCY },
    );

    const serialized = JSON.stringify(statement);
    expect(serialized).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    for (const forbidden of [
      "order_id",
      "stripe_invoice_id",
      "stripe_charge_id",
      "stripe_subscription_id",
      "customer",
      "invoice_number",
      "note",
      "flag_reason",
      "cancel_reason",
      "condition_snapshot",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
