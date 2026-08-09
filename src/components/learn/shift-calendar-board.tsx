"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { bookOwnShift } from "@/lib/calendar/actions";
import { isoDateString } from "@/lib/calendar/date";
import type { CalendarChangeRequestRow, CalendarShiftRow } from "@/lib/calendar/schema";
import {
  ShiftCalendarView,
  type ShiftCalendarDay,
  type ShiftCalendarOpenSlotBlock,
  type ShiftCalendarWeekNavProps,
} from "@/components/learn/shift-calendar-view";
import { ShiftChangeRequestPanel } from "@/components/learn/shift-change-request-panel";

/**
 * Orchestrator für "Mein Schichtplan" (Block S6, 09.08.2026 —
 * Freelancer-Drag-and-Drop im Wochenraster, architect-Plan
 * `plane-und-erstelle-mit-floofy-curry.md`). Schaltet `ShiftCalendarView`
 * und `ShiftChangeRequestPanel` zusammen — Brücke für den Drag-Vorschlags-
 * Fluss (Ziehen einer eigenen Schicht im Raster füllt nur das bestehende
 * "Zeit ändern"-Formular vor, siehe `shift-change-request-panel.tsx`).
 *
 * NICHT-FREELANCER (`isFreelancer === false`): rendert exakt das Paar, das
 * `(portal)/schichtplan/page.tsx` vor diesem Block direkt gerendert hat —
 * OHNE die neuen Props. Festangestellte sehen dadurch KEINE
 * Verhaltensänderung (kein Drag, kein offenes Zeitfenster im Raster, wie vor
 * S6 — Josips ausdrückliche Vorgabe aus der Plan-Klärung).
 *
 * `OpenSlotsPanel`/`TargetHoursForm` bleiben UNVERÄNDERT und werden weiterhin
 * separat unterhalb dieser Komponente gerendert (siehe page.tsx) — sie sind
 * NICHT Teil dieses Orchestrators. Grund: der Tastatur-Weg muss vollständig
 * primär bleiben (CLAUDE.md §3.4, Auftraggeber sehbehindert), Drag ist rein
 * ergänzend (gleiches Prinzip wie `video-trimmer.tsx`).
 */
function minutesToHhMm(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function ShiftCalendarBoard({
  isFreelancer,
  days,
  gridAriaLabel,
  emptyDayText,
  listHeading,
  listDescription,
  emptyWeekText,
  noProjectText,
  unavailableLegendText,
  weekNav,
  shifts,
  requests,
  openSlots,
}: {
  isFreelancer: boolean;
  days: ShiftCalendarDay[];
  gridAriaLabel: string;
  emptyDayText: string;
  listHeading: string;
  listDescription: string;
  emptyWeekText: string;
  noProjectText: string;
  unavailableLegendText: string;
  weekNav: ShiftCalendarWeekNavProps;
  shifts: CalendarShiftRow[];
  requests: CalendarChangeRequestRow[];
  openSlots: ShiftCalendarOpenSlotBlock[];
}) {
  const t = useTranslations("learn.shiftCalendar.dragBoard");
  const router = useRouter();
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [externalRequest, setExternalRequest] = useState<{
    shiftId: string;
    date: string;
    startTime: string;
    endTime: string;
  } | null>(null);

  if (!isFreelancer) {
    return (
      <>
        <ShiftCalendarView
          days={days}
          gridAriaLabel={gridAriaLabel}
          emptyDayText={emptyDayText}
          listHeading={listHeading}
          listDescription={listDescription}
          emptyWeekText={emptyWeekText}
          noProjectText={noProjectText}
          unavailableLegendText={unavailableLegendText}
          weekNav={weekNav}
        />
        <ShiftChangeRequestPanel shifts={shifts} requests={requests} />
      </>
    );
  }

  function handleBookSlot(slotId: string, startMinutes: number, endMinutes: number) {
    setBookingError(null);
    startTransition(async () => {
      const result = await bookOwnShift({
        slotId,
        startTime: minutesToHhMm(startMinutes),
        endTime: minutesToHhMm(endMinutes),
      });
      if (!result.ok) {
        setBookingError(result.error);
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  function handleProposeChange(shiftId: string, startMinutes: number, endMinutes: number) {
    const shift = shifts.find((s) => s.id === shiftId);
    if (!shift) return;
    // Drag ist in Version 1 nur vertikal (Zeit ändern) — der Kalendertag
    // bleibt bewusst derjenige der URSPRÜNGLICHEN Schicht, keine
    // Tagesänderung per Ziehen (siehe architect-Plan, Scope-Einschränkung).
    setExternalRequest({
      shiftId,
      date: isoDateString(new Date(shift.startsAt)),
      startTime: minutesToHhMm(startMinutes),
      endTime: minutesToHhMm(endMinutes),
    });
  }

  return (
    <>
      <ShiftCalendarView
        days={days}
        gridAriaLabel={gridAriaLabel}
        emptyDayText={emptyDayText}
        listHeading={listHeading}
        listDescription={listDescription}
        emptyWeekText={emptyWeekText}
        noProjectText={noProjectText}
        unavailableLegendText={unavailableLegendText}
        weekNav={weekNav}
        openSlots={openSlots}
        onBookSlot={handleBookSlot}
        bookingPending={pending}
        onProposeChange={handleProposeChange}
        openSlotLegendText={t("openSlotLegend")}
        dragHintText={t("dragHint")}
      />
      {bookingError && (
        <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
          {bookingError}
        </p>
      )}
      <ShiftChangeRequestPanel
        shifts={shifts}
        requests={requests}
        externalRequest={externalRequest}
        onExternalRequestHandled={() => setExternalRequest(null)}
      />
    </>
  );
}
