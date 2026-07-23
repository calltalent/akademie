"use client";

import { useTransition } from "react";
import { completeLesson } from "@/lib/progress/actions";

export function CompleteLessonButton({
  lessonId,
  courseSlug,
  alreadyCompleted,
  nextHref,
  nextLabel = "Lektion abschließen",
}: {
  lessonId: string;
  courseSlug: string;
  alreadyCompleted: boolean;
  nextHref: string | null;
  /**
   * Josips Auftrag (22.07.2026, Sektion-/Modul-Abschluss-Bildschirm): `nextHref`
   * zeigt bei einer Grenz-Lektion (letzte einer Sektion/eines Moduls) jetzt auf
   * den neuen Zwischenbildschirm statt auf die nächste Lektion. Aufrufer
   * übergeben dann einen passenden Text (siehe l/[lessonId]/page.tsx, z. B.
   * „Modul ansehen →").
   */
  nextLabel?: string;
}) {
  const [pending, startTransition] = useTransition();

  if (alreadyCompleted) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-base text-green-700">✓ Abgeschlossen</span>
        {/* Josips Auftrag (23.07.2026): war ein kleiner unterstrichener
            Text-Link ("Weiter zur nächsten Lektion") — als richtiger Button
            ersetzt, gleiche Optik wie der "Lektion abschließen"-Button
            unten (größere Tapfläche, konsistente Primäraktion). */}
        {nextHref && (
          <a
            href={nextHref}
            className="px-4 py-2 text-base text-white no-underline"
            style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
          >
            {nextLabel}
          </a>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await completeLesson(lessonId, courseSlug);
          if (nextHref) window.location.href = nextHref;
        })
      }
      className="px-4 py-2 text-base text-white disabled:opacity-50"
      style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
    >
      {pending ? "Wird gespeichert …" : "Lektion abschließen"}
    </button>
  );
}
