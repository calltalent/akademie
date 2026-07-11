"use server";

import { requireStaffTenant } from "@/lib/auth/staff";
import { getBunnyVideo, triggerTranscription } from "@/lib/bunny/client";
import { processVideoTranscript } from "@/lib/video/transcript";

/**
 * Phase 3, Block 6 (Auto-Transkript). Manueller Ersatzweg für den lokal
 * nicht erreichbaren Bunny-Webhook (gleiches Grundmuster wie der manuelle
 * PowerShell-Cron-Ersatz für den Kurs-Generator aus Block 5) UND produktive
 * "Transkript aktualisieren"-Funktion (z. B. nach Video-Austausch).
 *
 * Zwei Aufrufe können nötig sein, je nach Bunny-Zustand:
 * 1. Aufruf, solange Bunny noch keine Captions hat: stößt die Transkription
 *    an (entspricht Webhook-`Status: 3`), meldet "gestartet".
 * 2. Aufruf, sobald Bunny fertig ist (produktiv per Webhook-`Status: 9`
 *    automatisch, hier manuell erneut ausgelöst): Captions vorhanden ->
 *    holt Transkript/Kapitel/Zusammenfassung und speichert sie
 *    (`processVideoTranscript()`).
 *
 * Ownership-Check über `requireStaffTenant()` + `.eq("tenant_id", …)` —
 * Defense-in-Depth wie überall (Muster aus courses/actions.ts), bevor
 * irgendetwas gegen Bunny ausgelöst wird.
 */

export type RefreshTranscriptResult = { ok: boolean; message: string };

export async function refreshLessonTranscript(lessonId: string): Promise<RefreshTranscriptResult> {
  try {
    const { tenant, supabase } = await requireStaffTenant();

    const { data: lesson, error: lessonError } = await supabase
      .from("lessons")
      .select("id, video_bunny_id")
      .eq("id", lessonId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (lessonError || !lesson) {
      return { ok: false, message: "Lektion nicht gefunden." };
    }
    if (!lesson.video_bunny_id) {
      return { ok: false, message: "Dieser Lektion ist kein Video zugewiesen." };
    }

    const videoDetails = await getBunnyVideo(lesson.video_bunny_id);

    if (videoDetails.captions.length === 0) {
      await triggerTranscription(lesson.video_bunny_id, { generateChapters: true, sourceLanguage: "de" });
      return {
        ok: true,
        message:
          "Transkription bei Bunny gestartet — kann einige Minuten dauern. Diesen Knopf danach erneut klicken.",
      };
    }

    const result = await processVideoTranscript(lesson.video_bunny_id);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
    return { ok: true, message: "Transkript, Kapitel und Zusammenfassung aktualisiert." };
  } catch (e) {
    // Sanitized Error-Handling (Muster aus src/lib/tutor/actions.ts): nie
    // e.message roh an die UI weiterreichen.
    const message = e instanceof Error ? e.message : "Unbekannter Fehler.";
    console.error("[video/actions] refreshLessonTranscript fehlgeschlagen:", message);
    return { ok: false, message: "Aktualisierung fehlgeschlagen. Bitte später erneut versuchen." };
  }
}
