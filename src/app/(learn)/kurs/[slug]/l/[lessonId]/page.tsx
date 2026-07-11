import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { blocksSchema, type Block } from "@/lib/courses/schema";
import { flattenLessonIds, findAdjacentLessonIds } from "@/lib/progress/compute";
import { BlockRenderer } from "@/components/learn/block-renderer";
import { CompleteLessonButton } from "@/components/learn/complete-lesson-button";
import { TutorPanel } from "@/components/learn/tutor-panel";

type LessonChapter = { title: string; start: number; end: number };

/** "MM:SS", ab 1h "H:MM:SS" — Phase 3, Block 6 (Kapitel-Anzeige). */
function formatChapterTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

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
    .select("id, title, module_id, blocks, status, position, transcript, summary, chapters")
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

      <BlockRenderer blocks={blocks} lessonId={lessonId} />

      {/* Transkript/Zusammenfassung/Kapitel (Phase 3, Block 6) — nur
          rendern, wenn tatsächlich vorhanden (kein "Kein Transkript
          verfügbar"-Rauschen, SPEC-Zweck "Zugänglichkeit"). */}
      {lesson.summary ? (
        <div
          className="rounded-md border p-4 text-base leading-relaxed"
          style={{ borderRadius: "var(--radius)" }}
        >
          <p className="mb-1 text-sm font-medium text-gray-500">Zusammenfassung</p>
          <p>{lesson.summary}</p>
        </div>
      ) : null}

      {Array.isArray(lesson.chapters) && (lesson.chapters as LessonChapter[]).length > 0 ? (
        <nav aria-label="Kapitel" className="flex flex-col gap-1">
          <p className="text-sm font-medium text-gray-500">Kapitel</p>
          <ol className="flex flex-col gap-1">
            {(lesson.chapters as LessonChapter[]).map((chapter, index) => (
              <li key={`${chapter.start}-${index}`} className="text-base">
                <span className="tabular-nums text-gray-500">{formatChapterTime(chapter.start)}</span>
                {" – "}
                {chapter.title}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      {lesson.transcript ? (
        <details className="rounded-md border p-4" style={{ borderRadius: "var(--radius)" }}>
          <summary className="cursor-pointer text-sm font-medium text-gray-500">
            Transkript anzeigen
          </summary>
          <p className="mt-3 max-h-96 overflow-y-auto whitespace-pre-line text-base leading-relaxed">
            {lesson.transcript}
          </p>
        </details>
      ) : null}

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

      {/* Tutor-Panel (falls aktiv) — SPEC Zeile 34. Strikter Vergleich
          (=== true, kein Fallback auf "truthy"), gleiches Muster wie
          settings.payments_enabled in stripe/checkout.ts: Demo-Mandanten
          ohne gesetztes Feld sehen den Tutor bewusst NICHT (siehe
          PHASENSTATUS.md). Tutor ist kursweit, nicht lektionsweit
          (SPEC §6: "pgvector-Suche über Kurs-Chunks"), deshalb courseId
          statt lessonId. */}
      {tenant!.settings.tutor_enabled === true && (
        <TutorPanel courseId={course.id} courseSlug={slug} currentLessonId={lessonId} />
      )}
    </main>
  );
}
