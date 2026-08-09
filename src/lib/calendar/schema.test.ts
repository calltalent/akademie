import { describe, expect, it } from "vitest";
import {
  calendarAbsenceSchema,
  calendarChangeDecisionSchema,
  calendarChangeRequestSchema,
  calendarClockInSchema,
  calendarDateSchema,
  calendarProjectMemberIdsSchema,
  calendarProjectSchema,
  calendarSelfBookingSchema,
  calendarShiftSchema,
  calendarSlotSchema,
  calendarTimeSchema,
  calendarWorkerCreateSchema,
  calendarWorkerEditableSchema,
  calendarWorkerStatusSchema,
  calendarWorkerTargetSchema,
  parseTenantHolidayRegions,
  tenantHolidayRegionsSchema,
} from "./schema";

describe("calendarWorkerEditableSchema", () => {
  it("akzeptiert minimale gültige Eingabe mit Standardwerten", () => {
    const parsed = calendarWorkerEditableSchema.safeParse({ workerType: "employee" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.targetPeriod).toBe("week");
      expect(parsed.data.preferredShift).toBe("any");
      expect(parsed.data.preferredWeekdays).toEqual([]);
    }
  });

  it("lehnt ungültigen worker_type ab", () => {
    expect(calendarWorkerEditableSchema.safeParse({ workerType: "contractor" }).success).toBe(false);
  });

  it("lehnt Sollstunden <= 0 ab", () => {
    expect(calendarWorkerEditableSchema.safeParse({ workerType: "employee", targetHours: 0 }).success).toBe(false);
  });

  it("lehnt Sollstunden > 400 ab", () => {
    expect(calendarWorkerEditableSchema.safeParse({ workerType: "employee", targetHours: 401 }).success).toBe(false);
  });

  it("akzeptiert Sollstunden im gültigen Bereich", () => {
    expect(calendarWorkerEditableSchema.safeParse({ workerType: "employee", targetHours: 40 }).success).toBe(true);
  });

  it("lehnt einen Wochentag außerhalb 0-6 ab", () => {
    expect(
      calendarWorkerEditableSchema.safeParse({ workerType: "employee", preferredWeekdays: [0, 7] }).success,
    ).toBe(false);
  });

  it("akzeptiert alle sieben Wochentage", () => {
    expect(
      calendarWorkerEditableSchema.safeParse({ workerType: "employee", preferredWeekdays: [0, 1, 2, 3, 4, 5, 6] })
        .success,
    ).toBe(true);
  });

  it("lehnt eine Notiz über 500 Zeichen ab", () => {
    expect(
      calendarWorkerEditableSchema.safeParse({ workerType: "employee", note: "x".repeat(501) }).success,
    ).toBe(false);
  });
});

describe("calendarWorkerCreateSchema", () => {
  it("verlangt eine gültige membershipId", () => {
    expect(calendarWorkerCreateSchema.safeParse({ workerType: "employee", membershipId: "nicht-uuid" }).success).toBe(
      false,
    );
  });

  it("akzeptiert gültige Eingabe", () => {
    expect(
      calendarWorkerCreateSchema.safeParse({
        workerType: "freelancer",
        membershipId: "00000000-0000-0000-0000-000000000001",
      }).success,
    ).toBe(true);
  });
});

describe("calendarWorkerStatusSchema", () => {
  it("akzeptiert 'active'/'inactive'", () => {
    expect(calendarWorkerStatusSchema.safeParse("active").success).toBe(true);
    expect(calendarWorkerStatusSchema.safeParse("inactive").success).toBe(true);
  });

  it("lehnt einen unbekannten Status ab", () => {
    expect(calendarWorkerStatusSchema.safeParse("on_leave").success).toBe(false);
  });
});

