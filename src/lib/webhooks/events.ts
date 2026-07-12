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
] as const;

export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
