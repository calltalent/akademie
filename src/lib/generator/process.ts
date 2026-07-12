import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceQuota, updateAiJob } from "@/lib/ai/usage";
import { AI_MODELS } from "@/lib/ai/config";
import {
  courseGenInputSchema,
  courseGenOutputSchema,
  courseOutlineSchema,
  courseContentSchema,
  courseDraftSchema,
  type CourseDraft,
} from "@/lib/generator/schema";
import { generateOutlineStep, generateLessonContentStep, generateQuizStep } from "@/lib/generator/pipeline";

/**
 * Zustandsmaschine für den Kurs-Generator (Phase 3, Block 5). Wird vom
 * geschützten Cron-Endpunkt (src/app/api/admin/ki/process/route.ts)
 * aufgerufen — EIN Aufruf verarbeitet GENAU EINEN Pipeline-Schritt EINES
 * einzigen Jobs (Workers-CPU-Zeit-Limit-Risiko bei mehrstufiger
 * Generierung in einem Request, siehe PHASENSTATUS.md-Architekturentscheidung).
 *
 * Idempotenz/Sperre: `status='running'` fungiert als einfache Sperre gegen
 * einen zweiten, überlappenden Cron-Aufruf, während ein Schritt noch läuft.
 * Ein Job gilt nur dann als "erneut aufgreifbar", wenn er `queued` ist ODER
 * `running` mit einem `updated_at`, das älter als `STALE_RUNNING_MS` ist
 * (Sicherheitsfenster für den Fall, dass ein vorheriger Prozess-Aufruf ohne
 * sauberes Update abgebrochen ist, z. B. Workers-Timeout).
 */

const STALE_RUNNING_MS = 3 * 60 * 1000; // 3 Minuten

type ProcessResult =
  | { processed: false }
  | { processed: true; jobId: string; status: "running" | "done" | "error"; step: number };

