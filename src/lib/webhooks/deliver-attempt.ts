import "server-only";
import { signPayload, type DeliveryResult, type WebhookEvent } from "@/lib/webhooks/deliver";
import { assertSafeWebhookUrl } from "@/lib/webhooks/url-safety";

/**
 * Ausgelagert aus `deliver.ts` (Cowork, 11.07.2026, Nachfund beim manuellen
 * Test von Josip): `deliverWebhookAttempt()` braucht seit dem SSRF-Fix
 * `assertSafeWebhookUrl()` (nutzt `node:dns/promises`) — das ließ sich nicht
 * mehr im clientseitig gebündelten `deliver.ts` unterbringen (Next.js/
 * Turbopack: "the chunking context does not support external modules",
 * ausgelöst über `webhooks-panel.tsx` [Client Component] → `deliver.ts`).
 * Trägt deshalb bewusst `import "server-only"` und lebt in einer eigenen
 * Datei — exakt dasselbe Trennungsmuster wie `dispatch.ts`/`deliver.ts`
 * selbst (server-only Wrapper um reine Bausteine).
 */

const DELIVERY_TIMEOUT_MS = 5000;

/**
 * Ein einzelner Zustellversuch (KEIN Datenbankzugriff) — von
 * `dispatchWebhookEvent()` (Erstversuch) UND von
 * `/api/admin/webhooks/retry` (Wiederholung) genutzt, damit Envelope-/
 * Signatur-/SSRF-Logik an genau einer Stelle steht. Wirft NIE: sowohl
 * Netzwerkfehler/Timeout als auch ein blockiertes SSRF-Ziel liefern
 * `statusCode: null`, der Aufrufer entscheidet über Protokollierung/
 * nächsten Versuch.
 */
export async function deliverWebhookAttempt(
  url: string,
  secret: string,
  event: WebhookEvent,
  payload: unknown,
  tenantId: string,
): Promise<DeliveryResult> {
  // Security-Fix (security-reviewer-Durchgang Phase 3, 11.07.2026, MITTEL):
  // SSRF-Schutz zusätzlich HIER (nicht nur bei createWebhook()) — DNS kann
  // sich nach der Webhook-Anlage geändert haben (DNS-Rebinding).
  try {
    await assertSafeWebhookUrl(url);
  } catch (e) {
    console.error(
      `[webhooks/deliver-attempt] Zustellung an ${url} blockiert (SSRF-Schutz):`,
      e instanceof Error ? e.message : e,
    );
    return { statusCode: null };
  }

  const body = JSON.stringify({
    event,
    tenant_id: tenantId,
    data: payload,
    sent_at: new Date().toISOString(),
  });
  const signature = signPayload(secret, body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Calltalent-Event": event,
        "X-Calltalent-Signature": `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    return { statusCode: response.status };
  } catch (e) {
    console.error(
      `[webhooks/deliver-attempt] Zustellung an ${url} fehlgeschlagen (wird protokolliert, kein Werfen):`,
      e instanceof Error ? e.message : e,
    );
    return { statusCode: null };
  } finally {
    clearTimeout(timeout);
  }
}
