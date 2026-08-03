"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { requestPasswordReset } from "@/lib/auth/actions";
import type { AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = { error: null };

/**
 * Design-Block 4 (12.07.2026, Claude-Design-Export "PasswortVergessen.dc.html")
 * — Marken-Panel-Layout an /login und /kontakt angeglichen. Funktionslogik
 * (requestPasswordReset, bewusst immer Erfolg wg. E-Mail-Enumeration-Schutz)
 * unverändert.
 *
 * Mandanten-Branding NEU (03.08.2026, Josips Auftrag "bei allen Unterseiten
 * soll das Logo vom neuen Mandanten übernommen werden"): war bisher fest
 * über `tShared("brandInitial"/"brandName"/"brandSuffix")` auf Calltalent
 * verdrahtet — die neue Server-Component page.tsx lädt jetzt `getTenant()`
 * und reicht `tenantName`/`logoUrl` durch, exakt dasselbe Logo-oder-
 * Initiale-Muster wie login-form.tsx (weiße Kachel im dunklen Marken-Panel,
 * volles Logo per `object-contain` statt Quadrat-Zuschnitt).
 */
export function ForgotPasswordForm({
  tenantName,
  logoUrl,
}: {
  tenantName: string;
  logoUrl: string | null;
}) {
  const t = useTranslations("auth.passwordForgot");
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

        <div className="max-w-[440px]">
          <h2 className="mb-3.5 text-[34px] font-extrabold leading-tight text-white">{t("brandHeading")}</h2>
          <p className="text-[17px]" style={{ color: "#DDDEEE" }}>
            {t("brandSubheading")}
          </p>
        </div>

        <div className="text-[13px]" style={{ color: "#B9BBDA" }}>
          © {new Date().getFullYear()} {tenantName}
        </div>
      </div>

      {/* Formular-Panel */}
      <div className="flex flex-1 flex-col" style={{ background: "#F4F5FA" }}>
        {/* Mobile-Kopfzeile (22.07.2026, Josips Auftrag "Login-Bereich für
            Mobile optimieren") — gleiches Muster wie login/login-form.tsx,
            siehe dortigen Kommentar für die Begründung. */}
        <div className="flex items-center gap-3 border-b px-6 py-4 lg:hidden" style={{ borderColor: "#E7E8F2" }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
            <img src={logoUrl} alt={tenantName} className="h-9 w-auto max-w-[160px] object-contain object-left" />
          ) : (
            <>
              <div
                className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] text-base font-extrabold"
                style={{ background: "var(--color-primary)", color: "var(--color-cream)" }}
                aria-hidden="true"
              >
                {tenantName.charAt(0).toUpperCase()}
              </div>
              <div className="leading-tight">
                <div className="text-sm font-extrabold tracking-tight" style={{ color: "#1A1A2E" }}>
                  {tenantName.toUpperCase()}
                </div>
                <div className="text-[10px] font-semibold" style={{ color: "#66679B", letterSpacing: "0.28em" }}>
                  AKADEMIE
                </div>
              </div>
            </>
          )}
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
            {t("backToLogin")}
          </a>

          <h1 className="mb-1.5 text-[28px] font-extrabold" style={{ color: "#1A1A2E" }}>
            {t("title")}
          </h1>
          <p className="mb-8 text-base" style={{ color: "#66679B" }}>
            {t("subtitle")}
          </p>

          <form action={action} className="flex flex-col gap-6">
            <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
              {t("emailLabel")}
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder={t("emailPlaceholder")}
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
              {t("submitButton")}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"></path>
                <path d="m13 6 6 6-6 6"></path>
              </svg>
            </button>
          </form>

          {state.success && (
            <p role="status" className="mt-4 text-sm" style={{ color: "#1F8A5B" }}>
              {t("success")}
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
              {t("noEmailHint")}{" "}
              <a href="/kontakt" className="font-bold no-underline">
                {t("contactLink")}
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
