"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { bookOwnShift } from "@/lib/calendar/actions";
import type { CalendarOpenSlotRow } from "@/lib/calendar/schema";
import { formatDayLabel, formatTimeRange } from "@/lib/calendar/date";

/**
 * Selbstbuchungs-Ansicht für Freelancer (Block S2, 08.08.2026) — offene
 * Zeitfenster der eigenen Projekte, "Buchen"/"Bereits gebucht" (deaktiviert).
 * Bei Fehler: übersetzte Meldung in `role="alert"` UND `router.refresh()`
 * (Plan-Vorgabe — hält die Platzzahl aktuell, falls ein anderer Freelancer
 * zwischenzeitlich das letzte freie Zeitfenster gebucht hat).
 */
export function OpenSlotsPanel({ slots }: { slots: CalendarOpenSlotRow[] }) {
  const t = useTranslations("learn.shiftCalendar.openSlots");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleBook(slotId: string) {
    setError(null);
    setBookingId(slotId);
    startTransition(async () => {
      const result = await bookOwnShift({ slotId });
      if (!result.ok) {
        setError(result.error);
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="open-slots-heading" className="rounded-[14px] border border-border-100 bg-white p-6">
      <h2 id="open-slots-heading" className="text-[17px] font-bold text-ink">
        {t("heading")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted-500">{t("description")}</p>

      {slots.length === 0 ? (
        <p className="text-sm text-muted-500">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[#EEF0F7]">
          {slots.map((slot) => {
            const isFull = slot.freeSeats <= 0 && !slot.alreadyBooked;
            const isPendingThis = pending && bookingId === slot.id;
            return (
              <li key={slot.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {formatDayLabel(new Date(slot.startsAt))}, {formatTimeRange(new Date(slot.startsAt), new Date(slot.endsAt))}
                  </p>
                  <p className="text-xs text-muted-500">
                    {slot.projectName}
                    {" · "}
                    {isFull ? t("full") : t("freeSeats", { count: slot.freeSeats, capacity: slot.capacity })}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={slot.alreadyBooked || isFull || pending}
                  onClick={() => handleBook(slot.id)}
                  className="flex-none rounded-sm bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {slot.alreadyBooked ? t("alreadyBookedButton") : isPendingThis ? t("bookingPending") : t("bookButton")}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-[#B24343]">
          {error}
        </p>
      )}
    </section>
  );
}
