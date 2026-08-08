import { describe, expect, it } from "vitest";
import { CALENDAR_HOLIDAY_REGIONS } from "@/lib/calendar/schema";
import { holidayApplySchema, holidayResearchOutputSchema, holidayResearchRequestSchema } from "./schema";

const validRowId = "44444444-4444-4444-4444-444444444444";

describe("holidayResearchRequestSchema", () => {
  it("akzeptiert alle acht Regionscodes", () => {
    const result = holidayResearchRequestSchema.safeParse({
      year: 2027,
      regions: [...CALENDAR_HOLIDAY_REGIONS],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.regions).toHaveLength(8);
    }
  });

  it('lehnt "FR" ab (kein gültiger Regionscode)', () => {
    const result = holidayResearchRequestSchema.safeParse({ year: 2027, regions: ["FR"] });
    expect(result.success).toBe(false);
  });

  it('lehnt "BRCKO" ab (Präfix fehlt — Kollisionsfreiheit des Schemas)', () => {
    const result = holidayResearchRequestSchema.safeParse({ year: 2027, regions: ["BRCKO"] });
    expect(result.success).toBe(false);
  });

  it('lehnt "FBIH" ab (Präfix fehlt — Kollisionsfreiheit des Schemas)', () => {
    const result = holidayResearchRequestSchema.safeParse({ year: 2027, regions: ["FBIH"] });
    expect(result.success).toBe(false);
  });

  it("lehnt das Jahr 2019 ab (unterhalb der Grenze)", () => {
    const result = holidayResearchRequestSchema.safeParse({ year: 2019, regions: ["DE"] });
    expect(result.success).toBe(false);
  });

  it("lehnt das Jahr 2101 ab (oberhalb der Grenze)", () => {
    const result = holidayResearchRequestSchema.safeParse({ year: 2101, regions: ["DE"] });
    expect(result.success).toBe(false);
  });

  it("akzeptiert das Jahr 2020 (untere Grenze)", () => {
    const result = holidayResearchRequestSchema.safeParse({ year: 2020, regions: ["DE"] });
    expect(result.success).toBe(true);
  });

  it("akzeptiert das Jahr 2100 (obere Grenze)", () => {
    const result = holidayResearchRequestSchema.safeParse({ year: 2100, regions: ["DE"] });
    expect(result.success).toBe(true);
  });

  it("lehnt ein leeres regions-Array ab", () => {
    const result = holidayResearchRequestSchema.safeParse({ year: 2027, regions: [] });
    expect(result.success).toBe(false);
  });

  it("lehnt mehr als acht Regionen ab", () => {
    const result = holidayResearchRequestSchema.safeParse({
      year: 2027,
      regions: [...CALENDAR_HOLIDAY_REGIONS, "DE"],
    });
    expect(result.success).toBe(false);
  });
});

describe("holidayApplySchema", () => {
  it("akzeptiert eine gültige Zeilenliste", () => {
    const result = holidayApplySchema.safeParse([{ id: validRowId, date: "2027-01-01", name: "Neujahr" }]);
    expect(result.success).toBe(true);
  });

  it("lehnt eine Zeile ohne id ab", () => {
    const result = holidayApplySchema.safeParse([{ date: "2027-01-01", name: "Neujahr" }]);
    expect(result.success).toBe(false);
  });

  it("begrenzt name auf 120 Zeichen", () => {
    const result = holidayApplySchema.safeParse([{ id: validRowId, date: "2027-01-01", name: "a".repeat(121) }]);
    expect(result.success).toBe(false);
  });

  it("akzeptiert name mit genau 120 Zeichen", () => {
    const result = holidayApplySchema.safeParse([{ id: validRowId, date: "2027-01-01", name: "a".repeat(120) }]);
    expect(result.success).toBe(true);
  });

  it("lehnt ein leeres Array ab", () => {
    const result = holidayApplySchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("streift unbekannte Zusatzfelder ab (z. B. ein untergeschobenes region)", () => {
    const result = holidayApplySchema.safeParse([
      { id: validRowId, date: "2027-01-01", name: "Neujahr", region: "DE" },
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]).not.toHaveProperty("region");
    }
  });
});

describe("holidayResearchOutputSchema", () => {
  it("nimmt einen vollständigen Entwurf an", () => {
    const result = holidayResearchOutputSchema.safeParse({
      draft: {
        rows: [
          {
            id: validRowId,
            region: "DE",
            date: "2027-01-01",
            name: "Neujahr",
            check: "confirmed",
            conflict: null,
          },
        ],
        notes: "Alles passt.",
      },
      appliedRowIds: [],
    });
    expect(result.success).toBe(true);
  });

  it("übersteht einen JSON-Round-Trip mit Entwurf", () => {
    const value = {
      draft: {
        rows: [
          { id: validRowId, region: "BA_RS", date: "2027-01-07", name: "Božić", check: null, conflict: "duplicate" },
        ],
      },
      appliedRowIds: [],
    };
    const roundTripped = JSON.parse(JSON.stringify(value));
    const result = holidayResearchOutputSchema.safeParse(roundTripped);
    expect(result.success).toBe(true);
  });

  it("liefert appliedRowIds:[] als Standard, wenn nicht gesetzt", () => {
    const result = holidayResearchOutputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.appliedRowIds).toEqual([]);
    }
  });

  it("wirft bei einem unbekannten conflict-Wert", () => {
    const result = holidayResearchOutputSchema.safeParse({
      draft: {
        rows: [
          {
            id: validRowId,
            region: "DE",
            date: "2027-01-01",
            name: "Neujahr",
            check: null,
            conflict: "unknown-conflict",
          },
        ],
      },
      appliedRowIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("wirft bei einem unbekannten check-Wert", () => {
    const result = holidayResearchOutputSchema.safeParse({
      draft: {
        rows: [{ id: validRowId, region: "DE", date: "2027-01-01", name: "Neujahr", check: "maybe", conflict: null }],
      },
      appliedRowIds: [],
    });
    expect(result.success).toBe(false);
  });
});
