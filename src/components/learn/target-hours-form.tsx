"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { updateOwnTargetHours } from "@/lib/calendar/actions";
import type { CalendarTargetPeriod } from "@/lib/calendar/schema";

/**
 * Sollstunden-Selbstverwaltung (Block S2, 08.08.2026) — NUR für Freelancer
 * (`worker_type = 'freelancer' and status = 'active'`, Josips ausdrückliche
 * Vorgabe). Der Aufrufer (`(portal)/schichtplan/page.tsx`) rendert diese
 * Komponente nur, wenn `workerType === "freelancer"` — zusätzlich sind
 * Trigger `calendar_workers_guard()` + Policy `calendar_workers_update`
 * (S2-Migration) die eigentliche Absicherung, nicht diese UI-Bedingung.
 */
export function TargetHoursForm({
  initialTargetHours,
  initialTargetPeriod,
}: {
  initialTargetHours: number | null;
  initialTargetPeriod: CalendarTargetPeriod;
}) {
  const t = useTranslations("learn.shiftCalendar.targetHours");
  const uid = useId();
  const [targetHours, setTargetHours] = useState(initialTargetHours != null ? String(initialTargetHours) : "");
  const [targetPeriod, setTargetPeriod] = useState<CalendarTargetPeriod>(initialTargetPeriod);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const hoursNum = targetHours.trim() === "" ? undefined : Number(targetHours.replace(",", "."));
    startTransition(async () => {
      const result = await updateOwnTargetHours({ targetHours: hoursNum, targetPeriod });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <section aria-labelledby="target-hours-heading" className="rounded-[14px] border border-border-100 bg-white p-6">
      <h2 id="target-hours-heading" className="text-[17px] font-bold text-ink">
        {t("heading")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted-500">{t("description")}</p>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
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
            className="w-32 rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-period`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("targetPeriodLabel")}
          </label>
          <select
            id={`${uid}-period`}
            value={targetPeriod}
            onChange={(e) => setTargetPeriod(e.target.value as CalendarTargetPeriod)}
            className="rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
          >
            <option value="week">{t("targetPeriodWeek")}</option>
            <option value="month">{t("targetPeriodMonth")}</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {pending ? t("savingButton") : t("saveButton")}
        </button>
      </form>

      {saved && (
        <p role="status" className="mt-3 text-sm font-semibold text-navy">
          {t("saved")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-[#B24343]">
          {error}
        </p>
      )}
    </section>
  );
}
