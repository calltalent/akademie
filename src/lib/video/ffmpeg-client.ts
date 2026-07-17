"use client";

/**
 * ffmpeg.wasm-Client für den Video-Trimmer (Kurs-Editor, Stufe 2 „Schnitt" —
 * Plan `calm-watching-dewdrop.md`). Wird NUR aus `video-trimmer.tsx` heraus
 * verwendet, und dort erst innerhalb des „Zuschneiden starten"-Handlers
 * dynamisch importiert (`await import("@/lib/video/ffmpeg-client")`) —
 * NIEMALS im Admin-Erst-Bundle, sonst würde jede Editor-Seite ~31 MB
 * ffmpeg-core.wasm mitziehen, auch wenn nie geschnitten wird.
 *
 * WARNUNG (Plan-Zwang, nicht „für Performance optimieren"): dieses Modul lädt
 * ausschließlich das SINGLE-THREADED `@ffmpeg/core` (siehe package.json) über
 * die Bunny-fremde, aber gleiche Origin nutzende Route
 * `src/app/api/ffmpeg/[file]/route.ts`. NIEMALS auf `@ffmpeg/core-mt`
 * (Multi-Thread) umstellen — das würde `SharedArrayBuffer` und damit
 * COOP/COEP-Response-Header auf JEDER Seite dieser App verlangen, was den
 * Bunny-iframe-Player (`bunny-player.tsx`) zerschießen würde (iframes von
 * Fremd-Origins brauchen `allow`-Header-Kooperation, die Bunny nicht bietet).
 *
 * Alle drei Passes laufen ausschließlich mit `-c copy` (Stream-Copy, nie
 * Neu-Encoding) — Josips bewusste Entscheidung: keyframe-genau statt
 * bildgenau, weil Neu-Encoding single-threaded 1–3 Stunden für 20 Minuten
 * Video bräuchte.
 */

import { fetchFile } from "@ffmpeg/util";
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import type { Segment } from "./segments";

const CORE_URL = "/api/ffmpeg/ffmpeg-core.js";
const WASM_URL = "/api/ffmpeg/ffmpeg-core.wasm";
// `classWorkerURL` ist ZWINGEND (Blocker B5): @ffmpeg/ffmpeg v0.12 macht
// ohne diese Angabe intern `new Worker(new URL("./worker.js",
// import.meta.url))` mit einem LITERALEN Pfad — genau das bricht unter
// `next build --webpack` (Webpacks statische Worker-Chunk-Erkennung greift
// nur bei Literalen, versucht es hier aber trotzdem und scheitert). Wird
// `classWorkerURL` dagegen als LAUFZEIT-Variable übergeben (wie hier), sieht
// Webpack keinen Literal-Pfad mehr und rührt den Aufruf gar nicht erst an —
// er bleibt ein ganz normaler `new Worker(new URL(...))`-Laufzeitaufruf.
const CLASS_WORKER_URL = "/api/ffmpeg/814.ffmpeg.js";

export type ProgressCallback = (percent: number) => void;

export interface SegmentCutResult {
  requestedDurationS: number;
  actualDurationS: number;
}

export interface CutAndConcatResult {
  blob: Blob;
  segmentResults: SegmentCutResult[];
}

let instance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

/**
 * Lazy-Singleton + In-Flight-Promise: ein zweiter Aufruf während des
 * ersten Ladens (z. B. Retake -> erneutes Öffnen des Trimmers) wartet auf
 * dieselbe Ladeoperation, statt die ~31 MB wasm ein zweites Mal zu ziehen.
 * Schlägt das Laden fehl, bleibt `instance` NULL, damit ein erneuter Versuch
 * (z. B. nach Netzwerkfehler) tatsächlich neu lädt statt dauerhaft zu
 * scheitern.
 */
