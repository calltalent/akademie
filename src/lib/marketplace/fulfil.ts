import "server-only";
import type Stripe from "stripe";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildTenantUrl } from "@/lib/tenant/url";
import { sendEmail } from "@/lib/email/client";
import { orderPaid } from "@/lib/email/templates";
import { resolveTenantEmailLocale } from "@/i18n/config";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { recordAffiliateEvent } from "@/lib/affiliate/intake";
import type { MarketplaceCheckoutMetadata } from "@/lib/stripe/schema";

/**
 * Marketplace M5 (Plan "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt
 * 5, Punkt "Bezahlter Kauf" + Rollenmodell Abschnitt 2) — Erfüllung eines
 * Marketplace-Kaufs (bezahlt) und der geteilte Zugriffsgewähr-Baustein, den
 * auch der Gratis-Pfad (`marketplace/acquire.ts`) nutzt.
 *
 * SICHERHEITSKERN (Plan Abschnitt 2, wörtlich): ein Marketplace-Käufer bekommt
 * beim Verkäufer-Mandanten `memberships.role='guest'` + `enrollments`, NIE
 * eine gewöhnliche `member`-Mitgliedschaft — sonst könnte er für den Preis
 * eines Kurses den kompletten veröffentlichten Kursbestand des Mandanten
 * lesen (M1-Sicherheitsfund, siehe `20260803100000_marketplace_guest_role.sql`).
 * Beim Anlegen der `memberships`-Zeile: NIEMALS eine bestehende
 * `member`/`admin`/`trainer`/`owner`-Zeile auf `guest` herabstufen — nur bei
 * kompletter Nicht-Existenz eine neue `guest`-Zeile anlegen.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Ganzzahl-Provisionsrechnung (Plan Abschnitt 1.3): `commission_cents =
 * floor(gross_cents * rate_bp / 10000)`. Als reine, exportierte Funktion
 * ausgelagert, damit sie ohne Supabase-Mock unit-testbar ist (im Projekt
 * existiert bislang kein Vitest-Muster für `@/lib/supabase/admin`, siehe
 * Kopfkommentar `marketplace/schema.test.ts`).
 */
export function computeCommission(
  grossCents: number,
  rateBp: number,
): { commissionCents: number; netCents: number } {
  const commissionCents = Math.floor((grossCents * rateBp) / 10000);
  return { commissionCents, netCents: grossCents - commissionCents };
}

/**
 * Geteilter Zugriffsgewähr-Baustein für BEIDE Erwerbspfade (Gratis via
 * `acquire.ts`, bezahlt via diese Datei). Gleiches Idempotenz-Muster wie
 * `enrollFromProduct()` im bestehenden Webhook (`api/stripe/webhook/
 * route.ts`): vor dem Schreiben lesen, `enrollmentCreated` nur bei echter
 * Neuanlage `true`, damit der Aufrufer den `enrollment.created`-Webhook nur
 * einmal auslöst (Stripe liefert Events "at least once", ein Retry darf kein
 * zweites Event erzeugen).
 */
export async function grantMarketplaceAccess(
  admin: AdminClient,
  tenantId: string,
  userId: string,
  courseId: string,
): Promise<{ enrollmentCreated: boolean }> {
  const { data: existingMembership } = await admin
    .from("memberships")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existingMembership) {
    const { error: membershipError } = await admin.from("memberships").insert({
      tenant_id: tenantId,
      user_id: userId,
      role: "guest",
      source: "marketplace",
      status: "active",
    });
    // Security-reviewer-Fund (03.08.2026, MITTEL): ein stiller Fehlschlag
    // hier ließe is_marketplace_guest() dauerhaft `false` bleiben — sämtliche
    // *_guest_select-Policies blockieren dann den Kurs, selbst wenn die
    // enrollments-Zeile unten erfolgreich angelegt wird. Werfen statt nur
    // loggen: der Webhook antwortet dadurch mit 500, Stripe liefert das
    // Event erneut zu (Stripe-Doku: "at least once"-Zustellung mit Retry bei
        // Nicht-2xx-Antwort) — kein bezahlender Kunde bleibt sonst dauerhaft
    // ohne Zugriff, ohne dass irgendetwas das automatisch nachholt.
    if (membershipError) {
      throw new Error(`memberships-Insert fehlgeschlagen: ${membershipError.message}`);
    }
  }
  // Existiert bereits eine Zeile (egal welche Rolle) — bewusst NICHTS ändern.
  // Weder eine bestehende höherwertige Rolle auf 'guest' herabstufen, noch
  // eine bestehende 'guest'-Zeile erneut anfassen (Plan Abschnitt 2).

  const { data: existingEnrollment } = await admin
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .maybeSingle();
  const enrollmentCreated = !existingEnrollment;

  const { error: enrollError } = await admin.from("enrollments").upsert(
    {
      tenant_id: tenantId,
      course_id: courseId,
      user_id: userId,
      source: "marketplace",
    },
    { onConflict: "course_id,user_id" },
  );
  if (enrollError) {
    // Gleiche Begründung wie beim memberships-Insert oben.
    throw new Error(`enrollments-Upsert fehlgeschlagen: ${enrollError.message}`);
  }

  return { enrollmentCreated };
}

