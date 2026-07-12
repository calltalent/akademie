import type { Block } from "@/lib/courses/schema";
import { getPlayerConfig } from "@/lib/bunny/client";
import { BunnyPlayer } from "@/components/player/bunny-player";
import { loadQuizForLearner } from "@/lib/quiz/load";
import { QuizRunner } from "@/components/learn/quiz-runner";
import { createClient } from "@/lib/supabase/server";
import { SubmissionForm, type LastSubmission } from "@/components/learn/submission-form";
import type { SubmissionKind, SubmissionStatus } from "@/lib/submissions/schema";

/**
 * Read-only-Darstellung der Blöcke in der Lernansicht.
 * `text.html` kommt aus dem Editor (Block 3), der nur eigene Staff-Nutzer
 * schreiben können (RLS `lessons_staff_write`) — daher kein zusätzliches
 * Sanitizing hier nötig (kein nutzergenerierter Fremdinhalt), aber die
 * grundsätzliche XSS-Fläche ist bewusst dokumentiert für den
 * security-reviewer.
 *
 * `BlockView` ist eine async Server Component (Block 2/Phase 2: der
 * quiz-Fall lädt das verknüpfte Quiz serverseitig über loadQuizForLearner
 * und übergibt nur die whitelisted Daten als Props an den Client-Component
 * QuizRunner — folgt demselben "Server lädt, Client rendert"-Muster wie
 * BunnyPlayer/getPlayerConfig weiter unten; der submission-Fall (Block 3)
 * folgt demselben Muster für die letzte eigene Abgabe des Nutzers).
 */
export function BlockRenderer({ blocks, lessonId }: { blocks: Block[]; lessonId: string }) {
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} lessonId={lessonId} />
      ))}
      {blocks.length === 0 && (
        <p className="text-base text-gray-500">Diese Lektion hat noch keinen Inhalt.</p>
      )}
    </div>
  );
}

async function BlockView({ block, lessonId }: { block: Block; lessonId: string }) {
  switch (block.type) {
    case "text":
      // Inhalt stammt nur von Staff (RLS lessons_staff_write), kein
      // nutzergenerierter Fremdinhalt — dangerouslySetInnerHTML ist hier
      // bewusst und sicher (react/no-danger feuert in diesem Projekt nicht,
      // eslint-disable-Kommentar entfernt: Josips Lint-Lauf 12.07.2026
      // meldete ihn als "unused eslint-disable directive").
      return <div className="text-base leading-relaxed" dangerouslySetInnerHTML={{ __html: block.html }} />;

    case "callout": {
      const bg =
        block.variant === "warning"
          ? "bg-amber-50 border-amber-300"
          : block.variant === "success"
            ? "bg-green-50 border-green-300"
            : "bg-blue-50 border-blue-300";
      return <div className={`rounded-md border p-4 text-base ${bg}`}>{block.text}</div>;
    }

    case "image":
      // eslint-disable-next-line @next/next/no-img-element -- externe/Storage-URLs, kein next/image-Loader konfiguriert
      return <img src={block.url} alt={block.alt} className="w-full rounded-md" />;

    case "video": {
      if (!block.bunnyVideoId) {
        return (
          <div className="rounded-md border p-6 text-center text-base text-gray-500">
            Kein Video zugewiesen.
          </div>
        );
      }
      // Korrektur (Josips Lint-Lauf, 12.07.2026): "Avoid constructing JSX
      // within try/catch" (react-hooks/error-boundaries) — libraryId wird
      // jetzt im try ermittelt, das JSX erst danach außerhalb gebaut.
      let libraryId: string | null = null;
      try {
        libraryId = getPlayerConfig().libraryId;
      } catch {
        libraryId = null;
      }
      if (!libraryId) {
        return (
          <div className="rounded-md border p-6 text-center text-base text-gray-500">
            Video-Player nicht verfügbar (Bunny Stream nicht konfiguriert).
          </div>
        );
      }
      return <BunnyPlayer libraryId={libraryId} videoId={block.bunnyVideoId} />;
    }

    case "audio":
      return <audio controls src={block.url} className="w-full" />;

    case "file":
      return (
        <a href={block.url} className="text-base underline" style={{ color: "var(--color-primary)" }}>
          Datei herunterladen: {block.filename}
        </a>
      );

    case "embed":
      return (
        <iframe
          src={block.url}
          className="aspect-video w-full rounded-md border"
          title="Eingebetteter Inhalt"
        />
      );

    case "quiz": {
      if (!block.quizId) {
        return (
          <div className="rounded-md border p-4 text-base text-gray-500">Kein Quiz verknüpft.</div>
        );
      }
      const result = await loadQuizForLearner(block.quizId);
      if (!result.ok) {
        return (
          <div className="rounded-md border p-4 text-base text-gray-500">
            Quiz aktuell nicht verfügbar.
          </div>
        );
      }
      return <QuizRunner quiz={result.quiz} />;
    }

    case "submission": {
      // submissions hat kein block_id-Feld (siehe lib/submissions/schema.ts) —
      // "letzte eigene Abgabe" wird pro lessonId ermittelt. Mehrere
      // Abgabe-Blöcke in derselben Lektion würden sich dieselbe Historie
      // teilen (dokumentierte Vereinfachung, siehe PHASENSTATUS.md).
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let lastSubmission: LastSubmission | null = null;
      if (user) {
        const { data } = await supabase
          .from("submissions")
          .select("id, kind, status, feedback, created_at")
          .eq("lesson_id", lessonId)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) {
          lastSubmission = {
            id: data.id,
            kind: data.kind as SubmissionKind,
            status: data.status as SubmissionStatus,
            feedback: data.feedback,
            createdAt: data.created_at,
          };
        }
      }

      return (
        <SubmissionForm lessonId={lessonId} instructions={block.instructions} lastSubmission={lastSubmission} />
      );
    }
  }
}
