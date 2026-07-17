"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  createModule,
  createLesson,
  deleteModule,
  deleteLesson,
  moveModule,
} from "@/lib/courses/actions";
import { initialCourseActionState } from "@/lib/courses/state";

type LessonRow = { id: string; title: string; status: string };
type ModuleRow = { id: string; title: string; lessons: LessonRow[] };

/**
 * Design-Update (AdminKursEditor.dc.html): Modul-/Lektionsbaum als
 * eigenständige weiße Karten statt roher `border`-Kästen. Lektions-Status
 * (Entwurf/Veröffentlicht) als Farb-Chip, die aktive Lektion zusätzlich zur
 * Hintergrundfarbe über einen linken Akzentbalken + kräftigere Schrift
 * hervorgehoben (CLAUDE.md §3.4: Zustand nie nur über Farbe).
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
      <div className="mb-3 flex items-center gap-2">
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

      <ul className="mb-3 flex flex-col gap-1.5">
        {mod.lessons.map((lesson) => {
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

      <NewLessonForm courseId={courseId} moduleId={mod.id} />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled = false,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border bg-white disabled:opacity-30"
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

function NewLessonForm({ courseId, moduleId }: { courseId: string; moduleId: string }) {
  const boundAction = createLesson.bind(null, moduleId, courseId);
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
