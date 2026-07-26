import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { AppShell } from "@/components/learn/app-shell";
import { getVideoThumbnailUrl } from "@/lib/bunny/client";
import { BookmarksCourseList } from "@/components/learn/bookmarks-course-list";

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
 *
 * NACHTRAG (26.07.2026, Josips Auftrag "Lesezeichen für alle Kurse ähnlich
 * wie bei Baulig anordnen"): die Pro-Kurs-Karten sind jetzt ein Akkordeon
 * (Titel + Anzahl "N Lesezeichen" eingeklappt, Lektionsliste erst nach
 * Klick sichtbar) statt immer offener Listen — Rendering dafür in die
 * Client-Komponente `BookmarksCourseList` ausgelagert, die Datenermittlung
 * (Gruppierung nach Kurs) bleibt unverändert hier im Server Component.
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
        <BookmarksCourseList groups={courseGroups} />
      )}
    </AppShell>
  );
}
