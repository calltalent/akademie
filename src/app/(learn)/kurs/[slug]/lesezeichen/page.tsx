import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Check, Play } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { AppShell } from "@/components/learn/app-shell";
import { CourseHeroHeader } from "@/components/learn/course-hero-header";
import { PromoCards } from "@/components/learn/promo-cards";
import { getVideoThumbnailUrl } from "@/lib/bunny/client";

const ACCENT = "#5663AE";

/**
 * Kursinterne Lesezeichen-Sammlung (Josips Auftrag, 26.07.2026: "der Button
 * für Lesezeichen in einem Kurs soll eine eigene Lesezeichen-Sammlung, die
 * nur aus Lektionen aus diesem Kurs sind, anzeigen" — nach Baulig-Vorbild,
 * siehe Screenshot dort: Tab "Lesezeichen" INNERHALB eines Kurses filtert
 * auf genau diesen Kurs. Der Lesezeichen-Link links in der Sidebar
 * (`/lesezeichen`, siehe app/lesezeichen/page.tsx) zeigt bewusst weiterhin
 * ALLE Lesezeichen aus allen Kursen — unverändert.
 *
 * Gleiches `embeddedOne()`-Bugfix-Muster wie app/lesezeichen/page.tsx
 * (BUGFIX 23.07.2026): postgrest-js typisiert eingebettete n:1-Relationen
 * generisch als Array, obwohl zur Laufzeit ein einzelnes Objekt zurückkommt.
 */
function embeddedOne<T>(value: T[] | T | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function CourseLesezeichenPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("learn.bookmarksCourse");
  const tShared = await getTranslations("learn.shared");
  const tNotFound = await getTranslations("learn.notFound");
  const tenant = await getTenant();
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
    .select("id, title, description, cover_url")
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

  const { data: modules } = await supabase
    .from("modules")
    .select("id")
    .eq("course_id", course.id)
    .eq("tenant_id", tenant.id);
  const moduleIds = (modules ?? []).map((m) => m.id);

  const { data: bookmarks } = await supabase
    .from("bookmarks")
    .select("id, created_at, lesson_id, lessons(id, title, video_duration_s, video_bunny_id, module_id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const courseBookmarks = (bookmarks ?? []).filter((b) => {
    const lesson = embeddedOne(b.lessons);
    return lesson ? moduleIds.includes(lesson.module_id as string) : false;
  });

  const lessonIds = courseBookmarks
    .map((b) => embeddedOne(b.lessons)?.id)
    .filter((id): id is string => Boolean(id));

  const { data: progressRows } = await supabase
    .from("progress")
    .select("lesson_id, status")
    .eq("user_id", user.id)
    .in("lesson_id", lessonIds);
  const completedLessonIds = new Set(
    (progressRows ?? []).filter((p) => p.status === "completed").map((p) => p.lesson_id),
  );

  type BookmarkedLesson = {
    bookmarkId: string;
    lessonId: string;
    title: string;
    thumbnailUrl: string | null;
    completed: boolean;
  };
  const lessons: BookmarkedLesson[] = courseBookmarks
    .map((b) => {
      const lesson = embeddedOne(b.lessons);
      if (!lesson) return null;
      return {
        bookmarkId: b.id,
        lessonId: lesson.id as string,
        title: lesson.title as string,
        thumbnailUrl: lesson.video_bunny_id ? getVideoThumbnailUrl(lesson.video_bunny_id as string) : null,
        completed: completedLessonIds.has(lesson.id as string),
      };
    })
    .filter((l): l is BookmarkedLesson => l !== null);

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
            activeTab="lesezeichen"
          />

          <div className="mb-3.5 flex items-center gap-2.5">
            <span className="h-[22px] w-1 rounded-[3px]" style={{ background: ACCENT }} />
            <h2 className="m-0 text-xl font-extrabold">{t("heading")}</h2>
          </div>

          {lessons.length === 0 ? (
            <div
              className="rounded-[14px] border bg-white px-6 py-10 text-center text-sm"
              style={{ borderColor: "#E7E8F2", color: "#A9AAC4" }}
            >
              {t("empty")}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-[14px] border bg-white p-3" style={{ borderColor: "#E7E8F2" }}>
              {lessons.map((item) => (
                <a
                  key={item.bookmarkId}
                  href={`/kurs/${slug}/l/${item.lessonId}`}
                  className="flex items-center gap-3.5 rounded-xl px-2.5 py-2 no-underline"
                  style={{ background: "transparent" }}
                >
                  <span
                    className="relative flex h-11 w-[64px] flex-none items-center justify-center overflow-hidden rounded-[8px]"
                    style={
                      item.thumbnailUrl
                        ? undefined
                        : {
                            backgroundColor: "#DFE2F4",
                            backgroundImage:
                              "repeating-linear-gradient(45deg,#DFE2F4 0 9px, rgba(255,255,255,.55) 9px 18px)",
                          }
                    }
                    aria-hidden="true"
                  >
                    {item.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- Bunny-CDN-URL, kein next/image-Loader konfiguriert
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover object-center"
                      />
                    )}
                    <span
                      className="relative flex h-5 w-5 items-center justify-center rounded-full"
                      style={{ background: ACCENT }}
                    >
                      <Play size={9} color="#fff" fill="#fff" />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-bold" style={{ color: "#1A1A2E" }}>
                    {item.title}
                  </span>
                  <span
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-full"
                    style={{ background: item.completed ? "#E4F5EC" : "#F0F1F8" }}
                    aria-hidden="true"
                  >
                    <Check size={13} strokeWidth={3} color={item.completed ? "#3CA36A" : "#C6C8DC"} />
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Rechte Spalte — admin-verwaltete Positionen, gleiche Optik wie die
            Übersichts-/Informationsseite. */}
        <div className="flex flex-col gap-5">
          <PromoCards tenantId={tenant.id} />
        </div>
      </div>
    </AppShell>
  );
}
