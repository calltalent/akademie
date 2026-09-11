import { describe, expect, it } from "vitest";
import {
  buildDedupKey,
  computeBalances,
  computeBaseCents,
  computeCommissionParts,
  computeReversalDelta,
  computeTier2Cents,
  resolveCondition,
  type AffiliateConditionCandidate,
} from "./compute";
import type { AffiliateBalanceInput } from "./types";

/**
 * Affiliate-System, Block B1 — Tests des Rechenkerns
 * (`src/lib/affiliate/compute.ts`, PLAN_Affiliate-System.md 5.1 bis 5.11).
 *
 * Stil wie `src/lib/progress/compute.test.ts`: reine Funktionen, keine Mocks,
 * jede Erwartung eine ausgerechnete Zahl. Die vier durchgerechneten Beispiele
 * aus Plan 5.9 stehen unten mit genau den Beträgen des Plans — sie sind der
 * Grund, warum diese Datei existiert: eine Änderung am Rechenweg, die eine
 * dieser Zahlen verschiebt, verschiebt Geld.
 *
 * Nachgerechnet wurden alle Zwischenschritte des Plans. Drei Dezimalangaben
 * IM PLANTEXT sind falsch abgeschrieben, ohne dass ein Ergebnis betroffen ist
 * (die `floor`-Werte stimmen alle):
 *   5.9 A: „44910 * 19/119 = 7171,26"  -> tatsächlich 7170,504; die
 *          Steuer 7171 stimmt trotzdem, weil Stripe kaufmännisch rundet
 *          (7170,504 -> 7171) und der Wert ohnehin von Stripe kommt.
 *   5.9 C: „floor(2647,29)" -> 2647,072; „floor(5294,59)" -> 5294,144;
 *          „floor(1176,15)" -> 1176,130. Alle drei `floor`-Ergebnisse
 *          unverändert.
 * Ebenfalls falsch, aber reine Prosa: die Aussage in 5.9 C, die fehlerhafte
 * Deckel-Logik ergäbe „60 % Storno bei 44,5 % Erstattung". Sie ergäbe
 * 2647 + 5294 = 7941 von 11888, also 66,8 %. Der Test unten rechnet beide
 * Wege aus und hält 7941 fest.
 */

// --- Feste Kennungen. Kanonisch klein geschriebene UUIDs, weil
// `resolveCondition()` als letztes Kriterium lexikografisch nach `id`
// sortiert (so sortiert Postgres `uuid` nach Byte-Ordnung).
const PARTNER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const PARTNER_B = "bbbbbbbb-0000-4000-8000-000000000002";
const GROUP_1 = "99999999-0000-4000-8000-000000000009";
const PRODUCT_1 = "cccccccc-0000-4000-8000-000000000003";
const PRODUCT_2 = "dddddddd-0000-4000-8000-000000000004";

/** Programm aus Plan 5.9, gemeinsam für alle vier Beispiele. */
const PROGRAM_5_9 = {
  basis_kind: "net" as const,
  fee_deduction_bp: 0,
  reserve_bp: 1000,
  tier2_basis: "commission" as const,
  tier2_rate_bp: 2000,
};

function condition(
  overrides: Partial<AffiliateConditionCandidate> & Pick<AffiliateConditionCandidate, "id">,
): AffiliateConditionCandidate {
  return {
    partner_id: null,
    group_id: null,
    product_id: null,
    rate_kind: "percent",
    rate_bp: 1000,
    fixed_cents: 0,
    valid_from: "2020-01-01T00:00:00.000Z",
    valid_to: null,
    ...overrides,
  };
}

function balanceRow(
  overrides: Partial<AffiliateBalanceInput> & Pick<AffiliateBalanceInput, "id">,
): AffiliateBalanceInput {
  return {
    partner_id: PARTNER_A,
    currency: "eur",
    kind: "sale",
    status: "pending",
    amount_cents: 0,
    payout_id: null,
    reverses_id: null,
    is_test: false,
    ...overrides,
  };
}

// =======================================================================
// 5.1 — Bemessungsgrundlage
// =======================================================================

describe("computeBaseCents (5.1)", () => {
  it("Beispiel A: 449,10 EUR brutto abzüglich 71,71 EUR Steuer ergibt 377,39 EUR Basis", () => {
    const result = computeBaseCents({
      gross_cents: 44910,
      tax_cents: 7171,
      shipping_cents: 0,
      ...PROGRAM_5_9,
    });
    expect(result.base_cents).toBe(37739);
    expect(result.fee_deduction_cents).toBe(0);
  });

  it("basis_kind='gross' lässt Steuer und Versand stehen", () => {
    const result = computeBaseCents({
      gross_cents: 44910,
      tax_cents: 7171,
      shipping_cents: 500,
      basis_kind: "gross",
      fee_deduction_bp: 0,
    });
    expect(result.base_cents).toBe(44910);
  });

  it("zieht Versandkosten von der Nettobasis ab", () => {
    const result = computeBaseCents({
      gross_cents: 44910,
      tax_cents: 7171,
      shipping_cents: 500,
      basis_kind: "net",
      fee_deduction_bp: 0,
    });
    expect(result.base_cents).toBe(37239);
  });

  it("fee_deduction_bp wird nach der Nettobildung abgezogen und abgerundet", () => {
    // 37739 - floor(37739 * 250 / 10000) = 37739 - floor(943,475) = 37739 - 943
    const result = computeBaseCents({
      gross_cents: 44910,
      tax_cents: 7171,
      shipping_cents: 0,
      basis_kind: "net",
      fee_deduction_bp: 250,
    });
    expect(result.fee_deduction_cents).toBe(943);
    expect(result.base_cents).toBe(36796);
  });

  it("Beispiel B Rate 2: voll bezahlte Rechnung, Steuer bleibt ungekürzt", () => {
    const result = computeBaseCents({
      gross_cents: 4900,
      tax_cents: 782,
      shipping_cents: 0,
      invoice_total_cents: 4900,
      ...PROGRAM_5_9,
    });
    expect(result.tax_cents).toBe(782);
    expect(result.base_cents).toBe(4118);
  });

  it("Beispiel B Rate 3: angerechnetes Kundenguthaben kürzt die Steuer anteilig (G13)", () => {
    // floor(782 * 3900 / 4900) = floor(622,408...) = 622; 3900 - 622 = 3278
    const result = computeBaseCents({
      gross_cents: 3900,
      tax_cents: 782,
      shipping_cents: 0,
      invoice_total_cents: 4900,
      ...PROGRAM_5_9,
    });
    expect(result.tax_cents).toBe(622);
    expect(result.base_cents).toBe(3278);
  });

  it("Basis kleiner oder gleich null: Steuer plus Versand übersteigen den Zahlbetrag", () => {
    const result = computeBaseCents({
      gross_cents: 1000,
      tax_cents: 200,
      shipping_cents: 900,
      basis_kind: "net",
      fee_deduction_bp: 0,
    });
    // Nicht -100: eine negative Basis erzeugte eine negative sale-Zeile ohne
    // Gegenbuchung. Der Fall bleibt an `base_cents === 0` erkennbar und führt
    // zu `cancel_reason='zero_amount'` (5.1).
    expect(result.base_cents).toBe(0);
  });

  it("Basis genau null: Trial-Start bzw. 100-%-Gutschein", () => {
    const result = computeBaseCents({
      gross_cents: 0,
      tax_cents: 0,
      shipping_cents: 0,
      basis_kind: "net",
      fee_deduction_bp: 1000,
    });
    expect(result.base_cents).toBe(0);
  });
});

