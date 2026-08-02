import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createStripeClient } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";
import { checkoutMetadataSchema } from "@/lib/stripe/schema";
import { sendEmail } from "@/lib/email/client";
import { orderPaid } from "@/lib/email/templates";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Stripe-Webhook (Phase 2, Block 5). REIHENFOLGE STRENG WIE VORGEGEBEN:
 * (1) Rohtext lesen, (2) stripe-signature-Header lesen, (3) fehlendes
 * STRIPE_WEBHOOK_SECRET -> 500, nichts verarbeiten, (4) Signatur pruefen,
 * bei Fehler -> 400, nichts verarbeiten, (5) ERST DANACH verarbeiten
 * (CLAUDE.md §2.4: "Stripe- und Bunny-Webhooks: Signatur pruefen, bevor
 * irgendetwas verarbeitet wird").
 *
 * Kein Rate Limiting hier (Auftrag: waere unueblich und wuerde legitime
 * Stripe-Retries blockieren - Stripe selbst kontrolliert die Frequenz).
 *
 * Idempotenz: Upsert auf die vorhandenen Unique-Constraints
 * (`orders.stripe_checkout_id`, `subscriptions.stripe_subscription_id`,
 * `enrollments(course_id, user_id)`) statt Fehler bei doppelter Zustellung
 * derselben Stripe-Zahlung.
 */
export async function POST(request: Request) {
  const webhookSecret = getServerEnv().STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error(
      "[stripe/webhook] STRIPE_WEBHOOK_SECRET nicht gesetzt - Webhook kann nicht verarbeitet werden.",
    );
    return NextResponse.json(
      {
        error:
          "Stripe-Webhook ist serverseitig noch nicht konfiguriert (STRIPE_WEBHOOK_SECRET fehlt). Endpoint im Stripe-Dashboard bzw. per `stripe listen --print-secret` einrichten und den Wert in .env eintragen.",
      },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Fehlender stripe-signature-Header." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = createStripeClient();
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Signaturprüfung fehlgeschlagen.";
    console.error("[stripe/webhook] Ungültige Signatur - Event wird NICHT verarbeitet:", message);
    return NextResponse.json({ error: "Ungültige Signatur." }, { status: 400 });
  }

  // Ab hier ist die Signatur geprueft - erst jetzt wird irgendetwas verarbeitet.
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChanged(event.data.object as Stripe.Subscription);
        break;
      default:
        // Unbehandelte Events bewusst ignorieren, kein Fehler - Stripe
        // erwartet nur 2xx fuer "angekommen", nicht fuer "relevant".
        break;
    }
  } catch (e) {
    const rawMessage = e instanceof Error ? e.message : "Unbekannter Fehler bei der Webhook-Verarbeitung.";
    console.error(`[stripe/webhook] Fehler bei Event ${event.type}:`, rawMessage);
    return NextResponse.json({ error: genericErrorMessage(e) }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  // Sicherheitsregel: tenant_id/product_id/user_id kommen AUSSCHLIESSLICH
  // aus der Metadata, die src/lib/stripe/checkout.ts beim Session-Aufbau
  // gesetzt hat - niemals aus einer anderen Quelle.
  const parsedMeta = checkoutMetadataSchema.safeParse(session.metadata ?? {});
  if (!parsedMeta.success) {
    console.error(
      "[stripe/webhook] checkout.session.completed ohne gültige Metadata - ignoriert.",
      session.id,
    );
    return;
  }
  const { tenant_id: tenantId, product_id: productId, user_id: userId } = parsedMeta.data;

  const admin = createAdminClient();

  // Idempotenz-Fix (security-reviewer-Audit 01.08.2026, MITTEL): Stripe
  // garantiert nur "at least once" - dasselbe checkout.session.completed-
  // Event kann erneut zugestellt werden. Der orders-Upsert selbst ist dank
  // onConflict idempotent, die AUSGEHENDEN Mandanten-Webhooks unten waren es
  // bisher nicht (sie feuerten bei jeder Verarbeitung erneut). Vorab pruefen,
  // ob die Zeile schon existiert - nur bei einer echten Neuanlage dispatchen.
  const { data: existingOrder } = await admin
    .from("orders")
    .select("id")
    .eq("stripe_checkout_id", session.id)
    .maybeSingle();
  const isNewOrder = !existingOrder;

  const { data: order, error: orderError } = await admin
    .from("orders")
    .upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        product_id: productId,
        stripe_checkout_id: session.id,
        stripe_payment_intent:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        amount_cents: session.amount_total ?? null,
        currency: session.currency ?? "eur",
        status: "paid",
      },
      { onConflict: "stripe_checkout_id" },
    )
    .select("id")
    .single();

  if (orderError || !order) {
    console.error("[stripe/webhook] orders-Upsert fehlgeschlagen:", orderError?.message);
    return;
  }

  // Block 7 (Webhooks): order.paid direkt nach dem orders-Upsert, VOR
  // enrollFromProduct() (fire-and-forget, siehe dispatch.ts). Nur bei
  // Neuanlage - ein Stripe-Retry desselben Checkouts loest sonst ein
  // doppeltes order.paid beim Mandanten-Webhook-Consumer aus.
  if (isNewOrder) {
    dispatchWebhookEvent(tenantId, "order.paid", {
      order_id: order.id,
      user_id: userId,
      product_id: productId,
      amount_cents: session.amount_total ?? null,
      currency: session.currency ?? "eur",
    }).catch(() => {});
  }

  // Bei Abo zusaetzlich subscriptions-Zeile anlegen/aktualisieren.
  if (session.mode === "subscription" && typeof session.subscription === "string") {
    const { error: subError } = await admin.from("subscriptions").upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        product_id: productId,
        stripe_subscription_id: session.subscription,
        status: "active",
      },
      { onConflict: "stripe_subscription_id" },
    );
    if (subError) {
      console.error("[stripe/webhook] subscriptions-Upsert fehlgeschlagen:", subError.message);
    }
  }

  // Einschreibung: einfachste Loesung (mit Josip/architect abgestimmt,
  // siehe PHASENSTATUS.md) - beim ERSTEN erfolgreichen Checkout einschreiben,
  // unabhaengig vom Modus (Einmalkauf ODER Abo). Kuendigungen entfernen die
  // Einschreibung NICHT wieder (siehe handleSubscriptionChanged).
  await enrollFromProduct(admin, tenantId, userId, productId);

  await sendOrderPaidMail(admin, tenantId, userId, productId);
}

