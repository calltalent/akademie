"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createDraftCourse } from "@/lib/courses/actions";

/**
 * Design-Block 6 (13.07.2026, AdminKurse.dc.html): der Export zeigt "Neuer
 * Kurs" als reinen Link ohne Zielseite. Ursprünglich als natives
 * `<dialog>`-Modal mit Titel/Slug/Kategorie-Formular umgesetzt
 * (new-course-dialog.tsx, siehe Git-Historie).
 *
 * 4-Schritte-Editor (25.07.2026, Josips Fund direkt nach dem Live-Test:
 * "wenn ich auf neuer kurs gehe kommt das alte fenster und nicht das
 * wizzard"): das Modal fühlte sich wie ein zweites, älteres System an,
 * bevor der neue Assistent überhaupt zu sehen war. Jetzt legt "Neuer Kurs"
 * sofort einen Entwurfs-Kurs an (`createDraftCourse()`, keine Eingabe nötig)
 * und navigiert direkt zu Schritt 1 des Assistenten — Titel/Slug/Kategorie
 * werden dort bearbeitet (bereits vorhandene Felder in
 * course-editor-steps.tsx), nicht mehr vorher in einem Modal.
 */
export function NewCourseButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await createDraftCourse();
            if (result.error) {
              setError(result.error);
              return;
            }
            if (result.courseId) router.push(`/admin/kurse/${result.courseId}`);
          })
        }
        className="inline-flex flex-none items-center gap-2 rounded-[11px] px-[18px] py-3 text-[15px] font-bold text-white disabled:opacity-60"
        style={{ background: "#5663AE" }}
      >
        <Plus aria-hidden="true" size={16} />
        {pending ? "Wird angelegt …" : "Neuer Kurs"}
      </button>
      {error && (
        <p role="alert" className="text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}
    </div>
  );
}
