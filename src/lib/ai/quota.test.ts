import { describe, expect, it } from "vitest";
import { computeCost, remainingQuota } from "./quota";
import { BUNNY_TRANSCRIBE_MODEL } from "./config";

describe("computeCost", () => {
  it("berechnet Kosten für sonnet korrekt (2$/10$ pro 1M Tokens)", () => {
    // 1.000.000 Input-Tokens * 2$ + 500.000 Output-Tokens * 10$ = 2 + 5 = 7
    expect(computeCost("sonnet", 1_000_000, 500_000)).toBe(7);
  });

  it("berechnet Kosten für haiku korrekt (1$/5$ pro 1M Tokens)", () => {
    // 200.000 Input-Tokens * 1$ + 100.000 Output-Tokens * 5$ = 0,2 + 0,5 = 0,7
    expect(computeCost("haiku", 200_000, 100_000)).toBe(0.7);
  });

  it("erkennt den vollen Modellnamen (nicht nur den Alias)", () => {
    expect(computeCost("claude-sonnet-4-5-20250929", 1_000_000, 0)).toBe(2);
    expect(computeCost("claude-haiku-4-5-20251001", 1_000_000, 0)).toBe(1);
  });

  it("liefert 0 bei unbekanntem Modell (fail-safe statt Absturz)", () => {
    expect(computeCost("unbekanntes-modell", 1_000_000, 1_000_000)).toBe(0);
  });

  it("liefert 0 bei 0 Tokens", () => {
    expect(computeCost("sonnet", 0, 0)).toBe(0);
  });

  it("berechnet Kosten für Voyage-Embeddings korrekt (0,06$ pro 1M Input-Tokens, Block 2)", () => {
    // 500.000 Input-Tokens * 0,06$ = 0,03
    expect(computeCost("voyage-3", 500_000, 0)).toBe(0.03);
  });

  it("ignoriert tokensOut bei Voyage-Modellen (Embeddings haben keine Output-Tokens)", () => {
    expect(computeCost("voyage-3", 500_000, 999_999)).toBe(0.03);
  });

  it("erkennt auch künftige Voyage-Modellnamen über das 'voyage-'-Präfix", () => {
    expect(computeCost("voyage-4-lite", 1_000_000, 0)).toBe(0.06);
  });

  it("berechnet Bunny-Transcribe-Kosten aus Videolänge in Sekunden (Erweiterung Block 6, ABWEICHUNG siehe PHASENSTATUS.md)", () => {
    // 600 Sekunden = 10 Minuten * 0,10 $/Minute = 1,00 $
    expect(computeCost(BUNNY_TRANSCRIBE_MODEL, 600, 0)).toBe(1);
  });

  it("ignoriert tokensOut bei Bunny-Transcribe (reine Sekunden-basierte Abrechnung)", () => {
    expect(computeCost(BUNNY_TRANSCRIBE_MODEL, 60, 999_999)).toBe(0.1); // 1 Minute * 0,10 $
  });
});

describe("remainingQuota", () => {
  it("liefert den korrekten Rest bei nicht erreichtem Limit", () => {
    expect(remainingQuota(12, 500)).toBe(488);
  });

  it("liefert 0 bei genau erreichtem Limit", () => {
    expect(remainingQuota(20, 20)).toBe(0);
  });

  it("liefert 0 bei überschrittenem Limit (nie negativ)", () => {
    expect(remainingQuota(25, 20)).toBe(0);
  });

  it("liefert das volle Limit bei 0 Verbrauch", () => {
    expect(remainingQuota(0, 5)).toBe(5);
  });
});