// =======================================================================
// 5.2 — Vorrangkette und Zeitfenster
// =======================================================================

describe("resolveCondition (5.2)", () => {
  const at = new Date("2026-09-10T12:00:00.000Z");
  const context = { partner_id: PARTNER_A, group_id: GROUP_1, product_id: PRODUCT_1, at };
  const programDefault = { rate_kind: "percent" as const, rate_bp: 1000, fixed_cents: 0 };

  // Die sechs Stufen aus 5.2: Partner+Produkt 25, Partner 20,
  // Gruppe+Produkt 15, Gruppe 10, Produkt 5, Programmstandard.
  const partnerProduct = condition({
    id: "11111111-0000-4000-8000-000000000001",
    partner_id: PARTNER_A,
    product_id: PRODUCT_1,
    rate_bp: 2500,
  });
  const partnerOnly = condition({
    id: "22222222-0000-4000-8000-000000000002",
    partner_id: PARTNER_A,
    rate_bp: 2000,
  });
  const groupProduct = condition({
    id: "33333333-0000-4000-8000-000000000003",
    group_id: GROUP_1,
    product_id: PRODUCT_1,
    rate_bp: 1500,
  });
  const groupOnly = condition({
    id: "44444444-0000-4000-8000-000000000004",
    group_id: GROUP_1,
    rate_bp: 1200,
  });
  const productOnly = condition({
    id: "55555555-0000-4000-8000-000000000005",
    product_id: PRODUCT_1,
    rate_bp: 800,
  });
  const allSix = [partnerProduct, partnerOnly, groupProduct, groupOnly, productOnly];

  it("Stufe 1 von 6: Partner + Produkt (Spezifität 25) schlägt alles", () => {
    const result = resolveCondition(allSix, context, programDefault);
    expect(result.condition_id).toBe(partnerProduct.id);
    expect(result.specificity).toBe(25);
    expect(result.rate_bp).toBe(2500);
    expect(result.source).toBe("condition");
  });

  it("Stufe 2 von 6: Partner (20)", () => {
    const result = resolveCondition(allSix.slice(1), context, programDefault);
    expect(result.condition_id).toBe(partnerOnly.id);
    expect(result.specificity).toBe(20);
  });

  it("Stufe 3 von 6: Gruppe + Produkt (15)", () => {
    const result = resolveCondition(allSix.slice(2), context, programDefault);
    expect(result.condition_id).toBe(groupProduct.id);
    expect(result.specificity).toBe(15);
  });

  it("Stufe 4 von 6: Gruppe (10)", () => {
    const result = resolveCondition(allSix.slice(3), context, programDefault);
    expect(result.condition_id).toBe(groupOnly.id);
    expect(result.specificity).toBe(10);
  });

  it("Stufe 5 von 6: Produkt (5)", () => {
    const result = resolveCondition(allSix.slice(4), context, programDefault);
    expect(result.condition_id).toBe(productOnly.id);
    expect(result.specificity).toBe(5);
  });

  it("Stufe 6 von 6: kein Treffer bedeutet Programmstandard", () => {
    const result = resolveCondition([], context, programDefault);
    expect(result).toEqual({
      condition_id: null,
      source: "program_default",
      rate_kind: "percent",
      rate_bp: 1000,
      fixed_cents: 0,
      specificity: 0,
    });
  });

  it("Konditionen fremder Partner, Gruppen und Produkte greifen nicht", () => {
    const foreign = [
      condition({ id: "66666666-0000-4000-8000-000000000006", partner_id: PARTNER_B, rate_bp: 9000 }),
      condition({ id: "77777777-0000-4000-8000-000000000007", product_id: PRODUCT_2, rate_bp: 9000 }),
    ];
    expect(resolveCondition(foreign, context, programDefault).source).toBe("program_default");
  });

  it("Partner ohne Gruppe: eine Gruppenkondition greift nicht", () => {
    const result = resolveCondition(
      [groupOnly],
      { ...context, group_id: null },
      programDefault,
    );
    expect(result.source).toBe("program_default");
  });

  it("Zeitfenster: valid_from ist einschließend, genau auf die Millisekunde", () => {
    const befristet = condition({
      id: "88888888-0000-4000-8000-000000000008",
      partner_id: PARTNER_A,
      rate_bp: 3500,
      valid_from: "2026-09-10T12:00:00.000Z",
      valid_to: "2026-09-20T00:00:00.000Z",
    });
    const genauAmAnfang = resolveCondition(
      [befristet],
      { ...context, at: new Date("2026-09-10T12:00:00.000Z") },
      programDefault,
    );
    expect(genauAmAnfang.condition_id).toBe(befristet.id);

    const eineMillisekundeDavor = resolveCondition(
      [befristet],
      { ...context, at: new Date("2026-09-10T11:59:59.999Z") },
      programDefault,
    );
    expect(eineMillisekundeDavor.source).toBe("program_default");
  });

  it("Zeitfenster: valid_to ist ausschließend, genau auf die Millisekunde", () => {
    const befristet = condition({
      id: "88888888-0000-4000-8000-000000000008",
      partner_id: PARTNER_A,
      rate_bp: 3500,
      valid_from: "2026-09-01T00:00:00.000Z",
      valid_to: "2026-09-20T00:00:00.000Z",
    });
    const eineMillisekundeDavor = resolveCondition(
      [befristet],
      { ...context, at: new Date("2026-09-19T23:59:59.999Z") },
      programDefault,
    );
    expect(eineMillisekundeDavor.condition_id).toBe(befristet.id);

    const genauAmEnde = resolveCondition(
      [befristet],
      { ...context, at: new Date("2026-09-20T00:00:00.000Z") },
      programDefault,
    );
    expect(genauAmEnde.source).toBe("program_default");
  });

  it("valid_to = null gilt unbefristet", () => {
    const result = resolveCondition(
      [condition({ id: "88888888-0000-4000-8000-000000000008", partner_id: PARTNER_A, rate_bp: 3500 })],
      { ...context, at: new Date("2099-01-01T00:00:00.000Z") },
      programDefault,
    );
    expect(result.rate_bp).toBe(3500);
  });

  it("gleiche Spezifität: das jüngere valid_from gewinnt (Aktion schlägt Dauerregel)", () => {
    // In der Datenbank verhindert der Ausschluss-Constraint aus 3.5 diese
    // Überschneidung; die Sortierung wird trotzdem geprüft, weil die Abfrage
    // in 5.2 sie enthält und ein Datenbestand aus einem Import sie tragen kann.
    const dauerregel = condition({
      id: "11111111-0000-4000-8000-00000000000a",
      partner_id: PARTNER_A,
      rate_bp: 2000,
      valid_from: "2026-01-01T00:00:00.000Z",
    });
    const aktion = condition({
      id: "99999999-0000-4000-8000-00000000000b",
      partner_id: PARTNER_A,
      rate_bp: 4000,
      valid_from: "2026-09-01T00:00:00.000Z",
      valid_to: "2026-10-01T00:00:00.000Z",
    });
    expect(resolveCondition([dauerregel, aktion], context, programDefault).rate_bp).toBe(4000);
    expect(resolveCondition([aktion, dauerregel], context, programDefault).rate_bp).toBe(4000);
  });

  it("gleiche Spezifität und gleiches valid_from: die kleinere id entscheidet stabil", () => {
    const a = condition({ id: "11111111-0000-4000-8000-00000000000a", partner_id: PARTNER_A, rate_bp: 2000 });
    const b = condition({ id: "99999999-0000-4000-8000-00000000000b", partner_id: PARTNER_A, rate_bp: 4000 });
    expect(resolveCondition([a, b], context, programDefault).condition_id).toBe(a.id);
    expect(resolveCondition([b, a], context, programDefault).condition_id).toBe(a.id);
  });

  it("klammert rate_bp der Kondition an Minimum und Maximum", () => {
    const zuHoch = condition({ id: "11111111-0000-4000-8000-00000000000a", partner_id: PARTNER_A, rate_bp: 12_000 });
    const zuNiedrig = condition({ id: "11111111-0000-4000-8000-00000000000c", partner_id: PARTNER_B, rate_bp: -500 });
    expect(resolveCondition([zuHoch], context, programDefault).rate_bp).toBe(10_000);
    expect(
      resolveCondition([zuNiedrig], { ...context, partner_id: PARTNER_B }, programDefault).rate_bp,
    ).toBe(0);
  });

  it("klammert auch den Programmstandard", () => {
    expect(
      resolveCondition([], context, { rate_kind: "percent", rate_bp: 20_000, fixed_cents: -1 }),
    ).toMatchObject({ rate_bp: 10_000, fixed_cents: 0 });
  });
});

