import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { getAuthUser } from "@/lib/auth/context";
import type { PublicTenant } from "@/lib/tenant/types";

/**
 * Zugriffsprüfung für den Schichtplan-Bereich (Block S3, 09.08.2026) —
 * gleiches Stilvorbild wie `src/lib/auth/staff.ts` (`checkAdminAccess()`/
 * `requireAdminTenant()`), aber mit einer DRITTEN erlaubten Gruppe:
 * Projektleiter (`calendar_projects.lead_user_id = auth.uid()`), die NUR
 * lesenden Zugriff auf das Wochenraster und Entscheidungsrecht über
 * Änderungsanfragen bekommen (kein Schicht-/Zeitfenster-CRUD — das steuert
 * `allowedTabs` in `schichtplanung-tabs.tsx`, dieses Modul liefert nur das
 * grundsätzliche "darf überhaupt rein"-Gate + die Projekt-IDs).
 *
 * owner/admin brauchen KEIN `shift_calendar_enabled`-Feature-Flag (deckt
 * sich mit dem bisherigen Verhalten von `checkAdminAccess()` — Admin-
 * Verhalten bleibt unverändert). Ein Projektleiter OHNE Feature-Flag bekommt
 * trotzdem "feature-disabled" (nicht "not-allowed") — ehrlicherer Grund, den
 * Betreiber hat den Schichtplan für diesen Mandanten schlicht nicht aktiv.
 */
export type ShiftPlannerAccess =
  | {
      ok: true;
      tenant: PublicTenant;
      user: { id: string; email?: string };
      isAdmin: boolean;
      leadProjectIds: string[];
    }
  | { ok: false; reason: "no-tenant" | "not-authenticated" | "feature-disabled" | "not-allowed" };

export async function checkShiftPlannerAccess(): Promise<ShiftPlannerAccess> {
  const tenant = await getTenant();
  if (!tenant) return { ok: false, reason: "no-tenant" };

  const user = await getAuthUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  const supabase = await createClient();
  const { data: role } = await supabase.rpc("member_role", { t: tenant.id });
  if (role === "owner" || role === "admin") {
    return { ok: true, tenant, user, isAdmin: true, leadProjectIds: [] };
  }

  if (tenant.settings.shift_calendar_enabled !== true) {
    return { ok: false, reason: "feature-disabled" };
  }

  const { data: leadProjects } = await supabase
    .from("calendar_projects")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("lead_user_id", user.id);
  const leadProjectIds = (leadProjects ?? []).map((p) => p.id as string);
  if (leadProjectIds.length === 0) return { ok: false, reason: "not-allowed" };

  return { ok: true, tenant, user, isAdmin: false, leadProjectIds };
}

/** Für Server Actions — wirft, damit try/catch in actions.ts einheitlich greift (gleiches Muster wie requireAdminTenant()). */
export async function requireShiftPlannerTenant() {
  const result = await checkShiftPlannerAccess();
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      "no-tenant": "Kein Mandant zu diesem Host gefunden.",
      "not-authenticated": "Nicht angemeldet.",
      "feature-disabled": "Der Schichtplan ist für diese Akademie nicht aktiviert.",
      "not-allowed": "Kein Zugriff — nur für Inhaber, Administratoren oder Projektleiter.",
    };
    throw new Error(messages[result.reason]);
  }

  const supabase = await createClient();
  return { tenant: result.tenant, user: result.user, isAdmin: result.isAdmin, leadProjectIds: result.leadProjectIds, supabase };
}
