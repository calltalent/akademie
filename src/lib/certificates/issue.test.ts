import { describe, expect, it } from "vitest";
import { computeCourseProgress } from "@/lib/progress/compute";
import { generateCertificateSerial } from "@/lib/certificates/serial";
import { safeAccentColor } from "@/lib/email/templates";

/**
 * `issue.ts` selbst hat `import "server-only"` und braucht einen echten
 * Supabase-Admin-Client (DB/Storage) — deshalb wird hier NICHT `issue.ts`
 * importiert (kein Mocking-Aufwand für einen Sandbox-Block), sondern nur
 * die isolierbaren, reinen Bausteine, die `issue.ts` tatsächlich nutzt:
 * - Eignungsprüfung: dieselbe `computeCourseProgress()`-Funktion, mit der
 *   `issue.ts` intern die Vollständigkeit neu berechnet.
 * - Seriennummer-Format (`serial.ts`).
 * - Hex-Farbvalidierung (`safeAccentColor` aus email/templates.ts, von
 *   `pdf.ts` wiederverwendet statt dupliziert, siehe dortiger Kommentar).
 */

describe("Zertifikats-Eignungsprüfung (isComplete aus computeCourseProgress)", () => {
  it("ist NICHT erfüllt, wenn keine Lektion abgeschlossen ist", () => {
    const progress = computeCourseProgress([
      {
        id: "m1",
        lessons: [
          { id: "l1", completed: false },
          { id: "l2", completed: false },
        ],
      },
    ]);
    expect(progress.isComplete).toBe(false);
  });

  it("ist NICHT erfüllt, wenn nur ein Teil der Lektionen abgeschlossen ist", () => {
    const progress = computeCourseProgress([
      {
        id: "m1",
        lessons: [
          { id: "l1", completed: true },
          { id: "l2", completed: false },
        ],
      },
    ]);
    expect(progress.isComplete).toBe(false);
  });

  it("ist erfüllt, wenn alle veröffentlichten Lektionen über alle Module hinweg abgeschlossen sind", () => {
    const progress = computeCourseProgress([
      { id: "m1", lessons: [{ id: "l1", completed: true }] },
      {
        id: "m2",
        lessons: [
          { id: "l2", completed: true },
          { id: "l3", completed: true },
        ],
      },
    ]);
    expect(progress.isComplete).toBe(true);
  });

  it("ist NICHT erfüllt bei einem Kurs ohne (veröffentlichte) Lektionen", () => {
    const progress = computeCourseProgress([]);
    expect(progress.isComplete).toBe(false);
  });
});

describe("generateCertificateSerial", () => {
  it("folgt dem Format CT-<Jahr>-<8-stelliger Crockford-Base32-Code>", () => {
    const serial = generateCertificateSerial(new Date("2026-07-11T00:00:00Z"));
    expect(serial).toMatch(/^CT-2026-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  });

  it("nutzt das aktuelle Jahr, wenn kein Datum übergeben wird", () => {
    const serial = generateCertificateSerial();
    expect(serial.startsWith(`CT-${new Date().getFullYear()}-`)).toBe(true);
  });

  it("erzeugt in der Praxis eindeutige Codes (die eigentliche Garantie liefert der DB-Unique-Constraint, nicht diese Funktion)", () => {
    const serials = new Set(Array.from({ length: 200 }, () => generateCertificateSerial()));
    expect(serials.size).toBe(200);
  });
});

describe("Hex-Farbvalidierung (safeAccentColor, wiederverwendet von pdf.ts für die PDF-Akzentfarbe)", () => {
  it("lässt gültige 6-stellige Hex-Werte durch", () => {
    expect(safeAccentColor("#1d4ed8")).toBe("#1d4ed8");
  });

  it("lässt gültige 3-stellige Hex-Werte durch", () => {
    expect(safeAccentColor("#fff")).toBe("#fff");
  });

  it("fällt bei fehlendem Wert auf die neutrale Standardfarbe zurück", () => {
    expect(safeAccentColor(undefined)).toBe("#171717");
  });

  it("fällt bei ungültigem/schädlichem Wert auf die neutrale Standardfarbe zurück", () => {
    expect(safeAccentColor("javascript:alert(1)")).toBe("#171717");
  });
});
