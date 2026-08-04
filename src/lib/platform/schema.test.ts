import { describe, expect, it } from "vitest";
import {
  platformReviewNoteSchema,
  tenantMarketplaceCommissionSchema,
  payoutReferenceSchema,
  payoutFilterQuerySchema,
} from "./schema";

/**
 * Marketplace Block M3 — Tests für `tenantMarketplaceCommissionSchema` und
 * `platformReviewNoteSchema` (src/lib/platform/schema.ts). Stil analog zu
 * src/lib/marketplace/schema.test.ts (Block M2).
 *
 * Marketplace Block M6 (04.08.2026) ergänzt: `payoutReferenceSchema` und
 * `payoutFilterQuerySchema` — beide reine, zustandslose Zod-Schemas ohne
 * I/O, gleiches Testprinzip. Die DB-lastigen Funktionen in
 * `platform/marketplace.ts` selbst (`getPayoutRows()`/`markPayoutPaid()`)
 * bleiben wie ihre M3-Geschwister (`approveListing()` u. a.) bewusst OHNE
 * eigene Unit-Tests — für diese Datei existiert im ganzen Projekt bislang
 * kein Supabase-Mocking-Muster (kein `marketplace.test.ts`), eine
 * Testinfrastruktur nur für diese beiden neuen Funktionen aufzubauen wäre
 * unverhältnismäßig gegenüber dem bereits etablierten Vorgehen für diese
 * Datei.
 */

describe("tenantMarketplaceCommissionSchema", () => {
  it("akzeptiert einen ganzzahligen Prozentwert und rechnet in Basispunkte um", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("20");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(2000);
  });

  it("akzeptiert einen Prozentwert mit Komma als Dezimaltrennzeichen", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("20,5");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(2050);
  });

  it("akzeptiert einen Prozentwert mit Punkt als Dezimaltrennzeichen", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("20.5");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(2050);
  });

  it("akzeptiert 0 % (Basispunkte 0)", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("0");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(0);
  });

  it("akzeptiert 100 % (obere Basispunkte-Grenze 10000)", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("100");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(10000);
  });

  it("rundet auf ganze Basispunkte (zwei Nachkommastellen Prozent = 1 bp Auflösung)", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("17,55");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(1755);
  });

  it("wandelt einen leeren String in undefined um (Standardsatz verwenden)", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeUndefined();
  });

  it("wandelt nur Leerzeichen in undefined um", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("   ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeUndefined();
  });

  it("wandelt undefined in undefined um", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeUndefined();
  });

  it("wandelt null in undefined um (Feld fehlt im DOM bei deaktiviertem Marketplace-Schalter)", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse(null);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeUndefined();
  });

  it("lehnt einen negativen Prozentwert ab", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("-5");
    expect(result.success).toBe(false);
  });

  it("lehnt einen Wert über 100 % ab (Basispunkte-Grenze 10000 überschritten)", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("100,01");
    expect(result.success).toBe(false);
  });

  it("lehnt einen deutlich zu hohen Wert ab (z. B. 999)", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("999");
    expect(result.success).toBe(false);
  });

  it("lehnt eine nicht-numerische Eingabe ab", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("abc");
    expect(result.success).toBe(false);
  });

  it("lehnt einen Wert mit mehr als zwei Nachkommastellen ab", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("20,555");
    expect(result.success).toBe(false);
  });

  it("lehnt eine Eingabe mit mehr als drei Vorkommastellen ab (Regex-Grenze)", () => {
    const result = tenantMarketplaceCommissionSchema.safeParse("1000");
    expect(result.success).toBe(false);
  });
});

