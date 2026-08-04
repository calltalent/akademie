"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe/client";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { publicSlugSchema } from "@/lib/marketplace/schema";
import { marketplaceUrl } from "@/lib/marketplace/url";

export type MarketplaceCheckoutActionState = { error: string | null };

/**
 * Laedt AUSSCHLIESSLICH die fuer den Checkout-Aufbau noetigen internen Felder
 * eines Listings — Admin-Client noetig, da ein potenziell noch nicht
 * eingeloggter/gerade erst eingeloggter Kaeufer kein Mitglied des
 * Verkaeufer-Mandanten ist (gleicher Grund wie `loadProductForCheckout()` in
 * `stripe/checkout.ts`). Rueckgabewert bleibt privat in dieser
 * "use server"-Datei.
 */
async function loadListingForCheckout(slug: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("marketplace_listings")
    .select("id, tenant_id, course_id, product_id, price_cents")
    .eq("public_slug", slug)
    .eq("status", "approved")
    .eq("enabled", true)
    .maybeSingle();
  return data;
}

/**
 * Marketplace M5 (Plan Abschnitt 5, "Bezahlter Kauf") — Unterschiede zum
 * bestehenden `stripe/checkout.ts::createCheckoutSession()`, wörtlich nach
 * Plan:
 * 1. KEIN `getTenant()` — der Verkäufer wird aus der `marketplace_listings`-
 *    Zeile aufgelöst (per Admin-Client, der Käufer ist kein Mitglied).
 * 2. `payments_enabled` DES VERKÄUFER-Mandanten wird geprüft, nicht
 *    irgendeines "aktuellen" Mandanten (es gibt auf marketplace.calltalent.ai
 *    per Definition keinen).
 * 3. Metadata bekommt zusätzlich `listing_id`/`source: "marketplace"` —
 *    geprüft durch `marketplaceCheckoutMetadataSchema` (stripe/schema.ts),
 *    einzige Vertrauensquelle für den Webhook.
 * 4. `success_url`/`cancel_url` über `marketplaceUrl()`, nicht
 *    `buildTenantUrl()`.
 * 5. `billing_address_collection`/`phone_number_collection`/
 *    `tax_id_collection` bleiben gesetzt (unverändert übernommen).
 *
 * `mode: "payment"` ist hier bewusst FEST verdrahtet (kein `products.kind`-
 * Fallcase wie im Vorbild): `submitListing()` (`marketplace/actions.ts`) legt
 * das zugehörige Stripe-Produkt IMMER mit `kind: "one_time"` an (Plan
 * Abschnitt 7) — ein Marketplace-Abo ist kein Bestandteil dieses Blocks.
 */
export async function createMarketplaceCheckout(publicSlug: string): Promise<MarketplaceCheckoutActionState> {
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
    !(await checkRateLimit("marketplace-checkout-create", {
      maxRequests: 10,
      windowSeconds: 300,
      extraKey: user.id,
    }))
  ) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const listing = await loadListingForCheckout(slugCheck.data);
  // Verbindliches Kriterium (M1-Sicherheitsaudit, siehe acquire.ts-Kopfkommentar
  // und `20260803100400_marketplace_security_hardening.sql`): price_cents > 0,
  // NICHT allein "product_id vorhanden" — hier zusätzlich defensiv price_cents
  // geprüft, obwohl `submitListing()` product_id nur bei price_cents > 0 setzt.
  if (!listing || listing.price_cents <= 0 || !listing.product_id) {
    return { error: "Dieser Kurs ist aktuell nicht kaufbar." };
  }

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, slug, custom_domain, settings")
    .eq("id", listing.tenant_id)
    .maybeSingle();
  if (!tenant) {
    return { error: "Anbieter nicht gefunden." };
  }
  const tenantSettings = (tenant.settings ?? {}) as { payments_enabled?: boolean };
  if (tenantSettings.payments_enabled === false) {
    return { error: "Zahlungen sind für diesen Anbieter aktuell deaktiviert." };
  }

  const { data: product } = await admin
    .from("products")
    .select("stripe_price_id, active")
    .eq("id", listing.product_id)
    .eq("tenant_id", listing.tenant_id)
    .maybeSingle();
  if (!product || !product.stripe_price_id || !product.active) {
    return { error: "Dieser Kurs ist aktuell nicht kaufbar." };
  }

  let redirectUrl: string;
  try {
    const stripe = createStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: product.stripe_price_id, quantity: 1 }],
      metadata: {
        tenant_id: tenant.id,
        product_id: listing.product_id,
        user_id: user.id,
        listing_id: listing.id,
        source: "marketplace",
      },
      customer_email: user.email ?? undefined,
      billing_address_collection: "required",
      phone_number_collection: { enabled: true },
      tax_id_collection: { enabled: true },
      success_url: marketplaceUrl(`/kurs/${slugCheck.data}/danke?checkout=success`),
      cancel_url: marketplaceUrl(`/kurs/${slugCheck.data}?checkout=cancelled`),
    });
    if (!session.url) {
      return { error: "Stripe hat keine Checkout-URL geliefert." };
    }
    redirectUrl = session.url;
  } catch (e) {
    // Stripe-SDK-Fehlermeldungen sind technisch/englisch — Detail nur
    // loggen, Nutzer bekommt einen klaren deutschen Satz (analog
    // stripe/checkout.ts).
    console.error("[marketplace/checkout] Checkout konnte nicht gestartet werden.", {
      tenantId: tenant.id,
      userId: user.id,
      publicSlug: slugCheck.data,
      error: e instanceof Error ? e.message : e,
    });
    return { error: "Der Bezahlvorgang konnte gerade nicht gestartet werden. Bitte versuche es später erneut." };
  }

  // redirect() bewusst AUSSERHALB des try/catch — Next.js implementiert
  // Redirects intern über einen geworfenen Kontroll-Wert, der NICHT in einem
  // umschliessenden catch abgefangen werden darf (identisch zu stripe/checkout.ts).
  redirect(redirectUrl);
}
