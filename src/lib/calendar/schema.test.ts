import { describe, expect, it } from "vitest";
import {
  calendarClockInSchema,
  calendarProjectMemberIdsSchema,
  calendarProjectSchema,
  calendarWorkerCreateSchema,
  calendarWorkerEditableSchema,
  calendarWorkerStatusSchema,
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