async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ffmpeg = new FFmpeg();
    // exec() liefert nur einen Zahlencode zurück — ohne dieses Log ist ein
    // Concat-/Schnittfehler nicht diagnostizierbar (Plan-Vorgabe).
    ffmpeg.on("log", ({ message }) => console.debug("[ffmpeg]", message));
    await ffmpeg.load({ coreURL: CORE_URL, wasmURL: WASM_URL, classWorkerURL: CLASS_WORKER_URL });
    instance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

function attachProgress(ffmpeg: FFmpeg, onProgress: ProgressCallback | undefined): () => void {
  if (!onProgress) return () => {};
  const handler = ({ progress }: { progress: number }) => {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
    onProgress(Math.round(clamped * 100));
  };
  ffmpeg.on("progress", handler);
  return () => ffmpeg.off("progress", handler);
}

/** Räumt eine MEMFS-Zwischendatei sofort nach Gebrauch auf (Plan-Risiko R6, Speicher) — Fehler dabei sind nie kritisch (Datei ggf. schon weg), deshalb nur geloggt statt geworfen. */
async function safeDeleteFile(ffmpeg: FFmpeg, path: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(path);
  } catch (e) {
    console.debug(`[ffmpeg-client] Aufräumen von "${path}" fehlgeschlagen (unkritisch):`, e);
  }
}

/** Führt einen ffmpeg-Befehl aus und wirft bei einem Nicht-Null-Exit-Code — `exec()` allein würde einen Fehler sonst still verschlucken. */
async function execOrThrow(ffmpeg: FFmpeg, args: string[], context: string): Promise<void> {
  const code = await ffmpeg.exec(args);
  if (code !== 0) {
    throw new Error(`ffmpeg-Befehl fehlgeschlagen (${context}), Exit-Code ${code}.`);
  }
}

function readFileAsBlob(ffmpeg: FFmpeg, path: string): Promise<Blob> {
  return ffmpeg.readFile(path).then((data) => {
    // `new Uint8Array(data)` statt `data` direkt: ffmpeg.wasm typisiert das
    // zurückgegebene Uint8Array mit einem generischen `ArrayBufferLike`
    // (könnte laut Typ auch ein SharedArrayBuffer sein), `BlobPart` verlangt
    // aber konkret `ArrayBuffer`-gestützte Views. Die Kopie ist bei den hier
    // anfallenden Segment-/Endgrößen unkritisch.
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    return new Blob([bytes], { type: "video/webm" });
  });
}

/**
 * Ermittelt die TATSÄCHLICHE Dauer eines produzierten Blobs über ein
 * unsichtbares `<video>`-Element (zuverlässiger als ffmpeg-Log-Parsing: das
 * fertig gemuxte Ausgabe-Webm hat — anders als das rohe MediaRecorder-Webm,
 * Blocker B7 — eine echte Duration). Wirft NIE (R6, „nie eine Sackgasse") —
 * im Zweifel wird `0` geliefert und die aufrufende Stelle zeigt dann einfach
 * keine Abweichungs-Meldung an, statt einen falschen Wert zu erfinden.
 */
function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      resolve(0);
    };
    video.src = url;
  });
}

/**
 * Pass 1 (Blocker B7): Remuxt ein rohes MediaRecorder-Webm (keine Duration,
 * keine Cues -> `<video>` meldet `Infinity`, Seeking kaputt) zu einem sauber
 * gemuxten Webm mit echter Duration. Reiner Stream-Copy, kein Neu-Encoding.
 */
export async function remuxFix(blob: Blob, onProgress?: ProgressCallback): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  const inputName = "in.webm";
  const outputName = "fixed.webm";
  const detach = attachProgress(ffmpeg, onProgress);

  await ffmpeg.writeFile(inputName, await fetchFile(blob));
  try {
    await execOrThrow(ffmpeg, ["-i", inputName, "-c", "copy", outputName], "Remux");
    return await readFileAsBlob(ffmpeg, outputName);
  } finally {
    detach();
    await safeDeleteFile(ffmpeg, inputName);
    await safeDeleteFile(ffmpeg, outputName);
  }
}

