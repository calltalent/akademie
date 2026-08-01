import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { resolveTenantByHost } from "@/lib/tenant/resolve";
import { decideRouting } from "@/lib/tenant/routing";
import type { PublicTenant } from "@/lib/tenant/types";
import { resolveEnabledLocales } from "@/i18n/config";
import { resolveLocale } from "@/i18n/resolve";

/**
 * ROLLBACK zu middleware.ts (Edge-Runtime) — Phase 5, Block 8, 12.07.2026,
 * `npm run deploy`-Fund: `proxy.ts` (Phase 4, Block 1, Next.js 16, läuft
 * zwingend auf Node.js-Runtime) wird von @opennextjs/cloudflare NOCH NICHT
 * unterstützt ("Node.js middleware is not currently supported. Consider
 * switching to Edge Middleware."), bestätigt als bekannte, noch offene
 * Einschränkung (siehe cloudflare/workers-sdk Issue #13755 — Next.js 16s
 * neue Proxy-Architektur vs. OpenNexts aktueller Cloudflare-Adapter).
 * Community-Workaround bis OpenNext proxy.ts unterstützt: auf die ältere
 * middleware.ts-Konvention (Edge-Runtime, Funktionsname `middleware` statt
 * `proxy`) zurückwechseln.
 *
 * Funktional unverändert: die Mandanten-Auflösung nutzt ausschließlich
 * fetch-basierte Supabase-Aufrufe (@supabase/supabase-js, @supabase/ssr) —
 * keine Node-only-APIs (kein `crypto`/`fs`/Buffer o. Ä.), läuft daher
 * unter Edge-Runtime identisch. Die ursprüngliche Phase-4-Begründung
 * ("Node.js-Runtime erlaubt uns die Mandanten-Auflösung per Admin-Client")
 * bezog sich auf die zum Zeitpunkt neue proxy.ts-Möglichkeit generell,
 * nicht auf eine harte Node-API-Abhängigkeit — keine Verhaltensänderung
 * durch diesen Rückbau.
 *
 * Block 2: Host -> Tenant (service_role, siehe lib/tenant/resolve.ts) ->
 * x-tenant-id / x-tenant-slug als REQUEST-Header (nicht nur Response!),
 * damit Server Components sie über next/headers auslesen können.
 *
 * Phase 4, Block 1: VOR der Mandanten-Auflösung wird geprüft, ob der Host
 * dem Betreiber-Portal (NEXT_PUBLIC_PORTAL_HOST) entspricht. Auf dem
 * Portal-Host gibt es per Definition keinen Mandanten — dort wird intern
 * (Rewrite, keine sichtbare Weiterleitung) auf /portal/... umgeschrieben,
 * `resolveTenantByHost()` wird für diesen Host gar nicht erst aufgerufen.
 */

/** Unicode-sicheres Base64 ohne `Buffer` (siehe Kopfkommentar: keine Node-APIs in dieser Datei). */
function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);

  const host = request.headers.get("host") ?? "";

  // Die eigentliche Routing-Entscheidung (Portal-Rewrite? Mandant auflösen?)
  // liegt bewusst als reine, getestete Funktion in lib/tenant/routing.ts —
  // siehe die Bug-Historie im Kopf jener Datei: Die beiden Regeln (Stripe-
  // Webhook darf nie nach /portal/api/... umgeschrieben werden; Mandanten-
  // Hosts müssen auch für /api/... aufgelöst werden) hängen an verschiedenen
  // Achsen und haben sich hier inline schon einmal gegenseitig gekippt.
  // routing.test.ts hält beide gleichzeitig fest.
  const routing = decideRouting({
    host,
    pathname: request.nextUrl.pathname,
    portalHost: publicEnv.NEXT_PUBLIC_PORTAL_HOST,
  });
  const servedPath = routing.servedPath;

  let tenant: PublicTenant | null = null;
  if (routing.resolveTenant) {
    tenant = await resolveTenantByHost(host);
    if (tenant) {
      requestHeaders.set("x-tenant-id", tenant.id);
      requestHeaders.set("x-tenant-slug", tenant.slug);
      // Performance-Fix (19.07.2026, siehe Kommentar in tenant/resolve.ts):
      // volles Mandanten-Objekt als Header mitgeben, statt nur die ID —
      // `getTenant()` (tenant/context.ts) liest es direkt hieraus, ohne den
      // Mandanten in JEDER Server Component erneut aus der DB nachzuladen.
      // Base64 statt rohem JSON: Header-Werte müssen laut HTTP-Spezifikation
      // reine ASCII-Bytes sein — ein Mandantenname mit Umlauten (ä/ö/ü)
      // würde als rohes JSON in manchen Runtimes einen Fehler beim Setzen
      // des Headers auslösen. `TextEncoder`+`btoa` statt `Buffer` — Middleware
      // läuft auf der Edge-Runtime (s. Dateikopf-Kommentar oben), die
      // Node-Buffer nicht garantiert unterstützt, beide genutzten APIs schon.
      requestHeaders.set("x-tenant-data", utf8ToBase64(JSON.stringify(tenant)));
    } else {
      requestHeaders.set("x-tenant-missing", "1");
    }
  }

  // i18n Block A6 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 1+6): x-locale
  // direkt nach x-tenant-data setzen, gleiches Header-Muster wie oben. Kein
  // Zusatz-Query — der Mandanten-Standard kommt aus dem tenant-Objekt, das
  // ohnehin gerade geladen wurde (falls Mandanten-Host); auf dem Portal-Host
  // bleibt tenantDefault leer, die Kette fällt dann auf Accept-Language/"de"
  // zurück (siehe resolveLocale()). Das Cookie wird hier NUR gelesen — der
  // Schreibpfad (Server Action, NEXT_LOCALE setzen) ist Block B, nicht Teil
  // dieses Blocks.
  const enabledLocales = resolveEnabledLocales(tenant?.settings ?? {});
  const locale = resolveLocale({
    cookie: request.cookies.get("NEXT_LOCALE")?.value ?? null,
    tenantDefault: tenant?.settings.default_locale ?? null,
    acceptLanguage: request.headers.get("accept-language"),
    enabledLocales,
  });
  requestHeaders.set("x-locale", locale);

  // Für den Zugriffs-Gate in src/app/portal/layout.tsx: next/headers() kennt
  // keinen Pfad, nur Header. Ohne diesen Header wüsste der Gate nicht, ob er
  // bereits auf /portal/login ist, und würde nicht angemeldete Nutzer beim
  // Redirect dorthin erneut redirecten (Endlosschleife) — das deckt auch den
  // Randfall eines direkten Zugriffs auf /portal/... über einen
  // Mandanten-Host statt den Portal-Host ab.
  requestHeaders.set("x-portal-pathname", servedPath);

  function buildResponse() {
    if (routing.rewrite) {
      const rewriteUrl = new URL(servedPath + request.nextUrl.search, request.url);
      return NextResponse.rewrite(rewriteUrl, {
        request: { headers: requestHeaders },
      });
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let response = buildResponse();

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = buildResponse();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Erzwingt Token-Refresh, falls nötig — Pflicht laut @supabase/ssr-Doku,
  // sonst laufen Sessions in Server Components unbemerkt ab. Gilt auch für
  // Portal-Nutzer (Calltalent-Team), die genauso eine gültige Session
  // brauchen wie Mandanten-Nutzer.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
