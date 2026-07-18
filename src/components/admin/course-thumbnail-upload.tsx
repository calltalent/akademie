"use client";

import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from "@/lib/courses/asset-upload-schema";
import { updateCourseCoverUrl } from "@/lib/courses/actions";

type UploadState = { status: "idle" } | { status: "uploading" } | { status: "error"; message: string };

/**
 * Kurs-Thumbnail (16:9) in der Kursliste (Josips Auftrag, 18.07.2026:
 * "Option für das Hinzufügen vom Kurs-Thumbnail ... Klick öffnet die
 * Dateiauswahl vom PC ... automatisch zugeschnitten und positioniert").
 *
 * "Automatisch zugeschnitten und positioniert" ist bewusst über CSS gelöst
 * (`object-fit: cover; object-position: center` auf der 16:9-Box), nicht
 * über einen manuellen Zuschneide-Dialog: das Wort "automatisch" im Auftrag
 * heißt gerade OHNE Handeingriff — ein Crop-Werkzeug (Ziehen/Zoomen) wäre
 * das Gegenteil davon und eine erhebliche Zusatzfunktion, die nicht verlangt
 * wurde. Ein hochgeladenes Bild beliebigen Formats füllt die Kachel dadurch
 * immer lückenlos, mittig beschnitten.
 *
 * Kein Drag&Drop hier (anders als `image-upload.tsx` für den `+Bild`-Block):
 * der Auftrag nennt für diese Stelle nur "Klick öffnet Dateiauswahl" — eine
 * kleine Tabellen-/Listenkachel ist zudem keine sinnvolle Drop-Zielfläche
 * neben den übrigen Zeilen. Upload-Mechanik (signierte URL, Bucket,
 * Grössen-/Typ-Whitelist) ist exakt dieselbe wie beim Bild-Block —
 * geteilte Konstanten aus `asset-upload-schema.ts`, keine Dopplung.
 *
 * Lokal optimistisch aktualisiert (kein `router.refresh()` nötig): die
 * Kachel zeigt das neue Bild sofort, `updateCourseCoverUrl()` persistiert im
 * Hintergrund. Bei einem Fehler bliebe der Server-Stand ohnehin die Wahrheit
 * beim nächsten echten Neuladen — für eine Kachel in einer Verwaltungsliste
 * ist das ausreichend, ein Rollback-Mechanismus wäre hier Überbau.
 */
export function CourseThumbnailUpload({
  courseId,
  initialUrl,
  courseTitle,
}: {
  courseId: string;
  initialUrl: string | null;
  courseTitle: string;
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
      console.error("[course-thumbnail-upload] Datei-Upload fehlgeschlagen.", uploadError);
      setState({ status: "error", message: "Datei-Upload fehlgeschlagen. Bitte versuche es erneut." });
      return;
    }

    const { data } = browserSupabase.storage.from("course-assets").getPublicUrl(path);
    const result = await updateCourseCoverUrl(courseId, data.publicUrl);
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
        title={url ? "Kursbild ändern" : "Kursbild hinzufügen"}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert (gleiche Begründung wie block-renderer.tsx)
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
          aria-label={url ? `Kursbild ändern: ${courseTitle}` : `Kursbild hinzufügen: ${courseTitle}`}
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
