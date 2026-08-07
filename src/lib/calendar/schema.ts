import { z } from "zod";

/**
 * "Schichtplan" (Block S1, 07.08.2026). Trennung schema.ts/actions.ts wie
 * `src/lib/customer-area/{schema,actions}.ts`: eine `"use server"`-Datei
 * darf laut Next.js nur async Server Actions exportieren — zod-Schemas,
 * Konstanten und reine Mapping-Helfer leben deshalb hier, damit sie sowohl
 * von `calendar/actions.ts`/`calendar/queries.ts` als auch verlustfrei von
 * Vitest-Tests importiert werden können (gleicher, bereits im Repo
 * dokumentierter Turbopack-Grund, siehe PHASENSTATUS.md "Kunden Area",
 * Abweichung 1).
 *
 * Server Actions rufen diese Schemas direkt mit typisierten Objekten auf
 * (kein FormData-Parsing) — gleiches Muster wie
 * `createCustomerAreaItem(input: CustomerAreaItemInput)`, nicht wie das
 * ältere `<form action={fn}>`/`useActionState`-Muster mit `FormData`.
 */

export const CALENDAR_WORKER_TYPES = ["employee", "freelancer"] as const;
export type CalendarWorkerType = (typeof CALENDAR_WORKER_TYPES)[number];

export const CALENDAR_WORKER_STATUSES = ["active", "inactive"] as const;
export type CalendarWorkerStatus = (typeof CALENDAR_WORKER_STATUSES)[number];

export const CALENDAR_TARGET_PERIODS = ["week", "month"] as const;
export type CalendarTargetPeriod = (typeof CALENDAR_TARGET_PERIODS)[number];

export const CALENDAR_PREFERRED_SHIFTS = ["early", "late", "any"] as const;
export type CalendarPreferredShift = (typeof CALENDAR_PREFERRED_SHIFTS)[number];

export const CALENDAR_PROJECT_STATUSES = ["active", "archived"] as const;
export type CalendarProjectStatus = (typeof CALENDAR_PROJECT_STATUSES)[number];

export const CALENDAR_PROJECT_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Deckt sich 1:1 mit dem CHECK `calendar_workers_weekdays_valid`/`<@ array[0..6]` (Migration) — bei Änderung immer beide Stellen anpassen. */
export const calendarWeekdaySchema = z.number().int().min(0).max(6);

/** Felder, die sowohl beim Anlegen als auch beim Bearbeiten eines Arbeiters geschrieben werden — `membershipId`/`userId` sind nach dem Anlegen unveränderlich, deshalb nicht Teil dieses Kerns. */
export const calendarWorkerEditableSchema = z.object({
  workerType: z.enum(CALENDAR_WORKER_TYPES),
  targetHours: z
    .number()
    .positive("Sollstunden müssen größer als 0 sein.")
    .max(400, "Sollstunden dürfen höchstens 400 betragen.")
    .optional(),
  targetPeriod: z.enum(CALENDAR_TARGET_PERIODS).default("week"),
  preferredShift: z.enum(CALENDAR_PREFERRED_SHIFTS).default("any"),
  preferredWeekdays: z.array(calendarWeekdaySchema).max(7).default([]),
  note: z.string().trim().max(500, "Höchstens 500 Zeichen.").optional(),
});
export type CalendarWorkerEditableInput = z.infer<typeof calendarWorkerEditableSchema>;

export const calendarWorkerCreateSchema = calendarWorkerEditableSchema.extend({
  membershipId: z.string().uuid("Ungültige Mitgliedschaft."),
});
export type CalendarWorkerCreateInput = z.infer<typeof calendarWorkerCreateSchema>;

export const calendarWorkerStatusSchema = z.enum(CALENDAR_WORKER_STATUSES);

export const calendarProjectSchema = z.object({
  name: z.string().trim().min(1, "Name erforderlich.").max(150, "Höchstens 150 Zeichen."),
  description: z.string().trim().max(1000, "Höchstens 1000 Zeichen.").optional(),
  color: z
    .string()
    .trim()
    .regex(CALENDAR_PROJECT_COLOR_PATTERN, "Ungültige Farbe — Format #RRGGBB.")
    .optional(),
  leadUserId: z.string().uuid("Ungültiger Projektleiter.").optional(),
});
export type CalendarProjectInput = z.infer<typeof calendarProjectSchema>;

