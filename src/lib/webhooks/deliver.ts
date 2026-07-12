import { createHmac } from "node:crypto";

/**
 * Phase 3, Block 7 — reine, testbare Bausteine der Webhook-Zustellung,
 * bewusst OHNE jeden Import von `@/lib/supabase/admin` (das Modul trägt
 * `import "server-only"`, was unter Vitest sofort wirft — Testfund Josip,
 * 11.07.2026: `dispatch.ts` importierte `createAdminClient` am Dateikopf,
 * dadurch brach `dispatch.test.ts` beim reinen Import von `signPayload()`
 * transitiv, obwohl `signPayload()` selbst keinerlei DB-/Server-Zugriff
 * hat). Gleiches Muster wie `generator/parse.ts` (getrennt von
 * `generator/pipeline.ts`) und `tutor/prompt.ts` (getrennt von
 * `tutor/actions.ts`) an anderer Stelle im Projekt.
 *
 * WICHTIG (Security-Fix-Nachfund, Cowork, 11.07.2026): `deliverWebhookAttempt()`
 * lag ursprünglich ebenfalls hier, wurde aber bei der SSRF-Schutz-Ergänzung
 * (security-reviewer-Durchgang) nach `deliver-attempt.ts` ausgelagert — sie
 * importiert `assertSafeWebhookUrl()` aus `url-safety.ts`, welches
 * `node:dns/promises` nutzt.
 *
 * UPDATE (Block 8, 12.07.2026): `WEBHOOK_EVENTS`/`webhookEventSchema`/
 * `WebhookEvent` sind nach `events.ts` ausgelagert (dort die Begründung) —
 * die ursprüngliche Annahme, `node:crypto` werde clientseitig automatisch
 * gebündelt, hielt nur für Turbopack, nicht für den Webpack-Build. Hier
 * verbleiben nur noch `signPayload()`/`DeliveryResult`, re-exportiert werden
 * die Events trotzdem weiter (siehe unten) — bestehende Aufrufer
 * (`dispatch.ts`, `dispatch.test.ts`, `deliver-attempt.ts`) brauchen keine
 * Änderung.
 */
export { WEBHOOK_EVENTS, webhookEventSchema, type WebhookEvent } from "@/lib/webhooks/events";

/** Reine, testbare Funktion: HMAC-SHA256-Hex-Signatur über den JSON-Body. */
export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export type DeliveryResult = { statusCode: number | null };
