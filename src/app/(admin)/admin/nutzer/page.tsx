import { checkAdminAccess } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { InviteUserDialog } from "@/components/admin/invite-user-dialog";
import { MembershipRowActions } from "@/components/admin/membership-row-actions";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { initialsFor } from "@/lib/format/initials";

const ROLE_LABELS: Record<string, string> = {
  owner: "Inhaber",
  admin: "Administrator",
  trainer: "Trainer",
  member: "Mitglied",
};

/**
 * Design-Block 6 (13.07.2026, Claude-Design-Export Teil 3,
 * AdminTeilnehmer.dc.html). Ersetzt die bisherige schlichte Liste ohne
 * Kennzahlen/Suche/Avatare.
 *
 * "Kurse" je Nutzer = echte Zeilenanzahl aus `enrollments` (gleiche Quelle
 * wie AdminKurse "Teilnehmer", siehe dortige Begründung) — NICHT erfunden.
 *
 * Suche (Export zeigt nur ein dekoratives Suchfeld ohne Funktion) ist hier
 * real verdrahtet über `?q=` (serverseitiger Filter auf Name/E-Mail,
 * gleiches Muster wie die Status-Filter in AdminKurse/AdminAbgaben).
 *
 * "Einladen" bündelt beide echten Einlade-Wege (Einzelperson + CSV-Bulk) in
 * einem Modal, siehe invite-user-dialog.tsx.
 *
 * Rollen (Inhaber/Administrator/Trainer/Mitglied) und Aktivieren/
 * Deaktivieren (MembershipRowActions) bleiben erhalten, obwohl der Export
 * dafür keine UI zeigt (nur einen "Profil"-Link ohne Zielseite) — echte,
 * bereits funktionierende Verwaltungsfunktionen dürfen nicht verschwinden.
 * "Profil" verlinkt daher NICHT auf eine nicht existierende Detailseite,
 * sondern zeigt stattdessen Rolle + Status + Aktivieren/Deaktivieren direkt
 * in der Zeile (wie in der Vorversion), statt einen toten Link vorzutäuschen.
 */
export default async function AdminNutzerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const access = await checkAdminAccess();

  if (!access.ok) {
    const text =
      access.reason === "not-admin"
        ? "Kein Zugriff — die Nutzerverwaltung ist nur für Inhaber und Administratoren."
        : access.reason === "not-authenticated"
          ? "Bitte zuerst anmelden."
          : "Kein Mandant zu diesem Host gefunden.";
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-base">{text}</p>
      </div>
    );
  }

  const { q } = await searchParams;
  const tenantId = access.tenant.id;
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("user_id, role, status, created_at, profiles(email, full_name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("user_id")
    .eq("tenant_id", tenantId);

  const courseCountByUser = new Map<string, number>();
  for (const e of enrollments ?? []) {
    courseCountByUser.set(e.user_id, (courseCountByUser.get(e.user_id) ?? 0) + 1);
  }

  const rows = (memberships ?? []).map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return {
      userId: m.user_id,
      role: m.role,
      status: m.status,
      createdAt: m.created_at,
      email: profile?.email ?? "",
      fullName: profile?.full_name ?? null,
      courseCount: courseCountByUser.get(m.user_id) ?? 0,
    };
  });

  const query = (q ?? "").trim().toLowerCase();
  const visibleRows = query
    ? rows.filter(
        (r) =>
          r.email.toLowerCase().includes(query) ||
          (r.fullName ?? "").toLowerCase().includes(query),
      )
    : rows;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            Nutzer · Teilnehmer
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            Teilnehmer
          </h1>
        </div>
        <form method="get" className="flex-none" style={{ width: 280 }}>
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Teilnehmer suchen …"
            className="w-full rounded-[11px] border px-[14px] py-[10px] text-sm"
            style={{ borderColor: "#E7E8F2" }}
          />
        </form>
        <InviteUserDialog />
      </header>

      <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
        <div
          className="grid gap-0 px-[26px] pb-3 pt-[18px] text-[13px] font-bold"
          style={{
            gridTemplateColumns: "2fr 1.4fr 1fr 1fr 0.6fr",
            color: "#A9AAC4",
            borderBottom: "1px solid #EEF0F7",
          }}
        >
          <div>Name</div>
          <div>E-Mail</div>
          <div>Kurse</div>
          <div>Beigetreten</div>
          <div />
        </div>
        {visibleRows.length === 0 ? (
          <p className="px-[26px] py-6 text-sm" style={{ color: "#A9AAC4" }}>
            {query ? "Keine Treffer für diese Suche." : "Noch keine Mitglieder."}
          </p>
        ) : (
          visibleRows.map((r) => (
            <div
              key={r.userId}
              className="grid items-center gap-0 px-[26px] py-[15px] text-[15px]"
              style={{ gridTemplateColumns: "2fr 1.4fr 1fr 1fr 0.6fr", borderBottom: "1px solid #F4F5FA" }}
            >
              <div className="flex items-center gap-3.5">
                <span
                  aria-hidden="true"
                  className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] text-sm font-bold"
                  style={{ background: "#3E3F66", color: "#F7EED4" }}
                >
                  {initialsFor(r.fullName, r.email)}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{r.fullName || r.email || r.userId}</div>
                  <div className="text-xs" style={{ color: "#A9AAC4" }}>
                    {ROLE_LABELS[r.role] ?? r.role}
                    {" · "}
                    {r.status === "active" ? "aktiv" : r.status === "invited" ? "eingeladen" : "deaktiviert"}
                  </div>
                </div>
              </div>
              <div className="truncate text-sm" style={{ color: "#66679B" }}>
                {r.email}
              </div>
              <div style={{ color: "#3E3F66" }}>{r.courseCount}</div>
              <div className="text-sm" style={{ color: "#66679B" }}>
                {formatRelativeTime(new Date(r.createdAt))}
              </div>
              <div>{r.role !== "owner" && <MembershipRowActions userId={r.userId} status={r.status} />}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
