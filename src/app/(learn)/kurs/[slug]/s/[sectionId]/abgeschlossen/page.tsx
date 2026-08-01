import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Check, ListVideo } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { findNextSection, type ModulePos, type SectionPos } from "@/lib/progress/compute";
import { AppShell } from "@/components/learn/app-shell";

const ACCENT = "#5663AE";
const NAVY = "#3E3F66";

/**
 * Sektion-abgeschlossen-Bildschirm (Josips Auftrag, 22.07.2026, funktionale
 * Referenz ein Konkurrenz-Screenshot — Design bewusst NEU gestaltet mit den
 * bestehenden Tokens der Lernansicht, keine Übernahme, siehe CLAUDE.md §3.1).
 * Erreichbar ausschließlich über `CompleteLessonButton`s `nextHref`, sobald
 * `computeLessonBoundary()` auf der Lektionsseite `kind === "section"`
 * ermittelt (letzte Lektion einer Sektion, die NICHT zugleich letzte des
 * Moduls ist — sonst zeigt die Lektionsseite stattdessen auf
 * `m/[moduleId]/abgeschlossen`).
 *
 * Kein Bild für die Vorschau-Karte der nächsten Sektion: `sections` hat
 * weder `cover_url` noch ein Beschreibungsfeld (anders als `modules`) —
 * gleicher Platzhalter-Streifen wie die übrigen Karten dieser Seite statt
 * einer erfundenen Grafik/eines erfundenen Texts.
 */
