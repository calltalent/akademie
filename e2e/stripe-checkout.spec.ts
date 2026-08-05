import { test, expect } from "@playwright/test";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { createE2eAdminClient, getDemoTenantId, createPublishedCourse, tenantUrl, e2eSlug } from "./helpers/test-data";
import { E2E_STUDENT_EMAIL } from "./global-setup";

/**
 * Phase 4, Block 6 — stripe-checkout.spec.ts. Bedingt übersprungen, falls
 * STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET nicht gesetzt sind.
 *
 * ÜBERARBEITET (Josips Testlauf, 12.07.2026): der ursprüngliche Plan sah
 * vor, den Kauf ECHT über Stripes gehostete Checkout-Seite mit der
 * Testkarte 4242... abzuschließen. In der Praxis blockiert Stripes
 * hCaptcha-Bot-Erkennung (hsw.js, sichtbar in den Browser-Konsolen-Logs)
 * headless Chromium zuverlässig — der Test hing bis zum vollen
 * 180s-Timeout, UND das anschließende forcierte Beenden der hängenden
 * Chromium-Prozesse hat wiederholt den von Playwright selbst gestarteten
 * Dev-Server mitgerissen (nachfolgende Tests scheiterten reproduzierbar mit
 * ERR_CONNECTION_REFUSED).
 *
 * Neuer, robusterer Ansatz in zwei Teilen:
 * 1. Die echte UI bis zum Redirect zu checkout.stripe.com testen (das IST
 *    unser Code — Preis-Lookup, payments_enabled-Gate, Rate-Limit,
 *    Metadata-Aufbau, Session-Erzeugung über die echte Stripe-Test-API) —
 *    danach wird bewusst NICHT mehr headless mit Stripes eigener
 *    Checkout-Seite interagiert.
 * 2. Der Webhook wird direkt mit einem signierten Test-Event angesprochen
 *    (offizielles Muster: `stripe.webhooks.generateTestHeaderString()` aus
 *    dem Stripe-Node-SDK, für genau diesen Zweck gedacht) — das prüft exakt
 *    den Code-Pfad, der `orders` tatsächlich schreibt
 *    (`src/app/api/stripe/webhook/route.ts::handleCheckoutCompleted`), ohne
 *    von Stripes eigener Bot-Erkennung abhängig zu sein. Der Webhook-Handler
 *    liest `tenant_id`/`product_id`/`user_id` ausschließlich aus
 *    `session.metadata` (nie aus dem Host-Header) — der Aufruf funktioniert
 *    deshalb unabhängig von Mandanten-Subdomains gegen die normale
 *    `baseURL` (`http://localhost:3000`).
 */
test.skip(
  !process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET,
  "STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET nicht gesetzt — Stripe-Checkout-Test übersprungen.",
);

test.use({ storageState: "e2e/.auth/staff.json" });

