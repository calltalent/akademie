import "server-only";
import { getServerEnv } from "@/lib/env";
import { CONTACT_MAX_FORM_AGE_SECONDS, CONTACT_MIN_FILL_SECONDS } from "@/lib/contact/patterns";

/**
 * Signierter Zeitstempel für das Kontaktformular (Zeitfalle).
 *
 * Die Server Component `/kontakt` gibt bei jedem Seitenaufruf ein frisches
 * Token aus, das Formular schickt es als verstecktes Feld zurück. Damit
 * lassen sich zwei Bot-Muster erkennen, die Rate-Limiting nicht abdeckt
 * (siehe spam.ts — verteilte Einzelanfragen von rotierenden IPs):
 *
 * 1. Absenden in unter `CONTACT_MIN_FILL_SECONDS` Sekunden — kein Mensch
 *    tippt fünf Felder so schnell.
 * 2. Direktes POST auf die Server Action ohne vorherigen Seitenaufruf —
 *    ohne gültige Signatur kein Token. Die Signatur (HMAC-SHA-256) macht
 *    den Zeitstempel fälschungssicher; ohne sie könnte ein Bot einfach
 *    einen passenden Wert erfinden.
 *
 * Schlüsselmaterial ist der ohnehin serverseitige
 * `SUPABASE_SERVICE_ROLE_KEY` (über eine eigene Domänen-Präfixierung, damit
 * die Signatur nirgends sonst wiederverwendbar ist) — bewusst kein neues
 * Secret, das Josip zusätzlich in Cloudflare hinterlegen müsste. Der
 * Schlüssel selbst verlässt den Server nie, aus dem HMAC ist er nicht
 * rekonstruierbar.
 */

export type TokenVerdict = "ok" | "too-fast" | "expired" | "invalid";

let cachedKey: CryptoKey | null = null;

async function hmacKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const secret = new TextEncoder().encode(
    `calltalent:contact-form-token:${getServerEnv().SUPABASE_SERVICE_ROLE_KEY}`,
  );
  cachedKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return cachedKey;
}

async function sign(issuedAt: number): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    new TextEncoder().encode(String(issuedAt)),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Vergleich ohne frühen Abbruch — kein Timing-Seitenkanal auf die Signatur. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Erzeugt ein Token für den aktuellen Zeitpunkt (Sekundengenauigkeit). */
export async function issueContactFormToken(nowMs: number = Date.now()): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  return `${issuedAt}.${await sign(issuedAt)}`;
}

export async function verifyContactFormToken(
  token: unknown,
  nowMs: number = Date.now(),
): Promise<TokenVerdict> {
  if (typeof token !== "string") return "invalid";

  const separator = token.indexOf(".");
  if (separator < 1) return "invalid";

  const issuedAtRaw = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^\d{1,15}$/.test(issuedAtRaw) || !/^[0-9a-f]{64}$/.test(signature)) return "invalid";

  const issuedAt = Number(issuedAtRaw);
  if (!constantTimeEquals(signature, await sign(issuedAt))) return "invalid";

  const ageSeconds = Math.floor(nowMs / 1000) - issuedAt;
  // Negative Alter (Uhrendrift zwischen Edge-Standorten) nicht als "zu
  // schnell" werten — nur ein echtes, positives Zeitfenster zählt.
  if (ageSeconds < 0) return ageSeconds < -CONTACT_MAX_FORM_AGE_SECONDS ? "invalid" : "ok";
  if (ageSeconds < CONTACT_MIN_FILL_SECONDS) return "too-fast";
  if (ageSeconds > CONTACT_MAX_FORM_AGE_SECONDS) return "expired";
  return "ok";
}
