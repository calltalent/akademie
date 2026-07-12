import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/**
 * Server-Client (anon key, Session aus Cookies). Unterliegt RLS.
 * Nutzung: Server Components, Server Actions, Route Handler — Standardfall
 * für alles, was im Namen des eingeloggten Nutzers passiert.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Aufruf aus Server Component ohne Schreibrecht auf Cookies —
            // wird durch middleware.ts abgedeckt (Session-Refresh).
          }
        },
      },
    },
  );
}
