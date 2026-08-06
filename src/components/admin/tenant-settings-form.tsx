"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { updateTenantSettings } from "@/lib/tenant/actions";
import { initialCourseActionState } from "@/lib/courses/state";
import { DEFAULT_LOCALE, LOCALE_NAMES, SUPPORTED_LOCALES, type Locale } from "@/i18n/config";

function ToggleRow({
  name,
  label,
  desc,
  defaultChecked,
}: {
  name: string;
  label: string;
  desc: string;
  defaultChecked: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5" style={{ borderTop: "1px solid #F2F3F9" }}>
      <div>
        <div className="text-[15px] font-semibold">{label}</div>
        <div className="text-[13px]" style={{ color: "#A9AAC4" }}>
          {desc}
        </div>
      </div>
      <label className="relative inline-flex h-[26px] w-11 flex-none cursor-pointer items-center">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full transition-colors"
          style={{ background: "#D8DAEA" }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full opacity-0 transition-opacity peer-checked:opacity-100"
          style={{ background: "#5663AE" }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[3px] h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-[18px]"
        />
      </label>
    </div>
  );
}

/**
 * Design-Block 6 (13.07.2026, AdminEinstellungen.dc.html): echte, gespeicherte
 * Version der "Akademie"- und "Plattform-Optionen"-Karten. Alle drei Schalter
 * sind ECHT persistiert (tenants.settings) und wirken sich tatsächlich aus
 * (Selbstregistrierung: auth/actions.ts, Zertifikate: certificates/issue.ts,
 * Wartungsmodus: seit dem Folgeblock vom 06.08.2026 ECHT durchgesetzt über
 * das Gate in middleware.ts, siehe Kopfkommentar bei `maintenance_enabled`
 * in lib/tenant/types.ts).
 */
export function TenantSettingsForm({
  name,
  supportEmail,
  selfSignupEnabled,
  certificatesEnabled,
  maintenanceEnabled,
  enabledLocales,
  defaultLocale,
}: {
  name: string;
  supportEmail: string;
  selfSignupEnabled: boolean;
  certificatesEnabled: boolean;
  maintenanceEnabled: boolean;
  /** i18n Block B5 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4): aktuell freigeschaltete Sprachen + Standardsprache dieses Mandanten. */
  enabledLocales: Locale[];
  defaultLocale: Locale;
}) {
  const t = useTranslations("admin.settings.tenantForm");
  const tSettings = useTranslations("admin.settings");
  const tAdminCommon = useTranslations("admin.common");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(updateTenantSettings, initialCourseActionState);

  // Client-seitiger Zustand NUR für die Sprachen-Karte (Rest des Formulars
  // bleibt unkontrolliert/uncontrolled wie bisher) — nötig, damit das
  // Standardsprache-<select> beim Abwählen einer Sprache automatisch auf
  // "de" zurückfällt (Plan Bedingung 1: Standardsprache muss freigeschaltet
  // bleiben, hier strukturell verhindert statt erst nach dem Absenden als
  // Fehler gemeldet — serverseitig prüft updateTenantSettings() trotzdem
  // erneut, siehe lib/tenant/actions.ts).
  const [enabled, setEnabled] = useState<Locale[]>(enabledLocales);
  const [selectedDefault, setSelectedDefault] = useState<Locale>(defaultLocale);

  function toggleLocale(locale: Locale, checked: boolean) {
    setEnabled((prev) => {
      const next = checked ? [...new Set([...prev, locale])] : prev.filter((l) => l !== locale);
      if (!checked && selectedDefault === locale) setSelectedDefault(DEFAULT_LOCALE);
      return next;
    });
  }

  return (
    <form action={action} className="flex flex-col gap-[22px]">
      <div className="rounded-[14px] border bg-white px-7 py-[26px]" style={{ borderColor: "#E7E8F2" }}>
        <div className="mb-1 text-[17px] font-bold">{t("academyHeading")}</div>
        <div className="mb-5 text-sm" style={{ color: "#A9AAC4" }}>
          {t("academySubtitle")}
        </div>
        <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
          <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
            {tSettings("nameLabel")}
            <input
              name="name"
              type="text"
              required
              defaultValue={name}
              className="rounded-[11px] border px-[15px] py-[13px] text-base font-normal"
              style={{ borderColor: "#D8DAEA" }}
            />
          </label>
          <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
            {t("supportEmailLabel")}
            <input
              name="supportEmail"
              type="email"
              defaultValue={supportEmail}
              className="rounded-[11px] border px-[15px] py-[13px] text-base font-normal"
              style={{ borderColor: "#D8DAEA" }}
            />
          </label>
        </div>
      </div>

      <div className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
        <div className="mb-1 text-[17px] font-bold">{t("platformOptionsHeading")}</div>
        <ToggleRow
          name="selfSignup"
          label={t("selfSignupLabel")}
          desc={t("selfSignupDesc")}
          defaultChecked={selfSignupEnabled}
        />
        <ToggleRow
          name="certificates"
          label={t("certificatesLabel")}
          desc={t("certificatesDesc")}
          defaultChecked={certificatesEnabled}
        />
        <ToggleRow
          name="maintenance"
          label={t("maintenanceLabel")}
          desc={t("maintenanceDesc")}
          defaultChecked={maintenanceEnabled}
        />
      </div>

      {/* i18n Block B5: Sprachen dieses Mandanten — welche Lernende wählen
          können ("enabled_locales") und welche standardmäßig gilt
          ("default_locale"), z. B. für E-Mails/Zertifikate (Josips
          Entscheidung, Plan Kopf: Mandanten-Standardsprache statt
          individueller Nutzereinstellung). */}
      <div className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
        <div className="mb-1 text-[17px] font-bold">{t("languagesHeading")}</div>
        <div className="mb-5 text-sm" style={{ color: "#A9AAC4" }}>
          {t("languagesSubtitle")}
        </div>

        <fieldset className="mb-5 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold" style={{ color: "#3E3F66" }}>
            {t("enabledLocalesLegend")}
          </legend>
          <div className="flex flex-col gap-2.5">
            {/* Deutsch ist nie abwählbar (Plan Abschnitt 5) — als fest
                markierte, deaktivierte Checkbox sichtbar statt nur im
                Backend still erzwungen. Ein `disabled`-Input wird NICHT mit
                abgeschickt, deshalb zusätzlich der versteckte Pflichtwert
                daneben. */}
            <label className="flex items-center gap-2.5 text-[15px]" style={{ color: "#3E3F66" }}>
              <input type="checkbox" checked disabled />
              {LOCALE_NAMES[DEFAULT_LOCALE]}
              <span className="text-[13px]" style={{ color: "#A9AAC4" }}>
                {t("alwaysActiveSuffix")}
              </span>
            </label>
            <input type="hidden" name="enabledLocales" value={DEFAULT_LOCALE} />

            {SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE).map((locale) => (
              <label
                key={locale}
                className="flex items-center gap-2.5 text-[15px]"
                style={{ color: "#3E3F66" }}
              >
                <input
                  type="checkbox"
                  name="enabledLocales"
                  value={locale}
                  checked={enabled.includes(locale)}
                  onChange={(e) => toggleLocale(locale, e.target.checked)}
                />
                {LOCALE_NAMES[locale]}
              </label>
            ))}
          </div>
        </fieldset>

        <label
          className="flex max-w-xs flex-col gap-[7px] text-sm font-semibold"
          style={{ color: "#3E3F66" }}
          htmlFor="default-locale-select"
        >
          {t("defaultLocaleLabel")}
          <select
            id="default-locale-select"
            name="defaultLocale"
            value={selectedDefault}
            onChange={(e) => setSelectedDefault(e.target.value as Locale)}
            className="rounded-[11px] border px-[15px] py-[13px] text-base font-normal"
            style={{ borderColor: "#D8DAEA" }}
          >
            {SUPPORTED_LOCALES.filter((locale) => enabled.includes(locale)).map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_NAMES[locale]}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-[13px]" style={{ color: "#A9AAC4" }}>
          {t("defaultLocaleHint")}
        </p>
      </div>

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
          className="inline-flex rounded-[11px] px-6 py-[13px] text-[15px] font-bold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          {pending ? tAdminCommon("saving") : tCommon("save")}
        </button>
      </div>
    </form>
  );
}
