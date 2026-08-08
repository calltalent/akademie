import "server-only";

/**
 * CSRF-Schutz für Route Handler (Security-Fix 08.08.2026, Fünf-Punkte-Audit
 * MITTEL). Next.js' eingebauter Origin-Check gilt nur für Server Actions,
 * NICHT für `route.ts`-Handler — Routen, die ausschließlich per Session-
 * Cookie autorisieren (kein Signatur-/Bearer-/Secret-Header wie bei
 * Webhooks oder dem Cron-Endpunkt), brauchen deshalb einen eigenen,
 * gleichwertigen Check: der `Origin`-Header eines state-ändernden Requests
 * muss zum eigenen `Host` passen (Same-Origin), sonst ablehnen. Browser
 * senden `Origin` verlässlich bei jedem cross-site UND same-site POST
 * (Fetch-Standard) — ein fehlender Header wird deshalb als verdächtig
 * behandelt (fail-closed), anders als das bewusst fail-open gestaltete
 * Rate-Limiting (dortiger Ausfall darf legitime Nutzer nicht aussperren,
 * ein fehlender Origin-Header bei einem POST ist dagegen immer verdächtig).
 */
export function verifySameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const CSRF_REJECT_MESSAGE = "Anfrage abgelehnt (ungültiger Origin).";
