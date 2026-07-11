import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";

type CertificateRow = {
  id: string;
  serial: string;
  issued_at: string;
  pdf_path: string | null;
  course_id: string;
  courses: { title: string } | { title: string }[] | null;
};

function courseTitle(courses: CertificateRow["courses"]): string {
  if (!courses) return "Kurs";
  if (Array.isArray(courses)) return courses[0]?.title ?? "Kurs";
  return courses.title ?? "Kurs";
}

/**
 * SPEC 4.1: `/profil` — Name, Passwort, Datenexport, Zertifikate.
 * Route existierte vor diesem Block noch nicht (kein vorheriger Phase-1/2-
 * Block hat sie angelegt) — hier neu ergänzt, Fokus liegt gemäß Auftrag auf
 * der Zertifikate-Liste. Passwort-Änderung und Datenexport sind in Phase 2
 * bewusst nur als Hinweis/Platzhalter vorhanden (kein eigenständiges
 * Formular in diesem Block) — Datenexport ist ohnehin ein DSGVO-Thema für
 * Phase 4 (siehe CLAUDE.md Phasenplan).
 */
export default async function ProfilePage() {
  const tenant = await getTenant();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const { data: certificateRows } = tenant
    ? await supabase
        .from("certificates")
        .select("id, serial, issued_at, pdf_path, course_id, courses(title)")
        .eq("tenant_id", tenant.id)
        .eq("user_id", user.id)
        .order("issued_at", { ascending: false })
    : { data: null };

  const certificates = await Promise.all(
    ((certificateRows ?? []) as CertificateRow[]).map(async (cert) => {
      let downloadUrl: string | null = null;
      if (cert.pdf_path) {
        const { data } = await supabase.storage
          .from("certificates")
          .createSignedUrl(cert.pdf_path, 60 * 10);
        downloadUrl = data?.signedUrl ?? null;
      }
      return { ...cert, title: courseTitle(cert.courses), downloadUrl };
    }),
  );

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
      <a href="/" className="text-sm underline">
        ← Zurück
      </a>

      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--color-primary)" }}>
          Mein Profil
        </h1>
        <p className="mt-3 text-base">{profile?.full_name || "Kein Name hinterlegt"}</p>
        <p className="text-sm text-gray-500">{profile?.email ?? user.email}</p>
        <p className="mt-4 text-sm text-gray-600">
          Passwort ändern: über „Passwort vergessen" auf der{" "}
          <a href="/login" className="underline">
            Login-Seite
          </a>{" "}
          anfordern (eigenständige Passwort-Änderungsseite folgt in einem späteren Block).
        </p>
      </div>

      <div>
        <h2 className="text-lg font-medium">Meine Zertifikate</h2>
        {certificates.length === 0 && (
          <p className="mt-2 text-sm text-gray-500">Noch keine Zertifikate ausgestellt.</p>
        )}
        <ul className="mt-3 flex flex-col gap-3">
          {certificates.map((cert) => (
            <li key={cert.id} className="rounded-md border p-3" style={{ borderRadius: "var(--radius)" }}>
              <p className="text-base font-medium">{cert.title}</p>
              <p className="text-xs text-gray-500">
                Ausgestellt am {new Date(cert.issued_at).toLocaleDateString("de-DE")} — Seriennummer{" "}
                {cert.serial}
              </p>
              {cert.downloadUrl ? (
                <a href={cert.downloadUrl} className="mt-2 inline-block text-sm underline">
                  Zertifikat herunterladen (PDF)
                </a>
              ) : (
                <p className="mt-2 text-xs text-gray-500">Download aktuell nicht verfügbar.</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
