import "server-only";
import webpush from "web-push";
import { getServerEnv, publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Dünner Wrapper um `web-push` (Phase 4, Block 5). Wirft NIE hart bei einer
 * einzelnen fehlgeschlagenen Zustellung — bei „410 Gone"/„404 Not Found"
 * (Subscription abgelaufen/vom Nutzer/Browser widerrufen) löscht sie die
 * verwaiste `push_subscriptions`-Zeile automatisch (Selbstheilung, kein
 * Cron nötig). Andere Fehler (Netzwerk, fehlende VAPID-Konfiguration etc.)
 * werden geloggt, aber ebenfalls nicht nach außen geworfen — Aufrufer (z. B.
 * completeLesson()) dürfen NIE wegen eines Push-Fehlers scheitern.
 */
export async function sendPushNotification(
  subscription: PushSubscriptionRow,
  payload: PushPayload,
): Promise<{ ok: boolean }> {
  const serverEnv = getServerEnv();
  if (!serverEnv.VAPID_PRIVATE_KEY || !serverEnv.VAPID_SUBJECT || !publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    console.error("[push/send] VAPID nicht konfiguriert — Push-Versand übersprungen.");
    return { ok: false };
  }

  webpush.setVapidDetails(
    serverEnv.VAPID_SUBJECT,
    publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    serverEnv.VAPID_PRIVATE_KEY,
  );

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (error) {
    const statusCode = (error as { statusCode?: number } | undefined)?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      try {
        const admin = createAdminClient();
        await admin.from("push_subscriptions").delete().eq("id", subscription.id);
      } catch (cleanupError) {
        console.error(
          "[push/send] Aufräumen einer verwaisten Subscription fehlgeschlagen:",
          cleanupError instanceof Error ? cleanupError.message : cleanupError,
        );
      }
    } else {
      console.error(
        "[push/send] Zustellung fehlgeschlagen:",
        error instanceof Error ? error.message : error,
      );
    }
    return { ok: false };
  }
}

/**
 * Lädt alle Push-Subscriptions eines Nutzers (geräteübergreifend, kann
 * mehrere sein) und versendet an jede — komplett FAIL-SOFT, wirft nie.
 * Nutzt `createAdminClient()`, weil dieser Aufruf typischerweise aus einer
 * Server Action im Namen des Systems (nicht des Nutzers selbst) passiert
 * (z. B. completeLesson() nach einem Fortschritts-Update) und alle
 * Subscriptions des Nutzers laden muss, nicht nur die per RLS sichtbaren
 * eigenen Zeilen der aktuellen Session — gleiches Muster wie
 * dispatchWebhookEvent() in src/lib/webhooks/dispatch.ts.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: subscriptions, error } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (error || !subscriptions || subscriptions.length === 0) return;

    await Promise.all(subscriptions.map((sub) => sendPushNotification(sub, payload)));
  } catch (error) {
    console.error(
      "[push/send] sendPushToUser fehlgeschlagen (fail-soft, keine Auswirkung auf die Hauptaktion):",
      error instanceof Error ? error.message : error,
    );
  }
}
