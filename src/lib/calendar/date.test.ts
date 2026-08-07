import { describe, expect, it } from "vitest";
import {
  addDays,
  buildWeekGrid,
  formatDayLabel,
  formatTime,
  formatTimeRange,
  isoDateString,
  isoWeekNumber,
  minutesBetween,
  startOfIsoWeek,
} from "./date";

/**
 * Block S1 (07.08.2026) — Pflicht-Testfälle laut Bauauftrag: die Zeitumstellung
 * 29.03.2026 (Sommerzeit-Beginn, 23h-Tag) und 25.10.2026 (Winterzeit-Beginn,
 * 25h-Tag) in Europe/Berlin. Beide Tage sind jeweils der Sonntag ihrer
 * ISO-Woche.
 */
describe("startOfIsoWeek/addDays — Zeitumstellung 29.03.2026 (Sommerzeit-Beginn, 23h-Tag)", () => {
  it("Montag der Woche liegt bei 2026-03-22T23:00:00.000Z (Montag 00:00 CET = UTC+1)", () => {
    const monday = startOfIsoWeek(new Date("2026-03-25T10:00:00Z"));
    expect(monday.toISOString()).toBe("2026-03-22T23:00:00.000Z");
  });

  it("Sonntag (Umstellungstag) liegt noch auf UTC+1 (Umstellung erst 01:00 UTC an diesem Tag)", () => {
    const monday = startOfIsoWeek(new Date("2026-03-25T10:00:00Z"));
    const sunday = addDays(monday, 6);
    expect(sunday.toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });

  it("Folgemontag liegt bereits auf UTC+2 (CEST)", () => {
    const monday = startOfIsoWeek(new Date("2026-03-25T10:00:00Z"));
    const nextMonday = addDays(monday, 7);
    expect(nextMonday.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("der Umstellungstag selbst hat nur 23 Stunden Berlin-Ortszeit", () => {
    const monday = startOfIsoWeek(new Date("2026-03-25T10:00:00Z"));
    const sunday = addDays(monday, 6);
    const nextMonday = addDays(monday, 7);
    expect(minutesBetween(sunday, nextMonday)).toBe(23 * 60);
  });
});

describe("startOfIsoWeek/addDays — Zeitumstellung 25.10.2026 (Winterzeit-Beginn, 25h-Tag)", () => {
  it("Montag der Woche liegt bei 2026-10-18T22:00:00.000Z (Montag 00:00 CEST = UTC+2)", () => {
    const monday = startOfIsoWeek(new Date("2026-10-21T10:00:00Z"));
    expect(monday.toISOString()).toBe("2026-10-18T22:00:00.000Z");
  });

  it("Sonntag (Umstellungstag) liegt noch auf UTC+2 (Umstellung erst 01:00 UTC an diesem Tag)", () => {
    const monday = startOfIsoWeek(new Date("2026-10-21T10:00:00Z"));
    const sunday = addDays(monday, 6);
    expect(sunday.toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });

  it("Folgemontag liegt bereits auf UTC+1 (CET)", () => {
    const monday = startOfIsoWeek(new Date("2026-10-21T10:00:00Z"));
    const nextMonday = addDays(monday, 7);
    expect(nextMonday.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("der Umstellungstag selbst hat 25 Stunden Berlin-Ortszeit", () => {
    const monday = startOfIsoWeek(new Date("2026-10-21T10:00:00Z"));
    const sunday = addDays(monday, 6);
    const nextMonday = addDays(monday, 7);
    expect(minutesBetween(sunday, nextMonday)).toBe(25 * 60);
  });

  it("addDays hält dieselbe Berlin-Wanduhrzeit über den Umstellungstag hinweg (08:00 bleibt 08:00)", () => {
    // 2026-10-24 08:00 Berlin (CEST, UTC+2) -> 2026-10-24T06:00:00Z
    const before = new Date("2026-10-24T06:00:00Z");
    const after = addDays(before, 2); // 2026-10-26 08:00 Berlin (CET, UTC+1)
    expect(formatTime(after)).toBe("08:00");
    expect(after.toISOString()).toBe("2026-10-26T07:00:00.000Z");
  });
});

describe("isoWeekNumber", () => {
  it("2026-01-01 (Donnerstag) liegt in ISO-Woche 1", () => {
    expect(isoWeekNumber(new Date("2026-01-01T12:00:00Z"))).toBe(1);
  });

  it("liefert für jeden Tag derselben Woche dieselbe Wochennummer", () => {
    const monday = startOfIsoWeek(new Date("2026-06-15T12:00:00Z"));
    const week = isoWeekNumber(monday);
    for (let i = 1; i < 7; i++) {
      expect(isoWeekNumber(addDays(monday, i))).toBe(week);
    }
  });
});

describe("buildWeekGrid", () => {
  it("liefert 7 Tage Montag bis Sonntag mit aufsteigenden ISO-Daten", () => {
    const monday = startOfIsoWeek(new Date("2026-08-05T09:00:00Z"));
    const grid = buildWeekGrid(monday);
    expect(grid).toHaveLength(7);
    expect(grid.map((d) => d.isoDate)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
  });
});

describe("isoDateString", () => {
  it("gruppiert einen späten UTC-Zeitpunkt auf den korrekten Berlin-Folgetag", () => {
    // 2026-08-05T23:30:00Z = 2026-08-06T01:30 Berlin (CEST, UTC+2)
    expect(isoDateString(new Date("2026-08-05T23:30:00Z"))).toBe("2026-08-06");
  });
});

describe("formatTimeRange/formatDayLabel", () => {
  it("formatiert eine Zeitspanne als HH:MM–HH:MM in Berlin-Ortszeit", () => {
    const starts = new Date("2026-08-10T06:00:00Z"); // 08:00 CEST
    const ends = new Date("2026-08-10T14:00:00Z"); // 16:00 CEST
    expect(formatTimeRange(starts, ends)).toBe("08:00–16:00");
  });

  it("formatiert den Tag als 'Wochentag, Tag. Monat' (Deutsch)", () => {
    const monday = new Date("2026-08-10T06:00:00Z");
    expect(formatDayLabel(monday)).toBe("Montag, 10. August");
  });
});
