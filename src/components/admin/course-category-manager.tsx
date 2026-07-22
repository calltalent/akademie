"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Tags, Trash2 } from "lucide-react";
import {
  createCourseCategory,
  deleteCourseCategory,
  renameCourseCategory,
} from "@/lib/courses/actions";
import { initialCourseActionState } from "@/lib/courses/state";

export type ManagedCourseCategory = {
  id: string;
  name: string;
  /** Anzahl Kurse, die diese Kategorie aktuell tragen — für den Lösch-Hinweis. */
  courseCount: number;
};

/**
 * Kategorien-Verwaltung fürs Admin-Bereich „Kurse" (Josips Auftrag,
 * 22.07.2026, Migration course_categories). Natives `<dialog>` nach der
 * etablierten Projektkonvention (siehe `new-course-dialog.tsx`).
 *
 * Löschen bekommt bewusst KEIN eigenes `<dialog>` wie `DeleteCourseIconButton`
 * — dort geht beim Bestätigen echter Lerninhalt/Zertifikate verloren, hier
 * wird nur ein Tag zurückgesetzt (betroffene Kurse zeigen danach „Keine
 * Kategorie", nichts wird gelöscht). Ein inline umschaltbarer Zwei-Klick-
 * Zustand („Wirklich löschen?") reicht für diese Tragweite und zeigt die
 * betroffene Kursanzahl direkt in der Zeile statt in einem separaten Dialog.
 */
export function CourseCategoryManager({ categories }: { categories: ManagedCourseCategory[] }) {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="inline-flex flex-none items-center gap-2 rounded-[11px] border bg-white px-[18px] py-3 text-[15px] font-bold"
        style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
      >
        <Tags aria-hidden="true" size={16} />
        Kategorien verwalten
      </button>
      <dialog
        ref={ref}
        aria-labelledby="course-category-manager-title"
        className="w-full max-w-md rounded-md border p-6 backdrop:bg-black/40"
        style={{ borderRadius: "var(--radius)" }}
      >
        <h2 id="course-category-manager-title" className="mb-4 text-lg font-medium">
          Kurskategorien
        </h2>
        <ul className="flex flex-col gap-2">
          {categories.length === 0 && (
            <li className="text-sm" style={{ color: "#A9AAC4" }}>
              Noch keine Kategorien.
            </li>
          )}
          {categories.map((c) => (
            <CategoryRow key={c.id} category={c} />
          ))}
        </ul>
        <AddCategoryForm />
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="mt-4 text-sm underline"
        >
          Schließen
        </button>
      </dialog>
    </>
  );
}

function CategoryRow({ category }: { category: ManagedCourseCategory }) {
  const [name, setName] = useState(category.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <li className="flex items-center gap-2 rounded-md border px-3 py-2" style={{ borderRadius: "var(--radius)" }}>
      <label className="sr-only" htmlFor={`category-name-${category.id}`}>
        Name der Kategorie „{category.name}&quot;
      </label>
      <input
        id={`category-name-${category.id}`}
        type="text"
        value={name}
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const trimmed = name.trim();
          if (!trimmed || trimmed === category.name) {
            setName(category.name);
            return;
          }
          startTransition(() => {
            renameCourseCategory(category.id, trimmed);
          });
        }}
        className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm disabled:opacity-50"
      />
      {confirmingDelete ? (
        <div className="flex flex-none items-center gap-2 text-sm">
          <span style={{ color: "#B14A4A" }}>
            {category.courseCount > 0
              ? `Bei ${category.courseCount} ${category.courseCount === 1 ? "Kurs" : "Kursen"} entfernen?`
              : "Wirklich löschen?"}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(() => {
                deleteCourseCategory(category.id);
              })
            }
            className="font-semibold underline disabled:opacity-50"
            style={{ color: "#B14A4A" }}
          >
            Ja
          </button>
          <button type="button" onClick={() => setConfirmingDelete(false)} className="underline">
            Nein
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          aria-label={`Kategorie löschen: ${category.name}`}
          title="Löschen"
          className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border bg-white"
          style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

function AddCategoryForm() {
  const [state, action, pending] = useActionState(createCourseCategory, initialCourseActionState);
  const formRef = useRef<HTMLFormElement>(null);

  // Dialog bleibt nach dem Anlegen offen (mehrere Kategorien nacheinander
  // hinzufügen) — Formular deshalb selbst leeren statt wie CreateCourseForm
  // per onSuccess zu schließen.
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={action} className="mt-4 flex flex-col gap-1.5 border-t pt-4">
      <label className="flex flex-col gap-1 text-sm" htmlFor="new-category-name">
        Neue Kategorie
      </label>
      <div className="flex gap-2">
        <input
          id="new-category-name"
          name="name"
          type="text"
          required
          maxLength={60}
          className="min-w-0 flex-1 rounded-md border px-3 py-2 text-base"
        />
        <button
          type="submit"
          disabled={pending}
          className="flex-none rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--color-primary)" }}
        >
          Anlegen
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
