"use client";

import { useState } from "react";
import * as tus from "tus-js-client";

/** Sicherheitsregel CLAUDE.md §2.5: Typ- und Größen-Whitelist bei Uploads. */
const ALLOWED_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
const MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; percent: number }
  | { status: "error"; message: string }
  | { status: "done" };

export function VideoUpload({
  currentVideoId,
  onUploaded,
}: {
  currentVideoId: string | null;
  onUploaded: (videoId: string) => void;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });

  async function handleFile(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setState({
        status: "error",
        message: `Dateityp „${file.type || "unbekannt"}" nicht erlaubt. Erlaubt: MP4, MOV, WebM, MKV.`,
      });
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setState({ status: "error", message: "Datei zu groß (max. 2 GB)." });
      return;
    }

    setState({ status: "uploading", percent: 0 });

    const res = await fetch("/api/bunny/create-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: file.name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setState({ status: "error", message: body.error ?? "Video konnte nicht angelegt werden." });
      return;
    }
    const credentials = (await res.json()) as {
      videoId: string;
      libraryId: string;
      expirationTime: number;
      signature: string;
    };

    const upload = new tus.Upload(file, {
      endpoint: "https://video.bunnycdn.com/tusupload",
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        AuthorizationSignature: credentials.signature,
        AuthorizationExpire: String(credentials.expirationTime),
        VideoId: credentials.videoId,
        LibraryId: credentials.libraryId,
      },
      metadata: { filetype: file.type, title: file.name },
      onError(error) {
        // error.message kommt vom tus-js-client (Netzwerk-/Protokollfehler,
        // technisch/englisch) — Detail nur in der Konsole, Nutzer bekommt
        // einen klaren deutschen Satz.
        console.error("[video-upload] Upload fehlgeschlagen.", error);
        setState({ status: "error", message: "Der Video-Upload ist fehlgeschlagen. Bitte versuche es erneut." });
      },
      onProgress(bytesUploaded, bytesTotal) {
        setState({ status: "uploading", percent: Math.round((bytesUploaded / bytesTotal) * 100) });
      },
      onSuccess() {
        setState({ status: "done" });
        onUploaded(credentials.videoId);
      },
    });

    const previous = await upload.findPreviousUploads();
    if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
    upload.start();
  }

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
          if (file) handleFile(file);
        }}
        className="text-sm"
      />
      {state.status === "uploading" && (
        <p className="text-sm text-gray-500">Lade hoch … {state.percent}%</p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      )}
      {state.status === "done" && <p className="text-sm text-green-700">Upload abgeschlossen.</p>}
    </div>
  );
}
