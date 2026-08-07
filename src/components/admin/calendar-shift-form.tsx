"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { CalendarShiftInput } from "@/lib/calendar/schema";
import { isoDateString, toTimeInputValue } from "@/lib/calendar/date";

/**
 * Gemeinsames Formular für "Schicht anlegen" und "Schicht bearbeiten"
 * (Block S2, 08.08.2026) — exaktes Muster wie `calendar-worker-form.tsx`
 * (S1): native Eingaben, echte `<label>`-Zuordnung über `htmlFor`/`useId()`,
 * kein Custom-Widget. Im Bearbeitungsmodus zusätzlich ein Storno-Knopf.
 *
 * Zeitfenster-Auswahl ist auf Slots DESSELBEN Projekts UND Tages
 * eingeschränkt (Plan-Vorgabe) — der Kapazitäts-/Konsistenz-Trigger in der
 * DB (`calendar_slot_capacity_guard()`, S2-Migration) würde ein
 * abweichendes Projekt/eine abweichende Zeit ohnehin ablehnen (CT002/CT003),
 * diese Einschränkung ist die freundliche UX-Vorstufe dazu.
 */
export function CalendarShiftForm({
  workers,
  projects,
  slots,
  initial,
  editing,
  pending,
  onSubmit,
  onCancelShift,
  onClose,
}: {
  workers: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  slots: { id: string; projectId: string | null; startsAt: string; endsAt: string }[];
  initial: Partial<CalendarShiftInput> & { workerId: string; date: string };
  editing: boolean;
  pending: boolean;
  onSubmit: (input: CalendarShiftInput) => void;
  onCancelShift?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("admin.shiftCalendar.shifts");
  const uid = useId();

  const [workerId, setWorkerId] = useState(initial.workerId);
  const [projectId, setProjectId] = useState(initial.projectId ?? "");
  const [slotId, setSlotId] = useState(initial.slotId ?? "");
  const [date, setDate] = useState(initial.date);
  const [startTime, setStartTime] = useState(initial.startTime ?? "08:00");
  const [endTime, setEndTime] = useState(initial.endTime ?? "16:00");
  const [breakMinutes, setBreakMinutes] = useState(String(initial.breakMinutes ?? 0));
  const [note, setNote] = useState(initial.note ?? "");

  // Nur Zeitfenster desselben Projekts UND Tages — Slots ohne Projekt (kann
  // laut Schema nicht vorkommen, project_id ist bei calendar_slots Pflicht)
  // tauchen hier nie auf.
  const availableSlots = useMemo(
    () => slots.filter((s) => (!projectId || s.projectId === projectId) && isoDateString(new Date(s.startsAt)) === date),
    [slots, projectId, date],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      workerId,
      projectId: projectId === "" ? undefined : projectId,
      slotId: slotId === "" ? undefined : slotId,
      date,
      startTime,
      endTime,
      breakMinutes: Number(breakMinutes) || 0,
      note: note.trim() === "" ? undefined : note.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-sm border border-border-100 bg-bg p-4">
      <h3 className="text-[15px] font-bold text-ink">{editing ? t("formEditHeading") : t("formHeading")}</h3>

      <div>
        <label htmlFor={`${uid}-worker`} className="mb-1.5 block text-sm font-semibold text-navy">
          {t("workerLabel")}
        </label>
        <select
          id={`${uid}-worker`}
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          required
          className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
        >
          <option value="" disabled>
            {t("workerPlaceholder")}
          </option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${uid}-project`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("projectLabel")}
          </label>
          <select
            id={`${uid}-project`}
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setSlotId("");
            }}
            className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
          >
            <option value="">{t("projectPlaceholder")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-slot`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("slotLabel")}
          </label>
          <select
            id={`${uid}-slot`}
            value={slotId}
            onChange={(e) => setSlotId(e.target.value)}
            className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
          >
            <option value="">{t("slotPlaceholder")}</option>
            {availableSlots.map((s) => (
              <option key={s.id} value={s.id}>
                {toTimeInputValue(new Date(s.startsAt))}
                {"–"}
                {toTimeInputValue(new Date(s.endsAt))}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${uid}-date`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("dateLabel")}
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
            {t("startTimeLabel")}
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
            {t("endTimeLabel")}
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${uid}-break`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("breakMinutesLabel")}
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
          <label htmlFor={`${uid}-note`} className="mb-1.5 block text-sm font-semibold text-navy">
            {t("noteLabel")}
          </label>
          <input
            id={`${uid}-note`}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
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
          {pending ? t("savingButton") : editing ? t("saveButton") : t("addButton")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm border border-border-300 bg-white px-4 py-2.5 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {t("closeButton")}
        </button>
        {editing && onCancelShift && (
          <button
            type="button"
            disabled={pending}
            onClick={onCancelShift}
            className="ml-auto rounded-sm border px-4 py-2.5 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            style={{ borderColor: "#E3C0C0", color: "#B24343" }}
          >
            {t("cancelShiftButton")}
          </button>
        )}
      </div>
    </form>
  );
}
