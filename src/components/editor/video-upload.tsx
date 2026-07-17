"use client";

import { ALLOWED_TYPES, useBunnyUpload } from "@/lib/bunny/use-bunny-upload";
import { UploadProgress } from "@/components/editor/upload-progress";

/**
 * Reiner Datei-Upload — seit dem Aufnahme-Plan-Refactor („Schritt A",
 * `calm-watching-dewdrop.md`) nur noch File-Input + Fortschrittsanzeige, der
 * eigentliche Upload-Ablauf steckt in `useBunnyUpload`. Verhalten, Texte und
 * Fehlermeldungen gegenüber der Vorversion unverändert (siehe PHASENSTATUS.md).
 */
export function VideoUpload({
  currentVideoId,
  onUploaded,
}: {
  currentVideoId: string | null;
  onUploaded: (videoId: string) => void;
}) {
  const { state, start } = useBunnyUpload(onUploaded);

  return (
    <div className="flex flex-col gap-2">
      {currentVideoId && (
        <p className="text-sm text-gray-500">Aktuelles Video: {currentVideoId}</p>
      )}
      <input
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) start(file, file.name);
        }}
        className="text-sm"
      />
      <UploadProgress state={state} />
    </div>
  );
}
