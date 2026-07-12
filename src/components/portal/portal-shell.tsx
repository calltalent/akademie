import type { ReactNode } from "react";
import { LayoutDashboard, Building2, LogOut } from "lucide-react";
import { NavLink } from "@/components/shell/nav-link";
import { SectionLabel } from "@/components/shell/section-label";
import { BrandLogo } from "@/components/shell/brand-logo";

/**
 * Design-Block (12.07.2026, Folgeauftrag "durch das ganze Projekt ziehen"):
 * Betreiber-Portal-Sidebar nach demselben Muster wie app-shell.tsx/
 * admin-shell.tsx (gleiche Bausteine aus components/shell/*), ABER bewusst
 * dunkles Farbschema — siehe portal/layout.tsx-Kommentar: das Portal soll
 * NIE mit einer Mandanten-Oberfläche verwechselt werden können (hier wird
 * teamweit über ALLE Mandanten verwaltet, hohe Fehlerreichweite). Periwinkle
 * bleibt trotzdem die einzige Akzentfarbe (aktiver Menüpunkt), damit das
 * Design-Konzept trotz Hell/Dunkel-Unterschied erkennbar dasselbe bleibt.
 */
export function PortalShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl">
      <aside
        className="flex w-56 flex-shrink-0 flex-col gap-1 border-r border-slate-800 px-3 py-6"
        aria-label="Hauptnavigation"
      >
        <BrandLogo subLabel="PORTAL" variant="dark" />

        <SectionLabel variant="dark">Verwaltung</SectionLabel>
        <NavLink
          href="/portal"
          label="Übersicht"
          exact
          variant="dark"
          icon={<LayoutDashboard aria-hidden="true" size={18} />}
        />
        <NavLink
          href="/portal/mandanten"
          label="Mandanten"
          variant="dark"
          icon={<Building2 aria-hidden="true" size={18} />}
        />

        <form action="/auth/signout" method="post" className="mt-auto pt-6">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-white/5"
          >
            <LogOut aria-hidden="true" size={18} />
            Abmelden
          </button>
        </form>
      </aside>

      <div className="min-w-0 flex-1 px-8 py-8">
        <p className="mb-6 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-primary)" }}>
          Betreiber-Portal — nur für das Calltalent-Team
        </p>
        {children}
      </div>
    </div>
  );
}
