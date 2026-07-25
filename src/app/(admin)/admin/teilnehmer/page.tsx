import { checkAdminAccess } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { initialsFor } from "@/lib/format/initials";
import { TeilnehmerListe, type TeilnehmerRow } from "./teilnehmer-liste";

/**
 * Teilnehmer-Verwaltung (Referenz AdminTeilnehmer.dc.html). Zog von
 * /admin/nutzer hierher um (/admin/nutzer leitet weiter). Die Suche ist jetzt
 * client-seitig (Live-Filter in teilnehmer-liste.tsx). „Kurse" = echte
 * enrollments-Zahl je Nutzer, „Beigetreten" = Mitgliedschafts-Datum.
 * „Einladen" verschickt real per Resend (inviteSingleUser → sendEmail).
 * „Profil" führt auf die Detailseite /admin/teilnehmer/[id]. Zugriff nur für
 * Inhaber/Administratoren (checkAdminAccess, strenger als das Staff-Gate des
 * /admin-Layouts), Daten zusätzlich per RLS.
 */
export default async function TeilnehmerPage() {
  const access = await checkAdminAccess();
  if (!access.ok) {
    const text =
      access.reason === "not-admin"
        ? "Kein Zugriff — die Teilnehmerverwaltung ist nur für Inhaber und Administratoren."
        : access.reason === "not-authenticated"
          ? "Bitte zuerst anmelden."
          : "Kein Mandant zu diesem Host gefunden.";
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-base">{text}</p>
      </div>
    );
  }

  const tenantId = access.tenant.id;
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("user_id, role, status, created_at, profiles(email, full_name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  // role/status kommen jetzt mit an die Liste (25.07.2026, Kennzahlenzeile +
  // Status-Spalte, gleiches Prinzip wie beim Kurs-Redesign) — vorher nur auf
  // der Detailseite sichtbar, man musste jeden Teilnehmer einzeln oeffnen,
  // um z. B. offene Einladungen zu finden.

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("user_id")
    .eq("tenant_id", tenantId);

  const courseCountByUser = new Map<string, number>();
  for (const e of enrollments ?? []) {
    courseCountByUser.set(e.user_id, (courseCountByUser.get(e.user_id) ?? 0) + 1);
  }

  const rows: TeilnehmerRow[] = (memberships ?? []).map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    const email = profile?.email ?? "";
    const fullName = profile?.full_name ?? null;
    return {
      userId: m.user_id,
      fullName,
      email,
      status: m.status,
      courseCount: courseCountByUser.get(m.user_id) ?? 0,
      joined: formatRelativeTime(new Date(m.created_at)),
      initials: initialsFor(fullName, email),
    };
  });

  return <TeilnehmerListe rows={rows} />;
}
