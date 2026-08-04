import "server-only";
import { publicEnv } from "@/lib/env";

/**
 * Marketplace M5 (Plan "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt
 * 5): zentrale Stelle für "unter welcher Domain ist der Marketplace
 * erreichbar" — exaktes Vorbild `src/lib/tenant/url.ts::tenantOrigin()`/
 * `buildTenantUrl()`, nur für den EINEN zentralen Marketplace-Host statt je
 * Mandant (kein `tenant`-Objekt nötig, `NEXT_PUBLIC_MARKETPLACE_HOST` reicht).
 *
 * Gleiches Dev/Prod-Schema wie dort: `NODE_ENV !== "production"` -> fester
 * Port 3000 (lokaler `next dev`), sonst der Host direkt aus `publicEnv`
 * (Dev-Default `marketplace.localhost`, Prod z. B. `marketplace.calltalent.ai`,
 * siehe `.env.example`/`src/lib/env.ts`).
 */
export function marketplaceOrigin(): string {
  if (process.env.NODE_ENV !== "production") {
    return `http://${publicEnv.NEXT_PUBLIC_MARKETPLACE_HOST}:3000`;
  }
  return `https://${publicEnv.NEXT_PUBLIC_MARKETPLACE_HOST}`;
}

export function marketplaceUrl(path: string): string {
  return `${marketplaceOrigin()}${path}`;
}