export const calendarProjectStatusSchema = z.enum(CALENDAR_PROJECT_STATUSES);

/** Wiederverwendet von `setCalendarProjectMembers` (actions.ts) — gleiche Obergrenze wie `customerAreaMemberIdsSchema`. */
export const calendarProjectMemberIdsSchema = z.array(z.string().uuid()).max(500, "Höchstens 500 Arbeiter je Projekt.");

export const calendarClockInSchema = z.object({
  shiftId: z.string().uuid("Ungültige Schicht.").optional(),
  note: z.string().trim().max(500, "Höchstens 500 Zeichen.").optional(),
});
export type CalendarClockInInput = z.infer<typeof calendarClockInSchema>;

// --- Zeilentypen (App-Form, snake_case-DB-Zeilen -> camelCase) ---------

export type CalendarWorkerRow = {
  id: string;
  membershipId: string;
  userId: string;
  fullName: string | null;
  email: string;
  workerType: CalendarWorkerType;
  status: CalendarWorkerStatus;
  targetHours: number | null;
  targetPeriod: CalendarTargetPeriod;
  preferredShift: CalendarPreferredShift;
  preferredWeekdays: number[];
  note: string | null;
};

export type CalendarProjectRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  leadUserId: string | null;
  leadName: string | null;
  status: CalendarProjectStatus;
  position: number;
  memberWorkerIds: string[];
};

export type CalendarShiftRow = {
  id: string;
  workerId: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  startsAt: string; // ISO-8601, UTC
  endsAt: string;
  breakMinutes: number;
  status: "planned" | "confirmed" | "cancelled";
  note: string | null;
};

export type CalendarTimeEntryRow = {
  id: string;
  workerId: string;
  shiftId: string | null;
  startedAt: string;
  endedAt: string | null;
  source: "admin" | "self";
  note: string | null;
};

type CalendarProjectDbRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  lead_user_id: string | null;
  status: string;
  position: number;
};

export function toCalendarProjectRow(
  row: CalendarProjectDbRow,
  leadName: string | null,
  memberWorkerIds: string[],
): CalendarProjectRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    leadUserId: row.lead_user_id,
    leadName,
    status: row.status as CalendarProjectStatus,
    position: row.position,
    memberWorkerIds,
  };
}

// =====================================================================
// Block S2 (08.08.2026) — Admin-Schicht-CRUD, Zeitfenster-Verwaltung,
// Freelancer-Selbstbuchung, Feiertagsimport, Sollstunden-Selbstverwaltung.
// Bestehende Schemas/Typen oben UNVERÄNDERT.
// =====================================================================

/** Deckt sich mit den zod-Regex-Anforderungen unten UND dem HTML-Standardformat von `<input type="date">`/`<input type="time">`. */
export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datum.");
export const calendarTimeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Ungültige Uhrzeit.");

export const CALENDAR_SHIFT_STATUSES = ["planned", "confirmed", "cancelled"] as const;
export type CalendarShiftStatus = (typeof CALENDAR_SHIFT_STATUSES)[number];

export const CALENDAR_SLOT_STATUSES = ["open", "closed"] as const;
export type CalendarSlotStatus = (typeof CALENDAR_SLOT_STATUSES)[number];

export const CALENDAR_ABSENCE_KINDS = ["vacation", "holiday", "sick", "other"] as const;
export type CalendarAbsenceKind = (typeof CALENDAR_ABSENCE_KINDS)[number];

export const CALENDAR_HOLIDAY_COUNTRIES = ["DE", "AT", "CH"] as const;
export type CalendarHolidayCountryCode = (typeof CALENDAR_HOLIDAY_COUNTRIES)[number];

/** Admin-Schicht-CRUD (`createCalendarShift`/`updateCalendarShift`) — Datum+Uhrzeit getrennt (Formular-Felder), die Server Action baut daraus über `berlinDateTimeToUtc()` die `starts_at`/`ends_at`-Zeitstempel. */
export const calendarShiftSchema = z
  .object({
    workerId: z.string().uuid("Ungültiger Arbeiter."),
    projectId: z.string().uuid("Ungültiges Projekt.").optional(),
    slotId: z.string().uuid("Ungültiges Zeitfenster.").optional(),
    date: calendarDateSchema,
    startTime: calendarTimeSchema,
    endTime: calendarTimeSchema,
    breakMinutes: z.coerce.number().int().min(0).max(480).default(0),
    note: z.string().trim().max(500, "Höchstens 500 Zeichen.").optional(),
  })
  .refine((d) => d.startTime !== d.endTime, {
    message: "Start- und Endzeit dürfen nicht gleich sein.",
    path: ["endTime"],
  });