/**
 * Aufgerufen aus `api/stripe/webhook/route.ts::handleCheckoutCompleted()`,
 * NACHDEM `marketplaceCheckoutMetadataSchema` erfolgreich geparst wurde.
 * Reihenfolge (Plan Abschnitt 5, Punkt "Bezahlter Kauf" > "`api/stripe/
 * webhook/route.ts` (geändert)"): orders-Upsert -> grantMarketplaceAccess()
 * -> Ledger-Eintrag -> enrollment.created-Dispatch (nur bei Neuanlage) ->
 * Bestätigungsmail (fail-soft) -> Affiliate-Aufnahme (NEU, B4).
 *
 * AFFILIATE (Block B4, PLAN_Affiliate-System.md 9.6): der vierte Parameter
 * `event` ist neu und nicht optional. Er trägt `event.id` — die einzige
 * Idempotenzquelle der Aufnahme (`unique (stripe_event_id)`, Plan 3.10) —
 * sowie `event.type` und `event.livemode`; nichts davon steht auf der
 * `Checkout.Session`. Bewusst NICHT optional: ein weggelassenes Argument
 * hieße „Marketplace-Käufe still ohne Provision", also genau der lautlose
 * Verlust, den die Outbox verhindern soll (G1). Der Plan nennt für B4 nur
 * `handleCheckoutCompleted()` als Signaturänderung; diese hier ist die zweite
 * und unvermeidlich, weil `handleCheckoutCompleted()` für Marketplace-Käufe
 * vorzeitig abzweigt (`route.ts`) und die Aufnahme deshalb hier stattfinden
 * muss — wer den Hook nur an den Direktkauf hängt, erwischt diese Käufe nie.
 */
