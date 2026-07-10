import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { blocksSchema, type Block } from "@/lib/courses/schema";
import { flattenLessonIds, findAdjacentLessonIds } from "@/lib/progress/compute";
import { BlockRenderer } from "@/components/learn/block-renderer";
import { CompleteLessonButton } from "@/components/learn/complete-lesson-button";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ slug: string; lessonId: string }>;
}) {
  const { slug, lessonId } = await params;
  const tenant = await getTenant();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: course } = await supabase
    .from("courses")
    .select("id, title")
    .eq("tenant_id", tenant!.id)
    .eq("slug", slug)
    .maybeSingle();
  if (!course) redirect("/");

  const { data: modules } = await supabase
    .from("modules")
    .select("id, position")
    .eq("course_id", course.id)
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, module_id, blocks, status, position")
    .in("module_id", (modules ?? []).map((m) => m.id))
    .eq("status", "published")
    .order("position", { ascending: true });

  const lesson = (lessons ?? []).find((l) => l.id === lessonId);
  if (!lesson) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-base">Lektion nicht gefunden oder nicht veröffentlicht.</p>
      </main>
    );
  }

  const flatModules = (modules ?? []).map((m) => ({
    id: m.id,
    lessons: (lessons ?? []).filter((l) => l.module_id === m.id).map((l) => ({ id: l.id, completed: false })),
  }));
  const flatIds = flattenLessonIds(flatModules);
  const { prevId, nextId } = findAdjacentLessonIds(flatIds, lessonId);

  const { data: progressRow } = await supabase
    .from("progress")
    .select("status")
    .eq("user_id", user.id)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  const parsedBlocks = blocksSchema.safeParse(lesson.blocks);
  const blocks: Block[] = parsedBlocks.success ? (parsedBlocks.data as Block[]) : [];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <a href={`/kurs/${slug}`} className="text-sm underline">
        ← {course.title}
      </a>
      <h1 className="text-2xl font-semibold">{lesson.title}</h1>

      <BlockRenderer blocks={blocks} />

      <div className="flex items-center justify-between border-t pt-4">
        <div>
          {prevId ? (
            <a href={`/kurs/${slug}/l/${prevId}`} className="text-sm underline">
              ← Vorherige Lektion
            </a>
          ) : (
            <span />
          )}
        </div>
        <CompleteLessonButton
          lessonId={lessonId}
          courseSlug={slug}
          alreadyCompleted={progressRow?.status === "completed"}
          nextHref={nextId ? `/kurs/${slug}/l/${nextId}` : null}
        />
      </div>
    </main>
  );
}
