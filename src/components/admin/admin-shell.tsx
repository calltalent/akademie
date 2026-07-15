import type { ReactNode } from "react";
import { AdminSidebar } from "@/components/layout/AdminSidebar";

/**
 * Verwaltungs-Shell für den /admin-Bereich. Die Sidebar ist seit dem
 * Folgeauftrag „AdminSidebar verwenden" die generische Komponente
 * components/layout/AdminSidebar.tsx (dunkles Indigo aus AdminSidebar.dc.html,
 * aktiver Punkt via usePathname) — inklusive der vier real funktionierenden
 * Bereiche KI-Generator/Reporting/Zahlungen/Import und der „Abmelden"-
 * Funktion, damit die Umstellung keinen Funktionsverlust bedeutet.
 *
 * `isPlatformAdmin` (Mandanten-Punkt nur für Plattform-Admins) und die echte
 * `pendingSubmissions`-Zahl (Abgaben-Badge) kommen aus admin/layout.tsx. Der
 * Zugriff auf den ganzen Bereich ist dort über `checkStaffAccess()`
 * (owner/admin/trainer) gated, die Daten zusätzlich per RLS.
 */
export function AdminShell({
  children,
  tenantName,
  isPlatformAdmin = false,
  pendingSubmissions = 0,
}: {
  children: ReactNode;
  tenantName: string;
  isPlatformAdmin?: boolean;
  pendingSubmissions?: number;
}) {
  return (
    <div className="flex min-h-screen" style={{ background: "#F4F5FA" }}>
      <AdminSidebar isPlatformAdmin={isPlatformAdmin} pendingSubmissions={pendingSubmissions} />

      <div className="min-w-0 flex-1 px-10 py-8">
        <div className="mb-6">
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-primary)" }}>
            Administration
          </p>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--foreground)" }}>
            {tenantName}
          </h1>
        </div>
        {children}
      </div>
    </div>
  );
}
