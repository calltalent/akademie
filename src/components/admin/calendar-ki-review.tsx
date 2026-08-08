"use client";

import { useId, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { applyShiftPlan } from "@/lib/calendar/ai/actions";
import type { ShiftPlanJobDetail } from "@/lib/calendar/ai/queries";
import { berlinDateTimeToUtc, formatDayLabel, minutesBetween } from "@/lib/calendar/date";

/**
 * Review- + Übernahme-Ansicht für einen abgeschlossenen KI-Schichtplan-Lauf
 * (Block S4, 08.08.2026). Editierbarer Entwurf statt reiner Anzeige: jede
 * Zeile bleibt bis zur Übernahme änderbar (Datum/Zeit/Pause), damit ein
 * Konflikt (z. B. Überlappung) VOR dem Absenden korrigiert werden kann.
 *
 * KEIN `router.refresh()` nach `applyShiftPlan()` — würde den lokal
 * bearbeiteten Entwurfsstand (Korrekturen an fehlgeschlagenen Zeilen)
 * verwerfen. Stattdessen rein lokaler Zustand: `appliedIds` wächst um die
 * gerade erfolgreich übernommenen Zeilen, `failureByRowId` hält die letzte
 * Fehlermeldung je Zeile für einen erneuten Versuch bereit (gleiches
 * Prinzip wie die zeilenweise Fehlerbehandlung in
 * `calendar-change-requests-panel.tsx`).
 */
type EditableRow = {
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
};

function rowHours(row: EditableRow): number {
  const startsAt = berlinDateTimeToUtc(row.date, row.startTime);
  const isNightShift = row.endTime <= row.startTime;
  const endDateIso = isNightShift ? shiftedIso(row.date, 1) : row.date;
  const endsAt = berlinDateTimeToUtc(endDateIso, row.endTime);
  const minutes = Math.max(0, minutesBetween(startsAt, endsAt) - row.breakMinutes);
  return minutes / 60;
}

function shiftedIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function CalendarKiReview({ job, backHref }: { job: ShiftPlanJobDetail; backHref: string }) {
  const t = useTranslations("admin.shiftCalendar.ki");
  const uid = useId();
  const [pending, startTransition] = useTransition();

  const [editableById, setEditableById] = useState<Record<string, EditableRow>>(() =>
    Object.fromEntries(
      job.draftRows.map((r) => [r.id, { date: r.date, startTime: r.startTime, endTime: r.endTime, breakMinutes: r.breakMinutes }]),
    ),
  );
  const [appliedIds, setAppliedIds] = useState<Set<string>>(
    () => new Set(job.draftRows.filter((r) => r.alreadyApplied).map((r) => r.id)),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(job.draftRows.filter((r) => !r.alreadyApplied).map((r) => r.id)),
  );
  const [failureByRowId, setFailureByRowId] = useState<Record<string, string>>({});
  const [lastResult, setLastResult] = useState<{ created: number; skipped: number; failedCount: number } | null>(null);

  const selectableIds = useMemo(() => job.draftRows.filter((r) => !appliedIds.has(r.id)).map((r) => r.id), [job.draftRows, appliedIds]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  }

  function updateField(id: string, field: keyof EditableRow, value: string | number) {
    setEditableById((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  const hourSummary = useMemo(() => {
    const byWorker = new Map<string, { name: string; minutes: number; targetHours: number | null; targetPeriod: "week" | "month" | null }>();
    for (const row of job.draftRows) {
      const editable = editableById[row.id];
      if (!editable) continue;
      const entry = byWorker.get(row.workerId) ?? { name: row.workerName, minutes: 0, targetHours: row.targetHours, targetPeriod: row.targetPeriod };
      entry.minutes += rowHours(editable) * 60;
      byWorker.set(row.workerId, entry);
    }
    return Array.from(byWorker.values());
  }, [job.draftRows, editableById]);

  function handleApply() {
    const rows = Array.from(selectedIds)
      .filter((id) => !appliedIds.has(id))
      .map((id) => ({ id, ...editableById[id] }));
    if (rows.length === 0) return;
    if (!window.confirm(t("applyConfirm", { count: rows.length }))) return;

    startTransition(async () => {
      const result = await applyShiftPlan(job.id, rows);
      if (!result.ok) {
        setLastResult(null);
        setFailureByRowId((prev) => ({ ...prev, __global: result.error }));
        return;
      }
      const failMap: Record<string, string> = {};
      for (const f of result.failures) failMap[f.rowId] = f.error;
      setFailureByRowId(failMap);

      const succeededIds = rows.map((r) => r.id).filter((id) => !failMap[id]);
      setAppliedIds((prev) => new Set([...prev, ...succeededIds]));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of succeededIds) next.delete(id);
        return next;
      });
      setLastResult({ created: result.created, skipped: result.skipped, failedCount: result.failures.length });
    });
  }

  const conflictLabel: Record<string, string> = {
    overlap: t("conflict.overlap"),
    absence: t("conflict.absence"),
    "outside-period": t("conflict.outside-period"),
    duplicate: t("conflict.duplicate"),
  };

  return (
    <div className="flex flex-col gap-6 p-[24px_28px]">
      <div>
        <Link href={backHref} className="text-sm font-semibold text-primary hover:underline">
          {t("backLink")}
        </Link>
        <h2 className="mt-2 text-[17px] font-bold text-ink">{t("reviewHeading")}</h2>
        <p className="mt-1 text-sm text-muted-500">
          {job.projectName ?? "—"} · {t("periodLabel", { from: job.fromDate, to: job.toDate })} ·{" "}
          {t("reviewCount", { count: job.draftRows.length })}
        </p>
        {job.note && <p className="mt-1 text-sm text-muted-500">{t("notesLabel")}: {job.note}</p>}
      </div>

      <p className="rounded-[10px] border px-4 py-3 text-sm" style={{ borderColor: "#D8DAF0", background: "#F5F6FC", color: "#3E3F66" }}>
        {t("disclaimer")}
      </p>

      {job.draftNotes && (
        <p className="rounded-[10px] border px-4 py-3 text-sm text-ink" style={{ borderColor: "#E7E8F2" }}>
          {job.draftNotes}
        </p>
      )}

      {hourSummary.length > 0 && (
        <div className="rounded-[14px] border p-4" style={{ borderColor: "#E7E8F2" }}>
          <h3 className="mb-2 text-sm font-bold text-ink">{t("summaryHeading")}</h3>
          <ul className="flex flex-col gap-1 text-sm text-ink">
            {hourSummary.map((entry, i) => (
              <li key={i}>
                {t("summaryLine", { name: entry.name, hours: (entry.minutes / 60).toFixed(1) })}
                {entry.targetHours != null && (
                  <span style={{ color: "#66679B" }}>
                    {" "}
                    {t("summaryTarget", {
                      target: entry.targetHours,
                      period: entry.targetPeriod === "month" ? t("periodMonth") : t("periodWeek"),
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {failureByRowId.__global && (
        <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
          {failureByRowId.__global}
        </p>
      )}

      {lastResult && (
        <p role="status" className="rounded-[10px] border px-4 py-3 text-sm" style={{ borderColor: "#CFE3D6", background: "#EAF6EF", color: "#1F8A5B" }}>
          {t("resultCreated", { count: lastResult.created })}
          {lastResult.skipped > 0 && ` ${t("resultSkipped", { count: lastResult.skipped })}`}
          {lastResult.failedCount > 0 && ` ${t("resultFailedIntro", { count: lastResult.failedCount })}`}
        </p>
      )}

      <div className="overflow-x-auto rounded-[14px] border" style={{ borderColor: "#E7E8F2" }}>
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: "#E7E8F2" }}>
              <th className="px-3 py-2.5">
                <label className="flex items-center gap-1.5" htmlFor={`${uid}-all`}>
                  <input id={`${uid}-all`} type="checkbox" checked={allSelected} onChange={toggleAll} style={{ accentColor: "#5663AE" }} />
                  {t("selectAllLabel")}
                </label>
              </th>
              <th className="px-3 py-2.5 font-semibold text-navy">{t("workerColumnLabel")}</th>
              <th className="px-3 py-2.5 font-semibold text-navy">{t("dateColumnLabel")}</th>
              <th className="px-3 py-2.5 font-semibold text-navy">{t("startColumnLabel")}</th>
              <th className="px-3 py-2.5 font-semibold text-navy">{t("endColumnLabel")}</th>
              <th className="px-3 py-2.5 font-semibold text-navy">{t("breakColumnLabel")}</th>
              <th className="px-3 py-2.5 font-semibold text-navy">{t("conflictColumnLabel")}</th>
            </tr>
          </thead>
          <tbody>
            {job.draftRows.map((row) => {
              const applied = appliedIds.has(row.id);
              const editable = editableById[row.id];
              const failure = failureByRowId[row.id];
              return (
                <tr key={row.id} className="border-b last:border-0" style={{ borderColor: "#F0F1F8", opacity: applied ? 0.55 : 1 }}>
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      disabled={applied}
                      onChange={() => toggleRow(row.id)}
                      aria-label={`${row.workerName}, ${formatDayLabel(berlinDateTimeToUtc(editable.date, "00:00"))}`}
                      style={{ accentColor: "#5663AE" }}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-ink">{row.workerName}</td>
                  <td className="px-3 py-2.5">
                    <input
                      type="date"
                      value={editable.date}
                      disabled={applied}
                      onChange={(e) => updateField(row.id, "date", e.target.value)}
                      className="w-full rounded-sm border border-border-300 bg-white px-2 py-1.5 text-sm text-ink disabled:bg-[#F5F6FA]"
                      aria-label={t("dateColumnLabel")}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="time"
                      value={editable.startTime}
                      disabled={applied}
                      onChange={(e) => updateField(row.id, "startTime", e.target.value)}
                      className="w-full rounded-sm border border-border-300 bg-white px-2 py-1.5 text-sm text-ink disabled:bg-[#F5F6FA]"
                      aria-label={t("startColumnLabel")}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="time"
                      value={editable.endTime}
                      disabled={applied}
                      onChange={(e) => updateField(row.id, "endTime", e.target.value)}
                      className="w-full rounded-sm border border-border-300 bg-white px-2 py-1.5 text-sm text-ink disabled:bg-[#F5F6FA]"
                      aria-label={t("endColumnLabel")}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="number"
                      min={0}
                      max={480}
                      value={editable.breakMinutes}
                      disabled={applied}
                      onChange={(e) => updateField(row.id, "breakMinutes", Number(e.target.value))}
                      className="w-20 rounded-sm border border-border-300 bg-white px-2 py-1.5 text-sm text-ink disabled:bg-[#F5F6FA]"
                      aria-label={t("breakColumnLabel")}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    {applied ? (
                      <span className="rounded-lg px-2.5 py-1 text-[13px] font-bold" style={{ color: "#1F8A5B", background: "#E3F2EA" }}>
                        {t("appliedBadge")}
                      </span>
                    ) : failure ? (
                      <span className="text-[13px]" style={{ color: "#B24343" }}>
                        {failure}
                      </span>
                    ) : row.conflict ? (
                      <span className="rounded-lg px-2.5 py-1 text-[13px] font-bold" style={{ color: "#8A5A1F", background: "#F7EED4" }}>
                        {conflictLabel[row.conflict]}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={handleApply}
        disabled={pending || Array.from(selectedIds).every((id) => appliedIds.has(id)) || selectedIds.size === 0}
        className="w-fit rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {pending ? t("applyingButton") : t("applyButton")}
      </button>
    </div>
  );
}
