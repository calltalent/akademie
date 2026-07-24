"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Sidebar, type SidebarLink } from "@/components/layout/Sidebar";
import { NotificationsMenu, ProfileMenu, useExclusiveMenu, type NotificationItem, type TopBarUser } from "@/components/layout/topbar-menus";

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
 *
 * Benachrichtigungen/Profil NEU (24.07.2026, Josips Fund: beide saßen bisher
 * in TopBar.tsx mitten im mehrzeilig umbrechenden Begrüßungstext auf dem
 * Handy) — direkt links neben dem Hamburger, kompakte Variante (Profil nur
 * als Icon, kein Platz für Name+Rolle auf 375px). Gleiche Komponenten wie
 * TopBar.tsx (`topbar-menus.tsx`), keine zweite Kopie der Dropdown-Inhalte.
 * Öffnen eines der beiden Menüs schließt das Ausklapp-Panel (und umgekehrt)
 * — sonst könnten auf 375px zwei „fixed"-Overlays gleichzeitig übereinander
 * liegen.
 */
export function LearnMobileNav({
  isStaff = false,
  isPlatformAdmin = false,
  customLinks = [],
  user,
  notifications = [],
}: {
  isStaff?: boolean;
  isPlatformAdmin?: boolean;
  customLinks?: SidebarLink[];
  user: TopBarUser;
  notifications?: NotificationItem[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);
  const menu = useExclusiveMenu();

  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  return (
    <div className="border-b border-border-100 bg-white lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/dashboard" prefetch={false} className="flex min-w-0 items-center gap-2.5 no-underline">
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

        <div className="flex flex-shrink-0 items-center gap-2">
          <NotificationsMenu
            notifications={notifications}
            compact
            open={menu.notifOpen}
            onToggle={() => {
              setOpen(false);
              menu.toggleNotif();
            }}
            onClose={menu.close}
          />
          <ProfileMenu
            user={user}
            compact
            open={menu.profileOpen}
            onToggle={() => {
              setOpen(false);
              menu.toggleProfile();
            }}
            onClose={menu.close}
          />
          <button
            type="button"
            onClick={() => {
              menu.close();
              setOpen((v) => !v);
            }}
            aria-expanded={open}
            aria-controls="learn-mobile-menu"
            aria-label={open ? "Menü schließen" : "Menü öffnen"}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-md text-navy focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </div>
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
