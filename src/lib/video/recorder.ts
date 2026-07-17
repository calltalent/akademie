/**
 * Reine, testbare Helfer für die Browser-Videoaufnahme (Kurs-Editor, Stufe 1
 * „Aufnahme" — Plan `calm-watching-dewdrop.md`). Kein DOM-/MediaRecorder-
 * Zugriff hier (Muster wie `src/lib/video/vtt.ts` + `vtt.test.ts`): alle
 * Funktionen nehmen ihre Eingaben als Parameter und sind ohne echten Browser
 * unter Vitest/jsdom testbar. Die eigentliche MediaRecorder-/getUserMedia-
 * Logik lebt in `src/components/editor/video-recorder.tsx`.
 */

// ---------------------------------------------------------------------------
// Limits (Blocker B8, Josips Entscheidung: 20 Min hart, Warnung ab 15 Min)
// ---------------------------------------------------------------------------

/** 15 Minuten — Warnhinweis, Aufnahme läuft weiter. */
export const WARNING_THRESHOLD_S = 15 * 60;
/** 20 Minuten — harter Stopp, Aufnahme wird BEHALTEN (nicht verworfen). */
export const HARD_LIMIT_S = 20 * 60;
/** Eine Minute vor dem harten Stopp — letzte Ansage vor dem Limit. */
export const ONE_MINUTE_LEFT_S = HARD_LIMIT_S - 60;
/** Generisches Meilenstein-Intervall für die Status-Ansage ("alle 5 Min"). */
export const MILESTONE_INTERVAL_S = 5 * 60;

// ---------------------------------------------------------------------------
// Encoding-Grenzen (Blocker B6, Josips Entscheidung)
// ---------------------------------------------------------------------------

/**
 * ACHTUNG: Diese Deckel sind keine Qualitäts-Sparmaßnahme, sondern eine
 * bewusste VORAUSSETZUNG für Stufe 2 (Browser-Schnitt mit ffmpeg.wasm läuft
 * single-threaded im Hauptspeicher — siehe Plan, Risiko R6/B6). Nicht "für
 * bessere Qualität" hochdrehen, ohne Stufe 2 neu zu bewerten.
 */
export const VIDEO_BITS_PER_SECOND = 1_500_000;
export const AUDIO_BITS_PER_SECOND = 96_000;
/** Chromium-only (`videoKeyFrameIntervalDuration`); in anderen Browsern ignoriert, kostet nichts. */
export const KEYFRAME_INTERVAL_MS = 2000;

export const SCREEN_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  frameRate: { ideal: 15, max: 30 },
};
export const WEBCAM_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};
export const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
};

/**
 * `videoKeyFrameIntervalDuration` ist eine nonstandard Chromium-Erweiterung
 * von `MediaRecorderOptions` (fehlt in TypeScript-DOM-Typen) — eigener Typ
 * statt `any`, damit `strict` sauber bleibt.
 */
export type MediaRecorderOptionsExtended = MediaRecorderOptions & {
  videoKeyFrameIntervalDuration?: number;
};

// ---------------------------------------------------------------------------
// MIME-Probe
// ---------------------------------------------------------------------------

/** Reihenfolge bewusst so gewählt: bestes Verhältnis Kompression/Kompatibilität zuerst. */
const CANDIDATE_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

export const NO_MIME_SUPPORT_MESSAGE =
  "Dein Browser unterstützt die Videoaufnahme leider nicht. Bitte verwende eine aktuelle Version von Chrome, Edge oder Firefox.";

export const INSECURE_CONTEXT_MESSAGE =
  "Die Aufnahme benötigt eine sichere Verbindung. Bitte diese Seite über HTTPS (oder lokal über localhost) aufrufen.";

/**
 * Erste unterstützte MIME-Kombination aus `CANDIDATE_MIME_TYPES`, oder
 * `null`, wenn keine passt. `isSupported` ist injizierbar (Standard: echtes
 * `MediaRecorder.isTypeSupported`), damit die Funktion ohne Browser testbar
 * bleibt — `typeof MediaRecorder` ist in jsdom sicher (liefert `"undefined"`,
 * wirft keinen ReferenceError).
 */
export function pickSupportedMimeType(
  isSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
): string | null {
  return CANDIDATE_MIME_TYPES.find((type) => isSupported(type)) ?? null;
}

// ---------------------------------------------------------------------------
// Formatierung
// ---------------------------------------------------------------------------

