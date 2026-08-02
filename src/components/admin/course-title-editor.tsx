"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { updateCourseTitle, updateCourseDescription } from "@/lib/courses/actions";

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
 *
 * Kursbeschreibung (23.07.2026, Josips Auftrag "siehe Baulig"): direkt
 * unter dem Titel editierbar, gleiches Speichern-bei-`onBlur`-Muster wie
 * der Titel selbst. Erscheint auf der Lern-Übersichtsseite unter dem
 * Kurstitel (`(learn)/kurs/[slug]/page.tsx`), optional — leeres Feld zeigt
 * dort nichts an.
 */
export function CourseTitleEditor({
  courseId,
  initialTitle,
  initialSlug,
  initialDescription,
}: {
  courseId: string;
  initialTitle: string;
  initialSlug: string;
  initialDescription: string;
}) {
  const t = useTranslations("admin.courseEditor.title");
  const tRoot = useTranslations("admin.courseEditor");
  const tCommon = useTranslations("admin.common");
  const [title, setTitle] = useState(initialTitle);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  const [slugChanged, setSlugChanged] = useState(false);
  const [description, setDescription] = useState(initialDescription);
  const [savedDescription, setSavedDescription] = useState(initialDescription);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [descriptionPending, startDescriptionTransition] = useTransition();

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

  function saveDescription() {
    if (description === savedDescription) return; // nur speichern, wenn geändert
    startDescriptionTransition(async () => {
      const result = await updateCourseDescription(courseId, description);
      if (result.error) {
        setDescriptionError(result.error);
        return;
      }
      setDescriptionError(null);
      setSavedDescription(description);
    });
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="text-[13px] font-semibold" style={{ color: "#66679B" }}>
        {tRoot("eyebrow")}
      </div>
      <label className="mt-1 flex flex-col gap-1.5 text-sm font-bold" style={{ color: "#3E3F66" }}>
        {t("titleLabel")}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleBlur}
          disabled={pending}
          className="w-full max-w-xl rounded-xl border px-4 py-2.5 text-[22px] font-extrabold disabled:opacity-60"
          style={{ borderColor: "#D8DAEA", color: "#1A1A2E", letterSpacing: "-0.01em" }}
        />
      </label>
      <label className="mt-2.5 flex flex-col gap-1.5 text-sm font-bold" style={{ color: "#3E3F66" }}>
        {t("descriptionLabel")}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
          disabled={descriptionPending}
          rows={2}
          maxLength={5000}
          placeholder={t("descriptionPlaceholder")}
          className="w-full max-w-xl resize-y rounded-xl border px-4 py-2.5 text-[15px] font-normal disabled:opacity-60"
          style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
        />
      </label>
      <div className="mt-1.5 flex items-center gap-3">
        <button
          type="button"
          onClick={saveDescription}
          disabled={descriptionPending || description === savedDescription}
          className="rounded-[10px] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          {descriptionPending ? tCommon("saving") : t("saveDescriptionButton")}
        </button>
        {!descriptionPending && description === savedDescription && savedDescription && (
          <span role="status" className="text-sm font-semibold" style={{ color: "#3E8F5C" }}>
            {tRoot("savedStatus")}
          </span>
        )}
      </div>
      {descriptionError && (
        <p role="alert" className="mt-1.5 text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {descriptionError}
        </p>
      )}
      <p className="mt-1.5 text-sm" style={{ color: "#66679B" }}>
        {t("learnUrlLabel")} <span className="font-mono">/kurs/{slug}</span>
      </p>
      {slugChanged && (
        <p role="status" className="mt-1.5 max-w-xl text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {t("slugChangedNotice")}
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
