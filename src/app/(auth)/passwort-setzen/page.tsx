import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { NewPasswordForm } from "./new-password-form";

/**
 * Design-Update (26.07.2026, Josips Auftrag "Design für Passwort erstellen
 * dem Design des Projekts anpassen"): war bislang eine unformatierte
 * Übergangsseite (generisches Tailwind-Grau, kein Marken-Panel) — jetzt
 * dasselbe Zwei-Spalten-Muster wie /login und /passwort-vergessen, inkl.
 * Mandanten-Logo/-Name im Marken-Panel (gleiches Muster wie login/page.tsx,
 * 26.07.2026: Josips Fund "oben links kommt das Logo von Calltalent statt
 * vom Mandanten").
 *
 * Server-Component-Vorprüfung (statt den Nutzer erst nach dem Absenden des
 * Formulars scheitern zu lassen): ohne aktive Session (Link abgelaufen,
 * bereits benutzt, oder Seite direkt ohne Link aufgerufen) zeigt die Seite
 * sofort einen klaren Hinweis statt eines Formulars, das ohnehin fehlschlagen
 * würde (setNewPassword() prüft serverseitig zusätzlich dieselbe Session -
 * Defense-in-Depth, kein alleiniger Verlass auf diese Vorprüfung).
 */
export default async function PasswortSetzenPage() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    tenant,
    t,
    tShared,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getTenant(),
    getTranslations("auth.passwordSet"),
    getTranslations("auth.shared"),
  ]);
  const tenantName = tenant?.name || t("defaultTenantName");
  const logoUrl = tenant?.branding?.logo_url ?? null;

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
          {logoUrl ? (
            // BUGFIX (26.07.2026, siehe Sidebar.tsx-Kommentar zum selben
            // Fund): volles Logo per object-contain, in weißer Kachel — das
            // dunkle Marken-Panel würde ein Logo mit dunklem Text/Icon sonst
            // fast unsichtbar machen.
            <div className="flex h-11 flex-none items-center rounded-[11px] bg-white px-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert */}
              <img src={logoUrl} alt={tenantName} className="h-7 w-auto max-w-[170px] object-contain" />
            </div>
          ) : (
            <div
              className="flex h-11 w-11 flex-none items-center justify-center rounded-[11px] text-xl font-extrabold"
              style={{ background: "var(--color-primary)", color: "var(--color-cream)" }}
              aria-hidden="true"
            >
              {tenantName.charAt(0).toUpperCase()}
            </div>
          )}
          {!logoUrl && (
            <div className="leading-tight">
              <div className="text-lg font-extrabold tracking-tight text-white">{tenantName.toUpperCase()}</div>
              <div className="text-xs font-semibold" style={{ color: "#C9CBE6", letterSpacing: "0.3em" }}>
                {tShared("brandSuffix")}
              </div>
            </div>
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
        {/* Mobile-Kopfzeile — gleiches Muster wie login/login-form.tsx. */}
        <div className="flex items-center gap-3 border-b px-6 py-4 lg:hidden" style={{ borderColor: "#E7E8F2" }}>
          {logoUrl ? (
            // Volles Logo statt Quadrat-Zuschnitt (siehe Sidebar.tsx-Kommentar) —
            // weißer Untergrund hier, kein Kachel-Wrapper nötig.
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
                  {tShared("brandSuffix")}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 lg:px-8 lg:py-12">
          <div className="flex w-full max-w-[400px] flex-col">
            <h1 className="mb-1.5 text-[28px] font-extrabold" style={{ color: "#1A1A2E" }}>
              {t("title")}
            </h1>

            {user ? (
              <>
                <p className="mb-8 text-base" style={{ color: "#66679B" }}>
                  {t.rich("descriptionForUser", {
                    email: user.email ?? "",
                    b: (chunks) => <strong style={{ color: "#1A1A2E" }}>{chunks}</strong>,
                  })}
                </p>
                <NewPasswordForm />
              </>
            ) : (
              <>
                <p className="mb-8 text-base" style={{ color: "#66679B" }}>
                  {t("expiredLink")}
                </p>
                <a
                  href="/passwort-vergessen"
                  className="flex items-center justify-center gap-[9px] rounded-xl py-3.5 text-base font-bold text-white no-underline"
                  style={{ background: "var(--color-primary)" }}
                >
                  {t("requestNewLink")}
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
