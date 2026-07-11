import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { computeCourseProgress, type ModuleSummary } from "@/lib/progress/compute";

/**
 * Block 5: „Meine Kurse" — veröffentlichte Kurse des Mandanten mit
 * Fortschrittsbalken. Sichtbarkeit über RLS `courses_member_select`
 * (published + Mitglied ODER Staff sieht alles) — keine Enrollment-Zeile
 * nötig, das ist bewusste Vereinfachung für Phase 1 (siehe PHASENSTATUS.md).
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenant = await getTenant();

  if (!tenant) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Calltalent-Akademie — Dev-Root</h1>
        <p className="text-base">
          Kein Mandant zu diesem Host gefunden. Zum Testen eine Mandanten-Subdomain
          aufrufen, z. B.:
        </p>
        <ul className="list-inside list-disc text-base">
          <li>
            <code>http://demo-blau.localhost:3000</code>
          </li>
          <li>
            <code>http://demo-gruen.localhost:3000</code>
          </li>
        </ul>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--color-primary)" }}>
          {tenant.name}
        </h1>
        <a
          href="/login"
          className="px-4 py-2 text-base text-white"
          style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
        >
          Anmelden
        </a>
      </main>
    );
  }

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, slug, status")
    .eq("tenant_id", tenant.id)
    .eq("status", "published")
    .order("position", { ascending: true });

  const courseIds = (courses ?? []).map((c) => c.id);

  const { data: modules } = await supabase
    .from("modules")
    .select("id, course_id, position")
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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--color-primary)" }}>
          {tenant.name}
        </h1>
        <div className="flex items-center gap-3">
          <a href="/suche" className="text-sm underline">
            Suche
          </a>
          <a href="/profil" className="text-sm underline">
            Profil
          </a>
          <form action="/auth/signout" method="post">
            <button type="submit" className="rounded-md border px-3 py-1 text-sm">
              Abmelden
            </button>
          </form>
        </div>
      </div>

      {isStaff && (
        <a href="/admin/kurse" className="text-sm underline">
          Zum Admin-Bereich →
        </a>
      )}

      <h2 className="text-lg font-medium">Meine Kurse</h2>
      <ul className="flex flex-col gap-3">
        {(courses ?? []).map((course) => {
          const courseModuleIds = (modules ?? [])
            .filter((m) => m.course_id === course.id)
            .map((m) => m.id);
          const moduleSummaries: ModuleSummary[] = courseModuleIds.map((mid) => ({
            id: mid,
            lessons: (lessons ?? [])
              .filter((l) => l.module_id === mid)
              .map((l) => ({ id: l.id, completed: completedIds.has(l.id) })),
          }));
          const progress = computeCourseProgress(moduleSummaries);

          return (
            <li key={course.id}>
              <a
                href={`/kurs/${course.slug}`}
                className="block rounded-md border p-4 hover:bg-gray-50"
                style={{ borderRadius: "var(--radius)" }}
              >
                <p className="text-base font-medium">{course.title}</p>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full"
                    style={{ width: `${progress.percent}%`, background: "var(--color-primary)" }}
                  />
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {progress.completed}/{progress.total} Lektionen
                  {progress.isComplete && " — abgeschlossen 🎉"}
                </p>
              </a>
            </li>
          );
        })}
        {(!courses || courses.length === 0) && (
          <p className="text-base text-gray-500">
            Noch keine veröffentlichten Kurse in dieser Akademie.
          </p>
        )}
      </ul>
    </main>
  );
}
