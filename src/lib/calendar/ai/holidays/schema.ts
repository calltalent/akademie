import { z } from "zod";
import { CALENDAR_HOLIDAY_REGIONS, calendarDateSchema } from "@/lib/calendar/schema";

/**
 * KI-Feiertagsrecherche (Block S5b, 08.08.2026) — zod-Schemas für den
 * gesamten Ablauf: Auslöse-Eingabe (`startHolidayResearchJob`) -> Claude-
 * Antwortformat (`pipeline.ts`) -> `ai_jobs.output`-Entwurf (`process.ts`) ->
 * Übernahme-Eingabe (`applyHolidayResearch`). Gleiche Trennung wie
 * `src/lib/calendar/ai/schema.ts` (S4-Vorbild): reine Schemas/Typen hier,
 * kein `server-only` (importierbar aus Vitest UND aus den `"use server"`-
 * Dateien `actions.ts`/`process.ts`).
 *
 * `calendarDateSchema`/`CALENDAR_HOLIDAY_REGIONS` werden von `src/lib/
 * calendar/schema.ts` WIEDERVERWENDET (Import, keine Kopie) — S1-S5a-
 * Vertrag, siehe dortiger Dateikopf-Kommentar zur Trennung schema.ts/
 * actions.ts.
 *
 * WICHTIG (Datenminimierung, SPEC §12/DSGVO Art. 5 Abs. 1 lit. c): der
 * Prompt-Kontext (`prompt.ts`) enthält AUSSCHLIESSLICH Jahr und
 * Regionscodes aus dem geschlossenen Enum `CALENDAR_HOLIDAY_REGIONS` — kein
 * Freitextfeld, anders als bei der KI-Schichtplanung gibt es hier deshalb
 * KEIN Pseudonym-Mapping (Regionscodes sind keine personenbezogenen Daten,
 * architect-Plan Abschnitt 10, Risiko 6).
 *
 * WICHTIG (Sicherheit): `holidayApplyRowSchema` trägt bewusst KEIN
 * `region`-Feld — die Server Action (`applyHolidayResearch`) löst die
 * Region über `row.id` aus dem serverseitig gespeicherten
 * `ai_jobs.output.draft` auf, damit ein manipulierter Client keinen
 * fremden Regionscode unterschieben kann (S3-Lehre, hier 1:1 wie
 * `shiftPlanApplyRowSchema` bei `workerId`).
 */

// --- Auslöse-Eingabe (startHolidayResearchJob, job.input) ------------------

export const holidayResearchRequestSchema = z.object({
  year: z.coerce.number().int().min(2020, "Jahr muss ab 2020 liegen.").max(2100, "Jahr muss vor 2101 liegen."),
  regions: z
    .array(z.enum(CALENDAR_HOLIDAY_REGIONS))
    .min(1, "Mindestens eine Region.")
    .max(CALENDAR_HOLIDAY_REGIONS.length, "Höchstens acht Regionen."),
});
export type HolidayResearchRequestInput = z.infer<typeof holidayResearchRequestSchema>;

// --- Claude-Antwortformat (pipeline.ts) ------------------------------------

export const holidayModelShiftSchema = z.object({
  region: z.enum(CALENDAR_HOLIDAY_REGIONS),
  date: calendarDateSchema,
  name: z.string().trim().min(1, "Name erforderlich.").max(120, "Höchstens 120 Zeichen."),
});
export type HolidayModelHoliday = z.infer<typeof holidayModelShiftSchema>;

export const holidayModelOutputSchema = z.object({
  holidays: z.array(holidayModelShiftSchema).max(200, "Zu viele Feiertage im Vorschlag."),
  notes: z.string().trim().max(1000).optional(),
});
export type HolidayModelOutput = z.infer<typeof holidayModelOutputSchema>;

// --- ai_jobs.output-Entwurf (process.ts -> Review-UI) -----------------------

export const HOLIDAY_CHECKS = ["confirmed", "unverified"] as const;
export type HolidayCheck = (typeof HOLIDAY_CHECKS)[number];

export const HOLIDAY_CONFLICTS = ["existing", "duplicate", "outside-year"] as const;
export type HolidayConflict = (typeof HOLIDAY_CONFLICTS)[number];

export const holidayDraftRowSchema = z.object({
  id: z.string().uuid(),
  region: z.enum(CALENDAR_HOLIDAY_REGIONS),
  date: calendarDateSchema,
  name: z.string().trim().max(120),
  check: z.enum(HOLIDAY_CHECKS).nullable(),
  conflict: z.enum(HOLIDAY_CONFLICTS).nullable(),
});
export type HolidayDraftRow = z.infer<typeof holidayDraftRowSchema>;

export const holidayResearchOutputSchema = z.object({
  draft: z
    .object({
      rows: z.array(holidayDraftRowSchema).max(200),
      notes: z.string().max(1000).optional(),
    })
    .optional(),
  appliedRowIds: z.array(z.string().uuid()).max(200).default([]),
  appliedAt: z.string().optional(),
});
export type HolidayResearchOutput = z.infer<typeof holidayResearchOutputSchema>;

// --- Übernahme-Eingabe (applyHolidayResearch) -------------------------------

/** Bewusst KEIN `region` — siehe Dateikopf-Kommentar. */
export const holidayApplyRowSchema = z.object({
  id: z.string().uuid(),
  date: calendarDateSchema,
  name: z.string().trim().max(120, "Höchstens 120 Zeichen."),
});
export type HolidayApplyRow = z.infer<typeof holidayApplyRowSchema>;

export const holidayApplySchema = z.array(holidayApplyRowSchema).min(1).max(200);
export type HolidayApplyInput = z.infer<typeof holidayApplySchema>;
