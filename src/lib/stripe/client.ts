import "server-only";
import Stripe from "stripe";
import { getServerEnv } from "@/lib/env";

/**
 * Stripe-SDK-Initialisierung (Phase 2, Block 5).
 *
 * Cloudflare-Workers-Kompatibilitaet (CLAUDE.md Stack, Deployment via
 * OpenNext): Stripe.createFetchHttpClient() nutzt fetch statt Node-
 * `http`/`https` - Workers kennen kein Node-http-Modul. Aus demselben Grund
 * verwendet die Webhook-Route (src/app/api/stripe/webhook/route.ts)
 * ausschliesslich `stripe.webhooks.constructEventAsync()` (Web-Crypto-
 * basiert) statt der synchronen `constructEvent()`-Variante, die Node-
 * `crypto` nutzt und auf Workers nicht zuverlaessig verfuegbar ist.
 *
 * Kein Modul-weites Caching des Clients (anders liesse sich argumentieren,
 * aber src/lib/supabase/admin.ts erzeugt seinen Client ebenfalls bei jedem
 * Aufruf neu - gleiches, bereits etabliertes Muster im Projekt).
 *
 * STRIPE_SECRET_KEY ist laut .env bereits gesetzt (Testmodus, sk_test_...),
 * trotzdem defensiv geprueft: STRIPE_WEBHOOK_SECRET fehlt noch (siehe
 * PHASENSTATUS.md), und dieselbe Nachlaessigkeit koennte theoretisch auch
 * den Secret Key betreffen - lieber eine klare deutsche Fehlermeldung als
 * ein kryptischer Stripe-SDK-Fehler.
 */
export function createStripeClient(): Stripe {
  const secretKey = getServerEnv().STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY ist nicht gesetzt - Zahlungen sind aktuell nicht verfügbar.",
    );
  }

  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}
