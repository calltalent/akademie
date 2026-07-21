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
  description: string | null;
  imageUrl: string | null;
};

export async function getPublicProduct(tenantId: string, slug: string): Promise<PublicProduct | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products")
    .select("id, title, slug, kind, price_cents, currency, description, image_url")
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
    description: data.description,
    imageUrl: data.image_url,
  };
}

export type PublicProductFeatures = {
  moduleCount: number;
  lessonCount: number;
  totalMinutes: number;
};

/**
 * Design-Block (18.07.2026, Claude-Design-Import KursKauf.dc.html) - liefert
 * die Eckdaten fuer die Produktkarte der Kaufseite ("N Module * M Lektionen *
 * X Min. Videomaterial"), berechnet aus den ueber `products.course_ids`
 * verknuepften Kursen. Bewusst eine EIGENE Funktion statt die Zahlen in
 * getPublicProduct() mit auszuliefern: `course_ids` selbst verlaesst diese
 * Funktion nie, nur die aggregierten Zahlen - gleiches Sicherheitsprinzip wie
 * bei den Stripe-internen IDs oben (so wenig wie noetig an den Client).
 * `null`, wenn das Produkt keinem Kurs zugeordnet ist - die Kaufseite zeigt
 * dann keine Feature-Liste statt erfundener Platzhalterzahlen.
 */
export async function getPublicProductFeatures(
  tenantId: string,
  slug: string,
): Promise<PublicProductFeatures | null> {
  const admin = createAdminClient();
  const { data: product } = await admin
    .from("products")
    .select("course_ids")
    .eq("tenant_id", tenantId)
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  const courseIds = (product?.course_ids as string[] | null) ?? [];
  if (courseIds.length === 0) return null;

  const { data: modules } = await admin.from("modules").select("id").in("course_id", courseIds);
  const moduleIds = (modules ?? []).map((m) => m.id as string);
  if (moduleIds.length === 0) return { moduleCount: 0, lessonCount: 0, totalMinutes: 0 };

  const { data: lessons } = await admin
    .from("lessons")
    .select("video_duration_s")
    .in("module_id", moduleIds)
    .eq("status", "published");

  const totalSeconds = (lessons ?? []).reduce(
    (sum, l) => sum + ((l.video_duration_s as number | null) ?? 0),
    0,
  );

  return {
    moduleCount: moduleIds.length,
    lessonCount: (lessons ?? []).length,
    totalMinutes: Math.round(totalSeconds / 60),
  };
}
