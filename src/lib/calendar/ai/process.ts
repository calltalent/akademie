import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceQuota, updateAiJob } from "@/lib/ai/usage";
import { AI_MODELS } from "@/lib/ai/config";
import { addDays, berlinDateTimeToUtc, isoDateString, toTimeInputValue } from "@/lib/calendar/date";
import { callShiftPlanModel } from "@/lib/calendar/ai/pipeline";
import {
  detectConflicts,
  mapDraftRows,
  type ShiftPlanConflictAbsence,
  type ShiftPlanConflictShift,
  type ShiftPlanPromptAbsence,
  type ShiftPlanPromptContext,
  type ShiftPlanPromptShift,
  type ShiftPlanPromptSlot,
  type ShiftPlanPromptWorker,
  type ShiftPlanWorkerMapping,
} from "@/lib/calendar/ai/prompt";
import { shiftPlanOutputSchema, shiftPlanRequestSchema } from "@/lib/calendar/ai/schema";

/**
 * KI-Schichtplanung (Block S4, 08.08.2026) — EINSTUFIGER Job (queued ->
 * done/error), ANDERS als der mehrstufige Kurs-Generator (`src/lib/
 * generator/process.ts`, drei Schritte über mehrere Cron-Ticks). Ein Aufruf
 * von `processNextShiftPlanJob()` erledigt den kompletten Lauf: Kontingent
 * prüfen -> Kontext laden -> EIN Claude-Aufruf -> Entwurf validieren/
 * Konflikte markieren -> `ai_jobs.output.draft` schreiben. Eng am
 * bestehenden `processNextCourseGenJob()` orientiert (Compare-and-Swap-
 * Sperre, Stale-Running-Fenster), aber ohne dessen Schritt-Zustandsmaschine.
 *
 * WICHTIG (Datenminimierung, siehe `src/lib/calendar/ai/prompt.ts`-
 * Dateikopf): JEDE Abfrage hier filtert auf `.eq("tenant_id", job.tenant_id)`
 * — aus der Job-ZEILE, NIE aus `job.input` (ein manipulierter/beschädigter
 * `input`-Wert könnte sonst eine `tenantId` aus einem fremden Mandanten
 * enthalten). Namen/E-Mails werden NIE geladen (kein Join auf `profiles`) —
 * Claude sieht ausschließlich Pseudonyme ("A1", "A2", …), siehe
 * `prompt.ts::buildShiftPlanPrompt()`.
 */

const STALE_RUNNING_MS = 3 * 60 * 1000; // 3 Minuten, gleiches Fenster wie processNextCourseGenJob()

type ProcessResult = { processed: false } | { processed: true; jobId: string; status: "done" | "error" };

type WorkerRow = {
  id: string;
  worker_type: "employee" | "freelancer";
  target_hours: number | null;
  target_period: "week" | "month";
  preferred_shift: "early" | "late" | "any";
  preferred_weekdays: number[] | null;
};

/** Exklusive obere UTC-Grenze für [fromDate, toDate] (Berlin-Kalendertage, beide Enden eingeschlossen) — Mitternacht des Tages NACH toDate. */
function periodToUtcRange(fromDate: string, toDate: string): { fromIso: string; toIso: string } {
  const fromIso = berlinDateTimeToUtc(fromDate, "00:00").toISOString();
  const dayAfterTo = isoDateString(addDays(berlinDateTimeToUtc(toDate, "00:00"), 1));
  const toIso = berlinDateTimeToUtc(dayAfterTo, "00:00").toISOString();
  return { fromIso, toIso };
}

