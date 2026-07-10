import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PublicTenant } from "@/lib/tenant/types";

const TENANT_COLUMNS =
  "id, slug, name, plan, status, branding, legal, settings";

/**
 * Mandanten-Auflösung für ANONYME Besucher (vor Login).
 *
 * Warum Admin-Client (service_role): Die RLS-Policy `tenants_member_select`
 * verlangt Mitgliedschaft (public.member_role(id) is not null). Ein
 * Website-Besucher, der die Login-Seite eines Mandanten aufruft, ist per
 * Definition noch kein Mitglied — er muss aber trotzdem Branding/Logo sehen.
 *
 * Sicherheits-Gegengewicht: strikte Spaltenliste (TENANT_COLUMNS), niemals
 * `select *`. Gibt garantiert keine anderen Mandanten oder interne Felder frei.
 */
export async function resolveTenantBySlug(
  slug: string,
): Promise<PublicTenant | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select(TENANT_COLUMNS)
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as PublicTenant;
}

export async function resolveTenantByCustomDomain(
  domain: string,
): Promise<PublicTenant | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select(TENANT_COLUMNS)
    .eq("custom_domain", domain)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as PublicTenant;
}

/**
 * Leitet aus dem Host-Header slug ODER custom_domain ab.
 * Dev: `{slug}.localhost:3000` (Entscheidung 10.07.2026, Block 2).
 * Prod: `{slug}.akademie.calltalent.ai` ODER Kunden-eigene Domain.
 */
export function extractTenantSlugFromHost(host: string): string | null {
  const hostname = host.split(":")[0]; // Port abtrennen

  // Dev-Schema: <slug>.localhost
  if (hostname.endsWith(".localhost")) {
    const slug = hostname.slice(0, -".localhost".length);
    return slug || null;
  }

  // Prod-Schema: <slug>.akademie.calltalent.ai
  const parts = hostname.split(".");
  if (parts.length >= 4 && hostname.endsWith(".akademie.calltalent.ai")) {
    return parts[0];
  }

  return null; // kein erkennbares Subdomain-Schema -> evtl. custom_domain
}

export async function resolveTenantById(
  id: string,
): Promise<PublicTenant | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select(TENANT_COLUMNS)
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as PublicTenant;
}

export async function resolveTenantByHost(
  host: string,
): Promise<PublicTenant | null> {
  const slug = extractTenantSlugFromHost(host);
  if (slug) {
    return resolveTenantBySlug(slug);
  }
  const hostname = host.split(":")[0];
  return resolveTenantByCustomDomain(hostname);
}
