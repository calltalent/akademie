"use client";

import { useActionState } from "react";
import { submitContactForm } from "@/lib/contact/actions";
import { initialContactActionState } from "@/lib/contact/state";
import { CONTACT_SUBJECTS } from "@/lib/contact/schema";
import { CONTACT_HONEYPOT_FIELD, CONTACT_TOKEN_FIELD } from "@/lib/contact/patterns";

/**
 * Design-Block 4 (12.07.2026, Claude-Design-Export "Kontakt.dc.html") —
 * öffentliche Kontaktseite, verlinkt von /login und /passwort-vergessen
 * ("Kontakt aufnehmen"/"kontaktiere uns", siehe PHASENSTATUS.md). Layout
 * bewusst 1:1 nach dem Login-Seiten-Muster (gleiches Marken-Panel links,
 * gleiche Tailwind-/Token-Konventionen) statt eigener Stil-Insel.
 *
 * Mandanten-Branding NEU (03.08.2026, Josips Auftrag "bei allen Unterseiten
 * soll das Logo vom neuen Mandanten übernommen werden, mit eigenen
 * Kontaktdaten und Support"): war bisher fest auf Calltalent verdrahtet
 * (Logo, Name, office@calltalent.ai) — jetzt reicht die neue Server-
 * Component page.tsx `tenantName`/`logoUrl`/`supportEmail` durch, exakt
 * gleiches Logo-oder-Initiale-Muster wie login-form.tsx. `submitContactForm`
 * (contact/actions.ts) löst den tatsächlichen Empfänger unabhängig davon
 * selbst über `getTenant()` auf — beide Stellen verwenden denselben Fallback
 * (`settings.support_email` des Mandanten, sonst office@calltalent.ai),
 * bleiben also konsistent, ohne dass der Wert doppelt gepflegt werden muss.
 *
 * Bot-Schutz NEU (25.08.2026, siehe lib/contact/patterns.ts + spam.ts): zwei versteckte
 * Felder — Honeypot und das von page.tsx signierte Zeitstempel-Token. Der
 * Honeypot liegt bewusst außerhalb des Sichtfelds statt auf `display:none`
 * (letzteres überspringen viele Bots) und ist per `aria-hidden` +
 * `tabIndex={-1}` für Screenreader und Tastaturbedienung unsichtbar — die
 * Falle darf einen sehenden wie einen blinden Nutzer nie treffen
 * (CLAUDE.md §3.4).
 */
export function KontaktForm({
  formToken,
  tenantName,
  logoUrl,
  supportEmail,
}: {
  formToken: string;
  tenantName: string;
  logoUrl: string | null;
  supportEmail: string;
}) {
  const [state, action, pending] = useActionState(submitContactForm, initialContactActionState);

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
        <div className="flex min-h-11 items-center gap-3.5">
          {logoUrl ? (
            <div className="flex h-11 flex-none items-center rounded-[11px] bg-white px-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert */}
              <img src={logoUrl} alt={tenantName} className="h-7 w-auto max-w-[170px] object-contain" />
            </div>
          ) : (
            <>
              <div
                className="flex h-11 w-11 items-center justify-center rounded-[11px] text-xl font-extrabold"
                style={{ background: "var(--color-primary)", color: "var(--color-cream)" }}
                aria-hidden="true"
              >
                {tenantName.charAt(0).toUpperCase()}
              </div>
              <div className="leading-tight">
                <div className="text-lg font-extrabold tracking-tight text-white">{tenantName.toUpperCase()}</div>
                <div className="text-xs font-semibold" style={{ color: "#C9CBE6", letterSpacing: "0.3em" }}>
                  AKADEMIE
                </div>
              </div>
            </>
          )}
        </div>

        <div className="max-w-[460px]">
          <h2 className="mb-3.5 text-[34px] font-extrabold leading-tight text-white">Sprich mit uns.</h2>
          <p className="mb-8 text-[17px]" style={{ color: "#DDDEEE" }}>
            Ob Fragen zum Zugang, zu Kursen oder zur Zusammenarbeit — wir melden uns in der Regel
            innerhalb eines Werktags.
          </p>

          <div className="flex items-center gap-3.5">
            <div
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px]"
              style={{ background: "rgba(255,255,255,.12)" }}
              aria-hidden="true"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9CBE6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
              </svg>
            </div>
            <div>
              <div className="text-[13px]" style={{ color: "#B9BBDA" }}>
                E-Mail
              </div>
              <div className="text-base font-semibold text-white">{supportEmail}</div>
            </div>
          </div>
        </div>

        <div className="text-[13px]" style={{ color: "#B9BBDA" }}>
          © {new Date().getFullYear()} {tenantName}
        </div>
      </div>

      {/* Formular-Panel */}
      <div
        className="flex flex-1 flex-col items-center justify-center px-8 py-12"
        style={{ background: "#F4F5FA" }}
      >
        <div className="flex w-full max-w-[440px] flex-col">
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
            Kontakt aufnehmen
          </h1>
          <p className="mb-7 text-base" style={{ color: "#66679B" }}>
            Schreib uns eine Nachricht — wir helfen dir gerne weiter.
          </p>

          {state.success ? (
            <p role="status" className="text-base" style={{ color: "#1F8A5B" }}>
              Danke, deine Nachricht ist angekommen. Wir melden uns in der Regel innerhalb eines
              Werktags.
            </p>
          ) : (
            <form action={action} className="flex flex-col gap-[18px]">
              <input type="hidden" name={CONTACT_TOKEN_FIELD} value={formToken} />
              <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
                <label htmlFor="kontakt-website">Website (bitte leer lassen)</label>
                <input
                  id="kontakt-website"
                  name={CONTACT_HONEYPOT_FIELD}
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  defaultValue=""
                />
              </div>
              <div className="flex gap-4">
                <label className="flex flex-1 flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
                  Vorname
                  <input
                    name="firstName"
                    type="text"
                    required
                    placeholder="Jonas"
                    className="rounded-xl border px-[15px] py-[13px] text-base font-normal focus:outline-none focus:ring-2 focus:ring-offset-1"
                    style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
                  Nachname
                  <input
                    name="lastName"
                    type="text"
                    required
                    placeholder="Weber"
                    className="rounded-xl border px-[15px] py-[13px] text-base font-normal focus:outline-none focus:ring-2 focus:ring-offset-1"
                    style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
                  />
                </label>
              </div>

              <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
                E-Mail-Adresse
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@email.de"
                  className="rounded-xl border px-[15px] py-[13px] text-base font-normal focus:outline-none focus:ring-2 focus:ring-offset-1"
                  style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
                />
              </label>

              <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
                Betreff
                <select
                  name="subject"
                  required
                  defaultValue=""
                  className="rounded-xl border bg-white px-[15px] py-[13px] text-base font-normal focus:outline-none focus:ring-2 focus:ring-offset-1"
                  style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
                >
                  <option value="" disabled>
                    Bitte auswählen
                  </option>
                  {CONTACT_SUBJECTS.map((subject) => (
                    <option key={subject} value={subject}>
                      {subject}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
                Nachricht
                <textarea
                  name="message"
                  rows={4}
                  required
                  placeholder="Wie können wir helfen?"
                  className="resize-y rounded-xl border px-[15px] py-[13px] text-base font-normal focus:outline-none focus:ring-2 focus:ring-offset-1"
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
                className="flex items-center justify-center gap-[9px] rounded-xl py-[15px] text-base font-bold text-white disabled:opacity-50"
                style={{ background: "var(--color-primary)" }}
              >
                Nachricht senden
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14"></path>
                  <path d="m13 6 6 6-6 6"></path>
                </svg>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
