"use client";

import type { ReactNode } from "react";
import { useActionState, useState } from "react";
import { ChevronDown, ChevronUp, ImageIcon, Plus, Trash2, Video } from "lucide-react";
import {
  createModule,
  createSection,
  createLesson,
  deleteModule,
  deleteSection,
  deleteLesson,
  moveModule,
  moveSection,
  updateModuleCoverUrl,
  updateModuleDescription,
  updateSectionDescription,
} from "@/lib/courses/actions";
import { initialCourseActionState } from "@/lib/courses/state";
import { ThumbnailUpload } from "@/components/admin/thumbnail-upload";

type LessonRow = {
  id: string;
  title: string;
  status: string;
  /** Erster Video-/Bild-Block der Lektion (siehe getLessonMedia() in page.tsx) — null ohne Medien-Block. */
  kind: "video" | "image" | null;
  thumbnailUrl: string | null;
};
type SectionRow = { id: string; title: string; description: string | null; lessons: LessonRow[] };
type ModuleRow = {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  sections: SectionRow[];
  /** Lektionen mit `section_id = null` — vor Migration 20260718150000
   * angelegt, oder über den KI-Generator/CSV-Import entstanden (beide
   * schreiben weiterhin direkt auf `module_id`, ohne Sektion). Bleiben
   * sichtbar statt zu verschwinden, siehe Kopfkommentar unten. */
  looseLessons: LessonRow[];
};

/**
 * Design-Update (AdminKursEditor.dc.html): Modul-/Lektionsbaum als
 * eigenständige weiße Karten statt roher `border`-Kästen. Lektions-Status
 * (Entwurf/Veröffentlicht) als Farb-Chip, die aktive Lektion zusätzlich zur
 * Hintergrundfarbe über einen linken Akzentbalken + kräftigere Schrift
 * hervorgehoben (CLAUDE.md §3.4: Zustand nie nur über Farbe).
 *
 * SEKTIONEN (18.07.2026, Josips Auftrag): neue Zwischenebene Modul ->
 * Sektion -> Lektion (Migration 20260718150000_sections.sql). Bewusst
 * ADDITIV umgesetzt — `lessons.module_id` bleibt die Pflichtspalte,
 * `section_id` ist zusätzlich und NULLABLE. Lektionen werden jetzt INNERHALB
 * einer Sektion angelegt (`createLesson()` nimmt eine `sectionId`, keine
 * `moduleId` mehr entgegen). Ein frisch angelegtes Modul hat 0 Sektionen —
 * die erste Aktion ist also "Neue Sektion", nicht mehr "Neue Lektion" (genau
 * der vom Auftrag verlangte Ablauf: "nach der Modulerstellung auch die
 * Option für Sektionen").
 *
 * `looseLessons` (Lektionen ohne section_id) werden NICHT versteckt: der
 * KI-Kursgenerator (`lib/generator/apply.ts`) und der CSV-Import
 * (`lib/import/course-import.ts`) legen Lektionen weiterhin direkt unters
 * Modul, ohne Sektion — sie erscheinen unter "Lektionen ohne Sektion" am
 * Ende des Moduls, damit sie im Editor auffindbar und bearbeitbar bleiben
 * statt lautlos zu verschwinden.
 *
 * MODULBILD (19.07.2026, Josips Auftrag: "ähnlich wie für Kurse"): gleiche
 * anklickbare 16:9-Kachel wie beim Kurs-Thumbnail, nur auf `modules.cover_url`
 * (Migration 20260719090000) statt `courses.cover_url` — beide teilen sich
 * `components/admin/thumbnail-upload.tsx`.
 */
const LESSON_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  published: { label: "Veröffentlicht", color: "#1F8A5B", bg: "#E3F2EA" },
  draft: { label: "Entwurf", color: "#1A1A2E", bg: "#F7EED4" },
};

export function ModuleLessonTree({
  courseId,
  modules,
  activeLessonId,
}: {
  courseId: string;
  modules: ModuleRow[];
  activeLessonId?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {modules.map((mod, idx) => (
        <ModuleBlock
          key={mod.id}
          courseId={courseId}
          module={mod}
          isFirst={idx === 0}
          isLast={idx === modules.length - 1}
          activeLessonId={activeLessonId}
        />
      ))}
      <NewModuleForm courseId={courseId} />
    </div>
  );
}

