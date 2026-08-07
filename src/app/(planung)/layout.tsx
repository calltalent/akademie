import { getTranslations } from "next-intl/server";
import { checkShiftPlannerAccess } from "@/lib/calendar/access";
import { checkPlatformAccess } from "@/lib/platform/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/admin-shell";

/**
 * Route-Gruppe "(planung)" (Schichtplan Block S3, 09.08.2026) — enthält
 * ausschließlich `/admin/schichtplanung` (verschoben aus `(admin)`, reines
 * Code-Refactoring, URL unverändert, siehe PHASENSTATUS.md). Eigenes Layout
 * statt Wiederverwendung von `(admin)/admin/layout.tsx`, weil dort
 * `checkStaffAccess()` (owner/admin/trainer) gated — ein Projektleiter ohne
 * Staff-Rolle (reine `member`-Kursrolle + `calendar_projects.lead_user_id`)
 * käme durch dieses Gate NICHT durch. `checkShiftPlannerAccess()`
 * (`src/lib/calendar/access.ts`) lässt zusätzlich Projektleiter durch.
 *
 * `restrictedToShiftCalendar={!access.isAdmin}` blendet in der Sidebar/
 * Mobile-Nav alle Menüpunkte außer "Schichtplanung" aus — ein Projektleiter
 * hat sonst keinen sichtbaren (und über RLS ohnehin keinen tatsächlichen)
 * Zugriff auf Teilnehmer/Kurse/Abgaben/etc. `isPlatformAdmin`/
 * `pendingSubmissions` werden nur für echte Admins ermittelt (Projektleiter
 * sehen den Bereich ohnehin nicht) — vermeidet unnötige Abfragen/Zugriffe
 * auf `submissions`, für die ein Projektleiter ohne Staff-Rolle laut RLS
 * gar keine Berechtigung hätte.
 */
export default async function PlanungLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const access = await checkShiftPlannerAccess();

  if (!access.ok) {
    const t = await getTranslations("admin.shell");
    const reasonText: Record<typeof access.reason, string> = {
      "no-tenant": t("reasonNoTenant"),
      "not-authenticated": t("reasonNotAuthenticated"),
      "feature-disabled": t("reasonShiftCalendarDisabled"),
      "not-allowed": t("reasonNotShiftPlanner"),
    };
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-start justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">{t("accessDeniedHeading")}</h1>
        <p className="text-base">{reasonText[access.reason]}</p>
        {access.reason === "not-authenticated" && (
          <a href="/login" className="rounded-md bg-black px-4 py-2 text-base text-white">
            {t("goToLoginButton")}
          </a>
        )}
      </main>
    );
  }

  let isPlatformAdmin = false;
  let pendingSubmissions = 0;
  if (access.isAdmin) {
    const [platformAccess, supabase] = await Promise.all([checkPlatformAccess(), createClient()]);
    isPlatformAdmin = platformAccess.ok;
    const { count } = await supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", access.tenant.id)
      .eq("status", "submitted");
    pendingSubmissions = count ?? 0;
  }

  return (
    <AdminShell
      tenantName={access.tenant.name}
      logoUrl={access.tenant.branding?.logo_url ?? null}
      isPlatformAdmin={isPlatformAdmin}
      pendingSubmissions={pendingSubmissions}
      marketplaceEnabled={access.isAdmin && access.tenant.settings.marketplace_enabled === true}
      shiftCalendarEnabled
      restrictedToShiftCalendar={!access.isAdmin}
    >
      {children}
    </AdminShell>
  );
}
