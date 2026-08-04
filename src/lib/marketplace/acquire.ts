"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { publicSlugSchema } from "@/lib/marketplace/schema";
import { grantMarketplaceAccess } from "@/lib/marketplace/fulfil";

export type MarketplaceAcquireActionState = { error: string | null };

/**
 * Marketplace M5 (Plan Abschnitt 5, "Gratis-Erwerb") — Server Action für den
 * Kaufbutton eines Gratis-Listings (`components/marketplace/buy-button.tsx`).
 *
 * KRITERIUM `price_cents = 0`, NICHT `product_id is null` (verbindliche
 * Design-Entscheidung aus dem M1-Sicherheitsaudit, siehe
 * `20260803100400_marketplace_security_hardening.sql`, letzter Abschnitt):
 * ein bezahltes Listing, dessen `products`-Zeile später gelöscht wird
 * (`marketplace_listings.product_id` steht auf `on delete set null`), hätte
 * sonst ebenfalls `product_id = null` und würde fälschlich als "kostenlos
 * erwerbbar" durchgehen.
 *
 * Kein `orders`-/`marketplace_ledger`-Eintrag — die `enrollments`-Zeile mit
 * `source='marketplace'` ist der alleinige Nachweis für einen Gratis-Erwerb.
 */
export async function acquireFreeListing(publicSlug: string): Promise<MarketplaceAcquireActionState> {
  const slugCheck = publicSlugSchema.safeParse(publicSlug);
  if (!slugCheck.success) {
    return { error: "Ungültiger Kurs." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Bitte zuerst anmelden." };
  }

  if (
    !(await checkRateLimit("marketplace-acquire-free", {
      maxRequests: 10,
      windowSeconds: 300,
      extraKey: user.id,
    }))
  ) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("marketplace_listings")
    .select("id, tenant_id, course_id")
    .eq("public_slug", slugCheck.data)
    .eq("status", "approved")
    .eq("enabled", true)
    .eq("price_cents", 0)
    .maybeSingle();

  if (!listing) {
    return { error: "Dieser Kurs ist nicht kostenlos verfügbar." };
  }

  await grantMarketplaceAccess(admin, listing.tenant_id, user.id, listing.course_id);

  // Marktplatz-relativer Redirect (Plan Abschnitt 5) — diese Server Action
  // wird ausschließlich von einer Client-Komponente auf
  // marketplace.calltalent.ai aufgerufen, redirect() bleibt deshalb auf
  // demselben Host (keine marketplaceUrl()-Vollqualifizierung nötig/gewollt).
  redirect(`/kurs/${slugCheck.data}/danke`);
}
