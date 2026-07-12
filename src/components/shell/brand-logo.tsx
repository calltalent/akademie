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
 * Logomarke ganz. Bewusst nur für `white` ergänzt, damit light/dark/indigo
 * (admin-shell.tsx, portal-shell.tsx) optisch unverändert bleiben — reine
 * Design-Aufgabe für das Studenten-Portal, keine Änderung an Admin/Portal.
 * `expanded=false` blendet nur den Text aus, die Logomarke bleibt sichtbar
 * (Wiedererkennung auch in der eingeklappten Sidebar).
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
}: {
  subLabel: string;
  variant?: Variant;
  expanded?: boolean;
}) {
  if (variant === "white" || variant === "admin") {
    return (
      <div className="mb-6 flex items-center gap-3 px-2">
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
