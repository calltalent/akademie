import "server-only";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * S3 (Sicherheitsaudit 27.09.2026, vorher H5): `checkout.session.completed`
 * feuert bei asynchronen Zahlarten (SEPA-Lastschrift, Überweisung, Klarna)
 * mit `payment_status = "unpaid"`. Das Geld kommt Tage später oder nie.
 * Freigeschaltet wird deshalb nur, wenn Stripe die Zahlung als erledigt
 * meldet. `no_payment_required` deckt Abos mit Testphase und 100-%-Gutscheine
 * ab. Der spätere Eingang kommt als `checkout.session.async_payment_succeeded`
 * mit `payment_status = "paid"` und läuft dann durch denselben Pfad.
 */
export function isCheckoutSettled(session: Pick<Stripe.Checkout.Session, "payment_status">): boolean {
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}

/**
 * S3 (vorher H11): Eine vollständige Erstattung oder ein verlorener Chargeback
 * nimmt den gekauften Zugang zurück.
 *
 * - `orders.status` wird `refunded`.
 * - Einschreibungen aus diesem Kauf (`source` `purchase` oder `marketplace`)
 *   laufen sofort ab (`expires_at = now()`). Einschreibungen aus Import, API
 *   oder manueller Zuweisung bleiben unberührt.
 *
 * Nicht Teil dieses Schritts: Storno im Marketplace-Provisions-Ledger (M28).
 * Die Funktion protokolliert den Fall, damit er manuell nachgebucht werden
 * kann.
 *
 * Idempotent: ein zweiter Aufruf setzt dieselben Werte erneut.
 */
export async function revokePurchase(
  admin: AdminClient,
  params: { tenantId: string; userId: string; courseIds: string[]; checkoutSessionId: string; marketplace: boolean },
): Promise<void> {
  const { tenantId, userId, courseIds, checkoutSessionId, marketplace } = params;

  const { error: orderError } = await admin
    .from("orders")
    .update({ status: "refunded" })
    .eq("stripe_checkout_id", checkoutSessionId)
    .eq("tenant_id", tenantId);
  if (orderError) {
    throw new Error(`orders-Update (refunded) fehlgeschlagen: ${orderError.message}`);
  }

  if (courseIds.length > 0) {
    const { error: enrollError } = await admin
      .from("enrollments")
      .update({ expires_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .in("course_id", courseIds)
      .in("source", ["purchase", "marketplace"]);
    if (enrollError) {
      throw new Error(`enrollments-Update (Entzug) fehlgeschlagen: ${enrollError.message}`);
    }
  }

  if (marketplace) {
    console.error(
      "[stripe/refund] Marketplace-Kauf erstattet, Ledger-Storno muss manuell gebucht werden. Checkout:",
      checkoutSessionId,
    );
  }
}
