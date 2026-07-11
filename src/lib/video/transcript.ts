import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBunnyVideo, getCaptionVttUrl } from "@/lib/bunny/client";
import { parseVttToPlainText } from "@/lib/video/vtt";
import { createAnthropicClient } from "@/lib/ai/anthropic";
import { AI_MODELS, BUNNY_TRANSCRIBE_MODEL } from "@/lib/ai/config";
import { recordAiJob } from "@/lib/ai/usage";

/**
 * Kernstück von Phase 3, Block 6 (Auto-Transkript + Kapitel +
 * Zusammenfassung). Wird OHNE Nutzer-Session aufgerufen (Bunny-Webhook,
 * src/app/api/bunny/webhook/route.ts) ODER manuell über den
 * `refreshLessonTranscript()`-Ersatzweg (src/lib/video/actions.ts) —
 * deshalb durchgehend über den Admin-Client (analog `recordAiJob()`/
 * `updateAiJob()` aus Block 1/5, siehe Dateikopf-Kommentar dort).
 *
 * Wirft NIE nach außen — liefert stattdessen ein Ergebnisobjekt, damit sowohl
 * der Webhook (der nie werfen darf, um keinen Bunny-Retry-Sturm auszulösen)
 * als auch die Server Action (sanitized Error-Handling) einheitlich damit
 * umgehen können.
 */
export type ProcessTranscriptResult =
  | { ok: true; lessonId: string }
  | { ok: false; reason: "lesson_not_found" | "error"; message: string };

