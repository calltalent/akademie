"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Bold, Italic, Underline } from "lucide-react";
import type { Block } from "@/lib/courses/schema";
import { VideoSourceSwitch } from "@/components/editor/video-source-switch";
import { ImageUpload } from "@/components/editor/image-upload";
import { createQuiz } from "@/lib/quiz/actions";

export type CourseQuizOption = { id: string; title: string };

const FIELD_BORDER = "#D8DAEA";
const FIELD_LABEL_COLOR = "#3E3F66";
const FIELD_TEXT_COLOR = "#1A1A2E";

const fieldClass = "w-full rounded-[11px] border px-[15px] py-[13px] text-base";
const labelClass = "flex flex-col gap-1.5 text-sm font-bold";

/**
 * Ein Formular je Block-Typ. Bewusst einfach gehalten (Input/Select statt
 * vollem Rich-Text-Editor) — einzige Ausnahme ist der Textblock, der seit
 * 18.07.2026 ein `contentEditable`-WYSIWYG mit Fett-/Kursiv-/
 * Unterstreichen-Toolbar hat (siehe `TextBlockFields` unten).
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
      return <TextBlockFields block={block} onChange={onChange} />;

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
          <ImageUpload
            currentUrl={block.url}
            onUploaded={(url) => onChange({ ...block, url })}
          />
          <label className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
            Bild-URL (oder direkt eine bereits gehostete Adresse eintragen)
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
 * Textformatierung (18.07.2026, Josips Auftrag: "Fetten, Kursiv,
 * Unterstrichenen Text ... Wörter im Satz je nach Bedarf boldieren,
 * unterstreichen oder kursiv setzen ... Symbole unter dem Textblock";
 * Folgeauftrag selben Tags: "Textinhalt nicht als HTML anzeigen, sondern als
 * normaler Text" + "Button dunkler wenn die Auswahl schon formatiert ist" +
 * "Standardtext soll nicht boldiert sein").
 *
 * Jetzt ein echtes WYSIWYG-Feld (`contentEditable`-`div` statt Roh-HTML-
 * `<textarea>`): fett/kursiv/unterstrichen erscheinen visuell, keine
 * sichtbaren `<strong>`-Tags mehr. `document.execCommand` übernimmt Toggle
 * + native Selektions-/Undo-Behandlung (kein eigener Range-Wrapping-Code
 * nötig) — `queryCommandState` liefert im Gegenzug gratis den aktiven
 * Formatierungsstatus der aktuellen Auswahl für die Button-Hervorhebung.
 *
 * Zwei Browser-Eigenheiten von execCommand brauchen Nacharbeit, sonst
 * verschwindet Formatierung beim Speichern lautlos:
 * - Bold/Italic erzeugen `<b>`/`<i>`, nicht `<strong>`/`<em>`. `schema.ts`s
 *   `sanitizeLessonHtml()`-Whitelist (`ALLOWED_TEXT_TAGS`) kennt nur
 *   Letztere — ein nicht erlaubtes Tag wird beim Speichern entfernt, aber
 *   der TEXT bleibt (Tag wird nur entpackt), d. h. die Formatierung selbst
 *   ginge unbemerkt verloren. Deshalb `normalizeFormattingTags()` vor jedem
 *   `onChange`.
 * - Enter erzeugt in Chrome standardmäßig verschachtelte `<div>` (ebenfalls
 *   nicht erlaubt → Absätze würden beim Speichern zusammenfallen). Fest auf
 *   `<p>` gestellt (`defaultParagraphSeparator`), das steht auf der
 *   Whitelist.
 *
 * `innerHTML` wird NUR beim ersten Mount aus `block.html` gesetzt
 * (unkontrolliertes Feld, wie ein `defaultValue`) — ein Re-Sync bei jedem
 * Tastendruck würde den Cursor auf Feldende zurückwerfen, weil
 * `contentEditable` anders als `<textarea>.value` keine Selektion über eine
 * `innerHTML`-Neuzuweisung hinweg erhält. Jede spätere `block.html`-Änderung
 * stammt ohnehin aus dem eigenen `onInput` dieser Instanz.
 *
 * `onMouseDown` mit `preventDefault()` auf den drei Knöpfen verhindert, dass
 * der Klick dem Button den Fokus gibt und damit die Textauswahl im Feld vor
 * dem `execCommand`-Aufruf zerstört — Standardmuster für contentEditable-
 * Toolbars.
 *
 * Die vom Auftrag verlangte dunklere Button-Hervorhebung ist zugleich ein
 * ARIA-Toggle-Button (`aria-pressed`), nicht nur eine Farbänderung
 * (CLAUDE.md §3.4: Zustand nie nur über Farbe).
 */
