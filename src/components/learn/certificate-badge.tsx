import { createClient } from "@/lib/supabase/server";

type CourseSettings = { certificate_enabled?: boolean };
type TenantSettings = { certificates_enabled?: boolean };

/**
 * Zertifikatsstatus in der Kursübersicht (SPEC 4.1: "Zertifikatsstatus").
 * Async Server Component — nutzt bewusst den normalen Nutzer-Client (NICHT
 * den Admin-Client, der bleibt auf src/lib/certificates/issue.ts begrenzt):
 * RLS `certificates_own_select` (user_id = auth.uid()) und die Storage-
 * Policy `certificates_own_read` erlauben dem Lernenden direkten Lesezugriff
 * auf sein eigenes Zertifikat. Der Download läuft trotzdem ausschließlich
 * über eine kurzlebige signierte URL (10 Min. TTL) statt einer dauerhaften
 * URL — der Bucket `certificates` ist privat, analog zu
 * `getSubmissionDownloadUrl()` aus Block 3.
 *
 * "Wird ausgestellt"-Falle (23.07.2026, Josips Fund): fehlt das Zertifikat
 * bei abgeschlossenem Kurs, zeigte diese Komponente unabhängig vom Grund
 * IMMER "wird ausgestellt — bitte in Kürze neu laden" an — auch wenn
 * `issueCertificateIfEligible()` (certificates/issue.ts) das Zertifikat gar
 * nicht erst ausstellt, weil Kurs- ODER Mandanten-Schalter auf "aus" steht.
 * Diese Meldung war dann dauerhaft falsch (nichts lädt je nach). Beide
 * Schalter werden jetzt hier ZUSÄTZLICH geprüft (gleiche Felder/Logik wie
 * issue.ts), damit die Meldung ehrlich zwischen "kommt noch" und "gibt es
 * für diesen Kurs nicht" unterscheidet.
 */
export async function CertificateBadge({
  tenantId,
  courseId,
  isComplete,
}: {
  tenantId: string;
  courseId: string;
  isComplete: boolean;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: certificate } = await supabase
    .from("certificates")
    .select("id, serial, issued_at, pdf_path")
    .eq("tenant_id", tenantId)
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!certificate) {
    if (!isComplete) return null;

    const [{ data: course }, { data: tenantRow }] = await Promise.all([
      supabase.from("courses").select("settings").eq("id", courseId).maybeSingle(),
      supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle(),
    ]);
    const courseSettings = (course?.settings ?? {}) as CourseSettings;
    const tenantSettings = (tenantRow?.settings ?? {}) as TenantSettings;
    const certificatesDisabled =
      courseSettings.certificate_enabled === false || tenantSettings.certificates_enabled === false;

    // Josips Auftrag (23.07.2026): keine Meldung an dieser Stelle, wenn
    // Zertifikate für Kurs/Mandant deaktiviert sind — die Kachel entfällt
    // dann komplett statt eines Hinweistexts.
    if (certificatesDisabled) {
      return null;
    }

    return (
      <p className="text-sm text-gray-500" role="status">
        Zertifikat wird ausgestellt — bitte die Seite in Kürze neu laden.
      </p>
    );
  }

  let downloadUrl: string | null = null;
  if (certificate.pdf_path) {
    const { data } = await supabase.storage
      .from("certificates")
      .createSignedUrl(certificate.pdf_path, 60 * 10);
    downloadUrl = data?.signedUrl ?? null;
  }

  return (
    <div className="rounded-md border p-3" style={{ borderRadius: "var(--radius)" }}>
      <p className="text-sm font-medium">Zertifikat ausgestellt 🎓</p>
      <p className="text-xs text-gray-500">
        Ausgestellt am {new Date(certificate.issued_at).toLocaleDateString("de-DE")} — Seriennummer{" "}
        {certificate.serial}
      </p>
      {downloadUrl ? (
        <a href={downloadUrl} className="mt-2 inline-block text-sm underline">
          Zertifikat herunterladen (PDF)
        </a>
      ) : (
        <p className="mt-2 text-xs text-gray-500">Download aktuell nicht verfügbar.</p>
      )}
    </div>
  );
}
