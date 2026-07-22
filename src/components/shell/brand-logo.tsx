/**
 * Wortmarke in der Sidebar — Konstruktionsregel Branding/BRANDING.md §2:
 * "CALLTALENT" (ExtraBold-artig, Versalien) + kleinerer, gesperrter
 * Sub-Label darunter. `subLabel` unterscheidet die drei Bereiche
 * (AKADEMIE / ADMIN / PORTAL), ohne die Wortmarke selbst zu verändern.
 *
 * `variant` analog nav-link.tsx. `white` NEU (12.07.2026, Claude-Design-
 * Export, siehe nav-link.tsx-Kommentar): eigener Rendering-Zweig mit
 * quadratischer "C"-Logomarke (Periwinkle-Kachel) links neben der
 * Wortmarke — im Export vorhanden, in den bisherigen Varianten fehlte die
 * Logomarke ganz. Bewusst nur für `white` ergänzt, damit light/indigo
 * (admin-shell.tsx) optisch unverändert bleiben — reine Design-Aufgabe für
 * das Studenten-Portal, keine Änderung an Admin/Portal.
 * `expanded=false` blendet nur den Text aus, die Logomarke bleibt sichtbar
 * (Wiedererkennung auch in der eingeklappten Sidebar).
 *
 * `dark` NEU (19.07.2026, Claude-Design-Import PortalSidebar.dc.html): die
 * Logomarke jetzt auch fürs Betreiber-Portal — der frische Export zeigt sie
 * dort ausdrücklich, anders als beim ursprünglichen 12.07.-Export. Nutzt
 * denselben Rendering-Zweig wie `white`/`admin` (identische Kachel-Optik,
 * nur der Wortmarken-/Sublabel-Farbwert unterscheidet sich weiterhin über
 * `WORDMARK_COLOR`/`SUBLABEL_COLOR`).
 *
 * `compact` NEU (22.07.2026, Josips Fund: Logo in der mobilen Portal-
 * Kopfzeile saß nicht auf gleicher Höhe wie der Hamburger-Button daneben):
 * `mb-6` ist für den Sidebar-Einsatz gedacht (Abstand zu den Nav-Punkten
 * darunter) — in einer horizontalen `items-center`-Reihe (portal-mobile-
 * nav.tsx) zählt dieser Rand mit in die Höhe der Logo-Box hinein und
 * verschiebt dadurch die von Flexbox berechnete Mitte gegenüber dem
 * Button ohne einen solchen Rand. `compact` blendet `mb-6` aus, ohne die
 * bestehende Sidebar-Nutzung (PortalShell) zu berühren.
 */
type Variant = "light" | "dark" | "indigo" | "white" | "admin";

const WORDMARK_COLOR: Record<Variant, string> = {
  light: "var(--foreground)",
  dark: "#f8fafc",
  indigo: "#ffffff",
  white: "#1A1A2E",
  admin: "#FFFFFF",
};

const SUBLABEL_COLOR: Record<Variant, string> = {
  light: "var(--color-primary)",
  dark: "var(--color-primary)",
  indigo: "#B4B5D6",
  white: "#66679B",
  admin: "#B9BBDA",
};

export function BrandLogo({
  subLabel,
  variant = "light",
  expanded = true,
  compact = false,
}: {
  subLabel: string;
  variant?: Variant;
  expanded?: boolean;
  compact?: boolean;
}) {
  if (variant === "white" || variant === "admin" || variant === "dark") {
    return (
      <div className={`flex items-center gap-3 px-2 ${compact ? "" : "mb-6"}`}>
        <span
          className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] text-lg font-extrabold"
          style={{ background: "var(--color-primary)", color: "var(--color-cream)" }}
          aria-hidden="true"
        >
          C
        </span>
        {expanded && (
          <div className="leading-tight">
            <p className="text-[15px] font-extrabold tracking-tight" style={{ color: WORDMARK_COLOR[variant] }}>
              CALLTALENT
            </p>
            <p className="text-[11px] font-semibold" style={{ color: SUBLABEL_COLOR[variant], letterSpacing: "0.28em" }}>
              {subLabel}
            </p>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mb-6 px-2">
      <p className="text-base font-semibold tracking-tight" style={{ color: WORDMARK_COLOR[variant] }}>
        CALLTALENT
      </p>
      <p
        className="text-xs font-light"
        style={{ color: SUBLABEL_COLOR[variant], letterSpacing: "0.25em" }}
      >
        {subLabel}
      </p>
    </div>
  );
}
