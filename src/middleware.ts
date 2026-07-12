import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { resolveTenantByHost } from "@/lib/tenant/resolve";

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
export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);

  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0]; // Port abtrennen, analog extractTenantSlugFromHost()
  const portalHostname = publicEnv.NEXT_PUBLIC_PORTAL_HOST.split(":")[0];
  const isPortalHost = hostname === portalHostname;

  let servedPath = request.nextUrl.pathname;

  // BUGFIX (Phase 5, Block 8, 12.07.2026, gefunden beim ersten Live-Checkout-
  // Test): API-Routen (`/api/...`) sind bewusst host-unabhängig gebaut - der
  // Stripe-Webhook z. B. leitet Mandant/Nutzer/Produkt AUSSCHLIESSLICH aus
  // `session.metadata` ab (siehe stripe/checkout.ts), nicht aus dem Host.
  // Auf `portal.calltalent.ai` registriert (empfohlen, weil stabiler als
  // eine einzelne Mandanten-Domain), wurde JEDER `/api/...`-Aufruf trotzdem
  // auf `/portal/api/...` umgeschrieben - eine Route, die nicht existiert ->
  // Next.js lieferte 404, Stripe zeigte "3 von 3 Zustellungen fehlgeschlagen"
  // im Dashboard. Fix: `/api/`-Pfade werden auf JEDEM Host (auch dem
  // Portal-Host) unverändert durchgereicht, nie mit `/portal` vorangestellt
  // und ohne Mandanten-Auflösungsversuch (die bestehenden `/api/...`-Routen
  // lesen ohnehin keinen `x-tenant-id`-Header, siehe requireAdminTenant()/
  // API-Key-Auth statt Host-basiertem Tenant).
  const isApiPath = servedPath === "/api" || servedPath.startsWith("/api/");

  if (isApiPath) {
    // Weder Portal-Rewrite noch Mandanten-Header - Pfad bleibt unverändert.
  } else if (isPortalHost) {
    // Betreiber-Portal-Host: KEINE Mandanten-Auflösung versuchen.
    // Doppel-Rewrite vermeiden, falls der Pfad bereits mit /portal beginnt
    // (im Normalbetrieb nie der Fall — echte Nutzer tippen nie /portal-URLs
    // direkt in den Browser ein — aber sauber behandelt).
    const alreadyPortalPath =
      servedPath === "/portal" || servedPath.startsWith("/portal/");
    if (!alreadyPortalPath) {
      servedPath = `/portal${servedPath}`;
    }
  } else {
    const tenant = await resolveTenantByHost(host);
    if (tenant) {
      requestHeaders.set("x-tenant-id", tenant.id);
      requestHeaders.set("x-tenant-slug", tenant.slug);
    } else {
      requestHeaders.set("x-tenant-missing", "1");
    }
  }

  // Für den Zugriffs-Gate in src/app/portal/layout.tsx: next/headers() kennt
  // keinen Pfad, nur Header. Ohne diesen Header wüsste der Gate nicht, ob er
  // bereits auf /portal/login ist, und würde nicht angemeldete Nutzer beim
  // Redirect dorthin erneut redirecten (Endlosschleife) — das deckt auch den
  // Randfall eines direkten Zugriffs auf /portal/... über einen
  // Mandanten-Host statt den Portal-Host ab.
  requestHeaders.set("x-portal-pathname", servedPath);

  function buildResponse() {
    if (isPortalHost && !isApiPath) {
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