/**
 * Pass 2+3: schneidet jedes zu behaltende Segment per Input-Seeking
 * (`-ss` VOR `-i` — schnell, keyframe-genau) aus dem bereits geremuxten
 * Blob, fügt bei mehr als einem Segment per `concat`-Demuxer zusammen.
 * Erwartet bereits NORMALISIERTE Segmente (siehe `segments.ts`) — Aufrufer
 * ist `video-trimmer.tsx`.
 *
 * Meldet je Segment die tatsächliche Ausgabedauer zurück (`probeDuration`
 * auf dem jeweiligen Zwischenergebnis) — Grundlage für die im Plan
 * geforderte Rückmeldung „Schnitt landet ggf. bis zu ~2s neben dem
 * Zielwert" (Blocker B6). Absolute Quell-Zeitpunkte lassen sich aus
 * ffmpeg.wasms Log/Progress-Events nicht robust genug herauslesen, um sie
 * dem Nutzer als exakte Zahl zu präsentieren — die Dauer-Abweichung pro
 * Segment ist dieselbe Information (zeigt denselben Keyframe-Rundungsfehler
 * an), aber über einen zuverlässigen Messweg (`<video>.duration` des
 * tatsächlich erzeugten Segments) statt über Text-Parsing gewonnen.
 */
export async function cutAndConcat(
  fixedBlob: Blob,
  segments: Segment[],
  onProgress?: ProgressCallback,
): Promise<CutAndConcatResult> {
  if (segments.length === 0) {
    throw new Error("Mindestens ein Abschnitt muss behalten werden.");
  }

  const ffmpeg = await getFFmpeg();
  const inputName = "fixed.webm";
  await ffmpeg.writeFile(inputName, await fetchFile(fixedBlob));

  const segmentFiles: string[] = [];
  const segmentResults: SegmentCutResult[] = [];
  const totalSteps = segments.length + (segments.length > 1 ? 1 : 0);
  let completedSteps = 0;

  function reportOverall(localFraction: number) {
    if (!onProgress) return;
    const overall = (completedSteps + localFraction) / totalSteps;
    onProgress(Math.round(Math.min(1, Math.max(0, overall)) * 100));
  }

  try {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const outName = `seg${i}.webm`;
      const detach = attachProgress(ffmpeg, (p) => reportOverall(p / 100));
      try {
        await execOrThrow(
          ffmpeg,
          ["-ss", String(seg.startS), "-to", String(seg.endS), "-i", inputName, "-c", "copy", outName],
          `Abschnitt ${i + 1} schneiden`,
        );
      } finally {
        detach();
      }
      const segBlob = await readFileAsBlob(ffmpeg, outName);
      segmentResults.push({
        requestedDurationS: seg.endS - seg.startS,
        actualDurationS: await probeDuration(segBlob),
      });
      segmentFiles.push(outName);
      completedSteps += 1;
      reportOverall(0);
    }

    let finalBlob: Blob;
    if (segmentFiles.length === 1) {
      // Abkürzung (Plan): genau ein Segment -> Concat-Pass (Pass 3) überspringen.
      finalBlob = await readFileAsBlob(ffmpeg, segmentFiles[0]);
    } else {
      const listContent = segmentFiles.map((f) => `file '${f}'`).join("\n");
      await ffmpeg.writeFile("list.txt", new TextEncoder().encode(listContent));
      const detach = attachProgress(ffmpeg, (p) => reportOverall(p / 100));
      try {
        await execOrThrow(
          ffmpeg,
          ["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "out.webm"],
          "Zusammenfügen",
        );
      } finally {
        detach();
      }
      finalBlob = await readFileAsBlob(ffmpeg, "out.webm");
      completedSteps += 1;
      reportOverall(0);
      await safeDeleteFile(ffmpeg, "list.txt");
      await safeDeleteFile(ffmpeg, "out.webm");
    }

    return { blob: finalBlob, segmentResults };
  } finally {
    await safeDeleteFile(ffmpeg, inputName);
    for (const f of segmentFiles) await safeDeleteFile(ffmpeg, f);
  }
}

export { probeDuration };
