"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { createCalendarSlots, deleteCalendarSlot, setCalendarSlotStatus } from "@/lib/calendar/actions";
import type { CalendarSlotRow } from "@/lib/calendar/schema";
import { buildWeeklySeries, formatDayLabel, formatTimeRange } from "@/lib/calendar/date";
import { ShiftCalendarWeekNav } from "@/components/learn/shift-calendar-week-nav";

/**
 * Zeitfenster-Verwaltung (Block S2, 08.08.2026) — Liste der Zeitfenster der
 * Woche ("x von y Plätzen belegt"), Öffnen/Schließen, Löschen. Anlageformular
 * mit Serienoption ("Wiederholen für N Wochen") plus Vorschauzeile der
 * konkreten Termine (client-seitig über `buildWeeklySeries()` berechnet —
 * dieselbe Funktion, die die Server Action beim tatsächlichen Anlegen
 * verwendet, keine zweite Datumslogik).
 */
export function CalendarSlotsPanel({
  projects,
  slots,
  weekLabel,
  isCurrentWeek,
  prevWeekHref,
  nextWeekHref,
  todayHref,
}: {
  projects: { id: string; name: string; color: string | null }[];
  slots: CalendarSlotRow[];
  weekLabel: string;
  isCurrentWeek: boolean;
  prevWeekHref: string;
  nextWeekHref: string;
  todayHref: string;
}) {
  const t = useTranslations("admin.shiftCalendar.slots");
  // Wochen-Navigationstexte ("Vorherige/Nächste Woche"/"Diese Woche") sind
  // sprachlich reitunabhängig — wiederverwendet aus dem shifts-Namensraum
  // statt einer dritten Kopie derselben drei Strings.
  const tNav = useTranslations("admin.shiftCalendar.shifts");
  const uid = useId();

  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("16:00");
  const [capacity, setCapacity] = useState("1");
  const [repeatWeeks, setRepeatWeeks] = useState("1");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, startAdd] = useTransition();

  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowPending, startRowTransition] = useTransition();

  const preview = useMemo(() => {
    if (!date || !startTime || !endTime || startTime === endTime) return [];
    const weeks = Math.min(Math.max(Number(repeatWeeks) || 1, 1), 26);
    try {
      return buildWeeklySeries(date, startTime, endTime, weeks);
    } catch {
      return [];
    }
  }, [date, startTime, endTime, repeatWeeks]);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    startAdd(async () => {
      const result = await createCalendarSlots({
        projectId,
        date,
        startTime,
        endTime,
        capacity: Number(capacity) || 1,
        repeatWeeks: Number(repeatWeeks) || 1,
      });
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      setDate("");
    });
  }

  function handleToggleStatus(slot: CalendarSlotRow) {
    startRowTransition(async () => {
      const next = slot.status === "open" ? "closed" : "open";
      const result = await setCalendarSlotStatus(slot.id, next);
      if (!result.ok) setRowError((prev) => ({ ...prev, [slot.id]: result.error }));
    });
  }

  function handleDelete(slot: CalendarSlotRow) {
    if (slot.bookedCount > 0) {
      window.alert(t("deleteWithBookingsWarning"));
      return;
    }
    if (!window.confirm(t("deleteConfirm"))) return;
    startRowTransition(async () => {
      const result = await deleteCalendarSlot(slot.id);
      if (!result.ok) setRowError((prev) => ({ ...prev, [slot.id]: result.error }));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <ShiftCalendarWeekNav
        weekLabel={weekLabel}
        isCurrentWeek={isCurrentWeek}
        prevHref={prevWeekHref}
        nextHref={nextWeekHref}
        todayHref={todayHref}
        prevLabel={tNav("prevWeekButton")}
        nextLabel={tNav("nextWeekButton")}
        todayLabel={tNav("todayButton")}
      />

      <section aria-labelledby={`${uid}-list-heading`} className="overflow-hidden rounded-[14px] border border-border-100 bg-white">
        <div className="p-[24px_28px_16px]">
          <h2 id={`${uid}-list-heading`} className="text-[17px] font-bold text-ink">
            {t("heading")}
          </h2>
          <p className="mt-1 text-sm text-muted-500">{t("description")}</p>
        </div>

        {slots.length === 0 ? (
          <p className="px-[28px] py-6 text-sm text-muted-500">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-[#EEF0F7]">
            {slots.map((slot) => (
              <li key={slot.id} className="flex flex-wrap items-center justify-between gap-3 px-[28px] py-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[15px] font-bold text-ink">
                    <span aria-hidden="true" className="h-3 w-3 flex-none rounded-full" style={{ background: slot.projectColor ?? "#5663AE" }} />
                    {slot.projectName ?? "—"}
                  </p>
                  <p className="text-sm text-muted-500">
                    {formatDayLabel(new Date(slot.startsAt))}, {formatTimeRange(new Date(slot.startsAt), new Date(slot.endsAt))}
                    {" · "}
                    {t("bookedSummary", { booked: slot.bookedCount, capacity: slot.capacity })}
                    {" · "}
                    {slot.status === "open" ? t("statusOpen") : t("statusClosed")}
                  </p>
                  {rowError[slot.id] && (
                    <p role="alert" className="mt-1 text-sm text-[#B24343]">
                      {rowError[slot.id]}
                    </p>
                  )}
                </div>
                <div className="flex flex-none flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={rowPending}
                    onClick={() => handleToggleStatus(slot)}
                    className="rounded-sm border border-border-300 bg-white px-3 py-1.5 text-sm font-semibold text-navy disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {slot.status === "open" ? t("closeButton") : t("openButton")}
                  </button>
                  <button
                    type="button"
                    disabled={rowPending}
                    onClick={() => handleDelete(slot)}
                    className="rounded-sm border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    style={{ borderColor: "#E3C0C0", color: "#B24343" }}
                  >
                    {t("deleteButton")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${uid}-add-heading`} className="rounded-[14px] border border-border-100 bg-white p-[26px_28px]">
        <h2 id={`${uid}-add-heading`} className="mb-4 text-[17px] font-bold text-ink">
          {t("addHeading")}
        </h2>
        <form onSubmit={handleAdd} className="flex flex-col gap-3">
          <div>
            <label htmlFor={`${uid}-project`} className="mb-1.5 block text-sm font-semibold text-navy">
              {t("projectLabel")}
            </label>
            <select
              id={`${uid}-project`}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              required
              className="w-full max-w-md rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
            >
              <option value="" disabled>
                {t("projectPlaceholder")}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-5">
            <div>
              <label htmlFor={`${uid}-date`} className="mb-1.5 block text-sm font-semibold text-navy">
                {t("dateLabel")}
              </label>
              <input
                id={`${uid}-date`}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-start`} className="mb-1.5 block text-sm font-semibold text-navy">
                {t("startTimeLabel")}
              </label>
              <input
                id={`${uid}-start`}
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-end`} className="mb-1.5 block text-sm font-semibold text-navy">
                {t("endTimeLabel")}
              </label>
              <input
                id={`${uid}-end`}
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-capacity`} className="mb-1.5 block text-sm font-semibold text-navy">
                {t("capacityLabel")}
              </label>
              <input
                id={`${uid}-capacity`}
                type="number"
                min={1}
                max={500}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                required
                className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-weeks`} className="mb-1.5 block text-sm font-semibold text-navy">
                {t("repeatWeeksLabel")}
              </label>
              <input
                id={`${uid}-weeks`}
                type="number"
                min={1}
                max={26}
                value={repeatWeeks}
                onChange={(e) => setRepeatWeeks(e.target.value)}
                required
                className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
              />
            </div>
          </div>

          {preview.length > 0 && (
            <div role="status" className="rounded-sm border border-border-100 bg-bg p-3 text-sm text-muted-500">
              <p className="font-semibold text-navy">{t("seriesPreview", { count: preview.length })}</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {preview.map((p, i) => (
                  <li key={i}>
                    {formatDayLabel(p.startsAt)}, {formatTimeRange(p.startsAt, p.endsAt)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="submit"
            disabled={addPending}
            className="w-fit rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {addPending ? t("addingButton") : t("addButton")}
          </button>
        </form>
        {addError && (
          <p role="alert" className="mt-3 text-sm text-[#B24343]">
            {addError}
          </p>
        )}
      </section>
    </div>
  );
}
