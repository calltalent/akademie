"use client";

import { useActionState, useEffect, useState } from "react";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { signInWithPassword, signInWithMagicLink } from "@/lib/auth/actions";
import type { AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = { error: null };

/**
 * Bekannte Supabase-`error_code`-Werte aus dem URL-Hash (siehe
 * `LINK_ERROR_MESSAGES` unten) — freundlicher deutscher Text statt der
 * rohen englischen Supabase-Meldung.
 */
const LINK_ERROR_MESSAGES: Record<string, string> = {
  otp_expired: "Dieser Anmelde-Link ist abgelaufen oder wurde bereits verwendet.",
  access_denied: "Dieser Anmelde-Link ist ungültig oder wurde bereits verwendet.",
};
const DEFAULT_LINK_ERROR_MESSAGE = "Dieser Anmelde-Link ist ungültig oder abgelaufen.";

/**
 * Design-Block (12.07.2026, Claude-Design-Export, siehe PHASENSTATUS.md
 * "Design-Update"): Marken-Panel links (Login.dc.html) + Formular rechts.
 * Beide bestehenden Anmeldewege (Passwort + Magic Link) bleiben erhalten —
 * das Design zeigt nur ein Formular, aber Magic Link ist laut
 * PHASENSTATUS.md "Nachtrag Demo-Mandanten" der einzige funktionierende
 * Erst-Login-Weg für importierte/eingeladene Nutzer, also nicht verzichtbar.
 *
 * Label-Texte "E-Mail"/"Passwort" bewusst UNVERÄNDERT gelassen — `e2e/
 * auth.spec.ts` nutzt `getByLabel("E-Mail", { exact: true })` bzw.
 * `getByLabel("Passwort", { exact: true })`, eine Umbenennung würde den
 * Test brechen.
 *
 * Marken-Panel-Inhalt anpassbar (22.07.2026, Josips Auftrag: "Hintergrund-
 * Transparenz, Überschrift/Beschreibung und Copyright pro Mandant
 * anpassbar machen", Portal-UI in tenant-login-content-form.tsx): diese
 * Komponente war bisher rein statisch/Calltalent-fest; page.tsx (Server
 * Component) lädt jetzt den Mandanten und reicht die vier Werte als Props
 * durch, jeweils mit dem bisherigen Text als Default (kein Verhaltens-
 * unterschied für Mandanten ohne eigenes Branding). Das Streifenmuster
 * liegt als eigene, absolut positionierte Ebene HINTER dem Inhalt, damit
 * die Transparenz nie Logo/Text mitausbleicht — bei 0 % bleibt die
 * einfarbige Marken-Fläche (#3E3F66) sichtbar.
 */
export function LoginForm({
  heading,
  subheading,
  copyright,
  bgOpacity,
  tenantName,
  logoUrl,
}: {
  heading: string;
  subheading: string;
  copyright: string;
  bgOpacity: number;
  tenantName: string;
  logoUrl: string | null;
}) {
  const [pwState, pwAction, pwPending] = useActionState(
    signInWithPassword,
    initialState,
  );
  const [magicState, magicAction, magicPending] = useActionState(
    signInWithMagicLink,
    initialState,
  );
  // BUGFIX (26.07.2026, Josips Fund: Hydration-Fehler beim Laden mit
  // "?fehler=anmeldung"/Hash-Fehler): stand hier ursprünglich als lazy
  // `useState(() => …)`-Initialisierer (gleiches Muster wie der
  // Portal-Ziel-Lookup in components/learn/lesson-feedback.tsx) — DORT
  // sicher, weil der gelesene Wert erst nach einem Nutzerklick überhaupt
  // in die Darstellung einfließt. HIER entscheidet der Wert aber sofort
  // beim allerersten Rendern, ob die Warnbox erscheint — diese Seite wird
  // aber (wie jede Server-Component-Seite) auch serverseitig vor-gerendert,
  // wo `window` nicht existiert. Server-Rendering lieferte deshalb IMMER
  // "kein Fehler", das anschließende Client-Rendering beim allerersten
  // Durchlauf (der Initialisierer läuft dort synchron mit echtem `window`)
  // dagegen bei einer Fehler-URL sofort "Fehler" — genau der Unterschied,
  // den React beim Hydrieren als Mismatch abbricht. Deshalb jetzt bewusst
  // per Effect (ausnahmsweise legitim trotz react-hooks/set-state-in-effect,
  // da `window.location` grundsätzlich erst nach der Hydration verfügbar
  // ist): Start-Wert `null` ist auf Server UND beim ersten Client-Rendern
  // identisch, der Effect löst danach einen zweiten, rein client-seitigen
  // Render-Durchlauf aus — kein Mismatch mehr möglich.
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    // "?fehler=anmeldung" kommt von unserem eigenen /auth/callback (siehe
    // dortiger Kopfkommentar): der Token-Austausch selbst ist fehlgeschlagen,
    // NACHDEM Supabases eigener Verify-Schritt schon erfolgreich war — ein
    // anderer Fehlerfall als das Hash-Fragment unten (das kommt direkt von
    // Supabase, VOR unserem Callback).
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("fehler") === "anmeldung") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- window.location ist erst nach der Hydration verfügbar, siehe Kommentar oben
      setLinkError(DEFAULT_LINK_ERROR_MESSAGE);
      return;
    }
    if (!window.location.hash) return;
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const errorCode = hashParams.get("error_code");
    if (!hashParams.get("error") && !errorCode) return;
    setLinkError((errorCode && LINK_ERROR_MESSAGES[errorCode]) || DEFAULT_LINK_ERROR_MESSAGE);
  }, []);

  // BUGFIX (22.07.2026, Josips Fund: Login dauert 20+ Sekunden): siehe
  // ausführliche Begründung in lib/auth/actions.ts (signInWithPassword) —
  // ein redirect() innerhalb der Server Action selbst lief auf dieser
  // Plattform reproduzierbar über 20 Sekunden statt unter 1,5 Sekunden.
  // Navigation deshalb hier im Client, außerhalb von Next' eigener
  // Redirect-Sonderbehandlung für Server Actions.
  useEffect(() => {
    if (pwState.redirectTo) window.location.href = pwState.redirectTo;
  }, [pwState.redirectTo]);

  // BUGFIX (26.07.2026, Josips Fund: "Mandant klickt auf Passwort-setzen-/
  // Magic-Link, landet ohne jede Erklärung auf dem leeren Login-Formular").
  // Ist ein Recovery-/Magic-Link-Token bei Klick bereits abgelaufen oder
  // schon einmal eingelöst (z. B. weil ein E-Mail-Sicherheitsscanner den
  // Link vorab selbst aufruft, oder weil er ein zweites Mal angeklickt
  // wurde — beides einmalige Tokens), führt Supabases eigener
  // `/auth/v1/verify`-Endpunkt NICHT über unsere `/auth/callback`-Route,
  // sondern direkt zurück zur Login-Seite mit einem Fehler im URL-HASH
  // (`#error=access_denied&error_code=otp_expired&…`) — Hash-Fragmente
  // erreichen den Server nie, deshalb hier und nicht in login/page.tsx.
  // Vorher blieb dieser Fall komplett unsichtbar: leeres Formular, kein
  // Hinweis, keine Handlungsoption. Jetzt: verständliche Meldung + Verweis
  // auf die beiden Formulare weiter unten, die genau dafür einen neuen Link
  // anfordern. `replaceState` entfernt den Hash aus der Adresszeile, sobald
  // er ausgelesen ist — ein Neuladen soll die Meldung nicht endlos wiederholen.
  useEffect(() => {
    if (linkError) {
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete("fehler");
      const query = cleanParams.toString();
      window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
    }
  }, [linkError]);

  return (
    <div
      className="flex min-h-screen"
      style={{ fontFamily: "var(--font-sans)", color: "#1A1A2E", fontSize: 18, lineHeight: 1.6 }}
    >
      {/* Marken-Panel */}
      <div
        className="relative hidden flex-1 flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{ background: "#3E3F66" }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            opacity: bgOpacity / 100,
            background:
              "repeating-linear-gradient(135deg, rgba(86,99,174,.55) 0 14px, rgba(62,63,102,.55) 14px 28px)",
          }}
        />
        <div className="relative flex items-center gap-3.5">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
            <img
              src={logoUrl}
              alt={tenantName}
              className="h-11 w-11 flex-none rounded-[11px] object-cover"
            />
          ) : (
            <div
              className="flex h-11 w-11 flex-none items-center justify-center rounded-[11px] text-xl font-extrabold"
              style={{ background: "var(--color-primary)", color: "var(--color-cream)" }}
              aria-hidden="true"
            >
              {tenantName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="leading-tight">
            <div className="text-lg font-extrabold tracking-tight text-white">
              {tenantName.toUpperCase()}
            </div>
            {!logoUrl && (
              <div className="text-xs font-semibold" style={{ color: "#C9CBE6", letterSpacing: "0.3em" }}>
                AKADEMIE
              </div>
            )}
          </div>
        </div>

        <div className="relative max-w-[440px]">
          <h2 className="mb-3.5 text-[34px] font-extrabold leading-tight text-white">
            {heading}
          </h2>
          <p className="text-[17px]" style={{ color: "#DDDEEE" }}>
            {subheading}
          </p>
        </div>

        <div className="relative text-[13px]" style={{ color: "#B9BBDA" }}>
          © {new Date().getFullYear()} {copyright}
        </div>
      </div>

      {/* Formular-Panel */}
      <div className="flex flex-1 flex-col" style={{ background: "#F4F5FA" }}>
        {/* Mobile-Kopfzeile (22.07.2026, Josips Auftrag "Login-Bereich für
            Mobile optimieren"): das Marken-Panel links ist unter `lg` komplett
            ausgeblendet — ohne Ersatz gäbe es auf einem Smartphone (Mehrheit
            der echten Logins) gar keine Markenidentität mehr, nur ein leeres
            weißes Formular. Bewusst NUR Logo/Wortmarke, keine Überschrift/
            Beschreibung/Copyright — auf kleinen Bildschirmen hat das Formular
            selbst Vorrang vor Marketing-Text (Login.dc.html-Vorbild zeigt das
            ohnehin nur im breiten Marken-Panel, nicht als eigenständigen
            Baustein). */}
        <div className="flex items-center gap-3 border-b px-6 py-4 lg:hidden" style={{ borderColor: "#E7E8F2" }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
            <img src={logoUrl} alt={tenantName} className="h-9 w-9 flex-none rounded-[9px] object-cover" />
          ) : (
            <div
              className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] text-base font-extrabold"
              style={{ background: "var(--color-primary)", color: "var(--color-cream)" }}
              aria-hidden="true"
            >
              {tenantName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="leading-tight">
            <div className="text-sm font-extrabold tracking-tight" style={{ color: "#1A1A2E" }}>
              {tenantName.toUpperCase()}
            </div>
            {!logoUrl && (
              <div className="text-[10px] font-semibold" style={{ color: "#66679B", letterSpacing: "0.28em" }}>
                AKADEMIE
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 lg:px-8 lg:py-12">
          <div className="flex w-full max-w-[400px] flex-col gap-6">
            <div>
              <h1 className="mb-1.5 text-[28px] font-extrabold" style={{ color: "#1A1A2E" }}>
                Anmelden
              </h1>
              <p className="text-base" style={{ color: "#66679B" }}>
                Melde dich mit deinem Konto an.
              </p>
            </div>

            {linkError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border p-3.5 text-sm"
                style={{ borderColor: "#F0D0D0", background: "#FBEAEA", color: "#7A3535" }}
              >
                <AlertTriangle size={17} aria-hidden="true" className="mt-0.5 flex-none" style={{ color: "#B14A4A" }} />
                <span>
                  {linkError} Fordere unten einen neuen Link an — per „Passwort vergessen&quot; oder Magic Link.
                </span>
              </div>
            )}

          <form action={pwAction} className="flex flex-col gap-4" aria-label="Mit Passwort anmelden">
            <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
              E-Mail
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="rounded-md border px-4 py-3.5 text-base font-normal focus:outline-none focus:ring-2 focus:ring-offset-1"
                style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
              />
            </label>
            <div>
              <div className="mb-[7px] flex items-baseline justify-between">
                <label htmlFor="login-password" className="text-sm font-semibold" style={{ color: "#3E3F66" }}>
                  Passwort
                </label>
                <a href="/passwort-vergessen" className="text-[13px] font-semibold no-underline">
                  Passwort vergessen?
                </a>
              </div>
              <input
                id="login-password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="current-password"
                className="w-full rounded-md border px-4 py-3.5 text-base focus:outline-none focus:ring-2 focus:ring-offset-1"
                style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
              />
            </div>
            {pwState.error && (
              <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
                {pwState.error}
              </p>
            )}
            <button
              type="submit"
              disabled={pwPending}
              className="flex items-center justify-center gap-2 rounded-md py-3.5 text-base font-bold text-white disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
            >
              Anmelden
              <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </form>

          {/* "Powered by"-Kennzeichnung (26.07.2026, Josips Auftrag "unter
              dem Anmelde-Button ein Image ähnlich wie bei Baulig, powered by
              Calltalent"): Calltalent ist hier die Plattform hinter JEDEM
              Mandanten (analog Bauligs eigener "Powered by LearningSuite"-
              Kennzeichnung) — deshalb bewusst NICHT tenant-brandbar wie der
              Logo-Block oben, sondern fest. */}
          <div className="flex items-center justify-center gap-2">
            <span
              className="text-[11px] font-bold uppercase"
              style={{ letterSpacing: "0.14em", color: "#A9AAC4" }}
            >
              Powered by
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] text-[10px] font-extrabold"
                style={{ background: "var(--color-primary)", color: "var(--color-cream)" }}
                aria-hidden="true"
              >
                C
              </span>
              <span className="text-[13px] font-extrabold tracking-tight" style={{ color: "#3E3F66" }}>
                CALLTALENT
              </span>
            </span>
          </div>

          <div className="flex items-center gap-3.5 text-[13px]" style={{ color: "#A9AAC4" }} aria-hidden="true">
            <span className="h-px flex-1" style={{ background: "#E1E3EF" }} />
            oder
            <span className="h-px flex-1" style={{ background: "#E1E3EF" }} />
          </div>

          <form action={magicAction} className="flex flex-col gap-3" aria-label="Mit Magic Link anmelden">
            <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
              E-Mail für Magic Link
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="rounded-md border px-4 py-3.5 text-base font-normal focus:outline-none focus:ring-2 focus:ring-offset-1"
                style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
              />
            </label>
            {magicState.error && (
              <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
                {magicState.error}
              </p>
            )}
            {magicState.success && (
              <p role="status" className="text-sm" style={{ color: "#1F8A5B" }}>
                Link gesendet. Bitte E-Mail-Postfach prüfen.
              </p>
            )}
            <button
              type="submit"
              disabled={magicPending}
              className="rounded-md border py-3 text-[15px] font-semibold disabled:opacity-50"
              style={{ borderColor: "#D8DAEA", color: "#3E3F66", background: "#fff" }}
            >
              Magic Link senden
            </button>
          </form>

          <div className="text-center text-[15px]" style={{ color: "#66679B" }}>
            Noch kein Zugang?{" "}
            <a href="/kontakt" className="font-bold no-underline">
              Kontakt aufnehmen
            </a>
            {/*
              Design-Block 4 (12.07.2026): Login.dc.html verlinkt hier auf
              Kontakt.dc.html statt auf eine Selbstregistrierung — passt zum
              Betriebsmodell (Mandanten legen Nutzer über CSV-Import/Einladung
              an, siehe PHASENSTATUS.md Block 6). /registrieren bleibt als
              Route bestehen (kein Feature entfernt), ist von hier aus aber
              nicht mehr verlinkt. Offene Frage an Josip: soll die
              Selbstregistrierung ganz entfallen oder an anderer Stelle
              (z. B. nur für bestimmte Mandanten) erreichbar bleiben?
            */}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
