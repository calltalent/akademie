import { redirect } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { blocksSchema, type Block } from "@/lib/courses/schema";
import { flattenLessonIds, findAdjacentLessonIds } from "@/lib/progress/compute";
import { BlockRenderer } from "@/components/learn/block-renderer";
import { CompleteLessonButton } from "@/components/learn/complete-lesson-button";
import { TutorPanel } from "@/components/learn/tutor-panel";
import { BookmarkButton } from "@/components/learn/bookmark-button";
import { AppShell } from "@/components/learn/app-shell";

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

/**
 * Design-Block (12.07.2026, Claude-Design-Export Teil 2, Kurs.dc.html — von
 * Josip als verbindlich bestätigt, siehe PHASENSTATUS.md "Design-Update
 * Teil 2"). Chrome (AppShell) + Lektionsliste rechts NEU, dem Design
 * angeglichen — die eigentliche Lern-Funktionalität (BlockRenderer,
 * Tutor-Chat, Kapitel/Transkript, Abschluss-Button, Zertifikat) bewusst
 * UNVERÄNDERT gelassen: das Design zeigt nur einen einzelnen Video-Player,
 * echte Lektionen können aber auch Text/Quiz/Abgabe/Callout/Embed-Blöcke
 * enthalten (src/lib/courses/schema.ts) — eine 1:1-Kopie des Mockups hätte
 * echte, getestete Funktionalität verloren.
 *
 * Lesezeichen-Button jetzt echt verdrahtet (bookmark-button.tsx), "Arbeits-
 * blatt (PDF)" aus dem Export bewusst NICHT übernommen (kein Datenfeld
 * dafür vorhanden, wäre ein toter Link).
 */
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
    .select("id, title, position")
    .eq("course_id", course.id)
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, module_id, blocks, status, position, transcript, summary, chapters, video_duration_s")
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

  const { data: courseProgressRows } = await supabase
    .from("progress")
    .select("lesson_id, status")
    .eq("user_id", user.id)
    .in("lesson_id", (lessons ?? []).map((l) => l.id));
  const completedIds = new Set(
    (courseProgressRows ?? []).filter((p) => p.status === "completed").map((p) => p.lesson_id),
  );

  const flatModules = (modules ?? []).map((m) => ({
    id: m.id,
    lessons: (lessons ?? [])
      .filter((l) => l.module_id === m.id)
      .map((l) => ({ id: l.id, completed: completedIds.has(l.id) })),
  }));
  const flatIds = flattenLessonIds(flatModules);
  const { prevId, nextId } = findAdjacentLessonIds(flatIds, lessonId);
  const lessonPositionIndex = flatIds.indexOf(lessonId);
  // Kurs-Fortschritt (Anteil abgeschlossener Lektionen) für den Balken unter
  // dem Video — Kurs.dc.html zeigt dort ~54 % ≈ „Lektion 7 von 12".
  const coursePercent = flatIds.length
    ? Math.round((flatIds.filter((id) => completedIds.has(id)).length / flatIds.length) * 100)
    : 0;

  const progressRow = (courseProgressRows ?? []).find((p) => p.lesson_id === lessonId);

  const { data: bookmarkRow } = await supabase
    .from("bookmarks")
    .select("id")
    .eq("user_id", user.id)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  const { data: isStaff } = await supabase.rpc("is_staff", { t: tenant!.id });
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");

  const parsedBlocks = blocksSchema.safeParse(lesson.blocks);
  const blocks: Block[] = parsedBlocks.success ? (parsedBlocks.data as Block[]) : [];

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb={`Lernen · Meine Kurse · ${course.title}`}
      title={lesson.title}
    >
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[1fr_320px]">
        <div>
          <a href={`/kurs/${slug}`} className="mb-4 inline-block text-sm underline" style={{ color: "#66679B" }}>
            ← {course.title}
          </a>

          <BlockRenderer blocks={blocks} lessonId={lessonId} />

          {/* Kurs-Fortschrittsbalken (Kurs.dc.html: 6px unter dem Video). */}
          <div
            className="mt-6 h-1.5 overflow-hidden rounded-full"
            style={{ background: "#EEF0F7" }}
            role="progressbar"
            aria-valuenow={coursePercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Kursfortschritt"
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${coursePercent}%`, background: "var(--color-primary)" }}
            />
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
                LEKTION {lessonPositionIndex + 1} VON {flatIds.length}
              </div>
              <h2 className="mt-0.5 text-[22px] font-extrabold">{lesson.title}</h2>
            </div>
            {nextId && (
              <a
                href={`/kurs/${slug}/l/${nextId}`}
                className="inline-flex flex-shrink-0 items-center gap-2 rounded-[11px] px-5 py-3 text-[15px] font-bold text-white no-underline"
                style={{ background: "var(--color-primary)" }}
              >
                Nächste Lektion
                <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
              </a>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <BookmarkButton lessonId={lessonId} courseSlug={slug} initiallyBookmarked={Boolean(bookmarkRow)} />
          </div>

          {/* Transkript/Zusammenfassung/Kapitel (Phase 3, Block 6) — nur
              rendern, wenn tatsächlich vorhanden (kein "Kein Transkript
              verfügbar"-Rauschen, SPEC-Zweck "Zugänglichkeit"). */}
          {lesson.summary ? (
            <div
              className="mt-5 rounded-2xl border p-4 text-base leading-relaxed"
              style={{ borderColor: "#E7E8F2", background: "#fff" }}
            >
              <p className="mb-1 text-sm font-medium" style={{ color: "#A9AAC4" }}>
                Zusammenfassung
              </p>
              <p>{lesson.summary}</p>
            </div>
          ) : null}

          {Array.isArray(lesson.chapters) && (lesson.chapters as LessonChapter[]).length > 0 ? (
            <nav aria-label="Kapitel" className="mt-5 flex flex-col gap-1">
              <p className="text-sm font-medium" style={{ color: "#A9AAC4" }}>
                Kapitel
              </p>
              <ol className="flex flex-col gap-1">
                {(lesson.chapters as LessonChapter[]).map((chapter, index) => (
                  <li key={`${chapter.start}-${index}`} className="text-base">
                    <span className="tabular-nums" style={{ color: "#A9AAC4" }}>
                      {formatChapterTime(chapter.start)}
                    </span>
                    {" – "}
                    {chapter.title}
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}

          {lesson.transcript ? (
            <details className="mt-5 rounded-2xl border p-4" style={{ borderColor: "#E7E8F2", background: "#fff" }}>
              <summary className="cursor-pointer text-sm font-medium" style={{ color: "#A9AAC4" }}>
                Transkript anzeigen
              </summary>
              <p className="mt-3 max-h-96 overflow-y-auto whitespace-pre-line text-base leading-relaxed">
                {lesson.transcript}
              </p>
            </details>
          ) : null}

          <div className="mt-6 flex items-center justify-between border-t pt-5" style={{ borderColor: "#E7E8F2" }}>
            <div>
              {prevId ? (
                <a href={`/kurs/${slug}/l/${prevId}`} className="text-sm underline" style={{ color: "#66679B" }}>
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
            <div className="mt-6">
              <TutorPanel courseId={course.id} courseSlug={slug} currentLessonId={lessonId} />
            </div>
          )}
        </div>

        {/* Lektionsliste — Kurs.dc.html rechte Spalte, echte Modul-/
            Lektionsdaten + echter Fortschritt statt Demo-Reihe. */}
        <aside
          className="h-fit rounded-2xl border p-2"
          style={{ borderColor: "#E7E8F2", background: "#fff", position: "sticky", top: 20 }}
        >
          <div className="px-4 pb-2.5 pt-4 text-base font-bold">Lektionen</div>
          {(modules ?? []).map((m) => {
            const moduleLessons = (lessons ?? []).filter((l) => l.module_id === m.id);
            if (moduleLessons.length === 0) return null;
            return (
              <div key={m.id}>
                {moduleLessons.map((l) => {
                  const done = completedIds.has(l.id);
                  const current = l.id === lessonId;
                  return (
                    <a
                      key={l.id}
                      href={`/kurs/${slug}/l/${l.id}`}
                      className="flex items-center gap-3 rounded-[10px] px-3 py-[11px] no-underline"
                      style={{ background: current ? "#F6F7FC" : "transparent" }}
                    >
                      <span
                        className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                        style={{
                          color: done || current ? "#fff" : "#66679B",
                          background: done ? "#5663AE" : current ? "#3E3F66" : "#EEF0F7",
                        }}
                      >
                        {done ? <Check aria-hidden="true" size={13} /> : flatIds.indexOf(l.id) + 1}
                      </span>
                      <span
                        className="flex-1 text-sm"
                        style={{ fontWeight: current ? 700 : 500, color: current ? "#1A1A2E" : "#3E3F66" }}
                      >
                        {l.title}
                      </span>
                      {l.video_duration_s ? (
                        <span className="text-xs" style={{ color: "#A9AAC4" }}>
                          {Math.floor(l.video_duration_s / 60)}:{String(l.video_duration_s % 60).padStart(2, "0")}
                        </span>
                      ) : null}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </aside>
      </div>
    </AppShell>
  );
}
