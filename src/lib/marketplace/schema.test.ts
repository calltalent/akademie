import { describe, expect, it } from "vitest";
import { centsToEuroInputValue, listingFormSchema } from "./schema";

/**
 * Marketplace Block M2 — Tests für `listingFormSchema`/`centsToEuroInputValue`
 * (src/lib/marketplace/schema.ts). Stil analog zu src/lib/courses/schema.test.ts
 * (kein bestehendes `src/lib/stripe/schema.test.ts` als Vorbild gefunden —
 * `productFormSchema` in stripe/schema.ts hat selbst noch keine Tests).
 *
 * `resolveUniquePublicSlug()` (src/lib/marketplace/resolve-slug.ts) ist NICHT
 * Teil dieser Datei: die Funktion beginnt mit `import "server-only"` und
 * ruft `createAdminClient()` (echter Supabase-Service-Role-Client) auf. Im
 * Projekt existiert bislang kein Vitest-Muster, das `@/lib/supabase/admin`
 * mockt (`grep -rl "supabase/admin" src --include="*.test.ts"` liefert keine
 * Treffer) — ein Mock ad hoc für diesen einen Test einzuführen würde nur die
 * Mock-Implementierung selbst testen, nicht die echte Kollisions-/RLS-
 * Interaktion mit der DB. Sinnvoll wäre hier ein DB-Integrationstest (z. B.
 * gegen ein lokal verlinktes Supabase-Projekt), keine reine Unit-Isolation
 * — ausgelassen, siehe PHASENSTATUS.md Block "Marketplace M2".
 */

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

describe("listingFormSchema", () => {
  it("akzeptiert eine minimale gültige Eingabe (nur Pflichtfelder)", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "9,90", courseId: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priceCents).toBe(990);
      expect(result.data.courseId).toBe(VALID_UUID);
      expect(result.data).not.toHaveProperty("priceEuro");
    }
  });

  it("akzeptiert Preis mit Komma als Dezimaltrennzeichen", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "19,99", courseId: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priceCents).toBe(1999);
  });

  it("akzeptiert Preis mit Punkt als Dezimaltrennzeichen", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "19.99", courseId: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priceCents).toBe(1999);
  });

  it("akzeptiert priceCents = 0 (Gratis-Fall) — Abweichung ggü. productFormSchema", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "0", courseId: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priceCents).toBe(0);
  });

  it("akzeptiert einen ganzzahligen Preis ohne Nachkommastellen", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "10", courseId: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priceCents).toBe(1000);
  });

  it("lehnt einen negativen Preis ab", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "-5", courseId: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it("lehnt einen nicht-numerischen Preis ab", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "abc", courseId: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it("lehnt einen leeren Preis ab", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "", courseId: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it("lehnt einen Preis mit mehr als zwei Nachkommastellen ab", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "9,999", courseId: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it("lehnt eine fehlende courseId ab", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "9,90" });
    expect(result.success).toBe(false);
  });

  it("lehnt eine leere courseId ab (wird zu undefined preprocessed)", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "9,90", courseId: "" });
    expect(result.success).toBe(false);
  });

  it("lehnt eine courseId ab, die keine UUID ist", () => {
    const result = listingFormSchema.safeParse({ priceEuro: "9,90", courseId: "kein-uuid" });
    expect(result.success).toBe(false);
  });

  it("akzeptiert headline bis 200 Zeichen", () => {
    const result = listingFormSchema.safeParse({
      priceEuro: "9,90",
      courseId: VALID_UUID,
      headline: "a".repeat(200),
    });
    expect(result.success).toBe(true);
  });

  it("lehnt headline über 200 Zeichen ab", () => {
    const result = listingFormSchema.safeParse({
      priceEuro: "9,90",
      courseId: VALID_UUID,
      headline: "a".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("akzeptiert summary bis 2000 Zeichen", () => {
    const result = listingFormSchema.safeParse({
      priceEuro: "9,90",
      courseId: VALID_UUID,
      summary: "a".repeat(2000),
    });
    expect(result.success).toBe(true);
  });

  it("lehnt summary über 2000 Zeichen ab", () => {
    const result = listingFormSchema.safeParse({
      priceEuro: "9,90",
      courseId: VALID_UUID,
      summary: "a".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("wandelt leere optionale Felder (headline/summary/coverUrl) in undefined um", () => {
    const result = listingFormSchema.safeParse({
      priceEuro: "9,90",
      courseId: VALID_UUID,
      headline: "",
      summary: "   ",
      coverUrl: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headline).toBeUndefined();
      expect(result.data.summary).toBeUndefined();
      expect(result.data.coverUrl).toBeUndefined();
    }
  });

  it("akzeptiert eine gültige coverUrl", () => {
    const result = listingFormSchema.safeParse({
      priceEuro: "9,90",
      courseId: VALID_UUID,
      coverUrl: "https://example.test/bild.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("lehnt eine ungültige coverUrl ab", () => {
    const result = listingFormSchema.safeParse({
      priceEuro: "9,90",
      courseId: VALID_UUID,
      coverUrl: "keine-url",
    });
    expect(result.success).toBe(false);
  });
});

describe("centsToEuroInputValue", () => {
  it("formatiert volle Euro-Beträge mit zwei Nachkommastellen", () => {
    expect(centsToEuroInputValue(1000)).toBe("10.00");
  });

  it("formatiert Cent-Beträge korrekt", () => {
    expect(centsToEuroInputValue(990)).toBe("9.90");
  });

  it("formatiert 0 Cent als 0.00", () => {
    expect(centsToEuroInputValue(0)).toBe("0.00");
  });

  it("rundet auf zwei Nachkommastellen", () => {
    expect(centsToEuroInputValue(999)).toBe("9.99");
  });
});
