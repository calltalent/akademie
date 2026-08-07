import { describe, expect, it } from "vitest";
import { buildHolidays, easterSunday } from "./holidays";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toIso(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Block S2 (08.08.2026) — Pflicht-Testfälle laut Bauauftrag. Ostersonntag
 * 2026 selbst per Meeus/Jones/Butcher-Verfahren verifiziert (05.04.2026,
 * siehe Kopfkommentar von holidays.ts für die Handrechnung).
 */
describe("easterSunday", () => {
  it("Ostersonntag 2026 ist der 05.04.2026", () => {
    expect(toIso(easterSunday(2026))).toBe("2026-04-05");
  });
});

describe("buildHolidays — Feiertage relativ zu Ostern 2026", () => {
  it("Karfreitag ist 03.04.2026 (Ostern - 2 Tage)", () => {
    const de = buildHolidays("DE", 2026);
    expect(de.find((h) => h.name === "Karfreitag")?.date).toBe("2026-04-03");
  });

  it("Ostermontag ist 06.04.2026 (Ostern + 1 Tag)", () => {
    const de = buildHolidays("DE", 2026);
    expect(de.find((h) => h.name === "Ostermontag")?.date).toBe("2026-04-06");
  });

  it("Christi Himmelfahrt ist 14.05.2026 (Ostern + 39 Tage)", () => {
    const de = buildHolidays("DE", 2026);
    expect(de.find((h) => h.name === "Christi Himmelfahrt")?.date).toBe("2026-05-14");
  });

  it("Pfingstmontag ist 25.05.2026 (Ostern + 50 Tage)", () => {
    const de = buildHolidays("DE", 2026);
    expect(de.find((h) => h.name === "Pfingstmontag")?.date).toBe("2026-05-25");
  });
});

describe("buildHolidays — Anzahl je Land (bundeseinheitlich, keine Bundesland-/Kantonslogik)", () => {
  it("DE liefert 9 Einträge, inklusive 03.10. (Tag der Deutschen Einheit)", () => {
    const de = buildHolidays("DE", 2026);
    expect(de).toHaveLength(9);
    expect(de.some((h) => h.date === "2026-10-03")).toBe(true);
  });

  it("AT liefert 13 Einträge, inklusive 26.10. (Nationalfeiertag), OHNE 03.10.", () => {
    const at = buildHolidays("AT", 2026);
    expect(at).toHaveLength(13);
    expect(at.some((h) => h.date === "2026-10-26")).toBe(true);
    expect(at.some((h) => h.date === "2026-10-03")).toBe(false);
  });

  it("CH liefert 7 Einträge, inklusive 01.08. (Nationalfeiertag), OHNE 26.12.", () => {
    const ch = buildHolidays("CH", 2026);
    expect(ch).toHaveLength(7);
    expect(ch.some((h) => h.date === "2026-08-01")).toBe(true);
    expect(ch.some((h) => h.date === "2026-12-26")).toBe(false);
  });
});

describe("buildHolidays — Reinheit/Format", () => {
  it("zwei Aufrufe mit gleichem Argument liefern identische Listen", () => {
    expect(buildHolidays("DE", 2026)).toEqual(buildHolidays("DE", 2026));
    expect(buildHolidays("AT", 2027)).toEqual(buildHolidays("AT", 2027));
  });

  it("alle Daten passen auf yyyy-mm-dd", () => {
    for (const country of ["DE", "AT", "CH"] as const) {
      for (const holiday of buildHolidays(country, 2026)) {
        expect(holiday.date).toMatch(ISO_DATE_RE);
      }
    }
  });
});
