import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifySameOrigin, CSRF_REJECT_MESSAGE } from "@/lib/security/origin";

/**
 * BUGFIX (22.07.2026, Josips Fund: "Abmelden im Portal führt zu einem
 * weißen, leeren Fenster"): `new URL("/login", request.url)` verlor hier
 * reproduzierbar die Subdomain — auf `portal.localhost:3000` abgesendet,
 * landete der Redirect auf dem BLOSSEN `localhost:3000/login` (die
 * mandantenlose Login-Seite mit Calltalent-Standardtext statt der
 * dunklen Portal-Login-Seite). `request.headers.get("host")` ist an
 * dieser Stelle zuverlässig (middleware.ts liest den Host genauso, siehe
 * dortiger Kommentar) — Redirect-Ziel deshalb explizit daraus gebaut statt
 * aus `request.url`.
 *
 * `status: 303` statt Next.js' Default 307: ein 307 behält die HTTP-Methode
 * bei — der Browser hätte den Redirect sonst per POST statt GET verfolgt
 * (live beobachtet: `POST /login` statt `GET /login` im Server-Log). 303
 * ("See Other") erzwingt GET für die Folgeanfrage, das korrekte Verhalten
 * nach einer erfolgreich verarbeiteten POST-Aktion.
 */
export async function POST(request: Request) {
  // CSRF-Fix (Security-Review 07.09.2026): fehlte hier als einzige der
  // sieben state-ändernden Routen — reine Cookie-Session-Autorisierung ohne
  // Signatur-/Secret-Header, siehe src/lib/security/origin.ts-Dateikopf.
  // Ohne diesen Schutz könnte ein fremdes Formular einen eingeloggten
  // Nutzer unbemerkt ausloggen (Logout-CSRF).
  if (!verifySameOrigin(request)) {
    return NextResponse.json({ error: CSRF_REJECT_MESSAGE }, { status: 403 });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();

  const host = request.headers.get("host") ?? new URL(request.url).host;
  const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return NextResponse.redirect(`${protocol}://${host}/login`, 303);
}
