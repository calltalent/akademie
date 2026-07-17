"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Pause, Play, Scissors, Trash2, X } from "lucide-react";
import { formatDuration, formatFileSize } from "@/lib/video/recorder";
import {
  coversFullDuration,
  createInitialSegments,
  normalizeSegments,
  parseTimecode,
  removeSegment,
  setSegmentBound,
  sortSegments,
  splitSegment,
  totalDurationS,
  TRIM_SIZE_LIMIT_BYTES,
  type Segment,
} from "@/lib/video/segments";

/**
 * Video-Trimmer für den Kurs-Editor (Stufe 2 „Schnitt" — Plan
 * `calm-watching-dewdrop.md`). Eingebunden aus `video-recorder.tsx` über
 * `next/dynamic({ ssr: false })`, damit dieses Modul (und mit ihm der Import
 * von `ffmpeg-client.ts`) nicht schon im Admin-Erst-Bundle landet.
 *
 * `await import("@/lib/video/ffmpeg-client")` passiert bewusst ERST im
 * „Zuschnitt übernehmen"-Handler (`handleApply`) — nicht beim Mounten dieser
 * Komponente. Das ist eine bewusste, dokumentierte Auflösung eines inneren
 * Widerspruchs im Plan: B7 beschreibt den Remux-Pass als „läuft beim Öffnen
 * des Trimmers", die Verifikationsliste verlangt aber zusätzlich explizit
 * „Null-Edit lädt ffmpeg NICHT (Network-Tab)" für eine frische, unbearbeitete
 * Sitzung. Beides gleichzeitig ist nicht möglich, sobald ffmpeg für den
 * Remux beim Mounten geladen würde. Diese Umsetzung priorisiert die
 * konkretere, zweimal im Plan genannte und leicht prüfbare Netzwerk-Tab-
 * Vorgabe: die Vorschau spielt stattdessen das UNVERÄNDERTE Original-Blob ab
 * (Wiedergabe funktioniert in Chrome auch ohne korrekte Duration/Cues —
 * nur SCRUBBEN ist kaputt, siehe B7), Navigation läuft über
 * Abspielen/Pause/±5s statt über eine Suchleiste — das deckt sich ohnehin
 * mit der KEIN-DRAG-TIMELINE-Vorgabe weiter unten. Remux + Schnitt laufen
 * dann gemeinsam in EINEM ffmpeg-Ladevorgang, ausgelöst durch „Zuschnitt
 * übernehmen".
 *
 * KEYBOARD-FIRST BLEIBT DIE PRIMÄRE BEDIENUNG (CLAUDE.md §3.4 — der
 * Auftraggeber ist sehbehindert, ziehbare Griffe sind für ihn wertlos): echte
 * `<ul>`-Liste, jede Zeile mit beschrifteten mm:ss-Feldern, „Position
 * übernehmen" (nutzt `video.currentTime`), „Abschnitt teilen", „Abschnitt
 * entfernen". Diese Felder/Knöpfe bleiben unverändert und decken jeden
 * Schnitt vollständig ab, ganz ohne Maus.
 *
 * ZUSÄTZLICH (17.07.2026, Josips Wunsch nach einer visuellen
 * Video-Schnitt-Optik): die Zeitleiste ist jetzt PARALLEL dazu per Maus/Touch
 * bedienbar — ziehbare Start-/Ende-Linien je Abschnitt (Pointer Events,
 * `setPointerCapture`, funktioniert für Maus und Touch gleichermaßen) plus
 * Klick-zum-Springen. Bewusst ERGÄNZEND, nicht ersetzend: die Leiste bleibt
 * `aria-hidden="true"` (für Screenreader unsichtbar, exakt wie vorher) und
 * ruft für jede Bewegung exakt dieselbe `onSetBound()`-Funktion auf, die auch
 * die mm:ss-Felder committen — ein Ziehen erzeugt keinen zweiten Zustand,
 * beide Bedienwege schreiben in dieselben `segments`. Wer nicht sehen oder
 * nicht ziehen kann, verliert dadurch nichts.
 *
 * Kostensicherheit (Plan-Vorgabe, unverändert wichtig): diese Datei
 * importiert `useBunnyUpload` NIE. Das fertige (ggf. geschnittene) Blob geht
 * ausschließlich über `onConfirm` nach oben.
 */