describe("platformReviewNoteSchema", () => {
  it("akzeptiert einen normalen gültigen Begründungstext", () => {
    const result = platformReviewNoteSchema.safeParse("Kursinhalte entsprechen nicht den Richtlinien.");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("Kursinhalte entsprechen nicht den Richtlinien.");
    }
  });

  it("lehnt einen leeren String ab", () => {
    const result = platformReviewNoteSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("lehnt einen String ab, der nur aus Leerzeichen besteht (nach trim leer)", () => {
    const result = platformReviewNoteSchema.safeParse("     ");
    expect(result.success).toBe(false);
  });

  it("lehnt einen zu kurzen String ab (< 5 Zeichen)", () => {
    const result = platformReviewNoteSchema.safeParse("Nein");
    expect(result.success).toBe(false);
  });

  it("akzeptiert einen String mit genau 5 Zeichen (untere Grenze)", () => {
    const result = platformReviewNoteSchema.safeParse("Passt");
    expect(result.success).toBe(true);
  });

  it("akzeptiert einen String mit genau 1000 Zeichen (obere Grenze)", () => {
    const result = platformReviewNoteSchema.safeParse("a".repeat(1000));
    expect(result.success).toBe(true);
  });

  it("lehnt einen String über 1000 Zeichen ab", () => {
    const result = platformReviewNoteSchema.safeParse("a".repeat(1001));
    expect(result.success).toBe(false);
  });

  it("entfernt führende/nachfolgende Leerzeichen (.trim())", () => {
    const result = platformReviewNoteSchema.safeParse("   Gültiger Grund für Ablehnung.   ");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("Gültiger Grund für Ablehnung.");
    }
  });

  it("lehnt einen String ab, der erst nach dem Trimmen zu kurz ist (< 5 Zeichen)", () => {
    const result = platformReviewNoteSchema.safeParse("  ok  ");
    expect(result.success).toBe(false);
  });
});

describe("payoutReferenceSchema", () => {
  it("akzeptiert eine normale Auszahlungsreferenz", () => {
    const result = payoutReferenceSchema.safeParse("SEPA-Überweisung Ref. XY");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("SEPA-Überweisung Ref. XY");
  });

  it("lehnt einen leeren String ab", () => {
    const result = payoutReferenceSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("lehnt einen zu kurzen String ab (< 3 Zeichen)", () => {
    const result = payoutReferenceSchema.safeParse("ab");
    expect(result.success).toBe(false);
  });

  it("akzeptiert einen String mit genau 3 Zeichen (untere Grenze)", () => {
    const result = payoutReferenceSchema.safeParse("abc");
    expect(result.success).toBe(true);
  });

  it("akzeptiert einen String mit genau 200 Zeichen (obere Grenze)", () => {
    const result = payoutReferenceSchema.safeParse("a".repeat(200));
    expect(result.success).toBe(true);
  });

  it("lehnt einen String über 200 Zeichen ab", () => {
    const result = payoutReferenceSchema.safeParse("a".repeat(201));
    expect(result.success).toBe(false);
  });

  it("entfernt führende/nachfolgende Leerzeichen (.trim())", () => {
    const result = payoutReferenceSchema.safeParse("   Ref. 123   ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("Ref. 123");
  });

  it("lehnt einen String ab, der erst nach dem Trimmen zu kurz ist (< 3 Zeichen)", () => {
    const result = payoutReferenceSchema.safeParse("  ab  ");
    expect(result.success).toBe(false);
  });
});

describe("payoutFilterQuerySchema", () => {
  it("akzeptiert ein leeres Objekt (kein Filter gesetzt)", () => {
    const result = payoutFilterQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tenantId).toBeUndefined();
      expect(result.data.from).toBeUndefined();
      expect(result.data.to).toBeUndefined();
    }
  });

  it("akzeptiert eine gültige tenantId (UUID) + gültige from/to-Daten", () => {
    const result = payoutFilterQuerySchema.safeParse({
      tenantId: "11111111-1111-1111-1111-111111111111",
      from: "2026-08-01",
      to: "2026-08-04",
    });
    expect(result.success).toBe(true);
  });

  it("lehnt eine tenantId ab, die keine UUID ist", () => {
    const result = payoutFilterQuerySchema.safeParse({ tenantId: "nicht-uuid" });
    expect(result.success).toBe(false);
  });

  it("lehnt ein from-Datum im falschen Format ab (z. B. TT.MM.JJJJ)", () => {
    const result = payoutFilterQuerySchema.safeParse({ from: "01.08.2026" });
    expect(result.success).toBe(false);
  });

  it("lehnt ein to-Datum im falschen Format ab (z. B. ohne führende Nullen)", () => {
    const result = payoutFilterQuerySchema.safeParse({ to: "2026-8-4" });
    expect(result.success).toBe(false);
  });

  it("akzeptiert nur ein from-Datum ohne to (offener Zeitraum)", () => {
    const result = payoutFilterQuerySchema.safeParse({ from: "2026-08-01" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.from).toBe("2026-08-01");
      expect(result.data.to).toBeUndefined();
    }
  });
});
