"use client";

import { useRef } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { clampRange, minutesFromPointerY, snapToQuarterHour } from "@/lib/calendar/drag";

/**
 * Wochenansicht "Mein Schichtplan" (Block S1, 07.08.2026 — Stunden-Raster
 * am 08.08.2026 auf Josips ausdrücklichen Wunsch nachgezogen: "eine
 * Wochenansicht mit Tagen und Stunden, ähnlich wie ein Kalender, belegte
 * Zeiten in der Projektfarbe hervorgehoben, Zeiten zu denen nicht
 * gearbeitet werden kann hellgrau"; Wochen-Navigation am 09.08.2026 auf
 * Josips Wunsch aus einer eigenen Box darüber IN diese Karte verschoben,
 * rechtsbündig über der letzten Tagesspalte — siehe `weekNav`-Prop unten).
 * Reine Darstellungskomponente, keine eigene Datenabfrage/Datumsrechnung
 * (übernimmt `(portal)/schichtplan/page.tsx`).
 *
 * `"use client"` seit Block S6 (09.08.2026, Freelancer-Drag-and-Drop im
 * Wochenraster — architect-Plan `plane-und-erstelle-mit-floofy-curry.md`):
 * Pointer Events brauchen den Client. WICHTIG — bei fehlenden neuen Props
 * (`openSlots`/`onBookSlot`/`bookingPending`/`onProposeChange`) bleiben DOM
 * und ARIA-Ausgabe dieser Komponente BYTE-IDENTISCH zum Stand vor S6 (siehe
 * Kopfkommentar `ShiftCalendarBoard` für die Nicht-Freelancer-Weiche) — die
 * bestehenden S1/S2/S3-Playwright-Specs (`schichtplan.spec.ts`,
 * `schichtplan-s2.spec.ts`, `schichtplan-s3.spec.ts`) dürfen dadurch NICHT
 * brechen. Neu (nur wenn die jeweiligen Props gesetzt sind):
 * - `openSlots`: offene Zeitfenster werden als zusätzliche, gestrichelte
 *   Blöcke im Raster gerendert (Klick = ganzer Slot, Ziehen = Teil-Zeitraum,
 *   `onBookSlot`).
 * - `onProposeChange`: eigene Schicht-Blöcke werden per Ziehen (verschieben)
 *   oder an den Rändern (Größe ändern) verstellbar — schreibt NICHTS direkt,
 *   ruft nur `onProposeChange(shiftId, startMinutes, endMinutes)` auf, damit
 *   der Aufrufer (`ShiftCalendarBoard`) das bestehende "Zeit ändern"-Formular
 *   vorbefüllt. Unterhalb der Bewegungsschwelle (reiner Klick) passiert
 *   NICHTS — die Schicht-Blöcke hatten vorher kein `onClick`, das bleibt so.
 * Pointer-Muster (`setPointerCapture`/`try-catch`, `touchAction:"none"`,
 * Bewegungsschwelle gegen einen nachlaufenden Klick) 1:1 übernommen aus
 * `src/components/editor/video-trimmer.tsx`.
 *
 * DESIGN (per Vorschau im Chat mit Josip abgestimmt, im Calltalent-Branding
 * — `#5663AE` Primärfarbe, `#F5F6FA` Flächen, `#1A1A2E`/`#66679B` Text):
 * Stunden 06–22 Uhr als Zeilen, sieben Tage als Spalten (dynamisch erweitert,
 * falls eine echte Schicht früher beginnt/später endet als dieser Standard-
 * bereich — siehe `computeHourRange()`). Jede Schicht ist ein proportional
 * positionierter, farbig hinterlegter Block in der Projektfarbe (per
 * `color-mix()` abgetönt, keine feste Palette nötig — Projektfarben sind
 * frei wählbare Hex-Werte, siehe `calendar-projects-panel.tsx`), alle
 * übrigen Stunden bleiben hellgrau ("nicht verfügbar"). So ist auf einen
 * Blick erkennbar, wann eine Schicht beginnt und endet — genau der
 * Auftrag.
 *
 * Barrierefreiheit (CLAUDE.md §3.4, Auftraggeber sehbehindert — die
 * visuelle Zeitachse ist hier selbst die Barrierefreiheits-Verbesserung für
 * ihn):
 * - Farbe ist nie alleiniger Informationsträger — Zeit UND Projektname
 *   stehen als Text direkt im Schicht-Block, zusätzlich eine Legende über
 *   dem Raster (Farbe ↔ Projekt, Grau ↔ nicht verfügbar).
 * - Jede Schicht bleibt ein echtes `<button>` mit demselben sprechenden
 *   `aria-label` wie zuvor ("Montag, 10. August, 08:00 bis 16:00 Uhr,
 *   Projekt Nordwest") — per Tastatur erreichbar, unabhängig von der
 *   absoluten Positionierung (DOM-Reihenfolge bleibt Tab-Reihenfolge).
 * - Die Stunden-Achse links ist rein visuelles Lineal (`aria-hidden`) — die
 *   eigentliche Zeitinformation steht bereits vollständig im Block-Text und
 *   im `aria-label`; eine Screenreader-Ansage von 16 leeren Stunden-Zeilen
 *   pro Tag wäre reines Rauschen, kein Zugewinn.
 * - Eine gleichwertige Listenansicht steht unverändert direkt unter dem
 *   Raster (gleiche Daten, andere Darstellung — kein separater Datenabruf).
 */
