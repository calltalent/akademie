import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";

/**
 * Root-Route `/` — seit dem Dashboard-Umzug nach /dashboard (Folgeauftrag)
 * nur noch eine Weiche, kein eigener Inhalt mehr:
 * - Kein Mandant (Dev-Root/localhost) → Hinweis mit Beispiel-Subdomains.
 * - Nicht angemeldet → /login (Josips Fund 13.07.2026: sonst wirkte `/` auf
 *   der Mandanten-Domain wie eine leere Seite).
 * - Angemeldet + Mandant → /dashboard (das eigentliche „Meine Kurse").
 *
 * Auf dem Betreiber-Portal-Host wird `/` bereits von der Middleware auf
 * /portal umgeschrieben — diese Datei läuft dort nicht, das Portal ist vom
 * Umzug unberührt. Der host-abhängige Login-Redirect in
 * lib/auth/actions.ts (`redirect("/")`) bleibt deshalb bewusst unverändert:
 * Studenten landen über diese Weiche auf /dashboard, Betreiber über den
 * Middleware-Rewrite auf /portal.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenant = await getTenant();

  if (!tenant) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Calltalent-Akademie — Dev-Root</h1>
        <p className="text-base">
          Kein Mandant zu diesem Host gefunden. Zum Testen eine Mandanten-Subdomain
          aufrufen, z. B.:
        </p>
        <ul className="list-inside list-disc text-base">
          <li>
            <code>http://demo-blau.localhost:3000</code>
          </li>
          <li>
            <code>http://demo-gruen.localhost:3000</code>
          </li>
        </ul>
      </main>
    );
  }

  if (!user) {
    redirect("/login");
  }

  redirect("/dashboard");
}
