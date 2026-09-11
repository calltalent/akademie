import "server-only";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Affiliate-System, Block B5 — DER BESTELLZUSTAND NACH EINER ERSTATTUNG
 * (PLAN_Affiliate-System.md 5.8, letzter Absatz).
 *
 * `orders.status` kennt seit Migration 20260910120000 den Wert
 * `partially_refunded`, und `orders.refunded_cents` hält den KUMULATIVEN
 * Erstattungsbetrag — weil Stripe genau so zählt (`charge.amount_refunded`,
 * G7). Geschrieben hat beides bisher NIEMAND: `orders.status` stand nach einer
 * Erstattung weiter auf „bezahlt", während das Geld zurück war, und
 * `src/components/admin/orders-table.tsx` rendert den Zustand seitdem
 * wahrheitswidrig. Diese Datei schließt die Lücke.
 *
 * Die Aufgabe ist klein, die Fallen sind es nicht:
 *
 *  1. KUMULATIV, ALSO MONOTON. Stripe stellt Ereignisse mehrfach und in
 *     falscher Reihenfolge zu (6.6). Käme die Zustellung des Standes 10000
 *     NACH der des Standes 20000, setzte ein bedingungsloses Update den Wert
 *     zurück — und die nächste Provisions-Gegenbuchung rechnete gegen einen zu
 *     kleinen Stand. Der Update trägt deshalb `lt('refunded_cents', wert)`:
 *     er greift ausschließlich nach vorn.
 *  2. ERLAUBNISLISTE STATT SPERRLISTE. Nur eine bezahlte oder bereits
 *     teilerstattete Bestellung wird angefasst. Eine Bestellung auf `pending`
 *     oder `failed` nach einer Erstattung auf `refunded` zu heben, hieße einen
 *     Kauf zu behaupten, den es nie gab.
 *  3. MANDANTENBINDUNG. Die `order_id` stammt aus der Auflösung
 *     `charge.payment_intent → orders.stripe_payment_intent` und ist damit
 *     eine client-gelieferte Kennung im Sinne von Plan 11.15: jede Abfrage
 *     filtert zusätzlich auf `tenant_id`, nie `where id = :clientId` allein.
 *  4. KEINE NUTZLAST IM LOG. Protokolliert wird der Fehlercode, nie
 *     `error.message` — die PostgREST-Meldung trägt bei einer
 *     Constraint-Verletzung den Schlüsselwert im Klartext (CLAUDE.md §2.11).
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Nie `select("*")`; die Tabelle hat Spalten, die hier nichts zu suchen haben. */
const ORDER_COLUMNS = "id, tenant_id, amount_cents, status, refunded_cents";

/**
 * Bestellzustände, aus denen eine Erstattung hervorgehen kann. `refunded`
 * steht mit in der Liste, damit eine Wiederholung derselben Zustellung nicht
 * an der Erlaubnisliste scheitert, sondern an der Monotonie-Bedingung — dort
 * ist sie ein gewolltes „nichts zu tun" und kein Fehler.
 */
const REFUNDABLE_ORDER_STATUSES = ["paid", "partially_refunded", "refunded"] as const;

export const affiliateOrderRefundInputSchema = z.object({
  tenant_id: z.string().uuid(),
  order_id: z.string().uuid(),
  /** `charge.amount_refunded` — KUMULATIV (G7). */
  refunded_total_cents: z.number().int().min(0),
  /**
   * `charge.amount`. Nur der Rückfall für den Fall, dass die Bestellung selbst
   * keinen Betrag trägt (`orders.amount_cents` ist nullbar) — sonst entschiede
   * ein fehlender Wert über „voll oder teilweise erstattet".
   */
  charge_total_cents: z.number().int().min(0).nullable().default(null),
});

export type AffiliateOrderRefundInput = z.input<typeof affiliateOrderRefundInputSchema>;

/**
 * `updated`   — Betrag und Status stehen jetzt auf dem neuen Stand;
 * `unchanged` — der Stand war schon erreicht oder überholt (Wiederholung,
 *               verspätete Zustellung) — kein Fehler;
 * `missing`   — zu dieser Kennung gibt es in diesem Mandanten keine Bestellung.
 */
export type AffiliateOrderRefundState = "updated" | "unchanged" | "missing";

type OrderRow = {
  id: string;
  tenant_id: string;
  amount_cents: number | null;
  status: string;
  refunded_cents: number | null;
};

function logDbError(context: string, error: { code?: string } | null): void {
  console.error(
    `[affiliate/orders] ${context} fehlgeschlagen (Code ${error?.code ?? "unbekannt"}).`,
  );
}

/**
 * Schreibt `orders.refunded_cents` und `orders.status` fort (5.8).
 *
 * WIRFT `db_error` bei einem Datenbankfehler — dieselbe stabile Kennung, die
 * der Verarbeiter nach `affiliate_events.last_error` schreibt. Ein stilles
 * Scheitern wäre der schlechteste Ausgang: die Provisions-Gegenbuchung stünde,
 * die Bestellung sähe unverändert aus, und niemand käme je darauf.
 */
export async function applyOrderRefundState(
  admin: Admin,
  input: AffiliateOrderRefundInput,
): Promise<AffiliateOrderRefundState> {
  const parsed = affiliateOrderRefundInputSchema.parse(input);

  const { data, error } = await admin
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", parsed.order_id)
    .eq("tenant_id", parsed.tenant_id)
    .maybeSingle();
  if (error) {
    logDbError("Bestellung lesen", error);
    throw new Error("db_error");
  }

  const order = (data ?? null) as OrderRow | null;
  if (order === null) return "missing";

  const alreadyRefunded = Math.max(0, order.refunded_cents ?? 0);
  if (parsed.refunded_total_cents <= alreadyRefunded) return "unchanged";

  // Die Bezugsgröße für „voll erstattet": der Bestellbetrag, ersatzweise der
  // Charge. Ist beides unbekannt oder 0, bleibt es bei `partially_refunded` —
  // lieber ein zu vorsichtiger Zustand als eine Bestellung, die als vollständig
  // erstattet gilt, ohne dass irgendwer den Gesamtbetrag kennt.
  const total = order.amount_cents ?? parsed.charge_total_cents ?? 0;
  const status =
    total > 0 && parsed.refunded_total_cents >= total ? "refunded" : "partially_refunded";

  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update({ refunded_cents: parsed.refunded_total_cents, status })
    .eq("id", parsed.order_id)
    .eq("tenant_id", parsed.tenant_id)
    // Monotonie (siehe Kopf, Punkt 1): nur nach vorn. Zugleich der
    // Compare-and-Swap gegen einen zweiten Lauf, der dasselbe Ereignis
    // verarbeitet.
    .lt("refunded_cents", parsed.refunded_total_cents)
    .in("status", REFUNDABLE_ORDER_STATUSES)
    .select("id");
  if (updateError) {
    logDbError("Bestellzustand schreiben", updateError);
    throw new Error("db_error");
  }

  return Array.isArray(updated) && updated.length > 0 ? "updated" : "unchanged";
}
