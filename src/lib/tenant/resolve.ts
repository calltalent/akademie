import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PublicTenant } from "@/lib/tenant/types";

const TENANT_COLUMNS =
  "id, slug, name, custom_domain, plan, status, branding, legal, settings";

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

  if (!error && data) return data as unknown as PublicTenant;

  // FOLGEAUFTRAG (12.07.2026, Josip: "learning soll auch bleiben" — beide
  // Domains sollen denselben Mandanten treffen): tenants.custom_domain
  // erlaubt nur eine Domain pro Mandant. Zusätzliche Domains ("Aliase")
  // stehen in tenant_domains (Migration "tenant_domains", 12.07.2026).
  // Zwei Abfragen statt Join, um TENANT_COLUMNS/resolveTenantById() (inkl.
  // status-Filter) unverändert wiederzuverwenden statt Embed-Typisierung
  // zu riskieren.
  const { data: aliasRow } = await admin
    .from("tenant_domains")
    .select("tenant_id")
    .eq("domain", domain)
    .maybeSingle();

  if (!aliasRow) return null;
  return resolveTenantById(aliasRow.tenant_id);
}

/**
 * Leitet aus dem Host-Header slug ODER custom_domain ab.
 * Dev: `{slug}.localhost:3000` (Entscheidung 10.07.2026, Block 2).
 * Prod: `{slug}.calltalent.ai` ODER Kunden-eigene Domain.
 *
 * UPDATE (Phase 5, Block 8, 12.07.2026): ursprünglich `{slug}.akademie.
 * calltalent.ai` (zweite Subdomain-Ebene) — auf Josips Entscheidung hin auf
 * die erste Ebene direkt unter `calltalent.ai` umgestellt. Grund: Cloudflares
 * kostenloses Universal-SSL-Wildcard-Zertifikat deckt nur `calltalent.ai`
 * und `*.calltalent.ai` (erste Ebene) ab, NICHT `*.akademie.calltalent.ai`
 * (zweite Ebene) — jeder Mandant hätte sonst einen SSL-Zertifikatsfehler
 * bekommen, es sei denn man kauft Cloudflare Advanced Certificate Manager.
 * `portal.calltalent.ai` (Betreiber-Portal, siehe NEXT_PUBLIC_PORTAL_HOST)
 * war schon vorher als erste Ebene geplant (SPEC.md §4.3/§9.1) — jetzt
 * konsistent mit dem Mandanten-Schema.
 */
export function extractTenantSlugFromHost(host: string): string | null {
  const hostname = host.split(":")[0]; // Port abtrennen

  // Dev-Schema: <slug>.localhost
  if (hostname.endsWith(".localhost")) {
    const slug = hostname.slice(0, -".localhost".length);
    return slug || null;
  }

  // Prod-Schema: <slug>.calltalent.ai (genau eine Ebene — "calltalent.ai"
  // selbst hat 2 Teile, mit slug macht das genau 3; "foo.bar.calltalent.ai"
  // mit 4 Teilen bleibt bewusst unerkannt, s. o.)
  const parts = hostname.split(".");
  if (parts.length === 3 && hostname.endsWith(".calltalent.ai")) {
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

/**
 * Performance-Fix (19.07.2026, Josips Fund: Login/Seitenaufbau spürbar
 * langsam): lief vorher als bis zu ZWEI sequenzielle Abfragen — erst
 * `resolveTenantBySlug()`, bei Fehlschlag danach `resolveTenantByCustomDomain()`
 * (die ihrerseits nochmal eine `tenants`-Abfrage macht). Für jeden Host, der
 * wie eine erste-Ebene-Subdomain AUSSIEHT, aber als `custom_domain`
 * eingetragen ist (z. B. "academy.calltalent.ai" für den Mandanten mit Slug
 * "calltalent" — genau der produktiv genutzte Fall), bedeutete das JEDEN
 * einzelnen Request zwei DB-Rundläufe statt einem, bevor überhaupt die
 * eigentliche Seite geladen wird. Jetzt EIN Query mit `.or()` für
 * Slug-ODER-Custom-Domain-Treffer — spart den zweiten Rundlauf im
 * Normalfall vollständig ein. `tenant_domains`-Alias-Fallback (seltener Pfad,
 * z. B. eine zweite Domain desselben Mandanten) bleibt als zweiter Query
 * bestehen, da er nicht in dieselbe Abfrage passt.
 */
export async function resolveTenantByHost(
  host: string,
): Promise<PublicTenant | null> {
  const hostname = host.split(":")[0];
  const slug = extractTenantSlugFromHost(host);

  const admin = createAdminClient();
  let query = admin.from("tenants").select(TENANT_COLUMNS).eq("status", "active");
  query = slug ? query.or(`slug.eq.${slug},custom_domain.eq.${hostname}`) : query.eq("custom_domain", hostname);
  const { data } = await query.maybeSingle();
  if (data) return data as unknown as PublicTenant;

  // Alias-Fallback (siehe Kommentar oben): eine zusätzliche, nicht in
  // `tenants.custom_domain` eingetragene Domain desselben Mandanten.
  const { data: aliasRow } = await admin
    .from("tenant_domains")
    .select("tenant_id")
    .eq("domain", hostname)
    .maybeSingle();
  if (!aliasRow) return null;
  return resolveTenantById(aliasRow.tenant_id);
}
