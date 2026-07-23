"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Sidebar, type SidebarLink } from "@/components/layout/Sidebar";

/**
 * Mobile Kopfzeile für die Lernansicht (23.07.2026, Josips Auftrag
 * "Admin-Bereich und Lernansicht für mobile Geräte optimieren") — gleiches
 * Muster wie `AdminMobileNav.tsx`/`portal-mobile-nav.tsx`: unter `lg`
 * ersetzt diese Leiste (Logo + Hamburger) die feste Schiene aus
 * `Sidebar.tsx`, ein Ausklapp-Panel darunter rendert `<Sidebar variant="panel" />`
 * — DIESELBE Komponente inkl. aller Nav-Items/Badges/customLinks, keine
 * zweite Datenquelle.
 *
 * Schließt automatisch bei Routenwechsel — "State beim Rendern anpassen"-
 * Muster statt `useEffect`, exakt wie in portal-mobile-nav.tsx begründet.
 */
export function LearnMobileNav({
  isStaff = false,
  isPlatformAdmin = false,
  customLinks = [],
}: {
  isStaff?: boolean;
  isPlatformAdmin?: boolean;
  customLinks?: SidebarLink[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);

  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  return (
    <div className="border-b border-border-100 bg-white lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/dashboard" prefetch={false} className="flex items-center gap-2.5 no-underline">
          <span
            className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] bg-accent text-[15px] font-extrabold text-cream"
            aria-hidden="true"
          >
            C
          </span>
          <span className="leading-[1.1]">
            <span className="block text-[13px] font-extrabold tracking-[0.02em] text-ink">CALLTALENT</span>
            <span className="block text-[9px] font-semibold tracking-[0.24em] text-muted-500">AKADEMIE</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="learn-mobile-menu"
          aria-label={open ? "Menü schließen" : "Menü öffnen"}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-md text-navy focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>

      {open && (
        <div id="learn-mobile-menu" className="max-h-[75vh] overflow-y-auto border-t border-border-100">
          <Sidebar
            variant="panel"
            isStaff={isStaff}
            isPlatformAdmin={isPlatformAdmin}
            customLinks={customLinks}
          />
        </div>
      )}
    </div>
  );
}
