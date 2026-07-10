"use client";

import { useActionState } from "react";
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
    <div className="flex w-72 shrink-0 flex-col gap-4">
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
    <div className="rounded-md border p-3" style={{ borderRadius: "var(--radius)" }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{mod.title}</span>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Modul nach oben"
            disabled={isFirst}
            onClick={() => moveModule(mod.id, courseId, "up")}
            className="text-sm disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Modul nach unten"
            disabled={isLast}
            onClick={() => moveModule(mod.id, courseId, "down")}
            className="text-sm disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            aria-label="Modul löschen"
            onClick={() => {
              if (confirm(`Modul „${mod.title}" wirklich löschen?`)) {
                deleteModule(mod.id, courseId);
              }
            }}
            className="text-sm text-red-600"
          >
            ✕
          </button>
        </div>
      </div>

      <ul className="mb-2 flex flex-col gap-1">
        {mod.lessons.map((lesson) => (
          <li key={lesson.id}>
            <a
              href={`/admin/kurse/${courseId}?lesson=${lesson.id}`}
              className={`flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-gray-50 ${
                activeLessonId === lesson.id ? "bg-gray-100 font-medium" : ""
              }`}
            >
              <span>{lesson.title}</span>
              <span className="text-xs text-gray-400">{lesson.status}</span>
            </a>
          </li>
        ))}
      </ul>

      <NewLessonForm courseId={courseId} moduleId={mod.id} />
    </div>
  );
}

function NewModuleForm({ courseId }: { courseId: string }) {
  const boundAction = createModule.bind(null, courseId);
  const [state, action, pending] = useActionState(boundAction, initialCourseActionState);

  return (
    <form action={action} className="flex gap-2">
      <input
        name="title"
        type="text"
        required
        placeholder="Neues Modul …"
        className="flex-1 rounded-md border px-2 py-1 text-sm"
      />
      <button type="submit" disabled={pending} className="rounded-md border px-2 py-1 text-sm">
        +
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

function NewLessonForm({ courseId, moduleId }: { courseId: string; moduleId: string }) {
  const boundAction = createLesson.bind(null, moduleId, courseId);
  const [state, action, pending] = useActionState(boundAction, initialCourseActionState);

  return (
    <form action={action} className="flex gap-2">
      <input
        name="title"
        type="text"
        required
        placeholder="Neue Lektion …"
        className="flex-1 rounded-md border px-2 py-1 text-sm"
      />
      <button type="submit" disabled={pending} className="rounded-md border px-2 py-1 text-sm">
        +
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
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
      className="text-sm text-red-600"
    >
      Lektion löschen
    </button>
  );
}
