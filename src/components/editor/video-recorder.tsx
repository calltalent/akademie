"use client";

import { useEffect, useRef, useState } from "react";
import type { BunnyUploadState } from "@/lib/bunny/use-bunny-upload";
import { VideoRadioGroup } from "@/components/editor/video-radio-group";
import {
  buildRecordingFilename,
  classifyMediaError,
  formatDuration,
  formatFileSize,
  getMilestoneMessage,
  getRecordingStoppedMessage,
  getUploadQuartileMessage,
  HARD_LIMIT_S,
  HARD_STOP_ALERT_MESSAGE,
  INSECURE_CONTEXT_MESSAGE,
  KEYFRAME_INTERVAL_MS,
  MIC_AUDIO_CONSTRAINTS,
  NO_AUDIO_TRACK_ERROR_NAME,
  NO_MIME_SUPPORT_MESSAGE,
  pickSupportedMimeType,
  RECORDING_STARTED_MESSAGE,
  SCREEN_VIDEO_CONSTRAINTS,
  VIDEO_BITS_PER_SECOND,
  AUDIO_BITS_PER_SECOND,
  WEBCAM_VIDEO_CONSTRAINTS,
  type MediaRecorderOptionsExtended,
} from "@/lib/video/recorder";

/**
 * Bildschirm- oder Webcam-Aufnahme direkt im Browser — Stufe 1 „Aufnahme"
 * aus dem Plan `calm-watching-dewdrop.md`. WICHTIG (Kostensicherheit,
 * Plan-Abschnitt „Kostensicherheit — strukturell, nicht per Disziplin"):
 * diese Komponente importiert `useBunnyUpload` bewusst NIE und ruft niemals
 * `/api/bunny/create-video` auf. Sie meldet das fertige Blob nur nach oben
 * über `onConfirm` — jeder Bunny-Upload läuft automatisch auch ein
 * kostenpflichtiges Transcribe (0,10 $/Min) an, ein „Neu aufnehmen"/
 * „Verwerfen" darf das strukturell nie auslösen können.
 *
 * `uploadState` wird von `video-source-switch.tsx` durchgereicht (die
 * einzige Komponente, die den Upload-Hook hält) und steuert nur die
 * Anzeige, NIE einen eigenen Aufruf.
 */

type RecordingMode = "screen" | "webcam";

type Phase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "ready" }
  | { kind: "recording" }
  | { kind: "stopped"; blob: Blob; durationS: number }
  // "Verwenden" wurde geklickt — ab hier bestimmt `uploadState` (Prop) die Anzeige.
  | { kind: "confirmed" }
  | { kind: "error"; message: string };

const MODE_OPTIONS: { value: RecordingMode; label: string }[] = [
  { value: "screen", label: "Bildschirm aufnehmen" },
  { value: "webcam", label: "Webcam aufnehmen" },
];

