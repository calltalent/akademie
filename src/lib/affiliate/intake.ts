import "server-only";
import type Stripe from "stripe";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { affiliateReferralTokenSchema } from "@/lib/affiliate/schema";
import type { AFFILIATE_CHECKOUT_METADATA_KEY } from "@/lib/affiliate/checkout-meta";

/**
 * Affiliate-System, Block B4 — die AUFNAHME in die Outbox
 * (PLAN_Affiliate-System.md, Grundsatzentscheidungen G1 und G2, Datenmodell
 * 3.10, Einhängepunkte 9.3 bis 9.6).
 *
 * Der Stripe-Webhook tut für dieses Modul genau eine Sache: er schreibt EINE
 * Zeile in `affiliate_events`. Die gesamte Provisionslogik läuft danach im
 * Cron-Verarbeiter (`process.ts`). Damit kann ein Fehler in der
 * Affiliate-Rechnung die Kauferfüllung strukturell nicht mehr brechen, und
 * ein fehlgeschlagenes Geldereignis bleibt mit `attempts`/`last_error`
 * sichtbar liegen, statt still zu verschwinden (G1).
 *
 * ## Warum diese Funktion WIRFT (G2)
 *
 * Ein `try { … } catch { console.error() }` um den Insert wäre exakt der
 * Fehler, den G1 vermeiden will — nur eine Ebene früher. Dieses Repo hat die
 * Gegenprobe zweimal bezahlt: der `marketplace_ledger`-Upsert loggt bei
 * Fehler nur (`src/lib/marketplace/fulfil.ts:229-231`, die Zeile ist danach
 * dauerhaft verloren), und der K1-Fund war „bezahlt, kein Zugriff".
 *
 * Deshalb: `recordAffiliateEvent()` wirft bei JEDEM Fehler außer `23505`
 * (Unique-Verletzung auf `stripe_event_id` = ein normaler Stripe-Retry). Der
 * Webhook antwortet dann 500, Stripe stellt erneut zu.
 *
 * Die Aufrufreihenfolge ist Teil der Regel und steht an den Einhängepunkten
 * (9.4/9.5/9.6): der Aufruf sitzt NACH `enrollFromProduct()` bzw. nach der
 * Zugriffsgewähr. Der Käufer hat seinen Zugriff also bereits, bevor hier
 * irgendetwas schiefgehen kann — der Wurf kostet einen Retry, nie einen Kauf.
 *
 * Die Idempotenz kommt ausschließlich aus `unique (stripe_event_id)` und
 * ausdrücklich NICHT aus `isNewOrder`
 * (`src/app/api/stripe/webhook/route.ts:132`): wirft ein früherer Schritt,
 * existiert die Order beim Retry bereits, `isNewOrder` wäre `false` und die
 * Aufnahme fiele dauerhaft aus (G3).
 *
 * ## Was in `payload` landet — und was nicht
 *
 * Ausschließlich die für die Rechnung nötigen Zahlenfelder (3.10). Nicht das
 * volle Stripe-Objekt: sonst lägen Kundenname, Anschrift und Steuer-ID
 * dauerhaft in einer zweiten Tabelle ohne eigenen Löschgrund.
 *
 * ## Keine Geheimnisse, keine Token in Logs
 *
 * `error.message` wird nirgends ausgegeben und auch nicht in die geworfene
 * Meldung übernommen (CLAUDE.md §2.11, Plan 11.11): bei einer
 * Constraint-Verletzung trägt die PostgREST-Meldung den Schlüsselwert im
 * Klartext — hier also die Stripe-Event-ID, und im Nachbarpfad
 * (`track.ts:328-343`) das Referral-Token. Nach außen geht nur der
 * PostgREST-Fehlercode.
 */

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Der Metadata-Schlüssel aus 9.2. Er steht hier als eigene Konstante und
 * nicht als Laufzeit-Import aus `checkout-meta.ts`, weil diese Datei sonst
 * deren ganzen Serverbaum nachzöge (`next/headers`, `access.ts` → `env.ts`)
 * und damit ohne Anfrage-Kontext und ohne vollständige `.env` nicht mehr
 * ladbar wäre — ein Preis, den eine Funktion nicht zahlen soll, die nur eine
 * Zeile schreibt.
 *
 * Die Kopplung bleibt trotzdem vom Compiler geprüft: die Typangabe ist
 * `typeof AFFILIATE_CHECKOUT_METADATA_KEY` aus einem TYPE-ONLY-Import. Weil
 * dort `const` steht, ist das der Literaltyp `"affiliate_ref_token"` — wer
 * den Schlüssel drüben umbenennt, bekommt HIER einen Übersetzungsfehler und
 * keine stumme Fehlzuordnung. Der Import erzeugt zur Laufzeit nichts.
 */
