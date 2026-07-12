"use client";

import { useTransition } from "react";
import { updateCourseStatus, updateLessonStatus } from "@/lib/courses/actions";

/**
 * Design-Block 6 (13.07.2026): ersetzt den früheren CoursePublishToggle
 * (nur draft/published, entfernt) auf der Kurs-Editor-Seite ([id]/page.tsx),
 * die bislang GAR KEINE Möglichkeit hatte, den Kursstatus zu ändern — der
 * Export (AdminKurse.dc.html) zeigt Live/Entwurf/Archiviert nur als reinen
 * Anzeige-Badge in der Liste (kein Steuerelement dort), daher wandert die
 * echte Statusänderung hierher auf die Bearbeiten-Seite. `archived` war
 * über CoursePublishToggle nie erreichbar, obwohl `updateCourseStatus` und
 * die DB-Check-Constraint (courses.status) es immer schon unterstützt haben.
 */
export function CourseStatusSelect({
  courseId,
  status,
}: {
  courseId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as "draft" | "published" | "archived";
        startTransition(() => {
          updateCourseStatus(courseId, next);
        });
      }}
      className="rounded-md border px-2 py-1.5 text-sm disabled:opacity-50"
      aria-label="Kursstatus"
    >
      <option value="draft">Entwurf</option>
      <option value="published">Live</option>
      <option value="archived">Archiviert</option>
    </select>
  );
}

export function LessonPublishToggle({
  lessonId,
  courseId,
  status,
}: {
  lessonId: string;
  courseId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const isPublished = status === "published";

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(() => {
          updateLessonStatus(lessonId, courseId, isPublished ? "draft" : "published");
        })
      }
      className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
    >
      {isPublished ? "Auf Entwurf setzen" : "Veröffentlichen"}
    </button>
  );
}
