"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deleteCourse } from "@/lib/courses/actions";

/**
 * Gemeinsamer Bestätigungs-Inhalt fürs Kurs-Löschen — Warntext, Abtipp-Feld,
 * Fehlerausgabe, Aktionsknöpfe. Wird von ZWEI Auslösern benutzt:
 *
 * - `delete-course-button.tsx` — Knopf mit Text im Kurs-Editor, klappt den
 *   Inhalt inline als Panel auf.
 * - `delete-course-icon-button.tsx` — Papierkorb-Symbol in der Kursliste,
 *   zeigt den Inhalt in einem nativen `<dialog>` (inline würde eine
 *   Tabellenzeile sprengen).
 *
 * Bewusst herausgezogen statt kopiert: der Warntext trägt die
 * Zertifikats-Klausel und den Archivieren-Hinweis. Zweimal gepflegt würde
 * genau das auseinanderlaufen — und die Konsequenzen eines unwiderruflichen
 * Löschens sind der falsche Ort für zwei Wahrheiten.
 *
 * Kein Fokus-Management hier: die beiden Hüllen lösen das unterschiedlich
 * (natives `<dialog>` bringt Fokusfalle + Rückgabe selbst mit, das
 * Inline-Panel gibt den Fokus von Hand auf seinen Auslöser zurück). Nur der
 * Erstfokus aufs Eingabefeld ist gemeinsam — beide Hüllen mounten diesen
 * Inhalt erst beim Öffnen, deshalb ist der Effekt hier korrekt aufgehoben.
 */
export function CourseDeleteConfirm({
  courseId,
  title,
  lessonCount,
  enrollmentCount,
  certificateCount,
  archiveHintWhere,
  onCancel,
}: {
  courseId: string;
  title: string;
  lessonCount: number;
  enrollmentCount: number;
  certificateCount: number;
  /**
   * Wo der Status-Schalter zum Archivieren steht — je nach Aufrufort
   * verschieden: im Editor steht er „oben" auf derselben Seite, aus der
   * Kursliste heraus dagegen erst „im Kurs-Editor" (die Statusänderung ist
   * dort bewusst NICHT inline, siehe Kopfkommentar in `admin/kurse/page.tsx`).
   * Ein pauschales „oben" wäre aus der Liste heraus schlicht falsch.
   */
  archiveHintWhere: string;
  onCancel: () => void;
}) {
  const [confirmValue, setConfirmValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleDelete() {
    startTransition(async () => {
      // `deleteCourse()` leitet NICHT mehr serverseitig weiter (24.07.2026,
      // Josips Fund: ein `redirect()` innerhalb dieser Server Action dauerte
      // auf dieser Plattform >20s, siehe Kopfkommentar dort) — bei Erfolg
      // navigiert stattdessen dieser Client selbst per `router.push()`,
      // eine gewöhnliche, durchgehend schnelle Navigation.
      const result = await deleteCourse(courseId, confirmValue);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/admin/kurse");
    });
  }

  const matches = confirmValue === title;

  return (
    <>
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
            Meist die bessere Wahl: Kurs {archiveHintWhere} auf Status „Archiviert&quot; setzen — der
            Kurs bleibt vollständig erhalten, ist für Lernende aber nicht mehr sichtbar.
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
          onClick={onCancel}
          disabled={pending}
          className="inline-flex items-center rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold disabled:opacity-60"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          Abbrechen
        </button>
      </div>
    </>
  );
}
