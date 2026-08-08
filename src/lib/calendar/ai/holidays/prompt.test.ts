import { describe, expect, it } from "vitest";
import { buildHolidays } from "@/lib/calendar/holidays";
import type { CalendarHolidayRegionCode } from "@/lib/calendar/schema";
import {
  buildHolidayResearchPrompt,
  crossCheckHolidays,
  detectHolidayConflicts,
  mapHolidayDraftRows,
  type HolidayCheckedRow,
  type HolidayMappedRow,
} from "./prompt";
import type { HolidayModelHoliday } from "./schema";

describe("buildHolidayResearchPrompt", () => {
  const context = { year: 2027, regions: ["DE", "BA_RS"] as CalendarHolidayRegionCode[] };

  it("enthält beide Klarnamen und die Jahreszahl", () => {
    const { system, user } = buildHolidayResearchPrompt(context);
    expect(system).toContain("Deutschland");
    expect(system).toContain("Republika Srpska");
    expect(system + user).toContain("2027");
  });

  it("enthält KEINEN Mandantennamen, keine E-Mail, keine UUID (Datenminimierungs-Nachweis)", () => {
    const { system, user } = buildHolidayResearchPrompt(context);
    const combined = system + user;
    expect(combined).not.toMatch(/@/);
    expect(combined).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("unterscheidet RS und BA_RS explizit im Text", () => {
    const { system } = buildHolidayResearchPrompt(context);
    expect(system).toMatch(/"RS".*Serbien/);
    expect(system).toContain("BA_RS");
    expect(system).toContain("Republika Srpska");
    expect(system).toMatch(/NICHT identisch mit Serbien/);
  });

  it("verlangt ausschließlich JSON als Antwortformat", () => {
    const { system } = buildHolidayResearchPrompt(context);
    expect(system).toMatch(/AUSSCHLIESSLICH mit einem einzigen gültigen JSON-Objekt/);
  });

  it("enthält kein Freitextfeld/keine UNTRUSTED_DATA_INSTRUCTION-Marker (Angriffsfläche entfernt statt gemindert)", () => {
    const { system, user } = buildHolidayResearchPrompt(context);
    expect(system).not.toContain("===BEGIN KONTEXT===");
    expect(user).not.toContain("===BEGIN KONTEXT===");
  });
});

describe("mapHolidayDraftRows", () => {
  it("löst eine angeforderte Region korrekt auf", () => {
    const modelHolidays: HolidayModelHoliday[] = [{ region: "DE", date: "2027-01-01", name: "Neujahr" }];
    const { rows, unresolvedNotes } = mapHolidayDraftRows(modelHolidays, ["DE", "AT"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].region).toBe("DE");
    expect(unresolvedNotes).toHaveLength(0);
  });

  it("verwirft eine nicht angeforderte Region und schreibt einen Hinweis, statt den ganzen Lauf zu verwerfen", () => {
    const modelHolidays: HolidayModelHoliday[] = [
      { region: "DE", date: "2027-01-01", name: "Neujahr" },
      { region: "CH", date: "2027-01-01", name: "Neujahr" },
    ];
    const { rows, unresolvedNotes } = mapHolidayDraftRows(modelHolidays, ["DE"]);
    expect(rows).toHaveLength(1);
    expect(unresolvedNotes).toHaveLength(1);
    expect(unresolvedNotes[0]).toContain("CH");
  });

  it("vergibt jeder Zeile eine eigene id", () => {
    const modelHolidays: HolidayModelHoliday[] = [
      { region: "DE", date: "2027-01-01", name: "Neujahr" },
      { region: "DE", date: "2027-12-25", name: "1. Weihnachtsfeiertag" },
    ];
    const { rows } = mapHolidayDraftRows(modelHolidays, ["DE"]);
    expect(rows[0].id).not.toBe(rows[1].id);
  });
});

describe("crossCheckHolidays", () => {
  it("setzt confirmed für ein von buildHolidays() bestätigtes Datum, unverified für ein DE-Datum außerhalb der Liste, null für eine Region ohne Referenz", () => {
    const rows: HolidayMappedRow[] = [
      { id: "r1", region: "DE", date: "2026-01-01", name: "Neujahr" },
      { id: "r2", region: "DE", date: "2026-07-04", name: "Erfundener Tag" },
      { id: "r3", region: "HR", date: "2026-01-01", name: "Neujahr" },
    ];
    const { rows: checked } = crossCheckHolidays(rows, 2026);
    expect(checked.find((r) => r.id === "r1")?.check).toBe("confirmed");
    expect(checked.find((r) => r.id === "r2")?.check).toBe("unverified");
    expect(checked.find((r) => r.id === "r3")?.check).toBeNull();
  });

  it("meldet einen von buildHolidays() bekannten, aber vom Modell ausgelassenen Tag als Hinweis", () => {
    const allDeHolidays = buildHolidays("DE", 2026);
    const withoutUnityDay = allDeHolidays.filter((h) => h.date !== "2026-10-03");
    const rows: HolidayMappedRow[] = withoutUnityDay.map((h, i) => ({
      id: `r${i}`,
      region: "DE",
      date: h.date,
      name: h.name,
    }));
    const { missingNotes } = crossCheckHolidays(rows, 2026);
    expect(missingNotes.length).toBeGreaterThan(0);
    const combined = missingNotes.join(" ");
    expect(combined).toContain("03.10.");
    expect(combined).toContain("Tag der Deutschen Einheit");
  });

  it("meldet keine Lücke, wenn eine Region gar nicht in den Zeilen vertreten ist", () => {
    const rows: HolidayMappedRow[] = [{ id: "r1", region: "HR", date: "2026-01-01", name: "Neujahr" }];
    const { missingNotes } = crossCheckHolidays(rows, 2026);
    expect(missingNotes).toHaveLength(0);
  });
});

describe("detectHolidayConflicts", () => {
  const asChecked = (rows: HolidayMappedRow[]): HolidayCheckedRow[] => rows.map((r) => ({ ...r, check: null }));

  it("markiert die zweite von zwei Zeilen mit identischem Datum als duplicate", () => {
    const rows = asChecked([
      { id: "r1", region: "DE", date: "2027-01-01", name: "Neujahr" },
      { id: "r2", region: "AT", date: "2027-01-01", name: "Neujahr" },
    ]);
    const result = detectHolidayConflicts(rows, { year: 2027, existingHolidays: [] });
    expect(result[0].conflict).toBeNull();
    expect(result[1].conflict).toBe("duplicate");
  });

  it("markiert eine Zeile mit einem Datum aus dem Vorjahr als outside-year", () => {
    const rows = asChecked([{ id: "r1", region: "DE", date: "2026-12-31", name: "Silvester" }]);
    const result = detectHolidayConflicts(rows, { year: 2027, existingHolidays: [] });
    expect(result[0].conflict).toBe("outside-year");
  });

  it("markiert eine Zeile als existing, wenn das Datum in der übergebenen Bestandsliste steht", () => {
    const rows = asChecked([{ id: "r1", region: "DE", date: "2027-01-01", name: "Neujahr" }]);
    const result = detectHolidayConflicts(rows, {
      year: 2027,
      existingHolidays: [{ date: "2027-01-01" }],
    });
    expect(result[0].conflict).toBe("existing");
  });

  it("liefert conflict:null für eine konfliktfreie Zeile", () => {
    const rows = asChecked([{ id: "r1", region: "DE", date: "2027-05-01", name: "Tag der Arbeit" }]);
    const result = detectHolidayConflicts(rows, { year: 2027, existingHolidays: [] });
    expect(result[0].conflict).toBeNull();
  });
});