async function enrollFromProduct(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  userId: string,
  productId: string,
) {
  const { data: product, error } = await admin
    .from("products")
    .select("course_ids")
    .eq("id", productId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !product) {
    console.error("[stripe/webhook] Produkt für Einschreibung nicht gefunden:", productId);
    return;
  }

  const courseIds: string[] = product.course_ids ?? [];
  if (courseIds.length === 0) return; // Produkt ohne Kurs-Zuordnung - nichts einzuschreiben.

  for (const courseId of courseIds) {
    // Gleicher Idempotenz-Fix wie bei orders oben: vor dem Upsert pruefen,
    // ob die Einschreibung schon existiert (Stripe-Retry desselben Events).
    const { data: existingEnrollment } = await admin
      .from("enrollments")
      .select("id")
      .eq("course_id", courseId)
      .eq("user_id", userId)
      .maybeSingle();
    const isNewEnrollment = !existingEnrollment;

    const { error: enrollError } = await admin.from("enrollments").upsert(
      {
        tenant_id: tenantId,
        course_id: courseId,
        user_id: userId,
        source: "purchase",
      },
      { onConflict: "course_id,user_id" },
    );
    if (enrollError) {
      console.error("[stripe/webhook] Einschreibung fehlgeschlagen:", courseId, enrollError.message);
      continue;
    }
    // Block 7 (Webhooks): enrollment.created fire-and-forget, nur bei
    // tatsaechlicher Neuanlage (siehe dispatch.ts + Idempotenz-Kommentar oben).
    if (isNewEnrollment) {
      dispatchWebhookEvent(tenantId, "enrollment.created", {
        course_id: courseId,
        user_id: userId,
        source: "purchase",
      }).catch(() => {});
    }
  }
}

