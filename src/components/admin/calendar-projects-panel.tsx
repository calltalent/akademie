"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  archiveCalendarProject,
  createCalendarProject,
  setCalendarProjectMembers,
  updateCalendarProject,
} from "@/lib/calendar/actions";
import type { CalendarProjectInput, CalendarProjectRow } from "@/lib/calendar/schema";
import { CALENDAR_PROJECT_COLOR_PATTERN } from "@/lib/calendar/schema";

export type CalendarLeadOption = { userId: string; fullName: string | null; email: string };
export type CalendarWorkerOption = { id: string; fullName: string | null; email: string };

const DEFAULT_COLOR = "#5663AE";

/**
 * Projektverwaltung (Block S1, 07.08.2026) — Admin-Panel unter
 * `/admin/schichtplanung`. Gleiches Grundmuster wie
 * `CalendarWorkersPanel`/`customer-area-groups-panel.tsx`. Projekte werden
 * nie gelöscht (RESTRICT-FK auf `calendar_shifts`, siehe Migrationskopf) —
 * nur archiviert/reaktiviert.
 */
export function CalendarProjectsPanel({
  projects,
  leadOptions,
  workerOptions,
}: {
  projects: CalendarProjectRow[];
  leadOptions: CalendarLeadOption[];
  workerOptions: CalendarWorkerOption[];
}) {
  const t = useTranslations("admin.shiftCalendar.projects");
  const uid = useId();

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby={`${uid}-list-heading`}
        className="overflow-hidden rounded-[14px] border border-border-100 bg-white"
      >
        <div className="p-[24px_28px_16px]">
          <h2 id={`${uid}-list-heading`} className="text-[17px] font-bold text-ink">
            {t("heading")}
          </h2>
          <p className="mt-1 text-sm text-muted-500">{t("description")}</p>
        </div>

        {projects.length === 0 ? (
          <p className="px-[28px] py-6 text-sm text-muted-500">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-[#EEF0F7]">
            {projects.map((project) => (
              <ProjectRow key={project.id} project={project} leadOptions={leadOptions} workerOptions={workerOptions} />
            ))}
          </ul>
        )}
      </section>

      <AddProjectSection leadOptions={leadOptions} />
    </div>
  );
}

