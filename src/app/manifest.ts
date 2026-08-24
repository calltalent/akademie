import type { MetadataRoute } from "next";
import { getTenant } from "@/lib/tenant/context";
import { DEFAULT_BRANDING } from "@/lib/tenant/types";

const MAX_SHORT_NAME_LENGTH = 30;

/**
 * Gleiche Whitelist wie ThemeStyle (src/components/branding/theme-style.tsx)
 * — Branding-Felder sind Mandanten-Eingaben, nie ungeprüft in Ausgaben
 * übernehmen. Eigener Fallback-Parameter statt eines fest verdrahteten
 * DEFAULT_BRANDING.color_primary, weil hier zwei verschiedene Farbfelder
 * (Hintergrund/Akzent) mit je eigenem sinnvollem Default validiert werden.
 */
function safeColor(value: string | undefined, fallback: string): string {
  if (value && /^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
  return fallback;
}

/**
 * Mandantenfähige Web-App-Manifest-Route (Phase 4, Block 5) — ersetzt eine
 * statische public/manifest.json. Next.js generiert daraus automatisch
 * /manifest.webmanifest. `getTenant()` liest den von middleware.ts aufgelösten
 * Mandanten über headers() (macht diese Route automatisch dynamisch,
 * genauso wie generateMetadata() in src/app/layout.tsx) — für anonyme
 * Aufrufe ohne erkennbaren Mandanten (z. B. Root-/Portal-Domain) greift der
 * Calltalent-Akademie-Standardfall.
 *
 * Icons: EIN statisches Fallback-Icon-Set für alle Mandanten in diesem
 * Block (siehe PHASENSTATUS.md Block 5 „Bewusste Vereinfachungen") — echte
 * Per-Mandant-Icons aus tenant.branding.logo_url bräuchten eine
 * Bildverarbeitungs-Pipeline, kein SPEC-DoD-Punkt für dieses Fundament.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const tenant = await getTenant();
  const name = tenant?.name?.trim() || "Calltalent-Akademie";
  const shortName = name.length > MAX_SHORT_NAME_LENGTH ? name.slice(0, MAX_SHORT_NAME_LENGTH) : name;
  const branding = { ...DEFAULT_BRANDING, ...(tenant?.branding ?? {}) };

  return {
    name,
    short_name: shortName,
    description: "KI-native Lernplattform von Calltalent LLC.",
    start_url: "/",
    display: "standalone",
    background_color: safeColor(branding.color_bg, DEFAULT_BRANDING.color_bg!),
    theme_color: safeColor(branding.color_primary, DEFAULT_BRANDING.color_primary!),
    lang: "de",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
