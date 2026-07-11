import { createHmac } from "node:crypto";
import { z } from "zod";

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
 * `dispatch.ts` re-exportiert alles aus dieser Datei für bestehende
 * Aufrufer (Settings-Actions, Retry-Endpunkt, Hook-Punkte) — nur
 * `dispatch.test.ts` importiert jetzt direkt von hier.
 */
export const WEBHOOK_EVENTS = [
  "user.created",
  "enrollment.created",
  "lesson.completed",
  "course.completed",
  "quiz.passed",
  "submission.created",
  "order.paid",
] as const;

export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

const DELIVERY_TIMEOUT_MS = 5000;

/** Reine, testbare Funktion: HMAC-SHA256-Hex-Signatur über den JSON-Body. */
export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export type DeliveryResult = { statusCode: number | null };

/**
 * Ein einzelner Zustellversuch (KEIN Datenbankzugriff) — von
 * `dispatchWebhookEvent()` (Erstversuch) UND von
 * `/api/admin/webhooks/retry` (Wiederholung) genutzt, damit Envelope-/
 * Signatur-Logik an genau einer Stelle steht. Wirft NIE: Netzwerkfehler
 * oder Timeout liefern `statusCode: null`, der Aufrufer entscheidet über
 * Protokollierung/nächsten Versuch.
 */
export async function deliverWebhookAttempt(
  url: string,
  secret: string,
  event: WebhookEvent,
  payload: unknown,
  tenantId: string,
): Promise<DeliveryResult> {
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
      `[webhooks/deliver] Zustellung an ${url} fehlgeschlagen (wird protokolliert, kein Werfen):`,
      e instanceof Error ? e.message : e,
    );
    return { statusCode: null };
  } finally {
    clearTimeout(timeout);
  }
}
