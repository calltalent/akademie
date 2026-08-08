import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceQuota, updateAiJob } from "@/lib/ai/usage";
import { AI_MODELS } from "@/lib/ai/config";
import { callHolidayResearchModel } from "@/lib/calendar/ai/holidays/pipeline";
import { crossCheckHolidays, detectHolidayConflicts, mapHolidayDraftRows } from "@/lib/calendar/ai/holidays/prompt";
import { holidayResearchOutputSchema, holidayResearchRequestSchema } from "@/lib/calendar/ai/holidays/schema";

/**
 * KI-Feiertagsrecherche (Block S5b, 08.08.2026) — EINSTUFIGER Job (queued ->
 * done/error), exakt das Muster von `processNextShiftPlanJob()` (S4-
 * Vorbild, `src/lib/calendar/ai/process.ts`): Kontingent prüfen -> Bestand
 * laden -> EIN Claude-Aufruf -> Entwurf abgleichen/Konflikte markieren ->
 * `ai_jobs.output.draft` schreiben. Kein Mehrschritt-Zustandsautomat wie
 * der Kurs-Generator (`src/lib/generator/process.ts`).
 *
 * WICHTIG (S4-Regel, gilt hier unverändert): JEDE Abfrage filtert auf
 * `.eq("tenant_id", job.tenant_id)` — aus der Job-ZEILE, NIE aus
 * `job.input` (ein manipulierter/beschädigter `input`-Wert könnte sonst
 * eine `tenantId` aus einem fremden Mandanten enthalten).
 */

const STALE_RUNNING_MS = 3 * 60 * 1000; // 3 Minuten, gleiches Fenster wie processNextShiftPlanJob()

type ProcessResult = { processed: false } | { processed: true; jobId: string; status: "done" | "error" };

export async function processNextHolidayResearchJob(): Promise<ProcessResult> {
  const admin = createAdminClient();
  const staleThreshold = new Date(Date.now() - STALE_RUNNING_MS).toISOString();

  const { data: candidates, error: selectError } = await admin
    .from("ai_jobs")
    .select("id, tenant_id, status, input, tokens_in, tokens_out")
    .eq("kind", "holiday_research")
    .or(`status.eq.queued,and(status.eq.running,updated_at.lt.${staleThreshold})`)
    .order("created_at", { ascending: true })
    .limit(1);

  if (selectError) {
    console.error("[calendar/ai/holidays/process] Job-Abfrage fehlgeschlagen:", selectError.message);
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
    console.error("[calendar/ai/holidays/process] Job konnte nicht gesperrt werden:", lockError.message);
    return { processed: false };
  }

  const parsedInput = holidayResearchRequestSchema.safeParse(job.input);
  if (!parsedInput.success) {
    await updateAiJob(job.id, { status: "error", error: "Auftragseingabe ist ungültig oder beschädigt." });
    return { processed: true, jobId: job.id, status: "error" };
  }
  const input = parsedInput.data;

  // Kontingent-Prüfung VOR dem Claude-Aufruf, fail-closed (CLAUDE.md §3.7,
  // src/lib/ai/usage.ts). Geteilter Zähler mit dem Kurs-Generator/der
  // KI-Schichtplanung ("course_gen") — keine eigene Spalte/Migration,
  // architect-Plan Abschnitt 0, Punkt 8.
  const quota = await enforceQuota(job.tenant_id, "course_gen");
  if (!quota.allowed) {
    await updateAiJob(job.id, { status: "error", error: "Monatliches KI-Kontingent ist aufgebraucht." });
    return { processed: true, jobId: job.id, status: "error" };
  }

  try {
    // Bereits vorhandene Feiertage des Jahres laden (für
    // detectHolidayConflicts() -> conflict:"existing").
    const { data: existingRows } = await admin
      .from("calendar_absences")
      .select("starts_on")
      .eq("tenant_id", job.tenant_id)
      .eq("kind", "holiday")
      .gte("starts_on", `${input.year}-01-01`)
      .lte("starts_on", `${input.year}-12-31`);
    const existingHolidays = (existingRows ?? []).map((r) => ({ date: r.starts_on as string }));

    // --- Claude-Aufruf + Nachbearbeitung (rein per Code, siehe prompt.ts) --

    const result = await callHolidayResearchModel({ year: input.year, regions: input.regions });
    const { rows: mappedRows, unresolvedNotes } = mapHolidayDraftRows(result.data.holidays, input.regions);
    const { rows: checkedRows, missingNotes } = crossCheckHolidays(mappedRows, input.year);
    const rowsWithConflicts = detectHolidayConflicts(checkedRows, { year: input.year, existingHolidays });

    const combinedNotes = [result.data.notes, ...unresolvedNotes, ...missingNotes]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1000);

    const validatedOutput = holidayResearchOutputSchema.parse({
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
    // deutschen Satz (gleiches Muster wie processNextShiftPlanJob()).
    const message = e instanceof Error ? e.message : "Unbekannter Fehler bei der Feiertagsrecherche.";
    console.error(`[calendar/ai/holidays/process] Lauf fehlgeschlagen (Job ${job.id}):`, message);
    await updateAiJob(job.id, {
      status: "error",
      error: "Die KI-Feiertagsrecherche ist fehlgeschlagen. Bitte erneut versuchen.",
    });
    return { processed: true, jobId: job.id, status: "error" };
  }
}
