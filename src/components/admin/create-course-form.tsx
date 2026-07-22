"use client";

import { useActionState, useEffect } from "react";
import { createCourse } from "@/lib/courses/actions";
import { initialCourseActionState } from "@/lib/courses/state";
import type { CourseCategoryRow } from "@/lib/courses/categories";

/**
 * Design-Block 6 (13.07.2026): optionales `onSuccess` ergänzt, damit dieses
 * Formular jetzt auch in einem <dialog>-Modal (new-course-dialog.tsx)
 * verwendet werden kann und sich nach erfolgreichem Anlegen selbst schließt.
 * Ohne Prop unverändertes Verhalten (rein optional, kein Breaking Change).
 *
 * `categories` (22.07.2026, Migration course_categories): ersetzt den
 * früheren globalen `COURSE_CATEGORIES`-Const — die Liste kommt jetzt
 * mandantenspezifisch vom Aufrufer (admin/kurse/page.tsx), Optionswert ist
 * die Kategorie-ID statt des Namens.
 */
export function CreateCourseForm({
  categories,
  onSuccess,
}: {
  categories: CourseCategoryRow[];
  onSuccess?: () => void;
}) {
  const [state, action, pending] = useActionState(
    createCourse,
    initialCourseActionState,
  );

  useEffect(() => {
    if (state.success) onSuccess?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-md border p-4"
      style={{ borderRadius: "var(--radius)" }}
    >
      <h2 className="text-lg font-medium">Neuer Kurs</h2>
      <label className="flex flex-col gap-1 text-sm">
        Titel
        <input
          name="title"
          type="text"
          required
          className="rounded-md border px-3 py-2 text-base"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Slug (URL, z. B. „einfuehrung-produkt&quot;)
        <input
          name="slug"
          type="text"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          className="rounded-md border px-3 py-2 text-base"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Kategorie (optional, für den Kurskatalog-Filter)
        <select name="category" className="rounded-md border px-3 py-2 text-base">
          <option value="">— keine —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
        style={{ background: "var(--color-primary)" }}
      >
        Kurs anlegen
      </button>
    </form>
  );
}
