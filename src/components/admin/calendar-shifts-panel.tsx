"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { createCalendarShift, setCalendarShiftStatus, updateCalendarShift } from "@/lib/calendar/actions";
import type { CalendarAbsenceRow, CalendarAdminShiftRow, CalendarShiftInput } from "@/lib/calendar/schema";
import { formatTimeRange, isoDateString, toTimeInputValue } from "@/lib/calendar/date";
import { CalendarShiftForm } from "@/components/admin/calendar-shift-form";
import { ShiftCalendarWeekNav } from "@/components/learn/shift-calendar-week-nav";

/**
 * Schicht-Wochenraster für Admin/Projektleiter (Block S2, 08.08.2026) —
 * Zeilen = aktive Arbeiter, Spalten = 7 Tage (Plan-Vorgabe, ANDERS als die
 * Lernbereich-Wochenansicht `shift-calendar-view.tsx`, dort Zeilen = Tage).
 * `role="grid"/"row"/"gridcell"`, jede Schicht ein echtes `<button>` mit
 * sprechendem `aria-label` (CLAUDE.md §3.4). Admin sieht auch stornierte
 * Schichten (ausgegraut, mit Textbadge — Farbe ist nie alleiniger
 * Informationsträger).
 */
type FormState =
  | { mode: "create"; workerId: string; isoDate: string }
  | { mode: "edit"; shift: CalendarAdminShiftRow }
  | null;

