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
 *
 * "Wird ausgestellt"-Meldung entfernt (24.07.2026, Josips Folgeauftrag: auf
 * Kurs-, Modul-, Sektions- und Lektionsseiten nicht anzeigen). Fehlt das
 * Zertifikat bei abgeschlossenem Kurs, rendert diese Komponente jetzt
 * überall nur noch `null` — unabhängig davon, ob die Ausstellung noch
 * läuft oder für Kurs/Mandant deaktiviert ist (siehe `certificates/
 * issue.ts` für die eigentliche Ausstellungslogik, unverändert). Sobald ein
 * Zertifikat tatsächlich existiert, zeigt die Komponente weiterhin die
 * Download-Karte unten.
 */
export async function CertificateBadge({
  tenantId,
  courseId,
}: {
  tenantId: string;
  courseId: string;
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

  if (!certificate) return null;

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