const RESULT_TOLERANCE_S = 1;
const SKIP_SECONDS = 5;

function buildResultMessage(requestedTotalS: number, actualTotalS: number): string {
  const deltaS = actualTotalS - requestedTotalS;
  if (Math.abs(deltaS) < RESULT_TOLERANCE_S) {
    return `Zuschnitt angewendet — Gesamtlänge ${formatDuration(actualTotalS)}, wie angefordert.`;
  }
  const richtung = deltaS > 0 ? "länger" : "kürzer";
  return (
    `Zuschnitt angewendet — tatsächliche Länge ${formatDuration(actualTotalS)} ` +
    `(angefordert ${formatDuration(requestedTotalS)}, ${Math.abs(deltaS).toFixed(1)} s ${richtung} durch ` +
    `Keyframe-Rundung — siehe Hinweis oben).`
  );
}

/**
 * Video-Editor-Optik (siehe Dateikopf): ziehbare Start-/Ende-Linien je
 * Abschnitt + Klick-zum-Springen + Abspielposition als Linie. Bleibt
 * `aria-hidden="true"` — rein zusätzliche Maus-/Touch-Bedienung, ruft für
 * jede Bewegung dieselbe `onSetBound()` auf wie die mm:ss-Felder oben.
 *
 * `touch-action: none` auf Track UND Griffen ist Pflicht, nicht Kosmetik:
 * ohne das würde ein Ziehversuch auf einem Touch-Gerät als Seiten-Scroll
 * interpretiert, bevor der Pointer-Move überhaupt ankommt.
 */
