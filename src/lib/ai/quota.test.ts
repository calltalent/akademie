import { describe, expect, it } from "vitest";
import { computeCost, remainingQuota } from "./quota";

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
