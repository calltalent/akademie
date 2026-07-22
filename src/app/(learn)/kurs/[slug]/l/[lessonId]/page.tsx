import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ArrowLeft, Check, Play, ListVideo, ChevronRight, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { blocksSchema, type Block } from "@/lib/courses/schema";
import { computeLessonBoundary, flattenLessonIds, findAdjacentLessonIds } from "@/lib/progress/compute";
import { BlockRenderer } from "@/components/learn/block-renderer";
import { CompleteLessonButton } from "@/components/learn/complete-lesson-button";
import { TutorPanel } from "@/components/learn/tutor-panel";
import { BookmarkButton } from "@/components/learn/bookmark-button";
import { AppShell } from "@/components/learn/app-shell";

const ACCENT = "#5663AE";
const NAVY = "#3E3F66";

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
 * Design-Block (16.07.2026, Claude-Design-Import Lektion.dc.html aus dem
 * Design-Projekt „Calltalent-Akademie Studenten-Portal"). Neugestaltung der
 * Lektionsseite: Modul-Fortschrittsleiste oben (verlinkt die neue Modul-
 * Detailseite `/kurs/[slug]/m/[moduleId]`), Lektions-Karte (Titel + Inhalt +
 * Fußzeile mit Lesezeichen/Feedback/Abschließen), „Nächste Lektion"-Karte und
 * rechts die Lektionsliste der aktuellen Sektion (= des aktuellen Moduls) mit
 * „Nächste Sektion".
 *
 * WICHTIG: Die eigentliche Lern-Funktionalität bleibt unverändert — der
 * Export zeigt nur einen einzelnen Video-Platzhalter, echte Lektionen können
 * aber Text/Quiz/Abgabe/Callout/Embed-Blöcke enthalten (courses/schema.ts),
 * gerendert vom BlockRenderer. Transkript/Zusammenfassung/Kapitel und der
 * Tutor-Chat bleiben erhalten (unter der Karte, nur wenn real vorhanden).
 * Bewusst NICHT aus dem Export übernommen: das „1/1 Aufgaben erledigt"-Badge
 * (kein Aufgaben-Zähler pro Lektion vorhanden — wäre eine erfundene Zahl).
 */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ slug: string; lessonId: string }>;
}) {
  const { slug, lessonId } = await params;
  const tenant = await getTenant();
  if (!tenant) redirect("/login");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: course } = await supabase
    .from("courses")
    .select("id, title")
    .eq("tenant_id", tenant.id)
    .eq("slug", slug)
    .maybeSingle();
  if (!course) redirect("/dashboard");

  const { data: modules } = await supabase
    .from("modules")
    .select("id, title, position")
    .eq("course_id", course.id)
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, module_id, section_id, blocks, status, position, transcript, summary, chapters, video_duration_s")
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
  const nextLessonObj = nextId ? (lessons ?? []).find((l) => l.id === nextId) ?? null : null;

  // Sektions-/Modul-Abschluss-Bildschirm (Josips Auftrag, 22.07.2026): ist
  // diese Lektion die letzte ihrer Sektion bzw. ihres Moduls, führt
  // "Lektion abschließen" auf einen Zwischenbildschirm statt direkt zur
  // nächsten Lektion. Die "Nächste Lektion"-Vorschaukarte weiter unten bleibt
  // bewusst unverändert (zeigt weiter die flache nächste Lektion als
  // Kontext) — nur das tatsächliche Abschließen greift hier ein.
  const lessonPositions = (lessons ?? []).map((l) => ({
    id: l.id,
    moduleId: l.module_id as string,
    sectionId: (l.section_id as string | null) ?? null,
    position: l.position as number,
  }));
  const boundary = computeLessonBoundary(lessonPositions, lessonId);
  const completeHref =
    boundary.kind === "module"
      ? `/kurs/${slug}/m/${boundary.moduleId}/abgeschlossen`
      : boundary.kind === "section"
        ? `/kurs/${slug}/s/${boundary.sectionId}/abgeschlossen`
        : nextId
          ? `/kurs/${slug}/l/${nextId}`
          : null;
  const completeLabel =
    boundary.kind === "module" ? "Modul ansehen →" : boundary.kind === "section" ? "Sektion ansehen →" : undefined;

  // Aktuelles Modul + Modul-Fortschritt für die Kopf-Leiste; „nächste Sektion"
  // = das nachfolgende Modul (Rechte Spalte zeigt nur das aktuelle Modul).
  const currentModuleIndex = (modules ?? []).findIndex((m) => m.id === lesson.module_id);
  const currentModule = currentModuleIndex === -1 ? null : (modules ?? [])[currentModuleIndex];
  const nextModule = currentModuleIndex === -1 ? null : (modules ?? [])[currentModuleIndex + 1] ?? null;
  const currentModuleLessons = (lessons ?? []).filter((l) => l.module_id === lesson.module_id);
  const moduleDone = currentModuleLessons.filter((l) => completedIds.has(l.id)).length;
  const modulePercent =
    currentModuleLessons.length > 0 ? Math.round((moduleDone / currentModuleLessons.length) * 100) : 0;

  const progressRow = (courseProgressRows ?? []).find((p) => p.lesson_id === lessonId);

  const { data: bookmarkRow } = await supabase
    .from("bookmarks")
    .select("id")
    .eq("user_id", user.id)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  const { data: isStaff } = await supabase.rpc("is_staff", { t: tenant.id });
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");

  const parsedBlocks = blocksSchema.safeParse(lesson.blocks);
  const blocks: Block[] = parsedBlocks.success ? (parsedBlocks.data as Block[]) : [];

  // Modul-Ring (52px, r=21 → Umfang ~132) für die Kopf-Leiste.
  const ringC = 2 * Math.PI * 21;
  const ringOffset = Math.max(0, Math.round(ringC - (ringC * modulePercent) / 100));

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb={`Lernen · ${currentModule?.title ?? course.title}`}
      title={lesson.title}
    >
      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[1fr_300px]">
        {/* Linke Spalte */}
        <div className="min-w-0">
          {/* Modul-Fortschrittsleiste → Modul-Detailseite */}
          {currentModule && (
            <Link
              href={`/kurs/${slug}/m/${currentModule.id}`}
              className="mb-6 flex items-center gap-4 rounded-[14px] p-[14px_16px] no-underline"
              style={{
                background: NAVY,
                backgroundImage:
                  "repeating-linear-gradient(135deg,rgba(86,99,174,.5) 0 16px, rgba(62,63,102,.5) 16px 32px)",
              }}
            >
              <div
                className="hidden h-14 w-24 flex-none items-center justify-center rounded-[9px] p-1 text-center sm:flex"
                style={{
                  backgroundColor: "#2C2D4A",
                  backgroundImage:
                    "repeating-linear-gradient(45deg,#2C2D4A 0 10px, rgba(86,99,174,.35) 10px 20px)",
                }}
                aria-hidden="true"
              >
                <span className="text-[10px] font-extrabold leading-tight" style={{ letterSpacing: "0.06em", color: "#C9CBE6" }}>
                  MODUL {currentModuleIndex + 1}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-bold uppercase" style={{ letterSpacing: "0.16em", color: "#B9BBDA" }}>
                  {course.title}
                </div>
                <div className="mt-[3px] truncate text-[17px] font-bold text-white">{currentModule.title}</div>
              </div>
              <div className="relative flex-none" style={{ width: 52, height: 52 }} aria-hidden="true">
                <svg width="52" height="52" viewBox="0 0 52 52">
                  <circle cx="26" cy="26" r="21" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="5" />
                  <circle
                    cx="26"
                    cy="26"
                    r="21"
                    fill="none"
                    stroke="#8BE0B7"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={ringC}
                    strokeDashoffset={ringOffset}
                    transform="rotate(-90 26 26)"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xs font-extrabold text-white">
                  {modulePercent}%
                </div>
              </div>
            </Link>
          )}

          {/* Lektions-Karte */}
          <div className="overflow-hidden rounded-[16px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
            <div className="p-[24px_26px_0]">
              <h1 className="m-0 text-2xl font-extrabold" style={{ color: "#1A1A2E" }}>
                {lesson.title}
              </h1>
            </div>

            <div className="px-[26px] pb-2 pt-4">
              <BlockRenderer blocks={blocks} lessonId={lessonId} />
            </div>

            {/* Fußzeile */}
            <div
              className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t p-[20px_26px]"
              style={{ borderColor: "#EEF0F7" }}
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <BookmarkButton lessonId={lessonId} courseSlug={slug} initiallyBookmarked={Boolean(bookmarkRow)} />
                <Link
                  href="/kontakt"
                  className="inline-flex items-center gap-1.5 rounded-[11px] border bg-white px-[14px] py-[10px] text-sm font-semibold no-underline"
                  style={{ borderColor: "#D8DAEA", color: NAVY }}
                >
                  <MessageSquare size={15} color={ACCENT} strokeWidth={2} aria-hidden="true" />
                  Feedback geben
                </Link>
              </div>
              <CompleteLessonButton
                lessonId={lessonId}
                courseSlug={slug}
                alreadyCompleted={progressRow?.status === "completed"}
                nextHref={completeHref}
                nextLabel={completeLabel}
              />
            </div>
          </div>

          {/* Zusammenfassung/Kapitel/Transkript — nur wenn real vorhanden. */}
          {lesson.summary ? (
            <div className="mt-5 rounded-2xl border p-4 text-base leading-relaxed" style={{ borderColor: "#E7E8F2", background: "#fff" }}>
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

          {/* Tutor-Panel (falls aktiv) — kursweit, deshalb courseId. */}
          {tenant.settings.tutor_enabled === true && (
            <div className="mt-6">
              <TutorPanel courseId={course.id} courseSlug={slug} currentLessonId={lessonId} />
            </div>
          )}

          {/* Vorherige + Nächste Lektion */}
          <div className="mt-[22px] flex flex-col gap-3">
            {prevId && (
              <Link href={`/kurs/${slug}/l/${prevId}`} className="inline-flex items-center gap-1.5 self-start text-sm font-semibold no-underline" style={{ color: "#66679B" }}>
                <ArrowLeft size={15} strokeWidth={2.2} aria-hidden="true" />
                Vorherige Lektion
              </Link>
            )}
            {nextId && nextLessonObj && (
              <Link
                href={`/kurs/${slug}/l/${nextId}`}
                className="flex items-center gap-4 rounded-[14px] border bg-white p-[14px_16px] text-inherit no-underline"
                style={{ borderColor: "#E7E8F2" }}
              >
                <span
                  className="flex h-[54px] w-[88px] flex-none items-center justify-center rounded-[9px]"
                  style={{
                    backgroundColor: "#DFE2F4",
                    backgroundImage:
                      "repeating-linear-gradient(45deg,#DFE2F4 0 9px, rgba(255,255,255,.55) 9px 18px)",
                  }}
                  aria-hidden="true"
                >
                  <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full" style={{ background: ACCENT }}>
                    <Play size={12} color="#fff" fill="#fff" />
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase" style={{ letterSpacing: "0.16em", color: "#A9AAC4" }}>
                    Nächste Lektion
                  </div>
                  <div className="mt-[3px] truncate text-base font-bold" style={{ color: "#1A1A2E" }}>
                    {nextLessonObj.title}
                  </div>
                </div>
                <ArrowRight size={20} color={ACCENT} strokeWidth={2.4} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>

        {/* Rechte Spalte: Lektionsliste der aktuellen Sektion (= Modul) */}
        <aside
          className="h-fit rounded-[16px] border bg-white p-[18px_16px] lg:sticky lg:top-5"
          style={{ borderColor: "#E7E8F2" }}
        >
          <div className="flex items-center gap-2.5 px-1 pb-3.5">
            <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px]" style={{ background: "#EDEEF7" }} aria-hidden="true">
              <ListVideo size={16} color={ACCENT} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-extrabold" style={{ color: "#1A1A2E" }}>
                {currentModule?.title ?? "Lektionen"}
              </div>
              <div className="text-[11px] font-bold uppercase" style={{ letterSpacing: "0.1em", color: "#A9AAC4" }}>
                {currentModuleLessons.length} {currentModuleLessons.length === 1 ? "Lektion" : "Lektionen"}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {currentModuleLessons.map((l) => {
              const done = completedIds.has(l.id);
              const current = l.id === lessonId;
              return (
                <Link
                  key={l.id}
                  href={`/kurs/${slug}/l/${l.id}`}
                  className="flex items-center gap-2.5 rounded-[11px] border p-[9px] no-underline"
                  style={{
                    background: current ? "#F6F7FC" : "transparent",
                    borderColor: current ? "#E0E2EF" : "transparent",
                  }}
                >
                  <span
                    className="relative flex-none rounded-[7px]"
                    style={{
                      width: 56,
                      height: 38,
                      backgroundColor: "#DFE2F4",
                      backgroundImage:
                        "repeating-linear-gradient(45deg,#DFE2F4 0 7px, rgba(255,255,255,.55) 7px 14px)",
                    }}
                    aria-hidden="true"
                  >
                    <span
                      className="absolute flex items-center justify-center rounded-full"
                      style={{
                        right: -4,
                        bottom: -4,
                        width: 17,
                        height: 17,
                        border: "2px solid #fff",
                        background: done ? "#3CA36A" : "#C6C8DC",
                      }}
                    >
                      {done ? (
                        <Check size={9} strokeWidth={3.4} color="#fff" />
                      ) : (
                        <Play size={8} color="#fff" fill="#fff" />
                      )}
                    </span>
                  </span>
                  <span
                    className="flex-1 text-[13px] leading-snug"
                    style={{ fontWeight: current ? 700 : 600, color: current ? "#1A1A2E" : "#66679B" }}
                  >
                    {l.title}
                  </span>
                </Link>
              );
            })}
          </div>

          {nextModule && (
            <Link
              href={`/kurs/${slug}/m/${nextModule.id}`}
              className="mt-3.5 flex items-center justify-center gap-1.5 rounded-[11px] border p-[11px] text-sm font-semibold no-underline"
              style={{ borderColor: "#E0E2EF", color: NAVY }}
            >
              Nächste Sektion
              <ChevronRight size={15} color={ACCENT} strokeWidth={2.4} aria-hidden="true" />
            </Link>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