export function VideoRecorder({
  onConfirm,
  uploadState,
}: {
  onConfirm: (blob: Blob, filename: string) => void;
  uploadState: BunnyUploadState;
}) {
  const [mode, setMode] = useState<RecordingMode>("screen");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [elapsedS, setElapsedS] = useState(0);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [stoppedUrl, setStoppedUrl] = useState<string | null>(null);

  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  const streamRef = useRef<MediaStream | null>(null);
  // B3: bei der Bildschirmaufnahme stammen Video- und Audio-Track aus ZWEI
  // getrennten getUserMedia/getDisplayMedia-Aufrufen — beide Quell-Streams
  // müssen beim Stoppen vollständig gestoppt werden, nicht nur der
  // zusammengesetzte MediaStream, der an den MediaRecorder ging.
  const originalStreamsRef = useRef<MediaStream[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("");
  const startedAtRef = useRef(0);
  const prevElapsedRef = useRef(0);
  const prevUploadPercentRef = useRef(0);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Für einen "Erneut versuchen"-Knopf nach einem Upload-Fehler — das Blob
  // bleibt erhalten, damit eine 20-Minuten-Aufnahme nicht bei einem
  // Netzwerkfehler verloren geht.
  const retainedRef = useRef<{ blob: Blob; filename: string } | null>(null);

  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const stoppedVideoRef = useRef<HTMLVideoElement | null>(null);
  const stopButtonRef = useRef<HTMLButtonElement | null>(null);
  const stoppedHeadingRef = useRef<HTMLHeadingElement | null>(null);

  function stopAllTracks() {
    originalStreamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    originalStreamsRef.current = [];
    streamRef.current = null;
  }

  function clearTickInterval() {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
  }

  /**
   * Einziger Weg in den "error"-Zustand: setzt IMMER auch die geteilte
   * Alert-Live-Region — Plan-Vorgabe "Ein role=alert für Fehler/harten
   * Stopp" (nicht zwei getrennte Fehlertexte für Auge und Screenreader).
   */
  function setError(message: string) {
    setAlertMessage(message);
    setPhase({ kind: "error", message });
  }

  // Cleanup beim Unmount (Wechsel zurück auf "Hochladen", Block entfernt,
  // Seite verlassen): Tracks stoppen (sonst bleibt die Kameraleuchte an /
  // Chromes Freigabeleiste stehen) + Timer stoppen.
  useEffect(() => {
    return () => {
      clearTickInterval();
      stopAllTracks();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
    };
  }, []);

  // Objekt-URL für die Vorschau des aufgenommenen Blobs im "stopped"-Panel —
  // wird bei jedem Verlassen von "stopped" (oder Unmount) wieder freigegeben.
  // setStoppedUrl() wird bewusst per setTimeout(…, 0) verzögert statt direkt
  // im Effect-Body aufgerufen (react-hooks/set-state-in-effect erzwingt sonst
  // einen zusätzlichen Render direkt nach dem Phasenwechsel) — gleiches
  // Muster wie `SaveIndicator` in block-editor.tsx, Verhalten für Nutzer
  // unverändert (unter 1 ms Verzögerung, unterhalb der Wahrnehmungsschwelle).
  useEffect(() => {
    if (phase.kind !== "stopped") return;
    const url = URL.createObjectURL(phase.blob);
    const timer = setTimeout(() => setStoppedUrl(url), 0);
    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
  }, [phase]);

  // Fokus-Management (CLAUDE.md §3.4): ready→recording auf den Stop-Knopf,
  // recording→stopped auf die Überschrift des stopped-Panels. Ohne das landet
  // der Fokus auf einem entfernten Knoten und fällt auf <body> zurück.
  useEffect(() => {
    if (phase.kind === "recording") {
      stopButtonRef.current?.focus();
    } else if (phase.kind === "stopped") {
      stoppedHeadingRef.current?.focus();
    }
  }, [phase.kind]);

  // Upload-Fortschritt (nach "Verwenden") in Quartilen ansagen — kein
  // Sekundentakt-Flood (Plan-Vorgabe für die einzige Status-Live-Region).
  useEffect(() => {
    if (phase.kind !== "confirmed") return;
    if (uploadState.status === "uploading") {
      const message = getUploadQuartileMessage(prevUploadPercentRef.current, uploadState.percent);
      if (message) setStatusMessage(message);
      prevUploadPercentRef.current = uploadState.percent;
    } else if (uploadState.status === "done") {
      if (prevUploadPercentRef.current < 100) {
        setStatusMessage("Video vollständig hochgeladen.");
        prevUploadPercentRef.current = 100;
      }
    } else if (uploadState.status === "error") {
      setAlertMessage(uploadState.message);
    }
  }, [phase.kind, uploadState]);

  async function acquireStream(
    requestedMode: RecordingMode,
  ): Promise<{ stream: MediaStream; originals: MediaStream[] }> {
    if (requestedMode === "webcam") {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: WEBCAM_VIDEO_CONSTRAINTS,
        audio: MIC_AUDIO_CONSTRAINTS,
      });
      return { stream, originals: [stream] };
    }

    // B3: getDisplayMedia({ audio: true }) liefert System-/Tab-Ton, NIEMALS
    // das Mikrofon. Video- und Audio-Track kommen deshalb aus zwei
    // getrennten Aufrufen und werden zu EINEM MediaStream zusammengesetzt.
    //
    // BUGFIX (Josips Test, 17.07.2026): "das Bild flimmert, die Ansicht
    // vergrößert/verkleinert sich dauernd" — Ursache war die Aufnahme des
    // EIGENEN Tabs. Beim Selbst-Aufnehmen skaliert Chrome den aufgezeichneten
    // Tab auf die Aufnahmegröße; jede Layout-Änderung der Seite verändert das
    // aufgenommene Bild und dieses wiederum das Layout — eine Schleife, die
    // sich selbst antreibt und mit CSS nicht erreichbar ist (sie läuft über
    // Chromes Rendering, nicht über unser DOM).
    //
    // `selfBrowserSurface: "exclude"` nimmt den eigenen Tab aus dem
    // Auswahl-Dialog — die Selbst-Aufnahme wird damit strukturell unmöglich
    // statt nur unwahrscheinlich. `surfaceSwitching: "include"` erlaubt es,
    // während der Aufnahme die geteilte Fläche zu wechseln, ohne neu zu
    // starten. Beide Felder sind Chrome/Edge-Standard und werden von
    // Browsern, die sie nicht kennen, schlicht ignoriert.
    const videoOnly = await navigator.mediaDevices.getDisplayMedia({
      video: SCREEN_VIDEO_CONSTRAINTS,
      audio: false,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
    } as DisplayMediaStreamOptions);
    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: MIC_AUDIO_CONSTRAINTS });
    } catch (e) {
      videoOnly.getTracks().forEach((t) => t.stop());
      throw e;
    }
    const videoTrack = videoOnly.getVideoTracks()[0];
    const audioTrack = micStream.getAudioTracks()[0];
    if (!videoTrack || !audioTrack) {
      videoOnly.getTracks().forEach((t) => t.stop());
      micStream.getTracks().forEach((t) => t.stop());
      const error = new Error("Kein Ton für die Bildschirmaufnahme verfügbar.");
      error.name = NO_AUDIO_TRACK_ERROR_NAME;
      throw error;
    }
    return { stream: new MediaStream([videoTrack, audioTrack]), originals: [videoOnly, micStream] };
  }

  function handleStreamEndedExternally() {
    // Browser-eigene "Freigabe beenden"-Leiste oder Geräte-Entzug (B8).
    if (phaseRef.current.kind === "recording") {
      finalizeRecording();
    } else if (phaseRef.current.kind === "ready") {
      stopAllTracks();
      setPhase({ kind: "idle" });
    }
  }

  async function handleRequestAccess() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(INSECURE_CONTEXT_MESSAGE);
      return;
    }
    if (!pickSupportedMimeType()) {
      setError(NO_MIME_SUPPORT_MESSAGE);
      return;
    }

    setAlertMessage("");
    setStatusMessage("");
    setPhase({ kind: "requesting" });
    try {
      const { stream, originals } = await acquireStream(mode);
      streamRef.current = stream;
      originalStreamsRef.current = originals;
      stream.getVideoTracks()[0]?.addEventListener("ended", handleStreamEndedExternally);
      setPhase({ kind: "ready" });
    } catch (e) {
      stopAllTracks();
      setError(classifyMediaError(e).message);
    }
  }

  function handleModeChange(next: RecordingMode) {
    // Nur in "idle"/"ready" sinnvoll und sicher (siehe Render weiter unten,
    // das den Umschalter außerhalb dieser Phasen gar nicht erst anzeigt).
    // Zusätzliche Absicherung hier: ein Moduswechsel während "recording"
    // würde sonst nur `mode` umstellen, ohne den laufenden Stream zu
    // ändern — `buildRecordingFilename(mode)` in handleUseRecording würde
    // dann fälschlich den NEUEN Modus in den Dateinamen schreiben, obwohl
    // tatsächlich im ALTEN Modus aufgenommen wurde.
    if (phase.kind !== "idle" && phase.kind !== "ready") return;
    setMode(next);
    if (phase.kind === "ready") {
      // Bewusst kein automatisches Neu-Anfragen der Berechtigung: eine neue
      // getDisplayMedia/getUserMedia-Anfrage soll immer aus einer expliziten
      // Nutzeraktion (erneuter Klick auf den Aktivieren-Knopf) folgen, nicht
      // überraschend aus einem reinen Moduswechsel.
      stopAllTracks();
      setPhase({ kind: "idle" });
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      setError(NO_MIME_SUPPORT_MESSAGE);
      return;
    }
    mimeTypeRef.current = mimeType;
    chunksRef.current = [];
    setSizeBytes(0);

    const options: MediaRecorderOptionsExtended = {
      mimeType,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      // Chromium-only, andere Browser ignorieren es (kostet nichts) — siehe
      // Kommentar in recorder.ts: Voraussetzung für keyframe-genauen Schnitt
      // in Stufe 2, absichtlich nicht "für bessere Qualität" hochdrehen.
      videoKeyFrameIntervalDuration: KEYFRAME_INTERVAL_MS,
    };
    const recorder = new MediaRecorder(stream, options as MediaRecorderOptions);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
        setSizeBytes((prev) => prev + e.data.size);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current.split(";")[0] });
      const durationS = (performance.now() - startedAtRef.current) / 1000;
      stopAllTracks();
      clearTickInterval();
      setStatusMessage(getRecordingStoppedMessage(durationS));
      setPhase({ kind: "stopped", blob, durationS });
    };
    recorderRef.current = recorder;

    startedAtRef.current = performance.now();
    prevElapsedRef.current = 0;
    setElapsedS(0);
    setAlertMessage("");
    setStatusMessage(RECORDING_STARTED_MESSAGE);
    setPhase({ kind: "recording" });
    recorder.start(1000);

    tickIntervalRef.current = setInterval(() => {
      // B8: Hintergrund-Tabs drosseln Timer auf ~1/Min — echte verstrichene
      // Zeit aus performance.now() lesen statt Ticks zu zählen, sonst
      // verfehlt der 20-Minuten-Stopp sein Ziel um ein Vielfaches.
      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      setElapsedS(elapsed);
      const milestone = getMilestoneMessage(prevElapsedRef.current, elapsed);
      if (milestone) setStatusMessage(milestone);
      prevElapsedRef.current = elapsed;
      if (elapsed >= HARD_LIMIT_S) {
        setAlertMessage(HARD_STOP_ALERT_MESSAGE);
        finalizeRecording();
      }
    }, 1000);
  }

  function finalizeRecording() {
    clearTickInterval();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  function handleUseRecording() {
    if (phase.kind !== "stopped") return;
    const filename = buildRecordingFilename(mode);
    retainedRef.current = { blob: phase.blob, filename };
    prevUploadPercentRef.current = 0;
    setAlertMessage("");
    setPhase({ kind: "confirmed" });
    onConfirm(phase.blob, filename);
  }

  function handleDiscard() {
    retainedRef.current = null;
    setStatusMessage("");
    setAlertMessage("");
    setPhase({ kind: "idle" });
  }

  function handleRetryUpload() {
    const retained = retainedRef.current;
    if (!retained) return;
    prevUploadPercentRef.current = 0;
    setAlertMessage("");
    onConfirm(retained.blob, retained.filename);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Moduswahl nur anzeigen/erreichbar, solange ein Wechsel sicher ist
          (siehe handleModeChange) — sonst könnte ein Klick während der
          Aufnahme den Dateinamen der fertigen Aufnahme falsch beschriften. */}
      {(phase.kind === "idle" || phase.kind === "ready") && (
        <VideoRadioGroup
          label="Aufnahmemodus"
          value={mode}
          onChange={handleModeChange}
          options={MODE_OPTIONS}
        />
      )}

      {mode === "screen" && (phase.kind === "idle" || phase.kind === "ready" || phase.kind === "requesting") && (
        <p className="text-sm text-gray-500">
          Hinweis: Beim Teilen des ganzen Bildschirms können Inhalte Dritter sichtbar werden. Teile nach
          Möglichkeit nur ein einzelnes Fenster oder einen Tab.
        </p>
      )}

      {phase.kind === "idle" && (
        <button
          type="button"
          onClick={handleRequestAccess}
          className="self-start rounded-md border px-3 py-2 text-sm"
        >
          {mode === "screen" ? "Bildschirmfreigabe starten" : "Kamera aktivieren"}
        </button>
      )}

      {phase.kind === "requesting" && (
        <p className="text-sm text-gray-500">Zugriff wird angefragt …</p>
      )}

      {(phase.kind === "ready" || phase.kind === "recording") && (
        <div className="flex flex-col gap-2">
          {/* BUGFIX (Josips Test, 17.07.2026): "das Bild flimmert und die Ansicht
              vergrößert/verkleinert sich dauernd".
              Zwei zusammenwirkende Ursachen, beide hier behoben:

              1. LAYOUT-SCHAUKEL: Das <video> hatte nur `w-full max-w-md`, also
                 KEINE feste Höhe — die ergab sich aus dem Seitenverhältnis des
                 Streams. Bei einer Bildschirmaufnahme ist diese Seite Teil des
                 aufgenommenen Bildes: Höhe ändert sich -> Layout springt ->
                 aufgenommener Inhalt ändert sich -> Höhe ändert sich ... Eine
                 sich selbst antreibende Endlosschleife. Feste `aspect-[16/9]`-
                 Box + `object-contain` entkoppeln das Layout vollständig vom
                 Streaminhalt; die Box ist damit immer gleich groß, egal welche
                 Auflösung geteilt wird.

              2. ENDLOS-SPIEGEL: Eine Live-Vorschau des eigenen Bildschirms
                 filmt sich selbst (Bild-im-Bild-im-Bild ...) und flackert.
                 Deshalb im Bildschirm-Modus bewusst KEINE Selbst-Vorschau —
                 man sieht seinen Bildschirm ja bereits. Stattdessen eine ruhige
                 Statusfläche. Nur die Webcam zeigt eine echte Vorschau (dort
                 gibt es keine Rückkopplung, und man muss sich sehen können). */}
          <div className="w-full max-w-md overflow-hidden rounded-md border bg-black">
            {mode === "webcam" ? (
              // Muted: sonst Mikrofon-Rückkopplung durch die Live-Vorschau (Lautsprecher → Mikrofon).
              <video
                ref={(el) => {
                  liveVideoRef.current = el;
                  if (el && streamRef.current) el.srcObject = streamRef.current;
                }}
                muted
                playsInline
                autoPlay
                className="aspect-[16/9] w-full bg-black object-contain"
              />
            ) : (
              <div
                className="flex aspect-[16/9] w-full items-center justify-center bg-black px-4 text-center"
                aria-hidden="true"
              >
                <span className="text-sm text-gray-300">
                  {phase.kind === "recording"
                    ? "Dein Bildschirm wird aufgezeichnet."
                    : "Bildschirm freigegeben — bereit zur Aufnahme."}
                  <br />
                  <span className="text-xs text-gray-500">
                    Keine Vorschau: Sie würde sich selbst abfilmen.
                  </span>
                </span>
              </div>
            )}
          </div>
          {phase.kind === "ready" && (
            <button
              type="button"
              onClick={startRecording}
              className="self-start rounded-md border px-3 py-2 text-sm"
            >
              Aufnahme starten
            </button>
          )}
          {phase.kind === "recording" && (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-red-600">
                <span
                  aria-hidden="true"
                  className="motion-safe:animate-pulse inline-block h-2.5 w-2.5 rounded-full bg-red-600"
                />
                Aufnahme läuft
              </span>
              {/* Sichtbarer Timer ist aria-hidden — die Zeit wird stattdessen über
                  Meilenstein-Ansagen im Status-Bereich unten kommuniziert. */}
              {/* Feste Mindestbreiten + tabular-nums: Timer und Dateigröße
                  ändern sich im Sekundentakt. Ohne das wandert die Textbreite
                  ("0,9 MB" -> "10,2 MB") und verschiebt die ganze Zeile — bei
                  einer Vollbild-Freigabe zappelt das sichtbar im Video mit. */}
              <span
                aria-hidden="true"
                className="min-w-[3.5rem] text-sm tabular-nums text-gray-600"
              >
                {formatDuration(elapsedS)}
              </span>
              <span
                aria-hidden="true"
                className="min-w-[5rem] text-sm tabular-nums text-gray-400"
              >
                {formatFileSize(sizeBytes)}
              </span>
              <button
                ref={stopButtonRef}
                type="button"
                aria-label={`Aufnahme beenden (läuft seit ${Math.floor(elapsedS / 60)} Minuten)`}
                onClick={finalizeRecording}
                className="rounded-md border px-3 py-2 text-sm"
              >
                Aufnahme beenden
              </button>
            </div>
          )}
        </div>
      )}

      {phase.kind === "stopped" && (
        <div className="flex flex-col gap-2">
          <h3 ref={stoppedHeadingRef} tabIndex={-1} className="text-base font-semibold outline-none">
            Aufnahme fertig
          </h3>
          {/* Gleiche feste Box wie die Live-Vorschau: sonst springt das Layout,
              sobald die Aufnahme geladen ist und ihr Seitenverhältnis bekannt
              wird (hier ohne Rückkopplung, aber unruhig). */}
          <div className="w-full max-w-md overflow-hidden rounded-md border bg-black">
            <video
              ref={stoppedVideoRef}
              src={stoppedUrl ?? undefined}
              playsInline
              className="aspect-[16/9] w-full bg-black object-contain"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => stoppedVideoRef.current?.play()}
              className="rounded-md border px-3 py-1 text-sm"
            >
              Abspielen
            </button>
            <button
              type="button"
              onClick={() => stoppedVideoRef.current?.pause()}
              className="rounded-md border px-3 py-1 text-sm"
            >
              Pause
            </button>
            {/* Kein Scrubber: das WebM hat noch keine Duration (Stufe-2-Thema,
                Blocker B7) — stattdessen unsere selbst gemessene Dauer. */}
            <span className="text-sm text-gray-500">Dauer: {formatDuration(phase.durationS)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleUseRecording}
              className="rounded-md border px-3 py-2 text-sm font-medium"
            >
              Verwenden
            </button>
            <button type="button" onClick={handleDiscard} className="rounded-md border px-3 py-2 text-sm">
              Neu aufnehmen
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              className="rounded-md border px-3 py-2 text-sm text-red-600"
            >
              Verwerfen
            </button>
          </div>
        </div>
      )}

      {phase.kind === "confirmed" && (
        <div className="flex flex-col gap-2">
          <p aria-hidden="true" className="text-sm text-gray-600">
            {uploadState.status === "creating" && "Video wird angelegt …"}
            {uploadState.status === "uploading" && `Hochladen … ${uploadState.percent}%`}
            {uploadState.status === "done" && "Upload abgeschlossen."}
            {uploadState.status === "error" && "Fehler beim Hochladen."}
            {uploadState.status === "idle" && "Wird vorbereitet …"}
          </p>
          {uploadState.status === "error" && (
            <div className="flex gap-2">
              <button type="button" onClick={handleRetryUpload} className="rounded-md border px-3 py-2 text-sm">
                Erneut versuchen
              </button>
              <button
                type="button"
                onClick={handleDiscard}
                className="rounded-md border px-3 py-2 text-sm text-red-600"
              >
                Verwerfen
              </button>
            </div>
          )}
        </div>
      )}

      {phase.kind === "error" && (
        <button
          type="button"
          onClick={() => {
            setAlertMessage("");
            setPhase({ kind: "idle" });
          }}
          className="self-start rounded-md border px-3 py-2 text-sm"
        >
          Erneut versuchen
        </button>
      )}

      {/*
       * Genau EIN role="status" für Meilenstein-Ansagen (kein Sekundentakt)
       * und EIN role="alert" für Fehler/harten Stopp — Plan-Vorgabe. Beide
       * sichtbar (nicht nur für Screenreader): der Auftraggeber ist
       * sehbehindert, nicht nur auf einen Screenreader angewiesen — gut
       * sichtbarer Text ist hier genauso wichtig wie die ARIA-Semantik.
       */}
      {statusMessage && (
        <p role="status" aria-live="polite" className="text-sm text-gray-700">
          {statusMessage}
        </p>
      )}
      {alertMessage && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {alertMessage}
        </p>
      )}
    </div>
  );
}
