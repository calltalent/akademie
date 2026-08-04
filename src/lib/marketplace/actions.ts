"use server";

import { revalidatePath } from "next/cache";
import { requireStaffTenant } from "@/lib/auth/staff";
import { listingFormSchema } from "@/lib/marketplace/schema";
import { resolveUniquePublicSlug } from "@/lib/marketplace/resolve-slug";
import type { MarketplaceListingActionState } from "@/lib/marketplace/state";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";
import { createStripeClient } from "@/lib/stripe/client";

/**
 * Marketplace Block M2 (Mandanten-Admin) — CRUD für `marketplace_listings`
 * durch Mandanten-Staff. Gleiches Muster wie src/lib/stripe/products.ts:
 * jede Funktion beginnt mit `requireStaffTenant()` (zweite Verteidigungslinie
 * neben RLS, CLAUDE.md §2.1/Auftrag), plus `.eq("tenant_id", tenant.id)`
 * bei jeder Mutation als Defense-in-Depth.
 *
 * `status` wird von diesen Funktionen NIE frei gesetzt — nur 'draft' (create,
 * withdraw) und 'submitted' (submit), beides von der RLS-Policy
 * `ml_staff_insert`/`ml_staff_update` ohnehin einzig erlaubte Werte für
 * Staff-Schreibzugriffe (20260803100100_marketplace_listings.sql,
 * verschärft in 20260803100400_marketplace_security_hardening.sql). Die
 * Freigabe auf 'approved'/'rejected'/'suspended' bleibt exklusiv dem
 * Betreiber-Portal (M3) vorbehalten — Anwendungscode hier kann das laut RLS
 * gar nicht erzwingen, selbst wenn er es versuchte.
 *
 * `setListingEnabled()` schreibt NUR die Spalte `enabled` und funktioniert
 * bewusst auch für status='approved' — das setzt die Korrektur-Migration
 * 20260803110000_marketplace_listings_enabled_toggle_fix.sql voraus (siehe
 * dort: `ml_staff_update`s ursprüngliche `with check`-Klausel aus M1 hätte
 * JEDES Update eines bereits freigegebenen Listings blockiert, auch wenn nur
 * `enabled` geändert wird — Fund beim Implementieren dieser Datei, per neuer
 * Migration behoben, siehe PHASENSTATUS.md).
 */

function errorState(e: unknown): MarketplaceListingActionState {
  return { error: genericErrorMessage(e) };
}

function parseListingForm(formData: FormData) {
  return listingFormSchema.safeParse({
    headline: formData.get("headline"),
    summary: formData.get("summary"),
    coverUrl: formData.get("coverUrl"),
    priceEuro: formData.get("priceEuro"),
    courseId: formData.get("courseId"),
  });
}

const LISTINGS_PATH = "/admin/marketplace";