export async function processVideoTranscript(bunnyVideoId: string): Promise<ProcessTranscriptResult> {
  const admin = createAdminClient();

  // ABWEICHUNG/Voraussetzung (siehe PHASENSTATUS.md): lessons.video_bunny_id
  // wird seit diesem Block von saveLessonBlocks() (src/lib/courses/actions.ts)
  // synchron zum video-Block gepflegt — ohne das gäbe es hier nichts zu finden.
  const { data: lesson, error: lessonError } = await admin
    .from("lessons")
    .select("id, tenant_id, title")
    .eq("video_bunny_id", bunnyVideoId)
    .maybeSingle();

  if (lessonError || !lesson) {
    console.error(
      "[video/transcript] Keine Lektion zu Bunny-Video gefunden (unbekannte Video-GUID):",
      bunnyVideoId,
      lessonError?.message,
    );
    return { ok: false, reason: "lesson_not_found", message: "Keine Lektion zu diesem Video gefunden." };
  }

  try {
    const videoDetails = await getBunnyVideo(bunnyVideoId);

    // Transkript-Text: erste verfügbare Caption-Spur (wir fordern in
    // triggerTranscription() nur sourceLanguage "de" an, i. d. R. also genau
    // eine Spur). Fehlt eine URL (siehe UNSICHERHEITSPUNKT in bunny/client.ts)
    // oder schlägt der Abruf fehl: kein harter Fehler, nur kein Transkripttext
    // — Kapitel/Metadaten werden trotzdem gespeichert (Auftrag: "besser ein
    // eingeschränktes Ergebnis als ein kompletter Blocker").
    let transcriptText = "";
    const caption = videoDetails.captions[0];
    if (caption) {
      const vttUrl = getCaptionVttUrl(bunnyVideoId, caption.srclang);
      if (vttUrl) {
        try {
          const vttResponse = await fetch(vttUrl);
          if (vttResponse.ok) {
            transcriptText = parseVttToPlainText(await vttResponse.text());
          } else {
            console.error(
              "[video/transcript] VTT-Abruf fehlgeschlagen (Status):",
              vttResponse.status,
              vttUrl,
            );
          }
        } catch (vttError) {
          console.error(
            "[video/transcript] VTT-Abruf fehlgeschlagen:",
            vttError instanceof Error ? vttError.message : vttError,
          );
        }
      } else {
        console.error("[video/transcript] Keine CDN-Hostname konfiguriert - VTT-Abruf übersprungen.");
      }
    }

    // Bunny-STT-Kosten protokollieren (CLAUDE.md §3.7: jeder KI-Aufruf
    // schreibt ai_jobs). tokensIn = Videolänge in SEKUNDEN, computeCost()
    // rechnet das für "bunny-transcribe-ai" gesondert um (siehe quota.ts).
    // Bewusst KEIN enforceQuota() (siehe PHASENSTATUS.md Block-6-Plan:
    // automatischer Betriebskosten-Posten, keine nutzerausgelöste,
    // kontingentierte Aktion wie Tutor/Kurs-Generator).
    await recordAiJob({
      tenantId: lesson.tenant_id,
      kind: "transcript",
      model: BUNNY_TRANSCRIBE_MODEL,
      tokensIn: videoDetails.length,
      tokensOut: 0,
      status: "done",
      input: { bunnyVideoId },
      output: { chapterCount: videoDetails.chapters.length, hasTranscript: transcriptText.length > 0 },
    });

    // Zusammenfassung nur bei tatsächlich vorhandenem Transkripttext — ohne
    // Text kein sinnvoller/nötiger Claude-Aufruf.
    const summary =
      transcriptText.length > 0
        ? await summarizeTranscript(lesson.tenant_id, lesson.title, transcriptText)
        : null;

    const { error: updateError } = await admin
      .from("lessons")
      .update({
        video_duration_s: videoDetails.length > 0 ? videoDetails.length : null,
        transcript: transcriptText.length > 0 ? transcriptText : null,
        summary,
        chapters: videoDetails.chapters,
      })
      .eq("id", lesson.id);

    if (updateError) {
      console.error("[video/transcript] Lektion-Update fehlgeschlagen:", updateError.message);
      return { ok: false, reason: "error", message: "Speichern des Transkripts fehlgeschlagen." };
    }

    return { ok: true, lessonId: lesson.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unbekannter Fehler bei der Transkript-Verarbeitung.";
    console.error("[video/transcript] Ausnahme:", message);
    await recordAiJob({
      tenantId: lesson.tenant_id,
      kind: "transcript",
      model: BUNNY_TRANSCRIBE_MODEL,
      tokensIn: 0,
      tokensOut: 0,
      status: "error",
      input: { bunnyVideoId },
      error: message,
    });
    return { ok: false, reason: "error", message: "Transkript-Verarbeitung fehlgeschlagen." };
  }
}

/**
 * Claude Haiku (SPEC §6: "Zusammenfassung claude-haiku"). Fail-soft: ein
 * Fehler hier darf das bereits ermittelte Transkript nicht verwerfen — die
 * aufrufende Funktion speichert Transkript/Kapitel auch bei `summary: null`.
 */
async function summarizeTranscript(
  tenantId: string,
  lessonTitle: string,
  transcript: string,
): Promise<string | null> {
  try {
    const anthropic = createAnthropicClient();
    // Kosten-/Kontextschutz bei sehr langen Transkripten.
    const truncated = transcript.length > 12000 ? `${transcript.slice(0, 12000)} …` : transcript;

    const response = await anthropic.messages.create({
      model: AI_MODELS.haiku,
      max_tokens: 400,
      system:
        "Du fasst Video-Transkripte von Online-Kurs-Lektionen auf Deutsch zusammen. " +
        "Antworte NUR mit der Zusammenfassung (3-5 Sätze, Fließtext), ohne Einleitung, ohne Aufzählungszeichen.",
      messages: [{ role: "user", content: `Lektion „${lessonTitle}". Transkript:\n\n${truncated}` }],
    });

    const text = response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;
    await recordAiJob({
      tenantId,
      kind: "summary",
      model: AI_MODELS.haiku,
      tokensIn,
      tokensOut,
      status: "done",
      input: { lessonTitle },
    });

    return text.length > 0 ? text : null;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unbekannter Fehler bei der Zusammenfassung.";
    console.error(
      "[video/transcript] Zusammenfassung fehlgeschlagen (fail-soft, Transkript bleibt erhalten):",
      message,
    );
    await recordAiJob({
      tenantId,
      kind: "summary",
      model: AI_MODELS.haiku,
      tokensIn: 0,
      tokensOut: 0,
      status: "error",
      input: { lessonTitle },
      error: message,
    });
    return null;
  }
}
