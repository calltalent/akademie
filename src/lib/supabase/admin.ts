import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env";

/**
 * Admin-Client (service_role key). UMGEHT RLS vollständig.
 *
 * Sicherheitsregel CLAUDE.md §2.2: nur serverseitig, niemals im Client-Bundle.
 * `import "server-only"` lässt den Next.js-Build hart fehlschlagen, falls
 * diese Datei versehentlich in einen Client-Bundle-Pfad importiert wird.
 *
 * Nur verwenden für:
 * - Mandanten-Auflösung für anonyme Besucher (src/lib/tenant/resolve.ts, Block 2)
 * - Admin-Operationen wie CSV-Nutzerimport (Block 6)
 * Jede Nutzung MUSS die Tenant-/Rollenprüfung selbst im Code durchführen,
 * da RLS hier nicht mehr greift.
 */
export function createAdminClient() {
  const serverEnv = getServerEnv();

  return createSupabaseClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
