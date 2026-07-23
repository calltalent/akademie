"use client";

import { useState } from "react";
import { File as FileIcon } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_FILE_SIZE_BYTES } from "@/lib/courses/asset-upload-schema";

type UploadState = { status: "idle" } | { status: "uploading" } | { status: "error"; message: string };

/**
 * Drag&Drop-/Dateiauswahl-Upload für den `+Datei`-Block (Josips Auftrag,
 * 23.07.2026: "bei Audio, Datei immer die Option ermöglichen Dateien vom PC
 * auszuwählen"). Gleiches Muster wie `image-upload.tsx`/`audio-upload.tsx`
 * — ergänzt die manuellen URL-/Dateiname-Felder in `block-form.tsx`, ersetzt
 * sie nicht. Anders als dort liefert `onUploaded` zusätzlich den
 * ursprünglichen Dateinamen mit (Datei-Block hat ein eigenes
 * `filename`-Feld für den Anzeigetext des Download-Links, siehe
 * block-renderer.tsx) — Dateiname wird direkt aus der ausgewählten Datei
 * übernommen, bleibt danach aber im Formular weiter änderbar.
 */
export function FileUpload({
  currentUrl,
  onUploaded,
}: {
  currentUrl: string;
  onUploaded: (url: string, filename: string) => void;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [isDragOver, setIsDragOver] = useState(false);

  async function handleFile(file: File) {
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number])) {
      setState({
        status: "error",
        message: `Dateityp „${file.type || "unbekannt"}" nicht erlaubt. Erlaubt: PDF, Word, Excel, PowerPoint, Text, ZIP.`,
      });
      return;
    }
    if (file.size > MAX_DOCUMENT_FILE_SIZE_BYTES) {
      setState({ status: "error", message: "Datei zu groß (max. 50 MB)." });
      return;
    }

    setState({ status: "uploading" });
    const res = await fetch("/api/course-assets/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "document", fileName: file.name, fileSize: file.size, mimeType: file.type }),
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
      console.error("[file-upload] Datei-Upload fehlgeschlagen.", uploadError);
      setState({ status: "error", message: "Datei-Upload fehlgeschlagen. Bitte versuche es erneut." });
      return;
    }

    const { data } = browserSupabase.storage.from("course-assets").getPublicUrl(path);
    setState({ status: "idle" });
    onUploaded(data.publicUrl, file.name);
  }

  const pending = state.status === "uploading";

  return (
    <div className="flex flex-col gap-2.5">
      {currentUrl && (
        <a
          href={currentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline"
          style={{ color: "#5663AE" }}
        >
          Aktuelle Datei ansehen
        </a>
      )}

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
          <FileIcon size={19} aria-hidden="true" style={{ color: "#5663AE" }} />
        </span>
        <span className="text-sm font-bold" style={{ color: "#1A1A2E" }}>
          Datei auswählen oder hierher ziehen
        </span>
        <span className="text-[13px] font-semibold" style={{ color: "#3E3F66" }}>
          PDF, Word, Excel, PowerPoint, Text oder ZIP · bis 50 MB
        </span>
        <input
          type="file"
          accept={ALLOWED_DOCUMENT_MIME_TYPES.join(",")}
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
        {state.status === "uploading" && <span style={{ color: "#66679B" }}>Datei wird hochgeladen …</span>}
        {state.status === "error" && (
          <span role="alert" className="font-semibold" style={{ color: "#B14A4A" }}>
            {state.message}
          </span>
        )}
      </p>
    </div>
  );
}
