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
