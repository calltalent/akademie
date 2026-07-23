import type { Block } from "@/lib/courses/schema";
import { getBunnyVideo, getPlayerConfig } from "@/lib/bunny/client";
import { BunnyPlayer } from "@/components/player/bunny-player";
import { VideoProcessingStatus } from "@/components/learn/video-processing-status";
import { loadQuizForLearner } from "@/lib/quiz/load";
import { QuizRunner } from "@/components/learn/quiz-runner";
import { createClient } from "@/lib/supabase/server";
import { SubmissionForm, type LastSubmission } from "@/components/learn/submission-form";
import type { SubmissionKind, SubmissionStatus } from "@/lib/submissions/schema";

/**
 * Fenster, innerhalb dessen `BlockView` den zusätzlichen Bunny-Statusaufruf
 * für ein Video-Block macht (Josips Meldung 23.07.2026: "Processing video"
 * bleibt in der Lernansicht stehen, obwohl Bunny längst fertig ist — Bunnys
 * iframe-Player aktualisiert sich nie von selbst). Bewusst NICHT bei jedem
 * Lektionsaufruf: Performance-Budget CLAUDE.md §3.3 (Player-Start < 500 ms)
 * verbietet einen externen Bunny-Roundtrip auf JEDER Seitenanfrage einer
 * längst fertigen, monatealten Lektion. `lessons.video_bunny_id` wird nur
 * beim Speichern der Lektion geändert (courses/actions.ts) und der
 * `updated_at`-Trigger (0001_init.sql) läuft bei JEDER Speicherung — eine
 * kürzlich gespeicherte Lektion ist also ein zuverlässiger, kostenloser
 * Hinweis "hier könnte noch ein frisches Video verarbeitet werden".
 */
const RECENT_EDIT_WINDOW_MS = 30 * 60 * 1000;

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
export function BlockRenderer({
  blocks,
  lessonId,
  lessonUpdatedAt,
}: {
  blocks: Block[];
  lessonId: string;
  lessonUpdatedAt?: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} lessonId={lessonId} lessonUpdatedAt={lessonUpdatedAt} />
      ))}
      {blocks.length === 0 && (
        <p className="text-base text-gray-500">Diese Lektion hat noch keinen Inhalt.</p>
      )}
    </div>
  );
}

async function BlockView({
  block,
  lessonId,
  lessonUpdatedAt,
}: {
  block: Block;
  lessonId: string;
  lessonUpdatedAt?: string | null;
}) {
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
      // BUGFIX (23.07.2026, Block-Audit): url kann seit dem Schema-Fix
      // (courses/schema.ts, emptyOrUrl) leer sein — ein frisch angelegter,
      // noch nicht befüllter Block. Ohne diese Prüfung: kaputtes <img>.
      if (!block.url) {
        return (
          <div className="rounded-md border p-6 text-center text-base text-gray-500">Kein Bild ausgewählt.</div>
        );
      }
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

      // Siehe RECENT_EDIT_WINDOW_MS-Kommentar oben: nur bei kürzlich
      // gespeicherten Lektionen lohnt sich der zusätzliche Bunny-Aufruf.
      const editedAt = lessonUpdatedAt ? new Date(lessonUpdatedAt).getTime() : NaN;
      // eslint-disable-next-line react-hooks/purity -- async Server Component, läuft pro Request einmal (kein Re-Render/Memoization-Fall), siehe gleiches Muster in app/portal/mandanten/[id]/page.tsx
      const recentlyEdited = Number.isFinite(editedAt) && Date.now() - editedAt < RECENT_EDIT_WINDOW_MS;

      // Wie beim libraryId-Fix oben: Bunny-Aufruf + Auswertung nur im try,
      // JSX erst danach außerhalb gebaut (react-hooks/error-boundaries
      // erlaubt keine JSX-Konstruktion innerhalb von try/catch).
      let videoStatus: number | null = null;
      if (recentlyEdited) {
        try {
          videoStatus = (await getBunnyVideo(block.bunnyVideoId)).status;
        } catch {
          // Bunny-Statusabfrage fehlgeschlagen -> Player trotzdem anzeigen,
          // statt eine gesunde Lektion durch unseren eigenen Fehler zu blockieren.
          videoStatus = null;
        }
      }

      if (videoStatus === 5 || videoStatus === 6) {
        return (
          <div
            role="alert"
            className="rounded-md border p-6 text-center text-base"
            style={{ borderColor: "#E9CFCF", background: "#FBEAEA", color: "#B14A4A" }}
          >
            Video konnte nicht verarbeitet werden. Bitte im Kurs-Editor erneut hochladen.
          </div>
        );
      }
      if (videoStatus !== null && videoStatus !== 4) {
        return <VideoProcessingStatus lessonId={lessonId} />;
      }

      return <BunnyPlayer libraryId={libraryId} videoId={block.bunnyVideoId} />;
    }

    case "audio":
      // BUGFIX (23.07.2026, Block-Audit): s. Kommentar im "image"-Fall oben.
      if (!block.url) {
        return (
          <div className="rounded-md border p-6 text-center text-base text-gray-500">
            Keine Audiodatei ausgewählt.
          </div>
        );
      }
      return <audio controls src={block.url} className="w-full" />;

    case "file":
      if (!block.url) {
        return (
          <div className="rounded-md border p-6 text-center text-base text-gray-500">Keine Datei ausgewählt.</div>
        );
      }
      return (
        <a href={block.url} className="text-base underline" style={{ color: "var(--color-primary)" }}>
          Datei herunterladen: {block.filename}
        </a>
      );

    case "embed":
      if (!block.url) {
        return (
          <div className="rounded-md border p-6 text-center text-base text-gray-500">
            Keine Einbettungs-URL angegeben.
          </div>
        );
      }
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
