"use client";

import { useState, useTransition } from "react";
import { reembedCourse } from "@/lib/ai/actions";

/**
 * Manueller Trigger für `reembedCourse()` (Phase 3, Block 2). Ohne diesen
 * Button wäre die Server Action aus `src/lib/ai/actions.ts` für Josip lokal
 * nicht testbar/nutzbar — es gab bisher keinen UI-Einstiegspunkt (bewusst,
 * siehe Dateikopf-Kommentar in `actions.ts`: kein Auto-Trigger bei Autosave).
 * Gleiches Muster wie `publish-toggle.tsx` (useTransition, Server Action
 * direkt aus Client-Komponente aufgerufen).
 */
export function ReembedCourseButton({ courseId }: { courseId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await reembedCourse(courseId);
            setMessage(result.message);
          });
        }}
        className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
      >
        {pending ? "Wird eingebettet …" : "Kurs für KI-Suche einbetten"}
      </button>
      {message ? (
        <span role="status" className="text-xs text-gray-600">
          {message}
        </span>
      ) : null}
    </div>
  );
}
