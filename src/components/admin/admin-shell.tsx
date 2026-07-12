import type { ReactNode } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  BookOpen,
  Sparkles,
  ClipboardCheck,
  BarChart3,
  CreditCard,
  Users,
  Upload,
  Settings,
  Building2,
  GraduationCap,
  LogOut,
} from "lucide-react";
import { NavLink } from "@/components/shell/nav-link";
import { SectionLabel } from "@/components/shell/section-label";
import { BrandLogo } from "@/components/shell/brand-logo";

/**
 * Design-Block (12.07.2026, Claude-Design-Export Teil 2
 * `AdminSidebar.dc.html`, von Josip als verbindlich bestätigt — siehe
 * PHASENSTATUS.md "Design-Update Teil 2"). Löst die vorherige helle
 * Sidebar (Josip-Fund vom selben Tag, damals bewusst hell laut SPEC.md
 * §4.5) ab — jetzt dunkles Indigo-Schema mit Creme-Pille als aktivem
 * Zustand, `variant="admin"` in nav-link.tsx/section-label.tsx/
 * brand-logo.tsx.
 *
 * Zwei Josip-Entscheidungen aus dieser Sitzung umgesetzt:
 * 1. "Mandanten" (Gruppe PLATTFORM) nur sichtbar, wenn `isPlatformAdmin`
 *    true ist (Doppel-Rolle-Check, siehe admin/layout.tsx —
 *    `checkPlatformAccess()`). Reine Mandanten-Admins (owner/admin des
 *    eigenen Mandanten) sehen den Punkt NICHT — Mandanten-Verwaltung
 *    bleibt exklusiv im Betreiber-Portal (/portal), keine
 *    Sicherheitsgrenze aufgeweicht.
 * 2. Die vier im Export fehlenden, aber real funktionierenden Bereiche
 *    (KI-Generator, Reporting, Zahlungen, Import) wieder ergänzt, in die
 *    naheliegendsten Gruppen einsortiert.
 *
 * "Abgaben"-Badge zeigt die echte Anzahl offener (status='submitted')
 * Abgaben des Mandanten (admin/layout.tsx übergibt `pendingSubmissions`) —
 * keine erfundene Zahl.
 *
 * "Abmelden" bleibt erhalten (im Export nicht vorhanden, aber notwendige
 * echte Funktion) — als eigener Button unter "Zur Lernansicht".
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
      <aside
        className="flex w-[264px] flex-shrink-0 flex-col py-6"
        style={{ background: "#3E3F66" }}
        aria-label="Verwaltungs-Navigation"
      >
        <div className="px-[22px]">
          <BrandLogo subLabel="ADMIN" variant="admin" />
        </div>
        <div
          className="mx-[22px] mb-6 inline-block self-start rounded-lg px-2.5 py-1.5 text-[11px] font-bold"
          style={{ letterSpacing: "0.14em", color: "#8688B8", background: "rgba(255,255,255,0.08)" }}
        >
          VERWALTUNG
        </div>

        <nav className="flex-1 overflow-y-auto px-4">
          <SectionLabel variant="admin">Übersicht</SectionLabel>
          <NavLink
            href="/admin"
            label="Dashboard"
            exact
            variant="admin"
            icon={<LayoutDashboard aria-hidden="true" size={18} />}
          />

          <SectionLabel variant="admin">Inhalte</SectionLabel>
          <NavLink href="/admin/kurse" label="Kurse" variant="admin" icon={<BookOpen aria-hidden="true" size={18} />} />
          <NavLink
            href="/admin/ki"
            label="KI-Generator"
            variant="admin"
            icon={<Sparkles aria-hidden="true" size={18} />}
          />
          <NavLink
            href="/admin/abgaben"
            label="Abgaben"
            variant="admin"
            icon={<ClipboardCheck aria-hidden="true" size={18} />}
            badge={pendingSubmissions > 0 ? String(pendingSubmissions) : undefined}
          />

          <SectionLabel variant="admin">Auswertung</SectionLabel>
          <NavLink
            href="/admin/reporting"
            label="Reporting"
            variant="admin"
            icon={<BarChart3 aria-hidden="true" size={18} />}
          />
          <NavLink
            href="/admin/zahlungen"
            label="Zahlungen"
            variant="admin"
            icon={<CreditCard aria-hidden="true" size={18} />}
          />

          <SectionLabel variant="admin">Nutzer</SectionLabel>
          <NavLink href="/admin/nutzer" label="Teilnehmer" variant="admin" icon={<Users aria-hidden="true" size={18} />} />
          <NavLink href="/admin/import" label="Import" variant="admin" icon={<Upload aria-hidden="true" size={18} />} />

          <SectionLabel variant="admin">Plattform</SectionLabel>
          {isPlatformAdmin && (
            <NavLink
              href="/portal/mandanten"
              label="Mandanten"
              variant="admin"
              icon={<Building2 aria-hidden="true" size={18} />}
            />
          )}
          <NavLink
            href="/admin/einstellungen"
            label="Einstellungen"
            variant="admin"
            icon={<Settings aria-hidden="true" size={18} />}
          />
        </nav>

        <div className="flex flex-col gap-1 px-4 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}>
          <Link
            href="/"
            className="flex items-center gap-3 rounded-[11px] px-3 py-2 text-sm font-medium"
            style={{ color: "#B9BBDA" }}
          >
            <GraduationCap aria-hidden="true" size={18} />
            Zur Lernansicht
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2 text-sm font-medium"
              style={{ color: "#B9BBDA" }}
            >
              <LogOut aria-hidden="true" size={18} />
              Abmelden
            </button>
          </form>
        </div>
      </aside>

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
