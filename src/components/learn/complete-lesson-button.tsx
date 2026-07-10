"use client";

import { useTransition } from "react";
import { completeLesson } from "@/lib/progress/actions";

export function CompleteLessonButton({
  lessonId,
  courseSlug,
  alreadyCompleted,
  nextHref,
}: {
  lessonId: string;
  courseSlug: string;
  alreadyCompleted: boolean;
  nextHref: string | null;
}) {
  const [pending, startTransition] = useTransition();

  if (alreadyCompleted) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-base text-green-700">✓ Abgeschlossen</span>
        {nextHref && (
          <a href={nextHref} className="text-sm underline">
            Weiter zur nächsten Lektion →
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
