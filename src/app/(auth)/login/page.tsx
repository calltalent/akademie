import { getTenant } from "@/lib/tenant/context";
import { LoginForm } from "./login-form";

const DEFAULT_HEADING = "Verkaufen ist erlernbar.";
const DEFAULT_SUBHEADING =
  "Willkommen in deiner Akademie für Vertrieb am Telefon. Setze fort, wo du aufgehört hast.";
const DEFAULT_COPYRIGHT = "Calltalent-Akademie";

/**
 * NEU (22.07.2026, Josips Auftrag: "Login-Bildschirm anpassbar machen"):
 * Server Component, lädt `tenant.branding.login_*` (siehe tenant/types.ts)
 * und reicht sie mit dem bisherigen Calltalent-Text als Fallback an
 * `LoginForm` durch — die eigentliche interaktive Seite (bisher hier
 * inline) ist unverändert in login-form.tsx umgezogen. `tenant` ist auf
 * dem Portal-Host `null` (kein x-tenant-data-Header dort, siehe
 * tenant/context.ts), dort greifen unverändert die Calltalent-Standardwerte.
 */
export default async function LoginPage() {
  const tenant = await getTenant();
  const branding = tenant?.branding ?? {};

  return (
    <LoginForm
      heading={branding.login_heading || DEFAULT_HEADING}
      subheading={branding.login_subheading || DEFAULT_SUBHEADING}
      copyright={branding.login_copyright || DEFAULT_COPYRIGHT}
      bgOpacity={typeof branding.login_bg_opacity === "number" ? branding.login_bg_opacity : 100}
    />
  );
}
