"use client";

import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from "@/lib/courses/asset-upload-schema";

type UploadState = { status: "idle" } | { status: "uploading" } | { status: "error"; message: string };

/**
 * Drag&Drop-/Dateiauswahl-Upload für den `+Bild`-Block (Josips Wunsch,
 * 17.07.2026: "per drag and drop ein Bild hinzufügen oder eins vom PC
 * auswählen"). Ergänzt das bestehende manuelle Bild-URL-Feld in
 * `block-form.tsx` — ersetzt es NICHT: ein Trainer kann weiterhin eine
 * bereits gehostete externe Bild-URL eintragen, dieser Weg ist nur eine
 * zweite, schnellere Option.
 *
 * Dieselbe Dropzone-Optik/Interaktion wie `video-source-switch.tsx`
 * (gestrichelter Rahmen, Hervorhebung beim Drag-Over, `sr-only`
 * Datei-Input) — Konsistenz im Editor, kein neues Muster.
 *
 * Ablauf (Muster wie `submission-form.tsx`): signierte Upload-URL vom
 * Server holen (`/api/course-assets/upload-url`, staff-gated,
 * RLS-Schreibpolicy `course_assets_staff_write`), Datei direkt vom Browser
 * zu Supabase Storage hochladen, danach `getPublicUrl()` — der Bucket ist
 * öffentlich lesbar (siehe `imageBlockSchema`/`block-renderer.tsx`, reines
 * `<img src=…>`), die URL trägt also keine Autorisierung und kann direkt in
 * den Block geschrieben werden.
 *
 * Kein Fortschrittsbalken (anders als `UploadProgress`/`BunnyUploadState`):
 * Bilder sind auf 8 MB begrenzt und laufen in einem einzigen Request statt
 * eines TUS-Resumable-Uploads — ein knapper "Wird hochgeladen …"-Status
 * reicht, ein Prozentwert wäre hier nur Schein-Genauigkeit.
 */
export function ImageUpload({
  currentUrl,
  onUploaded,
}: {
  currentUrl: string;
  onUploaded: (url: string) => void;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [isDragOver, setIsDragOver] = useState(false);

  async function handleFile(file: File) {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
      setState({
        status: "error",
        message: `Dateityp „${file.type || "unbekannt"}" nicht erlaubt. Erlaubt: PNG, JPG, WebP, GIF.`,
      });
      return;
    }
    if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
      setState({ status: "error", message: "Datei zu groß (max. 8 MB)." });
      return;
    }

    setState({ status: "uploading" });
    const res = await fetch("/api/course-assets/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, fileSize: file.size, mimeType: file.type }),
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
      // uploadError.message kommt von der Supabase-Storage-Bibliothek
      // (technisch/englisch) — Detail nur in der Konsole, Nutzer bekommt
      // einen klaren deutschen Satz.
      console.error("[image-upload] Datei-Upload fehlgeschlagen.", uploadError);
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
      {currentUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- Storage-/externe URL, kein next/image-Loader konfiguriert (gleiche Begründung wie block-renderer.tsx)
        <img
          src={currentUrl}
          alt=""
          className="h-28 w-auto max-w-full rounded-lg border object-contain"
          style={{ borderColor: "#E7E8F2" }}
        />
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
          <ImageIcon size={19} aria-hidden="true" style={{ color: "#5663AE" }} />
        </span>
        <span className="text-sm font-bold" style={{ color: "#1A1A2E" }}>
          Bild auswählen oder hierher ziehen
        </span>
        <span className="text-[13px] font-semibold" style={{ color: "#3E3F66" }}>
          PNG, JPG, WebP oder GIF · bis 8 MB
        </span>
        <input
          type="file"
          accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
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
        {state.status === "uploading" && <span style={{ color: "#66679B" }}>Bild wird hochgeladen …</span>}
        {state.status === "error" && (
          <span role="alert" className="font-semibold" style={{ color: "#B14A4A" }}>
            {state.message}
          </span>
        )}
      </p>
    </div>
  );
}
