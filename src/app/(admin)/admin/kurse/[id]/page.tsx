import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { CourseEditorSteps } from "@/components/admin/course-editor-steps";
import { blocksSchema, type Block } from "@/lib/courses/schema";
import { getVideoThumbnailUrl } from "@/lib/bunny/client";

/**
 * Josips Auftrag (23.07.2026): direkt nach dem Hochladen eines Video- oder
 * Bild-Blocks soll die Lektion links im Baum ein Vorschaubild zeigen, ohne
 * dass man erst hineinklicken muss. `saveLessonBlocks()` (courses/actions.ts)
 * ruft nach jedem Autosave bereits `revalidatePath(/admin/kurse/${courseId})`
 * — diese Server Component bekommt die frischen `blocks` also automatisch,
 * ohne zusätzliche Polling-Infrastruktur.
 *
 * Nimmt den ERSTEN video- ODER image-Block der Lektion (gleiche
 * "ein Medien-Block pro Lektion ist der Editor-Regelfall"-Annahme wie
 * `saveLessonBlocks()`s `video_bunny_id`-Sync). Bei Video: Bunnys
 * automatisches Vorschaubild (siehe `getVideoThumbnailUrl`-Kommentar in
 * bunny/client.ts — existiert als Datei bei Bunny ggf. noch nicht, solange
 * das Video frisch hochgeladen und noch nicht verarbeitet ist; die
 * Baum-Kachel fängt ein fehlgeschlagenes Laden client-seitig ab und zeigt
 * dann ein Platzhalter-Icon statt eines kaputten Bildes, siehe
 * module-lesson-tree.tsx).
 */
function getLessonMedia(blocksJson: unknown): { kind: "video" | "image" | null; thumbnailUrl: string | null } {
  const parsed = blocksSchema.safeParse(blocksJson);
  if (!parsed.success) return { kind: null, thumbnailUrl: null };
  for (const block of parsed.data as Block[]) {
    if (block.type === "video" && block.bunnyVideoId) {
      return { kind: "video", thumbnailUrl: getVideoThumbnailUrl(block.bunnyVideoId) };
    }
    if (block.type === "image" && block.url) {
      return { kind: "image", thumbnailUrl: block.url };
    }
  }
  return { kind: null, thumbnailUrl: null };
}

/**
 * 4-Schritte-Editor (Josips Auftrag, 25.07.2026): diese Server Component
 * lädt weiterhin ALLE Daten unverändert (gleiche Abfragen wie vorher), das
 * Rendering selbst delegiert komplett an `CourseEditorSteps`
 * (course-editor-steps.tsx), die daraus den Stepper + die vier Panels baut.
 * Grund für den Client-Wrapper: Umschalten zwischen Schritten ist reiner
 * UI-Zustand ohne Serverdaten-Bezug, ein Server-Redirect pro Klick wäre
 * spürbar langsamer.
 *
 * Startschritt: Schritt 3 (Inhalt & Struktur), wenn über `?lesson=` bereits
 * eine Lektion ausgewählt ist (Klick im Baum lädt die Seite weiterhin
 * serverseitig neu, siehe `href` in module-lesson-tree.tsx), sonst
 * Schritt 1 — deckt sich mit dem Alltag: wer aus der Kursliste in einen
 * bestehenden Kurs klickt, will meist weiterschreiben, nicht Grunddaten
 * pflegen; wer eine Lektion direkt anspringt, landet dort sofort.
 *
 * Vorherige Design-Historie (AdminKursEditor.dc.html-Angleichung,
 * Titel/Löschen-Wanderung ins Editor) bleibt inhaltlich erhalten — nur die
 * Anordnung ändert sich, siehe Kopfkommentar in course-editor-steps.tsx.
 */
