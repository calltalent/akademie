"use client";

import { useEffect, useRef, useState } from "react";
import { Check, LocateFixed, Pause, Play, Scissors, Trash2, X } from "lucide-react";
import { formatDurationPrecise, formatFileSize } from "@/lib/video/recorder";
import {
  coversFullDuration,
  createInitialSegments,
  MIN_SEGMENT_LENGTH_S,
  neighborBounds,
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
import { extractFilmstrip } from "@/lib/video/filmstrip";

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
 * `<ul>`-Liste, jede Zeile mit beschrifteten mm:ss.f-Feldern und je einem
 * „Position"-Knopf pro Feld (setzt Start/Ende auf `video.currentTime`),
 * globales „Hier schneiden" an der Wiedergabeposition, „Entfernen" pro
 * Zeile. Alles ist ohne Maus vollständig bedienbar.
 *
 * Maus/Touch PARALLEL dazu (17.07.2026): Zeitleiste mit ziehbaren Start-/
 * Ende-Linien je Abschnitt (Pointer Events, `setPointerCapture`) plus
 * Klick-zum-Springen. Bewusst ERGÄNZEND, nicht ersetzend: die Leiste bleibt
 * `aria-hidden="true"` und ruft für jede Bewegung dieselbe `onSetBound()`
 * auf wie die Felder — beide Bedienwege schreiben in dieselben `segments`.
 *
 * VEREINFACHUNG (18.07.2026, Josips Wunsch „einfacher und intuitiver" — mit
 * Screenshot eines real erreichten kaputten Zustands Start 00:01/Ende 00:00):
 * 1. Grenzen können sich nicht mehr kreuzen: Ziehen klemmt an der
 *    Gegen-Grenze (minus `MIN_SEGMENT_LENGTH_S`), getippte/übernommene Werte
 *    werden mit klarer Meldung abgewiesen („Start muss vor dem Ende liegen")
 *    statt still einen leeren Abschnitt zu erzeugen — im Screenshot war
 *    dadurch ohne erkennbaren Grund alles „entfernt", Gesamtlänge 00:00.
 * 2. EIN globaler „Hier schneiden"-Knopf bei den Wiedergabe-Knöpfen statt
 *    „Abschnitt teilen" in jeder Zeile — Teilen wirkt ohnehin immer an der
 *    Wiedergabeposition, der Knopf gehört zur Wiedergabe, nicht zur Zeile
 *    (der Zeilen-Knopf schlug zudem fehl, sobald die Position nicht in
 *    SEINER Zeile lag — eine reine Verwirrungsquelle).
 * 3. Abspielen/Pause als EIN umschaltender Knopf; „−5 s"/„+5 s" kompakt
 *    (volle Beschriftung im aria-label).
 * 4. Statt des einen Knopfs „Position als Start/Ende übernehmen" (dessen
 *    Ziel unsichtbar am zuletzt fokussierten Feld hing) je ein eigener
 *    „Position"-Knopf direkt neben jedem Feld.
 * 5. Zeitleiste steht ÜBER der Abschnittsliste (primäres Element wie in
 *    Schnittprogrammen); Keyframe-Hinweis als schlichte Textzeile.
 *
 * Kostensicherheit (Plan-Vorgabe, unverändert wichtig): diese Datei
 * importiert `useBunnyUpload` NIE. Das fertige (ggf. geschnittene) Blob geht
 * ausschließlich über `onConfirm` nach oben.
 *
 * FILMSTREIFEN (18.07.2026, Josips Wunsch): die Zeitleiste zeigt jetzt echte
 * Video-Vorschaubilder statt reiner Farbflächen — siehe `lib/video/filmstrip.ts`
 * für die Extraktion (bewusst OHNE ffmpeg/Seek, siehe dortiger Kommentar).
 * Zusammen damit: `formatDuration()` (ganze Sekunden) ist innerhalb dieser
 * Datei durch `formatDurationPrecise()` (Zehntelsekunden) ersetzt — sonst
 * hätte man zwei sichtbar unterschiedliche Frames im Filmstreifen ausgewählt,
 * aber identische "00:01" in den Feldern gesehen (genau der Fund, der zu
 * dieser Änderung geführt hat).
 */

const RESULT_TOLERANCE_S = 1;
const SKIP_SECONDS = 5;
const FILMSTRIP_THUMB_COUNT = 24;

function buildResultMessage(requestedTotalS: number, actualTotalS: number): string {
  const deltaS = actualTotalS - requestedTotalS;
  if (Math.abs(deltaS) < RESULT_TOLERANCE_S) {
    return `Zuschnitt angewendet — Gesamtlänge ${formatDurationPrecise(actualTotalS)}, wie angefordert.`;
  }
  const richtung = deltaS > 0 ? "länger" : "kürzer";
  return (
    `Zuschnitt angewendet — tatsächliche Länge ${formatDurationPrecise(actualTotalS)} ` +
    `(angefordert ${formatDurationPrecise(requestedTotalS)}, ${Math.abs(deltaS).toFixed(1)} s ${richtung} durch ` +
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
 *
 * Filmstreifen (18.07.2026): echte Frame-Vorschaubilder (`thumbnails`, von
 * `VideoTrimmer` per `extractFilmstrip()` befüllt) bilden die unterste Ebene,
 * halbtransparente Behalten-/Entfernt-Einfärbung liegt DARÜBER (Frame bleibt
 * durch die Einfärbung hindurch erkennbar) — genau das gewünschte "sofort
 * sehen, welcher Frame ausgewählt ist". Fehlende Slots (noch nicht extrahiert)
 * zeigen eine neutrale Fläche statt einer Lücke.
 */
function TimelineBar({
  segments,
  durationS,
  currentPositionS,
  thumbnails,
  onSetBound,
  onSeek,
}: {
  segments: Segment[];
  durationS: number;
  currentPositionS: number;
  thumbnails: (string | null)[];
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
    const seg = segments.find((s) => s.id === id);
    if (!seg) return;
    // Grenzen können sich beim Ziehen nicht mehr kreuzen (Josips
    // Screenshot-Fund, 18.07.2026: Start 00:01/Ende 00:00 → der Abschnitt
    // fiel aus der Normalisierung, alles erschien „entfernt", Gesamtlänge
    // 00:00, ohne erkennbaren Grund). Der Griff klemmt an der Gegen-Grenze
    // mit `MIN_SEGMENT_LENGTH_S` Mindestabstand — exakt das Verhalten
    // echter Schnittprogramme.
    //
    // BUGFIX (Code-Review, 18.07.2026): zusätzlich an NACHBARSEGMENTEN
    // klemmen (`neighborBounds`), nicht nur an der eigenen Gegen-Grenze.
    // Ohne das ließ sich ein Griff über eine Lücke hinweg in ein
    // Nachbarsegment ziehen — `normalizeSegments()` merged bei echter
    // Überlappung still, ein bereits gesetzter Schnitt zwischen den beiden
    // Segmenten verschwand dabei kommentarlos.
    const { minStartS, maxEndS } = neighborBounds(segments, id, durationS);
    const raw = timeFromClientX(e.clientX);
    const valueS =
      bound === "start"
        ? Math.min(Math.max(raw, minStartS), Math.max(minStartS, seg.endS - MIN_SEGMENT_LENGTH_S))
        : Math.min(Math.max(raw, seg.startS + MIN_SEGMENT_LENGTH_S), Math.min(durationS, maxEndS));
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

  const filmstripStarted = thumbnails.some((t) => t !== null);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-[13px] font-bold" style={{ color: "#3E3F66" }}>
        <span aria-hidden="true">Zeitleiste — Linien ziehen zum Anpassen, Klicken zum Springen</span>
        {!filmstripStarted && (
          <span aria-hidden="true" className="font-semibold" style={{ color: "#A9AAC4" }}>
            Filmstreifen wird erstellt …
          </span>
        )}
      </div>
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        aria-hidden="true"
        className="relative h-16 cursor-pointer select-none"
        style={{ touchAction: "none" }}
      >
        {/* Filmstreifen — unterste Ebene, ein Frame je Slot. */}
        <div
          className="absolute inset-x-0 top-1/2 flex h-10 -translate-y-1/2 overflow-hidden rounded-lg border"
          style={{ borderColor: "#E7E8F2" }}
        >
          {thumbnails.map((dataUrl, i) => (
            <div
              key={i}
              className="h-full flex-1"
              style={{
                backgroundColor: "#EEF0F7",
                backgroundImage: dataUrl ? `url(${dataUrl})` : undefined,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          ))}
        </div>

        {/* Behalten-/Entfernt-Einfärbung — halbtransparent, damit der Frame
            darunter erkennbar bleibt (anders als vorher: keine Deckfarbe mehr). */}
        <div className="absolute inset-x-0 top-1/2 flex h-10 -translate-y-1/2 overflow-hidden rounded-lg">
          {blocks.map((b, i) =>
            b.widthPct <= 0 ? null : (
              <div
                key={i}
                style={{
                  flex: `${b.widthPct} 1 0%`,
                  background:
                    b.kind === "keep"
                      ? "rgba(86,99,174,0.4)"
                      : "repeating-linear-gradient(45deg, rgba(20,20,36,0.6) 0 6px, rgba(20,20,36,0.4) 6px 12px)",
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
            className="absolute top-0 h-full w-4 -translate-x-1/2 cursor-ew-resize"
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
            className="absolute top-0 h-full w-4 -translate-x-1/2 cursor-ew-resize"
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
          <span className="h-3.5 w-3.5 rounded" style={{ background: "#7079BE" }} />
          Behalten
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-3.5 w-3.5 rounded"
            style={{ background: "repeating-linear-gradient(45deg, #3A3A50 0 4px, #2A2A3D 4px 8px)" }}
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
  durationS,
  neighborBounds: bounds,
  videoRef,
  onSetBound,
  onRemove,
  canRemove,
}: {
  segment: Segment;
  index: number;
  durationS: number;
  /** Grenzen des vorherigen/nächsten Segments — siehe `applyBound()` unten. */
  neighborBounds: { minStartS: number; maxEndS: number };
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onSetBound: (id: string, bound: "start" | "end", valueS: number) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}) {
  const [startText, setStartText] = useState(() => formatDurationPrecise(segment.startS));
  const [endText, setEndText] = useState(() => formatDurationPrecise(segment.endS));
  const [fieldError, setFieldError] = useState("");

  /**
   * BUGFIX (Code-Review, 18.07.2026): eine `role="alert"`-Region sagt nur
   * bei einer echten DOM-Textänderung an. Tippt der Nutzer zweimal
   * hintereinander einen ungültigen Wert (oder erzeugt zweimal denselben
   * Überlappungs-Konflikt), ist der zweite Fehlertext identisch zum ersten
   * — React mutiert den Text-Node dann nicht, ein Screenreader-Nutzer hört
   * NICHTS und hält die zweite Eingabe für akzeptiert (das Feld wird dabei
   * still auf den alten Wert zurückgesetzt). Erst leeren, dann im nächsten
   * Tick setzen erzwingt bei jedem Aufruf eine echte Textänderung.
   */
  function announceFieldError(text: string) {
    setFieldError("");
    setTimeout(() => setFieldError(text), 0);
  }

  // Text-Felder mit dem tatsächlichen Wert synchron halten, wenn er sich
  // von AUSSEN ändert (Position-Knopf, Ziehen in der Zeitleiste, Teilen) —
  // läuft nur bei einer echten Wertänderung, nicht bei jedem Render, damit
  // eine laufende Eingabe (vor dem onBlur-Commit) nie überschrieben wird.
  // `setTimeout(…, 0)` statt direkt im Effect-Body: gleiches Muster wie
  // `SaveIndicator`/`stoppedUrl` in `video-recorder.tsx`
  // (react-hooks/set-state-in-effect erzwingt sonst einen zusätzlichen
  // Render direkt nach diesem) — Verhalten für Nutzer unverändert.
  useEffect(() => {
    const timer = setTimeout(() => setStartText(formatDurationPrecise(segment.startS)), 0);
    return () => clearTimeout(timer);
  }, [segment.startS]);
  useEffect(() => {
    const timer = setTimeout(() => setEndText(formatDurationPrecise(segment.endS)), 0);
    return () => clearTimeout(timer);
  }, [segment.endS]);

  /**
   * Gemeinsamer Übernahme-Pfad für getippte Werte UND die „Position"-Knöpfe.
   * VALIDIERT statt still zu clampen (anders als das Ziehen in der
   * Zeitleiste): ein getippter Start hinter dem Ende ist fast immer ein
   * Versehen — oder die Absicht, ZUERST das Ende zu verschieben. Eine klare
   * Meldung plus Zurücksetzen des Felds erklärt das; stilles Umbiegen auf
   * `endS − 0,1` würde einen nie eingegebenen Wert erzeugen. Werte über der
   * Videolänge werden dagegen stillschweigend gekappt (die Absicht „bis zum
   * Schluss" ist eindeutig).
   *
   * BUGFIX (Code-Review, 18.07.2026), zwei Funde:
   * 1. Prüfte bisher NUR gegen die eigene Gegen-Grenze, nie gegen
   *    Nachbarsegmente (`bounds`, von der übergeordneten Komponente per
   *    `neighborBounds()` berechnet) — ein Wert konnte dadurch über eine
   *    Lücke hinweg in ein Nachbarsegment hineinragen. `normalizeSegments()`
   *    merged bei echter Überlappung still, ein bereits gesetzter Schnitt
   *    zwischen den beiden Segmenten verschwand dabei kommentarlos — und
   *    zwar genau über den Tastatur-/„Position"-Pfad, den diese
   *    Umgestaltung eigentlich als verlässlich auszeichnen sollte.
   * 2. Der Erfolgspfad schrieb den Feldtext nie zurück — nur die
   *    Sync-Effekte oben taten das, und die feuern NICHT, wenn der gekappte
   *    Wert zufällig dem bisherigen entspricht (z. B. Ende auf einen Wert
   *    über der Videolänge getippt → kappt auf `durationS`, das aber schon
   *    der bisherige Wert war). Das Feld zeigte dann dauerhaft den nie
   *    übernommenen getippten Text an. Jetzt schreibt der Erfolgspfad IMMER
   *    den kanonischen, formatierten Wert zurück — kanonisiert nebenbei
   *    auch uneinheitliche Eingaben wie „10:00" zu „10:00.0".
   */
  function applyBound(bound: "start" | "end", rawS: number) {
    const clamped = Math.min(Math.max(rawS, 0), durationS);
    if (bound === "start") {
      const min = Math.max(0, bounds.minStartS);
      const max = segment.endS - MIN_SEGMENT_LENGTH_S;
      if (clamped > max) {
        announceFieldError("Start muss vor dem Ende liegen — zuerst das Ende nach hinten verschieben.");
        setStartText(formatDurationPrecise(segment.startS));
        return;
      }
      if (clamped < min) {
        announceFieldError("Start würde den vorherigen Abschnitt überlappen.");
        setStartText(formatDurationPrecise(segment.startS));
        return;
      }
      setFieldError("");
      setStartText(formatDurationPrecise(clamped));
      onSetBound(segment.id, "start", clamped);
      return;
    }
    const min = segment.startS + MIN_SEGMENT_LENGTH_S;
    const max = Math.min(durationS, bounds.maxEndS);
    if (clamped < min) {
      announceFieldError("Ende muss nach dem Start liegen — zuerst den Start nach vorn verschieben.");
      setEndText(formatDurationPrecise(segment.endS));
      return;
    }
    if (clamped > max) {
      announceFieldError("Ende würde den nächsten Abschnitt überlappen.");
      setEndText(formatDurationPrecise(segment.endS));
      return;
    }
    setFieldError("");
    setEndText(formatDurationPrecise(clamped));
    onSetBound(segment.id, "end", clamped);
  }

  function commit(bound: "start" | "end") {
    const parsed = parseTimecode(bound === "start" ? startText : endText);
    if (parsed === null) {
      announceFieldError("Ungültige Zeit — Format mm:ss oder mm:ss.f verwenden.");
      if (bound === "start") setStartText(formatDurationPrecise(segment.startS));
      else setEndText(formatDurationPrecise(segment.endS));
      return;
    }
    applyBound(bound, parsed);
  }

  function takePosition(bound: "start" | "end") {
    const video = videoRef.current;
    if (!video) return;
    applyBound(bound, video.currentTime);
  }

  const positionButtonClass =
    "inline-flex items-center gap-1 rounded-[10px] border bg-white px-2.5 py-2.5 text-[13px] font-semibold";

  return (
    <li className="rounded-xl border p-4" style={{ borderColor: "#EEF0F7" }}>
      <div className="flex flex-wrap items-end gap-3">
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
            placeholder="mm:ss.f"
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={() => commit("start")}
            className="w-24 rounded-[10px] border px-3 py-2.5 text-base tabular-nums"
            style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
          />
        </label>
        <button
          type="button"
          onClick={() => takePosition("start")}
          title="Start auf aktuelle Wiedergabeposition setzen"
          aria-label={`Start von Abschnitt ${index + 1} auf die aktuelle Wiedergabeposition setzen`}
          className={positionButtonClass}
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <LocateFixed size={13} aria-hidden="true" />
          Position
        </button>

        <label className="ml-2 flex flex-col gap-1.5 text-[13px] font-bold" style={{ color: "#3E3F66" }}>
          {`Ende (Abschnitt ${index + 1})`}
          <input
            type="text"
            inputMode="numeric"
            placeholder="mm:ss.f"
            value={endText}
            onChange={(e) => setEndText(e.target.value)}
            onBlur={() => commit("end")}
            className="w-24 rounded-[10px] border px-3 py-2.5 text-base tabular-nums"
            style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
          />
        </label>
        <button
          type="button"
          onClick={() => takePosition("end")}
          title="Ende auf aktuelle Wiedergabeposition setzen"
          aria-label={`Ende von Abschnitt ${index + 1} auf die aktuelle Wiedergabeposition setzen`}
          className={positionButtonClass}
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <LocateFixed size={13} aria-hidden="true" />
          Position
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => onRemove(segment.id)}
          disabled={!canRemove}
          title={canRemove ? undefined : "Mindestens ein Abschnitt muss erhalten bleiben."}
          aria-label={`Abschnitt ${index + 1} entfernen`}
          className="inline-flex items-center gap-1.5 rounded-[10px] border bg-white px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
          style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
        >
          <Trash2 size={14} aria-hidden="true" />
          Entfernen
        </button>
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
  // Für den EINEN umschaltenden Abspielen/Pause-Knopf — gespeist aus den
  // play/pause-Events des Video-Elements selbst (nicht aus dem Klick), damit
  // der Knopf auch stimmt, wenn der Browser die Wiedergabe von sich aus
  // beendet (Video zu Ende, Hintergrund-Tab).
  const [isPlaying, setIsPlaying] = useState(false);
  // Tastatur-Äquivalent zum Klick-zum-Springen in der (aria-hidden) Zeitleiste
  // (Code-Review-Fund, 18.07.2026: ohne dieses Feld gab es KEINEN
  // nicht-visuellen Weg, gezielt eine bestimmte Position anzusteuern — nur
  // Abspielen+Timing nach Gehör). Eigenes Feld statt Wiederverwendung der
  // Positionsanzeige, da diese nur ANZEIGT, während dieses Feld eine
  // EINGABE ist.
  const [seekToText, setSeekToText] = useState("");
  const [seekError, setSeekError] = useState("");
  const [thumbnails, setThumbnails] = useState<(string | null)[]>(() =>
    new Array(FILMSTRIP_THUMB_COUNT).fill(null),
  );

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

  // Filmstreifen (siehe lib/video/filmstrip.ts) — eigenes, verstecktes
  // Video-Element, unabhängig von der sichtbaren Vorschau oben. `blob`/
  // `durationS` ändern sich über die Lebensdauer EINER VideoTrimmer-Instanz
  // nie (video-recorder.tsx setzt keinen `key`, ruft nie mit neuem Blob
  // erneut auf, solange die Phase "trimming" bleibt) — der Anfangswert von
  // `thumbnails` (alles `null`) deckt den Start deshalb bereits ab, ein
  // zusätzliches Zurücksetzen hier wäre nicht nur unnötig, sondern liefe
  // Gefahr, ein bereits eingetroffenes erstes Vorschaubild wieder zu
  // überschreiben (Reihenfolge zwischen Reset und erstem Callback nicht
  // garantiert). `setThumbnails` mit funktionalem Updater, damit einzelne
  // Slots eintreffen können, ohne vorherige zu überschreiben.
  useEffect(() => {
    if (tooLargeToTrim || durationS <= 0) return;
    const { cancel } = extractFilmstrip(blob, durationS, FILMSTRIP_THUMB_COUNT, ({ index, dataUrl }) => {
      setThumbnails((prev) => {
        const next = prev.slice();
        next[index] = dataUrl;
        return next;
      });
    });
    return cancel;
  }, [blob, durationS, tooLargeToTrim]);

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
  function handleSplitAtPosition() {
    const video = videoRef.current;
    if (!video) return;
    const atS = video.currentTime;
    // Das zu teilende Segment ergibt sich aus der Wiedergabeposition selbst —
    // der frühere „Abschnitt teilen"-Knopf PRO ZEILE hat genau das
    // verschleiert (er schlug fehl, sobald die Position nicht in SEINER
    // Zeile lag). `splitSegment()` prüft den Mindestabstand zu den Grenzen
    // und gibt bei Ablehnung dieselbe Referenz zurück.
    const target = segments.find((s) => atS >= s.startS && atS <= s.endS);
    const next = target ? splitSegment(segments, target.id, atS, [nextId(), nextId()]) : segments;
    if (next === segments) {
      setAlertMessage(
        `Die Wiedergabeposition (${formatDurationPrecise(atS)}) liegt in einem entfernten Bereich oder zu nah ` +
          "an einem bestehenden Schnitt — per Abspielen, ±5 s oder Klick in die Zeitleiste erst dorthin gelangen.",
      );
      return;
    }
    setSegments(next);
    setAlertMessage("");
    setStatusMessage(`Abschnitt bei ${formatDurationPrecise(atS)} geteilt.`);
  }

  function handleRemove(id: string) {
    if (segments.length <= 1) return;
    // BUGFIX (Code-Review, 18.07.2026), zwei Funde:
    // 1. Der entfernte Zeile-<li> enthält den gerade fokussierten
    //    „Entfernen"-Knopf — React unmountet ihn mit, der Browser wirft den
    //    Fokus auf <body>, der nächste Tab beginnt am Dokumentanfang.
    //    Fokus geht deshalb explizit auf die (immer vorhandene, bereits
    //    beim Mounten genutzte) Überschrift zurück.
    // 2. Ein statischer Text „Abschnitt entfernt." wird bei ZWEI
    //    aufeinanderfolgenden Entfernungen für eine `role="status"`-Region
    //    nicht erneut angesagt (identischer Text → keine DOM-Mutation).
    //    Die verbleibende Anzahl macht den Text zwischen aufeinander-
    //    folgenden Entfernungen zuverlässig unterschiedlich (sie sinkt jedes
    //    Mal) und liefert nebenbei nützlichen Kontext.
    const removedIndex = orderedSegments.findIndex((s) => s.id === id);
    const remaining = segments.length - 1;
    setSegments(removeSegment(segments, id));
    setStatusMessage(
      `Abschnitt ${removedIndex + 1} entfernt — ${remaining} ${remaining === 1 ? "Abschnitt verbleibt" : "Abschnitte verbleiben"}.`,
    );
    headingRef.current?.focus();
  }

  function skip(deltaS: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(video.currentTime + deltaS, 0), durationS);
  }

  function handleSeekToTime(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseTimecode(seekToText);
    if (parsed === null) {
      setSeekError("Ungültige Zeit — Format mm:ss oder mm:ss.f verwenden.");
      return;
    }
    const video = videoRef.current;
    if (video) video.currentTime = Math.min(Math.max(parsed, 0), durationS);
    setSeekError("");
  }

  async function handleApply() {
    if (normalized.length === 0) {
      setAlertMessage("Mindestens ein Abschnitt muss erhalten bleiben. Bitte zuerst einen Abschnitt anpassen.");
      return;
    }
    setAlertMessage("");

    // BUGFIX (23.07.2026, Josips Meldung "Lektion zeigt nur Processing"): die
    // alte Abkürzung ließ bei "keine echte Änderung" das Original-Blob
    // KOMPLETT an ffmpeg vorbei nach oben laufen. Genau dieses rohe
    // MediaRecorder-Webm (Blocker B7, keine Duration/Cues im Header) blieb
    // bei Bunny teils dauerhaft im Encoding hängen. remuxFix() läuft deshalb
    // jetzt IMMER — auch ohne echten Schnitt —, nur cutAndConcat() wird für
    // diesen Fall übersprungen. Das unterläuft die alte, oben im Dateikopf
    // dokumentierte Verifikationsvorgabe ("Null-Edit lädt ffmpeg NICHT"),
    // aber Korrektheit des Uploads wiegt hier schwerer als der vermiedene
    // ffmpeg-Ladevorgang. Gilt NUR für diesen Zweig (blob ist hier laut
    // `tooLargeToTrim`-Gate oben immer ≤ TRIM_SIZE_LIMIT_BYTES) — der
    // separate "zu groß zum Zuschneiden"-Weg (`handleUseWithoutTrim`) bleibt
    // bewusst unverändert, siehe Kommentar dort.
    const noRealChange = normalized.length === 1 && coversFullDuration(normalized, durationS);

    setBusy(true);
    setProgressPercent(0);
    try {
      setStatusMessage("Video wird vorbereitet …");
      const { remuxFix, cutAndConcat } = await import("@/lib/video/ffmpeg-client");
      const fixed = await remuxFix(blob, setProgressPercent);

      if (noRealChange) {
        onConfirm(fixed, durationS);
        return;
      }

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

  // Bewusst OHNE remuxFix() (anders als der "keine echte Änderung"-Zweig in
  // handleApply, siehe Kommentar dort): `blob` ist hier per `tooLargeToTrim`
  // > TRIM_SIZE_LIMIT_BYTES (300 MB) — genau die Größe, ab der ffmpeg.wasm
  // (single-threaded, Hauptspeicher, Plan-Risiko R6) beim Laden der Datei in
  // MEMFS den Tab zum Absturz bringen kann. Das rohe Webm geht hier also
  // weiterhin ungefixt hoch; das Restrisiko "bleibt bei Bunny im Encoding
  // hängen" ist bei diesen Größen (in der Praxis kaum erreichbar, siehe
  // HARD_LIMIT_S × VIDEO_BITS_PER_SECOND in recorder.ts) bewusst in Kauf
  // genommen statt eines Browser-Absturzes.
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
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          className="aspect-[16/9] w-full bg-black object-contain"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {/* EIN umschaltender Abspielen/Pause-Knopf statt zwei — der jeweils
            sinnlose Knopf („Pause" bei stehendem Video) entfällt. Feste
            Mindestbreite, damit der Wechsel der Beschriftung die Leiste
            nicht springen lässt. */}
        <button
          type="button"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            if (video.paused) video.play().catch(() => {});
            else video.pause();
          }}
          className="inline-flex min-w-[126px] items-center justify-center gap-2 rounded-[10px] border bg-white px-4 py-2 text-sm font-bold"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          {isPlaying ? "Pause" : "Abspielen"}
        </button>
        <button
          type="button"
          onClick={() => skip(-SKIP_SECONDS)}
          aria-label="5 Sekunden zurück"
          className="inline-flex items-center rounded-[10px] border bg-white px-4 py-2 text-sm font-bold tabular-nums"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          −5 s
        </button>
        <button
          type="button"
          onClick={() => skip(SKIP_SECONDS)}
          aria-label="5 Sekunden vor"
          className="inline-flex items-center rounded-[10px] border bg-white px-4 py-2 text-sm font-bold tabular-nums"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          +5 s
        </button>
        {/* BUGFIX (Code-Review, 18.07.2026, hohe Schwere): NICHT mehr
            aria-hidden. Diese Zeile ist keine Live-Region (keine
            automatischen Ansagen, kein Flooding-Risiko) — aber vorher war
            sie die EINZIGE Positionsanzeige der gesamten Komponente UND
            komplett aus dem Accessibility-Tree entfernt. Ein Screenreader-
            Nutzer hatte dadurch keinerlei Möglichkeit zu erfahren, wo der
            Abspielkopf steht, bevor er „Position" oder „Hier schneiden"
            auslöst — beide Aktionen setzen genau diese Kenntnis voraus. Jetzt
            im Browse-Modus jederzeit auf Nachfrage lesbar. */}
        <span className="text-sm font-semibold tabular-nums" style={{ color: "#66679B" }}>
          Wiedergabeposition {formatDurationPrecise(currentPositionS)} von {formatDurationPrecise(durationS)}
        </span>
        <div className="flex-1" />
        {/* DER Schnitt-Knopf — global an der Wiedergabeposition, siehe
            Dateikopf (VEREINFACHUNG Punkt 2). Rechtsbündig und farblich
            abgesetzt: das ist die zentrale Editier-Aktion dieser Leiste. */}
        <button
          type="button"
          onClick={handleSplitAtPosition}
          disabled={busy}
          // BUGFIX (Code-Review, 18.07.2026, WCAG 2.5.3 „Label in Name"):
          // aria-label MUSS den sichtbaren Text enthalten — sonst matcht
          // Sprachsteuerung ("Klicke Hier schneiden") den Knopf nicht, und
          // ein Screenreader-Nutzer hört einen anderen Namen, als ein
          // sehender Kollege vorliest.
          aria-label="Hier schneiden — Video an der aktuellen Wiedergabeposition in zwei Abschnitte teilen"
          className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-4 py-2 text-sm font-bold disabled:opacity-50"
          style={{ borderColor: "#5663AE", color: "#5663AE" }}
        >
          <Scissors size={14} aria-hidden="true" />
          Hier schneiden
        </button>
      </div>

      {/* Tastatur-Äquivalent zum (mausbedienten) Klick-zum-Springen in der
          Zeitleiste (Code-Review-Fund, 18.07.2026, hohe Schwere): ohne dieses
          Feld gab es keinen nicht-visuellen Weg, gezielt eine bestimmte
          Position anzusteuern. */}
      <form onSubmit={handleSeekToTime} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] font-bold" style={{ color: "#3E3F66" }}>
          Position ansteuern
          <input
            type="text"
            inputMode="numeric"
            placeholder="mm:ss.f"
            value={seekToText}
            onChange={(e) => setSeekToText(e.target.value)}
            className="w-28 rounded-[10px] border px-3 py-2.5 text-base tabular-nums"
            style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
          />
        </label>
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-4 py-2.5 text-sm font-bold"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <LocateFixed size={14} aria-hidden="true" />
          Springen
        </button>
        {seekError && (
          <p role="alert" className="text-sm font-bold" style={{ color: "#B14A4A" }}>
            {seekError}
          </p>
        )}
      </form>

      <div className="flex flex-col gap-3.5 rounded-2xl border p-4" style={{ borderColor: "#EEF0F7" }}>
        {/* Zeitleiste ZUERST — das primäre Element wie in Schnittprogrammen
            (VEREINFACHUNG Punkt 5). Für Screenreader unsichtbar
            (aria-hidden in TimelineBar), deren Lesefluss beginnt also
            unverändert bei der Überschrift darunter. */}
        <TimelineBar
          segments={segments}
          durationS={durationS}
          currentPositionS={currentPositionS}
          thumbnails={thumbnails}
          onSetBound={handleSetBound}
          onSeek={(valueS) => {
            const video = videoRef.current;
            if (video) video.currentTime = valueS;
          }}
        />

        <div className="flex items-center gap-2.5">
          <span className="h-[22px] w-1 rounded-[3px]" style={{ background: "#5663AE" }} />
          <h4 className="text-[17px] font-extrabold" style={{ color: "#1A1A2E" }}>
            Behaltene Abschnitte
          </h4>
        </div>

        <ul className="flex flex-col gap-3.5">
          {orderedSegments.map((segment, index) => (
            <SegmentRow
              key={segment.id}
              segment={segment}
              index={index}
              durationS={durationS}
              neighborBounds={neighborBounds(segments, segment.id, durationS)}
              videoRef={videoRef}
              onSetBound={handleSetBound}
              onRemove={handleRemove}
              canRemove={segments.length > 1}
            />
          ))}
        </ul>

        <p className="text-[13px] font-semibold" style={{ color: "#66679B" }}>
          Schnitte erfolgen am nächsten Keyframe (bis ~2 Sekunden Abweichung) — dafür ohne Qualitätsverlust.
        </p>

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
            {formatDurationPrecise(resultingDurationS)}
          </span>
        </div>
        <div className="flex-1" />
        {/* Reihenfolge nach Gewicht: Abbrechen (verwirft) links, dann der
            Ausweichweg, ganz rechts die primäre Aktion. Deren Symbol ist
            jetzt ein Häkchen — die Schere gehört eindeutig zu „Hier
            schneiden" in der Wiedergabeleiste, zwei Scheren-Knöpfe mit
            verschiedener Bedeutung wären eine Verwechslungsfalle. */}
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
          <Check size={16} aria-hidden="true" />
          {busy ? "Wird geschnitten …" : "Zuschnitt übernehmen"}
        </button>
      </div>
    </div>
  );
}
