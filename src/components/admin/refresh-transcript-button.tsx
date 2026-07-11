"use client";

import { useState, useTransition } from "react";
import { refreshLessonTranscript } from "@/lib/video/actions";

/**
 * Manueller Auslöser für `refreshLessonTranscript()` (Phase 3, Block 6) —
 * lokaler Ersatzweg für den nicht empfangbaren Bunny-Webhook, gleiches
 * Muster wie `ReembedCourseButton` (Block 2/3).
 */
export function RefreshTranscriptButton({ lessonId }: { lessonId: string }) {
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
            const result = await refreshLessonTranscript(lessonId);
            setMessage(result.message);
          });
        }}
        className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
      >
        {pending ? "Wird aktualisiert …" : "Transkript aktualisieren"}
      </button>
      {message ? (
        <span role="status" className="text-xs text-gray-600">
          {message}
        </span>
      ) : null}
    </div>
  );
}
