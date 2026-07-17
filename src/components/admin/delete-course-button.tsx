"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { CourseDeleteConfirm } from "@/components/admin/course-delete-confirm";

/**
 * Kurs löschen (Josips Entscheidung, siehe PHASENSTATUS.md) — nur owner/admin
 * (`deleteCourse()` prüft das serverseitig über `requireAdminTenant()`, ein
 * Trainer sieht bei einem Fehlversuch nur die deutsche Fehlermeldung der
 * Server Action). Bestätigung per exaktem Abtippen des Kursnamens statt
 * `confirm()` — der Konsequenzen-Text ist zu lang für einen nativen Dialog
 * und `confirm()` ist nicht barrierefrei (kein fokussierbarer Inhalt,
 * keine Screenreader-Struktur). Gleiches Grundmuster wie
 * `src/app/portal/mandanten/[id]/mandant-delete-form.tsx` (Slug-Abtipp-
 * Bestätigung für Mandanten), hier als eigenständige Inline-Komponente
 * statt Formular, weil `deleteCourse(courseId, confirmTitle)` zwei einfache
 * Argumente statt (prevState, formData) erwartet.
 *
 * Zahlen (Lektionen/Teilnehmer/Zertifikate) kommen als Props von der
 * Server Component (`[id]/page.tsx`) — echte Zählungen aus der DB, keine
 * Schätzung.
 *
 * Diese Variante ist der Auslöser MIT Text im Kurs-Editor; der eigentliche
 * Bestätigungs-Inhalt liegt seit 17.07.2026 in `course-delete-confirm.tsx`
 * und wird mit der Papierkorb-Variante der Kursliste geteilt
 * (`delete-course-icon-button.tsx`).
 */
export function DeleteCourseButton({
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
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);

  /**
   * Fokus-Rückgabe auf den Auslöser (CLAUDE.md §3.4); der Erstfokus ins
   * Eingabefeld liegt in CourseDeleteConfirm.
   *
   * FEHLER BEIM UMBAU GEFUNDEN (17.07.2026): vorher stand
   * `triggerRef.current?.focus()` direkt in `cancel()` — das war wirkungslos.
   * Solange das Panel offen ist, ist der Auslöser nicht gerendert, React hat
   * den Ref beim Unmounten auf `null` gesetzt, und der optionale Aufruf lief
   * stumm ins Leere. Der Fokus landete dadurch beim Abbrechen auf <body>:
   * Tastatur- und Screenreader-Nutzer verloren ihre Position in der Seite.
   *
   * Jetzt über einen Effekt NACH dem Rendern des geschlossenen Zustands, wenn
   * der Auslöser wieder existiert. Absicht im Ref statt im State, damit kein
   * `setState` im Effekt nötig ist (`react-hooks/set-state-in-effect`).
   */
  useEffect(() => {
    if (!open && returnFocusRef.current) {
      returnFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold"
        style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
      >
        <Trash2 size={15} aria-hidden="true" />
        Kurs löschen
      </button>
    );
  }

  return (
    <div
      className="flex w-full flex-col gap-3 rounded-[14px] border p-5"
      style={{ borderColor: "#E9CFCF", background: "#FBEAEA" }}
    >
      <CourseDeleteConfirm
        courseId={courseId}
        title={title}
        lessonCount={lessonCount}
        enrollmentCount={enrollmentCount}
        certificateCount={certificateCount}
        // Der Status-Schalter steht im Editor auf derselben Seite weiter oben.
        archiveHintWhere="oben"
        onCancel={() => {
          returnFocusRef.current = true;
          setOpen(false);
        }}
      />
    </div>
  );
}
