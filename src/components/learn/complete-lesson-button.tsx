"use client";

import { useTransition } from "react";
import { completeLesson } from "@/lib/progress/actions";

export function CompleteLessonButton({
  lessonId,
  courseSlug,
  alreadyCompleted,
  nextHref,
  nextLabel = "Nächste Lektion",
}: {
  lessonId: string;
  courseSlug: string;
  alreadyCompleted: boolean;
  nextHref: string | null;
  /**
   * Josips Auftrag (22.07.2026, Sektion-/Modul-Abschluss-Bildschirm): `nextHref`
   * zeigt bei einer Grenz-Lektion (letzte einer Sektion/eines Moduls) jetzt auf
   * den neuen Zwischenbildschirm statt auf die nächste Lektion. Aufrufer
   * übergeben dann einen passenden Text (siehe l/[lessonId]/page.tsx) — Default
   * "Nächste Lektion" gilt für den Normalfall (kein Grenzfall), "Nächstes
   * Modul" für die letzte Lektion eines Moduls, "Sektion ansehen →" für die
   * letzte Lektion einer Sektion (Josips Auftrag 23.07.2026).
   */
  nextLabel?: string;
}) {
  const [pending, startTransition] = useTransition();

  // Größenabgleich (24.07.2026, Josips Auftrag "ordentlich und übersichtlich
  // in der mobilen App"): identische Maße wie BookmarkButton/"Feedback
  // geben" (rounded-[11px] px-4 py-[11px] text-sm) statt der bisherigen
  // größeren px-4 py-2 text-base — alle vier Fußzeilen-Buttons der
  // Lektionsseite sollen gleich groß wirken. Der "✓ Abgeschlossen"-Hinweis
  // ist NICHT mehr Teil dieser Komponente (wanderte auf Seitenebene, siehe
  // l/[lessonId]/page.tsx) — dort lässt er sich frei im Fußzeilen-Raster
  // platzieren, unabhängig von diesem Button.
  const buttonClass = "inline-flex items-center justify-center rounded-[11px] px-4 py-[11px] text-sm font-semibold text-white no-underline disabled:opacity-50";
  const buttonStyle = { background: "var(--color-primary)" };

  if (alreadyCompleted) {
    if (!nextHref) return null;
    return (
      <a href={nextHref} className={buttonClass} style={buttonStyle}>
        {nextLabel}
      </a>
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
      className={buttonClass}
      style={buttonStyle}
    >
      {pending ? "Wird gespeichert …" : "Lektion abschließen"}
    </button>
  );
}
