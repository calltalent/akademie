import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { AdminMobileNav } from "@/components/layout/AdminMobileNav";
import { HtmlBackgroundSync } from "@/components/shell/html-background-sync";

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
 *
 * Mobile Kopfzeile (23.07.2026, Mobile-Umbau) — `AdminMobileNav` ersetzt
 * unter `lg` die feste Schiene (siehe deren Kopfkommentar + `AdminSidebar.tsx`
 * `variant`-Prop). Gutter `px-10 py-8` gilt jetzt erst ab `lg`, mobil
 * `px-4 py-6` — auf 375px blieben sonst nur ~215px Inhaltsbreite übrig.
 */
export async function AdminShell({
  children,
  tenantName,
  logoUrl = null,
  isPlatformAdmin = false,
  pendingSubmissions = 0,
  marketplaceEnabled = false,
}: {
  children: ReactNode;
  tenantName: string;
  /** Mandanten-Logo (03.08.2026, Josips Fund: "oben links im Admin-Bereich
   * kommt immer noch das Calltalent-Logo") — siehe AdminSidebar.tsx. */
  logoUrl?: string | null;
  isPlatformAdmin?: boolean;
  pendingSubmissions?: number;
  /** Marketplace M2 (03.08.2026) — siehe AdminSidebar.tsx. */
  marketplaceEnabled?: boolean;
}) {
  const t = await getTranslations("admin.shell");

  return (
    <>
      <AdminMobileNav
        tenantName={tenantName}
        logoUrl={logoUrl}
        isPlatformAdmin={isPlatformAdmin}
        pendingSubmissions={pendingSubmissions}
        marketplaceEnabled={marketplaceEnabled}
      />
      <div className="flex min-h-screen" style={{ background: "#F4F5FA" }}>
        <HtmlBackgroundSync color="#F4F5FA" />
        <AdminSidebar
          tenantName={tenantName}
          logoUrl={logoUrl}
          isPlatformAdmin={isPlatformAdmin}
          pendingSubmissions={pendingSubmissions}
          marketplaceEnabled={marketplaceEnabled}
        />

        <div className="min-w-0 flex-1 px-4 py-6 lg:px-10 lg:py-8">
          <div className="mb-6">
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-primary)" }}>
              {t("eyebrow")}
            </p>
            <h1 className="text-2xl font-semibold" style={{ color: "var(--foreground)" }}>
              {tenantName}
            </h1>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}
