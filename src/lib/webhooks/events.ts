import { z } from "zod";

/**
 * Phase 5, Block 8 (12.07.2026) — aus `deliver.ts` ausgelagert, rein für
 * `WEBHOOK_EVENTS`/`webhookEventSchema`/`WebhookEvent`, KOMPLETT frei von
 * jedem Node-Built-in (auch `node:crypto`).
 *
 * Grund: Die Annahme in `deliver.ts` ("Next.js/Turbopack bündelt
 * `node:crypto` clientseitig automatisch per Polyfill/Shim") stimmt nur für
 * Turbopack. Der `npm run build`-Webpack-Fallback (Block 8 — Turbopack-
 * SSR-Chunk-Bug mit `@opennextjs/cloudflare` 1.20.1, siehe PHASENSTATUS.md)
 * bricht beim Bündeln von `node:crypto` in die Client-Komponente
 * `webhooks-panel.tsx` hart ab ("UnhandledSchemeError … not handled by
 * plugins"). `webhooks-panel.tsx` importiert deshalb ab jetzt von HIER statt
 * von `deliver.ts` — `deliver.ts` re-exportiert weiterhin alles von hier für
 * die bestehenden serverseitigen Aufrufer (`dispatch.ts`, `dispatch.test.ts`,
 * `deliver-attempt.ts`), keine Änderung für die.
 */
export const WEBHOOK_EVENTS = [
  "user.created",
  "enrollment.created",
  "lesson.completed",
  "course.completed",
  "quiz.passed",
  "submission.created",
  "order.paid",
  // Affiliate-Modul, Block B9 (PLAN_Affiliate-System.md 9.10, 10/B9). Vier
  // Namen, zweiteilig wie die sieben oben — bewusst `affiliate.commission`
  // und nicht `affiliate.commission.created`: `WEBHOOK_EVENTS` ist die
  // einzige Quelle, aus der Admin-UI und zod-Schema ziehen, und eine zweite
  // Namensform in derselben Liste wäre für jeden Integrator eine Stolperkante.
  //
  // `webhooks.events` ist ein freies `text[]` ohne DB-Constraint
  // (`0001_init.sql:364`) — Bestandszeilen brechen durch die vier neuen
  // Werte also nicht, sie wählen sie nur nicht aus.
  //
  // ERBLAST, hier nur benannt, nicht geheilt: `/api/admin/webhooks/retry`
  // hängt an keinem Cron. Eine fehlgeschlagene Affiliate-Zustellung erbt
  // diese Lücke und wird erst bei einem Klick auf „Erneut senden" wiederholt.
  "affiliate.application",
  "affiliate.approved",
  "affiliate.commission",
  "affiliate.reversal",
] as const;

export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
