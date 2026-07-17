/**
 * Reine Routing-Entscheidung der Middleware — bewusst ohne DB-Zugriff und
 * ohne Next.js-Typen, damit sie ohne Mocking per Vitest testbar ist (gleiche
 * Linie wie lib/progress/compute.ts und lib/video/vtt.ts).
 *
 * WARUM ES DIESE DATEI GIBT (17.07.2026): Die Middleware hatte zwei Regeln,
 * die sich gegenseitig zerstört haben, weil beide inline und ungetestet in
 * middleware.ts standen:
 *
 *   1. Der Stripe-Webhook läuft auf dem Portal-Host, darf aber NIE auf
 *      `/portal/api/...` umgeschrieben werden (Fix 12.07.2026 — vorher 404,
 *      "3 von 3 Zustellungen fehlgeschlagen").
 *   2. Auf einem Mandanten-Host MUSS der Mandant aufgelöst werden — auch für
 *      `/api/...`, denn sechs API-Routen lesen `x-tenant-id` über getTenant()
 *      (bunny/create-video, submissions/upload-url, admin/ki/generate,
 *      admin/ki/status, admin/users/import, admin/reporting/csv).
 *
 * Der Fix für (1) hat (2) mit abgeschaltet: `/api/`-Pfade wurden pauschal
 * ohne Mandanten-Auflösung durchgereicht. Fünf Tage lang liefen alle sechs
 * Routen in "Kein Mandant zu diesem Host gefunden" — daher 0 bunny_videos und
 * 0 ai_jobs in der Produktion. Niemand hat es bemerkt, weil der einzige Test,
 * der es gefangen hätte (e2e/csv-import.spec.ts), mangels demo-blau-Seed
 * nicht läuft.
 *
 * Die Lehre: Die beiden Regeln hängen an VERSCHIEDENEN Achsen — die
 * Mandanten-Auflösung am HOST, der Rewrite am PFAD. Solange das inline
 * verdrahtet war, konnte ein Fix an der einen Achse die andere still kippen.
 * Als reine Funktion ist beides gemeinsam testbar, und routing.test.ts hält
 * beide Regeln gleichzeitig fest.
 */

export type RoutingDecision = {
  /** Tatsächlich zu bedienender Pfad (Portal-Rewrite bereits angewandt). */
  servedPath: string;
  /** Muss `resolveTenantByHost()` laufen und x-tenant-id gesetzt werden? */
  resolveTenant: boolean;
  /** Muss die Antwort ein interner Rewrite auf `servedPath` sein? */
  rewrite: boolean;
};

/** Port abtrennen — analog extractTenantSlugFromHost(). */
function hostnameOf(host: string): string {
  return host.split(":")[0];
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function decideRouting(params: {
  /** Host-Header der Anfrage, mit oder ohne Port. */
  host: string;
  pathname: string;
  /** NEXT_PUBLIC_PORTAL_HOST, mit oder ohne Port. */
  portalHost: string;
}): RoutingDecision {
  const { pathname } = params;
  const isPortalHost = hostnameOf(params.host) === hostnameOf(params.portalHost);
  const api = isApiPath(pathname);

  // Betreiber-Portal-Host: hat per Definition keinen Mandanten.
  if (isPortalHost) {
    // API bleibt unangetastet (Regel 1) — kein Rewrite, keine Auflösung.
    if (api) {
      return { servedPath: pathname, resolveTenant: false, rewrite: false };
    }
    // Doppel-Rewrite vermeiden, falls der Pfad bereits mit /portal beginnt
    // (im Normalbetrieb nie der Fall, aber sauber behandelt).
    const alreadyPortalPath = pathname === "/portal" || pathname.startsWith("/portal/");
    return {
      servedPath: alreadyPortalPath ? pathname : `/portal${pathname}`,
      resolveTenant: false,
      rewrite: true,
    };
  }

  // Mandanten-Host: Mandant IMMER auflösen, auch für /api/... (Regel 2).
  // Host-unabhängige Routen (Bunny-Webhook via HMAC, /api/v1/... via
  // API-Key) ignorieren die Header einfach — für sie ändert sich nichts.
  return { servedPath: pathname, resolveTenant: true, rewrite: false };
}
