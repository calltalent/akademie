"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { createShiftChangeRequest } from "@/lib/calendar/actions";
import type { CalendarChangeRequestRow, CalendarShiftRow } from "@/lib/calendar/schema";
import { formatDayLabel, formatTimeRange, isoDateString, toTimeInputValue } from "@/lib/calendar/date";

/**
 * "Änderung beantragen" (Block S3, 09.08.2026) — eigene Sektion unterhalb
 * des Wochenrasters in `(portal)/schichtplan/page.tsx`. `shift-calendar-view.tsx`
 * bleibt bewusst UNANGETASTET (Server Component, S1/S2-Testselektoren
 * dürfen nicht brechen) — diese Komponente ist eine eigenständige,
 * zusätzliche Liste derselben Wochen-Schichten mit eigenen Aktionen.
 *
 * Feldbeschriftungen bewusst NICHT „Von"/„Bis" (Kollisionsgefahr mit dem
 * Schicht-Button-`aria-label`, das „... bis HH:MM Uhr ..." enthält — siehe
 * PHASENSTATUS.md „Schichtplan Block S2" für den entsprechenden
 * Locator-Bug aus S2) — stattdessen „Neue Startzeit"/„Neue Endzeit".
 */
type FormState = { mode: "change" | "cancel"; shiftId: string } | null;

function statusBadgeStyle(status: "pending" | "approved" | "rejected"): { color: string; background: string } {
  if (status === "approved") return { color: "#1F8A5B", background: "#E3F2EA" };
  if (status === "rejected") return { color: "#B24343", background: "#F6E4E4" };
  return { color: "#1A1A2E", background: "#F7EED4" };
}

