import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";

/** Magic-Link-Callback: tauscht den Code gegen eine Session. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const explicitNext = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Performance-Fix (19.07.2026, siehe gleiche Begründung in
      // lib/auth/actions.ts signInWithPassword): ohne explizites `next`
      // (Passwort-setzen-Link) sonst über "/" -> app/page.tsx -> /dashboard,
      // ein kompletter Request/Middleware/getUser()-Rundlauf zu viel für
      // Magic-Link- und Einladungs-Logins. getTenant() liest gecacht aus dem
      // Middleware-Header (kein DB-Zugriff) — auf dem Portal-Host bleibt
      // `tenant` null, Ziel bleibt "/" (Middleware schreibt dort transparent
      // auf /portal um).
      let next = explicitNext;
      if (!next) {
        const tenant = await getTenant();
        next = tenant ? "/dashboard" : "/";
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?fehler=anmeldung`);
}
