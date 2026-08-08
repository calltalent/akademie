"use server";

import { revalidatePath } from "next/cache";
import { requireAdminTenant } from "@/lib/auth/staff";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";
import type { CourseActionState } from "@/lib/courses/state";
import { parseTenantLocaleSettings } from "@/lib/tenant/locale-settings";
import { parseTenantHolidayRegions } from "@/lib/calendar/schema";

/**
 * Design-Block 6 (13.07.2026, AdminEinstellungen.dc.html): neue, ECHTE
 * Mandanten-Einstellungsverwaltung (Akademie-Name, Support-E-Mail, drei
 * Plattform-Schalter) — vorher gab es dafür GAR KEINEN Schreibweg von der
 * Mandanten-Admin-Seite aus (nur den Betreiber-Portal-eigenen `updateTenant()`
 * in lib/platform/actions.ts, der nur name/plan/status/custom_domain schreibt
 * und ausschließlich Calltalent-Plattform-Admins vorbehalten ist).
 *
 * `requireAdminTenant()` (owner/admin, RLS-Policy `tenants_admin_update`
 * erlaubt genau das) statt des laxeren `requireStaffTenant()` — bewusst
 * strenger, gleiche Begründung wie bei der Nutzerverwaltung.
 *
 * Schreibt über den regulären, session-gebundenen Client (RLS-geprüft),
 * NICHT über den Admin-/Service-Role-Client — es gibt keinen Grund, RLS hier
 * zu umgehen.
 */
export async function updateTenantSettings(
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireAdminTenant();

    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      return { error: "Name darf nicht leer sein." };
    }
    const supportEmailRaw = String(formData.get("supportEmail") ?? "").trim();

    // i18n Block B5 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4): Nutzereingabe
    // eines Mandanten-Admins — zod-geprüft in lib/tenant/locale-settings.ts,
    // bevor sie in tenants.settings (jsonb) landet. "de" wird dort immer
    // erzwungen, unabhängig davon, was das Formular schickt.
    const localesResult = parseTenantLocaleSettings({
      defaultLocaleRaw: String(formData.get("defaultLocale") ?? ""),
      enabledLocalesRaw: formData.getAll("enabledLocales").map(String),
    });
    if (!localesResult.ok) {
      return { error: localesResult.error };
    }

    const mergedSettings = {
      ...tenant.settings,
      support_email: supportEmailRaw || undefined,
      self_signup_enabled: formData.get("selfSignup") === "on",
      certificates_enabled: formData.get("certificates") === "on",
      maintenance_enabled: formData.get("maintenance") === "on",
      default_locale: localesResult.defaultLocale,
      enabled_locales: localesResult.enabledLocales,
    };

    const { error } = await supabase
      .from("tenants")
      .update({ name, settings: mergedSettings })
      .eq("id", tenant.id);
    if (error) {
      return { error: "Speichern fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath("/admin/einstellungen");
    return { error: null, success: true };
  } catch (e) {
    return { error: genericErrorMessage(e) };
  }
}

/**
 * Block S5a (08.08.2026, KI-Feiertagsrecherche, architect-Plan
 * "plane-und-erstelle-mit-floofy-curry-agent-a2931f285e454e395.md"
 * Abschnitt 11.5): eigene, kleine Server Action statt einer Erweiterung von
 * `updateTenantSettings()` oben — Begründung siehe Kopfkommentar von
 * `TenantHolidayRegionsForm` (Datenverlust-Risiko: `formData.getAll()`
 * liefert `[]`, sobald die Karte ausgeblendet ist, weil
 * `shift_calendar_enabled` false ist; eine gemeinsame Action würde die
 * gespeicherte Regionsauswahl dann bei jedem Speichern der allgemeinen
 * Einstellungen stillschweigend löschen). MERGE-Schreibweise wie oben —
 * niemals `settings` komplett überschreiben.
 *
 * Gate auf `shift_calendar_enabled === true`: die Regionsauswahl ist ohne
 * aktiven Schichtplan bedeutungslos (es gibt dann keine Abwesenheiten-Seite,
 * die sie anzeigen könnte) — serverseitig geprüft, nicht nur durch das
 * Ausblenden der Karte in einstellungen-tabs.tsx.
 */
export async function updateTenantHolidayRegions(
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireAdminTenant();

    if (tenant.settings.shift_calendar_enabled !== true) {
      return { error: "Der Schichtplan ist für diese Akademie nicht aktiviert." };
    }

    let regions;
    try {
      regions = parseTenantHolidayRegions(formData.getAll("holidayRegions"));
    } catch {
      return { error: "Unbekannte Region." };
    }

    const mergedSettings = {
      ...tenant.settings,
      shift_calendar_holiday_regions: regions,
    };

    const { error } = await supabase.from("tenants").update({ settings: mergedSettings }).eq("id", tenant.id);
    if (error) {
      return { error: "Speichern fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath("/admin/einstellungen");
    revalidatePath("/admin/schichtplanung");
    return { error: null, success: true };
  } catch (e) {
    return { error: genericErrorMessage(e) };
  }
}
