import { z } from "zod";

/**
 * Block 5 (Phase 2) - Stripe (Produkte, Checkout, Webhook, Portal).
 * Spaltennamen exakt aus supabase/migrations/0001_init.sql:
 *   products(id, tenant_id, title, slug, course_ids uuid[], kind,
 *            price_cents, currency, stripe_product_id, stripe_price_id,
 *            active)
 *   orders(id, tenant_id, user_id, product_id, stripe_checkout_id UNIQUE,
 *          stripe_payment_intent, amount_cents, currency, status)
 *   subscriptions(id, tenant_id, user_id, product_id,
 *                 stripe_subscription_id UNIQUE, status, current_period_end)
 *
 * `course_ids` ist ein Array (mehrere Kurse pro Produkt moeglich laut DB) -
 * das Formular in v1 bietet bewusst nur EINE Kurs-Zuordnung an (haeufigster
 * Fall: 1 Produkt = 1 Kurs), gespeichert als Array mit 0 oder 1 Eintraegen.
 * Mehrfachzuordnung ist technisch moeglich (DB erlaubt es), nur ohne UI in
 * diesem Block - bei Bedarf spaeter nachruestbar ohne Schema-Aenderung.
 *
 * `products` hat keine `description`-Spalte - die Kaufseite zeigt deshalb
 * nur Titel/Art/Preis, keine Langbeschreibung (Abweichung vom Plan-Wortlaut
 * "Titel, Beschreibung falls vorhanden, Preis, Waehrung, kind").
 */

export const PRODUCT_KINDS = ["one_time", "subscription"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const PRODUCT_KIND_LABELS: Record<ProductKind, string> = {
  one_time: "Einmalkauf",
  subscription: "Abo (monatlich)",
};

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Von Route/Server Action geteilte Slug-Pruefung (jede Eingabegrenze mit zod, CLAUDE.md §2.3). */
export const productSlugSchema = z
  .string()
  .trim()
  .min(1, "Produkt-Slug darf nicht leer sein.")
  .max(80)
  .regex(SLUG_PATTERN, "Ungültiger Produkt-Slug.");

function eurosToCents(value: string): number {
  const normalized = value.replace(",", ".");
  return Math.round(parseFloat(normalized) * 100);
}

/** Fuer defaultValue-Anzeige im Bearbeiten-Formular (Cent -> Euro-String). */
export function centsToEuroInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

const priceEuroSchema = z
  .string()
  .trim()
  .regex(/^\d+([.,]\d{1,2})?$/, "Preis als Euro-Betrag angeben, z. B. 9,90.");

/**
 * Produkt-Formular (Staff, Admin/Zahlungen). Preis-Eingabe bewusst als
 * Euro-String ("sinnvolle Euro-Eingabe + Umrechnung" laut Auftrag) unter dem
 * Feldnamen `priceEuro` - nach `.transform()` liefert `parsed.data.priceCents`
 * die ganzzahlige Cent-Zahl, exakt passend zur DB-Spalte `price_cents`.
 * `currency` bewusst ohne eigenes Formularfeld (kein UI-Feld) - fix `eur`
 * (DB-Default), da SPEC/Migration keine Mehrwaehrungs-Anforderung fuer v1
 * nennen; einfachste Loesung (CLAUDE.md §4.5).
 */
export const productFormSchema = z
  .object({
    title: z.string().trim().min(1, "Titel darf nicht leer sein.").max(200),
    slug: z
      .string()
      .trim()
      .min(1, "Slug darf nicht leer sein.")
      .max(80)
      .regex(SLUG_PATTERN, "Slug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten."),
    kind: z.enum(PRODUCT_KINDS),
    priceEuro: priceEuroSchema,
    currency: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim().toLowerCase() : "eur"),
      z.string().length(3, "Währung als 3-stelliger ISO-Code, z. B. eur."),
    ),
    active: z.boolean(),
    // Pflichtfeld (Josips Auftrag 19.07.2026: "es darf keine andere Option
    // geben") — jedes Produkt MUSS mit einem bestehenden Kurs verknüpft
    // sein, kein "Kein Kurs"-Fall mehr. `course_ids` in der DB bleibt ein
    // Array (mehrere Kurse technisch möglich, siehe Kopfkommentar), das
    // Formular liefert weiterhin genau ein Element hinein.
    courseId: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string({ required_error: "Bitte einen Kurs auswählen." }).uuid("Bitte einen Kurs auswählen."),
    ),
    // NEU (19.07.2026, Josips Auftrag "Unterseite Produkte"): Beschreibung
    // der Kaufseite (/kaufen/[productSlug]) — bisher hatte die Kaufseite
    // keinerlei eigenes Textfeld, nur aus title/kind/price/Kurs abgeleitete
    // Anzeige. Optional, da eine leere Kaufseite (nur mit den automatisch
    // berechneten Kurs-Eckdaten) weiterhin ein gültiger Zustand ist.
    description: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().max(2000, "Beschreibung darf höchstens 2000 Zeichen haben.").optional(),
    ),
  })
  .transform(({ priceEuro, ...rest }) => ({ ...rest, priceCents: eurosToCents(priceEuro) }))
  .refine((data) => data.priceCents > 0, {
    message: "Preis muss größer als 0 sein.",
    path: ["priceEuro"],
  });
export type ProductFormInput = z.infer<typeof productFormSchema>;

/**
 * Webhook-Sicherheitsregel (Auftrag): tenant_id/product_id/user_id kommen
 * AUSSCHLIESSLICH aus der Checkout-Session-Metadata, die beim serverseitigen
 * Session-Aufbau gesetzt wurde (siehe checkout.ts) - niemals aus einer
 * anderen Quelle im Webhook. Diese Schema-Pruefung ist zusaetzliche
 * Verteidigung gegen manipulierte/unerwartete Metadata-Inhalte (CLAUDE.md
 * §2.3: jede Eingabegrenze mit zod, auch innerhalb eines bereits signatur-
 * geprueften Stripe-Events).
 */
export const checkoutMetadataSchema = z.object({
  tenant_id: z.string().uuid(),
  product_id: z.string().uuid(),
  user_id: z.string().uuid(),
});
export type CheckoutMetadata = z.infer<typeof checkoutMetadataSchema>;
