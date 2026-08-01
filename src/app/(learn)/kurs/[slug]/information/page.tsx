import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Check, User as UserIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { AppShell } from "@/components/learn/app-shell";
import { CourseHeroHeader } from "@/components/learn/course-hero-header";
import { PromoCards } from "@/components/learn/promo-cards";

const NAVY = "#3E3F66";
const ACCENT = "#5663AE";

/**
 * Information-Tab der Kurs-Lernansicht (Josips Auftrag, 24.07.2026 —
 * Informations-Tab für Kurse nach Baulig-Vorbild, Migration
 * 20260724130000_course_information.sql). Baulig Akademie zeigt in der
 * Kursübersicht einen dritten Tab „Information" mit Beschreibung, Kursziele
 * (Checkmark-Liste) und Autoren (Bild, Name, Rolle, Bio) — dieser Tab war bei
 * Calltalent bisher bewusst weggelassen, weil er auf keine echten Daten
 * zeigte. Jetzt: echte Kursziele + ein echtes Autoren-/Trainerprofil.
 *
 * Gleiches Auth-/Tenant-Boilerplate wie die Übersichtsseite
 * (`kurs/[slug]/page.tsx`) — beide Seiten teilen sich den Hero-/Tabs-Block
 * über `CourseHeroHeader` (`activeTab="information"` hier statt
 * `"overview"`).
 *
 * Ehrliche Leerzustände (DESIGN-MASTERPROMPT.md §8.1, kein erfundener
 * Inhalt): fehlende Beschreibung/Kursziele/Autor zeigen jeweils einen
 * eigenen Hinweistext statt einer leeren oder erfundenen Karte.
 */
export default async function CourseInformationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("learn.information");
  const tShared = await getTranslations("learn.shared");
  const tNotFound = await getTranslations("learn.notFound");
  const tenant = await getTenant();
  // Wie in kurs/[slug]/page.tsx: RSC wertet die Seite auch aus, wenn ein
  // übergeordneter Gate greift — defensiv statt auf tenant!.id zu laufen.
  if (!tenant) redirect("/login");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isStaff } = await supabase.rpc("is_staff", { t: tenant.id });
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : tShared("fallbackUserName"));

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description, cover_url, goals, author_id")
    .eq("tenant_id", tenant.id)
    .eq("slug", slug)
    .maybeSingle();

  if (!course) {
    return (
      <AppShell
        isStaff={isStaff ?? false}
        userName={displayName}
        userEmail={user.email ?? undefined}
        breadcrumb={tShared("myCoursesBreadcrumb")}
        title={tNotFound("course.title")}
      >
        <p className="text-base" style={{ color: "#66679B" }}>
          {tNotFound("course.body")}
        </p>
      </AppShell>
    );
  }

  let trainer: { name: string; role: string | null; bio: string | null; image_url: string | null } | null = null;
  if (course.author_id) {
    const { data: trainerRow } = await supabase
      .from("trainers")
      .select("name, role, bio, image_url")
      .eq("id", course.author_id)
      .maybeSingle();
    trainer = trainerRow ?? null;
  }

  const goals = Array.isArray(course.goals) ? (course.goals as string[]) : [];

  return (
    <AppShell
      isStaff={isStaff ?? false}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb={t("breadcrumb")}
      title={course.title}
      hideTitle
    >
      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[1fr_300px]">
        {/* Linke Spalte */}
        <div className="min-w-0">
          <CourseHeroHeader
            tenantId={tenant.id}
            userId={user.id}
            course={course}
            slug={slug}
            activeTab="information"
          />

          <div className="flex flex-col gap-4">
            {/* Beschreibung */}
            <section className="rounded-[14px] border bg-white p-[22px]" style={{ borderColor: "#E7E8F2" }}>
              <h2 className="mb-2 text-lg font-extrabold" style={{ color: NAVY }}>
                {t("descriptionHeading")}
              </h2>
              {course.description ? (
                <p className="m-0 whitespace-pre-line text-[15px]" style={{ color: "#66679B" }}>
                  {course.description}
                </p>
              ) : (
                <p className="m-0 text-[15px]" style={{ color: "#66679B" }}>
                  {t("descriptionEmpty")}
                </p>
              )}
            </section>

            {/* Kursziele */}
            <section className="rounded-[14px] border bg-white p-[22px]" style={{ borderColor: "#E7E8F2" }}>
              <h2 className="mb-2 text-lg font-extrabold" style={{ color: NAVY }}>
                {t("goalsHeading")}
              </h2>
              {goals.length > 0 ? (
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {goals.map((goal, index) => (
                    <li key={index} className="flex items-start gap-2.5 text-[15px]" style={{ color: "#3E3F66" }}>
                      <span
                        className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full"
                        style={{ background: "#DDF3E4" }}
                        aria-hidden="true"
                      >
                        <Check size={13} style={{ color: "#3E8F5C" }} strokeWidth={3} />
                      </span>
                      {goal}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-[15px]" style={{ color: "#66679B" }}>
                  {t("goalsEmpty")}
                </p>
              )}
            </section>

            {/* Autoren */}
            <section className="rounded-[14px] border bg-white p-[22px]" style={{ borderColor: "#E7E8F2" }}>
              <h2 className="mb-2 text-lg font-extrabold" style={{ color: NAVY }}>
                {t("authorsHeading")}
              </h2>
              {trainer ? (
                <div className="flex items-start gap-4">
                  {trainer.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
                    <img
                      src={trainer.image_url}
                      alt=""
                      className="h-16 w-16 flex-none rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className="flex h-16 w-16 flex-none items-center justify-center rounded-full"
                      style={{ background: "#EDEEF7", color: ACCENT }}
                      aria-hidden="true"
                    >
                      <UserIcon size={26} />
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="text-base font-bold" style={{ color: "#1A1A2E" }}>
                      {trainer.name}
                    </div>
                    {trainer.role && (
                      <div className="mt-0.5 text-sm" style={{ color: "#66679B" }}>
                        {trainer.role}
                      </div>
                    )}
                    {trainer.bio && (
                      <p className="mt-2 whitespace-pre-line text-[15px]" style={{ color: "#3E3F66" }}>
                        {trainer.bio}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="m-0 text-[15px]" style={{ color: "#66679B" }}>
                  {t("authorsEmpty")}
                </p>
              )}
            </section>
          </div>
        </div>

        {/* Rechte Spalte — admin-verwaltete Positionen, gleiche Optik wie die
            Übersichtsseite. */}
        <div className="flex flex-col gap-5">
          <PromoCards tenantId={tenant.id} />
        </div>
      </div>
    </AppShell>
  );
}