export async function createListing(
  _prevState: MarketplaceListingActionState,
  formData: FormData,
): Promise<MarketplaceListingActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = parseListingForm(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    // Zugehörigkeitsprüfung VOR dem Insert (Auftrag: "vorher per Query
    // prüfen, nicht nur auf RLS verlassen") — liefert eine klare deutsche
    // Fehlermeldung statt des rohen RLS-/Foreign-Key-Fehlers, den
    // `ml_staff_insert` sonst werfen würde.
    const { data: course } = await supabase
      .from("courses")
      .select("id, slug")
      .eq("id", parsed.data.courseId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!course) {
      return { error: "Kurs nicht gefunden oder gehört nicht zu diesem Mandanten." };
    }

    // `unique(course_id)` in der DB — vorab prüfen für eine sprechende
    // Fehlermeldung statt eines rohen 23505-Texts.
    const { data: existingListing } = await supabase
      .from("marketplace_listings")
      .select("id")
      .eq("course_id", course.id)
      .maybeSingle();
    if (existingListing) {
      return { error: "Für diesen Kurs existiert bereits ein Marketplace-Listing." };
    }

    const publicSlug = await resolveUniquePublicSlug(`${tenant.slug}-${course.slug}`);

    const { error } = await supabase.from("marketplace_listings").insert({
      tenant_id: tenant.id,
      course_id: course.id,
      public_slug: publicSlug,
      headline: parsed.data.headline ?? null,
      summary: parsed.data.summary ?? null,
      cover_url: parsed.data.coverUrl ?? null,
      price_cents: parsed.data.priceCents,
      status: "draft",
    });
    if (error) {
      return { error: "Anlegen fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath(LISTINGS_PATH);
    revalidatePath(`/admin/kurse/${course.id}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Bearbeiten nur bei status='draft'|'rejected' — ein bereits eingereichtes
 * (`submitted`) oder freigegebenes (`approved`) Listing soll nicht
 * "unbemerkt" unter dem Betreiber weggeändert werden können, während es
 * gerade geprüft wird oder öffentlich sichtbar ist. Das ist eine
 * Anwendungsregel OBERHALB der reinen RLS-Erlaubnis (RLS selbst würde ein
 * Bearbeiten von 'submitted' technisch zulassen, solange `status` im Update
 * unverändert bleibt) — Auftrag Plan Abschnitt 6.
 */
export async function updateListing(
  listingId: string,
  _prevState: MarketplaceListingActionState,
  formData: FormData,
): Promise<MarketplaceListingActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = parseListingForm(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id, status, course_id")
      .eq("id", listingId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!existing) {
      return { error: "Listing nicht gefunden." };
    }
    if (existing.status !== "draft" && existing.status !== "rejected") {
      return {
        error:
          "Nur nicht eingereichte oder abgelehnte Listings können bearbeitet werden. Bitte zuerst zurückziehen.",
      };
    }
    if (existing.course_id !== parsed.data.courseId) {
      // Verteidigung gegen ein manipuliertes verstecktes Feld — listing-form.tsx
      // sendet `courseId` beim Bearbeiten immer als deaktiviertes Feld mit,
      // die Kurs-Zuordnung eines Listings ändert sich nach Anlage aber nie.
      return { error: "Die Kurs-Zuordnung eines Listings kann nicht geändert werden." };
    }

    const { error } = await supabase
      .from("marketplace_listings")
      .update({
        headline: parsed.data.headline ?? null,
        summary: parsed.data.summary ?? null,
        cover_url: parsed.data.coverUrl ?? null,
        price_cents: parsed.data.priceCents,
      })
      .eq("id", listingId)
      .eq("tenant_id", tenant.id);
    if (error) {
      return { error: "Aktualisieren fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath(LISTINGS_PATH);
    revalidatePath(`/admin/kurse/${existing.course_id}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * M5 (Plan Abschnitt 5.2/7, löst den vorherigen TODO ein): bei
 * `price_cents > 0` und noch fehlendem `product_id` wird HIER, VOR dem
 * Wechsel auf `status='submitted'`, automatisch das zugehörige Stripe-Produkt
 * angelegt (Muster: `src/lib/stripe/products.ts::createProduct()` — bewusst
 * NICHT die exportierte Server Action selbst aufgerufen, die ist an ein
 * `FormData`/`productFormSchema`-Formular mit eigenen Feldern gebunden, die
 * hier nicht existieren; stattdessen dieselbe Kern-Sequenz — EIN
 * `stripe.prices.create()`-Aufruf mit eingebettetem `product_data` legt
 * Produkt UND Preis zusammen an — direkt nachgebaut).
 *
 * Schlägt die Stripe-Anlage fehl, bleibt das Listing bei 'draft'/'rejected'
 * stehen (kein zur Freigabe anstehendes, aber technisch nicht kaufbares
 * Listing, Auftrag wörtlich).
 *
 * DESIGN-ENTSCHEIDUNG (Plan nennt hierzu kein konkretes Schema, siehe
 * Auftragstext Punkt 7 "deine Entscheidung, dokumentiere sie"): als
 * `products.slug` wird der bereits GLOBAL eindeutige `public_slug` des
 * Listings wiederverwendet (`unique` in `20260803100100_marketplace_listings.sql`
 * — stärker als die von `products` nur verlangte Eindeutigkeit je Mandant,
 * `unique(tenant_id, slug)`), daher kollisionsfrei. `product_id` wird im
 * SELBEN `update`-Aufruf gesetzt wie `status`/`submitted_at` (ein Statement
 * statt zwei getrennter Schreibzugriffe).
 */
async function createStripeProductForListing(
  supabase: Awaited<ReturnType<typeof requireStaffTenant>>["supabase"],
  tenantId: string,
  listing: { course_id: string; price_cents: number; public_slug: string; headline: string | null },
): Promise<{ productId: string } | { error: string }> {
  const { data: course } = await supabase
    .from("courses")
    .select("title")
    .eq("id", listing.course_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const productTitle = listing.headline?.trim() || course?.title || "Marketplace-Kurs";

  let stripeProductId: string;
  let stripePriceId: string;
  try {
    const stripe = createStripeClient();
    const price = await stripe.prices.create({
      currency: "eur",
      unit_amount: listing.price_cents,
      product_data: { name: productTitle },
    });
    stripeProductId = typeof price.product === "string" ? price.product : price.product.id;
    stripePriceId = price.id;
  } catch (e) {
    console.error("[marketplace/actions] Stripe-Produkt für Listing konnte nicht angelegt werden.", {
      tenantId,
      courseId: listing.course_id,
      error: e instanceof Error ? e.message : e,
    });
    return { error: "Stripe-Produkt konnte nicht angelegt werden. Bitte versuche es später erneut." };
  }

  const { data: newProduct, error: productError } = await supabase
    .from("products")
    .insert({
      tenant_id: tenantId,
      title: productTitle,
      slug: listing.public_slug,
      kind: "one_time",
      price_cents: listing.price_cents,
      currency: "eur",
      active: true,
      course_ids: [listing.course_id],
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePriceId,
    })
    .select("id")
    .single();
  if (productError || !newProduct) {
    return { error: "Stripe-Produkt konnte nicht gespeichert werden: " + translateDbError(productError) };
  }

  return { productId: newProduct.id };
}

export async function submitListing(listingId: string): Promise<MarketplaceListingActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id, status, course_id, price_cents, product_id, public_slug, headline")
      .eq("id", listingId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!existing) {
      return { error: "Listing nicht gefunden." };
    }
    if (existing.status !== "draft" && existing.status !== "rejected") {
      return { error: "Nur Entwürfe oder abgelehnte Listings können eingereicht werden." };
    }

    let productId = existing.product_id as string | null;
    if (existing.price_cents > 0 && !productId) {
      const result = await createStripeProductForListing(supabase, tenant.id, existing);
      if ("error" in result) {
        return { error: result.error };
      }
      productId = result.productId;
    }

    const { error } = await supabase
      .from("marketplace_listings")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        ...(productId && productId !== existing.product_id ? { product_id: productId } : {}),
      })
      .eq("id", listingId)
      .eq("tenant_id", tenant.id);
    if (error) {
      return { error: "Einreichen fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath(LISTINGS_PATH);
    revalidatePath(`/admin/kurse/${existing.course_id}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Zurückziehen ist nur aus 'submitted' erlaubt (noch nicht geprüft). Ein
 * bereits freigegebenes Listing lässt sich NICHT zurückziehen (der
 * öffentliche Marketplace-Auftritt soll nicht durch einen einzelnen
 * Mandanten-Klick verschwinden können, ohne dass der Betreiber das
 * mitbekommt) — die tatsächliche Deaktivierung eines freigegebenen Listings
 * ist `setListingEnabled(id, false)`, Auftrag Plan Abschnitt 6.
 */
export async function withdrawListing(listingId: string): Promise<MarketplaceListingActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id, status, course_id")
      .eq("id", listingId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!existing) {
      return { error: "Listing nicht gefunden." };
    }
    if (existing.status === "approved") {
      return {
        error:
          "Freigegebene Listings können nicht zurückgezogen werden. Nutze stattdessen den Schalter „Sichtbar im Marketplace“, um es zu deaktivieren.",
      };
    }
    if (existing.status !== "submitted") {
      return { error: "Nur eingereichte Listings können zurückgezogen werden." };
    }

    const { error } = await supabase
      .from("marketplace_listings")
      .update({ status: "draft", submitted_at: null })
      .eq("id", listingId)
      .eq("tenant_id", tenant.id);
    if (error) {
      return { error: "Zurückziehen fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath(LISTINGS_PATH);
    revalidatePath(`/admin/kurse/${existing.course_id}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Mandanten-Sichtbarkeits-Schalter, unabhängig vom Betreiber-`status` — nur
 * sinnvoll für status='approved' (Auftrag), technisch aber für jeden Status
 * aufrufbar (schadet bei draft/submitted/rejected/suspended nicht, diese
 * Listings sind ohnehin nie öffentlich sichtbar, da die spätere
 * Katalog-Abfrage in M4 zusätzlich `status='approved'` verlangt).
 */
export async function setListingEnabled(
  listingId: string,
  enabled: boolean,
): Promise<MarketplaceListingActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id, course_id")
      .eq("id", listingId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!existing) {
      return { error: "Listing nicht gefunden." };
    }

    const { error } = await supabase
      .from("marketplace_listings")
      .update({ enabled })
      .eq("id", listingId)
      .eq("tenant_id", tenant.id);
    if (error) {
      return { error: translateDbError(error) };
    }

    revalidatePath(LISTINGS_PATH);
    revalidatePath(`/admin/kurse/${existing.course_id}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}