export async function handleMarketplacePurchase(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
  metadata: MarketplaceCheckoutMetadata,
  event: Stripe.Event,
): Promise<void> {
  const { tenant_id: tenantId, product_id: productId, user_id: userId, listing_id: listingId } = metadata;

  // Idempotenz-Fix (gleiches Muster wie `isNewOrder` im regulären Pfad,
  // `api/stripe/webhook/route.ts::handleCheckoutCompleted()`): VOR dem
  // Upsert prüfen, ob die Order schon existiert — Stripe liefert
  // "checkout.session.completed" garantiert nur "at least once", ein Retry
  // darf die Bestätigungsmail unten NICHT ein zweites Mal auslösen.
  const { data: existingOrder } = await admin
    .from("orders")
    .select("id")
    .eq("stripe_checkout_id", session.id)
    .maybeSingle();
  const isNewOrder = !existingOrder;

  // Gleiches Idempotenz-Muster wie im bestehenden Pfad (orders.stripe_checkout_id
  // ist unique) — Stripe liefert Events "at least once".
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
    // Security-reviewer-Fund (03.08.2026, MITTEL): ein stiller `return` hier
    // hätte dem bezahlenden Kunden nie Zugriff verschafft, während Stripe die
    // Zahlung als abgeschlossen führt — und ohne Wurf/500-Antwort liefert
    // Stripe das Event nie erneut zu. Werfen -> handleCheckoutCompleted() ->
    // äußerer try/catch in route.ts (Zeile ~80) -> 500 -> Stripe-Retry.
    throw new Error(`orders-Upsert fehlgeschlagen: ${orderError?.message ?? "keine Zeile zurückgegeben"}`);
  }

  // Tenant-Filter ergänzt (security-reviewer-Fund, NIEDRIG): tenantId/listingId
  // stammen zwar beide aus derselben, signaturgeprüften Stripe-Metadata und
  // sind damit konsistent — die Zusatzprüfung ist trotzdem reines
  // Defense-in-Depth, gleiches Muster wie an anderen Stellen im Projekt.
  const { data: listing } = await admin
    .from("marketplace_listings")
    .select("course_id")
    .eq("id", listingId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!listing) {
    throw new Error(`Listing für Erfüllung nicht gefunden: ${listingId}`);
  }
  const courseId = listing.course_id as string;

  const { enrollmentCreated } = await grantMarketplaceAccess(admin, tenantId, userId, courseId);

  // Ledger-Eintrag: Satz aus tenants.settings.marketplace_commission_bp,
  // sonst platform_settings.commission_rate_bp, sonst 2000 (20 %) — exakt
  // dieselbe Auflösungsreihenfolge wie bereits in
  // src/lib/platform/marketplace.ts::getListingForReview() (M3) etabliert,
  // hier bewusst nicht importiert (dortige Funktion verlangt
  // requirePlatformAdmin(), unpassend für einen Webhook-Kontext ohne
  // eingeloggten Nutzer) — stattdessen dieselbe kleine Abfrage dupliziert.
  // `.upsert(..., {onConflict:"order_id", ignoreDuplicates:true})` ist die
  // eigentliche Idempotenz-Sicherung (Plan Abschnitt 5) — bewusst NICHT extra
  // hinter eine "ist das ein neuer Order?"-Prüfung gestellt, da das nur eine
  // zweite, redundante Idempotenz-Schicht wäre.
  const [{ data: tenant }, { data: platformSettings }] = await Promise.all([
    admin.from("tenants").select("settings").eq("id", tenantId).maybeSingle(),
    admin.from("platform_settings").select("commission_rate_bp").eq("id", true).maybeSingle(),
  ]);
  const tenantSettings = (tenant?.settings ?? {}) as { marketplace_commission_bp?: number };
  const rawRateBp = tenantSettings.marketplace_commission_bp ?? platformSettings?.commission_rate_bp ?? 2000;
  // Geklammert (security-reviewer-Fund, NIEDRIG): tenants.settings ist JSONB
  // ohne DB-CHECK-Constraint (anders als platform_settings.commission_rate_bp,
  // das `check (... between 0 and 10000)` trägt) — über den heute einzigen
  // Schreibpfad (tenantMarketplaceCommissionSchema, platform/schema.ts) nicht
  // ausnutzbar, aber computeCommission() soll nie ungeprüft einem Wert >10000
  // vertrauen müssen (sonst negatives net_cents möglich).
  const rateBp = Math.min(Math.max(rawRateBp, 0), 10000);
  const grossCents = session.amount_total ?? 0;
  const { commissionCents, netCents } = computeCommission(grossCents, rateBp);

  // BEKANNTE FOLGE DES AFFILIATE-MODULS (Plan 12.5, B4): bei einem
  // Marketplace-Kauf MIT Affiliate-Zuordnung laufen ab jetzt ZWEI
  // Provisionsrechnungen auf dasselbe Brutto — die Marktplatz-Provision hier
  // und die Partner-Provision im Affiliate-Verarbeiter —, beide mit
  // `Math.floor`. `net_cents` ist in dieser Tabelle als Verkäufer-Anteil
  // definiert und bleibt es semantisch auch; es ist danach aber nicht mehr
  // der Betrag, den der Verkäufer tatsächlich behält, weil die
  // Affiliate-Provision ebenfalls aus dem Brutto kommt und diesen Anteil
  // wirtschaftlich mindert. Der Plan ändert die Ledger-Semantik BEWUSST
  // nicht: die Zeile ist ein Beleg über die Marktplatz-Provision, kein
  // Auszahlungsbescheid. Wer die Zahl als „Auszahlung an den Verkäufer"
  // auswertet (heute: `/portal/marketplace`), rechnet ab dann zu hoch. Die
  // Reparatur wäre additiv — eine zusätzliche Spalte `affiliate_cents` —,
  // keine Umarbeitung; sie ist hier ausdrücklich NICHT vorweggenommen, weil
  // eine stillschweigende Umdeutung von `net_cents` schlimmer wäre als eine
  // benannte Ungenauigkeit. Die Affiliate-Zeile selbst entsteht unten am Ende
  // dieser Funktion.
  const { error: ledgerError } = await admin.from("marketplace_ledger").upsert(
    {
      tenant_id: tenantId,
      order_id: order.id,
      listing_id: listingId,
      gross_cents: grossCents,
      commission_rate_bp: rateBp,
      commission_cents: commissionCents,
      net_cents: netCents,
      currency: session.currency ?? "eur",
    },
    { onConflict: "order_id", ignoreDuplicates: true },
  );
  if (ledgerError) {
    console.error("[marketplace/fulfil] marketplace_ledger-Upsert fehlgeschlagen:", ledgerError.message);
  }

  if (enrollmentCreated) {
    dispatchWebhookEvent(tenantId, "enrollment.created", {
      course_id: courseId,
      user_id: userId,
      source: "marketplace",
    }).catch(() => {});
  }

  // Nur bei echter Neuanlage der Order versenden — ein Stripe-Retry
  // desselben Checkouts (Zustellgarantie "at least once") darf dem Käufer
  // nicht dieselbe Bestätigungsmail ein zweites Mal schicken (gleiches
  // Idempotenz-Prinzip wie beim `enrollmentCreated`-Dispatch oben).
  if (isNewOrder) {
    await sendMarketplacePurchaseMail(admin, tenantId, userId, courseId);
  }

  // Affiliate B4 — Aufnahme in die Outbox (Plan 9.6). WIRFT bei jedem
  // Datenbankfehler außer `23505` (G2): der Wurf erzeugt die 500-Antwort,
  // auf die hin Stripe erneut zustellt. Idempotent über
  // `unique (stripe_event_id)`, deshalb ohne `isNewOrder`-Bedingung — wirft
  // ein früherer Schritt, wäre `isNewOrder` beim Retry `false` und die
  // Aufnahme fiele dauerhaft aus (G3).
  //
  // ABWEICHUNG VOM PLAN, mit Absicht: 9.6 sagt „direkt neben dem
  // `marketplace_ledger`-Upsert" und begründet das mit der Verfügbarkeit von
  // `order.id`, `grossCents` und `currency`. Die stehen hier genauso zur
  // Verfügung, der Aufruf sitzt aber ganz am ENDE der Funktion. Grund: die
  // beiden Schritte zwischen Ledger und Ende sind an
  // `enrollmentCreated`/`isNewOrder` gekoppelt und damit EINMALIG. Ein Wurf
  // vor ihnen kostete sie dauerhaft — beim Stripe-Retry existieren
  // Einschreibung und Bestellung bereits, beide Bedingungen sind `false`, der
  // `enrollment.created`-Webhook des Mandanten und die Bestätigungsmail des
  // Käufers unterblieben also für immer. Am Ende kostet derselbe Wurf nur
  // einen Retry. Der Affiliate-Zeile fehlt dadurch nichts: sie braucht
  // ausschließlich das Ereignis, den Mandanten und `order.id`.
  //
  // `tenantId` stammt aus der signaturgeprüften Session-Metadata, also aus
  // derselben Quelle wie die `orders`-Zeile; der Betrag wird NICHT von hier
  // durchgereicht, sondern in `intake.ts` aus dem Ereignis zerlegt, damit
  // alle vier Einhängepunkte dieselbe Zerlegung benutzen.
  //
  // Praktisch entsteht hier nur dann eine Zuordnung, wenn ein Kunde über
  // einen Mandanten-Link kam und anschließend ein Marketplace-Listing kaufte:
  // der Promolink-Generator bietet Marketplace-Ziele gar nicht erst an, und
  // `src/lib/marketplace/checkout.ts` bekommt bewusst KEINEN Metadata-Zusatz
  // (Plan 4.7). Ohne Zuordnung trägt die Zeile `referral_token = null` und
  // der Verarbeiter legt sie als `skipped/no_attribution` ab.
  await recordAffiliateEvent(admin, event, { tenantId, orderId: order.id });
}

