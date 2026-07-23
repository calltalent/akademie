"use client";

import { useState } from "react";
import { Music } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { ALLOWED_AUDIO_MIME_TYPES, MAX_AUDIO_FILE_SIZE_BYTES } from "@/lib/courses/asset-upload-schema";

type UploadState = { status: "idle" } | { status: "uploading" } | { status: "error"; message: string };

/**
 * Drag&Drop-/Dateiauswahl-Upload für den `+Audio`-Block (Josips Auftrag,
 * 23.07.2026: "bei Audio, Datei immer die Option ermöglichen Dateien vom PC
 * auszuwählen"). Gleiches Muster wie `image-upload.tsx` — ergänzt das
 * manuelle Audio-URL-Feld in `block-form.tsx`, ersetzt es nicht (eine bereits
 * gehostete externe Audio-URL bleibt weiterhin eintragbar).
 *
 * Läuft über dieselbe Route wie der Bild-Upload (`/api/course-assets/
 * upload-url`, jetzt mit `kind: "audio"` — siehe asset-upload-schema.ts):
 * signierte Upload-URL holen, Datei direkt vom Browser zu Supabase Storage
 * hochladen, danach `getPublicUrl()`.
 */
export function AudioUpload({
  currentUrl,
  onUploaded,
}: {
  currentUrl: string;
  onUploaded: (url: string) => void;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [isDragOver, setIsDragOver] = useState(false);

  async function handleFile(file: File) {
    if (!ALLOWED_AUDIO_MIME_TYPES.includes(file.type as (typeof ALLOWED_AUDIO_MIME_TYPES)[number])) {
      setState({
        status: "error",
        message: `Dateityp „${file.type || "unbekannt"}" nicht erlaubt. Erlaubt: MP3, WAV, OGG, M4A, WebM.`,
      });
      return;
    }
    if (file.size > MAX_AUDIO_FILE_SIZE_BYTES) {
      setState({ status: "error", message: "Datei zu groß (max. 50 MB)." });
      return;
    }

    setState({ status: "uploading" });
    const res = await fetch("/api/course-assets/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "audio", fileName: file.name, fileSize: file.size, mimeType: file.type }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setState({ status: "error", message: body.error ?? "Upload-URL konnte nicht erzeugt werden." });
      return;
    }
    const { path, token } = (await res.json()) as { path: string; token: string };

    const browserSupabase = createBrowserClient();
    const { error: uploadError } = await browserSupabase.storage
      .from("course-assets")
      .uploadToSignedUrl(path, token, file);
    if (uploadError) {
      console.error("[audio-upload] Datei-Upload fehlgeschlagen.", uploadError);
      setState({ status: "error", message: "Datei-Upload fehlgeschlagen. Bitte versuche es erneut." });
      return;
    }

    const { data } = browserSupabase.storage.from("course-assets").getPublicUrl(path);
    setState({ status: "idle" });
    onUploaded(data.publicUrl);
  }

  const pending = state.status === "uploading";

  return (
    <div className="flex flex-col gap-2.5">
      {currentUrl && <audio controls src={currentUrl} className="w-full" />}

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
          if (file) handleFile(file);
        }}
        className="flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border-2 border-dashed px-6 py-6 text-center"
        style={{ borderColor: isDragOver ? "#5663AE" : "#C9CBE6", background: "#DFE2F4" }}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white">
          <Music size={19} aria-hidden="true" style={{ color: "#5663AE" }} />
        </span>
        <span className="text-sm font-bold" style={{ color: "#1A1A2E" }}>
          Audiodatei auswählen oder hierher ziehen
        </span>
        <span className="text-[13px] font-semibold" style={{ color: "#3E3F66" }}>
          MP3, WAV, OGG, M4A oder WebM · bis 50 MB
        </span>
        <input
          type="file"
          accept={ALLOWED_AUDIO_MIME_TYPES.join(",")}
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
          className="sr-only"
        />
      </label>

      <p aria-live="polite" className="text-sm">
        {state.status === "uploading" && <span style={{ color: "#66679B" }}>Audiodatei wird hochgeladen …</span>}
        {state.status === "error" && (
          <span role="alert" className="font-semibold" style={{ color: "#B14A4A" }}>
            {state.message}
          </span>
        )}
      </p>
    </div>
  );
}
