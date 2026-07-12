/**
 * Gemeinsame Gruppen-Überschrift in allen drei Sidebars, siehe nav-link.tsx.
 * `variant` analog nav-link.tsx. `white` NEU (12.07.2026, Claude-Design-
 * Export, siehe nav-link.tsx-Kommentar) — zusätzlich `expanded`: im
 * eingeklappten Zustand (nur weiße Variante) wird die Gruppen-Überschrift
 * ganz ausgeblendet, exakt wie im Export (`sc-if value="{{ expanded }}"`).
 */
type Variant = "light" | "dark" | "indigo" | "white" | "admin";

const COLORS: Record<Variant, string> = {
  light: "#6b7280",
  dark: "#94a3b8",
  indigo: "#B4B5D6",
  white: "#A9AAC4",
  admin: "#8688B8",
};

export function SectionLabel({
  children,
  variant = "light",
  expanded = true,
}: {
  children: string;
  variant?: Variant;
  expanded?: boolean;
}) {
  if (variant === "white" && !expanded) return null;
  return (
    <p
      className="mt-5 mb-1 px-2 text-xs font-medium uppercase tracking-wide first:mt-0"
      style={{ color: COLORS[variant], letterSpacing: variant === "white" ? "0.18em" : undefined }}
    >
      {children}
    </p>
  );
}
