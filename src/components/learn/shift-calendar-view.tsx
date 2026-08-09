import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Wochenansicht "Mein Schichtplan" (Block S1, 07.08.2026 — Stunden-Raster
 * am 08.08.2026 auf Josips ausdrücklichen Wunsch nachgezogen: "eine
 * Wochenansicht mit Tagen und Stunden, ähnlich wie ein Kalender, belegte
 * Zeiten in der Projektfarbe hervorgehoben, Zeiten zu denen nicht
 * gearbeitet werden kann hellgrau"; Wochen-Navigation am 09.08.2026 auf
 * Josips Wunsch aus einer eigenen Box darüber IN diese Karte verschoben,
 * rechtsbündig über der letzten Tagesspalte — siehe `weekNav`-Prop unten).
 * Reine Darstellungskomponente, keine eigene Datenabfrage/Datumsrechnung
 * (übernimmt `(portal)/schichtplan/page.tsx`). Server Component (kein
 * `"use client"` nötig — Schicht-Details/-CRUD kommt erst mit S2/S3, hier
 * nur native `<button>`-/`<Link>`-Fokussierbarkeit).
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

/** Standardbereich 06–22 Uhr, erweitert um Stunden, in denen eine echte Schicht liegt (nie schmaler als der Standard). */
function computeHourRange(days: ShiftCalendarDay[]): { start: number; end: number } {
  let start = DEFAULT_RANGE_START_HOUR;
  let end = DEFAULT_RANGE_END_HOUR;
  for (const day of days) {
    for (const shift of day.shifts) {
      start = Math.min(start, Math.floor(shift.startMinutes / 60));
      end = Math.max(end, Math.ceil(shift.endMinutes / 60));
    }
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
}) {
  const hasAnyShift = days.some((d) => d.shifts.length > 0);
  const { start: rangeStart, end: rangeEnd } = computeHourRange(days);
  const hours = Array.from({ length: rangeEnd - rangeStart }, (_, i) => rangeStart + i);
  const columnHeight = hours.length * HOUR_ROW_HEIGHT_PX;

  const legendProjects = Array.from(
    new Map(
      days
        .flatMap((d) => d.shifts)
        .map((s) => [s.projectName ?? noProjectText, s.projectColor ?? FALLBACK_COLOR] as const),
    ).entries(),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 rounded-[14px] border border-border-100 bg-white p-5">
        <div className="flex flex-col gap-3">
          <nav aria-label={weekNav.weekLabel} className="flex items-center justify-end gap-1">
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
          </div>
        </div>

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
                        }}
                      >
                        <span className="block truncate text-[11px] font-bold leading-tight">{shift.timeRange}</span>
                        <span className="block truncate text-[10px] leading-tight">{shift.projectName ?? noProjectText}</span>
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
