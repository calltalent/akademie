"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  Check,
  Mic,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Trash2,
  Video as VideoIcon,
} from "lucide-react";
import type { BunnyUploadState } from "@/lib/bunny/use-bunny-upload";
import { VideoRadioGroup } from "@/components/editor/video-radio-group";
import { TRIM_SIZE_LIMIT_BYTES } from "@/lib/video/segments";
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
 *
 * Design-Update (AdminVideoAufnahme.dc.html) + Mikrofon-Pegelanzeige (neu,
 * Plan-Risiko R2): ohne Bild-Vorschau bei der Bildschirmaufnahme gibt es
 * sonst keine Rückmeldung, ob überhaupt Ton ankommt — eine stumme Aufnahme
 * kostet trotzdem 0,10 $/Min für ein leeres Transkript. AudioContext +
 * AnalyserNode laufen auf dem Mikrofon-Track des laufenden Streams (bei
 * beiden Modi der tatsächliche Mikrofon-Track, siehe `acquireStream" oben —
 * bei der Bildschirmaufnahme wird er bewusst separat per getUserMedia
 * geholt, s. Kommentar dort). Nur aktiv während "recording" (deckt sich mit
 * der Design-Platzierung); Balkenreihe ist `aria-hidden` (keine Dauerflut für
 * Screenreader), die "Kein Ton erkannt"-Warnung ist `role="status"` und wird
 * nur bei Zustandswechsel ins DOM gehängt (gleiches Muster wie die
 * bestehenden `statusMessage`/`alertMessage`-Regionen unten). AudioContext
 * wird im Cleanup immer geschlossen, sonst bleibt sie offen und hält das
 * Mikrofon; ist `AudioContext` nicht verfügbar, wird die Anzeige einfach
 * weggelassen (nie ein Absturz).
 *
 * Stufe 2 „Schnitt" (neu): der „Zuschneiden"-Knopf im "stopped"-Panel öffnet
 * `VideoTrimmer` (Phase "trimming"). `next/dynamic({ssr:false})` sorgt dafür,
 * dass `video-trimmer.tsx` — und mit ihm der spätere Import von
 * `ffmpeg-client.ts`/`@ffmpeg/ffmpeg` — nicht schon im Admin-Erst-Bundle
 * landet, sondern erst beim tatsächlichen Öffnen nachgeladen wird. Der
 * Trimmer liefert sein (ggf. geschnittenes) Blob über sein eigenes
 * `onConfirm` zurück; das läuft hier über denselben `confirmBlob()`-Pfad wie
 * der normale „Verwenden"-Knopf — also GENAUSO wenig ein Aufruf von
 * `useBunnyUpload` innerhalb dieser Datei wie vorher (Kostensicherheit
 * unangetastet, `video-trimmer.tsx` importiert den Upload-Hook ebenfalls nie).
 */
const VideoTrimmer = dynamic(
  () => import("@/components/editor/video-trimmer").then((m) => m.VideoTrimmer),
  { ssr: false },
);

type RecordingMode = "screen" | "webcam";

type Phase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "ready" }
  | { kind: "recording" }
  | { kind: "stopped"; blob: Blob; durationS: number }
  // Zwischen "Verwenden" und "confirmed" — repariert das rohe MediaRecorder-
  // Webm (Blocker B7: keine Duration/Cues im Header) per remuxFix(), BEVOR
  // Bunny das Blob sieht. Ohne diesen Schritt bleibt die Aufnahme bei Bunny
  // teils dauerhaft in "Processing" hängen (Josips Meldung, 23.07.2026) — der
  // Trimmer machte das schon für den Zuschnitt-Weg, der direkte "Verwenden"-
  // Weg umging remuxFix() bisher komplett.
  | { kind: "preparing"; blob: Blob; durationS: number }
  | { kind: "trimming"; blob: Blob; durationS: number }
  // "Verwenden" wurde geklickt — ab hier bestimmt `uploadState` (Prop) die Anzeige.
  | { kind: "confirmed" }
  | { kind: "error"; message: string };

const MODE_OPTIONS: { value: RecordingMode; label: string; icon: React.ReactNode }[] = [
  { value: "screen", label: "Bildschirm", icon: <Monitor size={16} aria-hidden="true" /> },
  { value: "webcam", label: "Webcam", icon: <VideoIcon size={16} aria-hidden="true" /> },
];

const MIC_BAR_COUNT = 24;
const MIC_SILENCE_HOLD_MS = 2000;
/** Byte-Skala (0–255) von AnalyserNode.getByteFrequencyData: unterhalb gilt als Stille. */
const MIC_SILENCE_THRESHOLD = 8;

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
  const [micLevels, setMicLevels] = useState<number[]>(() => Array(MIC_BAR_COUNT).fill(4));
  const [micSilent, setMicSilent] = useState(false);
  const [micMeterAvailable, setMicMeterAvailable] = useState(true);

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
  // Schützt den setPhase()-Aufruf in prepareAndConfirm() nach einem await
  // (ffmpeg-Import + remuxFix) davor, nach einem Unmount (Block entfernt,
  // Seite verlassen während "preparing") noch auf einer entfernten
  // Komponente zu feuern.
  const unmountedRef = useRef(false);
  // Für einen "Erneut versuchen"-Knopf nach einem Upload-Fehler — das Blob
  // bleibt erhalten, damit eine 20-Minuten-Aufnahme nicht bei einem
  // Netzwerkfehler verloren geht.
  const retainedRef = useRef<{ blob: Blob; filename: string } | null>(null);
  // Mikrofon-Pegelanzeige (Teil C): eigener AudioContext/AnalyserNode, unabhängig
  // vom MediaRecorder — misst nur, sendet nichts.
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      unmountedRef.current = true;
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

  // Mikrofon-Pegelanzeige (Teil C, Plan-Risiko R2): eigener AudioContext auf
  // dem Mikrofon-Track des laufenden Streams, nur während "recording" (deckt
  // sich mit der Design-Platzierung im "Aufnahme läuft"-Panel). Schließt den
  // AudioContext bei jedem Verlassen von "recording" (Phasenwechsel oder
  // Unmount) — sonst bleibt sie offen und hält das Mikrofon zusätzlich zum
  // MediaRecorder-Stream fest.
  useEffect(() => {
    if (phase.kind !== "recording") return;
    const stream = streamRef.current;
    const audioTrack = stream?.getAudioTracks()[0];
    if (!audioTrack) return;

    const AudioContextCtor: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!AudioContextCtor) {
      // setState per setTimeout(…, 0) statt synchron im Effect-Body — gleiches
      // Muster wie SaveIndicator (block-editor.tsx)/stoppedUrl oben:
      // react-hooks/set-state-in-effect erzwingt sonst einen zusätzlichen
      // Render direkt nach diesem, Verhalten für Nutzer unverändert.
      const unavailableTimer = setTimeout(() => setMicMeterAvailable(false), 0);
      return () => clearTimeout(unavailableTimer);
    }

    let cancelled = false;
    let silentSince = performance.now();
    let unavailableTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      const audioContext = new AudioContextCtor();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.6;
      const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const step = Math.max(1, Math.floor(dataArray.length / MIC_BAR_COUNT));

      levelIntervalRef.current = setInterval(() => {
        if (cancelled) return;
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;

        setMicLevels(
          Array.from({ length: MIC_BAR_COUNT }, (_, i) => {
            const v = dataArray[i * step] ?? 0;
            return Math.max(4, Math.min(100, Math.round((v / 255) * 130)));
          }),
        );

        const now = performance.now();
        if (avg > MIC_SILENCE_THRESHOLD) {
          silentSince = now;
          setMicSilent(false);
        } else if (now - silentSince > MIC_SILENCE_HOLD_MS) {
          setMicSilent(true);
        }
      }, 150);
    } catch {
      unavailableTimer = setTimeout(() => setMicMeterAvailable(false), 0);
    }

    return () => {
      cancelled = true;
      if (unavailableTimer) clearTimeout(unavailableTimer);
      if (levelIntervalRef.current) {
        clearInterval(levelIntervalRef.current);
        levelIntervalRef.current = null;
      }
      analyserRef.current = null;
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      setMicLevels(Array(MIC_BAR_COUNT).fill(4));
      setMicSilent(false);
    };
  }, [phase.kind]);

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

  // Gemeinsamer Endpunkt für "Verwenden" UND den Trimmer-Rückweg (Stufe 2) —
  // beide sollen sich IDENTISCH verhalten: Dateiname bauen, retainedRef für
  // "Erneut versuchen" setzen, in "confirmed" wechseln, `onConfirm` (Prop
  // nach oben zu video-source-switch.tsx) aufrufen. Kein Aufruf von
  // `useBunnyUpload` hier — der Hook lebt ausschließlich in
  // video-source-switch.tsx (Kostensicherheit, siehe Dateikopf).
  function confirmBlob(blob: Blob) {
    const filename = buildRecordingFilename(mode);
    retainedRef.current = { blob, filename };
    prevUploadPercentRef.current = 0;
    setAlertMessage("");
    setPhase({ kind: "confirmed" });
    onConfirm(blob, filename);
  }

  // Repariert das rohe MediaRecorder-Webm per remuxFix() (Blocker B7 — keine
  // Duration/Cues im Header), BEVOR es an confirmBlob()/Bunny geht. Läuft
  // NIE ins Leere (Plan-Vorgabe "nie eine Sackgasse"): schlägt die Reparatur
  // fehl (z. B. ffmpeg.wasm lädt nicht), geht das UNVERÄNDERTE Original-Blob
  // hoch statt den Upload zu blockieren — das war exakt das bisherige
  // Verhalten, nur ohne den Fix-Versuch davor. ffmpeg-client wird bewusst
  // per Laufzeit-Import nachgeladen (siehe Dateikopf-Kommentar dort zum
  // Admin-Erst-Bundle) statt als Modul-Top-Level-Import.
  async function prepareAndConfirm(blob: Blob, durationS: number) {
    setAlertMessage("");
    setStatusMessage("Aufnahme wird für den Upload vorbereitet …");
    setPhase({ kind: "preparing", blob, durationS });

    let fixedBlob = blob;
    try {
      const { remuxFix } = await import("@/lib/video/ffmpeg-client");
      fixedBlob = await remuxFix(blob);
    } catch (e) {
      console.error("[video-recorder] Reparatur vor Upload fehlgeschlagen, nutze Rohaufnahme.", e);
    }

    if (unmountedRef.current) return;
    confirmBlob(fixedBlob);
  }

  function handleUseRecording() {
    if (phase.kind !== "stopped") return;
    void prepareAndConfirm(phase.blob, phase.durationS);
  }

  function handleStartTrim() {
    if (phase.kind !== "stopped") return;
    setAlertMessage("");
    setStatusMessage("");
    setPhase({ kind: "trimming", blob: phase.blob, durationS: phase.durationS });
  }

  // Vom Trimmer aufgerufen ("Zuschnitt übernehmen"/"Ohne Zuschnitt
  // hochladen") — läuft GENAUSO wie "Verwenden" in einen Upload, nur mit dem
  // (ggf. geschnittenen) Blob statt dem Original.
  function handleTrimConfirm(blob: Blob) {
    confirmBlob(blob);
  }

  function handleTrimCancel() {
    if (phase.kind !== "trimming") return;
    setPhase({ kind: "stopped", blob: phase.blob, durationS: phase.durationS });
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
    <div className="flex flex-col gap-4">
      {/* Moduswahl nur anzeigen/erreichbar, solange ein Wechsel sicher ist
          (siehe handleModeChange) — sonst könnte ein Klick während der
          Aufnahme den Dateinamen der fertigen Aufnahme falsch beschriften. */}
      {(phase.kind === "idle" || phase.kind === "ready") && (
        <VideoRadioGroup label="Aufnahmemodus" value={mode} onChange={handleModeChange} options={MODE_OPTIONS} />
      )}

      {mode === "screen" && (phase.kind === "idle" || phase.kind === "ready" || phase.kind === "requesting") && (
        <p className="text-sm" style={{ color: "#66679B" }}>
          Hinweis: Beim Teilen des ganzen Bildschirms können Inhalte Dritter sichtbar werden. Teile nach
          Möglichkeit nur ein einzelnes Fenster oder einen Tab.
        </p>
      )}

      {phase.kind === "idle" && (
        <div className="flex flex-wrap items-center gap-3.5">
          <button
            type="button"
            onClick={handleRequestAccess}
            className="inline-flex items-center gap-2.5 self-start rounded-xl px-[22px] py-3.5 text-base font-bold text-white"
            style={{ background: "#5663AE" }}
          >
            <span className="h-3.5 w-3.5 rounded-full bg-white" aria-hidden="true" />
            {mode === "screen" ? "Bildschirmfreigabe starten" : "Kamera aktivieren"}
          </button>
          <p className="flex items-center gap-2.5 text-sm font-semibold" style={{ color: "#3E3F66" }}>
            <Mic size={18} aria-hidden="true" style={{ color: "#5663AE" }} />
            Mikrofon-Zugriff ist erforderlich — dein Browser fragt beim Start nach der Erlaubnis.
          </p>
        </div>
      )}

      {phase.kind === "requesting" && (
        <p className="text-sm" style={{ color: "#66679B" }}>
          Zugriff wird angefragt …
        </p>
      )}

      {(phase.kind === "ready" || phase.kind === "recording") && (
        <div className="flex flex-col gap-4">
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
                 Statusfläche (Design: dunkle Navy-Fläche mit Streifenmuster,
                 AdminVideoAufnahme.dc.html). Nur die Webcam zeigt eine echte
                 Vorschau (dort gibt es keine Rückkopplung, und man muss sich
                 sehen können). */}
          <div className="w-full max-w-md overflow-hidden rounded-2xl border" style={{ borderColor: "#E7E8F2" }}>
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
                className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-3.5 px-6 text-center"
                style={{
                  background: "#3E3F66",
                  backgroundImage:
                    "repeating-linear-gradient(135deg, rgba(86,99,174,.45) 0 16px, rgba(62,63,102,.45) 16px 32px)",
                }}
                aria-hidden="true"
              >
                <span
                  className="flex h-[52px] w-[52px] items-center justify-center rounded-xl"
                  style={{ background: "rgba(255,255,255,.14)" }}
                >
                  <Monitor size={24} aria-hidden="true" color="#fff" />
                </span>
                <span className="text-lg font-extrabold text-white">
                  {phase.kind === "recording"
                    ? "Dein Bildschirm wird aufgezeichnet"
                    : "Bildschirm freigegeben — bereit zur Aufnahme"}
                </span>
                <span className="max-w-[380px] text-sm font-semibold" style={{ color: "#C9CBE6" }}>
                  Es wird bewusst keine Vorschau angezeigt — sie würde sich selbst abfilmen.
                  {phase.kind === "recording" ? " Die Aufnahme läuft trotzdem." : ""}
                </span>
              </div>
            )}
          </div>
          {phase.kind === "ready" && (
            <button
              type="button"
              onClick={startRecording}
              className="inline-flex items-center gap-2.5 self-start rounded-xl px-[22px] py-3.5 text-base font-bold text-white"
              style={{ background: "#5663AE" }}
            >
              <span className="h-3.5 w-3.5 rounded-full bg-white" aria-hidden="true" />
              Aufnahme starten
            </button>
          )}
          {phase.kind === "recording" && (
            <div className="flex flex-wrap items-center gap-4">
              <span
                className="inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-sm font-extrabold"
                style={{ background: "#FBEAEA", color: "#B14A4A" }}
              >
                <span
                  aria-hidden="true"
                  className="motion-safe:animate-pulse inline-block h-3 w-3 rounded-full"
                  style={{ background: "#B14A4A" }}
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
                className="min-w-[3.5rem] text-lg font-extrabold tabular-nums"
                style={{ color: "#1A1A2E" }}
              >
                {formatDuration(elapsedS)}
              </span>
              <span aria-hidden="true" className="min-w-[5rem] text-sm font-semibold tabular-nums" style={{ color: "#3E3F66" }}>
                {formatFileSize(sizeBytes)}
              </span>
              <div className="flex-1" />
              <button
                ref={stopButtonRef}
                type="button"
                aria-label={`Aufnahme beenden (läuft seit ${Math.floor(elapsedS / 60)} Minuten)`}
                onClick={finalizeRecording}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[15px] font-bold text-white"
                style={{ background: "#5663AE" }}
              >
                <span className="h-3 w-3 rounded-sm bg-white" aria-hidden="true" />
                Aufnahme beenden
              </button>
            </div>
          )}

          {phase.kind === "recording" && micMeterAvailable && (
            <div className="rounded-xl border p-3.5" style={{ borderColor: "#EEF0F7" }}>
              <div className="mb-3 flex flex-wrap items-center gap-2.5">
                <Mic size={17} aria-hidden="true" style={{ color: micSilent ? "#B14A4A" : "#1F8A5B" }} />
                <span className="text-sm font-bold" style={{ color: "#1A1A2E" }}>
                  Mikrofon-Pegel
                </span>
                <span className="text-[13px] font-bold" style={{ color: micSilent ? "#B14A4A" : "#1F8A5B" }}>
                  {micSilent ? "Kein Ton erkannt" : "Ton wird erkannt"}
                </span>
              </div>
              <div aria-hidden="true" className="flex h-[34px] items-end gap-1">
                {micLevels.map((h, i) => (
                  <span
                    key={i}
                    className="min-h-[4px] flex-1 rounded-sm"
                    style={{ height: `${h}%`, background: h > 88 ? "#B14A4A" : h > 60 ? "#5663AE" : "#8BE0B7" }}
                  />
                ))}
              </div>
              {micSilent && (
                <p
                  role="status"
                  className="mt-3 flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-bold"
                  style={{ borderColor: "#E9CFCF", background: "#FBEAEA", color: "#B14A4A" }}
                >
                  <AlertTriangle size={17} aria-hidden="true" />
                  Kein Ton erkannt — prüfe, ob das richtige Mikrofon aktiv und nicht stummgeschaltet ist.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {phase.kind === "stopped" && (
        <div className="flex flex-col gap-3">
          <h3
            ref={stoppedHeadingRef}
            tabIndex={-1}
            className="text-base font-extrabold outline-none"
            style={{ color: "#1A1A2E" }}
          >
            Aufnahme fertig
          </h3>
          {/* Gleiche feste Box wie die Live-Vorschau: sonst springt das Layout,
              sobald die Aufnahme geladen ist und ihr Seitenverhältnis bekannt
              wird (hier ohne Rückkopplung, aber unruhig). */}
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border bg-black" style={{ borderColor: "#E7E8F2" }}>
            <video
              ref={stoppedVideoRef}
              src={stoppedUrl ?? undefined}
              playsInline
              className="aspect-[16/9] w-full bg-black object-contain"
            />
            <span
              aria-hidden="true"
              className="absolute right-3 bottom-3 rounded-lg px-2.5 py-1 text-[13px] font-bold text-white tabular-nums"
              style={{ background: "rgba(26,26,46,.82)" }}
            >
              Dauer {formatDuration(phase.durationS)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => stoppedVideoRef.current?.play()}
              className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-4 py-2 text-sm font-bold"
              style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
            >
              <Play size={14} aria-hidden="true" />
              Abspielen
            </button>
            <button
              type="button"
              onClick={() => stoppedVideoRef.current?.pause()}
              className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-4 py-2 text-sm font-bold"
              style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
            >
              <Pause size={14} aria-hidden="true" />
              Pause
            </button>
            {/* Kein Scrubber: das WebM hat noch keine Duration (Stufe-2-Thema,
                Blocker B7) — stattdessen unsere selbst gemessene Dauer. */}
            <span className="text-sm font-semibold" style={{ color: "#66679B" }}>
              Dauer: {formatDuration(phase.durationS)}
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleUseRecording}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[15px] font-bold text-white"
              style={{ background: "#5663AE" }}
            >
              <Check size={16} aria-hidden="true" />
              Verwenden
            </button>
            {/* Stufe 2 (Schnitt): Größen-Gate (Plan-Risiko R6) — über dem
                Limit bleibt der Knopf deaktiviert MIT sichtbarer Begründung
                (nicht nur `title`, siehe Text unten), statt den Trimmer zu
                öffnen und dort erst zu scheitern. Innerhalb des Trimmers
                selbst gilt dieselbe Grenze defensiv noch einmal (siehe
                video-trimmer.tsx) — "niemals eine Sackgasse". */}
            <button
              type="button"
              onClick={handleStartTrim}
              disabled={phase.blob.size > TRIM_SIZE_LIMIT_BYTES}
              title={
                phase.blob.size > TRIM_SIZE_LIMIT_BYTES
                  ? `Aufnahme zu groß zum Zuschneiden im Browser (${formatFileSize(phase.blob.size)}).`
                  : undefined
              }
              className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold disabled:opacity-50"
              style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
            >
              <Scissors size={16} aria-hidden="true" />
              Zuschneiden
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold"
              style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
            >
              <RotateCcw size={16} aria-hidden="true" />
              Neu aufnehmen
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleDiscard}
              className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold"
              style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
            >
              <Trash2 size={16} aria-hidden="true" />
              Verwerfen
            </button>
          </div>
          {phase.blob.size > TRIM_SIZE_LIMIT_BYTES && (
            <p className="text-sm font-semibold" style={{ color: "#B14A4A" }}>
              Aufnahme zu groß zum Zuschneiden im Browser ({formatFileSize(phase.blob.size)}). Du kannst sie ohne
              Zuschnitt hochladen.
            </p>
          )}
        </div>
      )}

      {phase.kind === "preparing" && (
        <p className="text-sm" style={{ color: "#66679B" }}>
          Aufnahme wird für den Upload vorbereitet …
        </p>
      )}

      {phase.kind === "trimming" && (
        <VideoTrimmer
          blob={phase.blob}
          durationS={phase.durationS}
          onConfirm={handleTrimConfirm}
          onCancel={handleTrimCancel}
        />
      )}

      {phase.kind === "confirmed" && (
        <div className="flex flex-col gap-2.5">
          <p aria-hidden="true" className="text-sm font-semibold" style={{ color: "#3E3F66" }}>
            {uploadState.status === "creating" && "Video wird angelegt …"}
            {uploadState.status === "uploading" && `Hochladen … ${uploadState.percent}%`}
            {uploadState.status === "done" && "Upload abgeschlossen."}
            {uploadState.status === "error" && "Fehler beim Hochladen."}
            {uploadState.status === "idle" && "Wird vorbereitet …"}
          </p>
          {uploadState.status === "error" && (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleRetryUpload}
                className="inline-flex items-center rounded-[10px] border bg-white px-4 py-2.5 text-sm font-bold"
                style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
              >
                Erneut versuchen
              </button>
              <button
                type="button"
                onClick={handleDiscard}
                className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-4 py-2.5 text-sm font-bold"
                style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
              >
                <Trash2 size={14} aria-hidden="true" />
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
          className="inline-flex items-center self-start rounded-[10px] border bg-white px-4 py-2.5 text-sm font-bold"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
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
        <p
          role="status"
          aria-live="polite"
          className="rounded-xl border px-4 py-3 text-sm font-semibold"
          style={{ borderColor: "#E7E8F2", background: "#F4F5FA", color: "#3E3F66" }}
        >
          {statusMessage}
        </p>
      )}
      {alertMessage && (
        <p
          role="alert"
          className="rounded-xl border px-4 py-3 text-sm font-bold"
          style={{ borderColor: "#E9CFCF", background: "#FBEAEA", color: "#B14A4A" }}
        >
          {alertMessage}
        </p>
      )}
    </div>
  );
}
