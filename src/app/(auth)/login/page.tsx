"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { signInWithPassword, signInWithMagicLink } from "@/lib/auth/actions";
import type { AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = { error: null };

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
 */
export default function LoginPage() {
  const [pwState, pwAction, pwPending] = useActionState(
    signInWithPassword,
    initialState,
  );
  const [magicState, magicAction, magicPending] = useActionState(
    signInWithMagicLink,
    initialState,
  );

  return (
    <div
      className="flex min-h-screen"
      style={{ fontFamily: "var(--font-sans)", color: "#1A1A2E", fontSize: 18, lineHeight: 1.6 }}
    >
      {/* Marken-Panel */}
      <div
        className="hidden flex-1 flex-col justify-between p-12 lg:flex"
        style={{
          background:
            "repeating-linear-gradient(135deg, rgba(86,99,174,.55) 0 14px, rgba(62,63,102,.55) 14px 28px), #3E3F66",
        }}
      >
        <div className="flex items-center gap-3.5">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-[11px] text-xl font-extrabold"
            style={{ background: "var(--color-primary)", color: "var(--color-cream)" }}
            aria-hidden="true"
          >
            C
          </div>
          <div className="leading-tight">
            <div className="text-lg font-extrabold tracking-tight text-white">CALLTALENT</div>
            <div className="text-xs font-semibold" style={{ color: "#C9CBE6", letterSpacing: "0.3em" }}>
              AKADEMIE
            </div>
          </div>
        </div>

        <div className="max-w-[440px]">
          <h2 className="mb-3.5 text-[34px] font-extrabold leading-tight text-white">
            Verkaufen ist erlernbar.
          </h2>
          <p className="text-[17px]" style={{ color: "#DDDEEE" }}>
            Willkommen in deiner Akademie für Vertrieb am Telefon. Setze fort, wo du
            aufgehört hast.
          </p>
        </div>

        <div className="text-[13px]" style={{ color: "#B9BBDA" }}>
          © {new Date().getFullYear()} Calltalent-Akademie
        </div>
      </div>

      {/* Formular-Panel */}
      <div
        className="flex flex-1 flex-col items-center justify-center px-8 py-12"
        style={{ background: "#F4F5FA" }}
      >
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <div>
            <h1 className="mb-1.5 text-[28px] font-extrabold" style={{ color: "#1A1A2E" }}>
              Anmelden
            </h1>
            <p className="text-base" style={{ color: "#66679B" }}>
              Melde dich mit deinem Konto an.
            </p>
          </div>

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
  );
}
