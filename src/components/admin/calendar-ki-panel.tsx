"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { startShiftPlanJob, deleteShiftPlanJob } from "@/lib/calendar/ai/actions";
import type { ShiftPlanJobListRow } from "@/lib/calendar/ai/queries";
import type { CalendarProjectRow, CalendarWorkerRow } from "@/lib/calendar/schema";
import { addDays, isoDateString, startOfIsoWeek } from "@/lib/calendar/date";

/**
 * "KI-Planung" — Auslöse-Formular + Auftragsliste (Block S4, 08.08.2026).
 * NUR für owner/admin (der Reiter selbst ist bereits nicht in
 * `PLANNER_TAB_IDS`, siehe `schichtplanung-tabs.tsx`) — die eigentliche
 * Durchsetzung liegt serverseitig in `startShiftPlanJob()`/
 * `deleteShiftPlanJob()` (jede Funktion prüft `isAdmin` selbst, siehe
 * `src/lib/calendar/ai/actions.ts`-Dateikopf).
 *
 * PFLICHT-Kennzeichnung (CLAUDE.md §3.6, Art. 50 KI-VO): der Hinweistext
 * über dem Formular ist IMMER sichtbar, unabhängig vom Formular-/Ladezustand
 * — gleiches Prinzip wie das "KI-Assistent"-Badge in `tutor-panel.tsx`.
 *
 * KEINE neue Status-API-Route: solange mindestens ein Auftrag `queued`/
 * `running` ist, ruft ein `setInterval` alle 5s `router.refresh()` auf — die
 * Server-Component-Seite lädt dann automatisch den aktuellen Job-Stand neu
 * (`getShiftPlanJobs()`), bis der Cron-Prozess-Endpunkt den Lauf
 * abgeschlossen hat.
 */
function defaultWeekRange(): { from: string; to: string } {
  const nextMonday = addDays(startOfIsoWeek(new Date()), 7);
  return { from: isoDateString(nextMonday), to: isoDateString(addDays(nextMonday, 6)) };
}

export function CalendarKiPanel({
  projects,
  workers,
  jobs,
  onOpenJob,
}: {
  projects: CalendarProjectRow[];
  workers: CalendarWorkerRow[];
  jobs: ShiftPlanJobListRow[];
  onOpenJob: (jobId: string) => void;
}) {
  const t = useTranslations("admin.shiftCalendar.ki");
  const uid = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaults = useMemo(() => defaultWeekRange(), []);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const selectedProject = projects.find((p) => p.id === projectId) ?? null;
  const projectWorkers = useMemo(
    () => workers.filter((w) => selectedProject?.memberWorkerIds.includes(w.id)),
    [workers, selectedProject],
  );

  function handleProjectChange(newProjectId: string) {
    setProjectId(newProjectId);
    const nextProject = projects.find((p) => p.id === newProjectId) ?? null;
    setSelectedWorkerIds(workers.filter((w) => nextProject?.memberWorkerIds.includes(w.id)).map((w) => w.id));
  }

  useEffect(() => {
    const hasActiveJob = jobs.some((j) => j.status === "queued" || j.status === "running");
    if (!hasActiveJob) return;
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [jobs, router]);

  function toggleWorker(id: string) {
    setSelectedWorkerIds((prev) => (prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await startShiftPlanJob({
        projectId,
        fromDate,
        toDate,
        workerIds: selectedWorkerIds,
        note: note.trim() === "" ? undefined : note.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Bleibt auf der Auftragsliste (NICHT sofort in die Review-Ansicht
      // springen) — ein gerade gestarteter Auftrag ist `queued`, hat also
      // noch keinen Entwurf zum Prüfen. Der Admin öffnet ihn manuell über
      // "Öffnen", sobald der Status auf "Zu prüfen" wechselt.
      setNote("");
    });
  }

  function handleDelete(jobId: string) {
    if (!window.confirm(t("deleteConfirm"))) return;
    setDeletingId(jobId);
    startTransition(async () => {
      await deleteShiftPlanJob(jobId);
      setDeletingId(null);
    });
  }

  const statusLabel: Record<ShiftPlanJobListRow["status"], string> = {
    queued: t("statusQueued"),
    running: t("statusRunning"),
    done: t("statusDone"),
    error: t("statusError"),
  };
  const statusColor: Record<ShiftPlanJobListRow["status"], { color: string; bg: string }> = {
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

      <p className="rounded-[10px] border px-4 py-3 text-sm" style={{ borderColor: "#D8DAF0", background: "#F5F6FC", color: "#3E3F66" }}>
        {t("disclaimer")}
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-[14px] border p-6" style={{ borderColor: "#E7E8F2" }}>
        <h3 className="text-[15px] font-bold text-ink">{t("formHeading")}</h3>

        <div>
          <label htmlFor={`${uid}-project`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("projectLabel")}
          </label>
          <select
            id={`${uid}-project`}
            value={projectId}
            onChange={(e) => handleProjectChange(e.target.value)}
            required
            className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}-from`} className="mb-1.5 block text-sm font-semibold text-navy">
              {t("fromDateLabel")}
            </label>
            <input
              id={`${uid}-from`}
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
              className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-to`} className="mb-1.5 block text-sm font-semibold text-navy">
              {t("toDateLabel")}
            </label>
            <input
              id={`${uid}-to`}
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
              className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
            />
          </div>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-navy">{t("workersLabel")}</legend>
          {projectWorkers.length === 0 ? (
            <p className="text-sm text-muted-500">{t("noWorkers")}</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {projectWorkers.map((w) => (
                <label key={w.id} className="flex items-center gap-1.5 text-sm text-ink" htmlFor={`${uid}-w-${w.id}`}>
                  <input
                    id={`${uid}-w-${w.id}`}
                    type="checkbox"
                    checked={selectedWorkerIds.includes(w.id)}
                    onChange={() => toggleWorker(w.id)}
                    style={{ accentColor: "#5663AE" }}
                  />
                  {w.fullName || w.email}
                </label>
              ))}
            </div>
          )}
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

        {error && (
          <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || !projectId || selectedWorkerIds.length === 0}
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
                  <p className="text-sm font-semibold text-ink">{job.projectName ?? "—"}</p>
                  <p className="text-[13px]" style={{ color: "#66679B" }}>
                    {t("periodLabel", { from: job.fromDate, to: job.toDate })}
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
