import { z } from "zod";

/**
 * Marketplace Block M2 (Mandanten-Admin, Plan
 * "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt 6). Spaltennamen
 * exakt aus supabase/migrations/20260803100100_marketplace_listings.sql:
 *   marketplace_listings(id, tenant_id, course_id, public_slug, headline,
 *     summary, cover_url, price_cents, currency, product_id, status, enabled,
 *     submitted_at, reviewed_at, reviewed_by, review_note, created_at,
 *     updated_at)
 *
 * `status` wird von diesem Formular NIE geschrieben — RLS (`ml_staff_insert`/
 * `ml_staff_update`, siehe Migration) erzwingt ohnehin nur 'draft'/'submitted'
 * bei Staff-Schreibzugriffen, die Statuslogik selbst lebt in
 * src/lib/marketplace/actions.ts (submitListing/withdrawListing).
 */

export const MARKETPLACE_LISTING_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "suspended",
] as const;
export type MarketplaceListingStatus = (typeof MARKETPLACE_LISTING_STATUSES)[number];

/** Exakte Formulierungen aus Plan Abschnitt 6. */
export const MARKETPLACE_STATUS_LABELS: Record<MarketplaceListingStatus, string> = {
  draft: "Nicht gelistet",
  submitted: "In Prüfung",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  suspended: "Vom Betreiber deaktiviert",
};

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * M5 (Checkout/Erwerb, Plan Abschnitt 5): Eingabegrenzen-Validierung für
 * `public_slug`, wenn er aus einer Server-Action-Eingabe kommt
 * (`acquireFreeListing`/`createMarketplaceCheckout`) statt aus einem
 * Next.js-Routen-Parameter. Gleiches Muster wie `productSlugSchema` in
 * `stripe/schema.ts`. `max(160)` statt 80 dort: `resolveUniquePublicSlug()`
 * (`resolve-slug.ts`) verkettet `{tenant_slug}-{course_slug}` (bis zu
 * 41 + 80 Zeichen laut `tenants.slug`/`courses.slug`-Constraints) plus
 * einen numerischen Kollisions-Suffix.
 */
export const publicSlugSchema = z
  .string()
  .trim()
  .min(1, "Marketplace-Slug darf nicht leer sein.")
  .max(160)
  .regex(SLUG_PATTERN, "Ungültiger Marketplace-Slug.");

function eurosToCents(value: string): number {
  const normalized = value.replace(",", ".");
  return Math.round(parseFloat(normalized) * 100);
}

/** Für defaultValue-Anzeige im Bearbeiten-Formular (Cent -> Euro-String). */
export function centsToEuroInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Abweichung ggü. `priceEuroSchema` in stripe/schema.ts (Plan Abschnitt 11.1,
 * Abweichung 1): dort `> 0` (jedes Stripe-Produkt braucht einen echten Preis),
 * hier `>= 0` — ein Marketplace-Listing DARF `price_cents = 0` sein (Gratis-
 * Fall). Ein kostenloses Listing bekommt in M5 kein Stripe-Preisobjekt
 * (`product_id` bleibt null), siehe TODO in actions.ts::submitListing().
 */
const priceEuroSchema = z
  .string()
  .trim()
  .regex(/^\d+([.,]\d{1,2})?$/, "Preis als Euro-Betrag angeben, z. B. 9,90 oder 0 für kostenlos.");

/**
 * Formular für Anlage UND Bearbeitung (ein Formular, zwei Server Actions —
 * gleiches Muster wie productFormSchema/ProductForm). `courseId` ist auch im
 * Bearbeiten-Fall Pflichtfeld im Formular (verstecktes/deaktiviertes Feld,
 * siehe listing-form.tsx), wird von `updateListing()` aber NUR zur
 * Verifikation genutzt (muss zum bestehenden Listing passen) — die
 * Kurs-Zuordnung selbst ändert sich beim Bearbeiten nie, `unique(course_id)`
 * in der DB würde eine Änderung ohnehin nur selten sinnvoll machen.
 *
 * Kurs-Zugehörigkeit zum Mandanten wird NICHT hier geprüft (zod kennt den
 * aktuellen Mandanten nicht) — das passiert serverseitig in actions.ts, mit
 * eigener, klarer Fehlermeldung statt eines rohen RLS-Fehlers.
 */
export const listingFormSchema = z
  .object({
    headline: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().max(200, "Titel darf höchstens 200 Zeichen haben.").optional(),
    ),
    summary: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().max(2000, "Beschreibung darf höchstens 2000 Zeichen haben.").optional(),
    ),
    coverUrl: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().url("Ungültige Bild-URL.").optional(),
    ),
    priceEuro: priceEuroSchema,
    courseId: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string({ required_error: "Bitte einen Kurs auswählen." }).uuid("Bitte einen Kurs auswählen."),
    ),
  })
  .transform(({ priceEuro, ...rest }) => ({ ...rest, priceCents: eurosToCents(priceEuro) }))
  .refine((data) => data.priceCents >= 0, {
    // Praktisch immer wahr (die Regex oben lässt kein Minuszeichen zu) —
    // trotzdem als explizite, sprechende Fehlermeldung stehen gelassen,
    // exakt wie `productFormSchema`s `.refine()` (dort `> 0`), falls die
    // Regex je gelockert wird.
    message: "Preis darf nicht negativ sein.",
    path: ["priceEuro"],
  });
export type ListingFormInput = z.infer<typeof listingFormSchema>;
