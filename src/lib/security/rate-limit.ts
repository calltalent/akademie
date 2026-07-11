import "server-only";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * Security-Fix (security-reviewer-Audit 11.07.2026, MITTEL): kein Rate
 * Limiting auf Auth-/API-Routen. Leichtgewichtiger Postgres-Limiter
 * (RPC `check_rate_limit`, Migration `rate_limits`) statt neuem externen
 * Dienst — kein Redis/Upstash im Stack (CLAUDE.md §1). Für Phase-1-Traffic
 * ausreichend; bei höherem Volumen später durch Cloudflare Rate Limiting
 * (WAF-Ebene, kein Code) ergänzbar.
 *
 * Fail-open bei technischem Fehler (z. B. RPC nicht erreichbar) — ein
 * Ausfall des Rate-Limiters darf nie legitime Nutzer aussperren.
 */
export async function checkRateLimit(
  namespace: string,
  opts: { maxRequests: number; windowSeconds: number; extraKey?: string },
): Promise<boolean> {
  const h = await headers();
  const ip =
    h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${namespace}:${opts.extraKey ?? ip}`;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_max_requests: opts.maxRequests,
    p_window_seconds: opts.windowSeconds,
  });

  if (error) {
    console.error("Rate-Limit-Prüfung fehlgeschlagen (fail-open):", error.message);
    return true;
  }
  return data === true;
}

export const RATE_LIMIT_MESSAGE = "Zu viele Anfragen. Bitte kurz warten und erneut versuchen.";
