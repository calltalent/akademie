import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { computeCourseProgress, findNextModule, type ModulePos, type ModuleSummary } from "@/lib/progress/compute";
import { AppShell } from "@/components/learn/app-shell";
import { CertificateBadge } from "@/components/learn/certificate-badge";

const NAVY = "#3E3F66";

/**
 * Modul-abgeschlossen-Bildschirm (Josips Auftrag, 22.07.2026, gleiche Basis
 * wie s/[sectionId]/abgeschlossen/page.tsx — Design bewusst NEU gestaltet,
 * keine Übernahme aus dem als Referenz gezeigten Konkurrenzprodukt, siehe
 * CLAUDE.md §3.1). Erreichbar über `CompleteLessonButton`s `nextHref`, sobald
 * `computeLessonBoundary()` auf der Lektionsseite `kind === "module"`
 * ermittelt (letzte Lektion eines Moduls — Modul-Grenze gewinnt immer über
 * eine gleichzeitige Sektionsgrenze, siehe compute.ts-Kopfkommentar).
 *
 * DRITTER FALL (Josips Präzisierung: "wenn die letzte Lektion [nicht der
 * letzte Kurs] abgeschlossen ist"): gibt es kein nächstes Modul (oder ist es
 * leer), ist das gesamte Modul zugleich die letzte Lektion des GANZEN
 * Kurses — eigene Glückwunsch-Variante statt der Modul-Vorschau-Karte, mit
 * `CertificateBadge` (bestehende Komponente, kennt bereits den Zwischen-
 * zustand "wird noch ausgestellt" direkt nach dem Abschluss).
 */
