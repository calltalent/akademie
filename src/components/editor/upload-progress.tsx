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
    <div role="status" className="flex flex-col gap-2 rounded-xl border p-4" style={{ borderColor: "#E7E8F2" }}>
      <p className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "#1F8A5B" }}>
        <Check size={16} aria-hidden="true" />
        Upload abgeschlossen.
      </p>
      {/* Josips Meldung (23.07.2026): direkt nach "Verwenden" in der
          Lernansicht geprüft und dort nur "Processing video" gesehen — das
          Video war NICHT hängengeblieben (Bunny-Check bestätigt: fertig
          verarbeitet, keine Fehler), es lief nur noch bei Bunny im
          Encoding (bei den beobachteten Testvideos 1 bis ca. 5 Minuten,
          abhängig von Bunnys Warteschlange). Die Lernansicht aktualisiert
          sich seitdem selbst automatisch (VideoProcessingStatus, siehe
          block-renderer.tsx) — dieser Hinweis bleibt trotzdem, damit die
          Wartezeit direkt nach dem Hochladen nicht wie ein Fehler wirkt. */}
      <p className="text-sm" style={{ color: "#66679B" }}>
        Bunny verarbeitet das Video jetzt noch im Hintergrund — das kann je nach Auslastung einige Minuten dauern.
        Die Lernansicht zeigt in der Zwischenzeit „Video wird noch verarbeitet&quot; und aktualisiert sich von
        selbst, sobald es fertig ist.
      </p>
    </div>
  );
}