export type ShiftCalendarShift = {
  id: string;
  timeRange: string;
  ariaLabel: string;
  projectName: string | null;
  projectColor: string | null;
  status: "planned" | "confirmed" | "cancelled";
  /** Minuten seit Mitternacht (Berlin-lokal), für die proportionale Positionierung im Stunden-Raster. */
  startMinutes: number;
  /**
   * > `startMinutes`. Schichten über Mitternacht hinaus (Nachtschicht) sind
   * hier bereits auf `24*60` gekappt (siehe `(portal)/schichtplan/page.tsx`)
   * — der Block endet sichtbar am Tagesende dieses Tages, die vollständige
   * Zeit bleibt in `timeRange`/`ariaLabel` und der Liste unten erhalten.
   */
  endMinutes: number;
};

export type ShiftCalendarDay = {
  isoDate: string;
  dayLabel: string;
  shortLabel: string;
  isToday: boolean;
  shifts: ShiftCalendarShift[];
};

/**
 * Offenes Zeitfenster als Raster-Block (Block S6, 09.08.2026) — parallel zu
 * `ShiftCalendarShift`, aber für die Selbstbuchungs-Blöcke. `timeRange`/
 * `ariaLabel` werden wie bei `ShiftCalendarShift` bereits fertig formatiert
 * vom Aufrufer übergeben (`(portal)/schichtplan/page.tsx`) — diese
 * Komponente übersetzt selbst nichts. `alreadyBooked` wird von dieser
 * Komponente selbst gefiltert (siehe `bookableOpenSlots` in
 * `ShiftCalendarView`) — ein bereits vom NUTZER SELBST gebuchtes Zeitfenster
 * erscheint sonst als optisch verwirrende Dopplung neben dem echten,
 * bereits gebuchten Schicht-Block UND birgt ein Locator-Kollisionsrisiko in
 * `schichtplan-s2.spec.ts` Fall 4 (dessen `bookedShift`-Regex sonst auch auf
 * einen noch sichtbaren "offen"-Block träfe).
 */
export type ShiftCalendarOpenSlotBlock = {
  id: string;
  isoDate: string;
  startMinutes: number;
  endMinutes: number;
  timeRange: string;
  ariaLabel: string;
  projectName: string;
  capacity: number;
  freeSeats: number;
  alreadyBooked: boolean;
};

/** Wochen-Navigation, rechtsbündig im Kopf dieser Karte gerendert (siehe `ShiftCalendarView`). Gleiche Werte wie zuvor an die eigenständige `ShiftCalendarWeekNav`-Box übergeben — diese Komponente bleibt für die Admin-Ansichten (`calendar-shifts-panel.tsx`/`calendar-slots-panel.tsx`) unverändert bestehen. */
export type ShiftCalendarWeekNavProps = {
  prevHref: string;
  nextHref: string;
  todayHref: string;
  isCurrentWeek: boolean;
  weekLabel: string;
  prevLabel: string;
  nextLabel: string;
  todayLabel: string;
};

