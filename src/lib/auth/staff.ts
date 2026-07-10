import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import type { PublicTenant } from "@/lib/tenant/types";

/**
 * Zweite Verteidigungslinie neben RLS (Sicherheitsregel-Geist §2.1):
 * RLS (`is_staff(tenant_id)`) verhindert das eigentliche Schreiben/Lesen
 * bereits hart in der DB. Diese Funktionen liefern zusätzlich eine
 * benutzerfreundliche Fehlermeldung/Redirect-Grundlage in der UI-Schicht,
 * bevor überhaupt eine Anfrage an Supabase geht.
 */

type StaffCheckResult =
  | { ok: true; tenant: PublicTenant; user: { id: string; email?: string } }
  | { ok: false; reason: "no-tenant" | "not-authenticated" | "not-staff" };

type AdminCheckResult =
  | { ok: true; tenant: PublicTenant; user: { id: string; email?: string } }
  | { ok: false; reason: "no-tenant" | "not-authenticated" | "not-admin" };

/** Für Server Components (Layouts/Seiten) — wirft nie, gibt Status zurück. */
export async function checkStaffAccess(): Promise<StaffCheckResult> {
  const tenant = await getTenant();
  if (!tenant) return { ok: false, reason: "no-tenant" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  const { data: isStaff } = await supabase.rpc("is_staff", { t: tenant.id });
  if (!isStaff) return { ok: false, reason: "not-staff" };

  return { ok: true, tenant, user };
}

/** Für Server Actions — wirft, damit try/catch in actions.ts einheitlich greift. */
export async function requireStaffTenant() {
  const result = await checkStaffAccess();
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      "no-tenant": "Kein Mandant zu diesem Host gefunden.",
      "not-authenticated": "Nicht angemeldet.",
      "not-staff": "Kein Zugriff — nur für Team-Mitglieder (Staff).",
    };
    throw new Error(messages[result.reason]);
  }

  const supabase = await createClient();
  return { tenant: result.tenant, user: result.user, supabase };
}

/**
 * Strengere Variante für Nutzerverwaltung (Block 6): RLS-Policy
 * `memberships_admin_write` erlaubt Schreiben auf `memberships` NUR für
 * owner/admin — trainer zählt hier bewusst NICHT als ausreichend, anders
 * als bei `is_staff` in requireStaffTenant(). Für Server Components.
 */
export async function checkAdminAccess(): Promise<AdminCheckResult> {
  const tenant = await getTenant();
  if (!tenant) return { ok: false, reason: "no-tenant" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  const { data: role } = await supabase.rpc("member_role", { t: tenant.id });
  if (role !== "owner" && role !== "admin") return { ok: false, reason: "not-admin" };

  return { ok: true, tenant, user };
}

/** Für Server Actions/Route Handlers der Nutzerverwaltung — wirft. */
export async function requireAdminTenant() {
  const result = await checkAdminAccess();
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      "no-tenant": "Kein Mandant zu diesem Host gefunden.",
      "not-authenticated": "Nicht angemeldet.",
      "not-admin": "Kein Zugriff — nur für Inhaber/Administratoren.",
    };
    throw new Error(messages[result.reason]);
  }

  const supabase = await createClient();
  return { tenant: result.tenant, user: result.user, supabase };
}
