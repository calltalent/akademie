import { redirect } from "next/navigation";
import { Check, Play } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { AppShell } from "@/components/learn/app-shell";
import { getVideoThumbnailUrl } from "@/lib/bunny/client";

/**
 * BUGFIX (23.07.2026, Josips Fund: "in Lesezeichen gespeichert, erscheint
 * aber nicht in der Lesezeichen-Liste"). Per Service-Role-Direktabfrage
 * gegen die Live-DB bestätigt: Der Bookmark-Datensatz existierte korrekt,
 * `lessons(...)` kam als EINZELNES OBJEKT zurück — nicht als Array. Die
 * bisherige Annahme (`b.lessons?.[0]`, Kommentar unten im alten Code)
 * ging vom Gegenteil aus: postgrest-js' eingebaute Typinferenz (ohne
 * generierte Supabase-Types in diesem Projekt) typisiert JEDE eingebettete
 * Relation generisch als Array, unabhängig von der tatsächlichen n:1-
 * Kardinalität der FK-Beziehung (bookmarks.lesson_id -> lessons.id, genau
 * eine Zeile) — TYP und LAUFZEITWERT liefen hier auseinander. `[0]` auf
 * einem echten Objekt ist `undefined`, dadurch wurde JEDES Lesezeichen
 * lautlos herausgefiltert (`if (!lesson) return null`).
 *
 * `embeddedOne()` behandelt defensiv BEIDE Formen (Array ODER Einzelobjekt)
 * — sicher gegen genau diese Klasse Bug, falls sich das Laufzeitverhalten
 * je nach Supabase-Version/Query wieder ändert.
 */
function embeddedOne<T>(value: T[] | T | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const ACCENT = "#5663AE";

/**
 * Design-Update (23.07.2026, Josips Auftrag): Lesezeichen jetzt nach Kurs
 * gruppiert statt einer flachen Liste — je Kurs eine Karte mit Titelbild,
 * Titel, Beschreibung (courses.description/cover_url, bislang ungenutzt)
 * und einer Fortschrittszahl ("X von Y erledigt", bezogen auf die
 * gemerkten Lektionen DIESES Kurses — nicht den gesamten Kurs, das ist die
 * fürs Lesezeichen relevante Zahl). Darunter jede gemerkte Lektion mit
 * echtem Bunny-Vorschaubild (bisher nur eine Platzhalterfläche) und
 * Erledigt-Häkchen (gleiche Optik wie die Lektionsliste auf der
 * Modul-Detailseite, kurs/[slug]/m/[moduleId]/page.tsx).
 */
export default async function LesezeichenPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenant = await getTenant();
  if (!tenant) redirect("/login");

  const { data: bookmarks } = await supabase
    .from("bookmarks")
    .select("id, created_at, lesson_id, lessons(id, title, video_duration_s, video_bunny_id, module_id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const bookmarkedLessonIds = (bookmarks ?? [])
    .map((b) => embeddedOne(b.lessons)?.id)
    .filter((id): id is string => Boolean(id));

  const { data: modules } = await supabase
    .from("modules")
    .select("id, course_id, courses(id, slug, title, description, cover_url)")
    .in(
      "id",
      (bookmarks ?? [])
        .map((b) => embeddedOne(b.lessons)?.module_id)
        .filter((id): id is string => Boolean(id)),
    );

  const { data: progressRows } = await supabase
    .from("progress")
    .select("lesson_id, status")
    .eq("user_id", user.id)
    .in("lesson_id", bookmarkedLessonIds);
  const completedLessonIds = new Set(
    (progressRows ?? []).filter((p) => p.status === "completed").map((p) => p.lesson_id),
  );

  const { data: isStaff } = await supabase.rpc("is_staff", { t: tenant.id });
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");

  type BookmarkedLesson = {
    bookmarkId: string;
    lessonId: string;
    title: string;
    thumbnailUrl: string | null;
    completed: boolean;
  };
  type CourseGroup = {
    courseId: string;
    courseTitle: string;
    courseSlug: string;
    courseDescription: string | null;
    courseCoverUrl: string | null;
    lessons: BookmarkedLesson[];
  };

  const groups = new Map<string, CourseGroup>();
  for (const b of bookmarks ?? []) {
    const lesson = embeddedOne(b.lessons);
    if (!lesson) continue;
    const mod = (modules ?? []).find((m) => m.id === lesson.module_id);
    const course = embeddedOne(mod?.courses);
    if (!course) continue;

    let group = groups.get(course.id);
    if (!group) {
      group = {
        courseId: course.id,
        courseTitle: course.title as string,
        courseSlug: course.slug as string,
        courseDescription: (course.description as string | null) ?? null,
        courseCoverUrl: (course.cover_url as string | null) ?? null,
        lessons: [],
      };
      groups.set(course.id, group);
    }
    group.lessons.push({
      bookmarkId: b.id,
      lessonId: lesson.id,
      title: lesson.title as string,
      thumbnailUrl: lesson.video_bunny_id ? getVideoThumbnailUrl(lesson.video_bunny_id as string) : null,
      completed: completedLessonIds.has(lesson.id),
    });
  }
  const courseGroups = Array.from(groups.values());

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb="Lernen · Lesezeichen"
      title="Lesezeichen"
    >
      <p className="mb-6 text-base" style={{ color: "#66679B" }}>
        Deine markierten Lektionen — schnell zurück zu dem, was zählt.
      </p>

      {courseGroups.length === 0 ? (
        <div
          className="rounded-2xl border bg-white px-6 py-10 text-center text-sm"
          style={{ borderColor: "#E7E8F2", color: "#A9AAC4" }}
        >
          Noch keine Lesezeichen. Markiere eine Lektion über den „Lesezeichen&quot;-Button im Kurs.
        </div>
      ) : (
        <div className="flex max-w-[820px] flex-col gap-5">
          {courseGroups.map((group) => {
            const doneCount = group.lessons.filter((l) => l.completed).length;
            return (
              <div
                key={group.courseId}
                className="overflow-hidden rounded-2xl border bg-white"
                style={{ borderColor: "#E7E8F2" }}
              >
                <div className="flex items-center gap-4" style={{ borderBottom: "1px solid #EEF0F7", padding: "18px 20px" }}>
                  {group.courseCoverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
                    <img
                      src={group.courseCoverUrl}
                      alt=""
                      className="h-14 w-14 flex-none rounded-xl object-cover"
                    />
                  ) : (
                    <span
                      className="h-14 w-14 flex-none rounded-xl"
                      style={{ background: "#DFE2F4" }}
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/kurs/${group.courseSlug}`}
                      className="text-base font-extrabold no-underline"
                      style={{ color: "#1A1A2E" }}
                    >
                      {group.courseTitle}
                    </a>
                    {group.courseDescription && (
                      <p className="mt-0.5 truncate text-sm" style={{ color: "#66679B" }}>
                        {group.courseDescription}
                      </p>
                    )}
                  </div>
                  <span
                    className="flex-none rounded-[8px] px-2.5 py-1 text-xs font-bold"
                    style={{
                      color: doneCount === group.lessons.length ? "#1F8A5B" : ACCENT,
                      background: doneCount === group.lessons.length ? "#E3F2EA" : "#EAEBF7",
                    }}
                  >
                    {doneCount} von {group.lessons.length} erledigt
                  </span>
                </div>

                <div className="flex flex-col gap-1.5 p-3">
                  {group.lessons.map((item) => (
                    <a
                      key={item.bookmarkId}
                      href={`/kurs/${group.courseSlug}/l/${item.lessonId}`}
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
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