export function CalendarShiftsPanel({
  workers,
  projects,
  days,
  shifts,
  slots,
  absences,
  weekLabel,
  isCurrentWeek,
  prevWeekHref,
  nextWeekHref,
  todayHref,
  readOnly = false,
}: {
  workers: { id: string; fullName: string | null; email: string }[];
  projects: { id: string; name: string }[];
  days: { isoDate: string; dayLabel: string; shortLabel: string; isToday: boolean }[];
  shifts: CalendarAdminShiftRow[];
  slots: { id: string; projectId: string | null; startsAt: string; endsAt: string }[];
  absences: CalendarAbsenceRow[];
  weekLabel: string;
  isCurrentWeek: boolean;
  prevWeekHref: string;
  nextWeekHref: string;
  todayHref: string;
  /** NEU (Block S3, 09.08.2026): Projektleiter sehen das Wochenraster NUR lesend — kein Anlegen/Bearbeiten/Stornieren. Default `false` (Admin-Verhalten unverändert). */
  readOnly?: boolean;
}) {
  const t = useTranslations("admin.shiftCalendar.shifts");
  const [formState, setFormState] = useState<FormState>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function workerName(id: string): string {
    const w = workers.find((x) => x.id === id);
    return w ? w.fullName || w.email : "";
  }

  function hasAbsence(workerId: string, isoDate: string): boolean {
    return absences.some(
      (a) =>
        (a.workerId === workerId || a.workerId === null) &&
        a.status !== "rejected" &&
        a.startsOn <= isoDate &&
        a.endsOn >= isoDate,
    );
  }

  function handleSubmit(input: CalendarShiftInput) {
    setError(null);
    startTransition(async () => {
      const result =
        formState?.mode === "edit"
          ? await updateCalendarShift(formState.shift.id, input)
          : await createCalendarShift(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFormState(null);
    });
  }

  function handleCancelShift() {
    if (formState?.mode !== "edit") return;
    if (!window.confirm(t("cancelShiftConfirm"))) return;
    const shiftId = formState.shift.id;
    setError(null);
    startTransition(async () => {
      const result = await setCalendarShiftStatus(shiftId, "cancelled");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFormState(null);
    });
  }

  const activeWorkers = workers;

  return (
    <div className="flex flex-col gap-4">
      <ShiftCalendarWeekNav
        weekLabel={weekLabel}
        isCurrentWeek={isCurrentWeek}
        prevHref={prevWeekHref}
        nextHref={nextWeekHref}
        todayHref={todayHref}
        prevLabel={t("prevWeekButton")}
        nextLabel={t("nextWeekButton")}
        todayLabel={t("todayButton")}
      />

      <div className="overflow-hidden rounded-[14px] border border-border-100 bg-white">
        <div className="p-[24px_28px_16px]">
          <h2 className="text-[17px] font-bold text-ink">{t("heading")}</h2>
          <p className="mt-1 text-sm text-muted-500">{t("description")}</p>
        </div>

        {activeWorkers.length === 0 ? (
          <p className="px-[28px] py-6 text-sm text-muted-500">{t("noWorkers")}</p>
        ) : (
          <div className="overflow-x-auto">
            <div role="grid" aria-label={t("gridAriaLabel")} className="min-w-[900px]">
              <div role="row" className="grid grid-cols-[160px_repeat(7,1fr)] border-b border-[#EEF0F7]">
                <div className="px-3 py-2 text-xs font-bold text-muted-500" />
                {days.map((day) => (
                  <div key={day.isoDate} role="columnheader" className="px-2 py-2 text-xs font-bold text-ink">
                    {day.shortLabel}
                  </div>
                ))}
              </div>

              {activeWorkers.map((worker) => (
                <div key={worker.id} role="row" className="grid grid-cols-[160px_repeat(7,1fr)] border-b border-[#EEF0F7]">
                  <div className="truncate px-3 py-2.5 text-sm font-semibold text-ink">{workerName(worker.id)}</div>
                  {days.map((day) => {
                    const cellShifts = shifts.filter(
                      (s) => s.workerId === worker.id && isoDateString(new Date(s.startsAt)) === day.isoDate,
                    );
                    const absent = hasAbsence(worker.id, day.isoDate);
                    return (
                      <div role="gridcell" key={day.isoDate} className="flex flex-col gap-1 px-1.5 py-1.5">
                        {absent && <span className="text-[11px] font-semibold text-[#B24343]">{t("absenceMarker")}</span>}
                        {cellShifts.map((shift) => {
                          const starts = new Date(shift.startsAt);
                          const ends = new Date(shift.endsAt);
                          const ariaLabel = shift.projectName
                            ? t("shiftAriaLabelWithProject", {
                                name: workerName(worker.id),
                                day: day.dayLabel,
                                start: formatTimeRange(starts, ends).split("–")[0],
                                end: formatTimeRange(starts, ends).split("–")[1],
                                project: shift.projectName,
                              })
                            : t("shiftAriaLabelNoProject", {
                                name: workerName(worker.id),
                                day: day.dayLabel,
                                start: formatTimeRange(starts, ends).split("–")[0],
                                end: formatTimeRange(starts, ends).split("–")[1],
                              });
                          const cellContent = (
                            <>
                              <span className="block font-semibold text-ink">{formatTimeRange(starts, ends)}</span>
                              {shift.status === "cancelled" && (
                                <span className="block font-bold text-[#B24343]">{t("cancelledBadge")}</span>
                              )}
                            </>
                          );
                          const cellStyle = {
                            borderLeftColor: shift.projectColor ?? "#5663AE",
                            background: shift.status === "cancelled" ? "#F4F4F8" : "#F7F8FC",
                            opacity: shift.status === "cancelled" ? 0.6 : 1,
                          };
                          return readOnly ? (
                            <div
                              key={shift.id}
                              aria-label={ariaLabel}
                              className="w-full rounded-sm border-l-4 px-2 py-1.5 text-left text-xs"
                              style={cellStyle}
                            >
                              {cellContent}
                            </div>
                          ) : (
                            <button
                              key={shift.id}
                              type="button"
                              aria-label={ariaLabel}
                              onClick={() => setFormState({ mode: "edit", shift })}
                              className="w-full rounded-sm border-l-4 px-2 py-1.5 text-left text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                              style={cellStyle}
                            >
                              {cellContent}
                            </button>
                          );
                        })}
                        {!readOnly && (
                          <button
                            type="button"
                            aria-label={t("addShiftAriaLabel", { name: workerName(worker.id), day: day.dayLabel })}
                            onClick={() => setFormState({ mode: "create", workerId: worker.id, isoDate: day.isoDate })}
                            className="w-full rounded-sm border border-dashed border-border-300 py-1 text-xs font-semibold text-muted-500 focus:outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            +
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {formState && (
        <CalendarShiftForm
          workers={activeWorkers.map((w) => ({ id: w.id, name: w.fullName || w.email }))}
          projects={projects}
          slots={slots}
          editing={formState.mode === "edit"}
          pending={pending}
          initial={
            formState.mode === "edit"
              ? {
                  workerId: formState.shift.workerId,
                  projectId: formState.shift.projectId ?? undefined,
                  slotId: formState.shift.slotId ?? undefined,
                  date: isoDateString(new Date(formState.shift.startsAt)),
                  startTime: toTimeInputValue(new Date(formState.shift.startsAt)),
                  endTime: toTimeInputValue(new Date(formState.shift.endsAt)),
                  breakMinutes: formState.shift.breakMinutes,
                  note: formState.shift.note ?? undefined,
                }
              : { workerId: formState.workerId, date: formState.isoDate, startTime: "08:00", endTime: "16:00" }
          }
          onSubmit={handleSubmit}
          onCancelShift={formState.mode === "edit" ? handleCancelShift : undefined}
          onClose={() => setFormState(null)}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-[#B24343]">
          {error}
        </p>
      )}
    </div>
  );
}
