"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createCalendarAbsence, deleteCalendarAbsence } from "@/lib/calendar/actions";
import type { CalendarAbsenceKind, CalendarAbsenceRow, CalendarHolidayRegionCode } from "@/lib/calendar/schema";
import { CalendarHolidaysKiPanel } from "@/components/admin/calendar-holidays-ki-panel";
import { CalendarHolidaysKiReview } from "@/components/admin/calendar-holidays-ki-review";
import type { HolidayResearchJobDetail, HolidayResearchJobListRow } from "@/lib/calendar/ai/holidays/queries";

/**
 * Abwesenheiten & Feiertage (Block S2, 08.08.2026) — Jahresauswahl, getrennte
 * Listen Feiertage/persönliche Abwesenheiten, Anlageformular (bei
 * kind="holiday" ist das Arbeiter-Feld deaktiviert/geleert — Feiertage
 * gelten mandantenweit, siehe DB-CHECK `(kind = 'holiday') = (worker_id is
 * null)`, Migrationskopf S1).
 *
 * Block S5c (08.08.2026): der frühere deterministische Feiertagsimport-Block
 * (`importCalendarHolidays()`, nur DE/AT/CH) ist VOLLSTÄNDIG ERSETZT durch
 * die KI-Feiertagsrecherche (`CalendarHolidaysKiPanel`/
 * `CalendarHolidaysKiReview`, admin-only wie bei der KI-Schichtplanung).
 * Ohne gewählte Region (`holidayRegions.length === 0`, Mandanten-Einstellung
 * aus Block S5a) erscheint statt des Formulars ein Hinweis mit Link zu den
 * Einstellungen — ein geöffneter Auftrag (`holidayJobDetail` gesetzt) zeigt
 * die Review-Ansicht statt des Auslöse-Formulars.
 *
 * DSGVO-Hinweis (SPEC.md §12, Art. 9 DSGVO): `kind="sick"` ist ein
 * Gesundheitsdatum. Die Notiz zeigt deshalb explizit den Hinweis, KEINE
 * Diagnosen einzutragen — reine UX-Warnung, keine technische Beschränkung
 * (das Feld ist ein Freitext, eine harte Validierung wäre unmöglich und
 * würde legitime Nutzung wie "halber Tag" verhindern).
 */
const KIND_OPTIONS: CalendarAbsenceKind[] = ["vacation", "holiday", "sick", "other"];

