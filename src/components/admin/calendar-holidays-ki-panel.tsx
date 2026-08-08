"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { startHolidayResearchJob, deleteHolidayResearchJob } from "@/lib/calendar/ai/holidays/actions";
import type { HolidayResearchJobListRow } from "@/lib/calendar/ai/holidays/queries";
import type { CalendarHolidayRegionCode } from "@/lib/calendar/schema";

/**
 * "Feiertage per KI recherchieren" — Auslöse-Formular + Auftragsliste
 * (Block S5c, 08.08.2026). Muster 1:1 aus `calendar-ki-panel.tsx` (S4-
 * Vorbild) übernommen: NUR Jahr-Eingabe (KEIN Regionsfeld — die Regionen
 * kommen serverseitig aus `tenant.settings.shift_calendar_holiday_regions`,
 * siehe `startHolidayResearchJob()`-Dateikopf), Auftragsliste mit
 * 5-Sekunden-Auto-Refresh, solange ein Auftrag `queued`/`running` ist.
 *
 * PFLICHT-Kennzeichnung (CLAUDE.md §3.6, Art. 50 KI-VO): der Hinweistext
 * über dem Formular ist IMMER sichtbar, unabhängig vom Formular-/Ladezustand.
 *
 * Nach dem Start bleibt die Ansicht auf der Liste (NICHT sofort in die
 * Review springen) — ein gerade gestarteter Auftrag ist `queued`, hat also
 * noch keinen Entwurf (S4-Lehre, siehe dortiger Kommentar).
 */
export function CalendarHolidaysKiPanel({
  holidayRegions,
  jobs,
  onOpenJob,
}: {
  holidayRegions: CalendarHolidayRegionCode[];
  jobs: HolidayResearchJobListRow[];
  onOpenJob: (jobId: string) => void;
}) {
  const t = useTranslations("admin.shiftCalendar.absences.holidayKi");
  const tRegion = useTranslations("admin.shiftCalendar.absences.region");
  const uid = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));

  useEffect(() => {
    const hasActiveJob = jobs.some((j) => j.status === "queued" || j.status === "running");
    if (!hasActiveJob) return;
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [jobs, router]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await startHolidayResearchJob({ year: Number(year) });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Bleibt auf der Auftragsliste — ein gerade gestarteter Auftrag ist
      // `queued`, hat also noch keinen Entwurf zum Prüfen.
    });
  }

  function handleDelete(jobId: string) {
    if (!window.confirm(t("deleteConfirm"))) return;
    setDeletingId(jobId);
    startTransition(async () => {
      await deleteHolidayResearchJob(jobId);
      setDeletingId(null);
    });
  }

  const statusLabel: Record<HolidayResearchJobListRow["status"], string> = {
    queued: t("statusQueued"),
    running: t("statusRunning"),
    done: t("statusDone"),
    error: t("statusError"),
  };
  const statusColor: Record<HolidayResearchJobListRow["status"], { color: string; bg: string }> = {
    queued: { color: "#1A1A2E", bg: "#F7EED4" },
    running: { color: "#1A1A2E", bg: "#F7EED4" },
    done: { color: "#1F8A5B", bg: "#E3F2EA" },
    error: { color: "#B24343", bg: "#F6E4E4" },
  };

  return (
    <div className="flex flex-col gap-6 p-[24px_28px]">
      <div>
        <h2 className="text-[17px] font-bold text-ink">{t("heading")}</h2>
        <p className="mt-1 text-sm text-muted-500">{t("description")}</p>
      </div>

      <p
        className="rounded-[10px] border px-4 py-3 text-sm"
        style={{ borderColor: "#D8DAF0", background: "#F5F6FC", color: "#3E3F66" }}
      >
        {t("disclaimer")}
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-[14px] border p-6" style={{ borderColor: "#E7E8F2" }}>
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-navy">{t("regionsLabel")}</span>
          <p className="text-sm text-ink">{holidayRegions.map((r) => tRegion(r)).join(", ")}</p>
        </div>

        <div className="max-w-[160px]">
          <label htmlFor={`${uid}-year`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("yearLabel")}
          </label>
          <input
            id={`${uid}-year`}
            type="number"
            min={2020}
            max={2100}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            required
            className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {pending ? t("submittingButton") : t("submitButton")}
        </button>
      </form>

      <div className="flex flex-col gap-3">
        <h3 className="text-[15px] font-bold text-ink">{t("jobsHeading")}</h3>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-500">{t("emptyJobs")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[#EEF0F7] rounded-[14px] border" style={{ borderColor: "#E7E8F2" }}>
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{job.year || "—"}</p>
                  <p className="text-[13px]" style={{ color: "#66679B" }}>
                    {job.regions.map((r) => tRegion(r)).join(", ")}
                  </p>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <span
                    className="rounded-lg px-3 py-1.5 text-[13px] font-bold"
                    style={{ color: statusColor[job.status].color, background: statusColor[job.status].bg }}
                  >
                    {statusLabel[job.status]}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenJob(job.id)}
                    className="rounded-sm border border-border-300 bg-white px-3.5 py-2 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {t("openButton")}
                  </button>
                  <button
                    type="button"
                    disabled={pending && deletingId === job.id}
                    onClick={() => handleDelete(job.id)}
                    className="rounded-sm border px-3.5 py-2 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    style={{ borderColor: "#E3C0C0", color: "#B24343" }}
                  >
                    {t("deleteButton")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