function ChangeForm({
  shift,
  pending,
  onSubmit,
  onClose,
}: {
  shift: CalendarShiftRow;
  pending: boolean;
  onSubmit: (date: string, startTime: string, endTime: string, breakMinutes: number, reason: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("learn.shiftCalendar.changeRequests");
  const uid = useId();
  const starts = new Date(shift.startsAt);
  const ends = new Date(shift.endsAt);
  const [date, setDate] = useState(isoDateString(starts));
  const [startTime, setStartTime] = useState(toTimeInputValue(starts));
  const [endTime, setEndTime] = useState(toTimeInputValue(ends));
  const [breakMinutes, setBreakMinutes] = useState(String(shift.breakMinutes));
  const [reason, setReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(date, startTime, endTime, Number(breakMinutes) || 0, reason);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-sm border border-border-100 bg-bg p-4">
      <h3 className="text-[15px] font-bold text-ink">{t("formChangeHeading")}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`${uid}-date`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("newDateLabel")}
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
            {t("newStartLabel")}
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
            {t("newEndLabel")}
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
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-break`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("newBreakLabel")}
          </label>
          <input
            id={`${uid}-break`}
            type="number"
            min={0}
            max={480}
            step={5}
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
            className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-reason`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("reasonLabel")}
          </label>
          <input
            id={`${uid}-reason`}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {pending ? t("submittingButton") : t("submitButton")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm border border-border-300 bg-white px-4 py-2.5 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {t("closeButton")}
        </button>
      </div>
    </form>
  );
}

function CancelForm({
  pending,
  onSubmit,
  onClose,
}: {
  pending: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("learn.shiftCalendar.changeRequests");
  const uid = useId();
  const [reason, setReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm(t("cancelConfirm"))) return;
    onSubmit(reason);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-sm border border-border-100 bg-bg p-4">
      <h3 className="text-[15px] font-bold text-ink">{t("formCancelHeading")}</h3>
      <div>
        <label htmlFor={`${uid}-reason`} className="mb-1.5 block text-sm font-semibold text-navy">
          {t("reasonLabel")}
        </label>
        <input
          id={`${uid}-reason`}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-sm px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          style={{ background: "#B24343" }}
        >
          {pending ? t("submittingButton") : t("submitButton")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm border border-border-300 bg-white px-4 py-2.5 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {t("closeButton")}
        </button>
      </div>
    </form>
  );
}

export function ShiftChangeRequestPanel({
  shifts,
  requests,
}: {
  shifts: CalendarShiftRow[];
  requests: CalendarChangeRequestRow[];
}) {
  const t = useTranslations("learn.shiftCalendar.changeRequests");
  const [formState, setFormState] = useState<FormState>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // `requests` kommt sortiert nach created_at DESC (neueste zuerst,
  // getWorkerChangeRequests()) — bei mehreren Anfragen für dieselbe Schicht
  // (z. B. eine bereits entschiedene plus eine neue offene) muss die
  // NEUESTE gewinnen. `new Map(requests.map(...))` würde stattdessen die
  // ÄLTESTE gewinnen lassen (spätere .set()-Aufrufe überschreiben frühere),
  // deshalb hier explizit nur den ersten Treffer je shiftId übernehmen.
  const requestByShiftId = new Map<string, CalendarChangeRequestRow>();
  for (const r of requests) {
    if (!requestByShiftId.has(r.shiftId)) requestByShiftId.set(r.shiftId, r);
  }
  const visibleShifts = shifts.filter((s) => s.status === "planned" || s.status === "confirmed");

  function submit(shiftId: string, kind: "update" | "cancel", extra: { date?: string; startTime?: string; endTime?: string; breakMinutes?: number; reason: string }) {
    setError(null);
    startTransition(async () => {
      const reason = extra.reason.trim() === "" ? undefined : extra.reason.trim();
      const result =
        kind === "update"
          ? await createShiftChangeRequest({
              kind: "update",
              shiftId,
              date: extra.date!,
              startTime: extra.startTime!,
              endTime: extra.endTime!,
              breakMinutes: extra.breakMinutes ?? 0,
              reason,
            })
          : await createShiftChangeRequest({ kind: "cancel", shiftId, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFormState(null);
    });
  }

  return (
    <section aria-labelledby="shift-change-requests-heading" className="rounded-[14px] border border-border-100 bg-white p-6">
      <h2 id="shift-change-requests-heading" className="text-[17px] font-bold text-ink">
        {t("heading")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted-500">{t("description")}</p>

      {visibleShifts.length === 0 ? (
        <p className="text-sm text-muted-500">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[#EEF0F7]">
          {visibleShifts.map((shift) => {
            const starts = new Date(shift.startsAt);
            const ends = new Date(shift.endsAt);
            const request = requestByShiftId.get(shift.id);
            const isPendingRequest = request?.status === "pending";
            const isFormOpen = formState?.shiftId === shift.id;
            const badge = request ? statusBadgeStyle(request.status) : null;
            const statusLabel =
              request?.status === "approved" ? t("statusApproved") : request?.status === "rejected" ? t("statusRejected") : t("statusPending");

            return (
              <li key={shift.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {formatDayLabel(starts)}, {formatTimeRange(starts, ends)} Uhr
                    </p>
                    {shift.projectName && <p className="text-xs text-muted-500">{shift.projectName}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {request && (
                      <span
                        className="rounded-lg px-3 py-1.5 text-[13px] font-bold"
                        style={{ color: badge!.color, background: badge!.background }}
                      >
                        {statusLabel}
                      </span>
                    )}
                    {/* Knöpfe erscheinen immer, nur bei einer OFFENEN Anfrage
                        deaktiviert — eine bereits entschiedene (approved/
                        rejected) Anfrage darf eine neue Anfrage für dieselbe
                        Schicht nicht dauerhaft blockieren. */}
                    <button
                      type="button"
                      disabled={isPendingRequest}
                      onClick={() => setFormState({ mode: "change", shiftId: shift.id })}
                      className="rounded-sm border border-border-300 bg-white px-3 py-2 text-sm font-semibold text-navy disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {t("changeButton")}
                    </button>
                    <button
                      type="button"
                      disabled={isPendingRequest}
                      onClick={() => setFormState({ mode: "cancel", shiftId: shift.id })}
                      className="rounded-sm border px-3 py-2 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                      style={{ borderColor: "#E3C0C0", color: "#B24343" }}
                    >
                      {t("cancelButton")}
                    </button>
                  </div>
                </div>

                {isPendingRequest && <p className="text-xs text-muted-500">{t("alreadyPending")}</p>}
                {request && request.status !== "pending" && request.decisionNote && (
                  <p className="text-xs text-muted-500">
                    {t("decisionNoteLabel")}: {request.decisionNote}
                  </p>
                )}

                {isFormOpen && formState?.mode === "change" && (
                  <ChangeForm
                    shift={shift}
                    pending={pending}
                    onSubmit={(date, startTime, endTime, breakMinutes, reason) =>
                      submit(shift.id, "update", { date, startTime, endTime, breakMinutes, reason })
                    }
                    onClose={() => setFormState(null)}
                  />
                )}
                {isFormOpen && formState?.mode === "cancel" && (
                  <CancelForm
                    pending={pending}
                    onSubmit={(reason) => submit(shift.id, "cancel", { reason })}
                    onClose={() => setFormState(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: "#B24343" }}>
          {error}
        </p>
      )}
    </section>
  );
}
