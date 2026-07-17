"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ALLOWED_TYPES, useBunnyUpload } from "@/lib/bunny/use-bunny-upload";
import { UploadProgress } from "@/components/editor/upload-progress";
import { VideoRadioGroup } from "@/components/editor/video-radio-group";

const VideoRecorder = dynamic(
  () => import("@/components/editor/video-recorder").then((m) => m.VideoRecorder),
  {
    ssr: false,
    loading: () => <p className="text-sm text-gray-500">Aufnahme-Werkzeug wird geladen …</p>,
  },
);

type SourceMode = "upload" | "record";

/**
 * Umschalter „Hochladen | Aufnehmen" im `+Video`-Block (Kurs-Editor, Stufe 1
 * „Aufnahme" aus `calm-watching-dewdrop.md`, Schritt B). Hält als EINZIGE
 * Komponente den `useBunnyUpload`-Hook — `VideoRecorder` bekommt nur das
 * fertige Blob über `onConfirm` und importiert den Hook selbst nie (siehe
 * Kommentar dort: Kostensicherheit, jeder Bunny-Upload löst automatisch
 * kostenpflichtiges Transcribe aus).
 */
export function VideoSourceSwitch({
  currentVideoId,
  onUploaded,
}: {
  currentVideoId: string | null;
  onUploaded: (videoId: string) => void;
}) {
  const [mode, setMode] = useState<SourceMode>("upload");
  const { state, start, reset } = useBunnyUpload(onUploaded);

  return (
    <div className="flex flex-col gap-3">
      {currentVideoId && <p className="text-sm text-gray-500">Aktuelles Video: {currentVideoId}</p>}

      <VideoRadioGroup
        label="Videoquelle"
        value={mode}
        onChange={(next) => {
          setMode(next);
          reset();
        }}
        options={[
          { value: "upload", label: "Video hochladen" },
          { value: "record", label: "Video aufnehmen" },
        ]}
      />

      {mode === "upload" && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Videodatei auswählen
            <input
              type="file"
              accept={ALLOWED_TYPES.join(",")}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) start(file, file.name);
              }}
              className="text-sm"
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
