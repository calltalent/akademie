"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/**
 * Browser-Client (anon key). Unterliegt vollständig RLS.
 * Nutzung: Client Components, die live/reaktiv lesen müssen.
 * Schreiboperationen bevorzugt über Server Actions (jeweils actions.ts in den src/lib-Unterordnern).
 */
export function createClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
