"use client";

import { useCallback, useRef, useState } from "react";
import * as tus from "tus-js-client";

/**
 * Kapselt den kompletten Bunny-TUS-Upload-Ablauf (vorher inline in
 * `video-upload.tsx`) — Refactor „Schritt A" aus dem Aufnahme-Plan
 * (`calm-watching-dewdrop.md`), Verhalten für den bestehenden Datei-Upload
 * bewusst identisch. Einziger neuer Konsument ist später `video-source-
 * switch.tsx` (Schritt B), damit auch aufgenommene Blobs denselben,
 * geprüften Upload-Pfad nutzen.
 */

/** Sicherheitsregel CLAUDE.md §2.5: Typ- und Größen-Whitelist bei Uploads. */
export const ALLOWED_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
export const MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

/**
 * MIME-Typen aus `<input type="file">` sind rein (z. B. "video/webm"), aber
 * ein MediaRecorder-Blob liefert Codec-Parameter mit ("video/webm;codecs=
 * vp8,opus") — ohne Normalisierung matcht `ALLOWED_TYPES.includes(...)` nie
 * (Blocker B2 aus dem Plan). Gilt für BEIDE Quellen (Datei und Aufnahme) —
 * kein Sonderfall für den Recorder, sondern eine korrekt entschärfte
 * Whitelist-Prüfung, die vorher für Datei-Uploads nur zufällig nie auffiel.
 */
function normalizeMimeType(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

export type BunnyUploadState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "uploading"; percent: number }
  | { status: "error"; message: string }
  | { status: "done"; videoId: string };

type TusCredentials = {
  videoId: string;
  libraryId: string;
  expirationTime: number;
  signature: string;
};

export function useBunnyUpload(onUploaded: (videoId: string) => void) {
  const [state, setState] = useState<BunnyUploadState>({ status: "idle" });
  // Reentrancy-Schutz (Kostensicherheit, Plan-Risiko R5): ein Doppelklick auf
  // "Verwenden"/erneutes onChange darf nicht zwei kostenpflichtige Bunny-
  // Videos anlegen. Ref statt State, weil er synchron zu Beginn von start()
  // geprüft werden muss, bevor der erste await läuft.
  const busyRef = useRef(false);

  const start = useCallback(
    async (source: Blob | File, filename: string) => {
      if (busyRef.current) return;

      const normalizedType = normalizeMimeType(source.type);
      if (!ALLOWED_TYPES.includes(normalizedType)) {
        setState({
          status: "error",
          message: `Dateityp „${source.type || "unbekannt"}" nicht erlaubt. Erlaubt: MP4, MOV, WebM, MKV.`,
        });
        return;
      }
      if (source.size > MAX_SIZE_BYTES) {
        setState({ status: "error", message: "Datei zu groß (max. 2 GB)." });
        return;
      }

      busyRef.current = true;

      // tus-js-client's Fingerprinting/Resume und `metadata.title` hängen an
      // `File` (nicht `Blob`) — die Quelle wird deshalb IMMER gewrappt, auch
      // wenn sie schon eine File-Instanz ist (ein einheitlicher Pfad statt
      // eines Sonderfalls für Aufnahme-Blobs).
      const file = new File([source], filename, { type: normalizedType });

      setState({ status: "creating" });

      let credentials: TusCredentials;
      try {
        const res = await fetch("/api/bunny/create-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: file.name }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setState({ status: "error", message: body.error ?? "Video konnte nicht angelegt werden." });
          busyRef.current = false;
          return;
        }
        credentials = (await res.json()) as TusCredentials;
      } catch {
        setState({ status: "error", message: "Video konnte nicht angelegt werden. Bitte versuche es erneut." });
        busyRef.current = false;
        return;
      }

      setState({ status: "uploading", percent: 0 });

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
          console.error("[use-bunny-upload] Upload fehlgeschlagen.", error);
          setState({ status: "error", message: "Der Video-Upload ist fehlgeschlagen. Bitte versuche es erneut." });
          busyRef.current = false;
        },
        onProgress(bytesUploaded, bytesTotal) {
          setState({ status: "uploading", percent: Math.round((bytesUploaded / bytesTotal) * 100) });
        },
        onSuccess() {
          setState({ status: "done", videoId: credentials.videoId });
          busyRef.current = false;
          onUploaded(credentials.videoId);
        },
      });

      const previous = await upload.findPreviousUploads();
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    },
    [onUploaded],
  );

  const reset = useCallback(() => {
    busyRef.current = false;
    setState({ status: "idle" });
  }, []);

  return { state, start, reset };
}