test("Staff legt Testprodukt an, Checkout-Redirect funktioniert, Webhook erzeugt Bestellung", async ({
  page,
  browser,
}) => {
  const slug = e2eSlug("test-produkt");
  const title = `E2E Testprodukt ${Date.now()}`;

  const admin = createE2eAdminClient();
  const tenantId = await getDemoTenantId(admin);
  // FIX (05.08.2026): Produkte sind seit 19.07.2026 zwingend an einen Kurs
  // gebunden (product-form.tsx: "es darf keine andere Option geben") —
  // ohne mindestens einen Kurs zeigt die Seite gar kein Formular, nur einen
  // Hinweis mit Link zu /admin/kurse. Testkurs deshalb vorab anlegen, gleiches
  // Muster wie submission-review.spec.ts/marketplace-listing.spec.ts.
  const course = await createPublishedCourse(admin, tenantId, "Stripe Testprodukt");

  // --- Staff: 1,00-€-Testprodukt anlegen (echt über die UI) ---
  // FIX (05.08.2026): Produktverwaltung liegt jetzt unter /admin/produkte,
  // nicht mehr /admin/zahlungen (das ist seither eine reine Umsatz-
  // Auswertungsseite ohne Formular) — .first() bleibt, "Neues Produkt" ist
  // strukturell die erste ProductForm auf der Seite (die Produktliste
  // darunter kann weitere, gleich beschriftete Bearbeiten-Formulare
  // enthalten, siehe admin/produkte/page.tsx).
  await page.goto(tenantUrl("/admin/produkte"));
  await page.getByLabel("Titel").first().fill(title);
  await page.getByLabel(/Slug/).first().fill(slug);
  await page.getByLabel("Preis in Euro").first().fill("1,00");
  await page.getByLabel("Verknüpfter Kurs").first().selectOption({ label: course.title });
  await page.getByRole("button", { name: "Produkt anlegen" }).click();
  await expect(page.getByText("Gespeichert.")).toBeVisible({ timeout: 15000 });

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("slug", slug)
    .single();
  if (productError || !product) {
    throw new Error(`Testprodukt „${slug}" nicht gefunden: ${productError?.message}`);
  }

  const { data: studentProfile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", E2E_STUDENT_EMAIL)
    .single();
  if (profileError || !studentProfile) {
    throw new Error(`Profil für ${E2E_STUDENT_EMAIL} nicht gefunden: ${profileError?.message}`);
  }

  // --- Student: Checkout-Redirect testen (echte UI, echte Stripe-Test-API) ---
  const buyerContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const buyerPage = await buyerContext.newPage();
  let sessionId: string;
  try {
    await buyerPage.goto(tenantUrl(`/kaufen/${slug}`));
    // FIX (05.08.2026): Button-Text ist "Zahlungspflichtig bestellen" (deutsche
    // Button-Lösung-Pflicht, §312j Abs. 3 BGB), nicht "Kaufen" — live per
    // Browser verifiziert, Redirect zu checkout.stripe.com funktioniert damit.
    await buyerPage.getByRole("button", { name: "Zahlungspflichtig bestellen" }).click();
    await buyerPage.waitForURL(/checkout\.stripe\.com/, { timeout: 20000 });

    const match = buyerPage.url().match(/(cs_[a-zA-Z0-9_]+)/);
    if (!match) {
      throw new Error(`Konnte Checkout-Session-ID nicht aus der URL lesen: ${buyerPage.url()}`);
    }
    sessionId = match[1];
  } finally {
    // Bewusst KEINE weitere Interaktion mit Stripes gehosteter Seite (siehe
    // Kommentar oben) — Kontext wird sofort wieder geschlossen.
    await buyerContext.close();
  }

  // --- Webhook direkt mit signiertem Test-Event ansprechen (kein echter Kauf) ---
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const payload = JSON.stringify({
    id: `evt_e2e_${randomUUID().replace(/-/g, "")}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        mode: "payment",
        payment_intent: `pi_e2e_${randomUUID().replace(/-/g, "")}`,
        amount_total: 100,
        currency: "eur",
        metadata: {
          tenant_id: tenantId,
          product_id: product.id,
          user_id: studentProfile.id,
        },
      },
    },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });

  const webhookResponse = await page.request.post("/api/stripe/webhook", {
    data: payload,
    headers: { "content-type": "application/json", "stripe-signature": signature },
  });
  expect(webhookResponse.ok(), `Webhook-Antwort: ${webhookResponse.status()} ${await webhookResponse.text()}`).toBe(
    true,
  );

  // --- Staff: Bestellung erscheint in /admin/zahlungen ---
  // Bewusst auf die Bestellungs-<table> gescoped (OrdersTable) statt auf die
  // gesamte Seite — der Produkttitel steht bereits VOR dem Webhook auch in
  // der Produktliste darüber.
  await expect(async () => {
    await page.goto(tenantUrl("/admin/zahlungen"));
    await expect(page.getByRole("table").getByText(title)).toBeVisible();
  }).toPass({ timeout: 15000 });
});