function ModuleBlock({
  courseId,
  module: mod,
  isFirst,
  isLast,
  activeLessonId,
}: {
  courseId: string;
  module: ModuleRow;
  isFirst: boolean;
  isLast: boolean;
  activeLessonId?: string;
}) {
  return (
    <div className="rounded-[14px] border bg-white p-3.5" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-3 flex items-center gap-2.5">
        <ThumbnailUpload
          initialUrl={mod.coverUrl}
          entityLabel="Modulbild"
          entityTitle={mod.title}
          onUpload={updateModuleCoverUrl.bind(null, mod.id, courseId)}
        />
        <span className="min-w-0 flex-1 break-words text-[16px] font-extrabold" style={{ color: "#1A1A2E" }}>
          {mod.title}
        </span>
        <IconButton label="Modul nach oben" disabled={isFirst} onClick={() => moveModule(mod.id, courseId, "up")}>
          <ChevronUp size={15} aria-hidden="true" />
        </IconButton>
        <IconButton label="Modul nach unten" disabled={isLast} onClick={() => moveModule(mod.id, courseId, "down")}>
          <ChevronDown size={15} aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Modul löschen"
          danger
          onClick={() => {
            if (confirm(`Modul „${mod.title}" wirklich löschen?`)) {
              deleteModule(mod.id, courseId);
            }
          }}
        >
          <Trash2 size={15} aria-hidden="true" />
        </IconButton>
      </div>

      <DescriptionField
        initialValue={mod.description}
        placeholder="Kurze Beschreibung unter dem Modultitel (optional) …"
        onSave={(value) => updateModuleDescription(mod.id, courseId, value)}
      />

      <div className="mt-3 flex flex-col gap-3">
        {mod.sections.map((section, sIdx) => (
          <SectionBlock
            key={section.id}
            courseId={courseId}
            moduleId={mod.id}
            section={section}
            isFirst={sIdx === 0}
            isLast={sIdx === mod.sections.length - 1}
            activeLessonId={activeLessonId}
          />
        ))}

        {mod.looseLessons.length > 0 && (
          <div className="rounded-[10px] p-2.5" style={{ background: "#FBF6EA" }}>
            <div className="mb-1.5 text-[12px] font-bold" style={{ color: "#8A6D2F" }}>
              Lektionen ohne Sektion
            </div>
            <LessonList
              courseId={courseId}
              lessons={mod.looseLessons}
              activeLessonId={activeLessonId}
            />
          </div>
        )}
      </div>

      <div className="mt-3">
        <NewSectionForm courseId={courseId} moduleId={mod.id} />
      </div>
    </div>
  );
}

function SectionBlock({
  courseId,
  moduleId,
  section,
  isFirst,
  isLast,
  activeLessonId,
}: {
  courseId: string;
  moduleId: string;
  section: SectionRow;
  isFirst: boolean;
  isLast: boolean;
  activeLessonId?: string;
}) {
  return (
    <div className="rounded-[11px] border p-2.5" style={{ borderColor: "#EEF0F7", background: "#FAFAFD" }}>
      <div className="mb-2 flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-4 w-0.5 flex-none rounded-full"
          style={{ background: "#A9AAC4" }}
        />
        <span className="min-w-0 flex-1 break-words text-[14px] font-bold" style={{ color: "#3E3F66" }}>
          {section.title}
        </span>
        <IconButton
          small
          label="Sektion nach oben"
          disabled={isFirst}
          onClick={() => moveSection(section.id, moduleId, courseId, "up")}
        >
          <ChevronUp size={13} aria-hidden="true" />
        </IconButton>
        <IconButton
          small
          label="Sektion nach unten"
          disabled={isLast}
          onClick={() => moveSection(section.id, moduleId, courseId, "down")}
        >
          <ChevronDown size={13} aria-hidden="true" />
        </IconButton>
        <IconButton
          small
          label="Sektion löschen"
          danger
          onClick={() => {
            const msg =
              section.lessons.length > 0
                ? `Sektion „${section.title}" löschen? ${section.lessons.length} ${section.lessons.length === 1 ? "Lektion bleibt" : "Lektionen bleiben"} erhalten und rutscht/rutschen ins Modul (ohne Sektion).`
                : `Sektion „${section.title}" wirklich löschen?`;
            if (confirm(msg)) {
              deleteSection(section.id, courseId);
            }
          }}
        >
          <Trash2 size={13} aria-hidden="true" />
        </IconButton>
      </div>

      <DescriptionField
        initialValue={section.description}
        placeholder="Kurze Beschreibung unter der Sektionsüberschrift (optional) …"
        onSave={(value) => updateSectionDescription(section.id, courseId, value)}
      />

      <div className="mt-2">
        <LessonList courseId={courseId} lessons={section.lessons} activeLessonId={activeLessonId} />
      </div>

      <div className="mt-2">
        <NewLessonForm courseId={courseId} sectionId={section.id} />
      </div>
    </div>
  );
}

