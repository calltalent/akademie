"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { updateCourseStatus, updateCourseCategory, updateLessonStatus } from "@/lib/courses/actions";
import { COURSE_CATEGORIES } from "@/lib/courses/categories";

/**
 * Design-Block 6 (13.07.2026): ersetzt den früheren CoursePublishToggle
 * (nur draft/published, entfernt) auf der Kurs-Editor-Seite ([id]/page.tsx),
 * die bislang GAR KEINE Möglichkeit hatte, den Kursstatus zu ändern — der
 * Export (AdminKurse.dc.html) zeigt Live/Entwurf/Archiviert nur als reinen
 * Anzeige-Badge in der Liste (kein Steuerelement dort), daher wandert die
 * echte Statusänderung hierher auf die Bearbeiten-Seite. `archived` war
 * über CoursePublishToggle nie erreichbar, obwohl `updateCourseStatus` und
 * die DB-Check-Constraint (courses.status) es immer schon unterstützt haben.
 *
 * Design-Update (AdminKursEditor.dc.html): Status/Kategorie jetzt als
 * `<label>` mit sichtbarem Beschriftungstext ("Status"/"Kategorie") statt
 * nur `aria-label` — CLAUDE.md §3.4 verlangt sichtbare Labels, keine reinen
 * ARIA-Attribute als einzige Beschriftung.
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
    <label className="flex flex-col gap-1.5 text-[13px] font-bold" style={{ color: "#3E3F66" }}>
      Status
      <select
        value={status}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as "draft" | "published" | "archived";
          startTransition(() => {
            updateCourseStatus(courseId, next);
          });
        }}
        className="min-w-[150px] rounded-[11px] border bg-white px-3 py-2.5 text-[15px] font-semibold disabled:opacity-50"
        style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
      >
        <option value="draft">Entwurf</option>
        <option value="published">Live</option>
        <option value="archived">Archiviert</option>
      </select>
    </label>
  );
}

/**
 * Kategorie eines Kurses setzen (für den Kurskatalog-Filter). Analog
 * CourseStatusSelect — Änderung sofort per Server-Action, kein Speichern-
 * Button. „Keine Kategorie" → null (Kurs erscheint im Katalog nur unter
 * „Alle Kurse").
 */
export function CourseCategorySelect({
  courseId,
  category,
}: {
  courseId: string;
  category: string | null;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-bold" style={{ color: "#3E3F66" }}>
      Kategorie
      <select
        value={category ?? ""}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value || null;
          startTransition(() => {
            updateCourseCategory(courseId, next);
          });
        }}
        className="min-w-[150px] rounded-[11px] border bg-white px-3 py-2.5 text-[15px] font-semibold disabled:opacity-50"
        style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
      >
        <option value="">Keine Kategorie</option>
        {COURSE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
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
      className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[15px] font-bold disabled:opacity-50"
      style={
        isPublished
          ? { background: "#fff", border: "1px solid #E7E8F2", color: "#3E3F66" }
          : { background: "#5663AE", color: "#fff" }
      }
    >
      {!isPublished && <Check size={16} aria-hidden="true" />}
      {isPublished ? "Auf Entwurf setzen" : "Veröffentlichen"}
    </button>
  );
}
