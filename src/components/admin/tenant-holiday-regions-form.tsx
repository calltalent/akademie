"use client";

import { useActionState, useId } from "react";
import { useTranslations } from "next-intl";
import { updateTenantHolidayRegions } from "@/lib/tenant/actions";
import { initialCourseActionState } from "@/lib/courses/state";
import { CALENDAR_HOLIDAY_REGIONS, type CalendarHolidayRegionCode } from "@/lib/calendar/schema";

/**
 * Block S5a (08.08.2026, KI-Feiertagsrecherche, architect-Plan
 * "plane-und-erstelle-mit-floofy-curry-agent-a2931f285e454e395.md"
 * Abschnitt 11.5): eigene Karte im Reiter "Allgemein", eigene Server Action
 * `updateTenantHolidayRegions()`. BEWUSST NICHT Teil von
 * `TenantSettingsForm` — würde diese Karte ausgeblendet (weil der Schichtplan
 * deaktiviert ist), liefert `formData.getAll()` bei einem gemeinsamen
 * Formular `[]` und würde die gespeicherte Regionsauswahl bei jedem
 * Speichern der allgemeinen Einstellungen stillschweigend löschen (Risiko 8
 * im architect-Plan). Diese Karte wird zusätzlich nur gerendert, wenn
 * `shift_calendar_enabled === true` (Gate in einstellungen-tabs.tsx) — die
 * Server Action prüft dasselbe serverseitig noch einmal, nie nur
 * clientseitig vertrauen.
 *
 * Checkbox-Gruppen-Optik 1:1 aus der `enabledLocales`-Karte in
 * `tenant-settings-form.tsx` übernommen (fieldset/legend/useId). Die drei
 * Bosnien-Entitäten stehen bewusst als eigene, ausformulierte Zeilen
 * ("Bosnien und Herzegowina — Föderation BiH" usw.) statt eines separaten
 * Gruppen-Labels — sie sind ohnehin durch `CALENDAR_HOLIDAY_REGIONS`
 * benachbart sortiert, ein zusätzlicher Zwischenkopf hätte nur eine weitere
 * i18n-Zeile gekostet, ohne die Lesbarkeit spürbar zu verbessern.
 */
export function TenantHolidayRegionsForm({ holidayRegions }: { holidayRegions: CalendarHolidayRegionCode[] }) {
  const t = useTranslations("admin.settings.holidayRegions");
  const tRegion = useTranslations("admin.shiftCalendar.absences.region");
  const tAdminCommon = useTranslations("admin.common");
  const tCommon = useTranslations("common");
  const uid = useId();
  const [state, action, pending] = useActionState(updateTenantHolidayRegions, initialCourseActionState);

  return (
    <div className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-1 text-[17px] font-bold">{t("heading")}</div>
      <div className="mb-5 text-sm" style={{ color: "#A9AAC4" }}>
        {t("subtitle")}
      </div>
      <form action={action} className="flex flex-col gap-4">
        <fieldset className="border-0 p-0">
          <legend className="mb-2 text-sm font-semibold" style={{ color: "#3E3F66" }}>
            {t("legend")}
          </legend>
          <div className="flex flex-col gap-2.5">
            {CALENDAR_HOLIDAY_REGIONS.map((region) => (
              <label
                key={region}
                htmlFor={`${uid}-${region}`}
                className="flex items-center gap-2.5 text-[15px]"
                style={{ color: "#3E3F66" }}
              >
                <input
                  id={`${uid}-${region}`}
                  type="checkbox"
                  name="holidayRegions"
                  value={region}
                  defaultChecked={holidayRegions.includes(region)}
                  className="h-4 w-4 rounded-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {tRegion(region)}
              </label>
            ))}
          </div>
        </fieldset>

        {holidayRegions.length === 0 && (
          <p className="text-[13px]" style={{ color: "#A9AAC4" }}>
            {t("emptyHint")}
          </p>
        )}

        {state.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        {state.success && !state.error && (
          <p role="status" aria-live="polite" className="text-sm" style={{ color: "#1F8A5B" }}>
            {t("savedNotice")}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex rounded-[11px] px-6 py-[13px] text-[15px] font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            style={{ background: "#5663AE" }}
          >
            {pending ? tAdminCommon("saving") : tCommon("save")}
          </button>
        </div>
      </form>
    </div>
  );
}