const FALLBACK_COLOR = "#5663AE";
const DEFAULT_RANGE_START_HOUR = 6;
const DEFAULT_RANGE_END_HOUR = 22;
const HOUR_ROW_HEIGHT_PX = 44;
/** Farbe der offenen-Zeitfenster-Blöcke (Block S6) — bewusst EINE feste Farbe (Primärfarbe) statt Projektfarbe: die Legende zeigt dafür genau EINEN dritten Punkt, unabhängig davon, aus wie vielen verschiedenen Projekten die offenen Zeitfenster stammen. */
const OPEN_SLOT_COLOR = "#5663AE";
/** Bewegungsschwelle (Pixel) zur Unterscheidung Klick vs. Ziehen — gleiches Prinzip wie `video-trimmer.tsx` (dort über `setTimeout`+`draggingRef`, hier zusätzlich über einen Pixel-Schwellwert, weil hier KEIN separates Klick-Ereignis auf einem Track liegt, sondern derselbe Knopf sowohl Klick als auch Ziehen bedienen muss). */
const DRAG_THRESHOLD_PX = 4;
/** Höhe der Rand-Ziehzonen (oben/unten) an einer eigenen Schicht, mit denen NUR Start bzw. NUR Ende verschoben wird — Rest des Blocks verschiebt Start+Ende gemeinsam ("Körper" = Position ändern). */
const RESIZE_HANDLE_PX = 8;
/** Mindestdauer (Minuten) nach einer Größenänderung — verhindert einen entarteten Null-/Negativ-Bereich beim Ziehen der Ränder. */
const MIN_DURATION_MINUTES = 15;

/** Standardbereich 06–22 Uhr, erweitert um Stunden, in denen eine echte Schicht ODER ein offenes Zeitfenster liegt (nie schmaler als der Standard). `openSlotBlocks` ist ein optionaler zweiter Parameter (Block S6) — ohne Aufrufer, der ihn übergibt, bleibt das Verhalten exakt wie zuvor. */
function computeHourRange(
  days: ShiftCalendarDay[],
  openSlotBlocks: ShiftCalendarOpenSlotBlock[] = [],
): { start: number; end: number } {
  let start = DEFAULT_RANGE_START_HOUR;
  let end = DEFAULT_RANGE_END_HOUR;
  for (const day of days) {
    for (const shift of day.shifts) {
      start = Math.min(start, Math.floor(shift.startMinutes / 60));
      end = Math.max(end, Math.ceil(shift.endMinutes / 60));
    }
  }
  for (const slot of openSlotBlocks) {
    start = Math.min(start, Math.floor(slot.startMinutes / 60));
    end = Math.max(end, Math.ceil(slot.endMinutes / 60));
  }
  return { start: Math.max(0, start), end: Math.min(24, end) };
}

function formatHourLabel(hour: number): string {
  return `${String(hour % 24).padStart(2, "0")}:00`;
}

