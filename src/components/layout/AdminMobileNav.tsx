"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { AdminSidebar } from "@/components/layout/AdminSidebar";

/**
 * Mobile Kopfzeile für /admin (23.07.2026, Josips Auftrag "Admin-Bereich
 * und Lernansicht für mobile Geräte optimieren") — gleiches Muster wie
 * `components/portal/portal-mobile-nav.tsx` (22.07.2026, dort bereits
 * live geprüft): unter `lg` ersetzt diese schmale Leiste (Logo + Hamburger)
 * die feste 264px-Schiene aus `AdminSidebar.tsx`, ein Ausklapp-Panel
 * darunter rendert `<AdminSidebar variant="panel" />` — DIESELBE Komponente,
 * keine zweite, separat gepflegte Nav-Liste (Admin hat mit ~10 Punkten in
 * 5 Gruppen + Badges deutlich mehr Drift-Risiko als die 2 Portal-Links).
 *
 * Schließt automatisch bei Routenwechsel — "State beim Rendern anpassen"-
 * Muster (react.dev "you-might-not-need-an-effect") statt `useEffect`,
 * exakt wie in portal-mobile-nav.tsx begründet.
 */
export function AdminMobileNav({
  isPlatformAdmin = false,
  pendingSubmissions = 0,
  tenantName = "Calltalent",
  logoUrl = null,
}: {
  isPlatformAdmin?: boolean;
  pendingSubmissions?: number;
  /** Mandanten-Wortmarke/-Logo (03.08.2026, Josips Fund: "Logo im Admin-
   * Bereich ist immer noch Calltalent") — siehe AdminSidebar.tsx. */
  tenantName?: string;
  logoUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);

  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  return (
    <div className="lg:hidden" style={{ background: "#3E3F66" }}>
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/admin" prefetch={false} className="flex min-h-[30px] items-center gap-2.5 no-underline">
          {logoUrl ? (
            // Weiße Kachel wie AdminSidebar.tsx (dunkles Marken-Panel, siehe dort).
            <div className="flex h-[26px] flex-none items-center rounded-[6px] bg-white px-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert */}
              <img src={logoUrl} alt={tenantName} className="h-[18px] w-auto max-w-[140px] object-contain" />
            </div>
          ) : (
            <>
              <span
                className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] bg-accent text-[15px] font-extrabold text-cream"
                aria-hidden="true"
              >
                {tenantName.charAt(0).toUpperCase()}
              </span>
              <span className="truncate text-[13px] font-extrabold tracking-[0.02em] text-white">
                {tenantName.toUpperCase()} ADMIN
              </span>
            </>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="admin-mobile-menu"
          aria-label={open ? "Menü schließen" : "Menü öffnen"}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-md focus:outline-none focus:ring-2 focus:ring-white/40"
          style={{ color: "#DDDEEE" }}
        >
          {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>

      {open && (
        <div
          id="admin-mobile-menu"
          className="max-h-[75vh] overflow-y-auto"
          style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}
        >
          <AdminSidebar variant="panel" isPlatformAdmin={isPlatformAdmin} pendingSubmissions={pendingSubmissions} />
        </div>
      )}
    </div>
  );
}
