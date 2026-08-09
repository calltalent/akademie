import { describe, expect, it } from "vitest";
import { clampRange, minutesFromPointerY, snapToQuarterHour } from "./drag";

describe("snapToQuarterHour", () => {
  it("rundet auf die nächste Viertelstunde ab/auf", () => {
    expect(snapToQuarterHour(0)).toBe(0);
    expect(snapToQuarterHour(7)).toBe(0);
    expect(snapToQuarterHour(8)).toBe(15);
    expect(snapToQuarterHour(15)).toBe(15);
    expect(snapToQuarterHour(22)).toBe(15);
    expect(snapToQuarterHour(23)).toBe(30);
  });

  it("rundet negative und über-1440-Werte konsistent (reine Arithmetik, kein Clamping)", () => {
    expect(snapToQuarterHour(-7)).toBe(-0);
    expect(snapToQuarterHour(1450)).toBe(1455);
  });
});

describe("clampRange", () => {
  it("lässt einen Bereich innerhalb der Grenzen unverändert", () => {
    expect(clampRange(480, 960, { min: 0, max: 1440 })).toEqual({ start: 480, end: 960 });
  });

  it("verschiebt den GESAMTEN Bereich (Dauer bleibt erhalten), wenn der Start unter dem Minimum liegt", () => {
    expect(clampRange(-30, 60, { min: 0, max: 1440 })).toEqual({ start: 0, end: 90 });
  });

  it("verschiebt den GESAMTEN Bereich, wenn das Ende über dem Maximum liegt", () => {
    expect(clampRange(1400, 1470, { min: 0, max: 1440 })).toEqual({ start: 1370, end: 1440 });
  });

  it("kappt hart, wenn die Dauer größer als der verfügbare Bereich ist", () => {
    expect(clampRange(-100, 2000, { min: 0, max: 1440 })).toEqual({ start: 0, end: 1440 });
  });

  it("klammert auf Slot-Grenzen (Teil-Buchung innerhalb eines offenen Zeitfensters)", () => {
    // Slot 08:00-16:00 (480-960 Minuten) — ein Drag-Versuch, der über das
    // Slot-Ende hinausgeht, wird auf die Slot-Grenze zurückgeschoben.
    expect(clampRange(900, 1020, { min: 480, max: 960 })).toEqual({ start: 840, end: 960 });
  });
});

describe("minutesFromPointerY", () => {
  it("liefert die Start-Stunde in Minuten bei relativeY=0", () => {
    expect(minutesFromPointerY(0, 6, 44)).toBe(360);
  });

  it("rechnet eine volle Zeilenhöhe in genau 60 Minuten um", () => {
    expect(minutesFromPointerY(44, 6, 44)).toBe(420);
  });

  it("rechnet eine halbe Zeilenhöhe in 30 Minuten um", () => {
    expect(minutesFromPointerY(22, 6, 44)).toBe(390);
  });

  it("funktioniert mit einer anderen Start-Stunde und Zeilenhöhe", () => {
    expect(minutesFromPointerY(88, 8, 44)).toBe(600); // 8:00 + 2 Zeilen (88px / 44px = 2h) = 10:00
  });
});
