"use server";

import { requireStaffTenant } from "@/lib/auth/staff";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { importCourseData } from "@/lib/import/course-import";
import type { ImportActionState } from "@/lib/import/state";
import { genericErrorMessage } from "@/lib/errors/generic";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB — reine Struktur-/Text-Daten, keine Binärdateien.

/**
 * Migrations-Importer (Phase 4, Block 4): Server Action für den JSON-Upload
 * im bestehenden Mandanten-Admin-Bereich (/admin/import). Jeder Mandant
 * importiert seine eigenen Altdaten — deshalb requireStaffTenant()
 * (analog courses/actions.ts), NICHT das Betreiber-Portal.
 *
 * Missbrauchsschutz (analog Phase 1 Block 4 „30 Video-Anlagen/Stunde"):
 * 10 Importe/Stunde pro Mandant — verhindert Kostenlawinen durch
 * wiederholte Fehlversuche (jeder erfolgreiche Video-Reupload kostet Bunny-
 * Speicher/-Traffic).
 */
export async function importCourseFromFile(
  _prevState: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  try {
    const { tenant, user, supabase } = await requireStaffTenant();

    if (
      !(await checkRateLimit("import-course", {
        maxRequests: 10,
        windowSeconds: 3600,
        extraKey: tenant.id,
      }))
    ) {
      return { error: RATE_LIMIT_MESSAGE };
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { error: "Bitte eine JSON-Datei auswählen." };
    }
    if (file.size === 0) {
      return { error: "Die ausgewählte Datei ist leer." };
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { error: "Datei zu groß (maximal 5 MB)." };
    }

    const text = await file.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { error: "Datei ist kein gültiges JSON." };
    }

    const result = await importCourseData(supabase, tenant, user.id, json);
    if (!result.ok) {
      return { error: "Import fehlgeschlagen — bitte Fehlerliste prüfen.", errors: result.errors };
    }

    return {
      error: null,
      success: true,
      courseId: result.courseId,
      moduleCount: result.moduleCount,
      lessonCount: result.lessonCount,
      videoCount: result.videoIds.length,
    };
  } catch (e) {
    return { error: genericErrorMessage(e) };
  }
}
