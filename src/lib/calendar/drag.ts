/**
 * Reine Hilfsfunktionen für die Freelancer-Drag-Geste im Wochenraster
 * (Block S6, 09.08.2026 — "Freelancer-Drag-and-Drop im Wochenraster",
 * architect-Plan `plane-und-erstelle-mit-floofy-curry.md`). Bewusst OHNE
 * jede Pointer-Event-Abhängigkeit — isoliert testbar (`drag.test.ts`), ohne
 * Pointer-Events simulieren zu müssen (gleiches Trennungsprinzip wie
 * `src/lib/video/segments.ts` neben `video-trimmer.tsx`).
 *
 * Wiederverwendet in `shift-calendar-view.tsx` für zwei Gesten:
 * 1. Ziehen innerhalb eines offenen Zeitfensters — wählt einen Teil-Zeitraum
 *    für eine Selbstbuchung (`bookOwnShift()` mit `startTime`/`endTime`).
 * 2. Ziehen (verschieben/Rand ziehen) einer eigenen bestehenden Schicht —
 *    füllt nur das bestehende "Zeit ändern"-Formular vor
 *    (`onProposeChange`), schreibt NICHTS direkt in die Datenbank.
 */

/** Rundet auf die nächste volle Viertelstunde (0/15/30/45) — Standard-Snap-Raster für Zeit-Drags. */
export function snapToQuarterHour(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

/**
 * Klammert einen Zeitbereich [start, end] auf `bounds` — verschiebt dabei den
 * GESAMTEN Bereich (Dauer bleibt erhalten), statt nur die überstehende
 * Grenze hart zu kappen. Passend sowohl für "verschieben" (Dauer bleibt fix,
 * eigene Schicht) als auch für eine Teil-Auswahl innerhalb eines Slots (dort
 * ist die gewählte Dauer bereits vom Ziehen selbst bestimmt). Ist die Dauer
 * größer als der verfügbare Bereich in `bounds`, wird am Ende zusätzlich hart
 * auf `bounds` gekappt — die Dauer schrumpft dann zwangsläufig.
 */
export function clampRange(
  start: number,
  end: number,
  bounds: { min: number; max: number },
): { start: number; end: number } {
  const duration = end - start;
  let clampedStart = start;
  let clampedEnd = end;

  if (clampedStart < bounds.min) {
    clampedStart = bounds.min;
    clampedEnd = clampedStart + duration;
  }
  if (clampedEnd > bounds.max) {
    clampedEnd = bounds.max;
    clampedStart = clampedEnd - duration;
  }

  // Letzte Absicherung, falls die Dauer selbst größer als bounds.max-bounds.min ist
  // (dann reicht die reine Verschiebung oben allein nicht aus).
  clampedStart = Math.max(clampedStart, bounds.min);
  clampedEnd = Math.min(clampedEnd, bounds.max);
  return { start: clampedStart, end: clampedEnd };
}

/**
 * Rechnet eine Pointer-Y-Position (Pixel, relativ zum oberen Rand des
 * Stunden-Rasters/der Tagesspalte) in Minuten seit Mitternacht um —
 * Umkehrung der `top`/`height`-Positionierungsformel in
 * `shift-calendar-view.tsx` (`HOUR_ROW_HEIGHT_PX` Pixel je Stunde, Raster
 * beginnt bei `rangeStartHour`).
 */
export function minutesFromPointerY(relativeY: number, rangeStartHour: number, rowHeightPx: number): number {
  return rangeStartHour * 60 + (relativeY / rowHeightPx) * 60;
}
