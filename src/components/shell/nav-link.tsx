"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Design-Block (12.07.2026, DESIGN-MASTERPROMPT.md, Folgeauftrag "durch das
 * ganze Projekt ziehen"): EIN gemeinsamer Sidebar-Nav-Link für Lernenden-
 * Bereich (app-shell.tsx), Mandanten-Admin (admin-shell.tsx) und
 * Betreiber-Portal (portal-shell.tsx) — bewusst eine gemeinsame Datei statt
 * drei ähnlicher Kopien, sonst laufen die drei Bereiche optisch/interaktiv
 * über Zeit auseinander.
 *
 * "use client": aktiver Zustand über `usePathname()`, damit jede Shell den
 * aktiven Menüpunkt selbst herleitet, ohne dass jede Seite ihn manuell als
 * Prop reichen muss (Fehlerquelle bei neuen Unterseiten).
 *
 * `variant` trägt den bewussten Hell/Dunkel-Unterschied aus portal/layout.tsx
 * weiter (dort dokumentiert: dunkles Schema, damit das Betreiber-Portal nie
 * mit einer Mandanten-Oberfläche verwechselt wird) — gleiche Struktur/
 * gleiches Verhalten, andere Farbwerte.
 *
 * `indigo` (12.07.2026, Josips erster Fund): Zwischenstand, als die dunkle
 * Indigo-Sidebar als freigegebenes Design galt — inzwischen durch den
 * Claude-Design-Export vom selben Tag abgelöst (siehe `white` unten und
 * PHASENSTATUS.md Abschnitt "Design-Update — Claude-Design-Export").
 * Bleibt für admin-shell.tsx/portal-shell.tsx unverändert nutzbar, wird für
 * die AppShell (Lernenden-Bereich) nicht mehr verwendet.
 *
 * `white` NEU (12.07.2026, Claude-Design-Export
 * `claude.ai/design/p/890b98ed-af1b-4360-8b96-b9076f8986cd`, von Josip als
 * verbindlich bestätigt): weißer Sidebar-Hintergrund, volle Periwinkle-
 * Pille als aktiver Zustand (kein Rahmen, wie `indigo`), zusätzlich
 * einklappbar über `expanded` — im eingeklappten Zustand nur Icon +
 * `title`-Tooltip, kein Label/Badge-Text (kein Layout-Sprung, Icon bleibt
 * an derselben Stelle).
 *
 * `admin` NEU (12.07.2026, Claude-Design-Export Teil 2, AdminSidebar.dc.html):
 * dunkle Indigo-Sidebar für den Mandanten-Admin-Bereich (admin-shell.tsx),
 * aktiver Zustand als CREME-Pille (nicht Periwinkle wie `indigo`/`white`) —
 * bewusst eigene Variante statt Wiederverwendung von `indigo`, damit
 * Lernenden- und Admin-Bereich auch am aktiven Zustand unterscheidbar
 * bleiben (Verwechslungsgefahr laut CLAUDE.md-Grundsatz "Betreiber-Portal
 * nie mit Mandanten-Oberfläche verwechseln" gilt sinngemäß auch hier).
 */
type Variant = "light" | "dark" | "indigo" | "white" | "admin";

const VARIANT_STYLES: Record<
  Variant,
  { idle: string; activeText: string; activeBg: string; hoverBg: string }
> = {
  light: {
    idle: "var(--foreground)",
    activeText: "var(--color-primary)",
    activeBg: "var(--color-cream)",
    hoverBg: "rgba(0,0,0,0.03)",
  },
  dark: {
    idle: "#cbd5e1", // slate-300
    activeText: "#c7cdf0", // heller Periwinkle-Ton, lesbar auf dunklem Grund
    activeBg: "rgba(86,99,174,0.22)", // Periwinkle bei ~22% Deckkraft
    hoverBg: "rgba(255,255,255,0.04)",
  },
  indigo: {
    idle: "#EDEDF7",
    activeText: "#ffffff",
    activeBg: "#5663AE", // volle Periwinkle-Füllung
    hoverBg: "rgba(255,255,255,0.08)",
  },
  white: {
    idle: "#3E3F66", // Indigo-Dark, Branding/BRANDING.md §3
    activeText: "#FFFFFF",
    activeBg: "#5663AE", // volle Periwinkle-Füllung, wie im Claude-Design-Export
    hoverBg: "rgba(62,63,102,0.06)",
  },
  admin: {
    idle: "#DDDEEE",
    activeText: "#1A1A2E",
    activeBg: "#F7EED4", // Creme, wie im Claude-Design-Export (AdminSidebar.dc.html)
    hoverBg: "rgba(255,255,255,0.06)",
  },
};

export function NavLink({
  href,
  label,
  icon,
  exact = false,
  variant = "light",
  badge,
  expanded = true,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
  variant?: Variant;
  badge?: string;
  /** Nur für variant="white" relevant: eingeklappte Sidebar zeigt nur das Icon. */
  expanded?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const styles = VARIANT_STYLES[variant];
  const collapsed = variant === "white" && !expanded;

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors${collapsed ? " justify-center" : ""}`}
      style={
        active
          ? variant === "indigo" || variant === "white" || variant === "admin"
            ? { background: styles.activeBg, color: styles.activeText, fontWeight: 500 }
            : {
                background: styles.activeBg,
                color: styles.activeText,
                fontWeight: 500,
                borderLeft: `3px solid ${variant === "light" ? "var(--color-primary)" : "#7f89cf"}`,
                paddingLeft: "9px",
              }
          : { color: styles.idle }
      }
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = styles.hoverBg;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
      {!collapsed && <span className="flex-1">{label}</span>}
      {!collapsed && badge && (
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ background: styles.activeBg, color: styles.activeText }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