function TimelineBar({
  segments,
  durationS,
  currentPositionS,
  onSetBound,
  onSeek,
}: {
  segments: Segment[];
  durationS: number;
  currentPositionS: number;
  onSetBound: (id: string, bound: "start" | "end", valueS: number) => void;
  onSeek: (valueS: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  if (durationS <= 0) return null;
  const orderedForHandles = sortSegments(segments);
  const normalized = normalizeSegments(segments, durationS);
  const blocks: { kind: "keep" | "cut"; widthPct: number }[] = [];
  let cursor = 0;
  for (const seg of normalized) {
    if (seg.startS > cursor) {
      blocks.push({ kind: "cut", widthPct: ((seg.startS - cursor) / durationS) * 100 });
    }
    blocks.push({ kind: "keep", widthPct: ((seg.endS - seg.startS) / durationS) * 100 });
    cursor = seg.endS;
  }
  if (cursor < durationS - 0.01) {
    blocks.push({ kind: "cut", widthPct: ((durationS - cursor) / durationS) * 100 });
  }
  if (blocks.length === 0) return null;

  function timeFromClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return ratio * durationS;
  }

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (draggingRef.current) return; // Klick direkt nach einem Ziehvorgang nicht zusätzlich als Sprung werten.
    onSeek(timeFromClientX(e.clientX));
  }

  function handleHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    try {
      // Wirft laut Spec `NotFoundError`, wenn die Pointer-ID zwischen dem
      // Event und diesem Aufruf schon ungültig wurde (seltener Edge-Fall,
      // z. B. sehr schnelles Multi-Touch) — dann bleibt es beim einfachen
      // Klick-zum-Springen statt eines Ziehvorgangs, kein Absturz.
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingRef.current = true;
    } catch {
      draggingRef.current = false;
    }
  }

  function handleHandlePointerMove(e: React.PointerEvent<HTMLDivElement>, id: string, bound: "start" | "end") {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const valueS = timeFromClientX(e.clientX);
    onSetBound(id, bound, valueS);
    onSeek(valueS);
  }

  function handleHandlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Capture wurde nie erfolgreich hergestellt (siehe handleHandlePointerDown) — nichts freizugeben.
    }
    // Kurze Verzögerung: der `click` auf dem Track feuert NACH `pointerup`
    // auf demselben Zyklus — ohne den Timer würde ein beendeter Ziehvorgang
    // sofort danach fälschlich als zusätzlicher Sprung interpretiert.
    setTimeout(() => {
      draggingRef.current = false;
    }, 0);
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-[13px] font-bold" style={{ color: "#3E3F66" }}>
        <span aria-hidden="true">Zeitleiste — Linien ziehen zum Anpassen, Klicken zum Springen</span>
      </div>
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        aria-hidden="true"
        className="relative h-11 cursor-pointer select-none"
        style={{ touchAction: "none" }}
      >
        <div
          className="absolute inset-x-0 top-1/2 flex h-[26px] -translate-y-1/2 overflow-hidden rounded-lg border"
          style={{ borderColor: "#E7E8F2" }}
        >
          {blocks.map((b, i) =>
            b.widthPct <= 0 ? null : (
              <div
                key={i}
                style={{
                  flex: `${b.widthPct} 1 0%`,
                  background:
                    b.kind === "keep" ? "#5663AE" : "repeating-linear-gradient(45deg, #EEF0F7 0 6px, #E0E2EF 6px 12px)",
                }}
              />
            ),
          )}
        </div>

        {orderedForHandles.flatMap((seg, i) => [
          <div
            key={`${seg.id}-start`}
            onPointerDown={handleHandlePointerDown}
            onPointerMove={(e) => handleHandlePointerMove(e, seg.id, "start")}
            onPointerUp={handleHandlePointerUp}
            title={`Start Abschnitt ${i + 1} — ziehen zum Anpassen`}
            className="absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize"
            style={{ left: `${(Math.min(Math.max(seg.startS, 0), durationS) / durationS) * 100}%`, touchAction: "none" }}
          >
            <div className="mx-auto h-full w-[3px] rounded-full" style={{ background: "#1A1A2E" }} />
          </div>,
          <div
            key={`${seg.id}-end`}
            onPointerDown={handleHandlePointerDown}
            onPointerMove={(e) => handleHandlePointerMove(e, seg.id, "end")}
            onPointerUp={handleHandlePointerUp}
            title={`Ende Abschnitt ${i + 1} — ziehen zum Anpassen`}
            className="absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize"
            style={{ left: `${(Math.min(Math.max(seg.endS, 0), durationS) / durationS) * 100}%`, touchAction: "none" }}
          >
            <div className="mx-auto h-full w-[3px] rounded-full" style={{ background: "#1A1A2E" }} />
          </div>,
        ])}

        <div
          className="pointer-events-none absolute top-0 h-full w-[2px] -translate-x-1/2"
          style={{
            left: `${(Math.min(Math.max(currentPositionS, 0), durationS) / durationS) * 100}%`,
            background: "#B14A4A",
          }}
        />
      </div>
      <div className="mt-2 flex gap-5 text-[13px] font-semibold" style={{ color: "#3E3F66" }} aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded" style={{ background: "#5663AE" }} />
          Behalten
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-3.5 w-3.5 rounded"
            style={{ background: "repeating-linear-gradient(45deg, #EEF0F7 0 4px, #E0E2EF 4px 8px)" }}
          />
          Entfernt
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-1 rounded-full" style={{ background: "#1A1A2E" }} />
          Schnittlinie (ziehbar)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-1 rounded-full" style={{ background: "#B14A4A" }} />
          Wiedergabeposition
        </span>
      </div>
    </div>
  );
}

