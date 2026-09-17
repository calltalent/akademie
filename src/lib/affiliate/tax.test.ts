import { describe, expect, it } from "vitest";
import {
  AFFILIATE_TAX_REGULAR_RATE_BP,
  AFFILIATE_VAT_VALIDITY_DAYS,
  computeAffiliateTax,
  hasCurrentVatCheck,
  isEuCountry,
  resolveAffiliateTax,
  resolveAffiliateTaxMode,
  type AffiliateTaxProfileInput,
} from "./tax";

/**
 * Affiliate-System, Block B8 — STEUERMODUS UND STEUERBETRAG
 * (PLAN_Affiliate-System.md 7.4, 7.5, G12).
 *
 * Geprüft werden ALLE SECHS Zeilen der Tabelle aus 7.4, einschließlich der
 * beiden, die keinen Modus liefern, sondern die Auszahlung blockieren. Die
 * zwei Blockaden sind der eigentliche Gegenstand dieser Datei: ein falsch
 * gesetzter Modus fällt niemandem auf, bis das Finanzamt § 14c UStG anwendet.
 *
 * Keine Mocks, kein `Date.now()` — jede Prüfung bekommt ihren Zeitpunkt
 * ausdrücklich übergeben, sonst wäre der 90-Tage-Test vom Tag des Testlaufs
 * abhängig.
 */

const NOW = new Date("2026-09-17T10:00:00.000Z");

function profile(patch: Partial<AffiliateTaxProfileInput> = {}): AffiliateTaxProfileInput {
  return {
    entity_kind: "business",
    country: "DE",
    small_business: false,
    vat_id: null,
    vat_check_result: null,
    vat_checked_at: null,
    ...patch,
  };
}

