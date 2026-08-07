"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { clockIn, clockOut } from "@/lib/calendar/actions";
import { formatTime } from "@/lib/calendar/date";

/**
 * Ein-/Ausstempel-Widget für "Mein Schichtplan" (Block S1, 07.08.2026) —
 * echtes Stempeln (Josips bestätigte Entscheidung): mehrere Ein-/Ausstempel-
 * Vorgänge pro Tag über `calendar_time_entries`, nicht nur ein Ist-Beginn/
 * -Ende auf der Schicht.
 *
 * Optimistisches Client-Update nach jeder Aktion (Server-Action-Rückgabewert
 * direkt übernommen) — kein Re-Fetch der Seite nötig, `revalidatePath` in
 * `clockIn()`/`clockOut()` hält Folge-Navigationen trotzdem konsistent.
 */
export function TimeClockWidget({ initialOpenEntryStartedAt }: { initialOpenEntryStartedAt: string | null }) {
  const t = useTranslations("learn.shiftCalendar.timeClock");
  const [startedAt, setStartedAt] = useState<string | null>(initialOpenEntryStartedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClockIn() {
    setError(null);
    startTransition(async () => {
      const result = await clockIn({});
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStartedAt(result.entry.startedAt);
    });
  }

  function handleClockOut() {
    setError(null);
    startTransition(async () => {
      const result = await clockOut();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStartedAt(null);
    });
  }

  const isClockedIn = startedAt !== null;

  return (
    <section
      aria-labelledby="time-clock-heading"
      className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-border-100 bg-white px-6 py-5"
    >
      <div>
        <h2 id="time-clock-heading" className="text-[17px] font-bold text-ink">
          {t("heading")}
        </h2>
        <p className="mt-1 text-sm text-muted-500" role="status" aria-live="polite">
          {isClockedIn && startedAt
            ? t("clockedInSince", { time: formatTime(new Date(startedAt)) })
            : t("notClockedIn")}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-sm text-[#B24343]">
            {error}
          </p>
        )}
      </div>

      {isClockedIn ? (
        <button
          type="button"
          disabled={pending}
          onClick={handleClockOut}
          className="rounded-sm px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          style={{ background: "#B24343" }}
        >
          {pending ? t("clockingOut") : t("clockOutButton")}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={handleClockIn}
          className="rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {pending ? t("clockingIn") : t("clockInButton")}
        </button>
      )}
    </section>
  );
}
