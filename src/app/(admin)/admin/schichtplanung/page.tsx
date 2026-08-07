import { getTranslations } from "next-intl/server";
import { checkAdminAccess } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { SchichtplanungTabs } from "@/components/admin/schichtplanung-tabs";
import { getActiveCalendarWorkersForSelection, getAdminCalendarProjects, getAdminCalendarWorkers, getMembershipsWithoutWorker } from "@/lib/calendar/queries";

/**
 * "Schichtplanung" (Block S1, 07.08.2026) — Admin-Bereich unter
 * `/admin/schichtplanung`. Zugriff über `checkAdminAccess()` (owner/admin),
 * NICHT `checkStaffAccess()` (schlösse `trainer` ein) — deckt sich mit
 * `calendar_is_admin()` in der Migration (Verwaltungsrechte laufen über
 * `member_role(tenant_id) in ('owner','admin')`, siehe Migrationskopf-
 * Begründung Punkt 2). Gleiches Zugriffs-UI-Muster wie
 * `admin/einstellungen/page.tsx`.
 *
 * Sichtbarkeit des Menüpunkts selbst (Sidebar) läuft über
 * `tenant.settings.shift_calendar_enabled` — diese Seite prüft das Flag
 * bewusst NICHT zusätzlich (gleiches Prinzip wie `admin/marketplace/page.tsx`:
 * das Flag steuert nur die Navigation, ein direkter Aufruf der URL ohne
 * Freischaltung liefert einfach eine leere/normale Verwaltungsseite statt
 * eines Fehlers — RLS blockiert ohnehin nichts Zusätzliches hier, das Flag
 * ist reine Marketing-/Abrechnungssteuerung des Betreiber-Portals).
 */
export default async function AdminSchichtplanungPage() {
  const t = await getTranslations("admin.shiftCalendar");
  const tTeilnehmer = await getTranslations("admin.teilnehmer");
  const access = await checkAdminAccess();

  if (!access.ok) {
    const text =
      access.reason === "not-admin"
        ? tTeilnehmer("accessDeniedNotAdmin")
        : access.reason === "not-authenticated"
          ? tTeilnehmer("accessDeniedNotAuthenticated")
          : tTeilnehmer("accessDeniedNoTenant");
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-base">{text}</p>
      </div>
    );
  }

  const { tenant } = access;
  const supabase = await createClient();

  const [workers, memberships, projects, workerOptions, leadMembershipsRaw] = await Promise.all([
    getAdminCalendarWorkers(supabase, tenant.id),
    getMembershipsWithoutWorker(supabase, tenant.id),
    getAdminCalendarProjects(supabase, tenant.id),
    getActiveCalendarWorkersForSelection(supabase, tenant.id),
    supabase
      .from("memberships")
      .select("user_id, profiles(full_name, email)")
      .eq("tenant_id", tenant.id)
      .eq("status", "active"),
  ]);

  // Projektleiter-Auswahl: JEDES aktive Mandanten-Mitglied, nicht nur
  // bestehende Arbeiter — ein Projektleiter ist projektbezogen, kein
  // globaler Rollentyp, und muss selbst keine Arbeiterzeile haben (Plan
  // Architekturentscheidung 6). Gleicher Embedded-Relation-Fallstrick wie
  // admin/einstellungen/page.tsx (`profiles` kommt als Array zurück).
  const leadOptions = (leadMembershipsRaw.data ?? [])
    .map((m) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      if (!profile?.email) return null;
      return { userId: m.user_id as string, fullName: profile.full_name ?? null, email: profile.email as string };
    })
    .filter((m): m is { userId: string; fullName: string | null; email: string } => m !== null);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
          {t("eyebrow")}
        </div>
        <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
          {t("title")}
        </h1>
      </header>

      <SchichtplanungTabs
        workers={workers}
        memberships={memberships}
        projects={projects}
        leadOptions={leadOptions}
        workerOptions={workerOptions}
      />
    </div>
  );
}
