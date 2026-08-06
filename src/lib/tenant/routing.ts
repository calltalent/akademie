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
 *
 * ERWEITERUNG (Marketplace M4, 03.08.2026, Plan
 * "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt 4): zweiter
 * host-loser Sonder-Host `marketplace.calltalent.ai` neben dem bestehenden
 * Betreiber-Portal-Host — exakt dieselbe Rewrite-Achse (Pfad bekommt ein
 * Präfix, kein Mandant wird aufgelöst), nur ein anderes Präfix. Die
 * Portal-Rewrite-Logik ist deshalb zu `prefixRewrite()` extrahiert und wird
 * für BEIDE Sonder-Hosts wiederverwendet — kein zweiter, kopierter
 * Regelsatz, der beim nächsten Fix wieder auseinanderlaufen könnte (genau
 * die Lehre von oben, jetzt einmal mehr angewendet). Prüfreihenfolge im
 * Zweifel (beide Hosts identisch konfiguriert, reine Fehlkonfiguration):
 * Portal-Host gewinnt, da er zuerst geprüft wird.
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

/**
 * Host-Vergleich ohne Port (Marketplace M4) — exportiert, weil
 * middleware.ts denselben Vergleich zusätzlich für den `x-marketplace-host`-
 * Marker-Header braucht (Host-Spoofing-Schutz für src/app/marketplace/layout.tsx,
 * siehe dortiger Kopfkommentar). Vorher inline in decideRouting() dupliziert
 * (zweimal `hostnameOf(a) === hostnameOf(b)`) — jetzt eine einzige Stelle.
 */
export function isSameHost(hostA: string, hostB: string): boolean {
  return hostnameOf(hostA) === hostnameOf(hostB);
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * BUGFIX (22.07.2026, Josips Fund: "Abmelden im Portal führt zu einem
 * weißen, leeren Fenster"): `/auth/signout` (Formular in portal-shell.tsx)
 * und `/auth/callback` (Magic-Link-/Passwort-Rücksprung) sind wie `/api/...`
 * host-unabhängige Routen — sie leben unter `src/app/auth/...`, NICHT unter
 * `src/app/portal/...`. Ohne diesen Ausschluss griff auf dem Portal-Host
 * dieselbe Pauschal-Regel wie bei jeder normalen Seite: `/auth/signout`
 * wurde zu `/portal/auth/signout` umgeschrieben — eine nicht existierende
 * Route (404). Der Request erreichte den echten Route-Handler
 * (auth/signout/route.ts) dadurch nie, `supabase.auth.signOut()` lief nie,
 * und der Browser landete auf der 404-Seite (weiß, leer) statt auf
 * `/portal/login`. Exakt dieselbe Fehlerklasse wie der Stripe-Webhook-Fix
 * vom 12.07.2026 (siehe Kopfkommentar), nur für `/auth/...` statt `/api/...`
 * nie nachgezogen.
 */
export function isAuthPath(pathname: string): boolean {
  return pathname === "/auth" || pathname.startsWith("/auth/");
}

/**
 * Wartungsmodus-Durchsetzung (Folgeblock zu `tenants.settings.
 * maintenance_enabled`, vorher nur persistiert, siehe Kopfkommentar in
 * `lib/tenant/types.ts`): welche Pfade auch bei aktivem Wartungsmodus IMMER
 * erreichbar bleiben, unabhängig davon, ob die anfragende Person Team-
 * Mitglied ist. `/api/...` und `/auth/...` aus demselben Grund wie
 * `isApiPath()`/`isAuthPath()` oben (Webhooks bzw. Signout/Callback dürfen
 * nie blockiert werden). `/admin/...` bleibt immer erreichbar, da dort
 * ohnehin `checkStaffAccess()`/`checkAdminAccess()` (lib/auth/staff.ts)
 * greift — sonst könnte sich ein Owner nach dem Aktivieren des Schalters
 * nicht mehr anmelden, um ihn wieder auszuschalten. Die Login-/
 * Registrierungs-/Passwort-Seiten bleiben aus demselben Grund erreichbar.
 * `/wartung` selbst muss ausgenommen sein, sonst rewritet middleware.ts in
 * eine Endlosschleife.
 */
export function isMaintenanceBypassPath(pathname: string): boolean {
  return (
    isApiPath(pathname) ||
    isAuthPath(pathname) ||
    pathname === "/wartung" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/login" ||
    pathname === "/registrieren" ||
    pathname === "/passwort-vergessen" ||
    pathname === "/passwort-setzen"
  );
}

/**
 * Gemeinsame Rewrite-Regel für BEIDE mandantenlosen Sonder-Hosts (Portal,
 * Marketplace): `/api/...` und `/auth/...` bleiben unangetastet (Regel 1,
 * siehe Kopfkommentar), jeder andere Pfad bekommt `prefix` vorangestellt,
 * doppelter Rewrite wird vermieden, falls der Pfad bereits mit `prefix`
 * beginnt. `resolveTenant` ist für beide Sonder-Hosts immer `false` — es
 * gibt per Definition keinen Mandanten auf `portal.calltalent.ai` oder
 * `marketplace.calltalent.ai`.
 */
function prefixRewrite(pathname: string, prefix: string): RoutingDecision {
  if (isApiPath(pathname) || isAuthPath(pathname)) {
    return { servedPath: pathname, resolveTenant: false, rewrite: false };
  }
  const alreadyPrefixed = pathname === prefix || pathname.startsWith(`${prefix}/`);
  return {
    servedPath: alreadyPrefixed ? pathname : `${prefix}${pathname}`,
    resolveTenant: false,
    rewrite: true,
  };
}

export function decideRouting(params: {
  /** Host-Header der Anfrage, mit oder ohne Port. */
  host: string;
  pathname: string;
  /** NEXT_PUBLIC_PORTAL_HOST, mit oder ohne Port. */
  portalHost: string;
  /**
   * NEXT_PUBLIC_MARKETPLACE_HOST, mit oder ohne Port (Marketplace M4).
   * Bewusst OPTIONAL statt eines dritten Pflichtparameters: middleware.ts
   * übergibt in Produktion immer einen echten Wert (env.ts liefert einen
   * Default), aber die rund 15 bestehenden Testfälle in routing.test.ts, die
   * mit dem Marketplace-Host gar nichts zu tun haben, mussten dadurch nicht
   * alle angefasst werden — funktional identisch zu einem Pflichtparameter,
   * sobald ein Wert übergeben wird.
   */
  marketplaceHost?: string;
}): RoutingDecision {
  const { pathname } = params;

  // Betreiber-Portal-Host zuerst geprüft (Plan Abschnitt 4.1, letzter Satz:
  // bei hypothetisch identischer Konfiguration beider Sonder-Hosts gewinnt
  // der Portal-Host).
  if (isSameHost(params.host, params.portalHost)) {
    return prefixRewrite(pathname, "/portal");
  }

  // Marketplace-Host: gleiche Rewrite-Achse wie der Portal-Host, siehe
  // prefixRewrite()-Kommentar oben.
  if (params.marketplaceHost && isSameHost(params.host, params.marketplaceHost)) {
    return prefixRewrite(pathname, "/marketplace");
  }

  // Mandanten-Host: Mandant IMMER auflösen, auch für /api/... (Regel 2).
  // Host-unabhängige Routen (Bunny-Webhook via HMAC, /api/v1/... via
  // API-Key) ignorieren die Header einfach — für sie ändert sich nichts.
  return { servedPath: pathname, resolveTenant: true, rewrite: false };
}