function ProjectRow({
  project,
  leadOptions,
  workerOptions,
}: {
  project: CalendarProjectRow;
  leadOptions: CalendarLeadOption[];
  workerOptions: CalendarWorkerOption[];
}) {
  const t = useTranslations("admin.shiftCalendar.projects");
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>(project.memberWorkerIds);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [color, setColor] = useState(project.color ?? DEFAULT_COLOR);
  const [leadUserId, setLeadUserId] = useState(project.leadUserId ?? "");

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: CalendarProjectInput = {
      name,
      description: description.trim() === "" ? undefined : description.trim(),
      color: CALENDAR_PROJECT_COLOR_PATTERN.test(color) ? color : undefined,
      leadUserId: leadUserId === "" ? undefined : leadUserId,
    };
    startTransition(async () => {
      const result = await updateCalendarProject(project.id, input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  function toggleArchive() {
    setError(null);
    startTransition(async () => {
      const result = await archiveCalendarProject(project.id, project.status === "active" ? "archived" : "active");
      if (!result.ok) setError(result.error);
    });
  }

  function toggleWorker(id: string) {
    setSelectedWorkerIds((prev) => (prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]));
  }

  function saveMembers() {
    setError(null);
    startTransition(async () => {
      const result = await setCalendarProjectMembers(project.id, selectedWorkerIds);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <li className="px-[28px] py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 flex-none rounded-full"
            style={{ background: project.color ?? DEFAULT_COLOR }}
          />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-ink">
              {project.name}
              {project.status === "archived" && (
                <span className="ml-2 rounded-lg px-2 py-0.5 text-xs font-bold" style={{ background: "#EEF0F7", color: "#66679B" }}>
                  {t("statusArchived")}
                </span>
              )}
            </p>
            <p className="text-sm text-muted-500">
              {project.leadName ? t("leadSummary", { name: project.leadName }) : t("noLead")}
              {" · "}
              {t("memberCount", { count: project.memberWorkerIds.length })}
            </p>
          </div>
        </div>
        <div className="flex flex-none flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMembersOpen((v) => !v)}
            className="rounded-sm border border-border-300 bg-white px-3 py-1.5 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {t("membersToggle")}
          </button>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-sm border border-border-300 bg-white px-3 py-1.5 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {editing ? t("cancelButton") : t("editButton")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={toggleArchive}
            className="rounded-sm border border-border-300 bg-white px-3 py-1.5 text-sm font-semibold text-navy disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {project.status === "active" ? t("archiveButton") : t("reactivateButton")}
          </button>
        </div>
      </div>

      {editing && (
        <form onSubmit={submitEdit} className="mt-4 flex flex-col gap-3 rounded-sm border border-border-100 bg-bg p-4">
          <div>
            <label htmlFor={`${uid}-name`} className="mb-1.5 block text-sm font-semibold text-navy">
              {t("nameLabel")}
            </label>
            <input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-desc`} className="mb-1.5 block text-sm font-semibold text-navy">
              {t("descriptionLabel")}
            </label>
            <textarea
              id={`${uid}-desc`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full resize-y rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${uid}-color`} className="mb-1.5 block text-sm font-semibold text-navy">
                {t("colorLabel")}
              </label>
              <input
                id={`${uid}-color`}
                type="color"
                value={CALENDAR_PROJECT_COLOR_PATTERN.test(color) ? color : DEFAULT_COLOR}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-full rounded-sm border border-border-300 bg-white"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-lead`} className="mb-1.5 block text-sm font-semibold text-navy">
                {t("leadLabel")}
              </label>
              <select
                id={`${uid}-lead`}
                value={leadUserId}
                onChange={(e) => setLeadUserId(e.target.value)}
                className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
              >
                <option value="">{t("leadPlaceholder")}</option>
                {leadOptions.map((o) => (
                  <option key={o.userId} value={o.userId}>
                    {o.fullName || o.email}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {pending ? t("savingButton") : t("saveButton")}
          </button>
        </form>
      )}

      {membersOpen && (
        <div className="mt-4 rounded-sm border border-border-100 bg-bg p-4">
          <p className="mb-2 text-sm font-semibold text-navy">{t("membersHeading")}</p>
          {workerOptions.length === 0 ? (
            <p className="text-sm text-muted-500">{t("noWorkers")}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {workerOptions.map((w) => (
                <label key={w.id} className="flex items-center gap-2 text-sm text-ink">
                  <input
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
          {workerOptions.length > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={saveMembers}
              className="mt-3 w-fit rounded-sm bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {pending ? t("savingButton") : t("saveMembersButton")}
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-[#B24343]">
          {error}
        </p>
      )}
    </li>
  );
}

function AddProjectSection({ leadOptions }: { leadOptions: CalendarLeadOption[] }) {
  const t = useTranslations("admin.shiftCalendar.projects");
  const uid = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [leadUserId, setLeadUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createCalendarProject({
        name,
        description: description.trim() === "" ? undefined : description.trim(),
        color: CALENDAR_PROJECT_COLOR_PATTERN.test(color) ? color : undefined,
        leadUserId: leadUserId === "" ? undefined : leadUserId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setDescription("");
      setColor(DEFAULT_COLOR);
      setLeadUserId("");
    });
  }

  return (
    <section aria-labelledby={`${uid}-add-heading`} className="rounded-[14px] border border-border-100 bg-white p-[26px_28px]">
      <h2 id={`${uid}-add-heading`} className="mb-4 text-[17px] font-bold text-ink">
        {t("addHeading")}
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label htmlFor={`${uid}-name`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("nameLabel")}
          </label>
          <input
            id={`${uid}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            required
            className="w-full max-w-md rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-desc`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("descriptionLabel")}
          </label>
          <textarea
            id={`${uid}-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full max-w-md resize-y rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
          />
        </div>
        <div className="grid max-w-md grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}-color`} className="mb-1.5 block text-sm font-semibold text-navy">
              {t("colorLabel")}
            </label>
            <input
              id={`${uid}-color`}
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-full rounded-sm border border-border-300 bg-white"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-lead`} className="mb-1.5 block text-sm font-semibold text-navy">
              {t("leadLabel")}
            </label>
            <select
              id={`${uid}-lead`}
              value={leadUserId}
              onChange={(e) => setLeadUserId(e.target.value)}
              className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
            >
              <option value="">{t("leadPlaceholder")}</option>
              {leadOptions.map((o) => (
                <option key={o.userId} value={o.userId}>
                  {o.fullName || o.email}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {pending ? t("addingButton") : t("addButton")}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-[#B24343]">
          {error}
        </p>
      )}
    </section>
  );
}
