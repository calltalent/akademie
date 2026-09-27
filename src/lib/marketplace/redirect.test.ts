import { describe, expect, it } from "vitest";
import { resolveSafeNextParam } from "./redirect";

/**
 * Marketplace M5 — Test für `resolveSafeNextParam()` (Open-Redirect-Schutz,
 * security-reviewer-Fund 03.08.2026, MITTEL, behoben). Siehe Kopfkommentar
 * `redirect.ts` zur Extraktion aus `marketplace/login/page.tsx`.
 */

describe("resolveSafeNextParam", () => {
  it("liefert null bei fehlendem Parameter (null)", () => {
    expect(resolveSafeNextParam(null)).toBeNull();
  });

  it("liefert null bei leerem Parameter (`?next=`)", () => {
    expect(resolveSafeNextParam("")).toBeNull();
  });

  it("akzeptiert einen relativen Pfad mit genau einem führenden Slash", () => {
    expect(resolveSafeNextParam("/kurs/xyz")).toBe("/kurs/xyz");
  });

  it("akzeptiert einen relativen Pfad mit Query-String unverändert", () => {
    expect(resolveSafeNextParam("/kurs/xyz?ref=email")).toBe("/kurs/xyz?ref=email");
  });

  it("lehnt einen protokollrelativen Pfad ab (`//evil.example`)", () => {
    expect(resolveSafeNextParam("//evil.example")).toBeNull();
  });

  it("lehnt eine absolute URL ab (`https://evil.example`)", () => {
    expect(resolveSafeNextParam("https://evil.example")).toBeNull();
  });

  it("lehnt eine absolute URL ohne Schema-Trenner ab (`http:evil.example`)", () => {
    expect(resolveSafeNextParam("http:evil.example")).toBeNull();
  });

  it("lehnt einen Pfad ohne führenden Slash ab (`evil.example`)", () => {
    expect(resolveSafeNextParam("evil.example")).toBeNull();
  });

  // Sicherheitsaudit 27.09.2026 (S10): Backslash und Steuerzeichen.
  it("lehnt einen Backslash nach dem Slash ab (`/\\evil.example`)", () => {
    expect(resolveSafeNextParam("/\\evil.example")).toBeNull();
  });

  it("lehnt einen Backslash an späterer Stelle ab", () => {
    expect(resolveSafeNextParam("/kurs\\..\\x")).toBeNull();
  });

  it("lehnt Tab und Zeilenumbruch ab, die der URL-Parser entfernt (`/\\t/evil.example`)", () => {
    expect(resolveSafeNextParam("/\t/evil.example")).toBeNull();
    expect(resolveSafeNextParam("/\n/evil.example")).toBeNull();
  });
});
