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
 * WICHTIG (Security-Fix-Nachfund, Cowork, 11.07.2026): `deliverWebhookAttempt()`
 * lag ursprünglich ebenfalls hier, wurde aber bei der SSRF-Schutz-Ergänzung
 * (security-reviewer-Durchgang) nach `deliver-attempt.ts` ausgelagert — sie
 * importiert `assertSafeWebhookUrl()` aus `url-safety.ts`, welches
 * `node:dns/promises` nutzt. `deliver.ts` HIER wird nicht nur von
 * `dispatch.test.ts` importiert, sondern transitiv auch von der
 * Client-Komponente `webhooks-panel.tsx` (für `WEBHOOK_EVENTS`/
 * `WebhookEvent`) — Node-Built-ins wie `node:dns` können dort nicht gebündelt
 * werden ("does not support external modules"). Diese Datei bleibt deshalb
 * STRIKT frei von jedem Node-Built-in außer `node:crypto` (das bündelt
 * Next.js/Turbopack clientseitig automatisch per Polyfill/Shim) und von
 * jedem Server-only-Import.
 *
 * `dispatch.ts` re-exportiert alles aus dieser Datei (WEBHOOK_EVENTS/
 * webhookEventSchema/signPayload) UND aus `deliver-attempt.ts`
 * (deliverWebhookAttempt) für bestehende Aufrufer (Settings-Actions,
 * Retry-Endpunkt, Hook-Punkte) — nur `dispatch.test.ts` importiert jetzt
 * direkt von hier.
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

/** Reine, testbare Funktion: HMAC-SHA256-Hex-Signatur über den JSON-Body. */
export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export type DeliveryResult = { statusCode: number | null };
