import { getTenant } from "@/lib/tenant/context";
import { issueContactFormToken } from "@/lib/contact/form-token";
import { KontaktForm } from "./kontakt-form";

/**
 * Server Component (03.08.2026, Josips Auftrag "bei allen Unterseiten soll
 * das Logo vom neuen Mandanten übernommen werden, mit eigenen Kontaktdaten
 * und Support") — lädt den Mandanten und reicht Name/Logo/Support-E-Mail an
 * `KontaktForm` durch, gleiches Muster wie (auth)/login/page.tsx. Ohne
 * Mandant (Portal-Host) oder ohne gesetzte `settings.support_email`
 * (Admin-Einstellungen) bleibt der bisherige Calltalent-Standard erhalten.
 *
 * Bot-Schutz (25.08.2026, siehe contact/spam.ts): gibt zusätzlich ein
 * signiertes Zeitstempel-Token aus, das die Server Action gegenprüft
 * (Zeitfalle). Die Seite ist über `getTenant()` -> `headers()` ohnehin
 * dynamisch gerendert, jeder Aufruf bekommt also ein frisches Token.
 */
export default async function KontaktPage() {
  const [tenant, formToken] = await Promise.all([getTenant(), issueContactFormToken()]);

  return (
    <KontaktForm
      formToken={formToken}
      tenantName={tenant?.name || "Calltalent"}
      logoUrl={tenant?.branding?.logo_url ?? null}
      supportEmail={tenant?.settings?.support_email?.trim() || "office@calltalent.ai"}
    />
  );
}
