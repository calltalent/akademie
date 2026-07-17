/**
 * Reine, testbare Segment-Mathematik für den Video-Trimmer (Kurs-Editor,
 * Stufe 2 „Schnitt" — Plan `calm-watching-dewdrop.md`). Kein DOM-/ffmpeg-
 * Zugriff hier (Muster wie `src/lib/video/recorder.ts`/`vtt-cues.ts`): alle
 * Funktionen nehmen ihre Eingaben als Parameter und sind ohne Browser unter
 * Vitest testbar. Die ffmpeg.wasm-Ausführung lebt in `ffmpeg-client.ts`, die
 * UI in `src/components/editor/video-trimmer.tsx`.
 *
 * MODELL (Plan): Liste zu BEHALTENDER Abschnitte `{id, startS, endS}`,
 * initial genau ein Segment über die volle Dauer. „Mittelschnitt" entsteht
 * durch zweimaliges Teilen (an beiden Grenzen des zu entfernenden Stücks)
 * gefolgt von `removeSegment()` auf dem mittleren Teilstück. „Mehrere Clips"
 * ist einfach das Endergebnis mehrerer Teilungen/Entfernungen — ein Modell
 * für beide Anforderungen, mappt 1:1 auf `-ss/-to` + concat in
 * `ffmpeg-client.ts`.
 */

export interface Segment {
  id: string;
  startS: number;
  endS: number;
}

/** Mindestlänge eines Segments nach einer Teilung — verhindert Nulllängen-Splitter durch Doppelklicks/Rundungsfehler. */
export const MIN_SEGMENT_LENGTH_S = 0.1;

/** Toleranz für Fließkomma-/Messungenauigkeit bei „deckt die volle Dauer ab?"-Prüfungen. */
export const DEFAULT_COVERAGE_TOLERANCE_S = 0.5;

/** Größen-Gate (Plan-Risiko R6): über dieser Blob-Größe wird der Schnitt im Browser deaktiviert (ffmpeg.wasm läuft single-threaded im Hauptspeicher). */
export const TRIM_SIZE_LIMIT_BYTES = 300 * 1024 * 1024;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Initialzustand: ein einziges Segment über die volle (gemessene) Aufnahmedauer. */
export function createInitialSegments(durationS: number, id = "seg-0"): Segment[] {
  return [{ id, startS: 0, endS: Math.max(0, durationS) }];
}

/**
 * Sortiert nach Startzeit — reine Anzeige-/Nummerierungsreihenfolge für die
 * `<ul>`-Liste. Filtert/verändert NICHTS (anders als `normalizeSegments`),
 * damit eine gerade bearbeitete Zeile beim Sortieren nie verschwindet.
 */
export function sortSegments(segments: Segment[]): Segment[] {
  return [...segments].sort((a, b) => a.startS - b.startS || a.endS - b.endS);
}

/**
 * Normalisiert eine rohe Segmentliste für Berechnungen/den tatsächlichen
 * Schnitt: Grenzen auf [0, durationS] kappen ("Ende > Dauer"), Segmente mit
 * Ende <= Start verwerfen (deckt sowohl Nulllänge als auch „verkehrte
 * Reihenfolge" ab), sortieren, dann ECHT überlappende Segmente
 * zusammenführen.
 *
 * WICHTIG: nur STRIKT überlappende Segmente (nächstes Start < vorheriges
 * Ende) werden gemerged. Exakt aneinanderstoßende Segmente (Start ===
 * vorheriges Ende) bleiben bewusst getrennt — sonst würde das Ergebnis von
 * `splitSegment()` (erzeugt genau zwei aneinanderstoßende Segmente) beim
 * nächsten Normalisieren sofort wieder zu einem einzigen Segment
 * zusammenfallen.
 */
export function normalizeSegments(segments: Segment[], durationS: number): Segment[] {
  const clamped = segments
    .map((s) => ({ id: s.id, startS: clamp(s.startS, 0, durationS), endS: clamp(s.endS, 0, durationS) }))
    .filter((s) => s.endS > s.startS);

  const sorted = sortSegments(clamped);

  const merged: Segment[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.startS < last.endS) {
      last.endS = Math.max(last.endS, s.endS);
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/** Summe der Segmentlängen — für die Fußzeile „Gesamtlänge nach Schnitt". Auf bereits normalisierten Segmenten aufrufen, sonst zählen Überlappungen doppelt. */
export function totalDurationS(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.endS - s.startS), 0);
}

