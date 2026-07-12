import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { publicEnv } from "@/lib/env";
import { DeletionRequestForm } from "./deletion-request-form";
import { PushToggle } from "@/components/pwa/push-toggle";
import { AppShell } from "@/components/learn/app-shell";

type CertificateRow = {
  id: string;
  serial: string;
  issued_at: string;
  pdf_path: string | null;
  course_id: string;
  courses: { title: string } | { title: string }[] | null;
};

type Tab = "allgemein" | "benachrichtigungen";
const TAB_LABELS: Record<Tab, string> = { allgemein: "Allgemein", benachrichtigungen: "Benachrichtigungen" };

function courseTitle(courses: CertificateRow["courses"]): string {
  if (!courses) return "Kurs";
  if (Array.isArray(courses)) return courses[0]?.title ?? "Kurs";
  return courses.title ?? "Kurs";
}

function formatDateDe(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * SPEC 4.1: `/profil` — Name, Passwort, Datenexport, Zertifikate.
 *
 * Design-Block 5 (12.07.2026, Claude-Design-Export "Einstellungen.dc.html")
 * — Restrukturierung: bisher eine einzelne, ungerahmte Seite OHNE AppShell
 * (echte Lücke — die Sidebar verlinkt seit Design-Block 3 bereits auf
 * `/profil` und `/profil?tab=benachrichtigungen`, die Seite selbst hatte
 * aber weder Navigation noch Tab-Unterstützung). Jetzt in AppShell
 * eingebettet + zwei Tabs über `?tab=` (serverseitig, kein Client-State
 * nötig — gleiches Muster wie `?status=` in admin/abgaben/page.tsx).
 *
 * Mockup zeigt DREI Tabs (Allgemein/Benachrichtigungen/Geräte) mit
 * Profilbild-Upload, Telefon/Stadt/Position/"Über mich"-Feldern, granularen
 * Benachrichtigungs-Togglen und einer Geräte-/Sitzungsliste — bewusst NICHT
 * übernommen, da keines dieser Felder ein echtes Datenmodell hat
 * (`profiles` kennt nur `full_name`/`email`, keine `notifications`-Tabelle,
 * kein Zugriff auf Supabase-Auth-Sessions über den normalen Client — exakt
 * dieselbe Begründung wie bereits bei der Sidebar-Benachrichtigungsglocke
 * dokumentiert). Tab "Geräte" deshalb NICHT gebaut, kein leerer Tab ohne
 * Funktion. "Allgemein" bündelt stattdessen alle real existierenden
 * Konto-Funktionen (vorher lose auf der einen Seite): Profildaten, Passwort,
 * Zertifikate, Datenexport, Konto löschen. "Benachrichtigungen" enthält den
 * bereits bestehenden echten Push-Toggle.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab: Tab = rawTab === "benachrichtigungen" ? "benachrichtigungen" : "allgemein";

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

  const { data: isStaff } = tenant ? await supabase.rpc("is_staff", { t: tenant.id }) : { data: false };
  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");

  const { data: certificateRows } = tenant
    ? await supabase
        .from("certificates")
        .select("id, serial, issued_at, pdf_path, course_id, courses(title)")
        .eq("tenant_id", tenant.id)
        .eq("user_id", user.id)
        .order("issued_at", { ascending: false })
    : { data: null };

  // Pending Löschantrag prüfen (Server-Component-Query, RLS
  // `deletion_requests_select` erlaubt "eigene Zeilen" bereits über den
  // normalen Session-Client — kein Admin-Client nötig).
  const { data: pendingDeletionRequest } = tenant
    ? await supabase
        .from("deletion_requests")
        .select("requested_at")
        .eq("tenant_id", tenant.id)
        .eq("user_id", user.id)
        .eq("status", "pending")
        .maybeSingle()
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
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb="Konto · Einstellungen"
      title="Einstellungen"
    >
      <div className="max-w-[720px]">
        {/* Tabs (Design-Block 5, Einstellungen.dc.html) */}
        <div className="mb-[30px] flex gap-1.5 border-b" style={{ borderColor: "#E1E3EF" }}>
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => {
            const active = t === tab;
            return (
              <a
                key={t}
                href={t === "allgemein" ? "/profil" : `/profil?tab=${t}`}
                className="-mb-px px-[18px] py-3 text-[15px] no-underline"
                style={{
                  fontWeight: active ? 700 : 500,
                  color: active ? "#5663AE" : "#66679B",
                  borderBottom: active ? "2px solid #5663AE" : "2px solid transparent",
                }}
              >
                {TAB_LABELS[t]}
              </a>
            );
          })}
        </div>

        <div className="mb-[22px] text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
          Einstellungen &nbsp;›&nbsp; <span style={{ color: "#5663AE" }}>{TAB_LABELS[tab]}</span>
        </div>

        {tab === "allgemein" && (
          <div className="flex flex-col gap-6">
            <div
              className="rounded-2xl border p-[30px]"
              style={{ background: "#fff", borderColor: "#E7E8F2" }}
            >
              <p className="text-base" style={{ color: "#1A1A2E" }}>
                {profile?.full_name || "Kein Name hinterlegt"}
              </p>
              <p className="text-sm" style={{ color: "#66679B" }}>
                {profile?.email ?? user.email}
              </p>
              <p className="mt-4 text-sm" style={{ color: "#66679B" }}>
                Passwort ändern:{" "}
                <a href="/passwort-vergessen" className="font-semibold no-underline">
                  neues Passwort anfordern
                </a>
                .
              </p>
            </div>

            <div
              className="rounded-2xl border p-[30px]"
              style={{ background: "#fff", borderColor: "#E7E8F2" }}
            >
              <h2 className="text-lg font-bold" style={{ color: "#1A1A2E" }}>
                Meine Zertifikate
              </h2>
              {certificates.length === 0 && (
                <p className="mt-2 text-sm" style={{ color: "#66679B" }}>
                  Noch keine Zertifikate ausgestellt.
                </p>
              )}
              <ul className="mt-3 flex flex-col gap-3">
                {certificates.map((cert) => (
                  <li
                    key={cert.id}
                    className="rounded-xl border p-3"
                    style={{ borderColor: "#E7E8F2" }}
                  >
                    <p className="text-base font-medium">{cert.title}</p>
                    <p className="text-xs" style={{ color: "#66679B" }}>
                      Ausgestellt am {new Date(cert.issued_at).toLocaleDateString("de-DE")} —
                      Seriennummer {cert.serial}
                    </p>
                    {cert.downloadUrl ? (
                      <a href={cert.downloadUrl} className="mt-2 inline-block text-sm font-semibold no-underline">
                        Zertifikat herunterladen (PDF)
                      </a>
                    ) : (
                      <p className="mt-2 text-xs" style={{ color: "#66679B" }}>
                        Download aktuell nicht verfügbar.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div
              className="rounded-2xl border p-[30px]"
              style={{ background: "#fff", borderColor: "#E7E8F2" }}
            >
              <h2 className="text-lg font-bold" style={{ color: "#1A1A2E" }}>
                Meine Daten
              </h2>
              <p className="mt-2 text-sm" style={{ color: "#66679B" }}>
                Lade eine strukturierte JSON-Datei mit allen zu dir gespeicherten Daten herunter
                (Art. 15/20 DSGVO).
              </p>
              <a
                href="/profil/export"
                className="mt-2 inline-block text-sm font-semibold no-underline"
                style={{ color: "var(--color-primary)" }}
              >
                Meine Daten exportieren
              </a>
            </div>

            <div
              className="rounded-2xl border p-[30px]"
              style={{ background: "#fff", borderColor: "#E7E8F2" }}
            >
              <h2 className="text-lg font-bold" style={{ color: "#1A1A2E" }}>
                Konto löschen
              </h2>
              {pendingDeletionRequest ? (
                <p className="mt-2 text-sm" style={{ color: "#66679B" }}>
                  Löschantrag vom {formatDateDe(pendingDeletionRequest.requested_at)} eingegangen,
                  wird geprüft.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm" style={{ color: "#66679B" }}>
                    Beantrage die Löschung deines Kontos. Die Löschung selbst erfolgt nach
                    manueller Prüfung (z. B. auf gesetzliche Aufbewahrungspflichten) und ist nicht
                    sofort.
                  </p>
                  <div className="mt-3">
                    <DeletionRequestForm />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "benachrichtigungen" && (
          <div
            className="rounded-2xl border p-[30px]"
            style={{ background: "#fff", borderColor: "#E7E8F2" }}
          >
            <h2 className="text-lg font-bold" style={{ color: "#1A1A2E" }}>
              Kursabschluss
            </h2>
            <p className="mt-2 text-sm" style={{ color: "#66679B" }}>
              Erhalte eine Browser-Benachrichtigung, sobald du einen Kurs vollständig
              abgeschlossen hast.
            </p>
            <div className="mt-3">
              <PushToggle vapidPublicKey={publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