export function ShiftCalendarView({
  days,
  gridAriaLabel,
  emptyDayText,
  listHeading,
  listDescription,
  emptyWeekText,
  noProjectText,
  unavailableLegendText,
  weekNav,
  openSlots = [],
  onBookSlot,
  bookingPending = false,
  onProposeChange,
  openSlotLegendText,
  dragHintText,
}: {
  days: ShiftCalendarDay[];
  gridAriaLabel: string;
  emptyDayText: string;
  listHeading: string;
  listDescription: string;
  emptyWeekText: string;
  noProjectText: string;
  unavailableLegendText: string;
  weekNav: ShiftCalendarWeekNavProps;
  /** Block S6 — offene Zeitfenster als zusätzliche Raster-Blöcke (nur Freelancer, siehe `ShiftCalendarBoard`). */
  openSlots?: ShiftCalendarOpenSlotBlock[];
  /** Block S6 — Klick (ganzer Slot) ODER Ziehen (Teil-Zeitraum) auf einen offenen Zeitfenster-Block. */
  onBookSlot?: (slotId: string, startMinutes: number, endMinutes: number) => void;
  /** Block S6 — deaktiviert alle offenen-Zeitfenster-Blöcke während eine Buchung läuft. */
  bookingPending?: boolean;
  /** Block S6 — Ziehen (verschieben/Rand) einer eigenen Schicht; schreibt NICHTS direkt, siehe Kopfkommentar. */
  onProposeChange?: (shiftId: string, startMinutes: number, endMinutes: number) => void;
  openSlotLegendText?: string;
  dragHintText?: string;
}) {
  const hasAnyShift = days.some((d) => d.shifts.length > 0);
  // NUR buchbare offene Zeitfenster werden tatsächlich gerendert — siehe
  // JSDoc bei `ShiftCalendarOpenSlotBlock` (Kollisions-/Dopplungs-Grund).
  const bookableOpenSlots = openSlots.filter((s) => !s.alreadyBooked);
  const { start: rangeStart, end: rangeEnd } = computeHourRange(days, bookableOpenSlots);
  const hours = Array.from({ length: rangeEnd - rangeStart }, (_, i) => rangeStart + i);
  const columnHeight = hours.length * HOUR_ROW_HEIGHT_PX;

  const legendProjects = Array.from(
    new Map(
      days
        .flatMap((d) => d.shifts)
        .map((s) => [s.projectName ?? noProjectText, s.projectColor ?? FALLBACK_COLOR] as const),
    ).entries(),
  );

  // --- Block S6 — Pointer-Drag-Handler ------------------------------------
  // EIN gemeinsames Ref-Paar für alle Drag-Gesten dieser Komponente (Klick
  // vs. Ziehen, Slot-Teilauswahl, Schicht verschieben/Größe ändern) — es kann
  // ohnehin immer nur EIN Pointer-Vorgang gleichzeitig laufen. Gleiches
  // ökonomisches Prinzip wie der geteilte `draggingRef` in
  // `video-trimmer.tsx`s `TimelineBar` (dort auch für mehrere Segmente/
  // Griffe gemeinsam genutzt, per Closure-Parameter unterschieden).
  const dragStartYRef = useRef(0);
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);

  function handleDragPointerDown(e: React.PointerEvent<HTMLElement>) {
    dragStartYRef.current = e.clientY;
    dragMovedRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Seltener Edge-Fall (Pointer-ID bereits ungültig) — kein Absturz, siehe video-trimmer.tsx.
    }
  }

  function handleDragPointerMove(e: React.PointerEvent<HTMLElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (Math.abs(e.clientY - dragStartYRef.current) > DRAG_THRESHOLD_PX) dragMovedRef.current = true;
  }

  function releaseDragCapture(e: React.PointerEvent<HTMLElement>) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Capture wurde nie erfolgreich hergestellt — nichts freizugeben.
    }
  }

  function handleShiftPointerUp(e: React.PointerEvent<HTMLElement>, shift: ShiftCalendarShift) {
    releaseDragCapture(e);
    if (!onProposeChange || !dragMovedRef.current) return;
    const deltaMinutes = ((e.clientY - dragStartYRef.current) / HOUR_ROW_HEIGHT_PX) * 60;
    const duration = shift.endMinutes - shift.startMinutes;
    const snappedStart = snapToQuarterHour(shift.startMinutes + deltaMinutes);
    const clamped = clampRange(snappedStart, snappedStart + duration, { min: 0, max: 24 * 60 });
    onProposeChange(shift.id, clamped.start, clamped.end);
  }

  function handleResizeTopPointerUp(e: React.PointerEvent<HTMLElement>, shift: ShiftCalendarShift) {
    releaseDragCapture(e);
    if (!onProposeChange || !dragMovedRef.current) return;
    const deltaMinutes = ((e.clientY - dragStartYRef.current) / HOUR_ROW_HEIGHT_PX) * 60;
    const newStart = Math.min(
      Math.max(snapToQuarterHour(shift.startMinutes + deltaMinutes), 0),
      shift.endMinutes - MIN_DURATION_MINUTES,
    );
    onProposeChange(shift.id, newStart, shift.endMinutes);
  }

  function handleResizeBottomPointerUp(e: React.PointerEvent<HTMLElement>, shift: ShiftCalendarShift) {
    releaseDragCapture(e);
    if (!onProposeChange || !dragMovedRef.current) return;
    const deltaMinutes = ((e.clientY - dragStartYRef.current) / HOUR_ROW_HEIGHT_PX) * 60;
    const newEnd = Math.max(
      Math.min(snapToQuarterHour(shift.endMinutes + deltaMinutes), 24 * 60),
      shift.startMinutes + MIN_DURATION_MINUTES,
    );
    onProposeChange(shift.id, shift.startMinutes, newEnd);
  }

  /**
   * Ziehen innerhalb eines offenen Zeitfensters — Anker (Pointer-Down-Y) und
   * aktuelle Position (Pointer-Up-Y) werden über die Tagesspalte
   * (`[role="row"]`, nächster Vorfahre) in Minuten seit Mitternacht
   * umgerechnet (`minutesFromPointerY`), auf Viertelstunden gerundet und auf
   * die Slot-Grenzen geklammert (`clampRange`). Bucht NUR bei echter
   * Zugbewegung — ein reiner Klick läuft über `handleOpenSlotClick` (siehe
   * dort), damit ein Klick nicht doppelt bucht (Pointerup UND das
   * nachfolgende native `click`-Ereignis).
   */
  function handleOpenSlotPointerUp(e: React.PointerEvent<HTMLElement>, slot: ShiftCalendarOpenSlotBlock) {
    releaseDragCapture(e);
    if (!onBookSlot || !dragMovedRef.current) return;
    const rowEl = e.currentTarget.closest('[role="row"]') as HTMLElement | null;
    if (!rowEl) return;
    const rect = rowEl.getBoundingClientRect();
    const anchorMinutes = minutesFromPointerY(dragStartYRef.current - rect.top, rangeStart, HOUR_ROW_HEIGHT_PX);
    const currentMinutes = minutesFromPointerY(e.clientY - rect.top, rangeStart, HOUR_ROW_HEIGHT_PX);
    const start = snapToQuarterHour(Math.min(anchorMinutes, currentMinutes));
    let end = snapToQuarterHour(Math.max(anchorMinutes, currentMinutes));
    if (end - start < MIN_DURATION_MINUTES) end = start + MIN_DURATION_MINUTES;
    const clamped = clampRange(start, end, { min: slot.startMinutes, max: slot.endMinutes });
    onBookSlot(slot.id, clamped.start, clamped.end);
    // Nachlaufenden Klick unterdrücken (gleiches Muster wie TimelineBar in video-trimmer.tsx).
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  /** Klick (Maus ohne Zugbewegung ODER Tastatur-Aktivierung via Enter/Leertaste) — bucht den GANZEN Slot, Parität zum bestehenden "Buchen"-Knopf in `open-slots-panel.tsx`. */
  function handleOpenSlotClick(slot: ShiftCalendarOpenSlotBlock) {
    if (suppressClickRef.current || !onBookSlot) return;
    onBookSlot(slot.id, slot.startMinutes, slot.endMinutes);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 rounded-[14px] border border-border-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-muted-500">
            {legendProjects.map(([name, color]) => (
              <span key={name} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-sm" style={{ background: color }} />
                {name}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 flex-none rounded-sm border"
                style={{ background: "#F5F6FA", borderColor: "#E7E8F2" }}
              />
              {unavailableLegendText}
            </span>
            {bookableOpenSlots.length > 0 && openSlotLegendText && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 flex-none rounded-sm border-2 border-dashed"
                  style={{ background: "rgba(86,99,174,0.08)", borderColor: OPEN_SLOT_COLOR }}
                />
                {openSlotLegendText}
              </span>
            )}
          </div>

          <nav aria-label={weekNav.weekLabel} className="flex items-center gap-1">
            <p className="mr-2 text-[15px] font-bold text-ink">{weekNav.weekLabel}</p>
            <Link
              href={weekNav.prevHref}
              aria-label={weekNav.prevLabel}
              className="flex h-9 w-9 items-center justify-center rounded-sm text-navy no-underline hover:bg-[rgba(62,63,102,0.06)] focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </Link>
            <Link
              href={weekNav.nextHref}
              aria-label={weekNav.nextLabel}
              className="flex h-9 w-9 items-center justify-center rounded-sm text-navy no-underline hover:bg-[rgba(62,63,102,0.06)] focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </Link>
            {!weekNav.isCurrentWeek && (
              <Link
                href={weekNav.todayHref}
                className="ml-1 rounded-sm border border-border-300 bg-white px-3 py-1.5 text-sm font-semibold text-navy no-underline focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {weekNav.todayLabel}
              </Link>
            )}
          </nav>
        </div>

        {dragHintText && (bookableOpenSlots.length > 0 || Boolean(onProposeChange)) && (
          <p className="text-xs text-muted-500">{dragHintText}</p>
        )}

        <div role="grid" aria-label={gridAriaLabel} className="overflow-x-auto">
          <div className="grid min-w-[720px]" style={{ gridTemplateColumns: `52px repeat(7, minmax(0, 1fr))` }}>
            <div aria-hidden="true" />
            {days.map((day) => (
              <div
                key={day.isoDate}
                role="columnheader"
                className="border-b px-1.5 pb-2 text-center text-sm font-bold"
                style={{ borderColor: "#E7E8F2", color: day.isToday ? "#5663AE" : "#1A1A2E" }}
              >
                {day.shortLabel}
              </div>
            ))}

            <div aria-hidden="true" className="relative" style={{ height: columnHeight }}>
              {hours.map((hour, hi) => (
                <div
                  key={hour}
                  className="absolute left-0 right-0 pr-2 text-right text-[11px]"
                  style={{ top: hi * HOUR_ROW_HEIGHT_PX - 6, color: "#A9AAC4" }}
                >
                  {formatHourLabel(hour)}
                </div>
              ))}
            </div>

            {days.map((day) => (
              <div
                key={day.isoDate}
                role="row"
                aria-label={day.dayLabel}
                className="relative border-l"
                style={{ height: columnHeight, background: "#F5F6FA", borderColor: "#E7E8F2" }}
              >
                {hours.map((hour, hi) =>
                  hi === 0 ? null : (
                    <div
                      key={hour}
                      aria-hidden="true"
                      className="absolute left-0 right-0 border-t"
                      style={{ top: hi * HOUR_ROW_HEIGHT_PX, borderColor: "#EEF0F7" }}
                    />
                  ),
                )}

                {day.shifts.length === 0 && <span className="sr-only">{emptyDayText}</span>}

                {day.shifts.map((shift) => {
                  const color = shift.projectColor ?? FALLBACK_COLOR;
                  const top = Math.max(0, ((shift.startMinutes - rangeStart * 60) / 60) * HOUR_ROW_HEIGHT_PX);
                  const height = Math.max(
                    18,
                    ((Math.min(shift.endMinutes, rangeEnd * 60) - shift.startMinutes) / 60) * HOUR_ROW_HEIGHT_PX,
                  );
                  return (
                    <div key={shift.id} role="gridcell" className="absolute left-0.5 right-0.5" style={{ top, height }}>
                      <button
                        type="button"
                        aria-label={shift.ariaLabel}
                        className="flex h-full w-full flex-col items-start justify-center overflow-hidden rounded-sm border-l-[3px] px-1.5 py-1 text-left focus:outline-none focus:ring-2 focus:ring-primary/40"
                        style={{
                          background: `color-mix(in srgb, ${color} 16%, white)`,
                          borderLeftColor: color,
                          color: `color-mix(in srgb, ${color} 65%, black)`,
                          ...(onProposeChange ? { cursor: "grab", touchAction: "none" } : {}),
                        }}
                        onPointerDown={handleDragPointerDown}
                        onPointerMove={handleDragPointerMove}
                        onPointerUp={(e) => handleShiftPointerUp(e, shift)}
                      >
                        <span className="block truncate text-[11px] font-bold leading-tight">{shift.timeRange}</span>
                        <span className="block truncate text-[10px] leading-tight">{shift.projectName ?? noProjectText}</span>
                      </button>
                      {/* Block S6 — Rand-Ziehzonen (nur wenn onProposeChange gesetzt ist): oben = nur Start verschieben, unten = nur Ende verschieben. `aria-hidden` — reine Maus-/Touch-Erweiterung ohne eigene Tastatur-Semantik, gleiches Präzedenzprinzip wie die Start-/Ende-Griffe in video-trimmer.tsx. */}
                      {onProposeChange && (
                        <>
                          <div
                            aria-hidden="true"
                            onPointerDown={handleDragPointerDown}
                            onPointerMove={handleDragPointerMove}
                            onPointerUp={(e) => handleResizeTopPointerUp(e, shift)}
                            className="absolute inset-x-0 top-0 cursor-ns-resize"
                            style={{ height: RESIZE_HANDLE_PX, touchAction: "none" }}
                          />
                          <div
                            aria-hidden="true"
                            onPointerDown={handleDragPointerDown}
                            onPointerMove={handleDragPointerMove}
                            onPointerUp={(e) => handleResizeBottomPointerUp(e, shift)}
                            className="absolute inset-x-0 bottom-0 cursor-ns-resize"
                            style={{ height: RESIZE_HANDLE_PX, touchAction: "none" }}
                          />
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Block S6 — offene Zeitfenster-Blöcke (nur die buchbaren, siehe `bookableOpenSlots` oben), gestrichelt statt durchgezogen abgesetzt. Echte, fokussierbare `<button>`s (NICHT `aria-hidden`) — Klick/Enter/Leertaste bucht den ganzen Slot zusätzlich zum bestehenden "Buchen"-Knopf in `open-slots-panel.tsx`, Ziehen wählt einen Teil-Zeitraum (nur Maus/Touch). */}
                {bookableOpenSlots
                  .filter((s) => s.isoDate === day.isoDate)
                  .map((slot) => {
                    const isFull = slot.freeSeats <= 0;
                    const top = Math.max(0, ((slot.startMinutes - rangeStart * 60) / 60) * HOUR_ROW_HEIGHT_PX);
                    const height = Math.max(
                      18,
                      ((Math.min(slot.endMinutes, rangeEnd * 60) - slot.startMinutes) / 60) * HOUR_ROW_HEIGHT_PX,
                    );
                    return (
                      <div
                        key={`open-slot-${slot.id}`}
                        role="gridcell"
                        className="absolute left-0.5 right-0.5"
                        style={{ top, height }}
                      >
                        <button
                          type="button"
                          aria-label={slot.ariaLabel}
                          disabled={isFull || bookingPending}
                          onPointerDown={handleDragPointerDown}
                          onPointerMove={handleDragPointerMove}
                          onPointerUp={(e) => handleOpenSlotPointerUp(e, slot)}
                          onClick={() => handleOpenSlotClick(slot)}
                          className="flex h-full w-full flex-col items-start justify-center overflow-hidden rounded-sm border-2 border-dashed px-1.5 py-1 text-left focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                          style={{
                            background: "rgba(86,99,174,0.08)",
                            borderColor: OPEN_SLOT_COLOR,
                            color: "#3E3F66",
                            touchAction: "none",
                          }}
                        >
                          <span className="block truncate text-[11px] font-bold leading-tight">{slot.timeRange}</span>
                          <span className="block truncate text-[10px] leading-tight">{slot.projectName}</span>
                        </button>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <section aria-labelledby="shift-calendar-list-heading" className="rounded-[14px] border border-border-100 bg-white p-6">
        <h2 id="shift-calendar-list-heading" className="text-[17px] font-bold text-ink">
          {listHeading}
        </h2>
        <p className="mt-1 mb-4 text-sm text-muted-500">{listDescription}</p>
        {!hasAnyShift ? (
          <p className="text-sm text-muted-500">{emptyWeekText}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[#EEF0F7]">
            {days.flatMap((day) =>
              day.shifts.map((shift) => (
                <li key={shift.id} className="flex items-center gap-3 py-3">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 flex-none rounded-full"
                    style={{ background: shift.projectColor ?? FALLBACK_COLOR }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {day.dayLabel}, {shift.timeRange}
                    </p>
                    <p className="text-xs text-muted-500">{shift.projectName ?? noProjectText}</p>
                  </div>
                </li>
              )),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
