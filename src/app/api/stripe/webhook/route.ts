import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getTranslations } from "next-intl/server";
import { createStripeClient } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";
import { checkoutMetadataSchema, marketplaceCheckoutMetadataSchema } from "@/lib/stripe/schema";
import { sendEmail } from "@/lib/email/client";
import { orderPaid } from "@/lib/email/templates";
import { resolveTenantEmailLocale } from "@/i18n/config";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { genericErrorMessage } from "@/lib/errors/generic";
import { handleMarketplacePurchase } from "@/lib/marketplace/fulfil";
import { recordAffiliateEvent } from "@/lib/affiliate/intake";

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
 *
 * AFFILIATE (Block B4, PLAN_Affiliate-System.md 9.4 und 9.5): der Webhook tut
 * fuer das Affiliate-Modul genau EINE Sache -- er schreibt ueber
 * `recordAffiliateEvent()` eine Zeile in die Outbox `affiliate_events`. Die
 * Provisionsrechnung laeuft danach im Cron-Verarbeiter
 * (`src/lib/affiliate/process.ts`), damit ein Fehler in der Affiliate-Logik
 * die Kauferfuellung strukturell nicht brechen kann (G1). Drei Regeln, die zu
 * dieser Datei gehoeren:
 *
 *  1. Die Signaturpruefung bleibt die erste Handlung (CLAUDE.md §2.4). Die
 *     beiden Aufnahmestellen liegen weit hinter ihr; `recordAffiliateEvent()`
 *     wird nie aus einem ungeprueften Pfad gerufen (Plan 11.4).
 *  2. Die Aufnahme steht NACH der Zugriffsgewaehr. Der Kaeufer hat seine
 *     Mitgliedschaft und seine Einschreibung also bereits, bevor hier
 *     irgendetwas schiefgehen kann.
 *  3. `recordAffiliateEvent()` WIRFT bei jedem Datenbankfehler ausser `23505`
 *     (G2). Der Wurf ist der Mechanismus, nicht ein Versehen: er erzeugt die
 *     500-Antwort, auf die hin Stripe erneut zustellt. Ein
 *     `try { … } catch { console.error() }` an dieser Stelle waere genau der
 *     stille Verlust, den die Outbox verhindern soll.
 *
 * Ohne Affiliate-Zuordnung aendert sich am bestehenden Ablauf nichts: die
 * Outbox-Zeile entsteht trotzdem (eine einzige INSERT-Anweisung), traegt
 * `referral_token = null`, und der Verarbeiter legt sie als
 * `skipped/no_attribution` ab -- es entsteht ausdruecklich KEINE
 * Provisionszeile ueber 0 Cent (Plan 4.4 R9).
 *
 * BETRIEBSREIHENFOLGE (Plan Abschnitt 10): dieser Code setzt die angewendete
 * Migration `…_affiliate_commissions.sql` voraus. Fehlt die Tabelle
 * `affiliate_events`, wirft die Aufnahme -- wie bei jedem anderen
 * Datenbankfehler -- und jeder Checkout-Webhook endet in 500 plus Stripe-Retry
 * (der Zugriff des Kaeufers steht dann bereits). Erst anwenden, dann
 * ausliefern.
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
        // Affiliate B4 (Plan 9.4): beide Behandler bekommen zusaetzlich das
        // EREIGNIS. `recordAffiliateEvent()` braucht `event.id` (die einzige
        // Idempotenzquelle der Aufnahme), `event.type` und `event.livemode`
        // (Plan 4.5: Testbuchung) -- nichts davon steht auf dem Fachobjekt.
        // Der Behandler selbst zerlegt das Ereignis nicht; das tut
        // `src/lib/affiliate/intake.ts` fuer alle Einhaengepunkte gleich.
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice, event);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChanged(event.data.object as Stripe.Subscription);
        break;
      // Affiliate B5 (Plan 9.3 und 10/B5): Storno, Rueckbuchung und
      // gewonnener Streitfall. Die drei Zweige stehen NEBEN den bestehenden
      // und aendern an ihnen nichts. Sie tun genau eine Sache -- die Aufnahme
      // in die Outbox; gerechnet und gegengebucht wird im Cron-Verarbeiter
      // (`src/lib/affiliate/reversal.ts`).
      //
      // ACHTUNG BETRIEB: die drei Ereignisarten muessen im Stripe-Dashboard am
      // Endpunkt ABONNIERT sein (Plan 12.6). Fehlt das Abonnement, stellt
      // Stripe sie gar nicht erst zu -- dieser Code laeuft dann nie, ohne dass
      // irgendwo ein Fehler entsteht. Eine Erstattung bliebe still folgenlos,
      // und die Provision dazu stuende weiter im Buch.
      case "charge.refunded":
      case "charge.dispute.created":
      case "charge.dispute.closed":
        await handleAffiliateChargeEvent(event);
        break;
      default:
        // Unbehandelte Events bewusst ignorieren, kein Fehler - Stripe
        // erwartet nur 2xx fuer "angekommen", nicht fuer "relevant".
        //
        // Die drei Storno-Arten sind seit Block B5 oben verdrahtet. Wer hier
        // eine WEITERE Art ergaenzt, traegt sie zusaetzlich in
        // `AFFILIATE_EVENT_TYPES` (`src/lib/affiliate/intake.ts`) ein --
        // andernfalls nimmt die Erlaubnisliste dort sie nicht auf, und die
        // Aufnahme kehrt still zurueck.
        break;
    }
  } catch (e) {
    const rawMessage = e instanceof Error ? e.message : "Unbekannter Fehler bei der Webhook-Verarbeitung.";
    console.error(`[stripe/webhook] Fehler bei Event ${event.type}:`, rawMessage);
    return NextResponse.json({ error: genericErrorMessage(e) }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, event: Stripe.Event) {
  const rawMetadata = session.metadata ?? {};

  // Marketplace M5 (Plan "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt
  // 5): das strengere Schema zuerst versuchen — es ist eine ECHTE Obermenge
  // von checkoutMetadataSchema (`.extend()`, siehe stripe/schema.ts), daher
  // ist die Reihenfolge wichtig. Bei Erfolg zweigt die Verarbeitung komplett
  // in handleMarketplacePurchase() ab, der bestehende Pfad darunter bleibt
  // dabei UNVERÄNDERT (keine Zeile am bestehenden Code angefasst, nur
  // danebengestellt).
  const marketplaceMeta = marketplaceCheckoutMetadataSchema.safeParse(rawMetadata);
  if (marketplaceMeta.success) {
    const admin = createAdminClient();
    // Affiliate B4 (Plan 9.6): das Ereignis reist mit. Marketplace-Kaeufe
    // zweigen hier vollstaendig ab und wuerden von einer Aufnahme, die nur am
    // Direktkauf-Pfad haengt, nie erfasst.
    await handleMarketplacePurchase(admin, session, marketplaceMeta.data, event);
    return;
  }

  // Sicherheitsregel: tenant_id/product_id/user_id kommen AUSSCHLIESSLICH
  // aus der Metadata, die src/lib/stripe/checkout.ts beim Session-Aufbau
  // gesetzt hat - niemals aus einer anderen Quelle.
  const parsedMeta = checkoutMetadataSchema.safeParse(rawMetadata);
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

  // K1 (Analyse 09.09.2026): Mitgliedschaft VOR der Einschreibung. Ohne sie
  // liefert keine Lese-Policy den gekauften Kurs aus, der Kaeufer hat gezahlt
  // und sieht nichts. Reihenfolge ist wichtig: die Einschreibung allein
  // reicht nicht, die Mitgliedschaft allein waere ohne Einschreibung
  // wirkungslos.
  await grantPurchaseMembership(admin, tenantId, userId);

  // Einschreibung: einfachste Loesung (mit Josip/architect abgestimmt,
  // siehe PHASENSTATUS.md) - beim ERSTEN erfolgreichen Checkout einschreiben,
  // unabhaengig vom Modus (Einmalkauf ODER Abo). Kuendigungen entfernen die
  // Einschreibung NICHT wieder (siehe handleSubscriptionChanged).
  await enrollFromProduct(admin, tenantId, userId, productId);

  // Affiliate B4, Aufnahme in die Outbox (Plan 9.4). WIRFT bewusst -> 500 ->
  // Stripe-Retry (G2). Die Stelle ist gewaehlt, nicht beliebig:
  //
  //  - NACH `grantPurchaseMembership()`/`enrollFromProduct()`, damit ein
  //    Affiliate-Fehler den Kauf nie blockiert. Der Kaeufer hat seinen
  //    Zugriff an diesem Punkt bereits.
  //  - Die Idempotenz kommt aus `unique (stripe_event_id)` und AUSDRUECKLICH
  //    NICHT aus `isNewOrder` (:132): wirft ein frueherer Schritt, existiert
  //    die Bestellung beim Retry schon, `isNewOrder` waere `false` und die
  //    Aufnahme fiele dauerhaft aus (G3). Deshalb steht hier keine Bedingung.
  //  - `tenantId` und `order.id` stammen aus derselben geprueften Quelle wie
  //    die soeben geschriebene `orders`-Zeile (`checkoutMetadataSchema`); der
  //    Rest der Zeile (Betraege, Token, Zeitpunkt) wird in `intake.ts` aus
  //    dem Ereignis zerlegt, damit alle vier Einhaengepunkte dieselbe
  //    Zerlegung benutzen.
  //
  // Der bekannte offene Punkt daneben (`sendOrderPaidMail()` ist nicht per
  // `isNewOrder` gegatet, PHASENSTATUS.md, offener Punkt 16) wird hier weder
  // kopiert noch behoben (Plan 9.4). Er hat die angenehme Nebenwirkung, dass
  // ein Wurf an dieser Stelle die Zahlungsmail nicht dauerhaft kostet: der
  // Retry laeuft erneut bis hierher.
  await recordAffiliateEvent(admin, event, { tenantId, orderId: order.id });

  await sendOrderPaidMail(admin, tenantId, userId, productId);
}

/**
 * K1 (Analyse 09.09.2026): Legt fuer einen Kaeufer ohne bestehende
 * Mitgliedschaft eine `guest`-Zeile an. Exaktes Vorbild ist der bereits
 * funktionierende Marketplace-Pfad in src/lib/marketplace/fulfil.ts
 * Zeile 60-85; abweichend nur `source: "purchase"`, damit ein Mandanten-Admin
 * in der Teilnehmerliste sieht, dass jemand direkt gekauft hat.
 *
 * Bestehende Zeilen bleiben unangetastet: weder wird eine hoeherwertige Rolle
 * auf `guest` herabgestuft, noch eine vorhandene `guest`-Zeile erneut
 * angefasst.
 *
 * Wirft bei einem Fehlschlag, statt nur zu loggen. Der Webhook antwortet dann
 * mit 500, Stripe stellt das Event erneut zu ("at least once"). Ein stiller
 * Fehlschlag hier hiesse: Geld eingenommen, kein Zugriff, und niemand holt
 * das automatisch nach. Dieselbe Begruendung wie in fulfil.ts Zeile 76-83.
 */
async function grantPurchaseMembership(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  userId: string,
) {
  const { data: existing, error: readError } = await admin
    .from("memberships")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) {
    throw new Error(`memberships-Abfrage fehlgeschlagen: ${readError.message}`);
  }
  if (existing) return;

  const { error: insertError } = await admin.from("memberships").insert({
    tenant_id: tenantId,
    user_id: userId,
    role: "guest",
    source: "purchase",
    status: "active",
  });
  if (insertError) {
    throw new Error(`memberships-Insert fehlgeschlagen: ${insertError.message}`);
  }
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
      admin.from("tenants").select("name, branding, settings").eq("id", tenantId).maybeSingle(),
      admin.from("products").select("title").eq("id", productId).maybeSingle(),
      admin.from("profiles").select("email, full_name").eq("id", userId).maybeSingle(),
    ]);
    if (!profile?.email || !product) return;

    const tenantName = tenant?.name ?? "Calltalent-Akademie";
    const accentColor = (tenant?.branding as { color_primary?: string } | null)?.color_primary;
    // Locale-Quelle laut Plan (Abschnitt 6, C5a): Mandanten-Standardsprache,
    // nicht die individuelle profiles.locale des Empfängers.
    const locale = resolveTenantEmailLocale(
      (tenant?.settings as { default_locale?: string } | null)?.default_locale,
    );

    const html = await orderPaid({
      tenantName,
      recipientName: profile.full_name ?? undefined,
      productName: product.title,
      accentColor,
      locale,
    });
    const tSubject = await getTranslations({ locale, namespace: "email" });
    const result = await sendEmail({
      to: profile.email,
      subject: tSubject("orderPaid.subject"),
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

async function handleInvoicePaid(invoice: Stripe.Invoice, event: Stripe.Event) {
  const subscriptionId = extractSubscriptionId(invoice);
  // Rechnung ohne Abo-Bezug (z. B. Einmalkauf) - nichts zu tun. Auch fuer
  // Affiliate nicht: wiederkehrende Provisionen entstehen ausschliesslich an
  // einer Rechnung MIT Abo-Bezug (Plan 5.7/9.5), und der Verarbeiter legte
  // eine solche Zeile ohnehin als `skipped/no_subscription` ab. Der Einmalkauf
  // ist bereits ueber `checkout.session.completed` aufgenommen.
  if (!subscriptionId) return;

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

  // Affiliate B4, Abo-Folgeraten (Plan 9.5) -- der EINZIGE Ort, an dem
  // wiederkehrende Provisionen entstehen koennen. Steht am Ende, also nach
  // dem bestehenden `subscriptions`-Update: der Wurf aus `recordAffiliateEvent()`
  // (G2) fuehrt zu 500 und Stripe-Retry, und der Update oben ist idempotent,
  // laeuft also gefahrlos erneut.
  //
  // `stripe_subscription_id` kommt aus `extractSubscriptionId()` und nicht aus
  // der Zerlegung in `intake.ts`, damit die Abo-Kennung hier und in der
  // `subscriptions`-Tabelle garantiert dieselbe ist (verschiedene
  // Stripe-API-Versionen legen das Feld unterschiedlich ab, siehe dort).
  // `orders.stripe_checkout_id` wird dafuer NICHT zweckentfremdet; den
  // Mandanten loest der Verarbeiter ueber die Abo-Bindung auf (Plan 3.9).
  await recordAffiliateEvent(admin, event, {
    stripeInvoiceId: invoice.id ?? null,
    stripeSubscriptionId: subscriptionId,
  });
}

/**
 * Affiliate B5 -- Aufnahme von `charge.refunded`, `charge.dispute.created` und
 * `charge.dispute.closed` in die Outbox (Plan 9.3, 5.8).
 *
 * Alle drei Arten teilen sich diesen Behandler, weil der Webhook fuer alle
 * drei exakt dasselbe tut: EINE Zeile in `affiliate_events` schreiben. Die
 * Unterscheidung -- Vollstorno, Teilstorno, Betrugsflag, Wiedergutschrift --
 * trifft der Verarbeiter aus der Nutzlast, die `src/lib/affiliate/intake.ts`
 * beim Aufnehmen zerlegt (`amount_refunded`, `charge_amount`,
 * `dispute_amount`, `dispute_status`).
 *
 * DREI EIGENSCHAFTEN, die zu dieser Stelle gehoeren:
 *
 *  1. KEIN `tenantId` im Kontext. Ein `Stripe.Charge` und ein
 *     `Stripe.Dispute` tragen keine Session-Metadata; der Mandant ist zum
 *     Aufnahmezeitpunkt schlicht nicht bekannt. Die Spalte ist dafuer nullbar,
 *     und der Verarbeiter loest ihn ueber
 *     `charge.payment_intent -> orders.stripe_payment_intent` bzw.
 *     `charge.invoice -> affiliate_commissions.stripe_invoice_id` auf (3.10,
 *     6.5 b). Hier zu raten waere schlechter als zu warten.
 *  2. NICHTS AUSSER DER AUFNAHME. Es wird insbesondere nicht schon hier
 *     `orders.refunded_cents` gesetzt: eine Erstattung ist erst dann
 *     vollstaendig verarbeitet, wenn Gegenbuchung UND Bestellzustand stehen,
 *     und das gehoert in EINEN wiederholbaren Vorgang (G1).
 *  3. `recordAffiliateEvent()` WIRFT bei jedem Datenbankfehler ausser `23505`
 *     (G2) -> 500 -> Stripe-Retry. Kein `try/catch` hier: ein verlorenes
 *     Storno-Ereignis waere eine Provision, die niemand mehr zurueckholt.
 */
async function handleAffiliateChargeEvent(event: Stripe.Event) {
  const admin = createAdminClient();
  await recordAffiliateEvent(admin, event);
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