export async function processNextShiftPlanJob(): Promise<ProcessResult> {
  const admin = createAdminClient();
  const staleThreshold = new Date(Date.now() - STALE_RUNNING_MS).toISOString();

  const { data: candidates, error: selectError } = await admin
    .from("ai_jobs")
    .select("id, tenant_id, status, input, tokens_in, tokens_out")
    .eq("kind", "shift_plan")
    .or(`status.eq.queued,and(status.eq.running,updated_at.lt.${staleThreshold})`)
    .order("created_at", { ascending: true })
    .limit(1);

  if (selectError) {
    console.error("[calendar/ai/process] Job-Abfrage fehlgeschlagen:", selectError.message);
    return { processed: false };
  }
  const job = candidates?.[0];
  if (!job) return { processed: false };

  const { error: lockError } = await admin
    .from("ai_jobs")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", job.status);
  if (lockError) {
    console.error("[calendar/ai/process] Job konnte nicht gesperrt werden:", lockError.message);
    return { processed: false };
  }

  const parsedInput = shiftPlanRequestSchema.safeParse(job.input);
  if (!parsedInput.success) {
    await updateAiJob(job.id, { status: "error", error: "Auftragseingabe ist ungültig oder beschädigt." });
    return { processed: true, jobId: job.id, status: "error" };
  }
  const input = parsedInput.data;

  // Kontingent-Prüfung VOR dem Claude-Aufruf, fail-closed (CLAUDE.md §3.7,
  // src/lib/ai/usage.ts). Geteilter Zähler mit dem Kurs-Generator
  // ("course_gen") — keine eigene Spalte/Migration, siehe SPEC §12.
  const quota = await enforceQuota(job.tenant_id, "course_gen");
  if (!quota.allowed) {
    await updateAiJob(job.id, { status: "error", error: "Monatliches KI-Kontingent ist aufgebraucht." });
    return { processed: true, jobId: job.id, status: "error" };
  }

  try {
    // --- Kontext laden (JEDE Abfrage über job.tenant_id, siehe Dateikopf) --

    const { data: projectRow } = await admin
      .from("calendar_projects")
      .select("id, name")
      .eq("tenant_id", job.tenant_id)
      .eq("id", input.projectId)
      .maybeSingle();
    if (!projectRow) {
      await updateAiJob(job.id, { status: "error", error: "Projekt wurde nicht mehr gefunden." });
      return { processed: true, jobId: job.id, status: "error" };
    }

    // Serverseitig NEU geschnitten (Projektmitgliedschaft ∩ aktiv), NICHT
    // blind aus job.input.workerIds übernommen — zwischen Auslösung und
    // Verarbeitung können Minuten liegen (S3-Lehre: projektbezogen prüfen).
    const { data: memberRows } = await admin
      .from("calendar_project_members")
      .select("worker_id")
      .eq("tenant_id", job.tenant_id)
      .eq("project_id", input.projectId)
      .in("worker_id", input.workerIds);
    const memberWorkerIds = (memberRows ?? []).map((r) => r.worker_id as string);

    let workerRows: WorkerRow[] = [];
    if (memberWorkerIds.length > 0) {
      const { data } = await admin
        .from("calendar_workers")
        .select("id, worker_type, target_hours, target_period, preferred_shift, preferred_weekdays")
        .eq("tenant_id", job.tenant_id)
        .eq("status", "active")
        .in("id", memberWorkerIds);
      workerRows = (data ?? []) as WorkerRow[];
    }
    if (workerRows.length === 0) {
      await updateAiJob(job.id, {
        status: "error",
        error: "Keine der gewählten Arbeiter ist noch aktives Mitglied dieses Projekts.",
      });
      return { processed: true, jobId: job.id, status: "error" };
    }

    // Stabile Pseudonym-Zuordnung "A1"…"An" nach worker_id aufsteigend
    // sortiert — Map nur im Speicher DIESES Aufrufs (siehe SPEC §12).
    const sortedWorkers = [...workerRows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const pseudonymMappings: ShiftPlanWorkerMapping[] = sortedWorkers.map((w, i) => ({
      pseudonym: `A${i + 1}`,
      workerId: w.id,
    }));
    const workerIdToPseudonym = new Map(pseudonymMappings.map((m) => [m.workerId, m.pseudonym]));
    const workerIds = sortedWorkers.map((w) => w.id);

    const { fromIso, toIso } = periodToUtcRange(input.fromDate, input.toDate);

    const [{ data: workerAbsenceRows }, { data: holidayAbsenceRows }, { data: shiftRows }, { data: slotRows }] =
      await Promise.all([
        admin
          .from("calendar_absences")
          .select("worker_id, kind, starts_on, ends_on")
          .eq("tenant_id", job.tenant_id)
          .neq("status", "rejected")
          .lte("starts_on", input.toDate)
          .gte("ends_on", input.fromDate)
          .in("worker_id", workerIds),
        admin
          .from("calendar_absences")
          .select("worker_id, kind, starts_on, ends_on")
          .eq("tenant_id", job.tenant_id)
          .neq("status", "rejected")
          .lte("starts_on", input.toDate)
          .gte("ends_on", input.fromDate)
          .is("worker_id", null),
        admin
          .from("calendar_shifts")
          .select("worker_id, starts_at, ends_at")
          .eq("tenant_id", job.tenant_id)
          .neq("status", "cancelled")
          .in("worker_id", workerIds)
          .gte("starts_at", fromIso)
          .lt("starts_at", toIso),
        admin
          .from("calendar_slots")
          .select("starts_at, ends_at, capacity")
          .eq("tenant_id", job.tenant_id)
          .eq("project_id", input.projectId)
          .eq("status", "open")
          .gte("starts_at", fromIso)
          .lt("starts_at", toIso),
      ]);

    const absenceRows = [...(workerAbsenceRows ?? []), ...(holidayAbsenceRows ?? [])] as {
      worker_id: string | null;
      kind: string;
      starts_on: string;
      ends_on: string;
    }[];
    const existingShiftRows = (shiftRows ?? []) as { worker_id: string; starts_at: string; ends_at: string }[];
    const openSlotRows = (slotRows ?? []) as { starts_at: string; ends_at: string; capacity: number }[];

    const promptWorkers: ShiftPlanPromptWorker[] = sortedWorkers.map((w) => ({
      pseudonym: workerIdToPseudonym.get(w.id)!,
      workerType: w.worker_type,
      targetHours: w.target_hours,
      targetPeriod: w.target_period,
      preferredShift: w.preferred_shift,
      preferredWeekdays: w.preferred_weekdays ?? [],
    }));

    const promptAbsences: ShiftPlanPromptAbsence[] = absenceRows.map((a) => ({
      pseudonym: a.worker_id ? (workerIdToPseudonym.get(a.worker_id) ?? null) : null,
      kind: a.kind,
      startsOn: a.starts_on,
      endsOn: a.ends_on,
    }));
    const conflictAbsences: ShiftPlanConflictAbsence[] = absenceRows.map((a) => ({
      workerId: a.worker_id,
      startsOn: a.starts_on,
      endsOn: a.ends_on,
    }));

    const promptExistingShifts: ShiftPlanPromptShift[] = existingShiftRows.map((s) => {
      const start = new Date(s.starts_at);
      return {
        pseudonym: workerIdToPseudonym.get(s.worker_id) ?? "?",
        date: isoDateString(start),
        startTime: toTimeInputValue(start),
        endTime: toTimeInputValue(new Date(s.ends_at)),
      };
    });
    const conflictShifts: ShiftPlanConflictShift[] = existingShiftRows.map((s) => ({
      workerId: s.worker_id,
      startsAt: new Date(s.starts_at),
      endsAt: new Date(s.ends_at),
    }));

    const promptOpenSlots: ShiftPlanPromptSlot[] = openSlotRows.map((s) => {
      const start = new Date(s.starts_at);
      return {
        date: isoDateString(start),
        startTime: toTimeInputValue(start),
        endTime: toTimeInputValue(new Date(s.ends_at)),
        capacity: s.capacity,
      };
    });

    const promptContext: ShiftPlanPromptContext = {
      projectName: projectRow.name,
      fromDate: input.fromDate,
      toDate: input.toDate,
      note: input.note,
      workers: promptWorkers,
      absences: promptAbsences,
      existingShifts: promptExistingShifts,
      openSlots: promptOpenSlots,
    };

    // --- Claude-Aufruf + Nachbearbeitung (rein per Code, siehe prompt.ts) --

    const result = await callShiftPlanModel(promptContext);
    const { rows: mappedRows, unresolvedNotes } = mapDraftRows(result.data.shifts, pseudonymMappings);
    const rowsWithConflicts = detectConflicts(mappedRows, {
      fromDate: input.fromDate,
      toDate: input.toDate,
      absences: conflictAbsences,
      existingShifts: conflictShifts,
    });

    const combinedNotes = [result.data.notes, ...unresolvedNotes].filter(Boolean).join(" ").slice(0, 1000);

    const validatedOutput = shiftPlanOutputSchema.parse({
      draft: { rows: rowsWithConflicts, notes: combinedNotes || undefined },
      appliedRowIds: [],
    });

    await updateAiJob(job.id, {
      status: "done",
      output: validatedOutput,
      model: AI_MODELS.sonnet,
      tokensIn: job.tokens_in + result.tokensIn,
      tokensOut: job.tokens_out + result.tokensOut,
    });
    return { processed: true, jobId: job.id, status: "done" };
  } catch (e) {
    // Volles Detail nur ins Server-Log — ai_jobs.error bekommt einen klaren
    // deutschen Satz (gleiches Muster wie processNextCourseGenJob()).
    const message = e instanceof Error ? e.message : "Unbekannter Fehler bei der Schichtplanung.";
    console.error(`[calendar/ai/process] Lauf fehlgeschlagen (Job ${job.id}):`, message);
    await updateAiJob(job.id, {
      status: "error",
      error: "Die KI-Schichtplanung ist fehlgeschlagen. Bitte erneut versuchen.",
    });
    return { processed: true, jobId: job.id, status: "error" };
  }
}
