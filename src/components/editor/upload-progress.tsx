"use client";

import { Check, Upload } from "lucide-react";
import type { BunnyUploadState } from "@/lib/bunny/use-bunny-upload";

/**
 * Gemeinsame Präsentationskomponente für den Bunny-Upload-Fortschritt —
 * genutzt von `video-upload.tsx` (Datei-Upload) und `video-source-switch.tsx`
 * (Aufnahme-Upload), Refactor „Schritt A" aus dem Aufnahme-Plan. Barriere-
 * freiheit (CLAUDE.md §3.4): Fortschritt/Erfolg als `role="status"`
 * (aria-live="polite", Screenreader liest Änderungen automatisch vor),
 * Fehler als `role="alert"` (unterbricht sofort).
 *
 * Design-Update (Kurs-Editor-Design, AdminVideoAufnahme.dc.html): echter
 * Fortschrittsbalken (Prozent + gefüllter Track) statt reinem Text.
 */
export function UploadProgress({ state }: { state: BunnyUploadState }) {
  if (state.status === "idle") return null;

  if (state.status === "creating") {
    return (
      <p
        role="status"
        className="rounded-xl border px-4 py-3 text-sm font-semibold"
        style={{ borderColor: "#EEF0F7", color: "#3E3F66" }}
      >
        Video wird angelegt …
      </p>
    );
  }

  if (state.status === "uploading") {
    return (
      <div className="rounded-xl border p-4" style={{ borderColor: "#EEF0F7" }}>
        <div role="status" className="mb-2.5 flex items-center gap-2.5">
          <Upload size={17} aria-hidden="true" style={{ color: "#5663AE" }} />
          <span className="flex-1 text-sm font-bold" style={{ color: "#1A1A2E" }}>
            Wird hochgeladen …
          </span>
          <span className="text-sm font-extrabold tabular-nums" style={{ color: "#5663AE" }}>
            {state.percent} %
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full" style={{ background: "#EEF0F7" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${state.percent}%`, background: "#5663AE" }}
          />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <p
        role="alert"
        className="rounded-xl border px-4 py-3 text-sm font-bold"
        style={{ borderColor: "#E9CFCF", background: "#FBEAEA", color: "#B14A4A" }}
      >
        {state.message}
      </p>
    );
  }

  return (
    <p
      role="status"
      className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold"
      style={{ borderColor: "#E7E8F2", color: "#1F8A5B" }}
    >
      <Check size={16} aria-hidden="true" />
      Upload abgeschlossen.
    </p>
  );
}
