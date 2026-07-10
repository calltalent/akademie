import { checkAdminAccess } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { CsvImportForm } from "@/components/admin/csv-import-form";
import { InviteUserForm } from "@/components/admin/invite-user-form";
import { MembershipRowActions } from "@/components/admin/membership-row-actions";

const ROLE_LABELS: Record<string, string> = {
  owner: "Inhaber",
  admin: "Administrator",
  trainer: "Trainer",
  member: "Mitglied",
};

/**
 * Strenger als /admin/kurse & Co.: memberships_admin_write erlaubt
 * Mitgliedschafts-Schreibzugriffe NUR owner/admin (nicht trainer) —
 * daher eigenes Gate statt des layout-weiten Staff-Checks.
 */
export default async function AdminNutzerPage() {
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

  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("memberships")
    .select("user_id, role, status, created_at, profiles(email, full_name)")
    .eq("tenant_id", access.tenant.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Nutzerverwaltung</h1>

      <div className="grid gap-6 sm:grid-cols-2">
        <InviteUserForm />
        <CsvImportForm />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">
          Mitglieder ({memberships?.length ?? 0})
        </h2>
        <ul className="flex flex-col gap-2">
          {(memberships ?? []).map((m) => {
            const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
            return (
              <li
                key={m.user_id}
                className="flex items-center justify-between rounded-md border px-4 py-3 text-base"
                style={{ borderRadius: "var(--radius)" }}
              >
                <div className="flex flex-col">
                  <span>{profile?.full_name || profile?.email || m.user_id}</span>
                  <span className="text-sm text-gray-500">
                    {profile?.email} — {ROLE_LABELS[m.role] ?? m.role} —{" "}
                    {m.status === "active" ? "aktiv" : m.status === "invited" ? "eingeladen" : "deaktiviert"}
                  </span>
                </div>
                {m.role !== "owner" && (
                  <MembershipRowActions userId={m.user_id} status={m.status} />
                )}
              </li>
            );
          })}
          {(!memberships || memberships.length === 0) && (
            <p className="text-base text-gray-500">Noch keine Mitglieder.</p>
          )}
        </ul>
      </div>
    </div>
  );
}