// =======================================================================
// 5.3, 5.4 und 5.6 — Betrag, Aufteilung, Deckel
// =======================================================================

describe("computeCommissionParts (5.3/5.4/5.6)", () => {
  const limits = { min_commission_cents: null, max_commission_cents: null };

  it("Beispiel A: 37739 Basis, 3500 bp, 1000 bp Reserve -> 13208 gesamt, 11888 sale, 1320 reserve", () => {
    const parts = computeCommissionParts({
      base_cents: 37739,
      rate_kind: "percent",
      rate_bp: 3500,
      fixed_cents: 0,
      reserve_bp: 1000,
      ...limits,
    });
    expect(parts).toEqual({
      amount_cents: 13208,
      sale_cents: 11888,
      reserve_cents: 1320,
      zero_base: false,
      flagged: false,
      flag_reason: null,
    });
  });

  it("Beispiel B Rate 1 und 2: 4118 Basis, 2000 bp -> 823 gesamt, 741 sale, 82 reserve", () => {
    const parts = computeCommissionParts({
      base_cents: 4118,
      rate_kind: "percent",
      rate_bp: 2000,
      fixed_cents: 0,
      reserve_bp: 1000,
      ...limits,
    });
    expect(parts.amount_cents).toBe(823);
    expect(parts.sale_cents).toBe(741);
    expect(parts.reserve_cents).toBe(82);
  });

  it("Beispiel B Rate 3: 3278 Basis (Kundenguthaben) -> 655 gesamt, 590 recurring, 65 reserve", () => {
    const parts = computeCommissionParts({
      base_cents: 3278,
      rate_kind: "percent",
      rate_bp: 2000,
      fixed_cents: 0,
      reserve_bp: 1000,
      ...limits,
    });
    expect(parts.amount_cents).toBe(655);
    expect(parts.sale_cents).toBe(590);
    expect(parts.reserve_cents).toBe(65);
  });

  it("Beispiel B: drei Raten ergeben zusammen 2301 Cent, mit invoice.total wären es 2469 (G13)", () => {
    const satz = { rate_kind: "percent" as const, rate_bp: 2000, fixed_cents: 0, reserve_bp: 1000, ...limits };
    const mitG13 = [4118, 4118, 3278].map((base) =>
      computeCommissionParts({ ...satz, base_cents: base }).amount_cents,
    );
    expect(mitG13).toEqual([823, 823, 655]);
    expect(mitG13.reduce((a, b) => a + b, 0)).toBe(2301);

    const ohneG13 = [4118, 4118, 4118].map((base) =>
      computeCommissionParts({ ...satz, base_cents: base }).amount_cents,
    );
    expect(ohneG13.reduce((a, b) => a + b, 0)).toBe(2469);
  });

  it("sale + reserve ergeben immer exakt den Gesamtbetrag, es geht kein Cent verloren", () => {
    for (let base = 1; base <= 400; base += 1) {
      const parts = computeCommissionParts({
        base_cents: base,
        rate_kind: "percent",
        rate_bp: 3333,
        fixed_cents: 0,
        reserve_bp: 1000,
        ...limits,
      });
      expect(parts.sale_cents + parts.reserve_cents).toBe(parts.amount_cents);
    }
  });

  it("reserve_bp = 0 erzeugt keine Reserve", () => {
    const parts = computeCommissionParts({
      base_cents: 37739,
      rate_kind: "percent",
      rate_bp: 3500,
      fixed_cents: 0,
      reserve_bp: 0,
      ...limits,
    });
    expect(parts.reserve_cents).toBe(0);
    expect(parts.sale_cents).toBe(13208);
  });

  it("rate_kind='fixed' zahlt den festen Betrag, gedeckelt an der Basis", () => {
    const normal = computeCommissionParts({
      base_cents: 10_000,
      rate_kind: "fixed",
      rate_bp: 0,
      fixed_cents: 2500,
      reserve_bp: 1000,
      ...limits,
    });
    expect(normal.amount_cents).toBe(2500);
    expect(normal.reserve_cents).toBe(250);

    const kleineBestellung = computeCommissionParts({
      base_cents: 300,
      rate_kind: "fixed",
      rate_bp: 0,
      fixed_cents: 2500,
      reserve_bp: 0,
      ...limits,
    });
    // Still gekürzt, nicht markiert: eine feste Provision über dem
    // Bestellwert ist bei kleinen Bestellungen der Normalfall (5.3).
    expect(kleineBestellung.amount_cents).toBe(300);
    expect(kleineBestellung.flagged).toBe(false);
  });

  it("klammert rate_bp an Minimum und Maximum, bevor gerechnet wird", () => {
    const ueberMaximum = computeCommissionParts({
      base_cents: 5000,
      rate_kind: "percent",
      rate_bp: 25_000,
      fixed_cents: 0,
      reserve_bp: 0,
      ...limits,
    });
    // 10000 bp, nicht 25000 bp: sonst 12500 Cent Provision auf 5000 Cent Basis.
    expect(ueberMaximum.amount_cents).toBe(5000);
    expect(ueberMaximum.flagged).toBe(false);

    const unterMinimum = computeCommissionParts({
      base_cents: 5000,
      rate_kind: "percent",
      rate_bp: -3000,
      fixed_cents: 0,
      reserve_bp: 0,
      ...limits,
    });
    expect(unterMinimum.amount_cents).toBe(0);
  });

  it("min_commission_cents hebt an, aber höchstens bis zur Basis", () => {
    const angehoben = computeCommissionParts({
      base_cents: 5000,
      rate_kind: "percent",
      rate_bp: 500,
      fixed_cents: 0,
      reserve_bp: 0,
      min_commission_cents: 400,
      max_commission_cents: null,
    });
    // floor(5000 * 500 / 10000) = 250 -> auf 400 angehoben
    expect(angehoben.amount_cents).toBe(400);

    const anDerBasis = computeCommissionParts({
      base_cents: 300,
      rate_kind: "percent",
      rate_bp: 500,
      fixed_cents: 0,
      reserve_bp: 0,
      min_commission_cents: 900,
      max_commission_cents: null,
    });
    expect(anDerBasis.amount_cents).toBe(300);
  });

  it("max_commission_cents deckelt und wirkt nach der Untergrenze", () => {
    const gedeckelt = computeCommissionParts({
      base_cents: 37739,
      rate_kind: "percent",
      rate_bp: 3500,
      fixed_cents: 0,
      reserve_bp: 1000,
      min_commission_cents: null,
      max_commission_cents: 5000,
    });
    expect(gedeckelt.amount_cents).toBe(5000);
    expect(gedeckelt.reserve_cents).toBe(500);

    // Die Migration verbietet `max_commission_cents < min_commission_cents`
    // per CHECK; die Reihenfolge wird trotzdem festgehalten, damit die
    // Funktion nicht von diesem Constraint abhängt (5.3 nennt die Untergrenze
    // vor der Obergrenze).
    const obergrenzeSchlaegtUntergrenze = computeCommissionParts({
      base_cents: 5000,
      rate_kind: "percent",
      rate_bp: 500,
      fixed_cents: 0,
      reserve_bp: 0,
      min_commission_cents: 400,
      max_commission_cents: 300,
    });
    expect(obergrenzeSchlaegtUntergrenze.amount_cents).toBe(300);
  });

  it("Basis <= 0 ergibt eine Zeile über 0 Cent mit zero_base (cancel_reason='zero_amount')", () => {
    for (const base of [0, -1, -5000]) {
      const parts = computeCommissionParts({
        base_cents: base,
        rate_kind: "percent",
        rate_bp: 3500,
        fixed_cents: 0,
        reserve_bp: 1000,
        ...limits,
      });
      expect(parts).toEqual({
        amount_cents: 0,
        sale_cents: 0,
        reserve_cents: 0,
        zero_base: true,
        flagged: false,
        flag_reason: null,
      });
    }
  });
});

