"use client";

import { useState, useTransition } from "react";
import { updateCourseTitle } from "@/lib/courses/actions";

/**
 * Kurs umbenennen (Josips Entscheidung, siehe PHASENSTATUS.md — ändert
 * Titel UND Slug, alte `/kurs/<slug>`-Links laufen danach bewusst ins
 * Leere). Ersetzt die bisher statische `<h1>` im Kopf des Kurs-Editors.
 *
 * Speichern beim Verlassen des Feldes (`onBlur`), exakt das Muster von
 * `updateLessonTitle` in `src/components/editor/block-editor.tsx` — nur
 * speichern, wenn sich der Wert seit dem letzten Speichern geändert hat.
 *
 * Die Lern-URL steht dauerhaft sichtbar darunter (nie eine stille URL-
 * Änderung) und bekommt nach einer tatsächlichen Slug-Änderung einmalig
 * einen `role="status"`-Hinweis, dass bereits geteilte alte Links nicht
 * mehr funktionieren — ehrlich benannt statt versteckt.
 */
export function CourseTitleEditor({
  courseId,
  initialTitle,
  initialSlug,
}: {
  courseId: string;
  initialTitle: string;
  initialSlug: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  const [slugChanged, setSlugChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleBlur() {
    if (title === savedTitle) return; // nur speichern, wenn geändert
    startTransition(async () => {
      const result = await updateCourseTitle(courseId, title);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setSavedTitle(title);
      if (result.slug && result.slug !== slug) {
        setSlug(result.slug);
        setSlugChanged(true);
      }
    });
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="text-[13px] font-semibold" style={{ color: "#66679B" }}>
        Inhalte · Kurse
      </div>
      <label className="mt-1 flex flex-col gap-1.5 text-sm font-bold" style={{ color: "#3E3F66" }}>
        Kurstitel
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleBlur}
          disabled={pending}
          className="w-full max-w-xl rounded-xl border px-4 py-2.5 text-[22px] font-extrabold disabled:opacity-60"
          style={{ borderColor: "#D8DAEA", color: "#1A1A2E", letterSpacing: "-0.01em" }}
        />
      </label>
      <p className="mt-1.5 text-sm" style={{ color: "#66679B" }}>
        Lern-URL: <span className="font-mono">/kurs/{slug}</span>
      </p>
      {slugChanged && (
        <p role="status" className="mt-1.5 max-w-xl text-sm font-semibold" style={{ color: "#B14A4A" }}>
          Der Kurs wurde umbenannt — bereits geteilte Links auf die alte Lern-URL funktionieren jetzt
          nicht mehr.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}
    </div>
  );
}