/** `n` Tage vor `NOW` als ISO-Zeitstempel. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("resolveAffiliateTaxMode — die sechs Fälle aus 7.4", () => {
  it("Fall 1: DE, Unternehmen, kein Kleinunternehmer -> regular mit 1900 bp", () => {
    const result = resolveAffiliateTaxMode(profile(), NOW);

    expect(result).toMatchObject({
      ok: true,
      tax_mode: "regular",
      tax_rate_bp: AFFILIATE_TAX_REGULAR_RATE_BP,
      documentHint: "Gutschrift gemäß § 14 Abs. 2 UStG",
    });
  });

  it("Fall 2: DE, Unternehmen, Kleinunternehmer -> small_business mit 0 bp und § 19-Hinweis", () => {
    const result = resolveAffiliateTaxMode(profile({ small_business: true }), NOW);

    expect(result).toMatchObject({
      ok: true,
      tax_mode: "small_business",
      tax_rate_bp: 0,
    });
    // Der Hinweis ist Pflichtangabe, nicht Zierde: ohne ihn fehlt die
    // Begründung, warum auf dem Beleg keine Steuer steht.
    expect(result.ok && result.documentHint).toContain("§ 19 UStG");
  });

  it("Fall 3: EU ungleich DE mit gültiger, frischer USt-IdNr. -> reverse_charge", () => {
    const result = resolveAffiliateTaxMode(
      profile({
        country: "AT",
        vat_id: "ATU12345678",
        vat_check_result: "valid",
        vat_checked_at: daysAgo(1),
      }),
      NOW,
    );

    expect(result).toMatchObject({ ok: true, tax_mode: "reverse_charge", tax_rate_bp: 0 });
    expect(result.ok && result.documentHint).toContain("Art. 196 MwStSystRL");
  });

  it("Fall 4: Drittland, Unternehmen -> non_eu, nicht im Inland steuerbar", () => {
    const result = resolveAffiliateTaxMode(profile({ country: "CH" }), NOW);

    expect(result).toMatchObject({ ok: true, tax_mode: "non_eu", tax_rate_bp: 0 });
  });

  it("Fall 5 (BLOCKADE): EU ungleich DE ohne geprüfte USt-IdNr. liefert keinen Modus", () => {
    const result = resolveAffiliateTaxMode(profile({ country: "FR" }), NOW);

    expect(result).toEqual({ ok: false, reason: "eu_vat_missing" });
  });

  it("Fall 6 (BLOCKADE): Privatperson blockiert in JEDEM Land, auch im Inland", () => {
    for (const country of ["DE", "AT", "CH", "US"]) {
      const result = resolveAffiliateTaxMode(profile({ entity_kind: "private", country }), NOW);

      // Wichtig ist nicht nur das `ok: false`, sondern dass eine deutsche
      // Privatperson NICHT vorher in `regular` läuft: eine Gutschrift mit
      // Steuerausweis an einen Nichtunternehmer ist genau der § 14c-Fall.
      expect(result).toEqual({ ok: false, reason: "private_entity" });
    }
  });
});

describe("resolveAffiliateTaxMode — Blockaden aus Fall 5 im Detail", () => {
  it("blockiert bei vat_check_result 'unchecked' (VIES war nicht erreichbar)", () => {
    const result = resolveAffiliateTaxMode(
      profile({
        country: "IT",
        vat_id: "IT12345678901",
        vat_check_result: "unchecked",
        vat_checked_at: daysAgo(1),
      }),
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: "eu_vat_missing" });
  });

  it("blockiert bei vat_check_result 'invalid'", () => {
    const result = resolveAffiliateTaxMode(
      profile({
        country: "IT",
        vat_id: "IT99999999999",
        vat_check_result: "invalid",
        vat_checked_at: daysAgo(1),
      }),
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: "eu_vat_missing" });
  });

  it("blockiert, wenn die gültige Prüfung älter als 90 Tage ist", () => {
    const stale = profile({
      country: "NL",
      vat_id: "NL123456789B01",
      vat_check_result: "valid",
      vat_checked_at: daysAgo(AFFILIATE_VAT_VALIDITY_DAYS + 1),
    });

    expect(resolveAffiliateTaxMode(stale, NOW)).toEqual({ ok: false, reason: "eu_vat_missing" });
  });

  it("lässt die Prüfung am 90. Tag noch gelten, am 91. nicht mehr", () => {
    const at90 = profile({
      country: "NL",
      vat_id: "NL123456789B01",
      vat_check_result: "valid",
      vat_checked_at: daysAgo(AFFILIATE_VAT_VALIDITY_DAYS),
    });

    expect(hasCurrentVatCheck(at90, NOW)).toBe(true);
    expect(
      hasCurrentVatCheck({ ...at90, vat_checked_at: daysAgo(AFFILIATE_VAT_VALIDITY_DAYS + 1) }, NOW),
    ).toBe(false);
  });

  it("wertet einen Prüfzeitpunkt aus der Zukunft als ungeprüft (Uhrenversatz, Manipulation)", () => {
    const future = profile({
      country: "ES",
      vat_id: "ESA12345678",
      vat_check_result: "valid",
      vat_checked_at: new Date(NOW.getTime() + 86_400_000).toISOString(),
    });

    expect(resolveAffiliateTaxMode(future, NOW)).toEqual({ ok: false, reason: "eu_vat_missing" });
  });

  it("wertet einen unlesbaren Prüfzeitpunkt als ungeprüft statt zu werfen", () => {
    const broken = profile({
      country: "ES",
      vat_id: "ESA12345678",
      vat_check_result: "valid",
      vat_checked_at: "irgendwann",
    });

    expect(resolveAffiliateTaxMode(broken, NOW)).toEqual({ ok: false, reason: "eu_vat_missing" });
  });

  it("blockiert 'valid' ohne hinterlegte USt-IdNr. — ein Status ohne Nummer belegt nichts", () => {
    const result = resolveAffiliateTaxMode(
      profile({ country: "PL", vat_id: null, vat_check_result: "valid", vat_checked_at: daysAgo(1) }),
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: "eu_vat_missing" });
  });
});

describe("resolveAffiliateTaxMode — unvollständiges Profil", () => {
  it("meldet die fehlende Rechtsform, statt eine zu unterstellen", () => {
    expect(resolveAffiliateTaxMode(profile({ entity_kind: null }), NOW)).toEqual({
      ok: false,
      reason: "entity_kind_missing",
    });
  });

  it("meldet das fehlende Land", () => {
    expect(resolveAffiliateTaxMode(profile({ country: null }), NOW)).toEqual({
      ok: false,
      reason: "country_missing",
    });
    expect(resolveAffiliateTaxMode(profile({ country: "   " }), NOW)).toEqual({
      ok: false,
      reason: "country_missing",
    });
  });

  it("liest das Land unabhängig von Schreibweise und Leerzeichen", () => {
    expect(resolveAffiliateTaxMode(profile({ country: " de " }), NOW)).toMatchObject({
      tax_mode: "regular",
    });
  });
});

describe("isEuCountry", () => {
  it("kennt Griechenland unter beiden Präfixen (ISO 'GR', VIES 'EL')", () => {
    expect(isEuCountry("GR")).toBe(true);
    expect(isEuCountry("EL")).toBe(true);
  });

  it("führt Nordirland NICHT als EU — für sonstige Leistungen ist XI Drittland", () => {
    expect(isEuCountry("XI")).toBe(false);
    expect(isEuCountry("GB")).toBe(false);
  });

  it("verträgt null und Leerstring", () => {
    expect(isEuCountry(null)).toBe(false);
    expect(isEuCountry("")).toBe(false);
  });
});

describe("computeAffiliateTax", () => {
  it("rechnet das Beispiel aus 7.4 — und zwar die FORMEL, nicht das verrechnete Zwischenergebnis des Plantexts", () => {
    // Der Plan notiert an dieser Stelle „floor(3016,31) = 3016" und
    // „Gesamt 188,65 €". 19 % von 158,49 € sind 30,1131 €; maßgeblich ist die
    // Formel floor((15849*1900 + 5000)/10000) = floor(3011,81) = 3011.
    expect(computeAffiliateTax(15_849, 1900)).toEqual({
      subtotal_cents: 15_849,
      tax_rate_bp: 1900,
      tax_cents: 3011,
      total_cents: 18_860,
    });
  });

  it("rundet kaufmännisch: ab einem halben Cent aufwärts", () => {
    // 1 Cent zu 19 % = 0,19 Cent -> 0. 3 Cent = 0,57 Cent -> 1.
    expect(computeAffiliateTax(1, 1900).tax_cents).toBe(0);
    expect(computeAffiliateTax(3, 1900).tax_cents).toBe(1);
    // Genau 0,5 Cent (50 bp auf 100 Cent) geht nach oben, nicht nach unten.
    expect(computeAffiliateTax(100, 50).tax_cents).toBe(1);
  });

  it("liefert bei 0 bp keinen Steuerbetrag und eine Endsumme gleich dem Entgelt", () => {
    expect(computeAffiliateTax(124_780, 0)).toEqual({
      subtotal_cents: 124_780,
      tax_rate_bp: 0,
      tax_cents: 0,
      total_cents: 124_780,
    });
  });

  it("weist ein negatives Entgelt ab, statt eine Rundungsrichtung zu erfinden", () => {
    expect(() => computeAffiliateTax(-100, 1900)).toThrow();
  });

  it("weist gebrochene Beträge und Sätze ab (G12: alles ganzzahlig)", () => {
    expect(() => computeAffiliateTax(100.5, 1900)).toThrow();
    expect(() => computeAffiliateTax(100, 19.5)).toThrow();
    expect(() => computeAffiliateTax(100, 10_001)).toThrow();
  });

  it("bleibt bei einem int4-Maximalbetrag im sicheren Ganzzahlbereich", () => {
    const max = 2_147_483_647;
    const result = computeAffiliateTax(max, 10_000);

    expect(Number.isSafeInteger(result.tax_cents)).toBe(true);
    expect(result.tax_cents).toBe(max);
  });
});

describe("resolveAffiliateTax — Modus und Betrag in einem Schritt", () => {
  it("liefert für das Inland Entgelt, Steuer und Endsumme zusammen", () => {
    const result = resolveAffiliateTax(profile(), 15_849, NOW);

    expect(result).toMatchObject({
      ok: true,
      tax_mode: "regular",
      subtotal_cents: 15_849,
      tax_cents: 3011,
      total_cents: 18_860,
    });
  });

  it("rechnet gar nicht erst, wenn der Modus blockiert", () => {
    const result = resolveAffiliateTax(profile({ entity_kind: "private" }), 15_849, NOW);

    expect(result).toEqual({ ok: false, reason: "private_entity" });
  });

  it("zahlt bei Reverse Charge genau das Nettohonorar aus — keine Steuer obendrauf", () => {
    const result = resolveAffiliateTax(
      profile({
        country: "AT",
        vat_id: "ATU12345678",
        vat_check_result: "valid",
        vat_checked_at: daysAgo(10),
      }),
      124_780,
      NOW,
    );

    expect(result).toMatchObject({ ok: true, tax_cents: 0, total_cents: 124_780 });
  });
});
