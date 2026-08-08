import { describe, expect, it } from "vitest";
import {
  shiftPlanApplySchema,
  shiftPlanModelOutputSchema,
  shiftPlanOutputSchema,
  shiftPlanRequestSchema,
} from "./schema";

const validWorkerId = "11111111-1111-1111-1111-111111111111";
const validWorkerId2 = "22222222-2222-2222-2222-222222222222";
const validProjectId = "33333333-3333-3333-3333-333333333333";
const validRowId = "44444444-4444-4444-4444-444444444444";

describe("shiftPlanRequestSchema", () => {
  it("akzeptiert eine gültige Eingabe", () => {
    const result = shiftPlanRequestSchema.safeParse({
      projectId: validProjectId,
      fromDate: "2026-08-10",
      toDate: "2026-08-16",
      workerIds: [validWorkerId, validWorkerId2],
    });
    expect(result.success).toBe(true);
  });

  it("lehnt toDate vor fromDate ab", () => {
    const result = shiftPlanRequestSchema.safeParse({
      projectId: validProjectId,
      fromDate: "2026-08-16",
      toDate: "2026-08-10",
      workerIds: [validWorkerId],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["toDate"]);
    }
  });

  it("lehnt einen Zeitraum über 31 Tage ab", () => {
    const result = shiftPlanRequestSchema.safeParse({
      projectId: validProjectId,
      fromDate: "2026-08-01",
      toDate: "2026-09-02", // 32 Tage
      workerIds: [validWorkerId],
    });
    expect(result.success).toBe(false);
  });

  it("akzeptiert genau 31 Tage", () => {
    const result = shiftPlanRequestSchema.safeParse({
      projectId: validProjectId,
      fromDate: "2026-08-01",
      toDate: "2026-09-01", // 31 Tage
      workerIds: [validWorkerId],
    });
    expect(result.success).toBe(true);
  });

  it("lehnt 0 Arbeiter ab", () => {
    const result = shiftPlanRequestSchema.safeParse({
      projectId: validProjectId,
      fromDate: "2026-08-10",
      toDate: "2026-08-16",
      workerIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("lehnt 21 Arbeiter ab", () => {
    const result = shiftPlanRequestSchema.safeParse({
      projectId: validProjectId,
      fromDate: "2026-08-10",
      toDate: "2026-08-16",
      workerIds: Array.from({ length: 21 }, () => validWorkerId),
    });
    expect(result.success).toBe(false);
  });

  it("akzeptiert genau 20 Arbeiter", () => {
    const result = shiftPlanRequestSchema.safeParse({
      projectId: validProjectId,
      fromDate: "2026-08-10",
      toDate: "2026-08-16",
      workerIds: Array.from({ length: 20 }, () => validWorkerId),
    });
    expect(result.success).toBe(true);
  });

  it("lehnt eine Notiz über 500 Zeichen ab", () => {
    const result = shiftPlanRequestSchema.safeParse({
      projectId: validProjectId,
      fromDate: "2026-08-10",
      toDate: "2026-08-16",
      workerIds: [validWorkerId],
      note: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("akzeptiert eine fehlende Notiz (optional)", () => {
    const result = shiftPlanRequestSchema.safeParse({
      projectId: validProjectId,
      fromDate: "2026-08-10",
      toDate: "2026-08-16",
      workerIds: [validWorkerId],
    });
    expect(result.success).toBe(true);
  });

  it("lehnt ein ungültiges Projekt (keine UUID) ab", () => {
    const result = shiftPlanRequestSchema.safeParse({
      projectId: "kein-uuid",
      fromDate: "2026-08-10",
      toDate: "2026-08-16",
      workerIds: [validWorkerId],
    });
    expect(result.success).toBe(false);
  });
});

describe("shiftPlanModelOutputSchema", () => {
  const validShift = {
    worker: "A1",
    date: "2026-08-10",
    startTime: "08:00",
    endTime: "16:00",
    breakMinutes: 30,
  };

  it("akzeptiert eine gültige Antwort", () => {
    const result = shiftPlanModelOutputSchema.safeParse({ shifts: [validShift] });
    expect(result.success).toBe(true);
  });

  it("akzeptiert ein leeres shifts-Array", () => {
    const result = shiftPlanModelOutputSchema.safeParse({ shifts: [] });
    expect(result.success).toBe(true);
  });

  it("lehnt worker:'B1' ab (nur A-Präfix erlaubt)", () => {
    const result = shiftPlanModelOutputSchema.safeParse({ shifts: [{ ...validShift, worker: "B1" }] });
    expect(result.success).toBe(false);
  });

  it("lehnt startTime:'8:00' ab (fehlende führende Null)", () => {
    const result = shiftPlanModelOutputSchema.safeParse({ shifts: [{ ...validShift, startTime: "8:00" }] });
    expect(result.success).toBe(false);
  });

  it("lehnt date:'10.08.2026' ab (falsches Format)", () => {
    const result = shiftPlanModelOutputSchema.safeParse({ shifts: [{ ...validShift, date: "10.08.2026" }] });
    expect(result.success).toBe(false);
  });

  it("lehnt breakMinutes:500 ab (über 480)", () => {
    const result = shiftPlanModelOutputSchema.safeParse({ shifts: [{ ...validShift, breakMinutes: 500 }] });
    expect(result.success).toBe(false);
  });

  it("lehnt mehr als 200 Zeilen ab", () => {
    const result = shiftPlanModelOutputSchema.safeParse({
      shifts: Array.from({ length: 201 }, () => validShift),
    });
    expect(result.success).toBe(false);
  });

  it("akzeptiert eine optionale notes-Zusammenfassung", () => {
    const result = shiftPlanModelOutputSchema.safeParse({ shifts: [validShift], notes: "Kein Vorschlag für A3 möglich." });
    expect(result.success).toBe(true);
  });
});

describe("shiftPlanOutputSchema", () => {
  it("übersteht einen JSON-Round-Trip mit Entwurf", () => {
    const value = {
      draft: {
        rows: [
          {
            id: validRowId,
            workerId: validWorkerId,
            date: "2026-08-10",
            startTime: "08:00",
            endTime: "16:00",
            breakMinutes: 30,
            conflict: null,
          },
        ],
        notes: "Alles passt.",
      },
      appliedRowIds: [],
    };
    const roundTripped = JSON.parse(JSON.stringify(value));
    const result = shiftPlanOutputSchema.safeParse(roundTripped);
    expect(result.success).toBe(true);
  });

  it("liefert appliedRowIds:[] als Standard, wenn nicht gesetzt", () => {
    const result = shiftPlanOutputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.appliedRowIds).toEqual([]);
    }
  });

  it("akzeptiert eine Konfliktzeile mit gesetztem conflict-Wert", () => {
    const result = shiftPlanOutputSchema.safeParse({
      draft: {
        rows: [
          {
            id: validRowId,
            workerId: validWorkerId,
            date: "2026-08-10",
            startTime: "08:00",
            endTime: "16:00",
            breakMinutes: 0,
            conflict: "overlap",
          },
        ],
      },
      appliedRowIds: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("shiftPlanApplySchema", () => {
  const validRow = { id: validRowId, date: "2026-08-10", startTime: "08:00", endTime: "16:00", breakMinutes: 30 };

  it("akzeptiert eine gültige Zeilenliste", () => {
    const result = shiftPlanApplySchema.safeParse([validRow]);
    expect(result.success).toBe(true);
  });

  it("streift unbekannte Zusatzfelder ab (z. B. ein untergeschobenes workerId)", () => {
    const result = shiftPlanApplySchema.safeParse([{ ...validRow, workerId: validWorkerId }]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]).not.toHaveProperty("workerId");
    }
  });

  it("lehnt ein leeres Array ab", () => {
    const result = shiftPlanApplySchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("erzwingt breakMinutes als Zahl (coerce von String)", () => {
    const result = shiftPlanApplySchema.safeParse([{ ...validRow, breakMinutes: "30" }]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].breakMinutes).toBe(30);
    }
  });
});
