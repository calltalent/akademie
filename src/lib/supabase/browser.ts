import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Reiner Browser-Client, NUR für Storage-Uploads über signierte URLs
 * (Block 3, Phase 2 — Abgaben-Datei-Upload). Braucht keine Cookie-/
 * Session-Anbindung wie `@supabase/ssr`s `createBrowserClient` (Auth-Flows),
 * da die signierte Upload-URL/Token selbst die Berechtigung trägt —
 * server-seitig erzeugt über den Nutzer-Client in
 * src/app/api/submissions/upload-url/route.ts, RLS bereits dort geprüft.
 * Anon-Key ist öffentlich (NEXT_PUBLIC_*), kein Secret — diese Datei darf
 * im Client-Bundle landen (bewusst KEIN `import "server-only"`).
 */
export function createBrowserClient() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
