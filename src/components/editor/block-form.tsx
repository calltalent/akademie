"use client";

import { useState, useTransition } from "react";
import type { Block } from "@/lib/courses/schema";
import { VideoSourceSwitch } from "@/components/editor/video-source-switch";
import { createQuiz } from "@/lib/quiz/actions";

export type CourseQuizOption = { id: string; title: string };

const FIELD_BORDER = "#D8DAEA";
const FIELD_LABEL_COLOR = "#3E3F66";
const FIELD_TEXT_COLOR = "#1A1A2E";

const fieldClass = "w-full rounded-[11px] border px-[15px] py-[13px] text-base";
const labelClass = "flex flex-col gap-1.5 text-sm font-bold";

/**
 * Ein Formular je Block-Typ. Bewusst einfach gehalten (Textarea/Input statt
 * Rich-Text-Editor) — Rich-Text-WYSIWYG ist eine spätere Verfeinerung,
 * kein Kern-DoD-Kriterium für Phase 1.
 *
 * Design-Update (AdminKursEditor.dc.html) + Barrierefreiheit (CLAUDE.md
 * §3.4): jedes Feld hat jetzt ein sichtbares `<label>` statt teils nur eines
 * Platzhalters als einzige Beschriftung (Bild-URL, Audio-URL, Datei-URL/
 * Dateiname, Einbettungs-URL, Quiz-Beschriftung).
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
        <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
          Textinhalt
          <textarea
            value={block.html}
            onChange={(e) => onChange({ ...block, html: e.target.value })}
            rows={5}
            placeholder="Text (einfaches HTML möglich) …"
            className={`${fieldClass} resize-y leading-relaxed`}
            style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
          />
        </label>
      );

    case "callout":
      return (
        <div className="flex flex-col gap-3">
          <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
            Art des Hinweises
            <select
              value={block.variant}
              onChange={(e) =>
                onChange({ ...block, variant: e.target.value as typeof block.variant })
              }
              className={fieldClass}
              style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
            >
              <option value="info">Info</option>
              <option value="warning">Warnung</option>
              <option value="success">Erfolg</option>
            </select>
          </label>
          <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
            Hinweistext
            <textarea
              value={block.text}
              onChange={(e) => onChange({ ...block, text: e.target.value })}
              rows={3}
              placeholder="Hinweistext …"
              className={`${fieldClass} resize-y leading-relaxed`}
              style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
            />
          </label>
        </div>
      );

    case "image":
      return (
        <div className="flex flex-col gap-3">
          <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
            Bild-URL
            <input
              value={block.url}
              onChange={(e) => onChange({ ...block, url: e.target.value })}
              placeholder="https://…"
              className={fieldClass}
              style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
            />
          </label>
          <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
            Alt-Text (Barrierefreiheit, Pflicht)
            <input
              value={block.alt}
              onChange={(e) => onChange({ ...block, alt: e.target.value })}
              className={fieldClass}
              style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
            />
          </label>
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
        <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
          Audio-URL
          <input
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="https://…"
            className={fieldClass}
            style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
          />
        </label>
      );

    case "file":
      return (
        <div className="flex flex-col gap-3">
          <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
            Datei-URL
            <input
              value={block.url}
              onChange={(e) => onChange({ ...block, url: e.target.value })}
              placeholder="https://…"
              className={fieldClass}
              style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
            />
          </label>
          <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
            Dateiname
            <input
              value={block.filename}
              onChange={(e) => onChange({ ...block, filename: e.target.value })}
              className={fieldClass}
              style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
            />
          </label>
        </div>
      );

    case "embed":
      return (
        <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
          Einbettungs-URL (z. B. Google Slides, Figma)
          <input
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="https://…"
            className={fieldClass}
            style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
          />
        </label>
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
        <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
          Anweisungen für die Abgabe
          <textarea
            value={block.instructions}
            onChange={(e) => onChange({ ...block, instructions: e.target.value })}
            rows={3}
            placeholder="Anweisungen für die Abgabe …"
            className={`${fieldClass} resize-y leading-relaxed`}
            style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
          />
        </label>
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
    <div className="flex flex-col gap-3">
      <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
        Block-Beschriftung (optional)
        <input
          value={block.title}
          onChange={(e) => onChange({ ...block, title: e.target.value })}
          placeholder="z. B. „Abschlussquiz Modul 1“"
          className={fieldClass}
          style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
        />
      </label>

      <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
        Verknüpftes Quiz
        <select
          value={block.quizId ?? ""}
          onChange={(e) => onChange({ ...block, quizId: e.target.value || null })}
          className={fieldClass}
          style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR }}
        >
          <option value="">— kein Quiz —</option>
          {courseQuizzes.map((q) => (
            <option key={q.id} value={q.id}>
              {q.title}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-3.5">
        <button
          type="button"
          disabled={pending || !courseId}
          onClick={handleCreateQuiz}
          className="inline-flex items-center rounded-[10px] border bg-white px-3.5 py-2 text-sm font-bold disabled:opacity-50"
          style={{ borderColor: "#E7E8F2", color: FIELD_LABEL_COLOR }}
        >
          {pending ? "Wird angelegt …" : "Neues Quiz anlegen"}
        </button>
        {block.quizId && courseId && (
          <a
            href={`/admin/kurse/${courseId}/quiz/${block.quizId}`}
            className="text-sm font-semibold"
            style={{ color: "#5663AE" }}
          >
            Fragen bearbeiten →
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}
    </div>
  );
}