export function CalendarAbsencesPanel({
  workers,
  absences,
  year,
  holidayRegions,
  holidayJobs,
  holidayJobDetail,
}: {
  workers: { id: string; fullName: string | null; email: string }[];
  absences: CalendarAbsenceRow[];
  year: number;
  holidayRegions: CalendarHolidayRegionCode[];
  holidayJobs: HolidayResearchJobListRow[];
  holidayJobDetail: HolidayResearchJobDetail | null;
}) {
  const t = useTranslations("admin.shiftCalendar.absences");
  const uid = useId();
  const router = useRouter();

  const holidays = absences.filter((a) => a.kind === "holiday");
  const personal = absences.filter((a) => a.kind !== "holiday");

  function workerName(id: string | null): string {
    if (!id) return "";
    const w = workers.find((x) => x.id === id);
    return w ? w.fullName || w.email : "";
  }

  function goToYear(nextYear: number) {
    router.push(`?tab=absences&year=${nextYear}`);
  }

  function openHolidayJob(jobId: string) {
    router.push(`?tab=absences&year=${year}&holidayJob=${jobId}`);
  }

  // --- Anlageformular ------------------------------------------------
  const [kind, setKind] = useState<CalendarAbsenceKind>("vacation");
  const [workerId, setWorkerId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, startAdd] = useTransition();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    startAdd(async () => {
      const result = await createCalendarAbsence({
        workerId: kind === "holiday" ? undefined : workerId || undefined,
        kind,
        startsOn,
        endsOn,
        note: note.trim() === "" ? undefined : note.trim(),
      });
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      setStartsOn("");
      setEndsOn("");
      setNote("");
    });
  }

  // --- Löschen ---------------------------------------------------------
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowPending, startRowTransition] = useTransition();

  function handleDelete(id: string) {
    if (!window.confirm(t("deleteConfirm"))) return;
    startRowTransition(async () => {
      const result = await deleteCalendarAbsence(id);
      if (!result.ok) setRowError((prev) => ({ ...prev, [id]: result.error }));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between rounded-[14px] border border-border-100 bg-white px-5 py-3.5">
        <h2 className="text-[17px] font-bold text-ink">{t("heading")}</h2>
        <div className="flex items-center gap-2">
          <label htmlFor={`${uid}-year`} className="text-sm font-semibold text-navy">
            {t("yearLabel")}
          </label>
          <select
            id={`${uid}-year`}
            value={year}
            onChange={(e) => goToYear(Number(e.target.value))}
            className="rounded-sm border border-border-300 bg-white px-3 py-2 text-sm text-ink"
          >
            {Array.from({ length: 5 }, (_, i) => year - 2 + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="-mt-4 text-sm text-muted-500">{t("description")}</p>

      <section aria-labelledby={`${uid}-holidays-heading`} className="overflow-hidden rounded-[14px] border border-border-100 bg-white">
        <div className="p-[24px_28px_16px]">
          <h3 id={`${uid}-holidays-heading`} className="text-[17px] font-bold text-ink">
            {t("holidaysHeading")}
          </h3>
        </div>
        {holidays.length === 0 ? (
          <p className="px-[28px] py-6 text-sm text-muted-500">{t("emptyHolidays")}</p>
        ) : (
          <ul className="divide-y divide-[#EEF0F7]">
            {holidays.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-[28px] py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {a.startsOn}
                    {a.endsOn !== a.startsOn ? ` – ${a.endsOn}` : ""}
                  </p>
                  {a.note && <p className="text-sm text-muted-500">{a.note}</p>}
                  {rowError[a.id] && (
                    <p role="alert" className="text-sm text-[#B24343]">
                      {rowError[a.id]}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={rowPending}
                  onClick={() => handleDelete(a.id)}
                  className="rounded-sm border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  style={{ borderColor: "#E3C0C0", color: "#B24343" }}
                >
                  {t("deleteButton")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${uid}-personal-heading`} className="overflow-hidden rounded-[14px] border border-border-100 bg-white">
        <div className="p-[24px_28px_16px]">
          <h3 id={`${uid}-personal-heading`} className="text-[17px] font-bold text-ink">
            {t("personalHeading")}
          </h3>
        </div>
        {personal.length === 0 ? (
          <p className="px-[28px] py-6 text-sm text-muted-500">{t("emptyPersonal")}</p>
        ) : (
          <ul className="divide-y divide-[#EEF0F7]">
            {personal.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-[28px] py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {workerName(a.workerId)} · {t(`kind.${a.kind}`)}
                  </p>
                  <p className="text-sm text-muted-500">
                    {a.startsOn}
                    {a.endsOn !== a.startsOn ? ` – ${a.endsOn}` : ""}
                    {a.note ? ` · ${a.note}` : ""}
                  </p>
                  {rowError[a.id] && (
                    <p role="alert" className="text-sm text-[#B24343]">
                      {rowError[a.id]}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={rowPending}
                  onClick={() => handleDelete(a.id)}
                  className="rounded-sm border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  style={{ borderColor: "#E3C0C0", color: "#B24343" }}
                >
                  {t("deleteButton")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${uid}-add-heading`} className="rounded-[14px] border border-border-100 bg-white p-[26px_28px]">
        <h3 id={`${uid}-add-heading`} className="mb-4 text-[17px] font-bold text-ink">
          {t("addHeading")}
        </h3>
        <form onSubmit={handleAdd} className="flex flex-col gap-3">
          <div className="grid max-w-2xl grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${uid}-kind`} className="mb-1.5 block text-sm font-semibold text-navy">
                {t("kindLabel")}
              </label>
              <select
                id={`${uid}-kind`}
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as CalendarAbsenceKind;
                  setKind(next);
                  if (next === "holiday") setWorkerId("");
                }}
                className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-worker`} className="mb-1.5 block text-sm font-semibold text-navy">
                {t("workerLabel")}
              </label>
              <select
                id={`${uid}-worker`}
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
                disabled={kind === "holiday"}
                required={kind !== "holiday"}
                className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink disabled:opacity-50"
              >
                <option value="" disabled>
                  {t("workerPlaceholder")}
                </option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.fullName || w.email}
                  </option>
                ))}
              </select>
              {kind === "holiday" && <p className="mt-1 text-xs text-muted-500">{t("workerDisabledForHoliday")}</p>}
            </div>
          </div>

          <div className="grid max-w-2xl grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${uid}-starts`} className="mb-1.5 block text-sm font-semibold text-navy">
                {t("startsOnLabel")}
              </label>
              <input
                id={`${uid}-starts`}
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                required
                className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-ends`} className="mb-1.5 block text-sm font-semibold text-navy">
                {t("endsOnLabel")}
              </label>
              <input
                id={`${uid}-ends`}
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                required
                className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
              />
            </div>
          </div>

          <div className="max-w-2xl">
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
            {kind === "sick" && <p className="mt-1 text-xs text-muted-500">{t("sickNoteHint")}</p>}
          </div>

          <button
            type="submit"
            disabled={addPending}
            className="w-fit rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {addPending ? t("addingButton") : t("addButton")}
          </button>
        </form>
        {addError && (
          <p role="alert" className="mt-3 text-sm text-[#B24343]">
            {addError}
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-[14px] border border-border-100 bg-white">
        {holidayRegions.length === 0 ? (
          <div className="p-[26px_28px]">
            <h3 className="mb-2 text-[17px] font-bold text-ink">{t("holidayKi.heading")}</h3>
            <p className="text-sm text-muted-500">{t("holidayKi.noRegions")}</p>
            <Link href="/admin/einstellungen" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">
              {t("holidayKi.noRegionsLink")}
            </Link>
          </div>
        ) : holidayJobDetail ? (
          <CalendarHolidaysKiReview job={holidayJobDetail} backHref={`?tab=absences&year=${year}`} />
        ) : (
          <CalendarHolidaysKiPanel holidayRegions={holidayRegions} jobs={holidayJobs} onOpenJob={openHolidayJob} />
        )}
      </section>
    </div>
  );
}
