import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { ModuleLessonTree, DeleteLessonButton } from "@/components/admin/module-lesson-tree";
import { BlockEditor } from "@/components/editor/block-editor";
import { LessonPublishToggle, CourseStatusSelect, CourseCategorySelect } from "@/components/admin/publish-toggle";
import { ReembedCourseButton } from "@/components/admin/reembed-course-button";
import { RefreshTranscriptButton } from "@/components/admin/refresh-transcript-button";
import { CourseTitleEditor } from "@/components/admin/course-title-editor";
import { DeleteCourseButton } from "@/components/admin/delete-course-button";
import { blocksSchema, type Block } from "@/lib/courses/schema";

/**
 * Design-Update (AdminKursEditor.dc.html, Übergabebericht siehe
 * PHASENSTATUS.md): der Kurs-Editor war der einzige Bereich der Anwendung
 * ohne Marken-Design (rohe graue `rounded-md border`-Kästen). Kopfzeile mit
 * Brotkrume + Status-/Kategorie-Auswahl (jetzt mit sichtbarem Label, siehe
 * publish-toggle.tsx), zweispaltiges Raster (300px Baum / restlicher Platz
 * Editor). `ReembedCourseButton`/`RefreshTranscriptButton` sind nicht Teil
 * des Referenz-Exports (der kennt weder KI-Einbettung noch Transkript-
 * Refresh), bleiben aber erhalten (Funktionsverlust ist nicht erlaubt) und
 * bekommen nur die neue Sekundär-Button-Optik.
 *
 * Kurs umbenennen/löschen (Josips Entscheidung, siehe PHASENSTATUS.md):
 * beides im Editor statt in der Kursliste. `CourseTitleEditor` ersetzt die
 * bisher statische Titel-Überschrift im Kopf. `DeleteCourseButton` bekommt
 * echte Zählungen (Lektionen/Teilnehmer/Zertifikate) als Props von hier —
 * der Plan verlangt die Fußzeile des Editors neben "Lektion löschen"; da
 * eine Kurslöschung aber unabhängig von der Lektionsauswahl möglich sein
 * muss (auch ohne ausgewählte Lektion), erscheint der Knopf in BEIDEN
 * Zweigen der activeLesson-Verzweigung unten — einmal in der bestehenden
 * Fußzeile neben "Lektion löschen", einmal in einer eigenen Fußzeile im
 * Platzhalter-Zweig. Kein Auftragskonflikt, nur eine im Plan offen
 * gelassene Detailentscheidung (CLAUDE.md §4.5).
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
    .select("id, title, slug, status, category")
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

  const { data: modules } = await supabase
    .from("modules")
    .select("id, title, position")
    .eq("course_id", courseId)
    .order("position", { ascending: true });

  // Sektionen (Modul -> Sektion -> Lektion, Migration 20260718150000).
  const { data: sections } = await supabase
    .from("sections")
    .select("id, title, module_id, position")
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
    sections: (sections ?? [])
      .filter((s) => s.module_id === m.id)
      .map((s) => ({
        id: s.id,
        title: s.title,
        lessons: (lessons ?? [])
          .filter((l) => l.section_id === s.id)
          .map((l) => ({ id: l.id, title: l.title, status: l.status })),
      })),
    // Lektionen ohne Sektion (vor der Migration angelegt, oder über
    // KI-Generator/CSV-Import entstanden — beide schreiben module_id ohne
    // section_id) bleiben im Baum sichtbar statt zu verschwinden.
    looseLessons: (lessons ?? [])
      .filter((l) => l.module_id === m.id && !l.section_id)
      .map((l) => ({ id: l.id, title: l.title, status: l.status })),
  }));

  const activeLesson = (lessons ?? []).find((l) => l.id === activeLessonId);
  const activeLessonBlocks: Block[] = activeLesson
    ? (blocksSchema.safeParse(activeLesson.blocks).success
        ? (blocksSchema.parse(activeLesson.blocks) as Block[])
        : [])
    : [];

  return (
    <div className="flex flex-col gap-2">
      <header className="flex flex-wrap items-start gap-5">
        <CourseTitleEditor courseId={courseId} initialTitle={course.title} initialSlug={course.slug} />
        <div className="flex flex-wrap items-end gap-4">
          <CourseStatusSelect courseId={courseId} status={course.status} />
          <CourseCategorySelect courseId={courseId} category={course.category ?? null} />
          <ReembedCourseButton courseId={courseId} />
          <Link
            href="/admin/kurse"
            className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-4 py-3 text-[15px] font-semibold no-underline"
            style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
          >
            <ArrowLeft size={16} aria-hidden="true" style={{ color: "#5663AE" }} />
            Zurück zur Kursliste
          </Link>
        </div>
      </header>

      <main className="mt-1.5 grid items-start gap-[26px]" style={{ gridTemplateColumns: "300px 1fr" }}>
        <ModuleLessonTree
          courseId={courseId}
          modules={modulesWithLessons}
          activeLessonId={activeLessonId}
        />

        {activeLesson ? (
          <div className="flex min-w-0 flex-col gap-5">
            <BlockEditor
              lessonId={activeLesson.id}
              courseId={courseId}
              initialTitle={activeLesson.title}
              initialBlocks={activeLessonBlocks}
              courseQuizzes={courseQuizzes}
            />
            <div className="flex flex-wrap items-center gap-3">
              <LessonPublishToggle
                lessonId={activeLesson.id}
                courseId={courseId}
                status={activeLesson.status}
              />
              <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
                {activeLesson.video_bunny_id ? (
                  <RefreshTranscriptButton lessonId={activeLesson.id} />
                ) : null}
                <DeleteLessonButton
                  lessonId={activeLesson.id}
                  courseId={courseId}
                  title={activeLesson.title}
                />
                <DeleteCourseButton
                  courseId={courseId}
                  title={course.title}
                  lessonCount={(lessons ?? []).length}
                  enrollmentCount={enrollmentCount ?? 0}
                  certificateCount={certificateCount ?? 0}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-5">
            <p className="text-base" style={{ color: "#66679B" }}>
              Lektion links auswählen oder anlegen, um Blöcke zu bearbeiten.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <DeleteCourseButton
                courseId={courseId}
                title={course.title}
                lessonCount={(lessons ?? []).length}
                enrollmentCount={enrollmentCount ?? 0}
                certificateCount={certificateCount ?? 0}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
