import { describe, expect, it } from "vitest";
import {
  addDays,
  berlinDateTimeToUtc,
  buildWeekGrid,
  buildWeeklySeries,
  formatDayLabel,
  formatTime,
  formatTimeRange,
  isoDateString,
  isoWeekNumber,
  minutesBetween,
  startOfIsoWeek,
  toTimeInputValue,
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

/**
 * Block S2 (08.08.2026) — berlinDateTimeToUtc/toTimeInputValue/buildWeeklySeries.
 * Pflicht-Testfälle laut Bauauftrag.
 */
describe("berlinDateTimeToUtc", () => {
  it("wandelt Datum+Uhrzeit in Berliner Sommerzeit korrekt nach UTC (08:00 CEST = 06:00 UTC)", () => {
    expect(berlinDateTimeToUtc("2026-08-10", "08:00").toISOString()).toBe("2026-08-10T06:00:00.000Z");
  });

  it("wandelt Datum+Uhrzeit in Berliner Winterzeit korrekt nach UTC (08:00 CET = 07:00 UTC)", () => {
    expect(berlinDateTimeToUtc("2026-01-15", "08:00").toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });
});

describe("toTimeInputValue", () => {
  it("liefert immer ein zweistelliges HH:MM, auch bei einstelliger Stunde/Minute", () => {
    // 2026-08-10T05:05:00Z = 07:05 Berlin (CEST)
    expect(toTimeInputValue(new Date("2026-08-10T05:05:00Z"))).toBe("07:05");
  });

  it("ist konsistent mit berlinDateTimeToUtc (Hin- und Rückweg)", () => {
    const utc = berlinDateTimeToUtc("2026-08-10", "08:00");
    expect(toTimeInputValue(utc)).toBe("08:00");
  });
});

describe("buildWeeklySeries", () => {
  it("liefert 4 Termine mit Berliner Wanduhrzeit 08:00–16:00, DST-Sprung am 25.10.2026 erzeugt eine UTC-Verschiebung zwischen den Terminen davor/danach", () => {
    const series = buildWeeklySeries("2026-10-12", "08:00", "16:00", 4);
    expect(series).toHaveLength(4);
    // Vor dem Umstellungstag (25.10.2026): CEST, UTC+2.
    expect(series[0].startsAt.toISOString()).toBe("2026-10-12T06:00:00.000Z");
    expect(series[0].endsAt.toISOString()).toBe("2026-10-12T14:00:00.000Z");
    expect(series[1].startsAt.toISOString()).toBe("2026-10-19T06:00:00.000Z");
    // Nach dem Umstellungstag: CET, UTC+1 — dieselbe Berliner Wanduhrzeit 08:00,
    // aber ein anderer UTC-Versatz als die Termine davor.
    expect(series[2].startsAt.toISOString()).toBe("2026-10-26T07:00:00.000Z");
    expect(series[2].endsAt.toISOString()).toBe("2026-10-26T15:00:00.000Z");
    expect(series[3].startsAt.toISOString()).toBe("2026-11-02T07:00:00.000Z");
  });

  it("Nachtschicht (endTime <= startTime) endet am Folgetag", () => {
    const series = buildWeeklySeries("2026-08-10", "22:00", "06:00", 1);
    expect(series).toHaveLength(1);
    // 2026-08-10 22:00 CEST = 2026-08-10T20:00Z; 2026-08-11 06:00 CEST = 2026-08-11T04:00Z
    expect(series[0].startsAt.toISOString()).toBe("2026-08-10T20:00:00.000Z");
    expect(series[0].endsAt.toISOString()).toBe("2026-08-11T04:00:00.000Z");
  });

  it("weeks=1 liefert genau 1 Termin", () => {
    expect(buildWeeklySeries("2026-08-10", "08:00", "16:00", 1)).toHaveLength(1);
  });
});
