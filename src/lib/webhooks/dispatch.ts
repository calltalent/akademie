import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverWebhookAttempt, type WebhookEvent } from "@/lib/webhooks/deliver";

/**
 * Phase 3, Block 7 — zentrale ausgehende Webhook-Zustellung. Diese Datei
 * trägt jetzt bewusst `import "server-only"` (Korrektur, Cowork
 * 11.07.2026): sie importiert `createAdminClient` und darf deshalb NIE in
 * einen Client-/Test-Pfad gelangen. Die reinen, testbaren Bausteine
 * (`signPayload()`, `deliverWebhookAttempt()`, `WEBHOOK_EVENTS`,
 * `webhookEventSchema`) leben jetzt in `src/lib/webhooks/deliver.ts` (KEIN
 * `server-only`) — von dort re-exportiert, damit bestehende Aufrufer
 * (Settings-Actions, Retry-Endpunkt, alle 7 Hook-Punkte) unverändert
 * `from "@/lib/webhooks/dispatch"` importieren können. Nur
 * `dispatch.test.ts` importiert jetzt direkt von `deliver.ts`.
 */
export { WEBHOOK_EVENTS, webhookEventSchema, signPayload, deliverWebhookAttempt } from "@/lib/webhooks/deliver";
export type { WebhookEvent, DeliveryResult } from "@/lib/webhooks/deliver";

/**
 * FAIL-SOFT: wirft NIEMALS — jeder interne Fehler wird geloggt, die
 * Funktion kehrt einfach zurück. Aufrufer verwenden sie deshalb
 * fire-and-forget (`dispatchWebhookEvent(...).catch(() => {})`, NIE
 * `await`et in einer Weise, die den Haupt-Codepfad (z. B.
 * `completeLesson()`) blockiert oder scheitern lassen könnte — gleiches
 * Prinzip wie `summarizeTranscript()` aus Phase 3 Block 6).
 *
 * Lädt aktive `webhooks`-Zeilen des Mandanten, die `event` abonniert haben,
 * versucht EINMAL synchron zuzustellen und protokolliert IMMER eine Zeile
 * in `webhook_deliveries` (`status_code`, `attempts: 1`, `delivered_at`
 * nur bei 2xx). Wiederholungen (bis zu 3 Versuche insgesamt) laufen
 * separat über `/api/admin/webhooks/retry` — kein Cloudflare-Cron im Stack
 * (identische Einschränkung wie Phase 2 Block 5/6).
 */
export async function dispatchWebhookEvent(
  tenantId: string,
  event: WebhookEvent,
  payload: unknown,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: webhooks, error } = await admin
      .from("webhooks")
      .select("id, url, secret, events")
      .eq("tenant_id", tenantId)
      .eq("active", true);
    if (error || !webhooks || webhooks.length === 0) return;

    const targets = webhooks.filter(
      (w: { events: unknown }) => Array.isArray(w.events) && (w.events as string[]).includes(event),
    );
    if (targets.length === 0) return;

    await Promise.all(
      targets.map(async (webhook: { id: string; url: string; secret: string }) => {
        const { statusCode } = await deliverWebhookAttempt(webhook.url, webhook.secret, event, payload, tenantId);
        const delivered = statusCode !== null && statusCode >= 200 && statusCode < 300;

        // webhooks.secret / API-Key-Klartexte landen NIE hier — payload ist
        // ausschließlich das Business-Event-Payload des Aufrufers
        // (CLAUDE.md §2.2/§2.6 sinngemäß auch für Webhook-Secrets).
        const { error: logError } = await admin.from("webhook_deliveries").insert({
          tenant_id: tenantId,
          webhook_id: webhook.id,
          event,
          payload,
          status_code: statusCode,
          attempts: 1,
          delivered_at: delivered ? new Date().toISOString() : null,
        });
        if (logError) {
          console.error(
            `[webhooks/dispatch] Protokollierung für Webhook ${webhook.id} fehlgeschlagen:`,
            logError.message,
          );
        }
      }),
    );
  } catch (e) {
    console.error(
      "[webhooks/dispatch] Unerwarteter Fehler (fail-soft, keine Auswirkung auf die Hauptaktion):",
      e instanceof Error ? e.message : e,
    );
  }
}