function SegmentRow({
  segment,
  index,
  videoRef,
  onSetBound,
  onSplit,
  onRemove,
  canRemove,
}: {
  segment: Segment;
  index: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onSetBound: (id: string, bound: "start" | "end", valueS: number) => void;
  onSplit: (id: string) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}) {
  const [startText, setStartText] = useState(() => formatDuration(segment.startS));
  const [endText, setEndText] = useState(() => formatDuration(segment.endS));
  const [lastFocused, setLastFocused] = useState<"start" | "end">("start");
  const [fieldError, setFieldError] = useState("");

  // Text-Felder mit dem tatsächlichen Wert synchron halten, wenn er sich
  // von AUSSEN ändert (Position übernehmen, Teilen, Entfernen einer anderen
  // Zeile) — läuft nur bei einer echten Wertänderung, nicht bei jedem
  // Render, damit eine laufende Eingabe (vor dem onBlur-Commit) nie
  // überschrieben wird. `setTimeout(…, 0)` statt direkt im Effect-Body:
  // gleiches Muster wie `SaveIndicator`/`stoppedUrl` in `video-recorder.tsx`
  // (react-hooks/set-state-in-effect erzwingt sonst einen zusätzlichen
  // Render direkt nach diesem) — Verhalten für Nutzer unverändert.
  useEffect(() => {
    const timer = setTimeout(() => setStartText(formatDuration(segment.startS)), 0);
    return () => clearTimeout(timer);
  }, [segment.startS]);
  useEffect(() => {
    const timer = setTimeout(() => setEndText(formatDuration(segment.endS)), 0);
    return () => clearTimeout(timer);
  }, [segment.endS]);

  function commitStart() {
    const parsed = parseTimecode(startText);
    if (parsed === null) {
      setFieldError("Ungültige Zeit — Format mm:ss verwenden.");
      setStartText(formatDuration(segment.startS));
      return;
    }
    setFieldError("");
    onSetBound(segment.id, "start", parsed);
  }

  function commitEnd() {
    const parsed = parseTimecode(endText);
    if (parsed === null) {
      setFieldError("Ungültige Zeit — Format mm:ss verwenden.");
      setEndText(formatDuration(segment.endS));
      return;
    }
    setFieldError("");
    onSetBound(segment.id, "end", parsed);
  }

  function handleTakePosition() {
    const video = videoRef.current;
    if (!video) return;
    onSetBound(segment.id, lastFocused, video.currentTime);
  }

  return (
    <li className="rounded-xl border p-4" style={{ borderColor: "#EEF0F7" }}>
      <div className="flex flex-wrap items-end gap-4">
        <span
          aria-hidden="true"
          className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] text-[15px] font-extrabold"
          style={{ background: "#EDEEF7", color: "#5663AE" }}
        >
          {index + 1}
        </span>

        <label className="flex flex-col gap-1.5 text-[13px] font-bold" style={{ color: "#3E3F66" }}>
          {`Start (Abschnitt ${index + 1})`}
          <input
            type="text"
            inputMode="numeric"
            placeholder="mm:ss"
            value={startText}
            onFocus={() => setLastFocused("start")}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={commitStart}
            className="w-24 rounded-[10px] border px-3 py-2.5 text-base tabular-nums"
            style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-[13px] font-bold" style={{ color: "#3E3F66" }}>
          {`Ende (Abschnitt ${index + 1})`}
          <input
            type="text"
            inputMode="numeric"
            placeholder="mm:ss"
            value={endText}
            onFocus={() => setLastFocused("end")}
            onChange={(e) => setEndText(e.target.value)}
            onBlur={commitEnd}
            className="w-24 rounded-[10px] border px-3 py-2.5 text-base tabular-nums"
            style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
          />
        </label>

        <div className="flex-1" />

        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            onClick={handleTakePosition}
            className="inline-flex items-center gap-1.5 rounded-[10px] border bg-white px-3 py-2.5 text-sm font-semibold"
            style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
          >
            {lastFocused === "start" ? "Position als Start übernehmen" : "Position als Ende übernehmen"}
          </button>
          <button
            type="button"
            onClick={() => onSplit(segment.id)}
            className="inline-flex items-center gap-1.5 rounded-[10px] border bg-white px-3 py-2.5 text-sm font-semibold"
            style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
          >
            Abschnitt teilen
          </button>
          <button
            type="button"
            onClick={() => onRemove(segment.id)}
            disabled={!canRemove}
            title={canRemove ? undefined : "Mindestens ein Abschnitt muss erhalten bleiben."}
            className="inline-flex items-center gap-1.5 rounded-[10px] border bg-white px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
          >
            <Trash2 size={14} aria-hidden="true" />
            Abschnitt entfernen
          </button>
        </div>
      </div>
      {fieldError && (
        <p role="alert" className="mt-2.5 text-sm font-bold" style={{ color: "#B14A4A" }}>
          {fieldError}
        </p>
      )}
    </li>
  );
}

