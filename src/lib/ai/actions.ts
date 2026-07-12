"use server";

import { requireStaffTenant } from "@/lib/auth/staff";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { embedCourse } from "@/lib/ai/embed";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Staff-Server-Action für den manuellen (Re-)Embed eines gesamten Kurses
 * (Phase 3, Block 2). Bewusst KEIN automatischer Embed-Trigger bei jedem
 * Lektions-Autosave in diesem Block — ein Trigger bei jedem Speichern wäre
 * teuer/unnötig-häufig (jede Tastatureingabe im Editor löst nach 1s-Debounce
 * ein Autosave aus, siehe `block-editor.tsx`). Verknüpfung mit dem
 * Speicher-Flow ist bewusst NICHT Teil dieses Blocks, kann bei Bedarf später
 * ergänzt werden (z. B. ein expliziter "Veröffentlichen"-Trigger).
 *
 * SICHERHEITSKRITISCH (wie im Auftrag verlangt, exakt so umgesetzt):
 * `courseId` MUSS zu `tenant.id` gehören, BEVOR `embedCourse()` überhaupt
 * aufgerufen wird — sonst könnte ein Staff-Mitglied über eine erratene
 * fremde `courseId` das Embedding eines fremden Mandanten-Kurses auslösen
 * (und dabei potenziell fremde Daten in die eigenen `embeddings`-Zeilen
 * schreiben lassen, wenn `embedCourse`/`embedLesson` das nicht selbst
 * prüften — sie tun es zusätzlich, siehe Dateikopf-Kommentar in `embed.ts`:
 * `tenantId` kommt dort IMMER aus diesem bereits geprüften Server-Kontext,
 * nie aus der geladenen Lektion/dem geladenen Kurs selbst — zweites
 * Sicherheitsnetz).
 *
 * Rate-Limiting ist die EINZIGE Kostenbremse für Embedding-Aufrufe in
 * diesem Block (kein `enforceQuota()` — Embedding ist nicht Teil von
 * `PLAN_AI_LIMITS`, siehe `embed.ts`-Dateikopf). 10 Aufrufe/Stunde/Mandant —
 * vorsichtiger als z. B. die Bunny-Video-Anlage (30/3600s), da ein einziger
 * Aufruf hier potenziell VIELE Lektionen auf einmal (und damit viele
 * Voyage-Aufrufe) auslöst.
 */
export async function reembedCourse(
  courseId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const { tenant, supabase } = await requireStaffTenant();

    if (
      !(await checkRateLimit("reembed-course", {
        maxRequests: 10,
        windowSeconds: 3600,
        extraKey: tenant.id,
      }))
    ) {
      return { success: false, message: RATE_LIMIT_MESSAGE };
    }

    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (courseError || !course) {
      return { success: false, message: "Kurs nicht gefunden oder falscher Mandant." };
    }

    const result = await embedCourse(courseId, tenant.id);
    return {
      success: true,
      message: `${result.lessonsEmbedded} Lektion(en) verarbeitet, ${result.chunksWritten} Chunk(s) gespeichert.`,
    };
  } catch (e) {
    return { success: false, message: genericErrorMessage(e) };
  }
}