// =======================================================================
// 5.5 und 5.6 — Zweite Stufe und Gesamtdeckel
// =======================================================================

describe("computeTier2Cents (5.5/5.6)", () => {
  const beispielA = {
    enabled: true,
    referrer_active: true,
    parent_kind: "sale" as const,
    basis: PROGRAM_5_9.tier2_basis,
    rate_bp: PROGRAM_5_9.tier2_rate_bp,
    base_cents: 37739,
    commission_cents: 13208,
  };

  it("Beispiel A: 2000 bp auf 13208 Cent Provision ergibt 2641 Cent für den Werber", () => {
    expect(computeTier2Cents(beispielA)).toBe(2641);
  });

  it("Beispiel A: die Zweitstufe kürzt die erste Stufe nicht, der Händler trägt 15849 Cent", () => {
    const parts = computeCommissionParts({
      base_cents: 37739,
      rate_kind: "percent",
      rate_bp: 3500,
      fixed_cents: 0,
      reserve_bp: 1000,
      min_commission_cents: null,
      max_commission_cents: null,
    });
    const tier2 = computeTier2Cents({ ...beispielA, commission_cents: parts.amount_cents });
    expect(parts.sale_cents + parts.reserve_cents + tier2).toBe(15_849);
    expect(parts.amount_cents + tier2).toBeLessThanOrEqual(37_739);
  });

  it("tier2_basis='revenue' rechnet auf die Bemessungsgrundlage statt auf die Provision", () => {
    // floor(37739 * 2000 / 10000) = floor(7547,8) = 7547
    expect(computeTier2Cents({ ...beispielA, basis: "revenue" })).toBe(7547);
  });

  it("nichts ohne eingeschaltete Zweitstufe und nichts ohne aktiven Werber", () => {
    expect(computeTier2Cents({ ...beispielA, enabled: false })).toBe(0);
    expect(computeTier2Cents({ ...beispielA, referrer_active: false })).toBe(0);
  });

  it("nur zu sale und recurring, nie zu einer tier2-Zeile — genau eine Stufe", () => {
    expect(computeTier2Cents({ ...beispielA, parent_kind: "recurring" })).toBe(2641);
    for (const kind of ["tier2", "reserve", "recurring_reserve", "reversal", "recredit", "manual"] as const) {
      expect(computeTier2Cents({ ...beispielA, parent_kind: kind })).toBe(0);
    }
  });

  it("Gesamtdeckel 5.6: die Zweitstufe wird auf base - betrag gekürzt", () => {
    // Basis 1000, erste Stufe 9000 bp = 900 -> Rest 100, roh wären
    // floor(900 * 2000 / 10000) = 180.
    expect(
      computeTier2Cents({ ...beispielA, base_cents: 1000, commission_cents: 900 }),
    ).toBe(100);
  });

  it("Gesamtdeckel 5.6: verbraucht die erste Stufe die ganze Basis, entfällt die Zweitstufe", () => {
    const parts = computeCommissionParts({
      base_cents: 1000,
      rate_kind: "percent",
      rate_bp: 10_000,
      fixed_cents: 0,
      reserve_bp: 0,
      min_commission_cents: null,
      max_commission_cents: null,
    });
    expect(parts.amount_cents).toBe(1000);
    expect(
      computeTier2Cents({ ...beispielA, base_cents: 1000, commission_cents: parts.amount_cents }),
    ).toBe(0);
  });
});

