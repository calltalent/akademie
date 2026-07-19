"use server";

import { revalidatePath } from "next/cache";
import { requireStaffTenant } from "@/lib/auth/staff";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { courseGenInputSchema } from "@/lib/generator/schema";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";

type GeneratorActionState = { error: string | null; success?: boolean };

function errorState(e: unknown): GeneratorActionState {
  return { error: genericErrorMessage(e) };
}

/**
 * "Erneut versuchen" bei fehlgeschlagenen Entwürfen (Design-Import
 * AdminKiGenerator.dc.html, 19.07.2026). Legt einen NEUEN `ai_jobs`-Eintrag
 * mit demselben bereits extrahierten Text (`input.sourceText`) an — kein
 * erneutes Hochladen/PDF-Extrahieren nötig, der nächste Cron-Tick
 * (alle 2 Min., siehe api/admin/ki/process/route.ts) verarbeitet ihn wie
 * einen ganz normalen neuen Auftrag. Derselbe Rate-Limiter wie der
 * ursprüngliche Upload (`ki-generate`, max. 5/Std./Mandant) — jeder Versuch
 * löst denselben kostenpflichtigen Claude-Aufruf aus, ein Retry-Knopf darf
 * dieses Limit nicht umgehen können.
 */
export async function retryDraft(jobId: string): Promise<GeneratorActionState> {
  try {
    const { tenant, user, supabase } = await requireStaffTenant();

    if (
      !(await checkRateLimit("ki-generate", {
        maxRequests: 5,
        windowSeconds: 3600,
        extraKey: tenant.id,
      }))
    ) {
      return { error: RATE_LIMIT_MESSAGE };
    }

    const { data: job } = await supabase
      .from("ai_jobs")
      .select("input")
      .eq("id", jobId)
      .eq("tenant_id", tenant.id)
      .eq("kind", "course_gen")
      .maybeSingle();
    if (!job) return { error: "Entwurf nicht gefunden." };

    const parsedInput = courseGenInputSchema.safeParse(job.input ?? {});
    if (!parsedInput.success) {
      return { error: "Ursprünglicher Auftrag ist beschädigt — bitte Dokument erneut hochladen." };
    }

    const { error } = await supabase.from("ai_jobs").insert({
      tenant_id: tenant.id,
      kind: "course_gen",
      status: "queued",
      input: parsedInput.data,
      output: { step: 0 },
      tokens_in: 0,
      tokens_out: 0,
      created_by: user.id,
    });
    if (error) return { error: translateDbError(error) };

    revalidatePath("/admin/ki");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * "Entwurf löschen" (Design-Import AdminKiGenerator.dc.html). Löscht nur
 * die `ai_jobs`-Zeile (die Audit-Spur der Generierung), NICHT einen bereits
 * daraus übernommenen Kurs — es gibt bewusst keine Fremdschlüsselbindung
 * zwischen `ai_jobs.output.appliedCourseId` und `courses`, der Kurs ist ab
 * seiner Anlage eine eigenständige, unabhängige Zeile.
 */
export async function deleteDraft(jobId: string): Promise<GeneratorActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();

    const { error } = await supabase
      .from("ai_jobs")
      .delete()
      .eq("id", jobId)
      .eq("tenant_id", tenant.id)
      .eq("kind", "course_gen");
    if (error) return { error: translateDbError(error) };

    revalidatePath("/admin/ki");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}
