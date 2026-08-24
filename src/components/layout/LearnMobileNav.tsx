"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
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
  showCustomerArea = false,
  showShiftCalendar = false,
  user,
  notifications = [],
  tenantName = "Calltalent",
  logoUrl = null,
  showLegalLinks = false,
}: {
  isStaff?: boolean;
  isPlatformAdmin?: boolean;
  customLinks?: SidebarLink[];
  /** Siehe Sidebar.tsx-Kopfkommentar — unverändert an `<Sidebar variant="panel">` durchgereicht, keine zweite Datenquelle. */
  showCustomerArea?: boolean;
  /** Siehe Sidebar.tsx-Kopfkommentar — unverändert an `<Sidebar variant="panel">` durchgereicht, keine zweite Datenquelle. */
  showShiftCalendar?: boolean;
  user: TopBarUser;
  notifications?: NotificationItem[];
  tenantName?: string;
  logoUrl?: string | null;
  /** Siehe Sidebar.tsx — unverändert an `<Sidebar variant="panel">` durchgereicht. */
  showLegalLinks?: boolean;
}) {
  const t = useTranslations("learn.shell");
  const tAuthShared = useTranslations("auth.shared");
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
          {logoUrl ? (
            // Volles Logo statt Quadrat-Zuschnitt (siehe Sidebar.tsx-Kommentar
            // zum selben Fund) — object-contain zeigt das Logo unbeschnitten.
            // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
            <img src={logoUrl} alt={tenantName} className="h-[30px] w-auto max-w-[140px] object-contain object-left" />
          ) : (
            <>
              <span
                className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] bg-primary text-[15px] font-extrabold text-cream"
                aria-hidden="true"
              >
                {tenantName.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 leading-[1.1]">
                <span className="block truncate text-[13px] font-extrabold tracking-[0.02em] text-ink">
                  {tenantName.toUpperCase()}
                </span>
                <span className="block text-[9px] font-semibold tracking-[0.24em] text-muted-500">{tAuthShared("brandSuffix")}</span>
              </span>
            </>
          )}
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
            aria-label={open ? t("menuCloseLabel") : t("menuOpenLabel")}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-md text-navy focus:outline-none focus:ring-2 focus:ring-primary/40"
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
            showCustomerArea={showCustomerArea}
            showShiftCalendar={showShiftCalendar}
            tenantName={tenantName}
            logoUrl={logoUrl}
            showLegalLinks={showLegalLinks}
          />
        </div>
      )}
    </div>
  );
}
