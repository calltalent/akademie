import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverWebhookAttempt, type WebhookEvent } from "@/lib/webhooks/dispatch";

/**
 * Phase 3, Block 7 — Wiederholungs-Ersatz-Endpunkt (kein Cloudflare-Cron
 * im Stack, identische Einschränkung wie Phase 2 Block 5/6). Geschützt
 * durch das SCHON VORHANDENE `CRON_PROCESS_SECRET` (bewusste
 * Wiederverwendung — semantisch das geteilte Geheimnis für alle
 * Cron-Ersatz-Endpunkte, nicht nur den Kurs-Generator; keine neue
 * Env-Variable). Josip simuliert Cron-Ticks lokal wie in Block 5/6
 * (manueller `Invoke-RestMethod`-Aufruf).
 *
 * Zeitkonstanter Vergleich — Helfer bewusst lokal dupliziert statt
 * extrahiert (gleiches Muster wie in
 * src/app/api/admin/ki/process/route.ts, dort ebenfalls lokal definiert;
 * src/app/api/bunny/webhook/route.ts hat eine eigene Variante für HMAC-
 * Vergleich — kein gemeinsamer Helper in diesem Projekt).
 */
function timingSafeSecretEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

const MAX_ATTEMPTS = 3;
const BATCH_LIMIT = 20; // ein Tick verarbeitet begrenzt viele Zeilen, analog process.ts

type PendingDelivery = {
  id: string;
  tenant_id: string;
  event: WebhookEvent;
  payload: unknown;
  attempts: number;
  webhooks: { url: string; secret: string; active: boolean } | { url: string; secret: string; active: boolean }[] | null;
};

export async function POST(request: Request) {
  const expectedSecret = getServerEnv().CRON_PROCESS_SECRET;
  if (!expectedSecret) {
    console.error("[webhooks/retry] CRON_PROCESS_SECRET ist nicht gesetzt - Endpunkt deaktiviert.");
    return NextResponse.json({ error: "Nicht konfiguriert." }, { status: 500 });
  }

  const providedSecret = request.headers.get("x-cron-secret");
  if (!providedSecret || !timingSafeSecretEqual(providedSecret, expectedSecret)) {
    console.error("[webhooks/retry] Ungültiges oder fehlendes Secret.");
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data: pending, error } = await admin
      .from("webhook_deliveries")
      .select("id, tenant_id, event, payload, attempts, webhooks(url, secret, active)")
      .lt("attempts", MAX_ATTEMPTS)
      .is("delivered_at", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (error) {
      console.error("[webhooks/retry] Laden fehlgeschlagen:", error.message);
      return NextResponse.json({ error: "Laden fehlgeschlagen." }, { status: 500 });
    }

    let retried = 0;
    let delivered = 0;
    let skipped = 0;

    for (const row of (pending ?? []) as PendingDelivery[]) {
      const webhook = Array.isArray(row.webhooks) ? row.webhooks[0] : row.webhooks;
      // Webhook wurde inzwischen gelöscht oder deaktiviert - nicht erneut
      // versuchen, aber auch keinen "attempts"-Zähler mehr hochzählen (der
      // gehört zur Zustellung, nicht zur Deaktivierung).
      if (!webhook || !webhook.active) {
        skipped += 1;
        continue;
      }

      retried += 1;
      const { statusCode } = await deliverWebhookAttempt(
        webhook.url,
        webhook.secret,
        row.event,
        row.payload,
        row.tenant_id,
      );
      const ok = statusCode !== null && statusCode >= 200 && statusCode < 300;
      if (ok) delivered += 1;

      const { error: updateError } = await admin
        .from("webhook_deliveries")
        .update({
          attempts: row.attempts + 1,
          status_code: statusCode,
          delivered_at: ok ? new Date().toISOString() : null,
        })
        .eq("id", row.id);
      if (updateError) {
        console.error(`[webhooks/retry] Update für Zustellung ${row.id} fehlgeschlagen:`, updateError.message);
      }
    }

    return NextResponse.json({ processed: pending?.length ?? 0, retried, delivered, skipped });
  } catch (e) {
    console.error("[webhooks/retry] Unerwarteter Fehler:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Verarbeitung fehlgeschlagen." }, { status: 500 });
  }
}
