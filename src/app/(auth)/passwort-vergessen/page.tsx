import { getTenant } from "@/lib/tenant/context";
import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * Server Component (03.08.2026, Josips Auftrag "bei allen Unterseiten soll
 * das Logo vom neuen Mandanten übernommen werden") — lädt den Mandanten und
 * reicht Name/Logo an `ForgotPasswordForm` durch, gleiches Muster wie
 * (auth)/login/page.tsx. Ohne Mandant (Portal-Host) bleibt der bisherige
 * Calltalent-Standard erhalten.
 */
export default async function PasswortVergessenPage() {
  const tenant = await getTenant();

  return <ForgotPasswordForm tenantName={tenant?.name || "Calltalent"} logoUrl={tenant?.branding?.logo_url ?? null} />;
}