export default async function CourseEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lesson?: string }>;
}) {
  const { id: courseId } = await params;
  const { lesson: activeLessonId } = await searchParams;
  const tenant = await getTenant();
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, slug, description, status, category_id, author_id, goals, cover_url")
    .eq("id", courseId)
    .eq("tenant_id", tenant!.id)
    .maybeSingle();

  if (!course) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-base">Kurs nicht gefunden.</p>
      </div>
    );
  }

  // Kurskategorien des Mandanten (Migration 20260722180000_course_categories.sql) für CourseCategorySelect.
  const { data: categories } = await supabase
    .from("course_categories")
    .select("id, name")
    .eq("tenant_id", tenant!.id)
    .order("position", { ascending: true });

  // Trainerprofile des Mandanten (Migration 20260724130000_course_information.sql)
  // für die Autor-Auswahl im Information-Tab (CourseInfoEditor).
  const { data: trainers } = await supabase
    .from("trainers")
    .select("id, name")
    .eq("tenant_id", tenant!.id)
    .order("position", { ascending: true });

  const { data: modules } = await supabase
    .from("modules")
    .select("id, title, description, position, cover_url")
    .eq("course_id", courseId)
    .order("position", { ascending: true });

  // Sektionen (Modul -> Sektion -> Lektion, Migration 20260718150000).
  const { data: sections } = await supabase
    .from("sections")
    .select("id, title, description, module_id, position")
    .in("module_id", (modules ?? []).map((m) => m.id))
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, module_id, section_id, status, blocks, position, video_bunny_id")
    .in("module_id", (modules ?? []).map((m) => m.id))
    .order("position", { ascending: true });

  // Block 2/Phase 2: Quizze des Kurses für die Auswahl im quiz-Block.
  const { data: courseQuizzesRaw } = await supabase
    .from("quizzes")
    .select("id, title")
    .eq("course_id", courseId)
    .order("title", { ascending: true });
  const courseQuizzes = courseQuizzesRaw ?? [];

  // Echte Zählungen für den Lösch-Bestätigungsdialog (DeleteCourseButton) —
  // keine Schätzung, siehe PHASENSTATUS.md.
  const { count: enrollmentCount } = await supabase
    .from("enrollments")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);
  const { count: certificateCount } = await supabase
    .from("certificates")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);

  const modulesWithLessons = (modules ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    description: (m.description as string | null) ?? null,
    coverUrl: (m.cover_url as string | null) ?? null,
    sections: (sections ?? [])
      .filter((s) => s.module_id === m.id)
      .map((s) => ({
        id: s.id,
        title: s.title,
        description: (s.description as string | null) ?? null,
        lessons: (lessons ?? [])
          .filter((l) => l.section_id === s.id)
          .map((l) => ({ id: l.id, title: l.title, status: l.status, ...getLessonMedia(l.blocks) })),
      })),
    // Lektionen ohne Sektion (vor der Migration angelegt, oder über
    // KI-Generator/CSV-Import entstanden — beide schreiben module_id ohne
    // section_id) bleiben im Baum sichtbar statt zu verschwinden.
    looseLessons: (lessons ?? [])
      .filter((l) => l.module_id === m.id && !l.section_id)
      .map((l) => ({ id: l.id, title: l.title, status: l.status, ...getLessonMedia(l.blocks) })),
  }));

  const activeLessonRaw = (lessons ?? []).find((l) => l.id === activeLessonId);
  const activeLessonBlocks: Block[] = activeLessonRaw
    ? (blocksSchema.safeParse(activeLessonRaw.blocks).success
        ? (blocksSchema.parse(activeLessonRaw.blocks) as Block[])
        : [])
    : [];
  const activeLesson = activeLessonRaw
    ? {
        id: activeLessonRaw.id,
        title: activeLessonRaw.title,
        status: activeLessonRaw.status,
        video_bunny_id: activeLessonRaw.video_bunny_id,
      }
    : null;

  return (
    <CourseEditorSteps
      courseId={courseId}
      courseTitle={course.title}
      courseSlug={course.slug}
      courseDescription={course.description ?? ""}
      courseStatus={course.status}
      courseCategoryId={course.category_id ?? null}
      courseCoverUrl={course.cover_url ?? null}
      courseGoals={Array.isArray(course.goals) ? (course.goals as string[]) : []}
      courseAuthorId={course.author_id ?? null}
      categories={categories ?? []}
      trainers={trainers ?? []}
      modules={modulesWithLessons}
      activeLessonId={activeLessonId}
      activeLesson={activeLesson}
      activeLessonBlocks={activeLessonBlocks}
      courseQuizzes={courseQuizzes}
      lessonCount={(lessons ?? []).length}
      enrollmentCount={enrollmentCount ?? 0}
      certificateCount={certificateCount ?? 0}
      initialStep={activeLessonId ? 3 : 1}
    />
  );
}
