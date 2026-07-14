import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { computeCourseProgress, type ModuleSummary } from "@/lib/progress/compute";
import { CertificateBadge } from "@/components/learn/certificate-badge";

export default async function CourseOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await getTenant();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description, status")
    .eq("tenant_id", tenant!.id)
    .eq("slug", slug)
    .maybeSingle();

  if (!course) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-base">Kurs nicht gefunden oder nicht veröffentlicht.</p>
      </main>
    );
  }

  const { data: modules } = await supabase
    .from("modules")
    .select("id, title, position")
    .eq("course_id", course.id)
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, module_id, status, position")
    .in("module_id", (modules ?? []).map((m) => m.id))
    .eq("status", "published")
    .order("position", { ascending: true });

  const { data: progressRows } = await supabase
    .from("progress")
    .select("lesson_id, status")
    .eq("user_id", user.id)
    .in("lesson_id", (lessons ?? []).map((l) => l.id));

  const completedIds = new Set(
    (progressRows ?? []).filter((p) => p.status === "completed").map((p) => p.lesson_id),
  );

  const moduleSummaries: ModuleSummary[] = (modules ?? []).map((m) => ({
    id: m.id,
    lessons: (lessons ?? [])
      .filter((l) => l.module_id === m.id)
      .map((l) => ({ id: l.id, completed: completedIds.has(l.id) })),
  }));

  const progress = computeCourseProgress(moduleSummaries);
  const firstLessonId = moduleSummaries.flatMap((m) => m.lessons)[0]?.id;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <Link href="/" className="text-sm underline">
        ← Meine Kurse
      </Link>
      <h1 className="text-2xl font-semibold" style={{ color: "var(--color-primary)" }}>
        {course.title}
      </h1>
      {course.description && <p className="text-base text-gray-700">{course.description}</p>}

      <ProgressBar percent={progress.percent} />
      <p className="text-sm text-gray-500">
        {progress.completed} von {progress.total} Lektionen abgeschlossen
        {progress.isComplete && " — Kurs abgeschlossen! 🎉"}
      </p>

      <CertificateBadge tenantId={tenant!.id} courseId={course.id} isComplete={progress.isComplete} />

      {firstLessonId && (
        <a
          href={`/kurs/${slug}/l/${firstLessonId}`}
          className="self-start px-4 py-2 text-base text-white"
          style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
        >
          {progress.completed > 0 ? "Weiterlernen" : "Kurs starten"}
        </a>
      )}

      {progress.total === 0 ? (
        // Fund Josip (14.07.2026): Kurse ohne veröffentlichte Lektionen (z. B.
        // ein frisch angelegter, noch leerer Kurs) zeigten bisher GAR NICHTS
        // unterhalb der "0 von 0 Lektionen"-Zeile — wirkte wie eine kaputte
        // Seite statt wie ein leerer, noch nicht befüllter Kurs. Echter
        // Zustand, keine erfundene Nachricht: `progress.total === 0` deckt
        // sowohl "keine Module" als auch "Module ohne veröffentlichte
        // Lektionen" ab (dieselbe Bedingung wie oben für den fehlenden
        // "Kurs starten"-Button, siehe firstLessonId).
        <p className="text-base text-gray-500">
          Dieser Kurs hat noch keine veröffentlichten Inhalte.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {(modules ?? []).map((m) => {
            const moduleLessons = (lessons ?? []).filter((l) => l.module_id === m.id);
            if (moduleLessons.length === 0) return null;
            return (
              <div key={m.id} className="rounded-md border p-3" style={{ borderRadius: "var(--radius)" }}>
                <p className="mb-2 font-medium">{m.title}</p>
                <ul className="flex flex-col gap-1">
                  {moduleLessons.map((l) => (
                    <li key={l.id}>
                      <a
                        href={`/kurs/${slug}/l/${l.id}`}
                        className="flex items-center gap-2 text-base hover:underline"
                      >
                        <span aria-hidden="true">{completedIds.has(l.id) ? "✓" : "○"}</span>
                        {l.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-3 w-full overflow-hidden rounded-full bg-gray-100"
    >
      <div
        className="h-full transition-all"
        style={{ width: `${percent}%`, background: "var(--color-primary)" }}
      />
    </div>
  );
}
