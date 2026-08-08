"use client";

import { useId, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { applyHolidayResearch } from "@/lib/calendar/ai/holidays/actions";
import type { HolidayResearchJobDetail } from "@/lib/calendar/ai/holidays/queries";

/**
 * Review- + Übernahme-Ansicht für einen abgeschlossenen KI-Feiertagsrecherche-
 * Lauf (Block S5c, 08.08.2026). Muster 1:1 aus `calendar-ki-review.tsx`
 * (S4-Vorbild) übernommen: editierbarer Entwurf statt reiner Anzeige (Datum/
 * Bezeichnung bleiben bis zur Übernahme änderbar), KEIN `router.refresh()`
 * nach `applyHolidayResearch()` (würde lokale Korrekturen an fehlgeschlagenen
 * Zeilen verwerfen) — stattdessen rein lokaler Zustand `appliedIds`/
 * `failureByRowId`, exakt wie beim S4-Vorbild.
 *
 * VORAUSWAHL-ABWEICHUNG vom S4-Vorbild (architect-Plan Abschnitt 5.3,
 * bewusste Entscheidung): beim S4-Vorbild startet JEDE nicht bereits
 * übernommene Zeile ausgewählt. Hier starten NUR Zeilen mit `conflict ===
 * null` ausgewählt — Zeilen mit `"existing"`/`"duplicate"`/`"outside-year"`
 * starten ABGEWÄHLT, weil eine Feiertagszeile eine Rechtstatsache mit
 * Entgeltfolge ist (§ 2 EFZG) und eine unbedachte Übernahme einer
 * Konfliktzeile mandantenweit auf die KI-Schichtplanung wirkt.
 */
type EditableRow = { date: string; name: string };

export function CalendarHolidaysKiReview({ job, backHref }: { job: HolidayResearchJobDetail; backHref: string }) {
  const t = useTranslations("admin.shiftCalendar.absences.holidayKi");
  const uid = useId();
  const [pending, startTransition] = useTransition();

  const [editableById, setEditableById] = useState<Record<string, EditableRow>>(() =>
    Object.fromEntries(job.draftRows.map((r) => [r.id, { date: r.date, name: r.name }])),
  );
  const [appliedIds, setAppliedIds] = useState<Set<string>>(
    () => new Set(job.draftRows.filter((r) => r.alreadyApplied).map((r) => r.id)),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(job.draftRows.filter((r) => !r.alreadyApplied && r.conflict === null).map((r) => r.id)),
  );
  const [failureByRowId, setFailureByRowId] = useState<Record<string, string>>({});
  const [lastResult, setLastResult] = useState<{ created: number; skipped: number; failedCount: number } | null>(null);

  const selectableIds = useMemo(
    () => job.draftRows.filter((r) => !appliedIds.has(r.id)).map((r) => r.id),
    [job.draftRows, appliedIds],
  );
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

  function updateField(id: string, field: keyof EditableRow, value: string) {
    setEditableById((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  function handleApply() {
    const rows = Array.from(selectedIds)
      .filter((id) => !appliedIds.has(id))
      .map((id) => ({ id, ...editableById[id] }));
    if (rows.length === 0) return;
    if (!window.confirm(t("applyConfirm", { count: rows.length }))) return;

    startTransition(async () => {
      const result = await applyHolidayResearch(job.id, rows);
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

  const checkLabel: Record<string, string> = {
    confirmed: t("check.confirmed"),
    unverified: t("check.unverified"),
  };
  const conflictLabel: Record<string, string> = {
    existing: t("conflict.existing"),
    duplicate: t("conflict.duplicate"),
    "outside-year": t("conflict.outside-year"),
  };

  return (
    <div className="flex flex-col gap-6 p-[24px_28px]">
      <div>
        <Link href={backHref} className="text-sm font-semibold text-primary hover:underline">
          {t("backLink")}
        </Link>
        <h2 className="mt-2 text-[17px] font-bold text-ink">{t("reviewHeading")}</h2>
        <p className="mt-1 text-sm text-muted-500">
          {job.year || "—"} · {t("reviewCount", { count: job.draftRows.length })}
        </p>
        {job.draftNotes && (
          <p className="mt-1 text-sm text-muted-500">
            {t("notesLabel")}: {job.draftNotes}
          </p>
        )}
      </div>

      <p
        className="rounded-[10px] border px-4 py-3 text-sm"
        style={{ borderColor: "#D8DAF0", background: "#F5F6FC", color: "#3E3F66" }}
      >
        {t("disclaimer")}
      </p>

      {failureByRowId.__global && (
        <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
          {failureByRowId.__global}
        </p>
      )}

      {lastResult && (
        <p
          role="status"
          className="rounded-[10px] border px-4 py-3 text-sm"
          style={{ borderColor: "#CFE3D6", background: "#EAF6EF", color: "#1F8A5B" }}
        >
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
              <th className="px-3 py-2.5 font-semibold text-navy">{t("regionColumnLabel")}</th>
              <th className="px-3 py-2.5 font-semibold text-navy">{t("dateColumnLabel")}</th>
              <th className="px-3 py-2.5 font-semibold text-navy">{t("nameColumnLabel")}</th>
              <th className="px-3 py-2.5 font-semibold text-navy">{t("checkColumnLabel")}</th>
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
                      aria-label={`${row.regionLabel}, ${editable.date}`}
                      style={{ accentColor: "#5663AE" }}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-ink">{row.regionLabel}</td>
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
                      type="text"
                      value={editable.name}
                      disabled={applied}
                      maxLength={120}
                      onChange={(e) => updateField(row.id, "name", e.target.value)}
                      className="w-full rounded-sm border border-border-300 bg-white px-2 py-1.5 text-sm text-ink disabled:bg-[#F5F6FA]"
                      aria-label={t("nameColumnLabel")}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    {row.check ? (
                      <span
                        className="rounded-lg px-2.5 py-1 text-[13px] font-bold"
                        style={
                          row.check === "confirmed"
                            ? { color: "#1F8A5B", background: "#E3F2EA" }
                            : { color: "#8A5A1F", background: "#F7EED4" }
                        }
                      >
                        {checkLabel[row.check]}
                      </span>
                    ) : (
                      <span className="text-[13px]" style={{ color: "#66679B" }}>
                        {t("check.none")}
                      </span>
                    )}
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