/** `mm:ss` — auch für Werte ≥ 60 Minuten (dann z. B. "75:03"), negative Werte werden auf 0 geklemmt. */
export function formatDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Menschenlesbare Dateigröße für die Live-Anzeige während der Aufnahme. */
export function formatFileSize(bytes: number): string {
  const safe = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (safe < 1024) return `${Math.round(safe)} B`;
  const units = ["KB", "MB", "GB"];
  let value = safe / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Dateiname für Aufnahmen — wird der Bunny-Video-Titel (im Dashboard lesbar
 * halten): `aufnahme-${mode}-${zeitstempel}.webm`.
 */
export function buildRecordingFilename(mode: "screen" | "webcam", now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `aufnahme-${mode}-${timestamp}.webm`;
}

// ---------------------------------------------------------------------------
// Barrierefreiheit: Meilenstein-Ansagen (EIN role="status", kein Sekundentakt)
// ---------------------------------------------------------------------------

function crossedThreshold(prevS: number, currentS: number, mark: number): boolean {
  return prevS < mark && currentS >= mark;
}

/**
 * Liefert höchstens EINE Meilenstein-Meldung, wenn der Timer von `prevElapsedS`
 * auf `elapsedS` weiterspringt — sonst `null`. Reihenfolge ist wichtig: die
 * 1-Minute- und 15-Minuten-Schwellen sind spezifischer als das generische
 * 5-Minuten-Intervall und werden zuerst geprüft (900s ist zufällig auch ein
 * Vielfaches von 300s, bekommt aber bewusst den spezifischeren Text).
 */
export function getMilestoneMessage(prevElapsedS: number, elapsedS: number): string | null {
  if (crossedThreshold(prevElapsedS, elapsedS, ONE_MINUTE_LEFT_S)) {
    return "Noch 1 Minute bis zum Aufnahmelimit.";
  }
  if (crossedThreshold(prevElapsedS, elapsedS, WARNING_THRESHOLD_S)) {
    return "15 Minuten aufgenommen — noch 5 Minuten bis zum Limit.";
  }
  for (let mark = MILESTONE_INTERVAL_S; mark < WARNING_THRESHOLD_S; mark += MILESTONE_INTERVAL_S) {
    if (crossedThreshold(prevElapsedS, elapsedS, mark)) {
      return `${Math.round(mark / 60)} Minuten aufgenommen.`;
    }
  }
  return null;
}

export const RECORDING_STARTED_MESSAGE = "Aufnahme läuft.";

export const HARD_STOP_ALERT_MESSAGE =
  "Aufnahmelimit von 20 Minuten erreicht. Die Aufnahme wurde automatisch beendet und behalten.";

/** "Aufnahme beendet, X Minuten Y Sekunden" — für Status-Ansage nach jedem Stopp (manuell oder Hard-Limit). */
export function getRecordingStoppedMessage(durationS: number): string {
  const safe = Number.isFinite(durationS) ? Math.max(0, Math.round(durationS)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `Aufnahme beendet, ${minutes} Minuten ${seconds} Sekunden.`;
}

/**
 * Upload-Fortschritt darf laut Plan NUR in Quartilen angesagt werden (kein
 * Sekundentakt-Flood). Liefert `null`, solange kein 25/50/75/100-Schwellwert
 * überschritten wurde.
 */
export function getUploadQuartileMessage(prevPercent: number, percent: number): string | null {
  if (crossedThreshold(prevPercent, percent, 100)) return "Video vollständig hochgeladen.";
  if (crossedThreshold(prevPercent, percent, 75)) return "Video-Upload: 75 Prozent.";
  if (crossedThreshold(prevPercent, percent, 50)) return "Video-Upload: 50 Prozent.";
  if (crossedThreshold(prevPercent, percent, 25)) return "Video-Upload: 25 Prozent.";
  return null;
}

// ---------------------------------------------------------------------------
// Fehler-Klassifizierung (nach err.name, je eigene deutsche Meldung)
// ---------------------------------------------------------------------------

/** Sentinel-Fehlername für B3: getDisplayMedia lieferte keinen Ton (System-/Tab-Ton ≠ Mikrofon). */
export const NO_AUDIO_TRACK_ERROR_NAME = "NoAudioTrackError";

export type MediaErrorInfo = { message: string };

/**
 * Reine Klassifizierung nach `err.name` — keine Browser-API nötig, daher
 * ohne Mocks testbar. Deckt: Berechtigung verweigert, kein Gerät gefunden,
 * Gerät belegt, sowie den B3-Sonderfall (Bildschirmaufnahme ohne Mikrofon-Ton).
 */
export function classifyMediaError(error: unknown): MediaErrorInfo {
  const name = error instanceof Error ? error.name : undefined;

  if (name === NO_AUDIO_TRACK_ERROR_NAME) {
    return {
      message:
        "Für die Bildschirmaufnahme wird zusätzlich dein Mikrofon benötigt, aber es konnte kein Ton erfasst werden. Bitte Mikrofonzugriff erlauben und erneut versuchen.",
    };
  }
  if (name === "NotAllowedError") {
    return {
      message:
        "Zugriff verweigert. Bitte erlaube den Zugriff auf Kamera/Bildschirm bzw. Mikrofon und versuche es erneut.",
    };
  }
  if (name === "NotFoundError") {
    return {
      message: "Kein passendes Aufnahmegerät gefunden. Bitte prüfe, ob eine Kamera bzw. ein Mikrofon angeschlossen ist.",
    };
  }
  if (name === "NotReadableError") {
    return {
      message: "Das Gerät wird bereits von einer anderen Anwendung verwendet. Bitte die andere Anwendung schließen und erneut versuchen.",
    };
  }
  return { message: "Aufnahme konnte nicht gestartet werden. Bitte versuche es erneut." };
}
