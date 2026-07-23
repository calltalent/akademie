"use client";

import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from "@/lib/courses/asset-upload-schema";

type UploadState = { status: "idle" } | { status: "uploading" } | { status: "error"; message: string };

/**
 * Generische 16:9-Bild-Kachel (Kurs-Thumbnail, 18.07.2026; verallgemeinert
 * 19.07.2026 für das Modulbild — "ähnlich wie für Kurse", Josips Auftrag).
 * Kennt weder Kurs noch Modul: der Aufrufer bindet die Persistenz über
 * `onUpload` (z. B. `(url) => updateCourseCoverUrl(courseId, url)` bzw.
 * `(url) => updateModuleCoverUrl(moduleId, courseId, url)`), diese Kachel
 * kümmert sich nur um Dateiauswahl/-validierung/-upload + optimistisches
 * Anzeigen. Ein Wechsel der Persistenz-Zielentität braucht dadurch keine
 * zweite Kopie dieser ~100 Zeilen Upload-Mechanik.
 *
 * "Automatisch zugeschnitten und positioniert" ist bewusst über CSS gelöst
 * (`object-fit: cover; object-position: center`), nicht über einen manuellen
 * Zuschneide-Dialog — siehe ursprüngliche Begründung beim Kurs-Thumbnail.
 *
 * `uploadUrlEndpoint`/`extraUploadFields` NEU (19.07.2026, Mandanten-Logo-
 * Upload im Betreiber-Portal): der bisher fest verdrahtete Endpoint
 * `/api/course-assets/upload-url` prüft `requireStaffTenant()`
 * (Mandanten-Mitgliedschaft) — ein Platform-Admin im Portal ist aber i. A.
 * kein Mitglied des gerade bearbeiteten Mandanten. Beide Props sind
 * optional mit demselben Default wie bisher, bestehende Aufrufer (Kurs-/
 * Modul-/Produktbild) sind dadurch unverändert.
 */
export function ThumbnailUpload({
  initialUrl,
  entityLabel,
  entityTitle,
  onUpload,
  uploadUrlEndpoint = "/api/course-assets/upload-url",
  extraUploadFields,
}: {
  initialUrl: string | null;
  /** z. B. "Kursbild" oder "Modulbild" — für das aria-label. */
  entityLabel: string;
  entityTitle: string;
  onUpload: (url: string) => Promise<{ error: string | null }>;
  /** z. B. "/api/portal/tenant-logo/upload-url" für Aufrufer außerhalb des Mandanten-Kontexts. */
  uploadUrlEndpoint?: string;
  /** Zusätzliche Felder im Upload-URL-Request-Body, z. B. `{ tenantId }`. */
  extraUploadFields?: Record<string, string>;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [state, setState] = useState<UploadState>({ status: "idle" });

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
    const res = await fetch(uploadUrlEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "image",
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        ...extraUploadFields,
      }),
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
      console.error("[thumbnail-upload] Datei-Upload fehlgeschlagen.", uploadError);
      setState({ status: "error", message: "Datei-Upload fehlgeschlagen. Bitte versuche es erneut." });
      return;
    }

    const { data } = browserSupabase.storage.from("course-assets").getPublicUrl(path);
    const result = await onUpload(data.publicUrl);
    if (result.error) {
      setState({ status: "error", message: result.error });
      return;
    }
    setUrl(data.publicUrl);
    setState({ status: "idle" });
  }

  const pending = state.status === "uploading";

  return (
    <div className="flex flex-col gap-1">
      <label
        className="relative flex h-8 w-14 flex-none cursor-pointer items-center justify-center overflow-hidden rounded-[8px]"
        style={{ background: "#DFE2F4" }}
        title={url ? `${entityLabel} ändern` : `${entityLabel} hinzufügen`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
          <img
            src={url}
            alt=""
            className="h-full w-full object-cover object-center"
          />
        ) : (
          <ImagePlus size={16} aria-hidden="true" style={{ color: "#5663AE" }} />
        )}
        {pending && (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center text-[9px] font-bold"
            style={{ background: "rgba(255,255,255,.85)", color: "#5663AE" }}
          >
            …
          </span>
        )}
        <input
          type="file"
          accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
          disabled={pending}
          aria-label={url ? `${entityLabel} ändern: ${entityTitle}` : `${entityLabel} hinzufügen: ${entityTitle}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
          className="sr-only"
        />
      </label>
      {state.status === "error" && (
        <p role="alert" className="max-w-[110px] text-[10px] font-semibold leading-tight" style={{ color: "#B14A4A" }}>
          {state.message}
        </p>
      )}
    </div>
  );
}
