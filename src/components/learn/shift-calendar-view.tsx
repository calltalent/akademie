/**
 * Lesende Wochenansicht "Mein Schichtplan" (Block S1, 07.08.2026) — reine
 * Darstellungskomponente, keine eigene Datenabfrage/Datumsrechnung
 * (übernimmt `(portal)/schichtplan/page.tsx`). Server Component (kein
 * `"use client"` nötig, keine Interaktion in S1 — Schicht-Details/-CRUD
 * kommt erst mit S2/S3).
 *
 * Barrierefreiheit (CLAUDE.md §3.4, Auftraggeber sehbehindert):
 * - Wochenraster als `role="grid"`/`role="row"`/`role="gridcell"`, jede
 *   Schicht ein echtes `<button>` mit sprechendem `aria-label`
 *   ("Montag, 10. August, 08:00 bis 16:00 Uhr, Projekt Nordwest").
 * - Farbe ist nie alleiniger Informationsträger — der Projektname steht
 *   IMMER zusätzlich als Text neben dem Farbbalken/-punkt.
 * - Eine gleichwertige Listenansicht steht direkt unter dem Raster (gleiche
 *   Daten, andere Darstellung — kein separater Datenabruf).
 */
export type ShiftCalendarShift = {
  id: string;
  timeRange: string;
  ariaLabel: string;
  projectName: string | null;
  projectColor: string | null;
  status: "planned" | "confirmed" | "cancelled";
};

export type ShiftCalendarDay = {
  isoDate: string;
  dayLabel: string;
  shortLabel: string;
  isToday: boolean;
  shifts: ShiftCalendarShift[];
};

const FALLBACK_COLOR = "#5663AE";

export function ShiftCalendarView({
  days,
  gridAriaLabel,
  emptyDayText,
  listHeading,
  listDescription,
  emptyWeekText,
  noProjectText,
}: {
  days: ShiftCalendarDay[];
  gridAriaLabel: string;
  emptyDayText: string;
  listHeading: string;
  listDescription: string;
  emptyWeekText: string;
  noProjectText: string;
}) {
  const hasAnyShift = days.some((d) => d.shifts.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div role="grid" aria-label={gridAriaLabel} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((day) => (
          <div
            key={day.isoDate}
            role="row"
            className="flex flex-col gap-2 rounded-[14px] border bg-white p-3"
            style={{ borderColor: day.isToday ? "#5663AE" : "#E7E8F2" }}
          >
            <p role="columnheader" className="text-sm font-bold text-ink">
              {day.shortLabel}
            </p>
            {day.shifts.length === 0 ? (
              <p role="gridcell" className="text-sm text-muted-500">
                {emptyDayText}
              </p>
            ) : (
              day.shifts.map((shift) => (
                <div role="gridcell" key={shift.id}>
                  <button
                    type="button"
                    aria-label={shift.ariaLabel}
                    className="w-full rounded-sm border-l-4 bg-bg px-2.5 py-2 text-left focus:outline-none focus:ring-2 focus:ring-primary/40"
                    style={{ borderLeftColor: shift.projectColor ?? FALLBACK_COLOR }}
                  >
                    <span className="block text-sm font-semibold text-ink">{shift.timeRange}</span>
                    <span className="block text-xs text-muted-500">{shift.projectName ?? noProjectText}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        ))}
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