/**
 * Beschreibungsfeld unter Modul-/Sektionstitel (Josips Auftrag, 23.07.2026 —
 * eigenständige Umsetzung nach dem allgemeinen Muster "Überschrift + kurzer
 * Untertext", kein übernommenes Fremd-Design/-Text, siehe CLAUDE.md §3.1).
 * Speichert per `onBlur` (gleiches Muster wie der Lektionstitel in
 * block-editor.tsx) statt bei jedem Tastendruck — unkontrolliertes Feld mit
 * lokalem State, `initialValue` wirkt nur beim ersten Mount (wie `defaultValue`).
 */
function DescriptionField({
  initialValue,
  placeholder,
  onSave,
}: {
  initialValue: string | null;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onSave(value)}
      rows={2}
      placeholder={placeholder}
      className="mt-2 w-full resize-none rounded-[8px] border px-2.5 py-1.5 text-[13px]"
      style={{ borderColor: "#E7E8F2", color: "#66679B" }}
    />
  );
}

/**
 * Vorschaukachel links neben dem Lektionstitel (Josips Auftrag 23.07.2026).
 * `thumbnailUrl` kann bei Videos auf eine Bunny-Datei zeigen, die (frisch
 * hochgeladen, noch nicht verarbeitet) unter Umständen noch gar nicht
 * existiert — `onError` fängt das ab und lässt das Fallback-Icon
 * (Video/Bild-Symbol) stehen, statt ein kaputtes Bild anzuzeigen. Ohne
 * Medien-Block bleibt die Kachel leer (kein Icon), damit "hat noch kein
 * Video/Bild" auf einen Blick vom "hat eins, nur noch kein Vorschaubild"
 * unterscheidbar bleibt.
 */