// =======================================================================
// 5.8 und G7 — Storno
// =======================================================================

describe("computeReversalDelta (5.8, G7)", () => {
  const CHARGE = 44_910;

  it("Beispiel C, erste Teilerstattung über 100,00 EUR: -2647 / -293 / -588", () => {
    const schritt = (amount: number) =>
      computeReversalDelta({
        amount_cents: amount,
        refunded_total_cents: 10_000,
        charge_total_cents: CHARGE,
        already_reversed_cents: 0,
      });
    expect(schritt(11_888)).toMatchObject({ target_cents: 2647, amount_cents: -2647, should_book: true });
    expect(schritt(1320)).toMatchObject({ target_cents: 293, amount_cents: -293 });
    expect(schritt(2641)).toMatchObject({ target_cents: 588, amount_cents: -588 });
  });

  it("Beispiel C, zweite Teilerstattung: kumulativer Stand, gebucht wird nur das Delta (G7)", () => {
    // Das ist der Pflichttest hinter G7. `charge.amount_refunded` ist der
    // GESAMTE bisher erstattete Betrag (stripe/types/Charges.d.ts:35).
    const sale = computeReversalDelta({
      amount_cents: 11_888,
      refunded_total_cents: 20_000,
      charge_total_cents: CHARGE,
      already_reversed_cents: 2647,
    });
    expect(sale.target_cents).toBe(5294);
    expect(sale.amount_cents).toBe(-2647);

    const reserve = computeReversalDelta({
      amount_cents: 1320,
      refunded_total_cents: 20_000,
      charge_total_cents: CHARGE,
      already_reversed_cents: 293,
    });
    expect(reserve.target_cents).toBe(587);
    // 294, nicht 293: der Zielwert ist die Wahrheit, nicht die Wiederholung
    // des ersten Deltas.
    expect(reserve.amount_cents).toBe(-294);

    const tier2 = computeReversalDelta({
      amount_cents: 2641,
      refunded_total_cents: 20_000,
      charge_total_cents: CHARGE,
      already_reversed_cents: 588,
    });
    expect(tier2.target_cents).toBe(1176);
    expect(tier2.amount_cents).toBe(-588);
  });

  it("Beispiel C: die falsche Deckel-Logik stornierte nach zwei Teilerstattungen 7941 statt 5294", () => {
    // Der Vergleich, wegen dem G7 existiert: würde `amount_refunded` als
    // Delta missverstanden und nur auf 100 % gedeckelt, buchte der zweite
    // Schritt den vollen Zielwert noch einmal.
    const ersterSchritt = computeReversalDelta({
      amount_cents: 11_888,
      refunded_total_cents: 10_000,
      charge_total_cents: CHARGE,
      already_reversed_cents: 0,
    });
    const zweiterSchrittRichtig = computeReversalDelta({
      amount_cents: 11_888,
      refunded_total_cents: 20_000,
      charge_total_cents: CHARGE,
      already_reversed_cents: -ersterSchritt.amount_cents,
    });
    const richtigGesamt = -(ersterSchritt.amount_cents + zweiterSchrittRichtig.amount_cents);
    expect(richtigGesamt).toBe(5294);

    const falschGesamt = -ersterSchritt.amount_cents + zweiterSchrittRichtig.target_cents;
    expect(falschGesamt).toBe(7941);
    // 200,00 EUR von 449,10 EUR sind 44,5 % Erstattung; die falsche Logik
    // stornierte 7941 von 11888, also 66,8 %.
    expect(falschGesamt / 11_888).toBeGreaterThan(0.66);
    expect(richtigGesamt / 11_888).toBeLessThan(0.45);
  });

  it("Beispiel C, Vollstorno: die Summe der Gegenbuchungen ist exakt der Ursprungsbetrag, kein Restcent", () => {
    for (const [betrag, deltas] of [
      [11_888, [2647, 2647, 6594]],
      [1320, [293, 294, 733]],
      [2641, [588, 588, 1465]],
    ] as const) {
      let bereits = 0;
      const gebucht: number[] = [];
      for (const kumulativ of [10_000, 20_000, CHARGE]) {
        const schritt = computeReversalDelta({
          amount_cents: betrag,
          refunded_total_cents: kumulativ,
          charge_total_cents: CHARGE,
          already_reversed_cents: bereits,
        });
        gebucht.push(-schritt.amount_cents);
        bereits += -schritt.amount_cents;
      }
      expect(gebucht).toEqual([...deltas]);
      expect(bereits).toBe(betrag);
    }
  });

  it("Vollstorno in einem Schritt lässt ebenfalls keinen Restcent stehen", () => {
    // Ein Betrag, bei dem jede Teilrechnung abrunden würde.
    const schritt = computeReversalDelta({
      amount_cents: 9999,
      refunded_total_cents: 33_333,
      charge_total_cents: 33_333,
      already_reversed_cents: 0,
    });
    expect(schritt.amount_cents).toBe(-9999);
  });

  it("bucht nichts, wenn das Ziel bereits erreicht ist", () => {
    const schritt = computeReversalDelta({
      amount_cents: 11_888,
      refunded_total_cents: 10_000,
      charge_total_cents: CHARGE,
      already_reversed_cents: 2647,
    });
    expect(schritt).toMatchObject({ delta_cents: 0, amount_cents: 0, should_book: false });
  });

  it("bucht nichts bei einem Charge-Betrag von 0 und nichts zu einer Zeile über 0 Cent", () => {
    expect(
      computeReversalDelta({
        amount_cents: 11_888,
        refunded_total_cents: 10_000,
        charge_total_cents: 0,
        already_reversed_cents: 0,
      }).should_book,
    ).toBe(false);
    expect(
      computeReversalDelta({
        amount_cents: 0,
        refunded_total_cents: 10_000,
        charge_total_cents: CHARGE,
        already_reversed_cents: 0,
      }).should_book,
    ).toBe(false);
  });

  it("deckelt einen Erstattungsstand über dem Charge-Betrag auf den Ursprungsbetrag", () => {
    const schritt = computeReversalDelta({
      amount_cents: 11_888,
      refunded_total_cents: 99_999,
      charge_total_cents: CHARGE,
      already_reversed_cents: 0,
    });
    expect(schritt.target_cents).toBe(11_888);
  });

  it("rechnet auch bei sechsstelligen Eurobeträgen genau", () => {
    // 500.000,00 EUR Charge, 300.000,00 EUR erstattet, 90.000,00 EUR Provision.
    const schritt = computeReversalDelta({
      amount_cents: 9_000_000,
      refunded_total_cents: 30_000_000,
      charge_total_cents: 50_000_000,
      already_reversed_cents: 0,
    });
    expect(schritt.target_cents).toBe(5_400_000);
  });

  it("kein Restcent auch dort, wo die Gleitkommarechnung einen liegen ließe", () => {
    // Der Fall, wegen dem `computeReversalDelta()` mit BigInt rechnet: bei
    // Charge 999.999,99 EUR übersteigt das Produkt der beiden Cent-Beträge
    // `Number.MAX_SAFE_INTEGER`. `Math.floor((99999995 * 99999999) / 99999999)`
    // ergibt in Gleitkomma 99999994 — bei VOLLER Erstattung bliebe ein Cent
    // der Ursprungszeile unstorniert stehen, obwohl 5.8 „kein Rundungsrest"
    // ausdrücklich zusichert. Der Test bricht, sobald jemand die
    // BigInt-Zeile durch die naheliegende Number-Rechnung ersetzt.
    const charge = 99_999_999;
    const amount = 99_999_995;
    expect(Math.floor((amount * charge) / charge)).toBe(99_999_994);

    const schritt = computeReversalDelta({
      amount_cents: amount,
      refunded_total_cents: charge,
      charge_total_cents: charge,
      already_reversed_cents: 0,
    });
    expect(schritt.target_cents).toBe(amount);
    expect(schritt.amount_cents).toBe(-amount);
  });
});

