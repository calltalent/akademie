import { getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";
import { LoginForm } from "./login-form";

/**
 * NEU (22.07.2026, Josips Auftrag: "Login-Bildschirm anpassbar machen"):
 * Server Component, lädt `tenant.branding.login_*` (siehe tenant/types.ts)
 * und reicht sie mit dem bisherigen Calltalent-Text als Fallback an
 * `LoginForm` durch — die eigentliche interaktive Seite (bisher hier
 * inline) ist unverändert in login-form.tsx umgezogen. `tenant` ist auf
 * dem Portal-Host `null` (kein x-tenant-data-Header dort, siehe
 * tenant/context.ts), dort greifen unverändert die Calltalent-Standardwerte.
 *
 * NACHTRAG (26.07.2026, Josips Auftrag "oben links soll das Logo vom
 * Mandanten sein"): `tenant.branding.logo_url` (bereits im Mandanten-
 * Bearbeiten-Formular im Portal hochladbar, bisher aber nirgendwo im
 * Produkt tatsächlich angezeigt) und `tenant.name` werden jetzt zusätzlich
 * durchgereicht — ohne eigenes Logo bleibt die Calltalent-Standardmarke
 * unverändert (siehe LoginForm-Kopfkommentar).
 *
 * i18n Block C1: die bisherigen hartkodierten deutschen Fallback-Konstanten
 * (DEFAULT_HEADING usw.) kommen jetzt aus `getTranslations("auth.login")` —
 * gleiches Verhalten für Mandanten ohne eigenes Branding, nur sprachabhängig.
 */
export default async function LoginPage() {
  const [tenant, t] = await Promise.all([getTenant(), getTranslations("auth.login")]);
  const branding = tenant?.branding ?? {};

  return (
    <LoginForm
      heading={branding.login_heading || t("defaultHeading")}
      subheading={branding.login_subheading || t("defaultSubheading")}
      copyright={branding.login_copyright || t("defaultCopyright")}
      bgOpacity={typeof branding.login_bg_opacity === "number" ? branding.login_bg_opacity : 100}
      tenantName={tenant?.name || t("defaultTenantName")}
      logoUrl={branding.logo_url ?? null}
    />
  );
}
