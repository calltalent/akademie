import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { resolveTenantByHost } from "@/lib/tenant/resolve";

/**
 * Next.js 16: middleware.ts wurde zu proxy.ts (Funktionsname `proxy`,
 * läuft auf Node.js-Runtime, nicht mehr Edge). Das erlaubt uns hier direkt
 * die Mandanten-Auflösung per Admin-Client (service_role) durchzuführen,
 * statt sie in jede Server Component zu duplizieren.
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
export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);

  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0]; // Port abtrennen, analog extractTenantSlugFromHost()
  const portalHostname = publicEnv.NEXT_PUBLIC_PORTAL_HOST.split(":")[0];
  const isPortalHost = hostname === portalHostname;

  let servedPath = request.nextUrl.pathname;

  if (isPortalHost) {
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
    if (isPortalHost) {
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
        setAll(cookiesToSet) {
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
