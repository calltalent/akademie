import { createClient } from "@/lib/supabase/server";

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
