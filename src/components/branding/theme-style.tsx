import type { PublicTenant } from "@/lib/tenant/types";
import { DEFAULT_BRANDING } from "@/lib/tenant/types";

/**
 * Injiziert Mandanten-Branding als CSS-Variablen im <head>.
 * Design-Leitplanken SPEC.md §4.5: eine Akzentfarbe je Mandant, Inter als
 * Standardschrift (Mandant kann eigene wählen), keine dekorativen Verläufe.
 *
 * Bewusst ein <style>-Tag statt inline auf <html>, damit auch verschachtelte
 * Tailwind-Klassen (var(--color-primary)) sauber greifen.
 */
export function ThemeStyle({ tenant }: { tenant: PublicTenant | null }) {
  const branding = { ...DEFAULT_BRANDING, ...(tenant?.branding ?? {}) };

  return (
    <style
      // Reine CSS-Variablen, keine Nutzereingabe direkt im DOM (cssColor/
      // cssLength whitelisten unten streng). Kein eslint-disable nötig —
      // react/no-danger feuert in diesem Projekt nicht (Josips Lint-Lauf
      // 12.07.2026 meldete den Disable-Kommentar als "unused directive").
      dangerouslySetInnerHTML={{
        __html: `:root {
  --color-primary: ${cssColor(branding.color_primary)};
  --color-background: ${cssColor(branding.color_bg)};
  --radius: ${cssLength(branding.radius)};
}`,
      }}
    />
  );
}

/** Sehr einfache Whitelist gegen CSS-Injection über Branding-Felder. */
function cssColor(value?: string): string {
  if (value && /^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
  return DEFAULT_BRANDING.color_primary!;
}

function cssLength(value?: string): string {
  if (value && /^[0-9.]+(px|rem|em)$/.test(value)) return value;
  return DEFAULT_BRANDING.radius!;
}
