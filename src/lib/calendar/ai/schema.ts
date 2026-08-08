import { z } from "zod";
import { calendarDateSchema, calendarTimeSchema } from "@/lib/calendar/schema";

/**
 * KI-gestützte Schichtplanung (Block S4, 08.08.2026) — zod-Schemas für den
 * gesamten Ablauf: Auslöse-Eingabe (`startShiftPlanJob`) -> Claude-
 * Antwortformat (`pipeline.ts`) -> `ai_jobs.output`-Entwurf (`process.ts`) ->
 * Übernahme-Eingabe (`applyShiftPlan`). Gleiche Trennung wie
 * `src/lib/generator/schema.ts`: reine Schemas/Typen hier, kein `server-only`
 * (importierbar aus Vitest UND aus den `"use server"`-Dateien `actions.ts`/
 * `process.ts`).
 *
 * `calendarDateSchema`/`calendarTimeSchema` werden von `src/lib/calendar/
 * schema.ts` WIEDERVERWENDET (Import, keine Kopie) — S1-S3-Vertrag, siehe
 * dortiger Dateikopf-Kommentar zur Trennung schema.ts/actions.ts.
 *
 * WICHTIG (Datenminimierung, SPEC §12/DSGVO Art. 5 Abs. 1 lit. c):
 * `shiftPlanRequestSchema.workerIds` sind `calendar_workers.id`-UUIDs, KEINE
 * Namen/E-Mails. `shiftPlanModelShiftSchema.worker` ist ein Pseudonym
 * ("A1", "A2", ...) — Claude sieht nie einen Klarnamen oder eine
 * Arbeiter-UUID, siehe `prompt.ts`.
 *
 * WICHTIG (Sicherheit): `shiftPlanApplyRowSchema` trägt bewusst KEIN
 * `workerId` — die Server Action (`applyShiftPlan`) löst den Arbeiter über
 * `row.id` aus dem serverseitig gespeicherten `ai_jobs.output.draft` auf,
 * damit ein manipulierter Client keine fremde Arbeiter-UUID unterschieben
 * kann (S3-Lehre: nie eine sicherheitsrelevante ID vom Client übernehmen,
 * die auch serverseitig auflösbar ist).
 */

// --- Auslöse-Eingabe (startShiftPlanJob) -----------------------------------

function daysBetweenIso(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86_400_000);
}

export const shiftPlanRequestSchema = z
  .object({
    projectId: z.string().uuid("Ungültiges Projekt."),
    fromDate: calendarDateSchema,
    toDate: calendarDateSchema,
    workerIds: z
      .array(z.string().uuid())
      .min(1, "Mindestens ein Arbeiter.")
      .max(20, "Höchstens 20 Arbeiter je Lauf."),
    note: z.string().trim().max(500, "Höchstens 500 Zeichen.").optional(),
  })
  .refine((d) => d.toDate >= d.fromDate, {
    message: "Das Enddatum darf nicht vor dem Startdatum liegen.",
    path: ["toDate"],
  })
  .refine((d) => daysBetweenIso(d.fromDate, d.toDate) <= 31, {
    message: "Höchstens 31 Tage je Lauf.",
    path: ["toDate"],
  });
export type ShiftPlanRequestInput = z.infer<typeof shiftPlanRequestSchema>;

// --- Claude-Antwortformat (pipeline.ts) ------------------------------------

export const SHIFT_PLAN_WORKER_PATTERN = /^A\d{1,3}$/;

export const shiftPlanModelShiftSchema = z.object({
  worker: z.string().regex(SHIFT_PLAN_WORKER_PATTERN, "Ungültige Arbeiter-Kennung."),
  date: calendarDateSchema,
  startTime: calendarTimeSchema,
  endTime: calendarTimeSchema,
  breakMinutes: z.number().int().min(0).max(480),
  note: z.string().trim().max(200).optional(),
});
export type ShiftPlanModelShift = z.infer<typeof shiftPlanModelShiftSchema>;

export const shiftPlanModelOutputSchema = z.object({
  shifts: z.array(shiftPlanModelShiftSchema).max(200, "Zu viele Schichten im Vorschlag."),
  notes: z.string().trim().max(1000).optional(),
});
export type ShiftPlanModelOutput = z.infer<typeof shiftPlanModelOutputSchema>;

// --- ai_jobs.output-Entwurf (process.ts -> Review-UI) ----------------------

export const CALENDAR_SHIFT_PLAN_CONFLICTS = ["overlap", "absence", "outside-period", "duplicate"] as const;
export type ShiftPlanConflict = (typeof CALENDAR_SHIFT_PLAN_CONFLICTS)[number];

export const shiftPlanDraftRowSchema = z.object({
  id: z.string().uuid(),
  workerId: z.string().uuid(),
  date: calendarDateSchema,
  startTime: calendarTimeSchema,
  endTime: calendarTimeSchema,
  breakMinutes: z.number().int().min(0).max(480),
  note: z.string().trim().max(200).optional(),
  conflict: z.enum(CALENDAR_SHIFT_PLAN_CONFLICTS).nullable(),
});
export type ShiftPlanDraftRow = z.infer<typeof shiftPlanDraftRowSchema>;

export const shiftPlanOutputSchema = z.object({
  draft: z
    .object({
      rows: z.array(shiftPlanDraftRowSchema).max(200),
      notes: z.string().max(1000).optional(),
    })
    .optional(),
  appliedRowIds: z.array(z.string().uuid()).max(200).default([]),
  appliedAt: z.string().optional(),
});
export type ShiftPlanOutput = z.infer<typeof shiftPlanOutputSchema>;

// --- Übernahme-Eingabe (applyShiftPlan) ------------------------------------

/** Bewusst KEIN `workerId` — siehe Dateikopf-Kommentar. */
export const shiftPlanApplyRowSchema = z.object({
  id: z.string().uuid(),
  date: calendarDateSchema,
  startTime: calendarTimeSchema,
  endTime: calendarTimeSchema,
  breakMinutes: z.coerce.number().int().min(0).max(480),
});
export type ShiftPlanApplyRow = z.infer<typeof shiftPlanApplyRowSchema>;

export const shiftPlanApplySchema = z.array(shiftPlanApplyRowSchema).min(1).max(200);
export type ShiftPlanApplyInput = z.infer<typeof shiftPlanApplySchema>;
