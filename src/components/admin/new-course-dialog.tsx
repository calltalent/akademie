"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { CreateCourseForm } from "@/components/admin/create-course-form";
import type { CourseCategoryRow } from "@/lib/courses/categories";

/**
 * Design-Block 6 (13.07.2026, AdminKurse.dc.html): der Export zeigt "Neuer
 * Kurs" als reinen Link ohne Zielseite (keine echte Route im Mockup). Da es
 * bislang keine eigene /admin/kurse/neu-Route gibt und CreateCourseForm
 * bereits real funktioniert, wird hier stattdessen die Projektkonvention für
 * Modale verwendet (natives <dialog>, siehe api-key-created-dialog.tsx /
 * CLAUDE.md §3.4) statt eine neue Seite anzulegen.
 *
 * 4-Schritte-Editor (25.07.2026): dieses Modal deckt nur noch die ersten
 * Pflichtfelder ab (Titel, Slug, Kategorie) — Kursbild, Informationen,
 * Inhalt und Veröffentlichung folgen direkt danach im neuen Kurs-Editor
 * (course-editor-steps.tsx). Nach erfolgreichem Anlegen schließt sich das
 * Modal deshalb nicht mehr nur, sondern navigiert sofort zu
 * `/admin/kurse/{courseId}`, wo Schritt 1 mit den bereits eingegebenen
 * Werten weitergeht.
 */
export function NewCourseDialog({ categories }: { categories: CourseCategoryRow[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="inline-flex flex-none items-center gap-2 rounded-[11px] px-[18px] py-3 text-[15px] font-bold text-white"
        style={{ background: "#5663AE" }}
      >
        <Plus aria-hidden="true" size={16} />
        Neuer Kurs
      </button>
      <dialog
        ref={ref}
        aria-labelledby="new-course-title"
        className="rounded-md border p-6 backdrop:bg-black/40"
        style={{ borderRadius: "var(--radius)" }}
      >
        <h2 id="new-course-title" className="sr-only">
          Neuer Kurs
        </h2>
        <CreateCourseForm
          categories={categories}
          onSuccess={(courseId) => {
            ref.current?.close();
            router.push(`/admin/kurse/${courseId}`);
          }}
        />
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="mt-3 text-sm underline"
        >
          Abbrechen
        </button>
      </dialog>
    </>
  );
}
