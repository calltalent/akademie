"use client";

import { useState, useTransition } from "react";
import type { Block } from "@/lib/courses/schema";
import { VideoSourceSwitch } from "@/components/editor/video-source-switch";
import { createQuiz } from "@/lib/quiz/actions";

export type CourseQuizOption = { id: string; title: string };

/**
 * Ein Formular je Block-Typ. Bewusst einfach gehalten (Textarea/Input statt
 * Rich-Text-Editor) — Rich-Text-WYSIWYG ist eine spätere Verfeinerung,
 * kein Kern-DoD-Kriterium für Phase 1.
 */
export function BlockForm({
  block,
  onChange,
  courseId,
  courseQuizzes = [],
}: {
  block: Block;
  onChange: (next: Block) => void;
  /** Nur für den quiz-Block-Typ nötig (Block 2/Phase 2). */
  courseId?: string;
  courseQuizzes?: CourseQuizOption[];
}) {
  switch (block.type) {
    case "text":
      return (
        <textarea
          value={block.html}
          onChange={(e) => onChange({ ...block, html: e.target.value })}
          rows={5}
          placeholder="Text (einfaches HTML möglich) …"
          className="w-full rounded-md border px-3 py-2 text-base"
        />
      );

    case "callout":
      return (
        <div className="flex flex-col gap-2">
          <select
            value={block.variant}
            onChange={(e) =>
              onChange({ ...block, variant: e.target.value as typeof block.variant })
            }
            className="rounded-md border px-3 py-2 text-base"
          >
            <option value="info">Info</option>
            <option value="warning">Warnung</option>
            <option value="success">Erfolg</option>
          </select>
          <textarea
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            rows={3}
            placeholder="Hinweistext …"
            className="w-full rounded-md border px-3 py-2 text-base"
          />
        </div>
      );

    case "image":
      return (
        <div className="flex flex-col gap-2">
          <input
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="Bild-URL"
            className="w-full rounded-md border px-3 py-2 text-base"
          />
          <input
            value={block.alt}
            onChange={(e) => onChange({ ...block, alt: e.target.value })}
            placeholder="Alt-Text (Barrierefreiheit, Pflicht)"
            className="w-full rounded-md border px-3 py-2 text-base"
          />
        </div>
      );

    case "video":
      return (
        <VideoSourceSwitch
          currentVideoId={block.bunnyVideoId}
          onUploaded={(videoId) => onChange({ ...block, bunnyVideoId: videoId })}
        />
      );

    case "audio":
      return (
        <input
          value={block.url}
          onChange={(e) => onChange({ ...block, url: e.target.value })}
          placeholder="Audio-URL"
          className="w-full rounded-md border px-3 py-2 text-base"
        />
      );

    case "file":
      return (
        <div className="flex flex-col gap-2">
          <input
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="Datei-URL"
            className="w-full rounded-md border px-3 py-2 text-base"
          />
          <input
            value={block.filename}
            onChange={(e) => onChange({ ...block, filename: e.target.value })}
            placeholder="Dateiname"
            className="w-full rounded-md border px-3 py-2 text-base"
          />
        </div>
      );

    case "embed":
      return (
        <input
          value={block.url}
          onChange={(e) => onChange({ ...block, url: e.target.value })}
          placeholder="Einbettungs-URL (z. B. Google Slides, Figma)"
          className="w-full rounded-md border px-3 py-2 text-base"
        />
      );

    case "quiz":
      return (
        <QuizBlockFields
          block={block}
          onChange={onChange}
          courseId={courseId}
          courseQuizzes={courseQuizzes}
        />
      );

    case "submission":
      return (
        <textarea
          value={block.instructions}
          onChange={(e) => onChange({ ...block, instructions: e.target.value })}
          rows={3}
          placeholder="Anweisungen für die Abgabe …"
          className="w-full rounded-md border px-3 py-2 text-base"
        />
      );
  }
}

/**
 * Block 2/Phase 2: Auswahl/Verlinkung zu bestehenden Quizzen des Kurses +
 * „Neues Quiz anlegen". Das eigentliche Fragen-Editing passiert auf der
 * separaten Seite /admin/kurse/[id]/quiz/[quizId] — hier wird nur die
 * quizId auf dem Block gesetzt (analog zu VideoSourceSwitch/bunnyVideoId oben).
 */
function QuizBlockFields({
  block,
  onChange,
  courseId,
  courseQuizzes,
}: {
  block: Extract<Block, { type: "quiz" }>;
  onChange: (next: Block) => void;
  courseId?: string;
  courseQuizzes: CourseQuizOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreateQuiz() {
    if (!courseId) return;
    setError(null);
    startTransition(async () => {
      const result = await createQuiz(courseId, block.title || "Neues Quiz");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChange({ ...block, quizId: result.id });
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        value={block.title}
        onChange={(e) => onChange({ ...block, title: e.target.value })}
        placeholder="Block-Beschriftung (optional, z. B. „Abschlussquiz Modul 1“)"
        className="w-full rounded-md border px-3 py-2 text-base"
      />

      <label className="flex flex-col gap-1 text-sm">
        Verknüpftes Quiz
        <select
          value={block.quizId ?? ""}
          onChange={(e) => onChange({ ...block, quizId: e.target.value || null })}
          className="rounded-md border px-3 py-2 text-base"
        >
          <option value="">— kein Quiz —</option>
          {courseQuizzes.map((q) => (
            <option key={q.id} value={q.id}>
              {q.title}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || !courseId}
          onClick={handleCreateQuiz}
          className="self-start rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        >
          {pending ? "Wird angelegt …" : "Neues Quiz anlegen"}
        </button>
        {block.quizId && courseId && (
          <a
            href={`/admin/kurse/${courseId}/quiz/${block.quizId}`}
            className="text-sm underline"
          >
            Fragen bearbeiten →
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
