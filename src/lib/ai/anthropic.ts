import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getServerEnv } from "@/lib/env";

/**
 * Anthropic-SDK-Initialisierung (Phase 3, Block 1 — KI-Fundament).
 *
 * Cloudflare-Workers-Kompatibilität (CLAUDE.md Stack §1.7, Deployment via
 * OpenNext): `@anthropic-ai/sdk` ist fetch-basiert (kein Node-`http`/`https`-
 * Modul), sollte deshalb mit dem `nodejs_compat`-Flag auf Cloudflare Workers
 * laufen — analog `src/lib/stripe/client.ts` (`Stripe.createFetchHttpClient()`).
 * Keine Laufzeitprüfung hier nötig, nur Dokumentation; bei tatsächlichen
 * Workers-Problemen zuerst hier nachsehen.
 *
 * Kein Modul-weites Caching des Clients — gleiches, bereits etabliertes
 * Muster wie `admin.ts`/`stripe/client.ts` (Client bei jedem Aufruf neu
 * erzeugen, kein Singleton-State zwischen Requests in einer Workers-Umgebung).
 */
export function createAnthropicClient(): Anthropic {
  const apiKey = getServerEnv().ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY ist nicht gesetzt — KI-Funktionen (Tutor, Kurs-Generator) sind aktuell nicht verfügbar.",
    );
  }
  return new Anthropic({ apiKey });
}
