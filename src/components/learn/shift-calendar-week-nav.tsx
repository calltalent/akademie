import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Wochen-Navigation für "Mein Schichtplan" (Block S1, 07.08.2026) — reine
 * Darstellungskomponente ohne eigene Datumsrechnung (die übernimmt
 * `(portal)/schichtplan/page.tsx` mit `src/lib/calendar/date.ts`, hier nur
 * fertige Hrefs/Texte). Echte `<Link>`-Elemente (Navigation, kein
 * `<button>`-Seiteneffekt) — funktioniert ohne JavaScript, jeder Link per
 * Tastatur erreichbar mit eigenem Fokusring.
 */
export function ShiftCalendarWeekNav({
  prevHref,
  nextHref,
  todayHref,
  isCurrentWeek,
  weekLabel,
  prevLabel,
  nextLabel,
  todayLabel,
}: {
  prevHref: string;
  nextHref: string;
  todayHref: string;
  isCurrentWeek: boolean;
  weekLabel: string;
  prevLabel: string;
  nextLabel: string;
  todayLabel: string;
}) {
  return (
    <nav
      aria-label={weekLabel}
      className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border-100 bg-white px-5 py-3.5"
    >
      <div className="flex items-center gap-1">
        <Link
          href={prevHref}
          aria-label={prevLabel}
          className="flex h-9 w-9 items-center justify-center rounded-sm text-navy no-underline hover:bg-[rgba(62,63,102,0.06)] focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </Link>
        <Link
          href={nextHref}
          aria-label={nextLabel}
          className="flex h-9 w-9 items-center justify-center rounded-sm text-navy no-underline hover:bg-[rgba(62,63,102,0.06)] focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
        {!isCurrentWeek && (
          <Link
            href={todayHref}
            className="ml-2 rounded-sm border border-border-300 bg-white px-3 py-1.5 text-sm font-semibold text-navy no-underline focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {todayLabel}
          </Link>
        )}
      </div>
      <p className="text-[15px] font-bold text-ink">{weekLabel}</p>
    </nav>
  );
}