// =======================================================================
// 5.10 und 5.11 — Salden
// =======================================================================

describe("computeBalances (5.10/5.11)", () => {
  it("Beispiel D: Storno vor der Freigabe senkt offen auf 9241 und Reserve auf 1027", () => {
    const rows: AffiliateBalanceInput[] = [
      balanceRow({ id: "sale-1", kind: "sale", amount_cents: 11_888 }),
      balanceRow({ id: "reserve-1", kind: "reserve", amount_cents: 1320 }),
      balanceRow({ id: "tier2-1", kind: "tier2", amount_cents: 2641, partner_id: PARTNER_B }),
      // Die Gegenbuchungen erben Status und hold_until des Elternteils (G6);
      // der Status der Ursprungszeile bleibt unverändert, sonst zöge derselbe
      // Betrag zweimal ab.
      balanceRow({ id: "rev-1", kind: "reversal", amount_cents: -2647, reverses_id: "sale-1" }),
      balanceRow({ id: "rev-2", kind: "reversal", amount_cents: -293, reverses_id: "reserve-1" }),
      balanceRow({
        id: "rev-3",
        kind: "reversal",
        amount_cents: -588,
        reverses_id: "tier2-1",
        partner_id: PARTNER_B,
      }),
    ];

    const [a, b] = computeBalances(rows);
    expect(a).toEqual({
      partner_id: PARTNER_A,
      currency: "eur",
      open_cents: 9241,
      reserved_cents: 1027,
      in_review_cents: 0,
      available_cents: 0,
      paid_cents: 0,
    });
    expect(b?.partner_id).toBe(PARTNER_B);
    expect(b?.open_cents).toBe(2053);
  });

  it("eine Gegenbuchung zu einer Reserve-Zeile mindert die Reserve, nicht den offenen Saldo", () => {
    const [balances] = computeBalances([
      balanceRow({ id: "reserve-1", kind: "reserve", amount_cents: 1000 }),
      balanceRow({ id: "rev-1", kind: "reversal", amount_cents: -400, reverses_id: "reserve-1" }),
    ]);
    expect(balances.reserved_cents).toBe(600);
    expect(balances.open_cents).toBe(0);
  });

  it("eine Wiedergutschrift folgt der Kette recredit -> reversal -> Ursprungszeile", () => {
    const [balances] = computeBalances([
      balanceRow({ id: "reserve-1", kind: "reserve", amount_cents: 1000 }),
      balanceRow({ id: "rev-1", kind: "reversal", amount_cents: -400, reverses_id: "reserve-1" }),
      balanceRow({ id: "rec-1", kind: "recredit", amount_cents: 400, reverses_id: "rev-1" }),
    ]);
    expect(balances.reserved_cents).toBe(1000);
    expect(balances.open_cents).toBe(0);
  });

  it("verteilt die fünf Eimer nach Status", () => {
    const [balances] = computeBalances([
      balanceRow({ id: "1", kind: "sale", status: "pending", amount_cents: 100 }),
      balanceRow({ id: "2", kind: "reserve", status: "pending", amount_cents: 200 }),
      balanceRow({ id: "3", kind: "sale", status: "on_hold", amount_cents: 400 }),
      balanceRow({ id: "4", kind: "sale", status: "approved", amount_cents: 800 }),
      balanceRow({ id: "5", kind: "sale", status: "paid", amount_cents: 1600, payout_id: "p-1" }),
      balanceRow({ id: "6", kind: "sale", status: "cancelled", amount_cents: 3200 }),
      // G8: vom Auszahlungsentwurf reserviert, aber noch nicht überwiesen —
      // weder verfügbar noch ausgezahlt.
      balanceRow({ id: "7", kind: "sale", status: "approved", amount_cents: 6400, payout_id: "p-2" }),
    ]);
    expect(balances).toEqual({
      partner_id: PARTNER_A,
      currency: "eur",
      open_cents: 100,
      reserved_cents: 200,
      in_review_cents: 400,
      available_cents: 800,
      paid_cents: 1600,
    });
  });

  it("Handbuchungen und Reserve-Folgeraten landen im richtigen Eimer", () => {
    const [balances] = computeBalances([
      balanceRow({ id: "1", kind: "manual", amount_cents: -500 }),
      balanceRow({ id: "2", kind: "recurring", amount_cents: 741 }),
      balanceRow({ id: "3", kind: "recurring_reserve", amount_cents: 82 }),
    ]);
    expect(balances.open_cents).toBe(241);
    expect(balances.reserved_cents).toBe(82);
  });

  it("verfügbar darf negativ werden — die Schuld verrechnet sich mit künftigen Provisionen", () => {
    const [balances] = computeBalances([
      balanceRow({ id: "1", kind: "sale", status: "approved", amount_cents: 300 }),
      balanceRow({ id: "2", kind: "reversal", status: "approved", amount_cents: -900, reverses_id: "1" }),
    ]);
    expect(balances.available_cents).toBe(-600);
  });

  it("Testbuchungen zählen in keinem Eimer mit", () => {
    expect(
      computeBalances([balanceRow({ id: "1", kind: "sale", amount_cents: 5000, is_test: true })]),
    ).toEqual([]);
  });

  it("trennt nach Währung und summiert nie darüber hinweg (5.11)", () => {
    const balances = computeBalances([
      balanceRow({ id: "1", kind: "sale", amount_cents: 1000, currency: "eur" }),
      balanceRow({ id: "2", kind: "sale", amount_cents: 2000, currency: "chf" }),
    ]);
    expect(balances).toHaveLength(2);
    expect(balances.map((b) => [b.currency, b.open_cents])).toEqual([
      ["chf", 2000],
      ["eur", 1000],
    ]);
  });

  it("liefert für Partner ohne Zeilen keinen Eintrag und ist reihenfolgestabil", () => {
    const rows = [
      balanceRow({ id: "1", kind: "sale", amount_cents: 10, partner_id: PARTNER_B }),
      balanceRow({ id: "2", kind: "sale", amount_cents: 20, partner_id: PARTNER_A }),
    ];
    expect(computeBalances(rows).map((b) => b.partner_id)).toEqual([PARTNER_A, PARTNER_B]);
    expect(computeBalances([...rows].reverse()).map((b) => b.partner_id)).toEqual([
      PARTNER_A,
      PARTNER_B,
    ]);
  });

  it("eine Gegenbuchung ohne auffindbares Elternteil bleibt im offenen Eimer", () => {
    const [balances] = computeBalances([
      balanceRow({ id: "rev-1", kind: "reversal", amount_cents: -400, reverses_id: "nicht-geladen" }),
    ]);
    expect(balances.open_cents).toBe(-400);
  });
});