function LessonThumb({ kind, thumbnailUrl }: { kind: "video" | "image" | null; thumbnailUrl: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!kind) {
    return <span className="h-9 w-9 flex-none rounded-[8px]" style={{ background: "#F4F5FA" }} aria-hidden="true" />;
  }
  const FallbackIcon = kind === "video" ? Video : ImageIcon;
  return (
    <span
      className="relative flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-[8px]"
      style={{ background: "#EDEEF7" }}
      aria-hidden="true"
    >
      <FallbackIcon size={14} style={{ color: "#A9AAC4" }} />
      {thumbnailUrl && !broken && (
        // eslint-disable-next-line @next/next/no-img-element -- externe Bunny-/Storage-URL, kein next/image-Loader konfiguriert (gleiches Muster wie block-renderer.tsx)
        <img
          src={thumbnailUrl}
          alt=""
          onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}

function LessonList({
  courseId,
  lessons,
  activeLessonId,
}: {
  courseId: string;
  lessons: LessonRow[];
  activeLessonId?: string;
}) {
  if (lessons.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {lessons.map((lesson) => {
        const isActive = activeLessonId === lesson.id;
        const meta = LESSON_STATUS_META[lesson.status] ?? LESSON_STATUS_META.draft;
        return (
          <li key={lesson.id}>
            <a
              href={`/admin/kurse/${courseId}?lesson=${lesson.id}`}
              aria-current={isActive ? "page" : undefined}
              className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm no-underline"
              style={{
                border: `1px solid ${isActive ? "#D8DAEA" : "transparent"}`,
                borderLeft: `4px solid ${isActive ? "#5663AE" : "transparent"}`,
                background: isActive ? "#F6F7FC" : "transparent",
              }}
            >
              <LessonThumb kind={lesson.kind} thumbnailUrl={lesson.thumbnailUrl} />
              <span className="min-w-0 flex-1 truncate" style={{ fontWeight: isActive ? 800 : 600, color: "#1A1A2E" }}>
                {lesson.title}
              </span>
              <span
                className="flex-none rounded-[7px] px-2 py-0.5 text-[11px] font-bold"
                style={{ color: meta.color, background: meta.bg }}
              >
                {meta.label}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function IconButton({
  label,
  onClick,
  disabled = false,
  danger = false,
  small = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  small?: boolean;
  children: ReactNode;
}) {
  const size = small ? "h-7 w-7" : "h-8 w-8";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex ${size} flex-none items-center justify-center rounded-[9px] border bg-white disabled:opacity-30`}
      style={{ borderColor: "#E7E8F2", color: danger ? "#B14A4A" : "#5663AE" }}
    >
      {children}
    </button>
  );
}

function NewModuleForm({ courseId }: { courseId: string }) {
  const boundAction = createModule.bind(null, courseId);
  const [state, action, pending] = useActionState(boundAction, initialCourseActionState);

  return (
    <form action={action} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          name="title"
          type="text"
          required
          aria-label="Titel des neuen Moduls"
          placeholder="Neues Modul …"
          className="min-w-0 flex-1 rounded-[11px] border bg-white px-3.5 py-2.5 text-[15px]"
          style={{ borderColor: "#D8DAEA" }}
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex flex-none items-center gap-1.5 rounded-[11px] px-3.5 py-2.5 text-[15px] font-bold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          <Plus size={15} aria-hidden="true" />
          Modul
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-xs font-semibold" style={{ color: "#B14A4A" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}

function NewSectionForm({ courseId, moduleId }: { courseId: string; moduleId: string }) {
  const boundAction = createSection.bind(null, moduleId, courseId);
  const [state, action, pending] = useActionState(boundAction, initialCourseActionState);

  return (
    <form action={action} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          name="title"
          type="text"
          required
          aria-label="Titel der neuen Sektion"
          placeholder="Neue Sektion …"
          className="min-w-0 flex-1 rounded-[10px] border bg-white px-2.5 py-2 text-sm"
          style={{ borderColor: "#D8DAEA" }}
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex flex-none items-center gap-1 rounded-[10px] border px-3 py-2 text-sm font-bold disabled:opacity-50"
          style={{ borderColor: "#5663AE", color: "#5663AE" }}
        >
          <Plus size={13} aria-hidden="true" />
          Sektion
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-xs font-semibold" style={{ color: "#B14A4A" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}

function NewLessonForm({ courseId, sectionId }: { courseId: string; sectionId: string }) {
  const boundAction = createLesson.bind(null, sectionId, courseId);
  const [state, action, pending] = useActionState(boundAction, initialCourseActionState);

  return (
    <form action={action} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          name="title"
          type="text"
          required
          aria-label="Titel der neuen Lektion"
          placeholder="Neue Lektion …"
          className="min-w-0 flex-1 rounded-[10px] border bg-white px-2.5 py-2 text-sm"
          style={{ borderColor: "#D8DAEA" }}
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex flex-none items-center gap-1 rounded-[10px] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          <Plus size={13} aria-hidden="true" />
          Hinzu
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-xs font-semibold" style={{ color: "#B14A4A" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}

export function DeleteLessonButton({
  lessonId,
  courseId,
  title,
}: {
  lessonId: string;
  courseId: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (confirm(`Lektion „${title}" wirklich löschen?`)) {
          deleteLesson(lessonId, courseId);
        }
      }}
      className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold"
      style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
    >
      <Trash2 size={15} aria-hidden="true" />
      Lektion löschen
    </button>
  );
}
