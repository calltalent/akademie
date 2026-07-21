import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPlatformAccess } from "@/lib/platform/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantOrigin } from "@/lib/tenant/url";
import { PortalShell } from "@/components/portal/portal-shell";

const LOGIN_PATH = "/portal/login";
/** Slug des Mandanten, den Calltalent selbst betreibt (siehe Kommentar bei ownAdminUrl unten). */
const OWN_TENANT_SLUG = "calltalent";

/**
 * Eigenes (verschachteltes) Layout für das Betreiber-Portal — bewusst KEIN
 * Mandanten-Branding: kein getTenant()/ThemeStyle-Einbindung wie im
 * Mandanten-Layout (src/app/layout.tsx bindet ThemeStyle bereits global ein,
 * aber getTenant() liefert auf dem Portal-Host ohnehin null, siehe
 * src/middleware.ts). Eigenständiges, dunkles Farbschema statt der hellen
 * Mandanten-Optik der Akademie — bewusst unterscheidbar, damit im
 * Betreiber-Portal nie mit einer Mandanten-Oberfläche verwechselt wird.
 */
export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const headerList = await headers();
  const pathname = headerList.get("x-portal-pathname") ?? "";
  const isLoginPage = pathname === LOGIN_PATH;

  // Auf der Login-Seite selbst nie gaten — sonst Redirect-Schleife
  // (nicht angemeldet -> Redirect zu /portal/login -> wieder nicht
  // angemeldet -> ...). Der Header kommt aus src/middleware.ts.
  if (isLoginPage) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50">{children}</div>
    );
  }

  const access = await checkPlatformAccess();

  if (!access.ok) {
    if (access.reason === "not-authenticated") {
      redirect(LOGIN_PATH);
    }

    // access.reason === "not-platform-admin": eingeloggt, aber kein
    // Platform-Admin -> klare Meldung statt weiterem Redirect.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-slate-50">
        <h1 className="text-2xl font-semibold">Kein Zugriff</h1>
        <p className="max-w-md text-base text-slate-300">
          Kein Zugriff — nur für Calltalent-Team.
        </p>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-md border border-slate-600 px-4 py-2 text-base focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            Abmelden
          </button>
        </form>
      </div>
    );
  }

  // NEU (19.07.2026, Josips Auftrag "Button zurück in den Admin-Bereich"):
  // das Portal verwaltet ALLE Mandanten und hat selbst keinen eigenen
  // Admin-Bereich (der ist immer pro Mandant unter `/admin`) — Ziel ist
  // deshalb bewusst fest der EIGENE Mandant, den das Calltalent-Team selbst
  // betreibt/nutzt (Slug "calltalent"), nicht irgendein beliebiger anderer
  // Kunden-Mandant. `tenantOrigin()` statt eines fest verdrahteten
  // "academy.calltalent.ai" — folgt automatisch, falls sich `custom_domain`
  // dieses Mandanten je ändert, ohne Code-Änderung hier.
  const admin = createAdminClient();
  const { data: ownTenant } = await admin
    .from("tenants")
    .select("slug, custom_domain")
    .eq("slug", OWN_TENANT_SLUG)
    .maybeSingle();
  const ownAdminUrl = ownTenant ? `${tenantOrigin(ownTenant)}/admin` : undefined;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <PortalShell ownAdminUrl={ownAdminUrl}>{children}</PortalShell>
    </div>
  );
}
