"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/context";
import { createStripeClient } from "@/lib/stripe/client";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { productSlugSchema } from "@/lib/stripe/schema";
import { buildTenantUrl } from "@/lib/tenant/url";

export type CheckoutActionState = { error: string | null };

/**
 * BUGFIX (Phase 5, Block 8, 12.07.2026): die private `buildTenantUrl(slug, path)`
 * hier hing noch am alten `{slug}.akademie.calltalent.ai`-Schema UND kannte
 * `custom_domain` nicht — für den ersten echten Mandanten (`custom_domain =
 * learning.calltalent.ai`) wäre nach einer echten Stripe-Zahlung auf die
 * falsche, nicht erreichbare Domain `calltalent.calltalent.ai` weitergeleitet
 * worden. Jetzt zentral in src/lib/tenant/url.ts (kennt beide Fälle), siehe
 * dortiger Kommentar für Details.
 */

/**
 * Laedt AUSSCHLIESSLICH die fuer den Checkout-Aufbau noetigen internen Felder
 * (inkl. stripe_price_id). Nicht zu verwechseln mit
 * src/lib/stripe/storefront.ts::getPublicProduct(), dessen Rueckgabewert NIE
 * interne Stripe-IDs enthalten darf (der wird potenziell an eine
 * Client-Komponente durchgereicht). Diese Funktion bleibt privat in dieser
 * "use server"-Datei - ihr Rueckgabewert verlaesst den Server-Action-Kontext
 * nie, landet also nie im Client-Bundle.
 *
 * Admin-Client noetig aus demselben Grund wie in getPublicProduct: die
 * aktive RLS-Policy `products_member_select` verlangt Mitgliedschaft, ein
 * potenziell noch nicht eingeloggter/gerade erst eingeloggter Kaeufer ohne
 * Mitgliedschaft darf trotzdem kaufen koennen (SPEC 4.1: /kaufen/[productSlug]).
 */
async function loadProductForCheckout(
  tenantId: string,
  slug: string,
): Promise<{ id: string; kind: "one_time" | "subscription"; stripePriceId: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products")
    .select("id, kind, stripe_price_id")
    .eq("tenant_id", tenantId)
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (error || !data || !data.stripe_price_id) return null;
  return {
    id: data.id,
    kind: data.kind as "one_time" | "subscription",
    stripePriceId: data.stripe_price_id,
  };
}

/**
 * Erzeugt eine Stripe-Checkout-Session und leitet dorthin weiter.
 *
 * Sicherheitsregeln (Auftrag Block 5, wörtlich umgesetzt):
 * - `metadata.tenant_id/product_id/user_id` ist die EINZIGE Quelle, aus der
 *   der Webhook spaeter ableitet, wem eine Zahlung gehoert - niemals aus
 *   einer anderen Quelle im Webhook uebernommen.
 * - Preis kommt ausschliesslich aus dem serverseitig geladenen
 *   `stripe_price_id` des tenant-scoped Produkts, niemals aus Client-Eingabe.
 * - `payments_enabled`-Schalter wird hart gegatet (SPEC: "je Mandant
 *   abschaltbar").
 * - Rate-Limiting pro Nutzer (nicht auf der Webhook-Route, dort unueblich).
 *
 * Bewusste Vereinfachung/Abweichung "Login vor Kauf" (mit Josip/architect
 * abgestimmt, siehe PHASENSTATUS.md): verlangt eine BESTEHENDE Session,
 * statt einen Account-Anlage-Schritt in den Checkout-Flow selbst einzubauen.
 * Die Kaufseite (kaufen/[productSlug]/page.tsx) zeigt bei fehlender Session
 * einen Login/Registrieren-Hinweis statt direkt zu Stripe zu leiten - das
 * ist die einfachste tragfaehige Loesung (CLAUDE.md §4.5, "so wenig
 * bewegliche Teile wie moeglich"). Diese Funktion prueft die Session
 * trotzdem selbst nach (Defense-in-Depth, falls sie je direkt ohne die
 * Seiten-Gate aufgerufen wird).
 */
export async function createCheckoutSession(productSlug: string): Promise<CheckoutActionState> {
  const slugCheck = productSlugSchema.safeParse(productSlug);
  if (!slugCheck.success) {
    return { error: "Ungültiges Produkt." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Bitte zuerst anmelden." };
  }

  if (
    !(await checkRateLimit("stripe-checkout-create", {
      maxRequests: 10,
      windowSeconds: 300,
      extraKey: user.id,
    }))
  ) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const tenant = await getTenant();
  if (!tenant) {
    return { error: "Kein Mandant zu diesem Host gefunden." };
  }
  if (tenant.settings.payments_enabled === false) {
    return { error: "Zahlungen sind für diese Akademie aktuell deaktiviert." };
  }

  const product = await loadProductForCheckout(tenant.id, slugCheck.data);
  if (!product) {
    return { error: "Produkt nicht gefunden oder nicht verfügbar." };
  }

  let redirectUrl: string;
  try {
    const stripe = createStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: product.kind === "subscription" ? "subscription" : "payment",
      line_items: [{ price: product.stripePriceId, quantity: 1 }],
      metadata: {
        tenant_id: tenant.id,
        product_id: product.id,
        user_id: user.id,
      },
      customer_email: user.email ?? undefined,
      // Design-Block (18.07.2026, Claude-Design-Import KursKauf.dc.html): der
      // Export zeigt ein eigenes "Rechnungsdaten"/"Zahlungsdaten"-Formular
      // (Name, Adresse, USt-ID, Zahlungsmittel). Diese App darf solche Daten
      // nie selbst entgegennehmen (kein PCI-Scope, siehe kaufen/[productSlug]/
      // page.tsx-Kommentar) - stattdessen sammelt die gehostete Stripe-Seite
      // sie jetzt zusaetzlich ab, um die Absicht des Exports einzuloesen.
      billing_address_collection: "required",
      phone_number_collection: { enabled: true },
      tax_id_collection: { enabled: true },
      success_url: buildTenantUrl(tenant, "/?checkout=success"),
      cancel_url: buildTenantUrl(tenant, `/kaufen/${slugCheck.data}?checkout=cancelled`),
    });
    if (!session.url) {
      return { error: "Stripe hat keine Checkout-URL geliefert." };
    }
    redirectUrl = session.url;
  } catch (e) {
    // Stripe-SDK-Fehlermeldungen sind technisch/englisch — Detail nur
    // loggen, Nutzer bekommt einen klaren deutschen Satz (analog
    // translateAuthError/translateDbError-Muster).
    console.error("[stripe/checkout] Checkout konnte nicht gestartet werden.", {
      tenantId: tenant.id,
      userId: user.id,
      productSlug: slugCheck.data,
      error: e instanceof Error ? e.message : e,
    });
    return { error: "Der Bezahlvorgang konnte gerade nicht gestartet werden. Bitte versuche es später erneut." };
  }

  // redirect() liegt bewusst AUSSERHALB des try/catch oben - Next.js
  // implementiert Redirects intern ueber einen geworfenen Kontroll-Wert, der
  // NICHT in einem umschliessenden catch abgefangen werden darf.
  redirect(redirectUrl);
}