export default async function ModuleCompletedPage({
  params,
}: {
  params: Promise<{ slug: string; moduleId: string }>;
}) {
  const { slug, moduleId } = await params;
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
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");

  const { data: course } = await supabase
    .from("courses")
    .select("id, title")
    .eq("tenant_id", tenant.id)
    .eq("slug", slug)
    .maybeSingle();
  if (!course) redirect("/dashboard");

  const { data: modules } = await supabase
    .from("modules")
    .select("id, title, position, cover_url")
    .eq("course_id", course.id)
    .order("position", { ascending: true });
  const moduleIds = (modules ?? []).map((m) => m.id);

  const moduleIndex = (modules ?? []).findIndex((m) => m.id === moduleId);
  const mod = moduleIndex === -1 ? null : (modules ?? [])[moduleIndex];

  if (!mod) {
    return (
      <AppShell
        isStaff={Boolean(isStaff)}
        userName={displayName}
        userEmail={user.email ?? undefined}
        breadcrumb={`Lernen · ${course.title}`}
        title="Modul nicht gefunden"
      >
        <p className="text-base" style={{ color: "#66679B" }}>
          Modul nicht gefunden oder gehört nicht zu diesem Kurs.
        </p>
      </AppShell>
    );
  }

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, module_id, position, status, video_duration_s")
    .in("module_id", moduleIds.length > 0 ? moduleIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("status", "published")
    .order("position", { ascending: true });

  const { data: progressRows } = await supabase
    .from("progress")
    .select("lesson_id, status")
    .eq("user_id", user.id)
    .in(
      "lesson_id",
      (lessons ?? []).length > 0 ? (lessons ?? []).map((l) => l.id) : ["00000000-0000-0000-0000-000000000000"],
    );
  const completedIds = new Set(
    (progressRows ?? []).filter((p) => p.status === "completed").map((p) => p.lesson_id),
  );

  // Gesamtkurs-Fortschritt (nicht der noch nicht begonnene Fortschritt des
  // nächsten Moduls, der wäre 0 % und nichtssagend) — gleiche Berechnung wie
  // kurs/[slug]/page.tsx.
  const moduleSummaries: ModuleSummary[] = (modules ?? []).map((m) => ({
    id: m.id,
    lessons: (lessons ?? []).filter((l) => l.module_id === m.id).map((l) => ({ id: l.id, completed: completedIds.has(l.id) })),
  }));
  const courseProgress = computeCourseProgress(moduleSummaries);

  const modulePositions: ModulePos[] = (modules ?? []).map((m) => ({ id: m.id, position: m.position as number }));
  const nextModuleRef = findNextModule(modulePositions, moduleId);
  const nextModule = nextModuleRef ? (modules ?? []).find((m) => m.id === nextModuleRef.moduleId) ?? null : null;
  const nextModuleLessons = nextModule
    ? (lessons ?? []).filter((l) => l.module_id === nextModule.id).sort((a, b) => a.position - b.position)
    : [];
  const nextModuleFirstLessonId = nextModuleLessons[0]?.id ?? null;
  const nextModuleSeconds = nextModuleLessons.reduce(
    (sum, l) => sum + ((l.video_duration_s as number | null) ?? 0),
    0,
  );
  const nextModuleMinutes = Math.round(nextModuleSeconds / 60);
  const nextModuleLessonLabel =
    nextModuleLessons.length > 0
      ? `${nextModuleLessons.length} ${nextModuleLessons.length === 1 ? "Lektion" : "Lektionen"}`
      : null;
  const nextModuleMeta =
    nextModuleLessonLabel && nextModuleMinutes > 0
      ? `${nextModuleLessonLabel} · ${nextModuleMinutes} Min.`
      : nextModuleLessonLabel;

  // Dritter Fall: kein nächstes Modul mit Inhalt → das war die letzte
  // Lektion des GESAMTEN Kurses.
  const courseFullyCompleted = !nextModuleFirstLessonId;

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb={`Lernen · ${course.title}`}
      title={courseFullyCompleted ? "Kurs abgeschlossen" : "Modul abgeschlossen"}
    >
      <div className="mx-auto max-w-2xl">
        <Link
          href={`/kurs/${slug}/m/${mod.id}`}
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
            <div className="mt-[3px] truncate text-[17px] font-bold text-white">{mod.title}</div>
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
                strokeDasharray={2 * Math.PI * 21}
                strokeDashoffset={0}
                transform="rotate(-90 26 26)"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-xs font-extrabold text-white">
              100%
            </div>
          </div>
        </Link>

        <div className="flex flex-col items-center rounded-[16px] border bg-white p-[36px_26px] text-center" style={{ borderColor: "#E7E8F2" }}>
          <span
            className="mb-5 flex h-20 w-20 items-center justify-center rounded-full"
            style={{ background: "#E4F5EC" }}
            aria-hidden="true"
          >
            <Check size={40} strokeWidth={3} color="#3CA36A" />
          </span>
          <div className="text-[13px] font-bold uppercase" style={{ letterSpacing: "0.16em", color: "#A9AAC4" }}>
            {courseFullyCompleted ? "Kurs abgeschlossen" : `Modul ${moduleIndex + 1} · ${mod.title}`}
          </div>
          <h1 className="mt-1.5 text-[26px] font-extrabold" style={{ color: "#1A1A2E" }}>
            {courseFullyCompleted ? "Herzlichen Glückwunsch!" : "Modul abgeschlossen"}
          </h1>

          {courseFullyCompleted ? (
            <div className="mt-7 w-full">
              <p className="mb-4 text-base" style={{ color: "#66679B" }}>
                Du hast „{course.title}&quot; vollständig abgeschlossen.
              </p>
              <CertificateBadge tenantId={tenant.id} courseId={course.id} isComplete={true} />
            </div>
          ) : (
            nextModule && (
              <Link
                href={`/kurs/${slug}/m/${nextModule.id}`}
                className="mt-7 flex w-full items-center gap-4 rounded-[14px] border p-[14px_16px] text-inherit no-underline"
                style={{ borderColor: "#E7E8F2" }}
              >
                {nextModule.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
                  <img
                    src={nextModule.cover_url}
                    alt=""
                    className="h-[70px] w-[110px] flex-none rounded-[9px] object-cover object-center"
                  />
                ) : (
                  <span
                    className="flex h-[70px] w-[110px] flex-none items-center justify-center rounded-[9px] p-1.5 text-center"
                    style={{
                      backgroundColor: "#2C2D4A",
                      backgroundImage: "repeating-linear-gradient(45deg,#2C2D4A 0 10px, rgba(86,99,174,.35) 10px 20px)",
                    }}
                    aria-hidden="true"
                  >
                    <span className="text-[10px] font-extrabold leading-tight" style={{ letterSpacing: "0.06em", color: "#C9CBE6" }}>
                      MODUL {moduleIndex + 2}
                    </span>
                  </span>
                )}
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[11px] font-bold uppercase" style={{ letterSpacing: "0.16em", color: "#A9AAC4" }}>
                    Nächstes Modul
                  </div>
                  <div className="mt-[3px] truncate text-base font-bold" style={{ color: "#1A1A2E" }}>
                    {nextModule.title}
                  </div>
                  {nextModuleMeta && (
                    <div className="mt-1 text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
                      {nextModuleMeta}
                    </div>
                  )}
                </div>
                <div className="relative flex-none" style={{ width: 48, height: 48 }} aria-hidden="true">
                  <svg width="48" height="48" viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="#EEF0F7" strokeWidth="5" />
                    <circle
                      cx="24"
                      cy="24"
                      r="20"
                      fill="none"
                      stroke="#5663AE"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 20}
                      strokeDashoffset={Math.max(0, Math.round(2 * Math.PI * 20 - (2 * Math.PI * 20 * courseProgress.percent) / 100))}
                      transform="rotate(-90 24 24)"
                    />
                  </svg>
                  <div
                    className="absolute inset-0 flex items-center justify-center text-[11px] font-extrabold"
                    style={{ color: NAVY }}
                    role="img"
                    aria-label={`${courseProgress.percent}% des Kurses abgeschlossen`}
                  >
                    {courseProgress.percent}%
                  </div>
                </div>
              </Link>
            )
          )}

          <div className="mt-7 flex w-full flex-wrap items-center justify-center gap-3">
            <Link
              href={`/kurs/${slug}`}
              className="inline-flex items-center gap-2 rounded-[11px] px-5 py-3 text-[15px] font-bold no-underline"
              style={{ background: NAVY, color: "#fff" }}
            >
              Zurück zur Kursübersicht
            </Link>
            {!courseFullyCompleted && nextModuleFirstLessonId && (
              <Link
                href={`/kurs/${slug}/l/${nextModuleFirstLessonId}`}
                className="inline-flex items-center gap-2 rounded-[11px] px-5 py-3 text-[15px] font-bold text-white no-underline"
                style={{ background: "#3CA36A" }}
              >
                Weiter zum nächsten Modul
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
