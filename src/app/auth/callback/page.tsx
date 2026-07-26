"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * BUGFIX (26.07.2026, Josips Fund: "Link zum Passwort festlegen führt zum
 * Login-Fenster, wo man sich einloggen, aber kein Passwort festlegen kann").
 *
 * War bisher ein reiner Server Route Handler (`route.ts`), der ausschließlich
 * einen `?code=`-Query-Parameter auswertete (PKCE-Flow, per
 * `supabase.auth.exchangeCodeForSession(code)`). Alle E-Mail-Links dieses
 * Projekts (Passwort setzen, Passwort zurücksetzen, Magic Link, CSV-Import-
 * Willkommensmail, Mandanten-Inhaber-Einladung, Registrierungs-Bestätigung)
 * entstehen serverseitig über `admin.auth.admin.generateLink()` — ein
 * ADMIN-generierter, per E-Mail verschickter Link, der in einem beliebigen,
 * FREMDEN Browser geöffnet wird (kein PKCE-`code_verifier` aus dem
 * ursprünglich anfragenden Browser verfügbar, das ist bei einem out-of-band
 * E-Mail-Link technisch auch gar nicht möglich). Supabases eigener
 * `/auth/v1/verify`-Endpunkt liefert die Session-Tokens für genau diesen
 * Fall deshalb NICHT als `?code=`, sondern als URL-FRAGMENT
 * (`#access_token=…&refresh_token=…&type=recovery`, „implizites" Flow).
 *
 * URL-Fragmente erreichen den Server NIE (der Browser schneidet sie vor dem
 * HTTP-Request ab) — ein reiner Server Route Handler kann sie also
 * grundsätzlich nicht auswerten. Bisher lief der Handler deshalb immer in
 * den Fallback (`/login?fehler=anmeldung`), wobei der Browser das
 * ursprüngliche Fragment an die Redirect-Ziel-URL anhängte (sichtbar an
 * `/login?fehler=anmeldung#access_token=…` in Josips Fund-Screenshot) —
 * ohne dass `/login` je etwas damit anfangen konnte. Dieser Bug betraf
 * vermutlich JEDEN der oben genannten E-Mail-Flows, blieb aber bisher
 * verdeckt durch den separaten, am selben Tag behobenen Supabase-
 * Redirect-URL-Allowlist-Fund (der frühere Fund brach die Weiterleitung
 * schon VOR diesem Schritt ab).
 *
 * Fix: diese Route ist jetzt eine Client Component statt eines Route
 * Handlers — nur im Browser ist `window.location.hash` überhaupt lesbar.
 * Zwei Fälle: Fragment-Tokens (Regelfall bei allen E-Mail-Links dieses
 * Projekts) über `setSession()`, ODER ein `?code=`-Query-Parameter (PKCE,
 * aktuell von keinem Flow dieses Projekts erzeugt, aber defensiv erhalten
 * für einen möglichen künftigen Flow, der ihn tatsächlich liefert) über
 * `exchangeCodeForSession()`. Beide laufen über den Browser-Client
 * (`@supabase/ssr`s `createBrowserClient`) — der schreibt die Session
 * automatisch als Cookies, die nachfolgende Server-Anfragen lesen können.
 * Abschließend ein VOLLER Seitenwechsel (`window.location.href`, kein
 * `router.push()`) — nur so sieht der nächste Request die frisch gesetzten
 * Cookies serverseitig sicher.
 *
 * Kein `getTenant()`-Kurzschluss mehr für das Standardziel ohne
 * explizites `next` (das lief bisher servereitig über den Middleware-
 * Header, hier clientseitig nicht verfügbar) — Standardziel ist jetzt "/",
 * `app/page.tsx` übernimmt die Mandant-vs-Portal-Weiche ohnehin bereits.
 */
export default function AuthCallbackPage() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") || "/";
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const code = params.get("code");

      const supabase = createClient();
      try {
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          throw new Error("Kein Token im Callback gefunden.");
        }
        window.location.href = next;
      } catch {
        window.location.href = "/login?fehler=anmeldung";
      }
    })();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <p className="text-base" style={{ color: "#66679B" }}>
        Anmeldung wird verarbeitet …
      </p>
    </main>
  );
}
