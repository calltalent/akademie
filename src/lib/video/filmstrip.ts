/**
 * Filmstreifen-Vorschau für den Video-Trimmer (Josips Wunsch, 18.07.2026:
 * "im Balken jeweils die Frames einzeln anzeigen ... damit ich sofort sehen
 * kann welcher Frame ausgewählt ist").
 *
 * ABSICHTLICH KEIN SEEK auf beliebige Zeitstempel (`video.currentTime = t`):
 * MediaRecorder-WebM hat keine Cues (siehe B7-Kommentar in
 * `video-trimmer.tsx`) — Sprünge auf einen Zeitpunkt sind dort unzuverlässig
 * bis kaputt. SEQUENZIELLES Abspielen funktioniert dagegen bereits nachweis-
 * lich zuverlässig auf demselben Roh-Blob (die Vorschau im Trimmer tut genau
 * das). Deshalb hier: Video beschleunigt (`playbackRate`) von vorn bis hinten
 * durchspielen, dabei jeden tatsächlich dekodierten Frame per
 * `requestVideoFrameCallback` abgreifen und dem nächstgelegenen Zeit-„Slot"
 * zuordnen. Kein ffmpeg nötig — löst die Aufgabe rein über native
 * Video-/Canvas-APIs. Wichtig für die Kostensicherheit aus dem Plan: der
 * Trimmer lädt ffmpeg weiterhin NUR bei "Zuschnitt übernehmen", nicht schon
 * beim Öffnen (siehe Dateikopf-Kommentar video-trimmer.tsx) — ein Seek-freier
 * Ansatz hier verletzt diese Vorgabe nicht.
 *
 * `requestVideoFrameCallback`/`cancelVideoFrameCallback` sind in der TS-DOM-
 * Lib zwar als immer vorhanden typisiert (`VideoFrameCallbackMetadata` ist
 * ein globaler Typ aus `lib.dom.d.ts`), Firefox unterstützt sie zur Laufzeit
 * aber NICHT — deshalb unten trotzdem ein echter `"requestVideoFrameCallback"
 * in video`-Laufzeit-Check vor jedem Aufruf, kein reiner Typ-Fallback.
 */

export type FilmstripThumbnail = { index: number; dataUrl: string };

const THUMB_WIDTH_PX = 96;
const THUMB_HEIGHT_PX = 54;
const PLAYBACK_RATE = 16;

/**
 * Startet die Extraktion im Hintergrund, ruft `onThumbnail` für jeden neu
 * gefüllten Slot auf (Reihenfolge nicht garantiert — Frames aus schnellen
 * Bewegungen können außer der Reihe ankommen). Gibt `cancel()` zurück, MUSS
 * beim Unmount/Blob-Wechsel aufgerufen werden (räumt Video-Element,
 * Object-URL und ausstehende Callbacks auf — sonst liefe die Extraktion nach
 * dem Schließen des Trimmers im Hintergrund weiter).
 */
export function extractFilmstrip(
  blob: Blob,
  durationS: number,
  thumbCount: number,
  onThumbnail: (thumb: FilmstripThumbnail) => void,
): { cancel: () => void } {
  let cancelled = false;
  let frameHandle: number | null = null;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;

  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.src = objectUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH_PX;
  canvas.height = THUMB_HEIGHT_PX;
  const ctx = canvas.getContext("2d");

  const filled = new Array<boolean>(thumbCount).fill(false);
  let filledCount = 0;
  const slotDurationS = durationS > 0 ? durationS / thumbCount : 0;

  function cleanup() {
    if (cancelled) return;
    cancelled = true;
    if (safetyTimer !== null) clearTimeout(safetyTimer);
    if (frameHandle !== null) {
      if ("cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(frameHandle);
      else cancelAnimationFrame(frameHandle);
    }
    document.removeEventListener("visibilitychange", resumeIfPausedByBrowser);
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }

  function captureAt(mediaTimeS: number) {
    if (cancelled || !ctx || slotDurationS <= 0) return;
    const slot = Math.min(thumbCount - 1, Math.max(0, Math.floor(mediaTimeS / slotDurationS)));
    if (filled[slot]) return;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch {
      // Frame war im exakten Moment des Callbacks noch nicht zeichenbar
      // (seltener Browser-Timing-Fall) — der nächste Callback liefert
      // denselben Slot ggf. erneut, bis er einmal glückt.
      return;
    }
    filled[slot] = true;
    filledCount += 1;
    onThumbnail({ index: slot, dataUrl: canvas.toDataURL("image/jpeg", 0.6) });
    if (filledCount >= thumbCount) cleanup();
  }

  function frameLoop(_now: number, metadata?: VideoFrameCallbackMetadata) {
    if (cancelled) return;
    captureAt(metadata ? metadata.mediaTime : video.currentTime);
    if (cancelled) return; // captureAt kann gerade cleanup() ausgelöst haben.
    if ("requestVideoFrameCallback" in video) {
      frameHandle = video.requestVideoFrameCallback(frameLoop);
    } else {
      // Firefox-Fallback: kein requestVideoFrameCallback, dafür rAF + currentTime.
      // Gröber (nicht an echte Dekodier-Ereignisse gekoppelt), für einen
      // Filmstreifen aber ausreichend.
      frameHandle = requestAnimationFrame(() => frameLoop(performance.now()));
    }
  }

  function resumeIfPausedByBrowser() {
    // Browser pausieren Video-Wiedergabe in Hintergrund-/nicht sichtbaren
    // Tabs aggressiv (verifiziert: sogar das eigentliche Vorschau-Video
    // derselben Seite pausiert dort sofort bei t=0) — ohne diesen Re-Play-
    // Versuch bliebe der Filmstreifen für einen Nutzer, der kurz den Tab
    // wechselt, während er entsteht, für immer bei den bis dahin erreichten
    // Slots stehen. `cancelled` schützt davor, ein bereits fertiges/
    // abgebrochenes Video wieder anzustoßen.
    if (!cancelled && video.paused && video.currentTime < durationS) {
      video.play().catch(() => {});
    }
  }

  video.addEventListener(
    "loadedmetadata",
    () => {
      video.playbackRate = PLAYBACK_RATE;
      video.play().catch(() => {
        // Autoplay (auch stummgeschaltet) kann in seltenen Browser-
        // Konfigurationen blockiert sein — dann bleibt der Filmstreifen
        // leer. Kein Fehlerzustand, die mm:ss-Felder/mausbasierte Ziehleiste
        // funktionieren unabhängig davon weiter.
      });
      frameLoop(performance.now());
    },
    { once: true },
  );
  video.addEventListener("ended", cleanup, { once: true });
  document.addEventListener("visibilitychange", resumeIfPausedByBrowser);
  // Sicherheitsnetz: falls "ended" wegen kaputter Metadaten nie feuert.
  safetyTimer = setTimeout(cleanup, Math.max(15000, durationS * 1000 * 1.5));

  return { cancel: cleanup };
}

export { THUMB_WIDTH_PX as FILMSTRIP_THUMB_WIDTH_PX, THUMB_HEIGHT_PX as FILMSTRIP_THUMB_HEIGHT_PX };