/**
 * Bestätigungsmail an den Käufer (Plan Abschnitt 5.5: "sollte denselben
 * 'Zum Kurs'-Link wie die Dankeseite enthalten"). FAIL-SOFT wie das
 * bestehende `sendOrderPaidMail()`-Vorbild (`api/stripe/webhook/route.ts`) —
 * ein Mailfehler darf den Webhook-Erfolg nie verhindern.
 */
async function sendMarketplacePurchaseMail(
  admin: AdminClient,
  tenantId: string,
  userId: string,
  courseId: string,
): Promise<void> {
  try {
    const [{ data: tenant }, { data: course }, { data: profile }] = await Promise.all([
      admin.from("tenants").select("slug, custom_domain, name, branding, settings").eq("id", tenantId).maybeSingle(),
      admin.from("courses").select("slug, title").eq("id", courseId).maybeSingle(),
      admin.from("profiles").select("email, full_name").eq("id", userId).maybeSingle(),
    ]);
    if (!profile?.email || !course || !tenant) return;

    const tenantName = (tenant.name as string) ?? "Calltalent-Akademie";
    const accentColor = (tenant.branding as { color_primary?: string } | null)?.color_primary;
    const locale = resolveTenantEmailLocale(
      (tenant.settings as { default_locale?: string } | null)?.default_locale,
    );
    const courseUrl = buildTenantUrl(
      { slug: tenant.slug as string, custom_domain: tenant.custom_domain as string | null },
      `/kurs/${course.slug}`,
    );

    const html = await orderPaid({
      tenantName,
      recipientName: profile.full_name ?? undefined,
      productName: course.title as string,
      accentColor,
      locale,
      actionUrl: courseUrl,
    });
    const tSubject = await getTranslations({ locale, namespace: "email" });
    const result = await sendEmail({
      to: profile.email as string,
      subject: tSubject("orderPaid.subject"),
      html,
      tenant: { name: tenantName },
    });
    if (!result.success) {
      console.error("[marketplace/fulfil] Bestätigungsmail fehlgeschlagen (fail-soft):", result.error);
    }
  } catch (e) {
    console.error("[marketplace/fulfil] Ausnahme beim Bestätigungsmail-Versand (fail-soft):", e);
  }
}
