import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { ModuleLessonTree, DeleteLessonButton } from "@/components/admin/module-lesson-tree";
import { BlockEditor } from "@/components/editor/block-editor";
import { LessonPublishToggle } from "@/components/admin/publish-toggle";
import { blocksSchema, type Block } from "@/lib/courses/schema";

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
    .select("id, title, slug, status")
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

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, module_id, status, blocks, position")
    .in("module_id", (modules ?? []).map((m) => m.id))
    .order("position", { ascending: true });

  const modulesWithLessons = (modules ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    lessons: (lessons ?? [])
      .filter((l) => l.module_id === m.id)
      .map((l) => ({ id: l.id, title: l.title, status: l.status })),
  }));

  const activeLesson = (lessons ?? []).find((l) => l.id === activeLessonId);
  const activeLessonBlocks: Block[] = activeLesson
    ? (blocksSchema.safeParse(activeLesson.blocks).success
        ? (blocksSchema.parse(activeLesson.blocks) as Block[])
        : [])
    : [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <a href="/admin/kurse" className="text-sm underline">
          Zurück zur Kursliste
        </a>
      </div>

      <div className="flex gap-6">
        <ModuleLessonTree
          courseId={courseId}
          modules={modulesWithLessons}
          activeLessonId={activeLessonId}
        />

        {activeLesson ? (
          <div className="flex flex-1 flex-col gap-3">
            <BlockEditor
              lessonId={activeLesson.id}
              courseId={courseId}
              initialTitle={activeLesson.title}
              initialBlocks={activeLessonBlocks}
            />
            <div className="flex items-center justify-between border-t pt-3">
              <LessonPublishToggle
                lessonId={activeLesson.id}
                courseId={courseId}
                status={activeLesson.status}
              />
              <DeleteLessonButton
                lessonId={activeLesson.id}
                courseId={courseId}
                title={activeLesson.title}
              />
            </div>
          </div>
        ) : (
          <p className="flex-1 text-base text-gray-500">
            Lektion links auswählen oder anlegen, um Blöcke zu bearbeiten.
          </p>
        )}
      </div>
    </div>
  );
}
