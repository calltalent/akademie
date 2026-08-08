"use server";

import { requireStaffTenant } from "@/lib/auth/staff";
import { getBunnyVideo, triggerTranscription } from "@/lib/bunny/client";
import { processVideoTranscript } from "@/lib/video/transcript";
import { createClient } from "@/lib/supabase/server";

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
 *
 * `processVideoTranscript()` ruft hier bewusst mit `{force:true}` (Teil 1,
 * Idempotenz-Sperre gegen doppelte Bunny-Webhook-Zustellungen, Plan
 * `calm-watching-dewdrop.md`): ohne `force` würde ein bereits vorhandenes
 * Transkript den Lauf sofort überspringen — Josips "Transkript
 * aktualisieren"-Knopf (z. B. nach Video-Austausch) muss aber bewusst neu
 * laufen können.
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

    const result = await processVideoTranscript(lesson.video_bunny_id, { force: true });
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

export type LessonVideoStatus = { ready: boolean; failed: boolean };

/**
 * Von `VideoProcessingStatus` (components/learn) client-seitig gepollt,
 * solange `block-renderer.tsx` eine kürzlich bearbeitete Lektion noch nicht
 * als fertig verarbeitet einstuft (siehe dortiger Kommentar) — Josips
 * Meldung 23.07.2026: Bunnys iframe-Player zeigt "Processing video" ohne
 * jede Selbstaktualisierung an, sobald die Verarbeitung fertig ist.
 *
 * Bewusst OHNE `requireStaffTenant()` — anders als `refreshLessonTranscript`
 * oben brauchen auch Kursteilnehmer diesen Aufruf (sie sehen frisch
 * hochgeladene Videos genauso). Autorisierung läuft stattdessen über RLS auf
 * `lessons` (derselbe `createClient()`-Client wie in block-renderer.tsx für
 * den submission-Fall): kann der aufrufende Nutzer die Zeile nicht lesen,
 * kommt `lesson` als `null` zurück, kein zusätzlicher App-seitiger Check
 * nötig.
 *
 * Fehler beim Bunny-Aufruf (Netzwerk, Rate-Limit) melden bewusst
 * `ready:false, failed:false` — "weiterpollen" statt fälschlich einen
 * Fehlerzustand zu zeigen (Plan-Philosophie "nie eine Sackgasse").
 */
export async function checkLessonVideoStatus(lessonId: string): Promise<LessonVideoStatus> {
  try {
    const supabase = await createClient();
    const { data: lesson } = await supabase
      .from("lessons")
      .select("video_bunny_id")
      .eq("id", lessonId)
      .maybeSingle();
    if (!lesson?.video_bunny_id) return { ready: true, failed: false };

    const { status } = await getBunnyVideo(lesson.video_bunny_id);
    return { ready: status === 4, failed: status === 5 || status === 6 };
  } catch (e) {
    // Nur die Fehlermeldung loggen, nicht das rohe Objekt (Security-Fix
    // 08.08.2026, Log-Hygiene-Audit NIEDRIG — konsistent mit dem sonstigen
    // Muster im Projekt, Bunny-Fehlerobjekte könnten Header-Rohdaten tragen).
    console.error("[video/actions] checkLessonVideoStatus fehlgeschlagen:", e instanceof Error ? e.message : e);
    return { ready: false, failed: false };
  }
}
