"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "@/lib/auth/actions";
import type { AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = { error: null };

/**
 * Design-Block 4 (12.07.2026, Claude-Design-Export "PasswortVergessen.dc.html")
 * — Marken-Panel-Layout an /login und /kontakt angeglichen (bisher, seit
 * Phase 5/Block 8, eine unformatierte Übergangsseite ohne Branding — im
 * Status-Screen-Vergleich von PHASENSTATUS.md "Design-Update" ursprünglich
 * gar nicht als eigener Screen erfasst). Funktionslogik (requestPasswordReset,
 * bewusst immer Erfolg wg. E-Mail-Enumeration-Schutz) unverändert.
 */
export default function PasswortVergessenPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialState);

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
          <h2 className="mb-3.5 text-[34px] font-extrabold leading-tight text-white">Kein Problem.</h2>
          <p className="text-[17px]" style={{ color: "#DDDEEE" }}>
            Wir schicken dir einen Link zum Zurücksetzen deines Passworts. In wenigen Minuten bist
            du wieder drin.
          </p>
        </div>

        <div className="text-[13px]" style={{ color: "#B9BBDA" }}>
          © {new Date().getFullYear()} Calltalent-Akademie
        </div>
      </div>

      {/* Formular-Panel */}
      <div className="flex flex-1 flex-col" style={{ background: "#F4F5FA" }}>
        {/* Mobile-Kopfzeile (22.07.2026, Josips Auftrag "Login-Bereich für
            Mobile optimieren") — gleiches Muster wie login/login-form.tsx,
            siehe dortigen Kommentar für die Begründung. */}
        <div className="flex items-center gap-3 border-b px-6 py-4 lg:hidden" style={{ borderColor: "#E7E8F2" }}>
          <div
            className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] text-base font-extrabold"
            style={{ background: "var(--color-primary)", color: "var(--color-cream)" }}
            aria-hidden="true"
          >
            C
          </div>
          <div className="leading-tight">
            <div className="text-sm font-extrabold tracking-tight" style={{ color: "#1A1A2E" }}>
              CALLTALENT
            </div>
            <div className="text-[10px] font-semibold" style={{ color: "#66679B", letterSpacing: "0.28em" }}>
              AKADEMIE
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 lg:px-8 lg:py-12">
        <div className="flex w-full max-w-[400px] flex-col">
          <a
            href="/login"
            className="mb-6 inline-flex items-center gap-[7px] text-sm font-semibold no-underline"
            style={{ color: "#5663AE" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5663AE" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"></path>
              <path d="m11 18-6-6 6-6"></path>
            </svg>
            Zurück zur Anmeldung
          </a>

          <h1 className="mb-1.5 text-[28px] font-extrabold" style={{ color: "#1A1A2E" }}>
            Passwort vergessen
          </h1>
          <p className="mb-8 text-base" style={{ color: "#66679B" }}>
            Gib deine E-Mail-Adresse ein und wir senden dir einen Link zum Zurücksetzen.
          </p>

          <form action={action} className="flex flex-col gap-6">
            <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
              E-Mail-Adresse
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="name@email.de"
                className="rounded-xl border px-4 py-3.5 text-base font-normal focus:outline-none focus:ring-2 focus:ring-offset-1"
                style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
              />
            </label>

            {state.error && (
              <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
                {state.error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="flex items-center justify-center gap-[9px] rounded-xl py-3.5 text-base font-bold text-white disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
            >
              Link senden
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"></path>
                <path d="m13 6 6 6-6 6"></path>
              </svg>
            </button>
          </form>

          {state.success && (
            <p role="status" className="mt-4 text-sm" style={{ color: "#1F8A5B" }}>
              Falls ein Konto mit dieser E-Mail existiert, ist ein Link unterwegs. Bitte
              E-Mail-Postfach prüfen.
            </p>
          )}

          <div
            className="mt-7 flex items-start gap-[11px] rounded-xl px-[18px] py-4"
            style={{ background: "#EDEEF7" }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#5663AE"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
            <div className="text-sm" style={{ color: "#66679B" }}>
              Keine E-Mail erhalten? Prüfe deinen Spam-Ordner oder{" "}
              <a href="/kontakt" className="font-bold no-underline">
                kontaktiere uns
              </a>
              .
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
