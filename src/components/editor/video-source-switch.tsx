"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Upload } from "lucide-react";
import { ALLOWED_TYPES, useBunnyUpload } from "@/lib/bunny/use-bunny-upload";
import { UploadProgress } from "@/components/editor/upload-progress";
import { VideoRadioGroup } from "@/components/editor/video-radio-group";

const VideoRecorder = dynamic(
  () => import("@/components/editor/video-recorder").then((m) => m.VideoRecorder),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm" style={{ color: "#66679B" }}>
        Aufnahme-Werkzeug wird geladen …
      </p>
    ),
  },
);

type SourceMode = "upload" | "record";

/**
 * Eigenständiges "Aufnehmen"-Icon (zwei konzentrische Kreise, roter Punkt) —
 * aus der Design-Referenz AdminKursEditor.dc.html übernommen, kein
 * Lucide-Äquivalent vorhanden.
 */
function RecordDotIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="12" cy="12" r="4" fill="#B14A4A" />
    </svg>
  );
}

/**
 * Umschalter „Hochladen | Aufnehmen" im `+Video`-Block (Kurs-Editor, Stufe 1
 * „Aufnahme" aus `calm-watching-dewdrop.md`, Schritt B). Hält als EINZIGE
 * Komponente den `useBunnyUpload`-Hook — `VideoRecorder` bekommt nur das
 * fertige Blob über `onConfirm` und importiert den Hook selbst nie (siehe
 * Kommentar dort: Kostensicherheit, jeder Bunny-Upload löst automatisch
 * kostenpflichtiges Transcribe aus).
 *
 * Design-Update (AdminKursEditor.dc.html): Segment-Control statt Radio-Text-
 * Buttons, Datei-Auswahl als große Dropzone. WICHTIG (Abweichung vom
 * Design-Export, siehe Übergabebericht): der Export zeigt „MP4 oder MOV ·
 * bis 20 Minuten" und `accept="video/mp4,video/quicktime"` — beides falsch
 * für Datei-Uploads (die 20-Minuten-Grenze gilt nur für Aufnahmen). Text und
 * `accept` hier bewusst aus `ALLOWED_TYPES`/`MAX_SIZE_BYTES`
 * (`use-bunny-upload.ts`) abgeleitet: mp4/quicktime/webm/mkv, bis 2 GB, keine
 * Dauer-Begrenzung. Der Hinweis auf automatische Untertitel aus dem Export
 * entfällt ebenfalls (Bunny-Webhook für Transkription steht noch aus).
 */
export function VideoSourceSwitch({
  currentVideoId,
  onUploaded,
}: {
  currentVideoId: string | null;
  onUploaded: (videoId: string) => void;
}) {
  const [mode, setMode] = useState<SourceMode>("upload");
  const [isDragOver, setIsDragOver] = useState(false);
  const { state, start, reset } = useBunnyUpload(onUploaded);

  return (
    <div className="flex flex-col gap-3.5">
      {currentVideoId && (
        <p className="text-sm" style={{ color: "#66679B" }}>
          Aktuelles Video: {currentVideoId}
        </p>
      )}

      <VideoRadioGroup
        label="Videoquelle"
        value={mode}
        onChange={(next) => {
          setMode(next);
          reset();
        }}
        options={[
          { value: "upload", label: "Video hochladen", icon: <Upload size={15} aria-hidden="true" /> },
          { value: "record", label: "Video aufnehmen", icon: <RecordDotIcon /> },
        ]}
      />

      {mode === "upload" && (
        <div className="flex flex-col gap-2.5">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) start(file, file.name);
            }}
            className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-8 py-8 text-center"
            style={{ borderColor: isDragOver ? "#5663AE" : "#C9CBE6", background: "#DFE2F4" }}
          >
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-white">
              <Upload size={22} aria-hidden="true" style={{ color: "#5663AE" }} />
            </span>
            <span className="text-base font-bold" style={{ color: "#1A1A2E" }}>
              Videodatei auswählen oder hierher ziehen
            </span>
            <span className="text-[13px] font-semibold" style={{ color: "#3E3F66" }}>
              MP4, MOV, WebM oder MKV · bis 2 GB
            </span>
            <input
              type="file"
              accept={ALLOWED_TYPES.join(",")}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) start(file, file.name);
              }}
              className="sr-only"
            />
          </label>
          <UploadProgress state={state} />
        </div>
      )}

      {mode === "record" && (
        <VideoRecorder onConfirm={(blob, filename) => start(blob, filename)} uploadState={state} />
      )}
    </div>
  );
}