const AFFILIATE_REF_TOKEN_METADATA_KEY: typeof AFFILIATE_CHECKOUT_METADATA_KEY =
  "affiliate_ref_token";

/**
 * Ein Token aus der Stripe-Metadata gegen das vereinbarte Muster prüfen
 * (CLAUDE.md §2.3). Gleiche Regel wie `parseReferralToken()` in
 * `checkout-meta.ts`, hier über dasselbe zod-Schema statt über einen zweiten
 * regulären Ausdruck.
 */
function parseMetadataToken(raw: unknown): string | null {
  const parsed = affiliateReferralTokenSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** PostgREST/Postgres: Verletzung eines Unique-Constraints. */
export const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Ereignisarten, die dieses Modul überhaupt aufnimmt. Die Liste ist eine
 * ERLAUBNISLISTE und keine Sperrliste: ein künftiger, hier unbekannter
 * Ereignistyp wird nicht aufgenommen, statt mit einem leeren `payload` in der
 * Outbox zu landen und den Verarbeiter zu beschäftigen.
 *
 * `charge.refunded` und die beiden Dispute-Ereignisse stehen bereits hier,
 * obwohl ihre VERARBEITUNG erst mit B5 kommt (Plan 9.3): die Aufnahme ist der
 * Teil, der verlustfrei sein muss. Ein Ereignis, das nicht aufgenommen wurde,
 * ist nach dem Stripe-Retry-Fenster von rund drei Tagen endgültig weg; ein
 * aufgenommenes Ereignis ohne Verarbeiter wartet in der Outbox (6.6).
 */
export const AFFILIATE_EVENT_TYPES = [
  "checkout.session.completed",
  "invoice.paid",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
] as const;
export type AffiliateEventType = (typeof AFFILIATE_EVENT_TYPES)[number];

/**
 * Die Zahlenfelder aus 3.10, die der Verarbeiter für die Rechnung braucht.
 * Alle Beträge in Ganzzahl-Cent (G12).
 *
 * ZWEI ZUSÄTZE gegenüber der Liste im Plan, beide mit Anlass:
 *
 *  - `livemode`: Plan 4.5 macht eine Buchung genau dann zur Testbuchung, wenn
 *    `program.test_mode = true` ODER `event.livemode === false`. Der zweite
 *    Teil steht ausschließlich auf dem Ereignis-Objekt und ist zum Zeitpunkt
 *    der Verarbeitung sonst nicht mehr rekonstruierbar. Ein Wahrheitswert ist
 *    kein personenbezogenes Datum; die Begründung für die schmale Liste
 *    (keine Kundendaten in einer zweiten Tabelle) bleibt unberührt.
 *  - `amount_total` trägt bei einer Rechnung `invoice.total`. Das ist kein
 *    zusätzliches Feld, sondern dieselbe Spalte in ihrer zweiten Bedeutung:
 *    `computeBaseCents()` braucht den Rechnungs-Gesamtbetrag, um die
 *    ausgewiesene Steuer anteilig zu kürzen, wenn ein Kundenguthaben
 *    angerechnet wurde und `amount_paid` deshalb kleiner ist (5.1, G13).
 */
export type AffiliateEventPayload = {
  /** `session.amount_total` bzw. `invoice.total` (siehe oben). */
  amount_total?: number | null;
  /** `invoice.amount_paid` — der tatsächlich vereinnahmte Betrag (G13). */
  amount_paid?: number | null;
  /** `session.total_details.amount_tax` bzw. Summe über `invoice.total_taxes[].amount`. */
  amount_tax?: number | null;
  /** `session.total_details.amount_shipping`; bei einer Rechnung immer 0. */
  amount_shipping?: number | null;
  currency?: string | null;
  /** `invoice.billing_reason` — `subscription_create` wird vom Checkout bereits gebucht (5.7). */
  billing_reason?: string | null;
  /** `charge.amount_refunded` — KUMULATIV, nicht das Delta dieses Ereignisses (G7). */
  amount_refunded?: number | null;
  /** `charge.amount` — die Bezugsgröße des Storno-Verhältnisses (G7). */
  charge_amount?: number | null;
  dispute_amount?: number | null;
  dispute_status?: string | null;
  /**
   * `dispute.id` — die Kennung des Streitfalls selbst, NICHT die des Charge.
   *
   * Sie ist kein schmueckendes Beiwerk, sondern der Schluessel des ganzen
   * Storno-Pfades (5.8): sie bildet den `dedup_key` der Gegenbuchung
   * (`reversal:<reverses_id>:<dispute_id>:<betrag>`) und den Sperrschluessel
   * der Buchung. Ohne sie muesste der Verarbeiter auf `charge.id` ausweichen —
   * dann teilten sich eine Erstattung und eine Rueckbuchung DESSELBEN Charge
   * einen Schluesselraum, und die Wiedergutschrift eines gewonnenen
   * Streitfalls holte die Gegenbuchungen der danebenliegenden Erstattung mit
   * zurueck (`recreditForWonDispute()` sucht ueber genau diese Kennung).
   */
  dispute_id?: string | null;
  /** `event.livemode` (siehe oben, Plan 4.5). */
  livemode?: boolean | null;
};

/**
 * Was der Aufrufer beisteuert, weil das Stripe-Objekt es nicht trägt.
 *
 * Alles andere leitet diese Datei selbst aus `event.data.object` ab — damit
 * jeder der vier Einhängepunkte (9.4, 9.5, 9.6 und der Nachhol-Lauf aus 6.6)
 * dieselbe Zerlegung benutzt und nicht jeder seine eigene.
 */
export type RecordAffiliateEventContext = {
  /**
   * Der Mandant, sofern der Aufrufer ihn kennt (Direktkauf und Marketplace:
   * aus der geprüften Session-Metadata). Für `charge.refunded` und die
   * Dispute-Ereignisse ist er zum Aufnahmezeitpunkt NICHT bekannt — ein
   * `Stripe.Charge` trägt keine Session-Metadata. Die Spalte ist deshalb
   * nullbar, und die Auflösung ist Aufgabe des Verarbeiters (3.10, 6.5 b).
   */
  tenantId?: string | null;
  /** Die soeben geschriebene `orders`-Zeile (9.4: `order.id` liegt dort vor). */
  orderId?: string | null;
  /** Rechnungs-/Abo-Kennung, wenn der Aufrufer sie bereits zerlegt hat (9.5). */
  stripeInvoiceId?: string | null;
  stripeSubscriptionId?: string | null;
};

/**
 * `inserted` = neue Zeile, `duplicate` = dasselbe Stripe-Ereignis war schon
 * da (normaler Retry). Beides ist Erfolg; der Unterschied ist nur für Tests
 * und ein sparsames Logging interessant.
 */
export type AffiliateEventIntakeResult = "inserted" | "duplicate";

// --- Stripe-Objekte zerlegen (rein, kein I/O) ---------------------------

/**
 * Eine Stripe-Referenz, die je nach Expansion ein String oder ein Objekt mit
 * `id` sein kann. Vorbild: `extractSubscriptionId()` im Webhook
 * (`src/app/api/stripe/webhook/route.ts:370-384`).
 */
function referenceId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value !== null && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

/** Ganzzahl-Cent aus einem Stripe-Feld; alles Unbrauchbare wird zu `null`. */
function centsOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * Stripe-Sekunden in einen ISO-Zeitstempel. `null`, wenn der Wert fehlt oder
 * unbrauchbar ist — der Aufrufer fällt dann auf `event.created` zurück.
 */
function isoFromUnixSeconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(Math.trunc(value) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Die ausgewiesene Umsatzsteuer einer Rechnung. `stripe@18` kennt kein
 * `invoice.tax` mehr (belegt in `node_modules/stripe/types/Invoices.d.ts:439`
 * — dort steht `total_taxes: Array<Invoice.TotalTax> | null`), die Steuer ist
 * eine Summe über Positionen.
 */
function invoiceTaxCents(invoice: Stripe.Invoice): number | null {
  const taxes = (invoice as unknown as { total_taxes?: Array<{ amount?: unknown }> | null })
    .total_taxes;
  if (!Array.isArray(taxes)) return null;
  let sum = 0;
  for (const tax of taxes) sum += centsOrNull(tax?.amount) ?? 0;
  return sum;
}

/**
 * Die Rechnung eines Charge. `stripe@18` führt `invoice` nicht mehr in der
 * Typdefinition von `Charge` (geprüft in
 * `node_modules/stripe/types/Charges.d.ts`), die API liefert das Feld aber
 * weiter aus. Deshalb derselbe defensive Zugriff über `unknown` wie bei
 * `extractSubscriptionId()` im Webhook — und nicht ein `as Stripe.Charge &
 * { invoice: string }`, das eine Zusicherung gäbe, die niemand prüft.
 */
function chargeInvoiceId(charge: Stripe.Charge): string | null {
  return referenceId((charge as unknown as { invoice?: unknown }).invoice);
}

/** Die Kennungen und Zahlen eines Ereignisses, aus dem Ereignis selbst. */
type EventFacts = {
  orderId: string | null;
  stripeInvoiceId: string | null;
  stripeSubscriptionId: string | null;
  stripeChargeId: string | null;
  stripePaymentIntent: string | null;
  referralToken: string | null;
  payload: AffiliateEventPayload;
  /**
   * Die STRIPE-Zeit des Vorgangs, nicht die Verarbeitungszeit (3.10): bei
   * einem Retry nach drei Tagen darf sich die Sperrfrist nicht verschieben.
   */
  occurredAt: string | null;
};

const EMPTY_FACTS: EventFacts = {
  orderId: null,
  stripeInvoiceId: null,
  stripeSubscriptionId: null,
  stripeChargeId: null,
  stripePaymentIntent: null,
  referralToken: null,
  payload: {},
  occurredAt: null,
};

function checkoutFacts(session: Stripe.Checkout.Session): EventFacts {
  return {
    ...EMPTY_FACTS,
    stripeSubscriptionId: referenceId(session.subscription),
    stripePaymentIntent: referenceId(session.payment_intent),
    stripeInvoiceId: referenceId((session as unknown as { invoice?: unknown }).invoice),
    // Der Token wird beim Aufnehmen noch einmal gegen das vereinbarte Muster
    // geprüft (CLAUDE.md §2.3). Er geht später in einen Query-Filter; ein
    // Wert, der das Muster verletzt, hat in der Spalte nichts zu suchen und
    // wäre ohnehin kein auffindbares Token.
    referralToken: parseMetadataToken(session.metadata?.[AFFILIATE_REF_TOKEN_METADATA_KEY]),
    payload: {
      amount_total: centsOrNull(session.amount_total),
      amount_tax: centsOrNull(session.total_details?.amount_tax),
      amount_shipping: centsOrNull(session.total_details?.amount_shipping),
      currency: session.currency ?? null,
    },
    occurredAt: isoFromUnixSeconds(session.created),
  };
}

function invoiceFacts(invoice: Stripe.Invoice): EventFacts {
  return {
    ...EMPTY_FACTS,
    stripeInvoiceId: invoice.id ?? null,
    // Dieselbe Zerlegung wie `extractSubscriptionId()` im Webhook: in
    // `stripe@18` hängt die Abo-Kennung je nach Rechnungsart entweder direkt
    // an `invoice.subscription` oder an
    // `invoice.parent.subscription_details.subscription`.
    stripeSubscriptionId:
      referenceId((invoice as unknown as { subscription?: unknown }).subscription) ??
      referenceId(
        (
          invoice as unknown as {
            parent?: { subscription_details?: { subscription?: unknown } | null } | null;
          }
        ).parent?.subscription_details?.subscription,
      ),
    stripeChargeId: referenceId((invoice as unknown as { charge?: unknown }).charge),
    stripePaymentIntent: referenceId(
      (invoice as unknown as { payment_intent?: unknown }).payment_intent,
    ),
    payload: {
      // G13: Basis einer Abo-Rate ist `amount_paid`, NIE `total`. Beide werden
      // mitgeführt, weil `computeBaseCents()` `total` für die anteilige
      // Kürzung der Steuer braucht (5.1) — gerechnet wird trotzdem auf
      // `amount_paid`.
      amount_paid: centsOrNull(invoice.amount_paid),
      amount_total: centsOrNull(invoice.total),
      amount_tax: invoiceTaxCents(invoice),
      amount_shipping: 0,
      currency: invoice.currency ?? null,
      billing_reason: invoice.billing_reason ?? null,
    },
    occurredAt: isoFromUnixSeconds(invoice.status_transitions?.paid_at),
  };
}

function chargeFacts(charge: Stripe.Charge): EventFacts {
  return {
    ...EMPTY_FACTS,
    stripeChargeId: charge.id ?? null,
    stripePaymentIntent: referenceId(charge.payment_intent),
    stripeInvoiceId: chargeInvoiceId(charge),
    payload: {
      // G7: `amount_refunded` ist der GESAMTE bisher erstattete Betrag
      // (`node_modules/stripe/types/Charges.d.ts:35`), nicht das Delta dieses
      // Ereignisses. Der Verarbeiter rechnet daraus einen Zielwert.
      amount_refunded: centsOrNull(charge.amount_refunded),
      charge_amount: centsOrNull(charge.amount),
      currency: charge.currency ?? null,
    },
    occurredAt: isoFromUnixSeconds(charge.created),
  };
}

function disputeFacts(dispute: Stripe.Dispute): EventFacts {
  return {
    ...EMPTY_FACTS,
    stripeChargeId: referenceId(dispute.charge),
    stripePaymentIntent: referenceId(dispute.payment_intent),
    payload: {
      // Der Dispute-Betrag kann ein Teilbetrag sein (5.8); er wird deshalb
      // mitgeführt und nicht als „voller Charge" angenommen.
      dispute_amount: centsOrNull(dispute.amount),
      dispute_status: dispute.status ?? null,
      // Die Kennung des Streitfalls — siehe `dispute_id` in
      // `AffiliateEventPayload`. Sie steht NUR auf diesem Objekt; nach der
      // Aufnahme ist sie nicht mehr rekonstruierbar.
      dispute_id: dispute.id ?? null,
      currency: dispute.currency ?? null,
    },
    occurredAt: isoFromUnixSeconds(dispute.created),
  };
}

/**
 * Zerlegt ein Ereignis in genau die Felder der Outbox-Zeile. `null` heißt:
 * die Art wird von diesem Modul nicht aufgenommen.
 */
function extractEventFacts(event: Stripe.Event): EventFacts | null {
  switch (event.type) {
    case "checkout.session.completed":
      return checkoutFacts(event.data.object as Stripe.Checkout.Session);
    case "invoice.paid":
      return invoiceFacts(event.data.object as Stripe.Invoice);
    case "charge.refunded":
      return chargeFacts(event.data.object as Stripe.Charge);
    case "charge.dispute.created":
    case "charge.dispute.closed":
      return disputeFacts(event.data.object as Stripe.Dispute);
    default:
      return null;
  }
}

// --- Die Zeile prüfen (CLAUDE.md §2.3) ----------------------------------

/**
 * Ein optionales Geldfeld. `.catch(null)` statt Ablehnung ist hier Absicht:
 * die Werte kommen aus einem signaturgeprüften Stripe-Ereignis, aber ein
 * unerwarteter Typ in EINEM Feld darf nicht dazu führen, dass das ganze
 * Ereignis unaufnehmbar wird und der Webhook in eine Endlosschleife aus
 * 500-Antworten läuft. Ein fehlendes Feld macht der Verarbeiter sichtbar
 * (`base_cents = 0` erzeugt eine Zeile mit `cancel_reason='zero_amount'`,
 * 5.1) — eine verlorene Zeile nicht.
 */
const optionalCents = z.number().int().nullable().optional().catch(null);
const optionalText = z.string().max(255).nullable().optional().catch(null);

/**
 * Dieselbe Nachsicht für eine SPALTE statt für ein Feld in `payload`: das
 * Ergebnis ist `string | null`, nie `undefined` — die Zeile geht als Objekt
 * an PostgREST, und ein fehlender Schlüssel wäre dort etwas anderes als ein
 * ausdrückliches `null`.
 */
const nullableText = z.string().max(255).nullable().catch(null);

const affiliateEventPayloadSchema = z.object({
  amount_total: optionalCents,
  amount_paid: optionalCents,
  amount_tax: optionalCents,
  amount_shipping: optionalCents,
  currency: optionalText,
  billing_reason: optionalText,
  amount_refunded: optionalCents,
  charge_amount: optionalCents,
  dispute_amount: optionalCents,
  dispute_status: optionalText,
  dispute_id: optionalText,
  livemode: z.boolean().nullable().optional().catch(null),
});

/**
 * Die fertige Outbox-Zeile. Die drei Pflichtfelder sind genau die, die die
 * Tabelle `not null` führt und die ein Stripe-Ereignis immer trägt; sie
 * dürfen deshalb hart scheitern.
 */
const affiliateEventRowSchema = z.object({
  stripe_event_id: z.string().min(1).max(255),
  event_type: z.string().min(1).max(255),
  tenant_id: z.string().uuid().nullable().catch(null),
  order_id: z.string().uuid().nullable().catch(null),
  stripe_invoice_id: nullableText,
  stripe_subscription_id: nullableText,
  stripe_charge_id: nullableText,
  stripe_payment_intent: nullableText,
  stripe_event_referral_token: z.string().regex(/^[0-9a-f]{64}$/).nullable().catch(null),
  payload: affiliateEventPayloadSchema,
  occurred_at: z.string().min(1),
});

/** Die Zeile, wie sie in `affiliate_events` geschrieben wird (3.10). */
export type AffiliateEventInsert = {
  stripe_event_id: string;
  event_type: string;
  tenant_id: string | null;
  order_id: string | null;
  stripe_invoice_id: string | null;
  stripe_subscription_id: string | null;
  stripe_charge_id: string | null;
  stripe_payment_intent: string | null;
  referral_token: string | null;
  payload: AffiliateEventPayload;
  occurred_at: string;
};

/**
 * Baut die Outbox-Zeile aus Ereignis und Kontext. Exportiert, weil der
 * Nachhol-Lauf (6.6, `POST /api/admin/affiliate/backfill`) dieselbe Zeile aus
 * einem über `stripe.events.list()` nachgeladenen Ereignis bauen muss — und
 * zwar dieselbe, nicht eine ähnliche.
 *
 * Gibt `null` zurück, wenn die Ereignisart nicht aufgenommen wird.
 */
export function buildAffiliateEventRow(
  event: Stripe.Event,
  context: RecordAffiliateEventContext = {},
): AffiliateEventInsert | null {
  const facts = extractEventFacts(event);
  if (facts === null) return null;

  const parsed = affiliateEventRowSchema.parse({
    stripe_event_id: event.id,
    event_type: event.type,
    // Der Kontext hat Vorrang: `tenantId` kommt dort aus der GEPRÜFTEN
    // Session-Metadata (`checkoutMetadataSchema`), also aus derselben Quelle,
    // aus der auch die `orders`-Zeile entstanden ist.
    tenant_id: context.tenantId ?? null,
    order_id: context.orderId ?? null,
    stripe_invoice_id: context.stripeInvoiceId ?? facts.stripeInvoiceId,
    stripe_subscription_id: context.stripeSubscriptionId ?? facts.stripeSubscriptionId,
    stripe_charge_id: facts.stripeChargeId,
    stripe_payment_intent: facts.stripePaymentIntent,
    stripe_event_referral_token: facts.referralToken,
    payload: { ...facts.payload, livemode: event.livemode },
    // Rückfall auf `event.created`: eine Zeile ohne `occurred_at` ist nicht
    // schreibbar (`not null`), und ein fehlender Zeitstempel auf dem
    // Fachobjekt darf die Aufnahme nicht kosten.
    occurred_at: facts.occurredAt ?? isoFromUnixSeconds(event.created) ?? new Date().toISOString(),
  });

  const { stripe_event_referral_token: referralToken, ...rest } = parsed;
  return { ...rest, referral_token: referralToken };
}

// --- Die Aufnahme -------------------------------------------------------

/**
 * Schreibt ein Stripe-Ereignis in die Outbox (G1/G2).
 *
 * WIRFT bei jedem Datenbankfehler außer `23505`. Der Aufrufer fängt NICHT ab
 * — der Wurf ist der Mechanismus: er erzeugt die 500-Antwort, auf die hin
 * Stripe erneut zustellt (9.4).
 *
 * Der einzige Fall, in dem diese Funktion still zurückkehrt, ohne etwas
 * geschrieben zu haben, ist eine Ereignisart außerhalb der Erlaubnisliste.
 * Das ist kein Fehler, sondern die Aussage „für Affiliate ohne Bedeutung" —
 * und sie ist an genau einer Stelle nachlesbar (`AFFILIATE_EVENT_TYPES`).
 */
export async function recordAffiliateEvent(
  admin: Admin,
  event: Stripe.Event,
  context: RecordAffiliateEventContext = {},
): Promise<AffiliateEventIntakeResult> {
  const row = buildAffiliateEventRow(event, context);
  if (row === null) return "duplicate";

  const { error } = await admin.from("affiliate_events").insert(row);
  if (!error) return "inserted";

  // Der normale Stripe-Retry: dasselbe Ereignis ist schon aufgenommen. Kein
  // Wurf, kein Log — „at least once" ist der vereinbarte Betrieb, nicht ein
  // Zwischenfall.
  if (error.code === POSTGRES_UNIQUE_VIOLATION) return "duplicate";

  // Nur der Code, nie `error.message`: die PostgREST-Meldung trägt bei einer
  // Constraint-Verletzung den Schlüsselwert im Klartext (CLAUDE.md §2.11).
  // Die Ereignisart ist unkritisch und beantwortet im Log die einzige Frage,
  // die man hier hat.
  console.error(
    `[affiliate/intake] affiliate_events-Insert fehlgeschlagen (Art ${row.event_type}, Code ${error.code ?? "unbekannt"}).`,
  );
  throw new Error(
    `affiliate_events-Insert fehlgeschlagen (Code ${error.code ?? "unbekannt"}).`,
  );
}
