"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deleteCourse } from "@/lib/courses/actions";

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
  const [confirmValue, setConfirmValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fokus-Management (CLAUDE.md §3.4): Fokus geht beim Öffnen in das
  // Eingabefeld, beim Schließen zurück auf den Auslöser-Knopf.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function openPanel() {
    setError(null);
    setConfirmValue("");
    setOpen(true);
  }

  function cancel() {
    setOpen(false);
    setConfirmValue("");
    setError(null);
    triggerRef.current?.focus();
  }

  function handleDelete() {
    startTransition(async () => {
      // Bei Erfolg leitet deleteCourse() serverseitig per redirect() zur
      // Kursliste weiter (next/navigation) — dieser Code läuft dann nicht
      // mehr zu Ende. Nur der Fehlerfall liefert hier ein Ergebnis.
      const result = await deleteCourse(courseId, confirmValue);
      if (result.error) setError(result.error);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        ref={triggerRef}
        onClick={openPanel}
        className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold"
        style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
      >
        <Trash2 size={15} aria-hidden="true" />
        Kurs löschen
      </button>
    );
  }

  const matches = confirmValue === title;

  return (
    <div
      className="flex w-full flex-col gap-3 rounded-[14px] border p-5"
      style={{ borderColor: "#E9CFCF", background: "#FBEAEA" }}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          size={18}
          aria-hidden="true"
          className="mt-0.5 flex-none"
          style={{ color: "#B14A4A" }}
        />
        <div className="text-[15px]" style={{ color: "#7A3535" }}>
          <p className="font-bold">Kurs „{title}&quot; unwiderruflich löschen?</p>
          <p className="mt-1">
            Löscht {lessonCount} {lessonCount === 1 ? "Lektion" : "Lektionen"}, {enrollmentCount}{" "}
            eingeschriebene Teilnehmer und {certificateCount} ausgestellte Zertifikate dauerhaft.
          </p>
          {certificateCount > 0 && (
            <p className="mt-1 font-bold">
              Achtung: {certificateCount} bereits ausgestellte{" "}
              {certificateCount === 1 ? "Zertifikat verschwindet" : "Zertifikate verschwinden"}{" "}
              dabei unwiderruflich — Teilnehmer können es/sie danach nicht mehr abrufen.
            </p>
          )}
          <p className="mt-2">
            Meist die bessere Wahl: Kurs oben auf Status „Archiviert&quot; setzen — der Kurs bleibt
            vollständig erhalten, ist für Lernende aber nicht mehr sichtbar.
          </p>
        </div>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-bold" style={{ color: "#7A3535" }}>
        Zum Bestätigen den Kursnamen eingeben: {title}
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          value={confirmValue}
          onChange={(e) => setConfirmValue(e.target.value)}
          disabled={pending}
          className="w-full max-w-md rounded-xl border bg-white px-4 py-2.5 text-[15px] disabled:opacity-60"
          style={{ borderColor: "#D8A8A8", color: "#1A1A2E" }}
        />
      </label>

      {error && (
        <p role="alert" className="text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={handleDelete}
          disabled={!matches || pending}
          className="inline-flex items-center gap-2 rounded-[10px] px-[18px] py-3 text-[15px] font-bold text-white disabled:opacity-40"
          style={{ background: "#B14A4A" }}
        >
          <Trash2 size={15} aria-hidden="true" />
          {pending ? "Wird gelöscht …" : "Endgültig löschen"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="inline-flex items-center rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold disabled:opacity-60"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
