"use client";

import { ChevronUp, ChevronDown } from "lucide-react";
import { moveCourse } from "@/lib/courses/actions";

/**
 * Kursreihenfolge per Auf/Ab (Josips Auftrag, 23.07.2026: "per Drag and Drop
 * die Kursposition korrigieren"). Bewusst KEIN echtes Drag-and-Drop: diese
 * Codebase sortiert Module/Sektionen ausschließlich über Auf/Ab-Pfeil-Buttons
 * (siehe `IconButton` in `module-lesson-tree.tsx`) — genau weil der
 * Auftraggeber selbst sehbehindert ist und reines Maus-Ziehen für ihn nicht
 * bedienbar wäre (CLAUDE.md §3.4: "Barrierefreiheit ist Produktanforderung,
 * nicht Kür"). Dieselbe Lösung hier: erreicht dasselbe Ergebnis (Position
 * nach oben/unten korrigieren), aber vollständig tastaturbedienbar.
 *
 * `isFirst`/`isLast` beziehen sich auf ALLE Kurse des Mandanten (nicht nur
 * die im aktuell gefilterten Status-Tab sichtbaren) — `moveCourse()` tauscht
 * ebenfalls über die Gesamtliste hinweg, siehe dortiger Kommentar.
 */
export function CoursePositionButtons({
  courseId,
  title,
  isFirst,
  isLast,
}: {
  courseId: string;
  title: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <>
      <button
        type="button"
        aria-label={`Kurs nach oben: ${title}`}
        title="Nach oben"
        disabled={isFirst}
        onClick={() => moveCourse(courseId, "up")}
        className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] border bg-white disabled:opacity-30"
        style={{ borderColor: "#E7E8F2", color: "#5663AE" }}
      >
        <ChevronUp size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Kurs nach unten: ${title}`}
        title="Nach unten"
        disabled={isLast}
        onClick={() => moveCourse(courseId, "down")}
        className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] border bg-white disabled:opacity-30"
        style={{ borderColor: "#E7E8F2", color: "#5663AE" }}
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </>
  );
}