describe("calendarProjectSchema", () => {
  it("verlangt einen nicht-leeren Namen", () => {
    expect(calendarProjectSchema.safeParse({ name: "" }).success).toBe(false);
    expect(calendarProjectSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("akzeptiert einen gültigen Hex-Farbcode", () => {
    expect(calendarProjectSchema.safeParse({ name: "Projekt Nordwest", color: "#5663AE" }).success).toBe(true);
  });

  it("lehnt einen ungültigen Farbcode ab", () => {
    expect(calendarProjectSchema.safeParse({ name: "Projekt Nordwest", color: "blau" }).success).toBe(false);
    expect(calendarProjectSchema.safeParse({ name: "Projekt Nordwest", color: "#ZZZZZZ" }).success).toBe(false);
  });

  it("lehnt eine ungültige leadUserId ab", () => {
    expect(calendarProjectSchema.safeParse({ name: "Projekt Nordwest", leadUserId: "nicht-uuid" }).success).toBe(
      false,
    );
  });
});

describe("calendarProjectMemberIdsSchema", () => {
  it("akzeptiert eine leere Liste", () => {
    expect(calendarProjectMemberIdsSchema.safeParse([]).success).toBe(true);
  });

  it("lehnt eine Liste mit ungültiger UUID ab", () => {
    expect(calendarProjectMemberIdsSchema.safeParse(["nicht-uuid"]).success).toBe(false);
  });

  it("lehnt mehr als 500 Einträge ab", () => {
    const ids = Array.from({ length: 501 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    expect(calendarProjectMemberIdsSchema.safeParse(ids).success).toBe(false);
  });
});

describe("calendarClockInSchema", () => {
  it("akzeptiert leere Eingabe (kein Bezug zu einer geplanten Schicht)", () => {
    expect(calendarClockInSchema.safeParse({}).success).toBe(true);
  });

  it("lehnt eine ungültige shiftId ab", () => {
    expect(calendarClockInSchema.safeParse({ shiftId: "nicht-uuid" }).success).toBe(false);
  });
});

// =====================================================================
// Block S2 (08.08.2026)
// =====================================================================

describe("calendarDateSchema/calendarTimeSchema", () => {
  it("lehnt eine einstellige Uhrzeit ohne führende Null ab", () => {
    expect(calendarTimeSchema.safeParse("8:00").success).toBe(false);
  });

  it("akzeptiert eine zweistellige Uhrzeit", () => {
    expect(calendarTimeSchema.safeParse("08:00").success).toBe(true);
  });

  it("lehnt ein Datum mit einstelligem Monat ab", () => {
    expect(calendarDateSchema.safeParse("2026-8-10").success).toBe(false);
  });

  it("akzeptiert ein vollständiges yyyy-mm-dd-Datum", () => {
    expect(calendarDateSchema.safeParse("2026-08-10").success).toBe(true);
  });
});

const VALID_UUID = "00000000-0000-0000-0000-000000000001";

describe("calendarShiftSchema", () => {
  const base = { workerId: VALID_UUID, date: "2026-08-10", startTime: "08:00", endTime: "16:00" };

  it("akzeptiert eine gültige Minimaleingabe", () => {
    expect(calendarShiftSchema.safeParse(base).success).toBe(true);
  });

  it("lehnt gleiche Start- und Endzeit ab", () => {
    expect(calendarShiftSchema.safeParse({ ...base, endTime: "08:00" }).success).toBe(false);
  });

  it("lehnt breakMinutes über 480 ab", () => {
    expect(calendarShiftSchema.safeParse({ ...base, breakMinutes: 481 }).success).toBe(false);
  });

  it("akzeptiert breakMinutes am oberen Rand (480)", () => {
    expect(calendarShiftSchema.safeParse({ ...base, breakMinutes: 480 }).success).toBe(true);
  });
});

describe("calendarSlotSchema", () => {
  const base = { projectId: VALID_UUID, date: "2026-08-10", startTime: "08:00", endTime: "16:00", capacity: 5 };

  it("akzeptiert eine gültige Minimaleingabe mit Standard-repeatWeeks=1", () => {
    const parsed = calendarSlotSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.repeatWeeks).toBe(1);
  });

  it("lehnt capacity=0 ab", () => {
    expect(calendarSlotSchema.safeParse({ ...base, capacity: 0 }).success).toBe(false);
  });

  it("lehnt capacity=501 ab", () => {
    expect(calendarSlotSchema.safeParse({ ...base, capacity: 501 }).success).toBe(false);
  });

  it("akzeptiert capacity=500 (oberer Rand)", () => {
    expect(calendarSlotSchema.safeParse({ ...base, capacity: 500 }).success).toBe(true);
  });

  it("lehnt repeatWeeks=0 ab", () => {
    expect(calendarSlotSchema.safeParse({ ...base, repeatWeeks: 0 }).success).toBe(false);
  });

  it("lehnt repeatWeeks=27 ab", () => {
    expect(calendarSlotSchema.safeParse({ ...base, repeatWeeks: 27 }).success).toBe(false);
  });

  it("akzeptiert repeatWeeks=26 (oberer Rand)", () => {
    expect(calendarSlotSchema.safeParse({ ...base, repeatWeeks: 26 }).success).toBe(true);
  });
});

describe("calendarAbsenceSchema", () => {
  const base = { kind: "vacation" as const, startsOn: "2026-08-10", endsOn: "2026-08-14", workerId: VALID_UUID };

  it("akzeptiert eine gültige personenbezogene Abwesenheit", () => {
    expect(calendarAbsenceSchema.safeParse(base).success).toBe(true);
  });

  it("akzeptiert einen gültigen Feiertag ohne workerId", () => {
    expect(
      calendarAbsenceSchema.safeParse({ kind: "holiday", startsOn: "2026-10-03", endsOn: "2026-10-03" }).success,
    ).toBe(true);
  });

  it("lehnt kind='holiday' MIT workerId ab", () => {
    expect(calendarAbsenceSchema.safeParse({ ...base, kind: "holiday" }).success).toBe(false);
  });

  it("lehnt kind='sick' OHNE workerId ab", () => {
    expect(
      calendarAbsenceSchema.safeParse({ kind: "sick", startsOn: base.startsOn, endsOn: base.endsOn }).success,
    ).toBe(false);
  });

  it("lehnt ein Enddatum vor dem Startdatum ab", () => {
    expect(calendarAbsenceSchema.safeParse({ ...base, startsOn: "2026-08-14", endsOn: "2026-08-10" }).success).toBe(
      false,
    );
  });

  it("akzeptiert gleiches Start- und Enddatum (ein Tag Abwesenheit)", () => {
    expect(calendarAbsenceSchema.safeParse({ ...base, startsOn: "2026-08-10", endsOn: "2026-08-10" }).success).toBe(
      true,
    );
  });
});

describe("tenantHolidayRegionsSchema / parseTenantHolidayRegions (Block S5a)", () => {
  it("akzeptiert alle acht gültigen Regionscodes", () => {
    const all = ["DE", "AT", "CH", "HR", "RS", "BA_FBIH", "BA_RS", "BA_BRCKO"];
    expect(tenantHolidayRegionsSchema.safeParse(all).success).toBe(true);
    expect(parseTenantHolidayRegions(all)).toEqual(all);
  });

  it("entfernt Duplikate", () => {
    expect(parseTenantHolidayRegions(["DE", "DE", "AT"])).toEqual(["DE", "AT"]);
  });

  it("erlaubt ein leeres Array (keine Region gewählt)", () => {
    expect(parseTenantHolidayRegions([]).length).toBe(0);
    expect(tenantHolidayRegionsSchema.safeParse([]).success).toBe(true);
  });

  it("behandelt Eingaben, die kein Array sind, wie eine leere Auswahl", () => {
    expect(parseTenantHolidayRegions(undefined)).toEqual([]);
    expect(parseTenantHolidayRegions(null)).toEqual([]);
  });

  it("lehnt einen unbekannten Code ab (RS bleibt Serbien, kollidiert nicht mit BA_RS)", () => {
    expect(tenantHolidayRegionsSchema.safeParse(["FR"]).success).toBe(false);
    expect(tenantHolidayRegionsSchema.safeParse(["BRCKO"]).success).toBe(false);
    expect(tenantHolidayRegionsSchema.safeParse(["FBIH"]).success).toBe(false);
    expect(() => parseTenantHolidayRegions(["DE", "FR"])).toThrow();
  });
});

describe("calendarSelfBookingSchema", () => {
  it("verlangt eine gültige slotId", () => {
    expect(calendarSelfBookingSchema.safeParse({ slotId: "nicht-uuid" }).success).toBe(false);
    expect(calendarSelfBookingSchema.safeParse({ slotId: VALID_UUID }).success).toBe(true);
  });

  // Block S6 (09.08.2026) — optionale startTime/endTime (Teil-Buchung per Drag).
  it("akzeptiert weiterhin nur slotId (Altverhalten, ganzer Slot)", () => {
    expect(calendarSelfBookingSchema.safeParse({ slotId: VALID_UUID }).success).toBe(true);
  });

  it("akzeptiert slotId mit beiden Zeitfeldern", () => {
    expect(
      calendarSelfBookingSchema.safeParse({ slotId: VALID_UUID, startTime: "08:00", endTime: "10:00" }).success,
    ).toBe(true);
  });

  it("lehnt nur EIN gesetztes Zeitfeld ab (beide oder keins)", () => {
    expect(calendarSelfBookingSchema.safeParse({ slotId: VALID_UUID, startTime: "08:00" }).success).toBe(false);
    expect(calendarSelfBookingSchema.safeParse({ slotId: VALID_UUID, endTime: "10:00" }).success).toBe(false);
  });

  it("lehnt gleiche Start- und Endzeit ab", () => {
    expect(
      calendarSelfBookingSchema.safeParse({ slotId: VALID_UUID, startTime: "08:00", endTime: "08:00" }).success,
    ).toBe(false);
  });

  it("lehnt eine ungültig formatierte Uhrzeit ab", () => {
    expect(
      calendarSelfBookingSchema.safeParse({ slotId: VALID_UUID, startTime: "8:00", endTime: "10:00" }).success,
    ).toBe(false);
  });
});

describe("calendarWorkerTargetSchema", () => {
  it("verlangt targetPeriod (kein Default anders als calendarWorkerEditableSchema)", () => {
    expect(calendarWorkerTargetSchema.safeParse({}).success).toBe(false);
  });

  it("akzeptiert gültige Sollstunden mit Zeitraum", () => {
    expect(calendarWorkerTargetSchema.safeParse({ targetHours: 20, targetPeriod: "month" }).success).toBe(true);
  });

  it("lehnt Sollstunden über 400 ab", () => {
    expect(calendarWorkerTargetSchema.safeParse({ targetHours: 401, targetPeriod: "week" }).success).toBe(false);
  });
});

// =====================================================================
// Block S3 (09.08.2026) — Änderungsanfragen
// =====================================================================

describe("calendarChangeRequestSchema", () => {
  it("akzeptiert kind='cancel' ohne Zeitfelder", () => {
    expect(calendarChangeRequestSchema.safeParse({ kind: "cancel", shiftId: VALID_UUID }).success).toBe(true);
  });

  it("akzeptiert kind='cancel' mit Begründung", () => {
    expect(
      calendarChangeRequestSchema.safeParse({ kind: "cancel", shiftId: VALID_UUID, reason: "Krank." }).success,
    ).toBe(true);
  });

  it("lehnt kind='update' OHNE date/startTime/endTime ab", () => {
    expect(calendarChangeRequestSchema.safeParse({ kind: "update", shiftId: VALID_UUID }).success).toBe(false);
  });

  it("akzeptiert kind='update' mit vollständigen Zeitfeldern", () => {
    expect(
      calendarChangeRequestSchema.safeParse({
        kind: "update",
        shiftId: VALID_UUID,
        date: "2026-08-10",
        startTime: "08:00",
        endTime: "16:00",
      }).success,
    ).toBe(true);
  });

  it("lehnt startTime === endTime bei kind='update' ab", () => {
    expect(
      calendarChangeRequestSchema.safeParse({
        kind: "update",
        shiftId: VALID_UUID,
        date: "2026-08-10",
        startTime: "08:00",
        endTime: "08:00",
      }).success,
    ).toBe(false);
  });

  it("akzeptiert breakMinutes 0 und 480 bei kind='update'", () => {
    const base = { kind: "update" as const, shiftId: VALID_UUID, date: "2026-08-10", startTime: "08:00", endTime: "16:00" };
    expect(calendarChangeRequestSchema.safeParse({ ...base, breakMinutes: 0 }).success).toBe(true);
    expect(calendarChangeRequestSchema.safeParse({ ...base, breakMinutes: 480 }).success).toBe(true);
  });

  it("lehnt breakMinutes -1 und 481 bei kind='update' ab", () => {
    const base = { kind: "update" as const, shiftId: VALID_UUID, date: "2026-08-10", startTime: "08:00", endTime: "16:00" };
    expect(calendarChangeRequestSchema.safeParse({ ...base, breakMinutes: -1 }).success).toBe(false);
    expect(calendarChangeRequestSchema.safeParse({ ...base, breakMinutes: 481 }).success).toBe(false);
  });

  it("akzeptiert eine Begründung mit 500 Zeichen, lehnt 501 Zeichen ab", () => {
    expect(
      calendarChangeRequestSchema.safeParse({ kind: "cancel", shiftId: VALID_UUID, reason: "a".repeat(500) })
        .success,
    ).toBe(true);
    expect(
      calendarChangeRequestSchema.safeParse({ kind: "cancel", shiftId: VALID_UUID, reason: "a".repeat(501) })
        .success,
    ).toBe(false);
  });

  it("lehnt ein unbekanntes kind ab", () => {
    expect(calendarChangeRequestSchema.safeParse({ kind: "delete", shiftId: VALID_UUID }).success).toBe(false);
  });
});

describe("calendarChangeDecisionSchema", () => {
  it("akzeptiert 'approved' und 'rejected'", () => {
    expect(calendarChangeDecisionSchema.safeParse({ decision: "approved" }).success).toBe(true);
    expect(calendarChangeDecisionSchema.safeParse({ decision: "rejected" }).success).toBe(true);
  });

  it("lehnt decision='pending' ab", () => {
    expect(calendarChangeDecisionSchema.safeParse({ decision: "pending" }).success).toBe(false);
  });
});
