"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { CourseDeleteConfirm } from "@/components/admin/course-delete-confirm";

/**
 * Papierkorb-Symbol in der Kursliste (`admin/kurse/page.tsx`) — löschen, ohne
 * erst in den Kurs zu gehen (Josips Wunsch, 17.07.2026).
 *
 * WARUM `<dialog>` STATT INLINE-PANEL: `DeleteCourseButton` klappt seinen
 * Bestätigungstext inline auf. In einer Tabellenzeile (Spalte `0.6fr`) würde
 * das die Rasterzeile sprengen. Natives `<dialog>` + `showModal()` ist
 * ohnehin die Projektkonvention für Modale (siehe `new-course-dialog.tsx`,
 * `api-key-created-dialog.tsx`, CLAUDE.md §3.4) und bringt Fokusfalle,
 * Esc-zum-Schließen und Fokus-Rückgabe an den Auslöser von selbst mit —
 * nichts davon müsste hier von Hand nachgebaut werden.
 *
 * Der Inhalt wird ABSICHTLICH erst bei geöffnetem Dialog gemountet
 * (`{open && …}`): CourseDeleteConfirm setzt den Erstfokus beim Mounten ins
 * Eingabefeld — dauerhaft gerendert würde das den Fokus schon beim Laden der
 * Kursliste in ein unsichtbares Feld ziehen. Nebeneffekt, der hier erwünscht
 * ist: jedes Öffnen startet mit leerem Feld und ohne alte Fehlermeldung.
 *
 * NICHT als Symbol allein: `aria-label` trägt den Kurstitel („Kurs löschen:
 * Alfa Kurs"). In einer Liste hört man beim Durchtabben sonst nur mehrfach
 * „Löschen", ohne zu wissen, welcher Kurs gemeint ist (CLAUDE.md §3.4) — und
 * ein Symbolknopf ganz ohne zugänglichen Namen war in diesem Repo schon
 * einmal ein Barrierefreiheits-Verstoß (siehe das frühere alleinstehende „+"
 * im Modul-/Lektionsformular).
 */
export function DeleteCourseIconButton({
  courseId,
  title,
  lessonCount,
  enrollmentCount,
  certificateCount,
}: {
  courseId: string;
  title: string;
  lessonCount: number;
  enrollmentCount: number;
  certificateCount: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  function openDialog() {
    setOpen(true);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
    // `onClose` des <dialog> räumt `open` auf — es feuert auch bei Esc und
    // deckt damit beide Schließwege ab.
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label={`Kurs löschen: ${title}`}
        title="Löschen"
        className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] border bg-white"
        style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        aria-labelledby={`delete-course-title-${courseId}`}
        className="max-w-lg rounded-[14px] border p-5 backdrop:bg-black/40"
        style={{ borderColor: "#E9CFCF", background: "#FBEAEA" }}
      >
        <h2 id={`delete-course-title-${courseId}`} className="sr-only">
          Kurs „{title}&quot; löschen
        </h2>
        {open && (
          <div className="flex flex-col gap-3">
            <CourseDeleteConfirm
              courseId={courseId}
              title={title}
              lessonCount={lessonCount}
              enrollmentCount={enrollmentCount}
              certificateCount={certificateCount}
              // Aus der Liste heraus gibt es keinen Status-Schalter „oben" —
              // die Statusänderung sitzt bewusst nur im Editor.
              archiveHintWhere="im Kurs-Editor („Bearbeiten“)"
              onCancel={closeDialog}
            />
          </div>
        )}
      </dialog>
    </>
  );
}