/**
 * Prüft, ob die (bereits normalisierte, sortierte, überlappungsfreie)
 * Segmentliste die volle Dauer [0, durationS] lückenlos abdeckt — Grundlage
 * für die Abkürzung „1 Segment über die volle Länge -> ffmpeg gar nicht
 * laden" in `ffmpeg-client.ts`/`video-trimmer.tsx`. Erwartet normalisierte
 * Eingabe (ruft `normalizeSegments` NICHT selbst auf, um die Kosten einer
 * erneuten Normalisierung nicht bei jedem Aufruf zu verdoppeln).
 */
export function coversFullDuration(
  segments: Segment[],
  durationS: number,
  toleranceS = DEFAULT_COVERAGE_TOLERANCE_S,
): boolean {
  if (segments.length === 0 || durationS <= 0) return false;
  const sorted = sortSegments(segments);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first.startS > toleranceS) return false;
  if (last.endS < durationS - toleranceS) return false;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].startS - sorted[i - 1].endS;
    if (gap > toleranceS) return false;
  }
  return true;
}

/**
 * Teilt das Segment mit `id` an Position `atS` in zwei Segmente
 * (`newIds[0]` = linker Teil, `newIds[1]` = rechter Teil). Kein Effekt
 * (identische Array-Referenz zurückgegeben, damit Aufrufer ein No-Op per
 * `===` erkennen können), wenn:
 * - kein Segment mit `id` existiert,
 * - `atS` nicht mindestens `MIN_SEGMENT_LENGTH_S` von beiden Grenzen entfernt
 *   liegt (verhindert Nulllängen-/Mikro-Segmente).
 */
export function splitSegment(
  segments: Segment[],
  id: string,
  atS: number,
  newIds: readonly [string, string],
): Segment[] {
  const index = segments.findIndex((s) => s.id === id);
  if (index === -1) return segments;
  const target = segments[index];
  if (atS < target.startS + MIN_SEGMENT_LENGTH_S || atS > target.endS - MIN_SEGMENT_LENGTH_S) {
    return segments;
  }
  const left: Segment = { id: newIds[0], startS: target.startS, endS: atS };
  const right: Segment = { id: newIds[1], startS: atS, endS: target.endS };
  const next = [...segments];
  next.splice(index, 1, left, right);
  return next;
}

/** Entfernt ein Segment per `id`. Ob mindestens ein Segment übrig bleiben muss, entscheidet die UI (dort als Button-`disabled`-Zustand), nicht diese reine Funktion. */
export function removeSegment(segments: Segment[], id: string): Segment[] {
  return segments.filter((s) => s.id !== id);
}

/** Setzt Start ODER Ende eines Segments auf einen rohen Sekundenwert — für getippte mm:ss-Felder und „Position übernehmen". Bewusst OHNE Validierung/Clamping (passiert gesammelt in `normalizeSegments`, direkt vor Anzeige/Schnitt), damit ein Zwischenzustand während der Eingabe nicht die Zeile zum Verschwinden bringt. */
export function setSegmentBound(segments: Segment[], id: string, bound: "start" | "end", valueS: number): Segment[] {
  return segments.map((s) => {
    if (s.id !== id) return s;
    return bound === "start" ? { ...s, startS: valueS } : { ...s, endS: valueS };
  });
}

/**
 * Parst ein getipptes Zeitfeld ("mm:ss", "m:ss.s" oder "h:mm:ss") in ganze/
 * gebrochene Sekunden. `null` bei nicht interpretierbarer oder negativer
 * Eingabe — die aufrufende UI behält dann den vorherigen Wert bei, statt
 * einen falschen Wert zu übernehmen.
 */
export function parseTimecode(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;

  const numbers = parts.map(Number);
  const seconds = numbers[numbers.length - 1];
  const minutes = numbers[numbers.length - 2];
  const hours = numbers.length === 3 ? numbers[0] : 0;
  if (seconds >= 60 || minutes >= 60) return null;

  const totalS = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(totalS) && totalS >= 0 ? totalS : null;
}
