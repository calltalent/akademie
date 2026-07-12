import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Zugriffsprüfung für das Betreiber-Portal (Phase 4, Block 1).
 * Gespiegelt an src/lib/auth/staff.ts (checkStaffAccess/requireStaffTenant),
 * aber OHNE Tenant-Bezug — das Portal ist plattformweit, kein
 * Mandanten-Kontext (getTenant() liefert auf dem Portal-Host ohnehin null,
 * siehe src/middleware.ts: dort wird für den Portal-Host bewusst kein
 * x-tenant-id-Header gesetzt).
 *
 * `platform_admins` hat bewusst KEINE Client-RLS-Policy (Standard-Deny für
 * anon/authenticated — Migration 20260711224500_platform_admins.sql), nur
 * service_role darf lesen/schreiben. Deshalb MUSS hier der Admin-Client
 * verwendet werden; der normale Session-Client aus lib/supabase/server
 * würde bei jeder Abfrage auf platform_admins ausnahmslos leer zurückkommen
 * (RLS blockt, nicht "kein Treffer").
 */

type PlatformCheckResult =
  | { ok: true; user: { id: string; email?: string } }
  | { ok: false; reason: "not-authenticated" | "not-platform-admin" };

/** Für Server Components (Layouts/Seiten) — wirft nie, gibt Status zurück. */
export async function checkPlatformAccess(): Promise<PlatformCheckResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  const admin = createAdminClient();
  const { data: entry, error } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Fail-closed: ein Abfragefehler zählt NICHT als "ist Admin", analog zum
  // resolve.ts-Muster (error || !data -> ablehnen statt durchwinken).
  if (error || !entry) return { ok: false, reason: "not-platform-admin" };

  return { ok: true, user: { id: user.id, email: user.email } };
}

/** Für Server Actions/Route Handler des Portals — wirft, damit try/catch einheitlich greift. */
export async function requirePlatformAdmin() {
  const result = await checkPlatformAccess();
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      "not-authenticated": "Nicht angemeldet.",
      "not-platform-admin": "Kein Zugriff — nur für Calltalent-Team.",
    };
    throw new Error(messages[result.reason]);
  }

  // Session-Client für nachfolgende Queries als Mensch (z. B. Anzeige des
  // eigenen Profils) — NICHT als Ersatz für den Admin-Client bei erneuten
  // platform_admins-Zugriffen, dafür immer createAdminClient() verwenden.
  const supabase = await createClient();
  return { user: result.user, supabase };
}
