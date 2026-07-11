"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createTenantSchema, updateTenantSchema } from "@/lib/platform/schema";

/**
 * Server Actions fuer das Betreiber-Portal: Mandant anlegen/bearbeiten
 * (Phase 4, Block 2).
 *
 * `tenants`-RLS (0001_init.sql Zeile 439-443) erlaubt SELECT/UPDATE nur
 * Mandanten-Mitgliedern und hat GAR KEINE INSERT-Policy — laut
 * Schema-Kommentar "Anlegen nur ueber service_role (Betreiber-Portal)".
 * Platform-Admins sind keine Mandanten-Mitglieder (siehe
 * src/lib/platform/auth.ts). Beide Actions pruefen deshalb zuerst
 * `requirePlatformAdmin()` (Zugriffskontrolle ueber den Session-Client),
 * fuehren die eigentliche Query aber ausschliesslich ueber
 * `createAdminClient()` (service_role) aus — der Session-Client aus
 * `requirePlatformAdmin()` wuerde an der RLS scheitern.
 *
 * WICHTIG: `redirect()` (next/navigation) wird hier bewusst NICHT
 * aufgerufen — Next.js implementiert Redirects ueber einen internen
 * Kontrollfluss-Wurf (eine spezielle Exception), der von einem umgebenden
 * try/catch sonst als regulaerer Fehler abgefangen wuerde. `createTenant`
 * liefert bei Erfolg stattdessen `{ok:true→error:null,success:true,id,slug}`
 * zurueck — der Redirect zur Detailseite passiert client-seitig in
 * `neu/page.tsx` per `useRouter()` in einem `useEffect`.
 */

export type PlatformActionState = {
  error: string | null;
  success?: boolean;
  id?: string;
  slug?: string;
};

function errorState(e: unknown): PlatformActionState {
  return { error: e instanceof Error ? e.message : "Unbekannter Fehler." };
}

export async function createTenant(
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const { user } = await requirePlatformAdmin();

    // Rate-Limit analog Block 7/Phase 3 (checkRateLimit()-Muster,
    // src/lib/security/rate-limit.ts): service_role-Schreibzugriff, pro
    // Platform-Admin statt IP (extraKey: user.id) begrenzt, da alle
    // Platform-Admins ueber dieselbe Verwaltungsoberflaeche gehen.
    if (
      !(await checkRateLimit("platform-create-tenant", {
        maxRequests: 20,
        windowSeconds: 3600,
        extraKey: user.id,
      }))
    ) {
      return { error: RATE_LIMIT_MESSAGE };
    }

    const parsed = createTenantSchema.safeParse({
      name: formData.get("name"),
      slug: formData.get("slug"),
      plan: formData.get("plan"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("tenants")
      .insert({
        name: parsed.data.name,
        slug: parsed.data.slug,
        plan: parsed.data.plan,
      })
      .select("id, slug")
      .single();

    if (error) {
      // 23505 = unique_violation (Postgres) — hier nur ueber tenants.slug
      // moeglich (custom_domain wird bei der Anlage noch nicht gesetzt).
      if (error.code === "23505") {
        return { error: "Subdomain bereits vergeben." };
      }
      return { error: "Anlegen fehlgeschlagen: " + error.message };
    }

    revalidatePath("/portal/mandanten");
    return { error: null, success: true, id: data.id, slug: data.slug };
  } catch (e) {
    return errorState(e);
  }
}

export async function updateTenant(
  tenantId: string,
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    await requirePlatformAdmin();

    const parsed = updateTenantSchema.safeParse({
      name: formData.get("name"),
      plan: formData.get("plan"),
      status: formData.get("status"),
      customDomain: formData.get("customDomain") ?? "",
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("tenants")
      .update({
        name: parsed.data.name,
        plan: parsed.data.plan,
        status: parsed.data.status,
        custom_domain: parsed.data.customDomain,
      })
      .eq("id", tenantId);

    if (error) {
      // 23505 hier nur ueber tenants.custom_domain moeglich (slug wird beim
      // Bearbeiten nicht mehr veraendert).
      if (error.code === "23505") {
        return { error: "Domain bereits vergeben." };
      }
      return { error: "Speichern fehlgeschlagen: " + error.message };
    }

    revalidatePath(`/portal/mandanten/${tenantId}`);
    revalidatePath("/portal/mandanten");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}
