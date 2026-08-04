import type { ReactNode } from "react";
import { LayoutDashboard, Building2, Store, Wallet, ShieldCheck, LogOut } from "lucide-react";
import { NavLink } from "@/components/shell/nav-link";
import { SectionLabel } from "@/components/shell/section-label";
import { BrandLogo } from "@/components/shell/brand-logo";
import { PortalMobileNav } from "@/components/portal/portal-mobile-nav";

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
 *
 * Mobile Top-Bar (22.07.2026, Josips Auftrag "Mandantenbereich für Mobile
 * optimieren"): `<aside>` ist jetzt `hidden lg:flex` — unter `lg` übernimmt
 * `PortalMobileNav` (eigene Datei, "use client" wegen Auf/Zu-State) dieselbe
 * Navigation als Kopfzeile mit Ausklapp-Panel. Siehe dortigen Kopfkommentar
 * für die volle Begründung (live gemessen: Sidebar nahm auf 375px Breite
 * ~60% des Viewports ein, Inhalt brach wortweise um).
 *
 * "Zum Admin-Bereich"/"Abmelden" direkt unter der Navigation statt ganz
 * unten (25.07.2026, Josips Auftrag "nach oben versetzen, mit Trennlinie
 * trennen"): `mt-auto` schob beide Links bis ans Ende der Sidebar, weit weg
 * von "Übersicht"/"Mandanten". Jetzt `mt-3 border-t ... pt-3` direkt danach
 * — exakt dasselbe Muster wie in `portal-mobile-nav.tsx`, das diese Trennung
 * schon immer so hatte.
 *
 * `pendingMarketplaceCount` NEU (Marketplace M3, 03.08.2026): Badge-Zahl auf
 * dem "Marketplace"-Menüpunkt (`status='submitted'`-Listings), gleiches
 * Badge-Muster wie `AdminSidebar.tsx`s `pendingSubmissions` — `NavLink`
 * unterstützt das bereits über seine `badge`-Prop (components/shell/nav-link.tsx).
 */
export function PortalShell({
  children,
  ownAdminUrl,
  pendingMarketplaceCount = 0,
}: {
  children: ReactNode;
  ownAdminUrl?: string;
  pendingMarketplaceCount?: number;
}) {
  return (
    <>
      <PortalMobileNav ownAdminUrl={ownAdminUrl} pendingMarketplaceCount={pendingMarketplaceCount} />
      <div className="mx-auto flex min-h-screen max-w-6xl">
        <aside
          className="hidden w-56 flex-shrink-0 flex-col gap-1 border-r border-slate-800 px-3 py-6 lg:flex"
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
          <NavLink
            href="/portal/marketplace"
            label="Marketplace"
            variant="dark"
            icon={<Store aria-hidden="true" size={18} />}
            badge={pendingMarketplaceCount > 0 ? String(pendingMarketplaceCount) : undefined}
          />
          {/* NEU (Marketplace M6, 04.08.2026, Plan Abschnitt 7): zweiter,
             gleichrangiger Eintrag statt eines echten Untermenüs — NavLink
             (components/shell/nav-link.tsx) unterstützt keine verschachtelte
             Navigation, ein eigenes Untermenü-Bauteil wäre eine deutlich
             größere UI-Änderung nur für diesen einen Fall gewesen. Leicht
             eingerückt (`pl-3`), damit die Zugehörigkeit zu "Marketplace"
             trotzdem optisch erkennbar bleibt. Auf `/portal/marketplace/
             auszahlungen` zeigen bewusst BEIDE Einträge als aktiv (Marketplace
             über seinen bestehenden Praefix-Match, siehe NavLink) — das ist
             inhaltlich korrekt (man befindet sich im Marketplace-Bereich,
             konkret bei den Auszahlungen), kein Fehler. */}
          <div className="pl-3">
            <NavLink
              href="/portal/marketplace/auszahlungen"
              label="Auszahlungen"
              variant="dark"
              icon={<Wallet aria-hidden="true" size={18} />}
            />
          </div>

          <div className="mt-3 flex flex-col gap-1 border-t border-slate-800 pt-3">
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

        <div className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <p className="mb-6 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-primary)" }}>
            Betreiber-Portal — nur für das Calltalent-Team
          </p>
          {children}
        </div>
      </div>
    </>
  );
}
