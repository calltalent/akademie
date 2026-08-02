import { getTranslations } from "next-intl/server";
import { checkStaffAccess } from "@/lib/auth/staff";
import { checkPlatformAccess } from "@/lib/platform/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/admin-shell";

/**
 * Design-Block (12.07.2026, Claude-Design-Export Teil 2, siehe
 * admin-shell.tsx-Kommentar): zwei zusätzliche, rein lesende Abfragen für
 * die neue Sidebar — `isPlatformAdmin` (Doppel-Rolle-Check, Josips
 * Freigabe) und die echte Anzahl offener Abgaben fürs Badge. Beides fehlt
 * bei einem Fehler defensiv (false / 0) statt den ganzen Admin-Bereich zu
 * blockieren — reine Navigations-Zusatzinfo, kein Sicherheits-Gate.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const access = await checkStaffAccess();

  if (!access.ok) {
    const t = await getTranslations("admin.shell");
    const reasonText: Record<string, string> = {
      "no-tenant": t("reasonNoTenant"),
      "not-authenticated": t("reasonNotAuthenticated"),
      "not-staff": t("reasonNotStaff"),
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

  const platformAccess = await checkPlatformAccess();

  const supabase = await createClient();
  const { count: pendingSubmissions } = await supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", access.tenant.id)
    .eq("status", "submitted");

  return (
    <AdminShell
      tenantName={access.tenant.name}
      isPlatformAdmin={platformAccess.ok}
      pendingSubmissions={pendingSubmissions ?? 0}
    >
      {children}
    </AdminShell>
  );
}
