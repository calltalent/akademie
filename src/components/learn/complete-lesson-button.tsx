"use client";

import { useTransition } from "react";
import { completeLesson } from "@/lib/progress/actions";

export function CompleteLessonButton({
  lessonId,
  courseSlug,
  alreadyCompleted,
  nextHref,
  nextLabel = "Weiter zur nächsten Lektion →",
}: {
  lessonId: string;
  courseSlug: string;
  alreadyCompleted: boolean;
  nextHref: string | null;
  /**
   * Josips Auftrag (22.07.2026, Sektion-/Modul-Abschluss-Bildschirm): `nextHref`
   * zeigt bei einer Grenz-Lektion (letzte einer Sektion/eines Moduls) jetzt auf
   * den neuen Zwischenbildschirm statt auf die nächste Lektion — der Standard-
   * Linktext „Weiter zur nächsten Lektion" wäre dort irreführend, wenn man eine
   * bereits abgeschlossene Grenz-Lektion erneut aufruft. Aufrufer übergeben dann
   * einen passenden Text (siehe l/[lessonId]/page.tsx).
   */
  nextLabel?: string;
}) {
  const [pending, startTransition] = useTransition();

  if (alreadyCompleted) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-base text-green-700">✓ Abgeschlossen</span>
        {nextHref && (
          <a href={nextHref} className="text-sm underline">
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