export type CalendarShiftInput = z.infer<typeof calendarShiftSchema>;

export const calendarShiftStatusSchema = z.enum(CALENDAR_SHIFT_STATUSES);

/** Zeitfenster-Serienanlage (`createCalendarSlots`) — `repeatWeeks` steuert `buildWeeklySeries()`. */
export const calendarSlotSchema = z.object({
  projectId: z.string().uuid("Ungültiges Projekt."),
  date: calendarDateSchema,
  startTime: calendarTimeSchema,
  endTime: calendarTimeSchema,
  capacity: z.coerce.number().int().min(1).max(500),
  repeatWeeks: z.coerce.number().int().min(1).max(26).default(1),
});
export type CalendarSlotInput = z.infer<typeof calendarSlotSchema>;

export const calendarSlotStatusSchema = z.enum(CALENDAR_SLOT_STATUSES);

/**
 * Abwesenheit/Feiertag (`createCalendarAbsence`). Der zweite `refine`
 * spiegelt den DB-CHECK `calendar_absences` `(kind = 'holiday') = (worker_id
 * is null)` (20260807142619_shift_calendar.sql, Abschnitt 6) — beide
 * Stellen bei einer künftigen Änderung synchron halten, gleiches Prinzip
 * wie `calendarWeekdaySchema` oben (Kommentar dort).
 */
export const calendarAbsenceSchema = z
  .object({
    workerId: z.string().uuid("Ungültiger Arbeiter.").optional(),
    kind: z.enum(CALENDAR_ABSENCE_KINDS),
    startsOn: calendarDateSchema,
    endsOn: calendarDateSchema,
    note: z.string().trim().max(500, "Höchstens 500 Zeichen.").optional(),
  })
  .refine((d) => d.endsOn >= d.startsOn, {
    message: "Das Enddatum darf nicht vor dem Startdatum liegen.",
    path: ["endsOn"],
  })
  .refine((d) => (d.kind === "holiday") === (d.workerId === undefined), {
    message: "Ein Feiertag hat keinen Arbeiter, jede andere Abwesenheit braucht einen.",
    path: ["workerId"],
  });
export type CalendarAbsenceInput = z.infer<typeof calendarAbsenceSchema>;

export const calendarHolidayImportSchema = z.object({
  country: z.enum(CALENDAR_HOLIDAY_COUNTRIES),
  year: z.coerce.number().int().min(2020).max(2100),
});
export type CalendarHolidayImportInput = z.infer<typeof calendarHolidayImportSchema>;

export const calendarSelfBookingSchema = z.object({
  slotId: z.string().uuid("Ungültiges Zeitfenster."),
});
export type CalendarSelfBookingInput = z.infer<typeof calendarSelfBookingSchema>;

/** Freelancer-Selbstverwaltung (`updateOwnTargetHours`) — nur die zwei Felder, die der Trigger `calendar_workers_guard()` (S2-Migration) Nicht-Admins erlaubt. */
export const calendarWorkerTargetSchema = z.object({
  targetHours: z
    .number()
    .positive("Sollstunden müssen größer als 0 sein.")
    .max(400, "Sollstunden dürfen höchstens 400 betragen.")
    .optional(),
  targetPeriod: z.enum(CALENDAR_TARGET_PERIODS),
});
export type CalendarWorkerTargetInput = z.infer<typeof calendarWorkerTargetSchema>;

// --- Zeilentypen (App-Form, snake_case-DB-Zeilen -> camelCase) ---------

export type CalendarSlotRow = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status: CalendarSlotStatus;
  bookedCount: number;
};

export type CalendarAbsenceRow = {
  id: string;
  workerId: string | null;
  workerName: string | null;
  kind: CalendarAbsenceKind;
  startsOn: string;
  endsOn: string;
  note: string | null;
  status: "requested" | "approved" | "rejected";
};

