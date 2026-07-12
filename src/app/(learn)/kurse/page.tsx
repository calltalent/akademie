import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { computeCourseProgress, type ModuleSummary } from "@/lib/progress/compute";
import { AppShell } from "@/components/learn/app-shell";

/**
 * Design-Block (12.07.2026, Claude-Design-Export Teil 2, Kurskatalog.dc.html
 * — von Josip als verbindlich bestätigt, siehe PHASENSTATUS.md "Design-
 * Update Teil 2"). Neue, echte Route — löst die bisherige Fehlverlinkung
 * ab (Sidebar zeigte "Kurskatalog" auf `/suche`, das ist aber die
 * semantische KI-Suche über Lektionsinhalte, kein Kurs-Browsing).
 *
 * Die Filter-Chips aus dem Export ("Vertrieb", "Telefonie", ...) sind NICHT
 * übernommen — `courses` hat kein Kategorie-/Modul-Tag-Feld (siehe
 * supabase/migrations/0001_init.sql), die Chips im Export sind erfundene
 * Demo-Daten. Ein echtes Kategorie-Datenmodell ist ein eigener, noch
 * offener Auftrag (siehe PHASENSTATUS.md).
 *
 * "Enrolled/Not-enrolled" aus dem Export gibt es im echten Datenmodell
 * nicht (Phase-1-Vereinfachung: alle aktiven Mitglieder sehen alle
 * veröffentlichten Kurse ohne Enrollment-Zeile, siehe Kommentar in
 * src/app/page.tsx) — CTA-Text folgt stattdessen demselben Muster wie das
 * Dashboard: "Weiterlernen" bei vorhandenem Fortschritt, sonst "Kurs
 * starten".
 */
export default async function KurskatalogPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenant = await getTenant();
  if (!tenant) redirect("/login");

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, slug, status")
    .eq("tenant_id", tenant.id)
    .eq("status", "published")
    .order("position", { ascending: true });

  const courseIds = (courses ?? []).map((c) => c.id);
  const { data: modules } = await supabase
    .from("modules")
    .select("id, course_id")
    .in("course_id", courseIds.length > 0 ? courseIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, module_id, status")
    .in("module_id", (modules ?? []).map((m) => m.id))
    .eq("status", "published");
  const { data: progressRows } = await supabase
    .from("progress")
    .select("lesson_id, status")
    .eq("user_id", user.id)
    .in("lesson_id", (lessons ?? []).map((l) => l.id));
  const completedIds = new Set(
    (progressRows ?? []).filter((p) => p.status === "completed").map((p) => p.lesson_id),
  );

  const { data: isStaff } = await supabase.rpc("is_staff", { t: tenant.id });
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");

  const THUMB_COLORS = ["#5663AE", "#66679B", "#3E3F66", "#7A82C4"];

  const items = (courses ?? []).map((course, index) => {
    const moduleIds = (modules ?? []).filter((m) => m.course_id === course.id).map((m) => m.id);
    const courseLessons = (lessons ?? []).filter((l) => moduleIds.includes(l.module_id));
    const moduleSummaries: ModuleSummary[] = moduleIds.map((mid) => ({
      id: mid,
      lessons: courseLessons
        .filter((l) => l.module_id === mid)
        .map((l) => ({ id: l.id, completed: completedIds.has(l.id) })),
    }));
    const progress = computeCourseProgress(moduleSummaries);
    return {
      id: course.id,
      slug: course.slug,
      title: course.title,
      lessonCount: courseLessons.length,
      started: progress.completed > 0,
      tint: THUMB_COLORS[index % THUMB_COLORS.length],
    };
  });

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb="Lernen · Kurskatalog"
      title="Kurskatalog"
    >
      <p className="mb-6 text-base" style={{ color: "#66679B" }}>
        Alle verfügbaren Kurse in {tenant.name}.
      </p>

      {items.length === 0 ? (
        <div
          className="rounded-2xl border bg-white px-6 py-10 text-center text-sm"
          style={{ borderColor: "#E7E8F2", color: "#A9AAC4" }}
        >
          Noch keine veröffentlichten Kurse.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <div
              key={c.id}
              className="flex flex-col overflow-hidden rounded-2xl border bg-white"
              style={{ borderColor: "#E7E8F2" }}
            >
              <div className="h-[132px]" style={{ background: c.tint }} aria-hidden="true" />
              <div className="flex flex-1 flex-col p-5">
                <div className="mb-2.5 text-sm" style={{ color: "#66679B" }}>
                  {c.lessonCount} {c.lessonCount === 1 ? "Lektion" : "Lektionen"}
                </div>
                <div className="mb-4.5 text-[17px] font-bold leading-snug" style={{ color: "#1A1A2E" }}>
                  {c.title}
                </div>
                <a
                  href={`/kurs/${c.slug}`}
                  className="mt-auto inline-flex items-center justify-center rounded-[10px] px-4 py-2.5 text-sm font-bold no-underline"
                  style={{
                    background: c.started ? "var(--color-primary)" : "var(--color-cream)",
                    color: c.started ? "#fff" : "#1A1A2E",
                  }}
                >
                  {c.started ? "Weiterlernen" : "Kurs starten"}
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