export default async function SectionCompletedPage({
  params,
}: {
  params: Promise<{ slug: string; sectionId: string }>;
}) {
  const { slug, sectionId } = await params;
  const t = await getTranslations("learn.sectionCompleted");
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
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : tShared("fallbackUserName"));

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
  const moduleIds = (modules ?? []).map((m) => m.id);

  const { data: sections } = await supabase
    .from("sections")
    .select("id, title, module_id, position")
    .in("module_id", moduleIds.length > 0 ? moduleIds : ["00000000-0000-0000-0000-000000000000"])
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, module_id, section_id, position, status, video_duration_s")
    .in("module_id", moduleIds.length > 0 ? moduleIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("status", "published")
    .order("position", { ascending: true });

  const currentSection = (sections ?? []).find((s) => s.id === sectionId);

  if (!currentSection) {
    return (
      <AppShell
        isStaff={Boolean(isStaff)}
        userName={displayName}
        userEmail={user.email ?? undefined}
        breadcrumb={`${tShared("courseBreadcrumbPrefix")} · ${course.title}`}
        title={tNotFound("section.title")}
      >
        <p className="text-base" style={{ color: "#66679B" }}>
          {tNotFound("section.body")}
        </p>
      </AppShell>
    );
  }

  const currentModuleIndex = (modules ?? []).findIndex((m) => m.id === currentSection.module_id);
  const currentModule = currentModuleIndex === -1 ? null : (modules ?? [])[currentModuleIndex];

  const modulePositions: ModulePos[] = (modules ?? []).map((m) => ({ id: m.id, position: m.position as number }));
  const sectionPositions: SectionPos[] = (sections ?? []).map((s) => ({
    id: s.id,
    moduleId: s.module_id as string,
    position: s.position as number,
  }));
  const nextSectionRef = findNextSection(sectionPositions, modulePositions, sectionId, currentSection.module_id);
  const nextSection = nextSectionRef ? (sections ?? []).find((s) => s.id === nextSectionRef.sectionId) ?? null : null;
  const nextSectionLessons = nextSection
    ? (lessons ?? []).filter((l) => l.section_id === nextSection.id).sort((a, b) => a.position - b.position)
    : [];
  const nextSectionFirstLessonId = nextSectionLessons[0]?.id ?? null;
  const nextSectionSeconds = nextSectionLessons.reduce(
    (sum, l) => sum + ((l.video_duration_s as number | null) ?? 0),
    0,
  );
  const nextSectionMinutes = Math.round(nextSectionSeconds / 60);
  const nextSectionLessonLabel =
    nextSectionLessons.length > 0 ? tShared("lessonsCount", { count: nextSectionLessons.length }) : null;
  const nextSectionMeta =
    nextSectionLessonLabel && nextSectionMinutes > 0
      ? `${nextSectionLessonLabel} · ${tShared("minutesShort", { count: nextSectionMinutes })}`
      : nextSectionLessonLabel;

  // Modul-Fortschrittsring im Kopfbalken — 100 %, da die Sektion gerade
  // abgeschlossen wurde (gleiche Berechnung wie l/[lessonId]/page.tsx).
  const currentModuleLessons = (lessons ?? []).filter((l) => l.module_id === currentSection.module_id);
  const { data: progressRows } = await supabase
    .from("progress")
    .select("lesson_id, status")
    .eq("user_id", user.id)
    .in(
      "lesson_id",
      currentModuleLessons.length > 0
        ? currentModuleLessons.map((l) => l.id)
        : ["00000000-0000-0000-0000-000000000000"],
    );
  const completedIds = new Set(
    (progressRows ?? []).filter((p) => p.status === "completed").map((p) => p.lesson_id),
  );
  const moduleDone = currentModuleLessons.filter((l) => completedIds.has(l.id)).length;
  const modulePercent =
    currentModuleLessons.length > 0 ? Math.round((moduleDone / currentModuleLessons.length) * 100) : 0;
  const ringC = 2 * Math.PI * 21;
  const ringOffset = Math.max(0, Math.round(ringC - (ringC * modulePercent) / 100));

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb={`${tShared("courseBreadcrumbPrefix")} · ${currentModule?.title ?? course.title}`}
      title={t("heading")}
      hideTitle
    >
      <div className="mx-auto max-w-2xl">
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

        <div className="flex flex-col items-center rounded-[16px] border bg-white p-[36px_26px] text-center" style={{ borderColor: "#E7E8F2" }}>
          <span
            className="mb-5 flex h-20 w-20 items-center justify-center rounded-full"
            style={{ background: "#E4F5EC" }}
            aria-hidden="true"
          >
            <Check size={40} strokeWidth={3} color="#3CA36A" />
          </span>
          <div className="text-[13px] font-bold uppercase" style={{ letterSpacing: "0.16em", color: "#A9AAC4" }}>
            {currentSection.title}
          </div>
          <h1 className="mt-1.5 text-[26px] font-extrabold" style={{ color: "#1A1A2E" }}>
            {t("heading")}
          </h1>

          {nextSection && (
            <div
              className="mt-7 flex w-full items-center gap-4 rounded-[14px] border p-[14px_16px] text-left"
              style={{ borderColor: "#E7E8F2" }}
            >
              <span
                className="flex h-[54px] w-[88px] flex-none items-center justify-center rounded-[9px]"
                style={{
                  backgroundColor: "#DFE2F4",
                  backgroundImage: "repeating-linear-gradient(45deg,#DFE2F4 0 9px, rgba(255,255,255,.55) 9px 18px)",
                }}
                aria-hidden="true"
              >
                <ListVideo size={20} color={ACCENT} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase" style={{ letterSpacing: "0.16em", color: "#A9AAC4" }}>
                  {t("nextSectionLabel")}
                </div>
                <div className="mt-[3px] truncate text-base font-bold" style={{ color: "#1A1A2E" }}>
                  {nextSection.title}
                </div>
                {nextSectionMeta && (
                  <div className="mt-1 text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
                    {nextSectionMeta}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-7 flex w-full flex-wrap items-center justify-center gap-3">
            <Link
              href={`/kurs/${slug}/m/${currentSection.module_id}`}
              className="inline-flex items-center gap-2 rounded-[11px] px-5 py-3 text-[15px] font-bold no-underline"
              style={{ background: NAVY, color: "#fff" }}
            >
              {t("backToModule")}
            </Link>
            {nextSectionFirstLessonId && (
              <Link
                href={`/kurs/${slug}/l/${nextSectionFirstLessonId}`}
                className="inline-flex items-center gap-2 rounded-[11px] px-5 py-3 text-[15px] font-bold text-white no-underline"
                style={{ background: "#3CA36A" }}
              >
                {t("nextSectionButton")}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
