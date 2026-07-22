"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X, LayoutDashboard, Building2, ShieldCheck, LogOut } from "lucide-react";
import { BrandLogo } from "@/components/shell/brand-logo";
import { NavLink } from "@/components/shell/nav-link";
import { SectionLabel } from "@/components/shell/section-label";

/**
 * NEU (22.07.2026, Josips Auftrag: "Mandantenbereich für Mobile optimieren").
 * `PortalShell` hatte bisher NUR die feste `w-56`-Sidebar aus portal-shell.tsx
 * — unter `lg` (1024px) blieb die auf jeder Seite sichtbar und quetschte den
 * Inhalt auf ~150px zusammen (live geprüft: Wörter brachen einzeln um,
 * "Monatlich"-Tab lief aus dem Viewport). Klassisches Sidebar->Top-Bar-Muster:
 * unter `lg` ersetzt eine schmale Kopfzeile (Logo + Hamburger) die Sidebar,
 * ein Ausklapp-Panel darunter trägt dieselben Links wie die Desktop-Sidebar
 * (bewusst KEINE zweite Quelle für die Navigation — nur zwei Einträge
 * "Übersicht"/"Mandanten" + Admin-Link/Abmelden, ein Duplizieren wäre hier
 * unproblematisch gewesen, aber inkonsistent mit dem Rest des Projekts, das
 * Nav-Items nirgendwo doppelt pflegt).
 *
 * Schließt sich automatisch bei Routenwechsel — ohne das bliebe das Panel
 * nach einem Link-Klick offen, weil `PortalShell` Teil des persistenten
 * `portal/layout.tsx` ist und beim Navigieren nicht neu gemountet wird.
 * Bewusst KEIN `useEffect`, das `setOpen(false)` bei `pathname`-Änderung
 * aufruft (React-Hooks-Lint verbietet synchrones `setState` im Effekt-Body,
 * siehe react.dev "you-might-not-need-an-effect") — stattdessen das dort
 * dokumentierte "State beim Rendern anpassen"-Muster: `prevPathname` wird
 * WÄHREND des Renderns verglichen, `setOpen`/`setPrevPathname` laufen direkt
 * im Funktionskörper, nicht in einem Effekt.
 */
export function PortalMobileNav({ ownAdminUrl }: { ownAdminUrl?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);

  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  return (
    <div className="border-b border-slate-800 lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <BrandLogo subLabel="PORTAL" variant="dark" compact />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="portal-mobile-menu"
          aria-label={open ? "Menü schließen" : "Menü öffnen"}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-md text-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>

      {open && (
        <nav
          id="portal-mobile-menu"
          aria-label="Hauptnavigation"
          className="flex flex-col gap-1 border-t border-slate-800 px-3 pb-4 pt-3"
        >
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
        </nav>
      )}
    </div>
  );
}