function TextBlockFields({
  block,
  onChange,
}: {
  block: Extract<Block, { type: "text" }>;
  onChange: (next: Block) => void;
}) {
  const editableRef = useRef<HTMLDivElement>(null);
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false });

  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    el.innerHTML = block.html;
    document.execCommand("defaultParagraphSeparator", false, "p");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function normalizeFormattingTags(html: string): string {
    return html
      .replace(/<(\/?)b(\s|>)/gi, "<$1strong$2")
      .replace(/<(\/?)i(\s|>)/gi, "<$1em$2");
  }

  function handleInput() {
    const el = editableRef.current;
    if (!el) return;
    onChange({ ...block, html: normalizeFormattingTags(el.innerHTML) });
  }

  function updateActiveFormats() {
    setActiveFormats({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
    });
  }

  function toggleFormat(command: "bold" | "italic" | "underline") {
    const el = editableRef.current;
    if (!el) return;
    el.focus();
    document.execCommand("defaultParagraphSeparator", false, "p");
    document.execCommand(command);
    handleInput();
    updateActiveFormats();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={labelClass} style={{ color: FIELD_LABEL_COLOR }}>
        Textinhalt
        <div
          ref={editableRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Textinhalt"
          data-placeholder="Text …"
          onInput={handleInput}
          onKeyUp={updateActiveFormats}
          onMouseUp={updateActiveFormats}
          onFocus={updateActiveFormats}
          // `:empty` greift nur ohne JEDES Kindelement — trifft den frisch
          // angelegten Block (html: "") zuverlässig, nicht zwingend jeden
          // Zustand nach manuellem Leerlöschen (manche Browser lassen dabei
          // ein einzelnes `<br>` zurück). Für ein einfaches Textfeld ist das
          // ein akzeptabler Kompromiss statt eines eigenen Placeholder-Overlays.
          className={`${fieldClass} min-h-[7.5rem] leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-[#8A8B9E]`}
          style={{ borderColor: FIELD_BORDER, color: FIELD_TEXT_COLOR, fontWeight: 400 }}
        />
      </div>
      <div className="flex gap-1.5" role="group" aria-label="Textformatierung für die Auswahl im Textfeld">
        <FormatButton
          active={activeFormats.bold}
          onClick={() => toggleFormat("bold")}
          label="Ausgewählten Text fett formatieren"
          title="Fett"
        >
          <Bold size={14} aria-hidden="true" />
        </FormatButton>
        <FormatButton
          active={activeFormats.italic}
          onClick={() => toggleFormat("italic")}
          label="Ausgewählten Text kursiv formatieren"
          title="Kursiv"
        >
          <Italic size={14} aria-hidden="true" />
        </FormatButton>
        <FormatButton
          active={activeFormats.underline}
          onClick={() => toggleFormat("underline")}
          label="Ausgewählten Text unterstreichen"
          title="Unterstrichen"
        >
          <Underline size={14} aria-hidden="true" />
        </FormatButton>
      </div>
    </div>
  );
}

function FormatButton({
  active,
  onClick,
  label,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border"
      style={{
        borderColor: active ? "#5663AE" : FIELD_BORDER,
        background: active ? "#5663AE" : "#fff",
        color: active ? "#fff" : FIELD_TEXT_COLOR,
      }}
    >
      {children}
    </button>
  );
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