// =======================================================================
// G3 und 3.11 — Idempotenzschlüssel
// =======================================================================

describe("buildDedupKey (G3, 3.11)", () => {
  const ORDER = "order-1";
  const INVOICE = "in_1";
  const REVERSES = "commission-1";

  it("gleiche Eingabe ergibt denselben Schlüssel", () => {
    expect(buildDedupKey({ kind: "sale", order_id: ORDER })).toBe(
      buildDedupKey({ kind: "sale", order_id: ORDER }),
    );
    expect(
      buildDedupKey({ kind: "reversal", reverses_id: REVERSES, source_id: "ch_1", refunded_total_cents: 10_000 }),
    ).toBe(
      buildDedupKey({ kind: "reversal", reverses_id: REVERSES, source_id: "ch_1", refunded_total_cents: 10_000 }),
    );
  });

  it("unterschiedliche Eingabe ergibt unterschiedliche Schlüssel", () => {
    expect(buildDedupKey({ kind: "sale", order_id: "order-1" })).not.toBe(
      buildDedupKey({ kind: "sale", order_id: "order-2" }),
    );
    expect(buildDedupKey({ kind: "recurring", stripe_invoice_id: "in_1" })).not.toBe(
      buildDedupKey({ kind: "recurring", stripe_invoice_id: "in_2" }),
    );
  });

  it("sale und reserve derselben Bestellung sind zwei Zeilen und damit zwei Schlüssel (G5)", () => {
    expect(buildDedupKey({ kind: "sale", order_id: ORDER })).toBe(`sale:${ORDER}`);
    expect(buildDedupKey({ kind: "reserve", order_id: ORDER })).toBe(`reserve:${ORDER}`);
  });

  it("Abo-Rate und ihre Reserve hängen an der Rechnung, nicht an der Bestellung", () => {
    expect(buildDedupKey({ kind: "recurring", stripe_invoice_id: INVOICE })).toBe(`recurring:${INVOICE}`);
    expect(buildDedupKey({ kind: "recurring_reserve", stripe_invoice_id: INVOICE })).toBe(
      `recurring_reserve:${INVOICE}`,
    );
  });

  it("die Zweitstufe hängt an ihrer Elternzeile", () => {
    expect(buildDedupKey({ kind: "tier2", parent_id: "sale-row-1" })).toBe("tier2:sale-row-1");
  });

  it("jede Stufe einer Teilerstattung bekommt einen eigenen Schlüssel (G7)", () => {
    const ersteStufe = buildDedupKey({
      kind: "reversal",
      reverses_id: REVERSES,
      source_id: "ch_1",
      refunded_total_cents: 10_000,
    });
    const zweiteStufe = buildDedupKey({
      kind: "reversal",
      reverses_id: REVERSES,
      source_id: "ch_1",
      refunded_total_cents: 20_000,
    });
    expect(ersteStufe).toBe(`reversal:${REVERSES}:ch_1:10000`);
    expect(zweiteStufe).toBe(`reversal:${REVERSES}:ch_1:20000`);
    expect(ersteStufe).not.toBe(zweiteStufe);
  });

  it("Gegenbuchung, Wiedergutschrift und Handbuchung liegen auf getrennten Schlüsseln", () => {
    const gegenbuchung = buildDedupKey({
      kind: "reversal",
      reverses_id: REVERSES,
      source_id: "ch_1",
      refunded_total_cents: 10_000,
    });
    const wiedergutschrift = buildDedupKey({
      kind: "recredit",
      reverses_id: REVERSES,
      dispute_id: "dp_1",
    });
    const handbuchung = buildDedupKey({ kind: "manual", unique_id: REVERSES });
    expect(new Set([gegenbuchung, wiedergutschrift, handbuchung]).size).toBe(3);
    expect(wiedergutschrift).toBe(`recredit:${REVERSES}:dp_1`);
    expect(handbuchung).toBe(`manual:${REVERSES}`);
  });

  it("zwei Disputes auf derselben Gegenbuchung kollidieren nicht", () => {
    expect(buildDedupKey({ kind: "recredit", reverses_id: REVERSES, dispute_id: "dp_1" })).not.toBe(
      buildDedupKey({ kind: "recredit", reverses_id: REVERSES, dispute_id: "dp_2" }),
    );
  });

  it("zwei Handbuchungen mit verschiedener Kennung kollidieren nicht", () => {
    expect(buildDedupKey({ kind: "manual", unique_id: "u-1" })).not.toBe(
      buildDedupKey({ kind: "manual", unique_id: "u-2" }),
    );
  });
});
