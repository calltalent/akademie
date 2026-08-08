import { describe, expect, it } from "vitest";
import {
  buildShiftPlanPrompt,
  detectConflicts,
  mapDraftRows,
  type ShiftPlanPromptContext,
} from "./prompt";
import type { ShiftPlanModelShift } from "./schema";

const workerId1 = "11111111-1111-1111-1111-111111111111";
const workerId2 = "22222222-2222-2222-2222-222222222222";

const baseContext: ShiftPlanPromptContext = {
  projectName: "Projekt Nordwest",
  fromDate: "2026-08-10",
  toDate: "2026-08-16",
  note: "Bitte auf Frühschichten achten.",
  workers: [
    { pseudonym: "A1", workerType: "employee", targetHours: 40, targetPeriod: "week", preferredShift: "early", preferredWeekdays: [0, 1, 2] },
    { pseudonym: "A2", workerType: "freelancer", targetHours: null, targetPeriod: "week", preferredShift: "any", preferredWeekdays: [] },
  ],
  absences: [{ pseudonym: "A1", kind: "vacation", startsOn: "2026-08-12", endsOn: "2026-08-12" }],
  existingShifts: [{ pseudonym: "A2", date: "2026-08-11", startTime: "08:00", endTime: "16:00" }],
  openSlots: [{ date: "2026-08-13", startTime: "08:00", endTime: "16:00", capacity: 2 }],
};

describe("buildShiftPlanPrompt", () => {
  it("enthält KEINE echten Arbeiter-UUIDs (Datenminimierung)", () => {
    const { system, user } = buildShiftPlanPrompt(baseContext);
    expect(system).not.toContain(workerId1);
    expect(user).not.toContain(workerId1);
    expect(system).not.toContain(workerId2);
    expect(user).not.toContain(workerId2);
  });

  it("enthält KEINE Namen oder E-Mail-Adressen (der Kontext-Typ trägt keine — Regressionsnetz gegen ein versehentliches Feld)", () => {
    const { user } = buildShiftPlanPrompt(baseContext);
    expect(user).not.toContain("@");
    expect(user).not.toContain("Max Mustermann");
  });

  it("enthält die Arbeiter-Pseudonyme A1/A2", () => {
    const { user } = buildShiftPlanPrompt(baseContext);
    expect(user).toContain("A1");
    expect(user).toContain("A2");
  });

  it("enthält beide Marker ===BEGIN KONTEXT=== / ===END KONTEXT===", () => {
    const { user } = buildShiftPlanPrompt(baseContext);
    expect(user).toContain("===BEGIN KONTEXT===");
    expect(user).toContain("===END KONTEXT===");
  });

  it("enthält die drei ArbZG-Regeln (§3, §4, §5)", () => {
    const { system } = buildShiftPlanPrompt(baseContext);
    expect(system).toContain("§3 ArbZG");
    expect(system).toContain("§4 ArbZG");
    expect(system).toContain("§5 ArbZG");
  });

  it("enthält die Zeitraumgrenzen korrekt", () => {
    const { user } = buildShiftPlanPrompt(baseContext);
    expect(user).toContain("2026-08-10");
    expect(user).toContain("2026-08-16");
  });

  it("enthält die Notiz als Datenmaterial innerhalb der Marker", () => {
    const { user } = buildShiftPlanPrompt(baseContext);
    expect(user).toContain("Bitte auf Frühschichten achten.");
  });

  it("verlangt ausschließlich JSON als Antwortformat", () => {
    const { system } = buildShiftPlanPrompt(baseContext);
    expect(system).toMatch(/AUSSCHLIESSLICH mit einem einzigen gültigen JSON-Objekt/);
  });
});

