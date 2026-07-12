// OpenNext-Konfiguration für Cloudflare Workers (Phase 5, Block 1).
// Standardkonfiguration — kein ISR-Sonderfall nötig, da alle mandanten-
// gebundenen Seiten ohnehin dynamisch gerendert werden (RLS/Auth pro
// Request, siehe src/proxy.ts). Caching-Optionen bei Bedarf hier ergänzen,
// siehe https://opennext.js.org/cloudflare/caching.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