async function sendOrderPaidMail(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  userId: string,
  productId: string,
) {
  // FAIL-SOFT (Vertrag aus src/lib/email/client.ts + Auftrag Punkt 7): ein
  // Mailfehler darf die Webhook-Antwort NIEMALS auf einen Fehlerstatus
  // setzen - Stripe wuerde sonst unnoetig retryen.
  try {
    const [{ data: tenant }, { data: product }, { data: profile }] = await Promise.all([
      admin.from("tenants").select("name, branding").eq("id", tenantId).maybeSingle(),
      admin.from("products").select("title").eq("id", productId).maybeSingle(),
      admin.from("profiles").select("email, full_name").eq("id", userId).maybeSingle(),
    ]);
    if (!profile?.email || !product) return;

    const tenantName = tenant?.name ?? "Calltalent-Akademie";
    const accentColor = (tenant?.branding as { color_primary?: string } | null)?.color_primary;

    const html = orderPaid({
      tenantName,
      recipientName: profile.full_name ?? undefined,
      productName: product.title,
      accentColor,
    });
    const result = await sendEmail({
      to: profile.email,
      subject: "Zahlung erhalten",
      html,
      tenant: { name: tenantName },
    });
    if (!result.success) {
      console.error("[stripe/webhook] orderPaid-Mail fehlgeschlagen (fail-soft):", result.error);
    }
  } catch (e) {
    console.error("[stripe/webhook] Ausnahme beim Zahlungsmail-Versand (fail-soft):", e);
  }
}

/**
 * Verschiedene Stripe-API-Versionen legen `current_period_end` unterschiedlich
 * ab (mal direkt auf der Subscription, mal nur auf `items.data[].current_period_end`).
 * Defensiv beide Pfade pruefen, damit ein SDK-/API-Versionswechsel (Version
 * war zum Bauzeitpunkt in der Sandbox nicht pruefbar, kein `npm install`
 * moeglich - siehe PHASENSTATUS.md) nicht zu einem harten Fehler fuehrt.
 */
function extractCurrentPeriodEnd(subscription: Stripe.Subscription): string | null {
  const direct = (subscription as unknown as { current_period_end?: number }).current_period_end;
  if (typeof direct === "number") return new Date(direct * 1000).toISOString();

  const itemEnd = subscription.items?.data?.[0]?.current_period_end;
  if (typeof itemEnd === "number") return new Date(itemEnd * 1000).toISOString();

  return null;
}

/** Gleiche Defensiv-Logik wie oben, fuer `invoice.subscription` (verschiedene API-Versionen legen das Feld unterschiedlich ab). */
function extractSubscriptionId(invoice: Stripe.Invoice): string | null {
  const direct = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object" && "id" in direct) return direct.id;

  const parentSub = (
    invoice as unknown as {
      parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
    }
  ).parent?.subscription_details?.subscription;
  if (typeof parentSub === "string") return parentSub;
  if (parentSub && typeof parentSub === "object" && "id" in parentSub) return parentSub.id;

  return null;
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) return; // Rechnung ohne Abo-Bezug (z. B. Einmalkauf) - nichts zu tun.

  const admin = createAdminClient();
  let currentPeriodEnd: string | null = null;
  try {
    const stripe = createStripeClient();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    currentPeriodEnd = extractCurrentPeriodEnd(sub);
  } catch (e) {
    console.error("[stripe/webhook] Abo-Details konnten nicht nachgeladen werden:", e);
  }

  const { error } = await admin
    .from("subscriptions")
    .update({
      status: "active",
      ...(currentPeriodEnd ? { current_period_end: currentPeriodEnd } : {}),
    })
    .eq("stripe_subscription_id", subscriptionId);
  if (error) {
    console.error(
      "[stripe/webhook] subscriptions-Update (invoice.paid) fehlgeschlagen:",
      error.message,
    );
  }
}

async function handleSubscriptionChanged(subscription: Stripe.Subscription) {
  const admin = createAdminClient();
  const status: "active" | "past_due" | "canceled" =
    subscription.status === "canceled"
      ? "canceled"
      : subscription.status === "past_due" || subscription.status === "unpaid"
        ? "past_due"
        : "active";

  const currentPeriodEnd = extractCurrentPeriodEnd(subscription);

  const { error } = await admin
    .from("subscriptions")
    .update({
      status,
      ...(currentPeriodEnd ? { current_period_end: currentPeriodEnd } : {}),
    })
    .eq("stripe_subscription_id", subscription.id);
  if (error) {
    console.error(
      "[stripe/webhook] subscriptions-Update (subscription.updated/deleted) fehlgeschlagen:",
      error.message,
    );
  }

  // Vereinfachung (mit Josip/architect abgestimmt, siehe PHASENSTATUS.md):
  // eine Kuendigung entfernt KEINE enrollments-Zeile - historischer Zugriff
  // bleibt bestehen. Bewusst kein Code hier fuer den Enrollment-Entzug.
}
