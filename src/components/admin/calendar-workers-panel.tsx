"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  createCalendarWorker,
  deleteCalendarWorker,
  setCalendarWorkerStatus,
  updateCalendarWorker,
} from "@/lib/calendar/actions";
import type { CalendarWorkerEditableInput, CalendarWorkerRow } from "@/lib/calendar/schema";
import { CalendarWorkerForm } from "@/components/admin/calendar-worker-form";

export type CalendarMembershipOption = {
  membershipId: string;
  userId: string;
  fullName: string | null;
  email: string;
  role: string;
};

/**
 * Arbeiterverwaltung (Block S1, 07.08.2026) — Admin-Panel unter
 * `/admin/schichtplanung`. Gleiches Grundmuster wie
 * `customer-area-groups-panel.tsx`: Liste + "Hinzufügen"-Formular in einer
 * Karte, Bearbeiten klappt inline auf (kein Modal), Fehlermeldungen als
 * `role="alert"`-Absatz je Formular.
 */
export function CalendarWorkersPanel({
  workers,
  memberships,
}: {
  workers: CalendarWorkerRow[];
  memberships: CalendarMembershipOption[];
}) {
  const t = useTranslations("admin.shiftCalendar.workers");
  const uid = useId();
  const [selectedMembership, setSelectedMembership] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, startAdd] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowPending, startRowTransition] = useTransition();

  function handleAdd(input: CalendarWorkerEditableInput) {
    if (!selectedMembership) {
      setAddError(t("membershipRequired"));
      return;
    }
    setAddError(null);
    startAdd(async () => {
      const result = await createCalendarWorker({ ...input, membershipId: selectedMembership });
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      setSelectedMembership("");
    });
  }

  function handleUpdate(id: string, input: CalendarWorkerEditableInput) {
    startRowTransition(async () => {
      const result = await updateCalendarWorker(id, input);
      if (!result.ok) {
        setRowError((prev) => ({ ...prev, [id]: result.error }));
        return;
      }
      setRowError((prev) => ({ ...prev, [id]: "" }));
      setEditingId(null);
    });
  }

  function handleStatusToggle(worker: CalendarWorkerRow) {
    startRowTransition(async () => {
      const nextStatus = worker.status === "active" ? "inactive" : "active";
      const result = await setCalendarWorkerStatus(worker.id, nextStatus);
      if (!result.ok) setRowError((prev) => ({ ...prev, [worker.id]: result.error }));
    });
  }

  function handleDelete(worker: CalendarWorkerRow) {
    const name = worker.fullName || worker.email;
    if (!window.confirm(t("deleteConfirm", { name }))) return;
    startRowTransition(async () => {
      const result = await deleteCalendarWorker(worker.id);
      if (!result.ok) setRowError((prev) => ({ ...prev, [worker.id]: result.error }));
    });
  }

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

        {workers.length === 0 ? (
          <p className="px-[28px] py-6 text-sm text-muted-500">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-[#EEF0F7]">
            {workers.map((worker) => {
              const name = worker.fullName || worker.email;
              return (
                <li key={worker.id} className="px-[28px] py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-bold text-ink">{name}</p>
                      <p className="text-sm text-muted-500">
                        {worker.workerType === "employee" ? t("workerTypeEmployee") : t("workerTypeFreelancer")}
                        {" · "}
                        {worker.status === "active" ? t("statusActive") : t("statusInactive")}
                        {worker.targetHours != null && (
                          <>
                            {" · "}
                            {t("targetHoursSummary", {
                              hours: worker.targetHours,
                              period: worker.targetPeriod === "week" ? t("targetPeriodWeek") : t("targetPeriodMonth"),
                            })}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-none flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(editingId === worker.id ? null : worker.id)}
                        className="rounded-sm border border-border-300 bg-white px-3 py-1.5 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        {editingId === worker.id ? t("cancelButton") : t("editButton")}
                      </button>
                      <button
                        type="button"
                        disabled={rowPending}
                        onClick={() => handleStatusToggle(worker)}
                        className="rounded-sm border border-border-300 bg-white px-3 py-1.5 text-sm font-semibold text-navy disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        {worker.status === "active" ? t("deactivateButton") : t("activateButton")}
                      </button>
                      <button
                        type="button"
                        disabled={rowPending}
                        onClick={() => handleDelete(worker)}
                        className="rounded-sm border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                        style={{ borderColor: "#E3C0C0", color: "#B24343" }}
                      >
                        {t("deleteButton")}
                      </button>
                    </div>
                  </div>

                  {editingId === worker.id && (
                    <div className="mt-4 rounded-sm border border-border-100 bg-bg p-4">
                      <CalendarWorkerForm
                        initial={{
                          workerType: worker.workerType,
                          targetHours: worker.targetHours ?? undefined,
                          targetPeriod: worker.targetPeriod,
                          preferredShift: worker.preferredShift,
                          preferredWeekdays: worker.preferredWeekdays,
                          note: worker.note ?? undefined,
                        }}
                        pending={rowPending}
                        submitLabel={t("saveButton")}
                        pendingLabel={t("savingButton")}
                        onSubmit={(input) => handleUpdate(worker.id, input)}
                      />
                    </div>
                  )}
                  {rowError[worker.id] && (
                    <p role="alert" className="mt-2 text-sm text-[#B24343]">
                      {rowError[worker.id]}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-labelledby={`${uid}-add-heading`}
        className="rounded-[14px] border border-border-100 bg-white p-[26px_28px]"
      >
        <h2 id={`${uid}-add-heading`} className="mb-4 text-[17px] font-bold text-ink">
          {t("addHeading")}
        </h2>

        <div className="mb-4">
          <label htmlFor={`${uid}-membership`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("membershipLabel")}
          </label>
          {memberships.length === 0 ? (
            <p className="text-sm text-muted-500">{t("noMemberships")}</p>
          ) : (
            <select
              id={`${uid}-membership`}
              value={selectedMembership}
              onChange={(e) => setSelectedMembership(e.target.value)}
              className="w-full max-w-md rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
            >
              <option value="">{t("membershipPlaceholder")}</option>
              {memberships.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.fullName || m.email}
                </option>
              ))}
            </select>
          )}
        </div>

        {memberships.length > 0 && (
          <CalendarWorkerForm
            pending={addPending}
            submitLabel={t("addButton")}
            pendingLabel={t("addingButton")}
            onSubmit={handleAdd}
          />
        )}
        {addError && (
          <p role="alert" className="mt-3 text-sm text-[#B24343]">
            {addError}
          </p>
        )}
      </section>
    </div>
  );
}