export async function processNextCourseGenJob(): Promise<ProcessResult> {
  const admin = createAdminClient();
  const staleThreshold = new Date(Date.now() - STALE_RUNNING_MS).toISOString();

  const { data: candidates, error: selectError } = await admin
    .from("ai_jobs")
    .select("id, tenant_id, status, input, output, tokens_in, tokens_out")
    .eq("kind", "course_gen")
    .or(`status.eq.queued,and(status.eq.running,updated_at.lt.${staleThreshold})`)
    .order("created_at", { ascending: true })
    .limit(1);

  if (selectError) {
    console.error("[generator/process] Job-Abfrage fehlgeschlagen:", selectError.message);
    return { processed: false };
  }
  const job = candidates?.[0];
  if (!job) return { processed: false };

  // Sperre setzen (compare-and-swap-artig: nur wenn Status seit dem Lesen
  // oben unverändert ist) — reduziert das Risiko einer doppelten
  // Verarbeitung bei zwei nahezu gleichzeitigen Cron-Aufrufen weiter, auch
  // wenn Postgres selbst keine echte Transaktion über beide Anfragen bietet.
  const { error: lockError } = await admin
    .from("ai_jobs")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", job.status);
  if (lockError) {
    console.error("[generator/process] Job konnte nicht gesperrt werden:", lockError.message);
    return { processed: false };
  }

  const parsedInput = courseGenInputSchema.safeParse(job.input);
  if (!parsedInput.success) {
    await updateAiJob(job.id, {
      status: "error",
      error: "Auftragseingabe ist ungültig oder beschädigt.",
    });
    return { processed: true, jobId: job.id, status: "error", step: 0 };
  }
  const input = parsedInput.data;

  const parsedOutput = courseGenOutputSchema.safeParse(job.output ?? { step: 0 });
  const output = parsedOutput.success ? parsedOutput.data : { step: 0 as const };
  const step = output.step;

  try {
    if (step === 0) {
      // Kontingent-Prüfung VOR dem ERSTEN Schritt, nicht pro Schritt
      // (Auftrag, CLAUDE.md §3.7 — fail-closed, siehe src/lib/ai/usage.ts).
      const quota = await enforceQuota(job.tenant_id, "course_gen");
      if (!quota.allowed) {
        await updateAiJob(job.id, {
          status: "error",
          error: "Monatliches KI-Kontingent für Kursgenerierung ist aufgebraucht.",
        });
        return { processed: true, jobId: job.id, status: "error", step };
      }

      const result = await generateOutlineStep(input.sourceText, input.titleHint);
      // status='queued' (NICHT 'running') — der Job ist zwischen zwei
      // Schritten "wartend", nicht "aktiv verarbeitet". Die
      // Job-Abfrage oben holt nur status='queued' ODER
      // status='running'-und-STALE (>3 Min) — würde hier fälschlich
      // 'running' stehen bleiben, könnte der nächste Cron-/Prozess-Aufruf
      // diesen Job erst nach 3 Minuten erneut aufgreifen, obwohl er
      // längst zum nächsten Schritt bereit ist (Fund beim manuellen Test,
      // Josip, 11.07.2026 — siehe PHASENSTATUS.md).
      await updateAiJob(job.id, {
        status: "queued",
        output: { step: 1, outline: result.data },
        model: AI_MODELS.sonnet,
        tokensIn: job.tokens_in + result.tokensIn,
        tokensOut: job.tokens_out + result.tokensOut,
      });
      return { processed: true, jobId: job.id, status: "running", step: 1 };
    }

    if (step === 1) {
      const outline = courseOutlineSchema.parse(output.outline);
      const result = await generateLessonContentStep(outline, input.sourceText);
      // status='queued', siehe Begründung im step===0-Zweig oben.
      await updateAiJob(job.id, {
        status: "queued",
        output: { step: 2, outline, content: result.data },
        model: AI_MODELS.sonnet,
        tokensIn: job.tokens_in + result.tokensIn,
        tokensOut: job.tokens_out + result.tokensOut,
      });
      return { processed: true, jobId: job.id, status: "running", step: 2 };
    }

    if (step === 2) {
      const content = courseContentSchema.parse(output.content);
      const result = await generateQuizStep(content);

      // Zusammenführung PER CODE statt per KI-Abtippen (Fund + Fix, siehe
      // Dateikopf-Kommentar quizStepOutputSchema in schema.ts): Claude
      // liefert nur noch die Quiz-Daten, hier werden sie positionsgetreu
      // mit dem bereits validierten `content` aus Schritt 2 verschmolzen.
      // Defensiv gegen eine unerwartet abweichende Modul-Anzahl in der
      // Antwort (sollte laut Prompt nicht vorkommen, aber lieber ein Modul
      // ohne Quiz als ein harter Absturz): fehlende Einträge -> quiz: null.
      const draft: CourseDraft = {
        title: content.title,
        description: content.description,
        modules: content.modules.map((mod, i) => ({
          ...mod,
          quiz: result.data.modules[i]?.quiz ?? null,
        })),
      };
      const validatedDraft = courseDraftSchema.parse(draft);

      await updateAiJob(job.id, {
        status: "done",
        output: { step: 3, outline: output.outline, content, draft: validatedDraft },
        model: AI_MODELS.sonnet,
        tokensIn: job.tokens_in + result.tokensIn,
        tokensOut: job.tokens_out + result.tokensOut,
      });
      return { processed: true, jobId: job.id, status: "done", step: 3 };
    }

    // step >= 3: Job war bereits fertig — sollte durch den Status-Filter der
    // obigen Abfrage (nur queued/stale-running) nicht erreichbar sein.
    // Defensiv trotzdem sauber abschließen statt eines erneuten Schritts.
    await updateAiJob(job.id, { status: "done" });
    return { processed: true, jobId: job.id, status: "done", step };
  } catch (e) {
    // e.message kann eine rohe/technische Meldung sein (z. B. eine
    // Anthropic-API-Fehlermeldung oder ein Zod-Validierungsfehler mit
    // englischem Standardtext) — volles Detail nur ins Server-Log, das in
    // `ai_jobs.error` gespeicherte (und im Admin-Panel angezeigte, siehe
    // ki-generator-panel.tsx) Feld bekommt einen klaren deutschen Satz.
    const message = e instanceof Error ? e.message : "Unbekannter Fehler bei der Kursgenerierung.";
    console.error(`[generator/process] Schritt fehlgeschlagen (Job ${job.id}, Schritt ${step}):`, message);
    await updateAiJob(job.id, {
      status: "error",
      error: "Die Kursgenerierung ist fehlgeschlagen. Bitte erneut versuchen.",
    });
    return { processed: true, jobId: job.id, status: "error", step };
  }
}
