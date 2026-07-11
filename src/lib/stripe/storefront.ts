import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Oeffentliche Kaufseite (Phase 2, Block 5) - Produkte fuer ANONYME und
 * eingeloggte Besucher laden, BEVOR eine Mandanten-Mitgliedschaft existiert.
 *
 * Warum Admin-Client (service_role): die aktuell aktive RLS-Policy heisst
 * `products_member_select` (Migration 20260710233735, ersetzte im
 * Security-Audit vom 11.07.2026 die urspruengliche, zu offene
 * `products_public_select`) und verlangt `member_role(tenant_id) is not
 * null` UND `active = true`. Ein Website-Besucher, der eine Kaufseite VOR
 * dem Login aufruft, ist per Definition noch kein Mitglied - genau der in
 * PHASENSTATUS.md (MITTEL-Fund 4, 11.07.2026) vorgemerkte Fall:
 * "Öffentliches Storefront-Browsing braucht eine tenant-scoped Server-Route
 * (Admin-Client + explizitem tenant_id-Filter), analog
 * src/lib/tenant/resolve.ts."
 *
 * Sicherheits-Gegengewicht: strikte Spaltenliste + striktes Rueckgabe-Objekt
 * (PublicProduct) - `stripe_product_id`/`stripe_price_id`/interne IDs
 * verlassen diese Funktion NIE. Die eigentliche Preisbindung fuer den
 * Checkout laedt src/lib/stripe/checkout.ts separat und ausschliesslich
 * serverseitig (eigene, private Ladefunktion dort).
 */

export type PublicProduct = {
  id: string;
  title: string;
  slug: string;
  kind: "one_time" | "subscription";
  priceCents: number;
  currency: string;
};

export async function getPublicProduct(tenantId: string, slug: string): Promise<PublicProduct | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products")
    .select("id, title, slug, kind, price_cents, currency")
    .eq("tenant_id", tenantId)
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    title: data.title,
    slug: data.slug,
    kind: data.kind as "one_time" | "subscription",
    priceCents: data.price_cents,
    currency: data.currency,
  };
}
