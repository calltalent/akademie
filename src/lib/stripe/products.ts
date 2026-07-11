"use server";

import { revalidatePath } from "next/cache";
import { requireStaffTenant } from "@/lib/auth/staff";
import { createStripeClient } from "@/lib/stripe/client";
import { productFormSchema } from "@/lib/stripe/schema";
import type { ProductActionState } from "@/lib/stripe/state";

/**
 * Staff-CRUD fuer Stripe-Produkte (Phase 2, Block 5). Entscheidung 2 aus der
 * Phase-2-Planung: Stripe-Produkt/Preis werden automatisch per API bei
 * Produktanlage im Admin mitgepflegt - kein manuelles Dashboard-Pflegen der
 * IDs. Alle Funktionen nutzen requireStaffTenant() (owner/admin/trainer,
 * wie im Auftrag vorgegeben) + `.eq("tenant_id", tenant.id)`-Defense-in-Depth
 * bei jeder Mutation, zusaetzlich zu RLS `products_staff_all`.
 */

function errorState(e: unknown): ProductActionState {
  return { error: e instanceof Error ? e.message : "Unbekannter Fehler." };
}

function parseProductForm(formData: FormData) {
  return productFormSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug"),
    kind: formData.get("kind"),
    priceEuro: formData.get("priceEuro"),
    currency: formData.get("currency"),
    active: formData.get("active") === "on",
    courseId: formData.get("courseId"),
  });
}

export async function createProduct(
  _prevState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = parseProductForm(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    // Ein einziger Stripe-API-Aufruf legt Produkt UND Preis zusammen an
    // (`product_data` embedded in `prices.create`) - spart den separaten
    // `stripe.products.create()`-Aufruf, den der architect-Plan als
    // Fallback vorsah (SDK unterstuetzt den kombinierten Aufruf).
    let stripeProductId: string;
    let stripePriceId: string;
    try {
      const stripe = createStripeClient();
      const price = await stripe.prices.create({
        currency: parsed.data.currency,
        unit_amount: parsed.data.priceCents,
        product_data: { name: parsed.data.title },
        ...(parsed.data.kind === "subscription" ? { recurring: { interval: "month" } } : {}),
      });
      stripeProductId = typeof price.product === "string" ? price.product : price.product.id;
      stripePriceId = price.id;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Stripe-Produkt konnte nicht angelegt werden.";
      return { error: "Stripe-Fehler: " + message };
    }

    const { error } = await supabase.from("products").insert({
      tenant_id: tenant.id,
      title: parsed.data.title,
      slug: parsed.data.slug,
      kind: parsed.data.kind,
      price_cents: parsed.data.priceCents,
      currency: parsed.data.currency,
      active: parsed.data.active,
      course_ids: parsed.data.courseId ? [parsed.data.courseId] : [],
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePriceId,
    });
    if (error) {
      return { error: "Anlegen fehlgeschlagen: " + error.message };
    }

    revalidatePath("/admin/zahlungen");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function updateProduct(
  productId: string,
  _prevState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = parseProductForm(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { data: existing, error: loadError } = await supabase
      .from("products")
      .select("id, kind, price_cents, currency, stripe_product_id, stripe_price_id")
      .eq("id", productId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (loadError || !existing) {
      return { error: "Produkt nicht gefunden." };
    }

    const stripe = createStripeClient();
    let stripeProductId = existing.stripe_product_id as string | null;
    let stripePriceId = existing.stripe_price_id as string | null;

    // Stripe-Preise sind unveraenderlich (kein Update von unit_amount
    // moeglich) - bei Preis-/Waehrungs-/Art-Aenderung wird ein NEUER Price
    // angelegt und der alte deaktiviert, statt ihn zu "editieren".
    const priceChanged =
      existing.price_cents !== parsed.data.priceCents ||
      existing.currency !== parsed.data.currency ||
      existing.kind !== parsed.data.kind;

    try {
      if (stripeProductId) {
        await stripe.products.update(stripeProductId, {
          name: parsed.data.title,
          active: parsed.data.active,
        });
      }

      if (priceChanged) {
        if (stripeProductId) {
          const newPrice = await stripe.prices.create({
            currency: parsed.data.currency,
            unit_amount: parsed.data.priceCents,
            product: stripeProductId,
            ...(parsed.data.kind === "subscription" ? { recurring: { interval: "month" } } : {}),
          });
          if (stripePriceId) {
            await stripe.prices.update(stripePriceId, { active: false }).catch(() => {
              // Nicht kritisch - der alte Preis bleibt dann inaktiv nutzbar,
              // wird aber lokal nicht mehr referenziert. Kein harter Fehler.
            });
          }
          stripePriceId = newPrice.id;
        } else {
          // Defensiv: sollte laut createProduct nie vorkommen (jedes Produkt
          // bekommt dort immer eine Stripe-Bindung), trotzdem abgesichert.
          const price = await stripe.prices.create({
            currency: parsed.data.currency,
            unit_amount: parsed.data.priceCents,
            product_data: { name: parsed.data.title },
            ...(parsed.data.kind === "subscription" ? { recurring: { interval: "month" } } : {}),
          });
          stripeProductId = typeof price.product === "string" ? price.product : price.product.id;
          stripePriceId = price.id;
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Stripe-Aktualisierung fehlgeschlagen.";
      return { error: "Stripe-Fehler: " + message };
    }

    const { error: updateError } = await supabase
      .from("products")
      .update({
        title: parsed.data.title,
        slug: parsed.data.slug,
        kind: parsed.data.kind,
        price_cents: parsed.data.priceCents,
        currency: parsed.data.currency,
        active: parsed.data.active,
        course_ids: parsed.data.courseId ? [parsed.data.courseId] : [],
        stripe_product_id: stripeProductId,
        stripe_price_id: stripePriceId,
      })
      .eq("id", productId)
      .eq("tenant_id", tenant.id);
    if (updateError) {
      return { error: "Aktualisieren fehlgeschlagen: " + updateError.message };
    }

    revalidatePath("/admin/zahlungen");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Stripe-Produkte werden nicht hart geloescht, sondern deaktiviert
 * (`stripe.products.update(id, { active: false })` + lokal `active: false`)
 * - historische Bestellungen bleiben referenzierbar. Beide Funktionen teilen
 * sich dieselbe interne Logik (`setProductActive`), nur die Richtung
 * unterscheidet sich - schlanker als zwei komplett getrennte Implementierungen.
 */
async function setProductActive(productId: string, active: boolean): Promise<ProductActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { data: existing } = await supabase
      .from("products")
      .select("stripe_product_id")
      .eq("id", productId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!existing) {
      return { error: "Produkt nicht gefunden." };
    }

    if (existing.stripe_product_id) {
      try {
        const stripe = createStripeClient();
        await stripe.products.update(existing.stripe_product_id, { active });
      } catch (e) {
        // Nicht kritisch fuer den lokalen Zustand - Sichtbarkeit im Shop
        // haengt an `products.active` (unsere DB-Zeile), nicht an Stripe.
        console.error("[stripe/products] Stripe-Produktstatus konnte nicht aktualisiert werden:", e);
      }
    }

    const { error } = await supabase
      .from("products")
      .update({ active })
      .eq("id", productId)
      .eq("tenant_id", tenant.id);
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/admin/zahlungen");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function archiveProduct(productId: string): Promise<ProductActionState> {
  return setProductActive(productId, false);
}

export async function reactivateProduct(productId: string): Promise<ProductActionState> {
  return setProductActive(productId, true);
}
