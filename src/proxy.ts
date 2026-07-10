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
 * `/admin`-Betreiber-Routen (Betreiber-Portal) sind NICHT Teil dieses
 * Mandanten-Auflösungspfads — die kommen in Phase 4.
 */
export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);

  const host = request.headers.get("host") ?? "";
  const tenant = await resolveTenantByHost(host);
  if (tenant) {
    requestHeaders.set("x-tenant-id", tenant.id);
    requestHeaders.set("x-tenant-slug", tenant.slug);
  } else {
    requestHeaders.set("x-tenant-missing", "1");
  }

  let response = NextResponse.next({
    request: { headers: requestHeaders },
  });

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
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Erzwingt Token-Refresh, falls nötig — Pflicht laut @supabase/ssr-Doku,
  // sonst laufen Sessions in Server Components unbemerkt ab.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