/** Admin-Wochenraster-Zeile — anders als `CalendarShiftRow` (Lernbereich, nur eigene Schichten) trägt diese zusätzlich Arbeitername/-id UND alle Status (Admin soll auch Stornos sehen). */
export type CalendarAdminShiftRow = {
  id: string;
  workerId: string;
  workerName: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  slotId: string | null;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  status: CalendarShiftStatus;
  source: "admin" | "self" | "ai";
  note: string | null;
};

/** Ergebniszeile von `calendar_open_slots()` (RPC, S2-Migration) — Selbstbuchungs-Ansicht des Freelancers. */
export type CalendarOpenSlotRow = {
  id: string;
  projectId: string;
  projectName: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  freeSeats: number;
  alreadyBooked: boolean;
};

// =====================================================================
// Block S3 (09.08.2026) — Änderungsanfragen-UI, Projektleiter-Zugang zum
// Admin-Bereich. Bestehende Schemas/Typen oben UNVERÄNDERT.
// =====================================================================

export const CALENDAR_CHANGE_REQUEST_KINDS = ["update", "cancel"] as const;
export type CalendarChangeRequestKind = (typeof CALENDAR_CHANGE_REQUEST_KINDS)[number];

export const CALENDAR_CHANGE_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type CalendarChangeRequestStatus = (typeof CALENDAR_CHANGE_REQUEST_STATUSES)[number];

/**
 * Änderungsanfrage eines Arbeiters (`createShiftChangeRequest`) — entweder
 * "Zeit ändern" (`update`, mit vollständigem neuen Datum/Uhrzeit/Pause) oder
 * "Stornieren" (`cancel`, ohne Zeitfelder). WICHTIG: `.refine()` steht
 * AUSSERHALB der `discriminatedUnion` — ein `ZodEffects` als Union-Mitglied
 * würde `discriminatedUnion` brechen (`kind`-Diskriminator müsste dann durch
 * den Effect-Wrapper hindurchschauen).
 */
export const calendarChangeRequestSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("cancel"),
      shiftId: z.string().uuid("Ungültige Schicht."),
      reason: z.string().trim().max(500, "Höchstens 500 Zeichen.").optional(),
    }),
    z.object({
      kind: z.literal("update"),
      shiftId: z.string().uuid("Ungültige Schicht."),
      date: calendarDateSchema,
      startTime: calendarTimeSchema,
      endTime: calendarTimeSchema,
      breakMinutes: z.coerce.number().int().min(0).max(480).default(0),
      reason: z.string().trim().max(500, "Höchstens 500 Zeichen.").optional(),
    }),
  ])
  .refine((d) => d.kind !== "update" || d.startTime !== d.endTime, {
    message: "Start- und Endzeit dürfen nicht gleich sein.",
    path: ["endTime"],
  });
export type CalendarChangeRequestInput = z.infer<typeof calendarChangeRequestSchema>;

/** Entscheidung über eine Änderungsanfrage (`decideShiftChangeRequest`) — Admin/Projektleiter. */
export const calendarChangeDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  decisionNote: z.string().trim().max(500, "Höchstens 500 Zeichen.").optional(),
});
export type CalendarChangeDecisionInput = z.infer<typeof calendarChangeDecisionSchema>;

/**
 * Änderungsanfrage-Zeile für die Admin-Inbox UND die Arbeiter-eigene Ansicht
 * — trägt zusätzlich zum Anfrage-Datensatz selbst den Kontext der
 * Ursprungsschicht (`shiftStartsAt`/…/`projectName`/`projectColor`), damit
 * "Aktuell" vs. "Vorgeschlagen" ohne einen zweiten Round-Trip dargestellt
 * werden kann.
 */
export type CalendarChangeRequestRow = {
  id: string;
  shiftId: string;
  workerId: string;
  workerName: string | null;
  kind: CalendarChangeRequestKind;
  proposedStartsAt: string | null;
  proposedEndsAt: string | null;
  proposedBreakMinutes: number | null;
  proposedProjectId: string | null;
  reason: string | null;
  status: CalendarChangeRequestStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  shiftStartsAt: string;
  shiftEndsAt: string;
  shiftBreakMinutes: number;
  shiftStatus: CalendarShiftStatus;
  projectName: string | null;
  projectColor: string | null;
};
