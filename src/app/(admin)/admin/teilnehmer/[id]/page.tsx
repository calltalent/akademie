import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { checkAdminAccess } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { initialsFor } from "@/lib/format/initials";
import { MembershipRowActions } from "@/components/admin/membership-row-actions";

type CourseRow = { id: string; title: string; slug: string };

/**
 * Teilnehmer-Detailseite (Ziel des „Profil"-Links aus der Liste). Zeigt
 * Profildaten, Rolle/Status/Beitritt, die eingeschriebenen Kurse (echt aus
 * `enrollments`) und die Aktivieren/Deaktivieren-Aktion. Zugriff nur für
 * Inhaber/Administratoren.
 */
export default async function TeilnehmerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("admin.teilnehmer");
  const { id } = await params;
  const access = await checkAdminAccess();
  if (!access.ok) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-base">{t("accessDeniedGeneric")}</p>
      </div>
    );
  }
  const tenantId = access.tenant.id;

  const ROLE_LABELS: Record<string, string> = {
    owner: t("roleOwner"),
    admin: t("roleAdmin"),
    trainer: t("roleTrainer"),
    member: t("roleMember"),
  };

  function statusLabel(status: string): string {
    return status === "active" ? t("statusWordActive") : status === "invited" ? t("statusWordInvited") : t("statusWordDeactivated");
  }
  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("memberships")
    .select("user_id, role, status, created_at, profiles(email, full_name)")
    .eq("tenant_id", tenantId)
    .eq("user_id", id)
    .maybeSingle();

  if (!membership) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/admin/teilnehmer" className="text-sm font-semibold no-underline" style={{ color: "#66679B" }}>
          {t("backLink")}
        </Link>
        <p className="text-base">{t("notFound")}</p>
      </div>
    );
  }

  const profile = Array.isArray(membership.profiles) ? membership.profiles[0] : membership.profiles;
  const email = profile?.email ?? "";
  const fullName = profile?.full_name ?? null;

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", id);
  const courseIds = (enrollments ?? []).map((e) => e.course_id as string);
  const { data: courses } = courseIds.length
    ? await supabase.from("courses").select("id, title, slug").in("id", courseIds)
    : { data: [] as CourseRow[] };
  const courseList = (courses ?? []) as CourseRow[];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/teilnehmer" className="text-sm font-semibold no-underline" style={{ color: "#66679B" }}>
        {t("backLink")}
      </Link>

      {/* Profilkarte */}
      <div className="rounded-[14px] border bg-white p-[30px]" style={{ borderColor: "#E7E8F2" }}>
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-16 w-16 flex-none items-center justify-center rounded-[16px] text-xl font-bold"
            style={{ background: "#3E3F66", color: "#F7EED4" }}
          >
            {initialsFor(fullName, email)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold" style={{ color: "#1A1A2E" }}>
              {fullName || email || id}
            </h1>
            <p className="text-sm" style={{ color: "#66679B" }}>
              {email}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Meta label={t("roleLabel")} value={ROLE_LABELS[membership.role] ?? membership.role} />
          <Meta label={t("statusLabel")} value={statusLabel(membership.status)} />
          <Meta label={t("joinedLabel")} value={formatRelativeTime(new Date(membership.created_at))} />
        </div>

        {membership.role !== "owner" && (
          <div className="mt-6 border-t pt-5" style={{ borderColor: "#EEF0F7" }}>
            <MembershipRowActions
              userId={membership.user_id}
              status={membership.status}
              name={fullName ?? email}
              email={email}
            />
          </div>
        )}
      </div>

      {/* Eingeschriebene Kurse */}
      <div className="rounded-[14px] border bg-white p-[30px]" style={{ borderColor: "#E7E8F2" }}>
        <h2 className="text-lg font-bold" style={{ color: "#1A1A2E" }}>
          {t("enrolledCoursesHeading", { count: courseList.length })}
        </h2>
        {courseList.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: "#66679B" }}>
            {t("noEnrollments")}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {courseList.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/kurse/${c.id}`} prefetch={false} className="text-base font-semibold no-underline">
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
        {label}
      </div>
      <div className="mt-0.5 text-base font-medium" style={{ color: "#1A1A2E" }}>
        {value}
      </div>
    </div>
  );
}
