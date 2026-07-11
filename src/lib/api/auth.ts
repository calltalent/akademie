import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashApiKey, hashesMatch } from "@/lib/webhooks/keys";

/**
 * Phase 3, Block 7 — Auth für `/api/v1/*`. Anfragen tragen KEINE
 * Supabase-Nutzer-Session (externe Integrationen wie Zapier/Make), deshalb
 * läuft die Auflösung zwingend über den Admin-Client (RLS-Bypass, gleiches
 * Muster wie die Bunny-/Stripe-Webhook-Routen und `tenant/resolve.ts`).
 *
 * Nach erfolgreicher Auflösung ist `tenantId` ein geprüfter Server-Wert —
 * ALLE weiteren Datenbankzugriffe der Route MÜSSEN ihn zusätzlich zu
 * `.eq("tenant_id", tenantId)` verwenden (Defense-in-Depth, gleiches Muster
 * wie überall sonst in diesem Projekt), niemals eine `tenant_id` aus dem
 * Request-Body/-Query übernehmen.
 */
export class ApiAuthError extends Error {
  status: 401 | 403;
  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
  }
}

export type ApiKeyContext = { tenantId: string; apiKeyId: string };

export async function resolveApiKeyTenant(request: Request): Promise<ApiKeyContext> {
  const authHeader = request.headers.get("authorization");
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  const providedKey = match?.[1]?.trim();
  if (!providedKey) {
    throw new ApiAuthError("Fehlender oder ungültiger Authorization-Header (erwartet: Bearer <key>).", 401);
  }

  const hash = hashApiKey(providedKey);
  const admin = createAdminClient();
  const { data: keyRow, error } = await admin
    .from("api_keys")
    .select("id, tenant_id, key_hash, active")
    .eq("key_hash", hash)
    .maybeSingle();

  // Zeitkonstanter Vergleich als zweite Verteidigungslinie NACH dem
  // DB-Lookup (der eigentliche Treffer läuft über den Index-Gleichheits-
  // vergleich in Postgres) — gleiches Prinzip wie überall sonst im Projekt
  // beim Vergleich geheimer Werte (siehe keys.ts/ki/process/route.ts).
  if (error || !keyRow || !hashesMatch(keyRow.key_hash, hash)) {
    throw new ApiAuthError("Ungültiger API-Key.", 401);
  }
  if (!keyRow.active) {
    throw new ApiAuthError("API-Key ist deaktiviert.", 403);
  }

  const { error: touchError } = await admin
    .from("api_keys")
    .update({ last_used: new Date().toISOString() })
    .eq("id", keyRow.id);
  if (touchError) {
    // Fail-soft: eine fehlgeschlagene last_used-Aktualisierung darf die
    // eigentliche API-Anfrage nicht scheitern lassen.
    console.error("[api/auth] last_used-Update fehlgeschlagen (fail-soft):", touchError.message);
  }

  return { tenantId: keyRow.tenant_id, apiKeyId: keyRow.id };
}
