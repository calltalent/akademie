import type { ReactNode } from "react";
import { LayoutDashboard, Building2, ShieldCheck, LogOut } from "lucide-react";
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
 *
 * `ownAdminUrl` NEU (19.07.2026, Josips Auftrag): Link zurück in den
 * Admin-Bereich des Calltalent-eigenen Mandanten, direkt über "Abmelden" —
 * das Portal-Team pflegt seine eigenen Kurse dort genau wie jeder andere
 * Mandant. Bewusst ein normales `<a>` statt `next/link`: das Ziel liegt auf
 * einem ANDEREN Host (z. B. academy.calltalent.ai vs. portal.calltalent.ai),
 * `next/link`s clientseitiges Prefetching/Routing greift über Hosts hinweg
 * ohnehin nicht. `layout.tsx` berechnet die URL server-seitig über
 * `tenantOrigin()` — hier nur Anzeige, keine eigene Logik. Fehlt der
 * Mandant aus irgendeinem Grund (siehe layout.tsx), wird der Punkt still
 * ausgeblendet statt auf einen kaputten Link zu zeigen.
 */
export function PortalShell({
  children,
  ownAdminUrl,
}: {
  children: ReactNode;
  ownAdminUrl?: string;
}) {
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

        <div className="mt-auto pt-6">
          {ownAdminUrl && (
            <a
              href={ownAdminUrl}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-white/5"
            >
              <ShieldCheck aria-hidden="true" size={18} />
              Zum Admin-Bereich
            </a>
          )}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-white/5"
            >
              <LogOut aria-hidden="true" size={18} />
              Abmelden
            </button>
          </form>
        </div>
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
