"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { createStripeClient } from "@/lib/stripe/client";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

export type PortalActionState = { error: string | null };

function buildTenantUrl(slug: string, path: string): string {
  const base =
    process.env.NODE_ENV === "production"
      ? `https://${slug}.akademie.calltalent.ai`
      : `http://${slug}.localhost:3000`;
  return `${base}${path}`;
}

/**
 * Self-Service-Billing-Portal fuer Abo-Kunden.
 *
 * Abweichung vom Plan-Wortlaut (dokumentiert): `subscriptions` hat KEINE
 * `stripe_customer_id`-Spalte (Vorabpruefung von 0001_init.sql bestaetigt -
 * die Tabelle hat nur `stripe_subscription_id`, siehe supabase/migrations/
 * 0001_init.sql Zeile 263-271). Statt dafuer eine neue Migration/Spalte
 * anzulegen (waere laut CLAUDE.md §3.1 "Ausnahme, nicht Regel" und hier
 * vermeidbar), wird die Stripe-Customer-ID direkt bei Bedarf ueber
 * `stripe.subscriptions.retrieve()` aus der bereits gespeicherten
 * `stripe_subscription_id` nachgeladen (`.customer`-Feld jeder Stripe-
 * Subscription). Kein Schema-Eingriff noetig.
 *
 * RLS `subscriptions_own_select` (user_id = auth.uid()) reicht fuer den
 * Lesezugriff - kein Admin-Client noetig, geringstmoegliches Privileg.
 */
export async function createPortalSession(): Promise<PortalActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Bitte zuerst anmelden." };
  }

  const tenant = await getTenant();
  if (!tenant) {
    return { error: "Kein Mandant zu diesem Host gefunden." };
  }

  if (
    !(await checkRateLimit("stripe-portal-create", {
      maxRequests: 10,
      windowSeconds: 300,
      extraKey: user.id,
    }))
  ) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const { data: sub, error } = await supabase
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .not("stripe_subscription_id", "is", null)
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !sub?.stripe_subscription_id) {
    return { error: "Kein aktives Abo gefunden." };
  }

  let redirectUrl: string;
  try {
    const stripe = createStripeClient();
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const customerId = typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer.id;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: buildTenantUrl(tenant.slug, "/profil"),
    });
    redirectUrl = portalSession.url;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Portal-Sitzung konnte nicht erzeugt werden.";
    return { error: "Stripe-Fehler: " + message };
  }

  redirect(redirectUrl);
}
