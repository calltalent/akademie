import { getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";

/**
 * Wartungsmodus-Durchsetzung (Folgeblock zu `tenants.settings.
 * maintenance_enabled`, vorher nur persistiert, siehe Kopfkommentar in
 * lib/tenant/types.ts): middleware.ts rewritet hierher (Status 503), sobald
 * der Schalter aktiv ist und die anfragende Person kein Team-Mitglied ist.
 * Host-unabhängig unter dem bestehenden RootLayout (kein eigener Auth-Gate
 * nötig, RootLayout hat keinen) — läuft daher unter jedem Mandanten-Host.
 *
 * Design-Nachtrag (06.08.2026, Josips Auftrag "dem aktuellen Design
 * anpassen"): löst den anfänglichen schlichten Access-Denied-Block
 * ((admin)/admin/layout.tsx-Stil) ab. Diese Seite wird IMMER mit
 * aufgelöstem Mandanten erreicht (middleware.ts prüft `tenant?.settings.
 * maintenance_enabled` — ohne Mandant nie `true`), ein Logo/Branding-loser
 * Platzhalter wäre also unnötig zurückhaltend. Übernimmt deshalb 1:1 das
 * etablierte Marken-Panel-Muster der übrigen öffentlichen Mandantenseiten
 * (`(auth)/login/login-form.tsx`, `kontakt/kontakt-form.tsx`): dunkles
 * Streifenmuster-Panel mit Logo/Initiale + Name links, helles Inhaltspanel
 * rechts. Reiner Statustext ohne Formular/Buttons — es gibt während der
 * Sperre nichts, wohin man navigieren könnte.
 */
export default async function WartungPage() {
  const [tenant, t] = await Promise.all([getTenant(), getTranslations("maintenance")]);

  const tenantName = tenant?.name || "Calltalent";
  const logoUrl = tenant?.branding?.logo_url ?? null;
  // Gleicher Fallback wie kontakt/page.tsx — konsistent statt "keine
  // Kontaktmöglichkeit während der Sperre".
  const supportEmail = tenant?.settings?.support_email?.trim() || "office@calltalent.ai";

  return (
    <div
      className="flex min-h-screen"
      style={{ fontFamily: "var(--font-sans)", color: "#1A1A2E", fontSize: 18, lineHeight: 1.6 }}
    >
      {/* Marken-Panel — 1:1 gleiches Muster wie kontakt-form.tsx/login-form.tsx */}
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
          <h2 className="mb-3.5 text-[34px] font-extrabold leading-tight text-white">
            {t("brandHeading")}
          </h2>
          <p className="mb-8 text-[17px]" style={{ color: "#DDDEEE" }}>
            {t("brandBody")}
          </p>
        </div>

        <div className="text-[13px]" style={{ color: "#B9BBDA" }}>
          © {new Date().getFullYear()} {tenantName}
        </div>
      </div>

      {/* Inhaltspanel */}
      <div
        className="flex flex-1 flex-col items-center justify-center px-8 py-12"
        style={{ background: "#F4F5FA" }}
      >
        <div className="flex w-full max-w-[440px] flex-col items-start">
          {/* Wappen-Badge statt Zurück-Link (kontakt-form.tsx-Muster) — es
              gibt während der Sperre nirgendwo hin zurückzugehen. */}
          <div
            className="mb-6 flex h-12 w-12 items-center justify-center rounded-[14px]"
            style={{ background: "var(--color-primary)" }}
            aria-hidden="true"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
            </svg>
          </div>

          <h1 className="mb-1.5 text-[28px] font-extrabold" style={{ color: "#1A1A2E" }}>
            {t("heading")}
          </h1>
          <p className="mb-7 text-base" style={{ color: "#66679B" }}>
            {t("body")}
          </p>

          <div
            className="flex w-full items-center gap-3.5 rounded-xl border px-[15px] py-[13px]"
            style={{ borderColor: "#D8DAEA", background: "#FFFFFF" }}
          >
            <div
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px]"
              style={{ background: "#EEEFF9" }}
              aria-hidden="true"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5663AE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
              </svg>
            </div>
            <div>
              <div className="text-[13px]" style={{ color: "#A9AAC4" }}>
                {t("supportLabel")}
              </div>
              <a href={`mailto:${supportEmail}`} className="text-base font-semibold no-underline" style={{ color: "#1A1A2E" }}>
                {supportEmail}
              </a>
            </div>
          </div>

          {/* Team-Login-Link (08.08.2026, Josips Auftrag): middleware.ts
              nimmt /login bereits von der Wartungssperre aus
              (isMaintenanceBypassPath in lib/tenant/routing.ts) — Team-
              Mitglieder mit is_staff()-Rolle kommen dort durch und werden ab
              dem nächsten Request auf jedem Pfad nicht mehr geblockt. Bisher
              fehlte nur ein sichtbarer Weg dorthin von dieser Seite aus. */}
          <a
            href="/login"
            className="mt-5 text-sm font-semibold no-underline"
            style={{ color: "#5663AE" }}
          >
            {t("teamLogin")}
          </a>
        </div>
      </div>
    </div>
  );
}
