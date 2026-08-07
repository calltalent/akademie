"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { CalendarWorkerEditableInput } from "@/lib/calendar/schema";

/**
 * Gemeinsames Formular für "Arbeiter anlegen" und "Arbeiter bearbeiten"
 * (Block S1, 07.08.2026) — native Eingaben, echte `<label>`-Zuordnung über
 * `htmlFor`/`id` (CLAUDE.md §3.4/6, Auftraggeber sehbehindert), Wochentage
 * als Checkbox-Gruppe mit `<fieldset>`/`<legend>` statt eines Custom-Widgets.
 */
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function CalendarWorkerForm({
  initial,
  onSubmit,
  pending,
  submitLabel,
  pendingLabel,
}: {
  initial?: Partial<CalendarWorkerEditableInput>;
  onSubmit: (input: CalendarWorkerEditableInput) => void;
  pending: boolean;
  submitLabel: string;
  pendingLabel: string;
}) {
  const t = useTranslations("admin.shiftCalendar.workers");
  const uid = useId();
  const [workerType, setWorkerType] = useState(initial?.workerType ?? "employee");
  const [targetHours, setTargetHours] = useState(initial?.targetHours != null ? String(initial.targetHours) : "");
  const [targetPeriod, setTargetPeriod] = useState(initial?.targetPeriod ?? "week");
  const [preferredShift, setPreferredShift] = useState(initial?.preferredShift ?? "any");
  const [preferredWeekdays, setPreferredWeekdays] = useState<number[]>(initial?.preferredWeekdays ?? []);
  const [note, setNote] = useState(initial?.note ?? "");

  function toggleWeekday(day: number) {
    setPreferredWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hoursNum = targetHours.trim() === "" ? undefined : Number(targetHours.replace(",", "."));
    onSubmit({
      workerType,
      targetHours: hoursNum,
      targetPeriod,
      preferredShift,
      preferredWeekdays,
      note: note.trim() === "" ? undefined : note.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor={`${uid}-type`} className="mb-1.5 block text-sm font-semibold text-navy">
          {t("workerTypeLabel")}
        </label>
        <select
          id={`${uid}-type`}
          value={workerType}
          onChange={(e) => setWorkerType(e.target.value as CalendarWorkerEditableInput["workerType"])}
          className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
        >
          <option value="employee">{t("workerTypeEmployee")}</option>
          <option value="freelancer">{t("workerTypeFreelancer")}</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${uid}-hours`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("targetHoursLabel")}
          </label>
          <input
            id={`${uid}-hours`}
            type="text"
            inputMode="decimal"
            value={targetHours}
            onChange={(e) => setTargetHours(e.target.value)}
            className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-period`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("targetPeriodLabel")}
          </label>
          <select
            id={`${uid}-period`}
            value={targetPeriod}
            onChange={(e) => setTargetPeriod(e.target.value as CalendarWorkerEditableInput["targetPeriod"])}
            className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
          >
            <option value="week">{t("targetPeriodWeek")}</option>
            <option value="month">{t("targetPeriodMonth")}</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={`${uid}-shift`} className="mb-1.5 block text-sm font-semibold text-navy">
          {t("preferredShiftLabel")}
        </label>
        <select
          id={`${uid}-shift`}
          value={preferredShift}
          onChange={(e) => setPreferredShift(e.target.value as CalendarWorkerEditableInput["preferredShift"])}
          className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
        >
          <option value="early">{t("preferredShiftEarly")}</option>
          <option value="late">{t("preferredShiftLate")}</option>
          <option value="any">{t("preferredShiftAny")}</option>
        </select>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-navy">{t("preferredWeekdaysLabel")}</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAY_KEYS.map((key, index) => (
            <label key={key} className="flex items-center gap-1.5 text-sm text-ink" htmlFor={`${uid}-wd-${index}`}>
              <input
                id={`${uid}-wd-${index}`}
                type="checkbox"
                checked={preferredWeekdays.includes(index)}
                onChange={() => toggleWeekday(index)}
                style={{ accentColor: "#5663AE" }}
              />
              {t(`weekday.${key}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${uid}-note`} className="mb-1.5 block text-sm font-semibold text-navy">
          {t("noteLabel")}
        </label>
        <textarea
          id={`${uid}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full resize-y rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