describe("mapDraftRows", () => {
  const mappings = [
    { pseudonym: "A1", workerId: workerId1 },
    { pseudonym: "A2", workerId: workerId2 },
  ];

  it("löst die Kennung korrekt in die echte Arbeiter-UUID auf", () => {
    const shifts: ShiftPlanModelShift[] = [
      { worker: "A1", date: "2026-08-10", startTime: "08:00", endTime: "16:00", breakMinutes: 30 },
    ];
    const { rows, unresolvedNotes } = mapDraftRows(shifts, mappings);
    expect(rows).toHaveLength(1);
    expect(rows[0].workerId).toBe(workerId1);
    expect(unresolvedNotes).toHaveLength(0);
  });

  it("verwirft eine unbekannte Kennung und zählt sie in unresolvedNotes", () => {
    const shifts: ShiftPlanModelShift[] = [
      { worker: "A9", date: "2026-08-10", startTime: "08:00", endTime: "16:00", breakMinutes: 0 },
    ];
    const { rows, unresolvedNotes } = mapDraftRows(shifts, mappings);
    expect(rows).toHaveLength(0);
    expect(unresolvedNotes).toHaveLength(1);
    expect(unresolvedNotes[0]).toContain("A9");
  });

  it("vergibt jeder Zeile eine eigene id", () => {
    const shifts: ShiftPlanModelShift[] = [
      { worker: "A1", date: "2026-08-10", startTime: "08:00", endTime: "16:00", breakMinutes: 0 },
      { worker: "A1", date: "2026-08-11", startTime: "08:00", endTime: "16:00", breakMinutes: 0 },
    ];
    const { rows } = mapDraftRows(shifts, mappings);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it("verarbeitet eine gemischte Liste (gültig + ungültig) korrekt", () => {
    const shifts: ShiftPlanModelShift[] = [
      { worker: "A1", date: "2026-08-10", startTime: "08:00", endTime: "16:00", breakMinutes: 0 },
      { worker: "A2", date: "2026-08-11", startTime: "08:00", endTime: "16:00", breakMinutes: 0 },
      { worker: "A9", date: "2026-08-12", startTime: "08:00", endTime: "16:00", breakMinutes: 0 },
    ];
    const { rows, unresolvedNotes } = mapDraftRows(shifts, mappings);
    expect(rows).toHaveLength(2);
    expect(unresolvedNotes).toHaveLength(1);
  });
});

describe("detectConflicts", () => {
  const emptyContext = { fromDate: "2026-08-10", toDate: "2026-08-16", absences: [], existingShifts: [] };

  it("markiert eine Zeile außerhalb des Zeitraums als outside-period", () => {
    const rows = [{ id: "r1", workerId: workerId1, date: "2026-08-20", startTime: "08:00", endTime: "16:00", breakMinutes: 0 }];
    const result = detectConflicts(rows, emptyContext);
    expect(result[0].conflict).toBe("outside-period");
  });

  it("markiert eine Zeile an einem Abwesenheitstag als absence", () => {
    const rows = [{ id: "r1", workerId: workerId1, date: "2026-08-12", startTime: "08:00", endTime: "16:00", breakMinutes: 0 }];
    const result = detectConflicts(rows, {
      ...emptyContext,
      absences: [{ workerId: workerId1, startsOn: "2026-08-12", endsOn: "2026-08-12" }],
    });
    expect(result[0].conflict).toBe("absence");
  });

  it("markiert eine Zeile an einem mandantenweiten Feiertag (workerId null) als absence", () => {
    const rows = [{ id: "r1", workerId: workerId1, date: "2026-08-12", startTime: "08:00", endTime: "16:00", breakMinutes: 0 }];
    const result = detectConflicts(rows, {
      ...emptyContext,
      absences: [{ workerId: null, startsOn: "2026-08-12", endsOn: "2026-08-12" }],
    });
    expect(result[0].conflict).toBe("absence");
  });

  it("markiert eine Überschneidung mit einer bestehenden Schicht als overlap", () => {
    const rows = [{ id: "r1", workerId: workerId1, date: "2026-08-10", startTime: "09:00", endTime: "17:00", breakMinutes: 0 }];
    const result = detectConflicts(rows, {
      ...emptyContext,
      existingShifts: [
        { workerId: workerId1, startsAt: new Date("2026-08-10T06:00:00Z"), endsAt: new Date("2026-08-10T20:00:00Z") },
      ],
    });
    expect(result[0].conflict).toBe("overlap");
  });

  it("markiert zwei sich überschneidende Vorschlagszeilen desselben Arbeiters als duplicate", () => {
    const rows = [
      { id: "r1", workerId: workerId1, date: "2026-08-10", startTime: "08:00", endTime: "16:00", breakMinutes: 0 },
      { id: "r2", workerId: workerId1, date: "2026-08-10", startTime: "12:00", endTime: "20:00", breakMinutes: 0 },
    ];
    const result = detectConflicts(rows, emptyContext);
    expect(result[0].conflict).toBe("duplicate");
    expect(result[1].conflict).toBe("duplicate");
  });

  it("liefert conflict:null für einen sauberen Vorschlag", () => {
    const rows = [{ id: "r1", workerId: workerId1, date: "2026-08-10", startTime: "08:00", endTime: "16:00", breakMinutes: 0 }];
    const result = detectConflicts(rows, emptyContext);
    expect(result[0].conflict).toBeNull();
  });

  it("markiert ANGRENZENDE Schichten (08:00-16:00 und 16:00-22:00) NICHT als Konflikt", () => {
    const rows = [
      { id: "r1", workerId: workerId1, date: "2026-08-10", startTime: "08:00", endTime: "16:00", breakMinutes: 0 },
      { id: "r2", workerId: workerId1, date: "2026-08-10", startTime: "16:00", endTime: "22:00", breakMinutes: 0 },
    ];
    const result = detectConflicts(rows, emptyContext);
    expect(result[0].conflict).toBeNull();
    expect(result[1].conflict).toBeNull();
  });

  it("verwendet unterschiedliche Arbeiter für sich überschneidende Vorschlagszeilen NICHT als duplicate", () => {
    const rows = [
      { id: "r1", workerId: workerId1, date: "2026-08-10", startTime: "08:00", endTime: "16:00", breakMinutes: 0 },
      { id: "r2", workerId: workerId2, date: "2026-08-10", startTime: "08:00", endTime: "16:00", breakMinutes: 0 },
    ];
    const result = detectConflicts(rows, emptyContext);
    expect(result[0].conflict).toBeNull();
    expect(result[1].conflict).toBeNull();
  });
});
