"use client";

import type { BunnyUploadState } from "@/lib/bunny/use-bunny-upload";

/**
 * Gemeinsame Präsentationskomponente für den Bunny-Upload-Fortschritt —
 * genutzt von `video-upload.tsx` (Datei-Upload) und `video-source-switch.tsx`
 * (Aufnahme-Upload), Refactor „Schritt A" aus dem Aufnahme-Plan. Barriere-
 * freiheit (CLAUDE.md §3.4): Fortschritt/Erfolg als `role="status"`
 * (aria-live="polite", Screenreader liest Änderungen automatisch vor),
 * Fehler als `role="alert"` (unterbricht sofort).
 */
export function UploadProgress({ state }: { state: BunnyUploadState }) {
  if (state.status === "idle") return null;

  if (state.status === "creating") {
    return (
      <p role="status" className="text-sm text-gray-500">
        Video wird angelegt …
      </p>
    );
  }

  if (state.status === "uploading") {
    return (
      <p role="status" className="text-sm text-gray-500">
        Lade hoch … {state.percent}%
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm text-red-600">
        {state.message}
      </p>
    );
  }

  return (
    <p role="status" className="text-sm text-green-700">
      Upload abgeschlossen.
    </p>
  );
}
