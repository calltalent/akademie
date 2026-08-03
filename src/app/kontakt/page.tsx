import { getTenant } from "@/lib/tenant/context";
import { KontaktForm } from "./kontakt-form";

/**
 * Server Component (03.08.2026, Josips Auftrag "bei allen Unterseiten soll
 * das Logo vom neuen Mandanten übernommen werden, mit eigenen Kontaktdaten
 * und Support") — lädt den Mandanten und reicht Name/Logo/Support-E-Mail an
 * `KontaktForm` durch, gleiches Muster wie (auth)/login/page.tsx. Ohne
 * Mandant (Portal-Host) oder ohne gesetzte `settings.support_email`
 * (Admin-Einstellungen) bleibt der bisherige Calltalent-Standard erhalten.
 */
export default async function KontaktPage() {
  const tenant = await getTenant();

  return (
    <KontaktForm
      tenantName={tenant?.name || "Calltalent"}
      logoUrl={tenant?.branding?.logo_url ?? null}
      supportEmail={tenant?.settings?.support_email?.trim() || "office@calltalent.ai"}
    />
  );
}