export function VideoTrimmer({
  blob,
  durationS,
  onConfirm,
  onCancel,
}: {
  blob: Blob;
  durationS: number;
  onConfirm: (blob: Blob, durationS: number) => void;
  onCancel: () => void;
}) {
  const tooLargeToTrim = blob.size > TRIM_SIZE_LIMIT_BYTES;

  const [segments, setSegments] = useState<Segment[]>(() => createInitialSegments(durationS));
  const [busy, setBusy] = useState(false);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [currentPositionS, setCurrentPositionS] = useState(0);

  const idCounterRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  function nextId(): string {
    idCounterRef.current += 1;
    return `seg-new-${idCounterRef.current}`;
  }

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (tooLargeToTrim) return;
    const url = URL.createObjectURL(blob);
    // setTimeout(…, 0) statt direkt im Effect-Body (react-hooks/set-state-in-effect) — gleiches Muster wie oben.
    const timer = setTimeout(() => setPreviewUrl(url), 0);
    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
  }, [blob, tooLargeToTrim]);

  const orderedSegments = sortSegments(segments);
  const normalized = normalizeSegments(segments, durationS);
  const resultingDurationS = totalDurationS(normalized);

  function handleSetBound(id: string, bound: "start" | "end", valueS: number) {
    setSegments((prev) => setSegmentBound(prev, id, bound, valueS));
  }

  // Liest `segments` bewusst direkt aus dem Closure statt über eine
  // funktionale `setSegments`-Updater-Form: die Updater-Form wird unter
  // React StrictMode (Dev) zur Reinheitsprüfung zweimal aufgerufen — mit
  // Seiteneffekten darin (hier: `setAlertMessage`/`setStatusMessage`,
  // `nextId()`-Zähler) liefe das doppelt. Da jeder Aufruf hier aus einem
  // einzelnen Klick-Handler stammt (kein gleichzeitiges Update aus zwei
  // Quellen), ist der Closure-Wert unproblematisch aktuell.
  function handleSplit(id: string) {
    const video = videoRef.current;
    if (!video) return;
    const atS = video.currentTime;
    const next = splitSegment(segments, id, atS, [nextId(), nextId()]);
    if (next === segments) {
      setAlertMessage(
        `Die aktuelle Wiedergabeposition (${formatDuration(atS)}) liegt nicht innerhalb dieses Abschnitts ` +
          "(oder zu nah an dessen Rand) — Abspielen/Pause nutzen, um erst dorthin zu gelangen.",
      );
      return;
    }
    setSegments(next);
    setAlertMessage("");
    setStatusMessage(`Abschnitt bei ${formatDuration(atS)} geteilt.`);
  }

  function handleRemove(id: string) {
    if (segments.length <= 1) return;
    setSegments(removeSegment(segments, id));
    setStatusMessage("Abschnitt entfernt.");
  }

  function skip(deltaS: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(video.currentTime + deltaS, 0), durationS);
  }

  async function handleApply() {
    if (normalized.length === 0) {
      setAlertMessage("Mindestens ein Abschnitt muss erhalten bleiben. Bitte zuerst einen Abschnitt anpassen.");
      return;
    }
    setAlertMessage("");

    if (normalized.length === 1 && coversFullDuration(normalized, durationS)) {
      // Abkürzung (Plan): keine echte Änderung -> ffmpeg wird nicht geladen
      // (kein `setBusy`/ffmpeg-Import in diesem Zweig), das Original-Blob
      // geht unverändert nach oben.
      onConfirm(blob, durationS);
      return;
    }

    setBusy(true);
    setProgressPercent(0);
    try {
      setStatusMessage("Video wird vorbereitet …");
      const { remuxFix, cutAndConcat } = await import("@/lib/video/ffmpeg-client");
      const fixed = await remuxFix(blob, setProgressPercent);
      setStatusMessage("Abschnitte werden geschnitten …");
      const { blob: outBlob, segmentResults } = await cutAndConcat(fixed, normalized, setProgressPercent);
      const requestedTotal = segmentResults.reduce((sum, r) => sum + r.requestedDurationS, 0);
      const actualTotal = segmentResults.reduce((sum, r) => sum + r.actualDurationS, 0) || requestedTotal;
      setStatusMessage(buildResultMessage(requestedTotal, actualTotal));
      onConfirm(outBlob, actualTotal);
    } catch (e) {
      console.error("[video-trimmer] Zuschnitt fehlgeschlagen.", e);
      setAlertMessage("Zuschneiden fehlgeschlagen. Du kannst die Aufnahme stattdessen ohne Zuschnitt hochladen.");
      setBusy(false);
      setProgressPercent(null);
    }
  }

  function handleUseWithoutTrim() {
    onConfirm(blob, durationS);
  }

  if (tooLargeToTrim) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border bg-white p-5" style={{ borderColor: "#E7E8F2" }}>
        <h3 ref={headingRef} tabIndex={-1} className="text-base font-extrabold outline-none" style={{ color: "#1A1A2E" }}>
          Zuschneiden nicht möglich
        </h3>
        <p role="alert" className="rounded-xl border px-4 py-3 text-sm font-bold" style={{ borderColor: "#E9CFCF", background: "#FBEAEA", color: "#B14A4A" }}>
          Aufnahme zu groß zum Zuschneiden im Browser ({formatFileSize(blob.size)}). Du kannst sie ohne Zuschnitt
          hochladen.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleUseWithoutTrim}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[15px] font-bold text-white"
            style={{ background: "#5663AE" }}
          >
            <Check size={16} aria-hidden="true" />
            Ohne Zuschnitt hochladen
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold"
            style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
          >
            <X size={16} aria-hidden="true" />
            Zurück
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-white p-5" style={{ borderColor: "#E7E8F2" }}>
      <h3 ref={headingRef} tabIndex={-1} className="text-base font-extrabold outline-none" style={{ color: "#1A1A2E" }}>
        Video zuschneiden
      </h3>

      {/* Vorschau: spielt bewusst das UNVERÄNDERTE Original-Blob (siehe
          Dateikopf-Kommentar zur Remux-Timing-Entscheidung). Nicht `muted` —
          Übergänge müssen anhörbar sein. */}
      <div className="w-full max-w-md overflow-hidden rounded-2xl border bg-black" style={{ borderColor: "#E7E8F2" }}>
        <video
          ref={videoRef}
          src={previewUrl ?? undefined}
          playsInline
          onTimeUpdate={(e) => setCurrentPositionS(e.currentTarget.currentTime)}
          className="aspect-[16/9] w-full bg-black object-contain"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => videoRef.current?.play()}
          className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-4 py-2 text-sm font-bold"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <Play size={14} aria-hidden="true" />
          Abspielen
        </button>
        <button
          type="button"
          onClick={() => videoRef.current?.pause()}
          className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-4 py-2 text-sm font-bold"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <Pause size={14} aria-hidden="true" />
          Pause
        </button>
        <button
          type="button"
          onClick={() => skip(-SKIP_SECONDS)}
          className="inline-flex items-center rounded-[10px] border bg-white px-4 py-2 text-sm font-bold"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          5 Sekunden zurück
        </button>
        <button
          type="button"
          onClick={() => skip(SKIP_SECONDS)}
          className="inline-flex items-center rounded-[10px] border bg-white px-4 py-2 text-sm font-bold"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          5 Sekunden vor
        </button>
        <span aria-hidden="true" className="text-sm font-semibold tabular-nums" style={{ color: "#66679B" }}>
          Position {formatDuration(currentPositionS)} / {formatDuration(durationS)}
        </span>
      </div>

      <div className="flex flex-col gap-3.5 rounded-2xl border p-4" style={{ borderColor: "#EEF0F7" }}>
        <div className="flex items-center gap-2.5">
          <span className="h-[22px] w-1 rounded-[3px]" style={{ background: "#5663AE" }} />
          <h4 className="text-[17px] font-extrabold" style={{ color: "#1A1A2E" }}>
            Zu behaltende Abschnitte
          </h4>
        </div>

        <ul className="flex flex-col gap-3.5">
          {orderedSegments.map((segment, index) => (
            <SegmentRow
              key={segment.id}
              segment={segment}
              index={index}
              videoRef={videoRef}
              onSetBound={handleSetBound}
              onSplit={handleSplit}
              onRemove={handleRemove}
              canRemove={segments.length > 1}
            />
          ))}
        </ul>

        <TimelineBar
          segments={segments}
          durationS={durationS}
          currentPositionS={currentPositionS}
          onSetBound={handleSetBound}
          onSeek={(valueS) => {
            const video = videoRef.current;
            if (video) video.currentTime = valueS;
          }}
        />

        <div
          className="flex items-start gap-2.5 rounded-xl border px-4 py-3"
          style={{ borderColor: "#E0E2EF", background: "#F6F7FC" }}
        >
          <AlertTriangle size={18} aria-hidden="true" style={{ color: "#5663AE", flexShrink: 0, marginTop: 1 }} />
          <span className="text-sm font-semibold" style={{ color: "#3E3F66" }}>
            Schnitte erfolgen am nächsten Keyframe (bis ~2 Sekunden Abweichung) — dafür ohne Qualitätsverlust.
          </span>
        </div>

        {busy && progressPercent !== null && (
          <div aria-hidden="true" className="h-2 overflow-hidden rounded-full" style={{ background: "#EEF0F7" }}>
            <div className="h-full rounded-full" style={{ width: `${progressPercent}%`, background: "#5663AE" }} />
          </div>
        )}
      </div>

      {statusMessage && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-xl border px-4 py-3 text-sm font-semibold"
          style={{ borderColor: "#CDE9D9", background: "#E3F2EA", color: "#1F8A5B" }}
        >
          {statusMessage}
        </p>
      )}
      {alertMessage && (
        <p role="alert" className="rounded-xl border px-4 py-3 text-sm font-bold" style={{ borderColor: "#E9CFCF", background: "#FBEAEA", color: "#B14A4A" }}>
          {alertMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3.5">
        <div className="text-[15px] font-bold" style={{ color: "#1A1A2E" }}>
          Gesamtlänge nach Schnitt:{" "}
          <span className="tabular-nums" style={{ color: "#5663AE" }}>
            {formatDuration(resultingDurationS)}
          </span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleUseWithoutTrim}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-4 py-3 text-[15px] font-semibold disabled:opacity-50"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          Ohne Zuschnitt hochladen
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[15px] font-bold text-white disabled:opacity-60"
          style={{ background: "#5663AE" }}
        >
          <Scissors size={16} aria-hidden="true" />
          {busy ? "Wird geschnitten …" : "Zuschnitt übernehmen"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold disabled:opacity-50"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <X size={16} aria-hidden="true" />
          Abbrechen
        </button>
      </div>
    </div>
  );
}
