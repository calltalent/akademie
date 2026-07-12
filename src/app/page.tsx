import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { computeCourseProgress, type ModuleSummary } from "@/lib/progress/compute";
import { AppShell } from "@/components/learn/app-shell";

/**
 * Block 5: „Meine Kurse" — veröffentlichte Kurse des Mandanten mit
 * Fortschrittsbalken. Sichtbarkeit über RLS `courses_member_select`
 * (published + Mitglied ODER Staff sieht alles) — keine Enrollment-Zeile
 * nötig, das ist bewusste Vereinfachung für Phase 1 (siehe PHASENSTATUS.md).
 *
 * Design-Block (12.07.2026, DESIGN-MASTERPROMPT.md): Datenabfragen
 * unverändert, nur die Darstellung in AppShell (Sidebar-Navigation) verlegt
 * — vorher lose Text-Links in der Kopfzeile.
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

  // Design-Block 5 (Dashboard-Feinschliff): `title` zusätzlich zu `position`
  // geladen, für die Eyebrow-Kategorie über dem Kurstitel — nutzt den Titel
  // des ERSTEN Moduls als echte, vorhandene Kategorisierung. Kein erfundenes
  // Tag-Datenmodell (siehe PHASENSTATUS.md „Kein Kategorie-/Modul-Tag-
  // Datenmodell für Kurskatalog-Filter — offener Folgeauftrag").
  const { data: modules } = await supabase
    .from("modules")
    .select("id, course_id, title, position")
    .in("course_id", courseIds.length > 0 ? courseIds : ["00000000-0000-0000-0000-000000000000"])
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, module_id, title, position, status")
    .in("module_id", (modules ?? []).map((m) => m.id))
    .eq("status", "published")
    .order("position", { ascending: true });

  // `updated_at` zusätzlich geladen — bestimmt, welcher angefangene Kurs im
  // „Weiterlernen"-Banner erscheint (zuletzt bearbeiteter Fortschritt).
  const { data: progressRows } = await supabase
    .from("progress")
    .select("lesson_id, status, updated_at")
    .eq("user_id", user.id)
    .in("lesson_id", (lessons ?? []).map((l) => l.id));

  const completedIds = new Set(
    (progressRows ?? []).filter((p) => p.status === "completed").map((p) => p.lesson_id),
  );
  const lastTouchedByLesson = new Map(
    (progressRows ?? []).map((p) => [p.lesson_id, p.updated_at as string]),
  );

  const { data: isStaff } = await supabase.rpc("is_staff", { t: tenant.id });

  // Design-Block, Rückstellung auf Original-Mockup (12.07.2026): "Willkommen,
  // {Name}"-Begrüßung + Avatar-Initialen laut Wireframe brauchen einen
  // Anzeigenamen. `profiles.full_name` ist optional (bei Josips eigenem
  // Konto z. B. leer, da nicht über das Registrierungsformular angelegt) —
  // Fallback auf den E-Mail-Namensteil statt eine leere Begrüßung zu zeigen.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");

  // Thumbnail-Tönungen wie im Mockup (helle Periwinkle-Abstufungen mit
  // Diagonalstreifen-Muster) statt durchgehend Vollfarbe.
  const THUMB_TINTS = ["#DFE2F4", "#E7E9F6", "#EDE7F5"];

  // Design-Block 5 (Dashboard-Feinschliff, „Weiterlernen"-Banner): pro Kurs
  // Fortschritt + geordnete Lektionsliste + Modul-Eyebrow einmal vorab
  // berechnen (statt in der Render-Schleife), damit dieselben Daten auch für
  // die Kandidatensuche des Banners nutzbar sind — keine doppelte Abfrage.
  const courseCards = (courses ?? []).map((course, index) => {
    const courseModules = (modules ?? [])
      .filter((m) => m.course_id === course.id)
      .sort((a, b) => a.position - b.position);
    const moduleSummaries: ModuleSummary[] = courseModules.map((m) => ({
      id: m.id,
      lessons: (lessons ?? [])
        .filter((l) => l.module_id === m.id)
        .sort((a, b) => a.position - b.position)
        .map((l) => ({ id: l.id, completed: completedIds.has(l.id) })),
    }));
    const orderedLessons = courseModules.flatMap((m) =>
      (lessons ?? [])
        .filter((l) => l.module_id === m.id)
        .sort((a, b) => a.position - b.position),
    );
    const progress = computeCourseProgress(moduleSummaries);
    const nextLesson = orderedLessons.find((l) => !completedIds.has(l.id)) ?? null;
    const lastTouchedAt = orderedLessons.reduce<string | null>((max, l) => {
      const t = lastTouchedByLesson.get(l.id);
      if (!t) return max;
      return !max || t > max ? t : max;
    }, null);

    return {
      course,
      tint: THUMB_TINTS[index % THUMB_TINTS.length],
      eyebrow: courseModules[0]?.title ?? null,
      progress,
      nextLesson,
      lastTouchedAt,
    };
  });

  // Kandidat fürs „Weiterlernen"-Banner: angefangen, aber nicht
  // abgeschlossen, mit dem jüngsten Fortschritts-Zeitstempel. Kein Kandidat
  // → Banner bleibt weg (keine erfundene Empfehlung ohne echten Fortschritt).
  const continueCourse = courseCards
    .filter((c) => c.progress.completed > 0 && !c.progress.isComplete && c.lastTouchedAt)
    .sort((a, b) => (b.lastTouchedAt! > a.lastTouchedAt! ? 1 : -1))[0];

  return (
    <AppShell isStaff={Boolean(isStaff)} userName={displayName} userEmail={user.email ?? undefined}>
      {continueCourse && continueCourse.nextLesson && (
        <a
          href={`/kurs/${continueCourse.course.slug}/l/${continueCourse.nextLesson.id}`}
          className="mb-8 flex items-center gap-6 rounded-2xl px-[30px] py-[26px] no-underline"
          style={{ background: "#3E3F66", color: "#F7EED4" }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold" style={{ color: "#B9BBDA", letterSpacing: "0.04em" }}>
              WEITERLERNEN
            </div>
            <div className="mt-1 mb-0.5 text-[22px] font-bold text-white">{continueCourse.course.title}</div>
            <div className="text-[15px]" style={{ color: "#D6D7EC" }}>
              Lektion {continueCourse.progress.completed + 1} von {continueCourse.progress.total} ·{" "}
              {continueCourse.nextLesson.title}
            </div>
          </div>
          <span
            className="inline-flex shrink-0 items-center gap-[9px] rounded-[11px] px-[22px] py-[13px] text-[15px] font-bold"
            style={{ background: "#F7EED4", color: "#1A1A2E" }}
          >
            Fortsetzen
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1A1A2E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"></path>
              <path d="m13 6 6 6-6 6"></path>
            </svg>
          </span>
        </a>
      )}

      <div className="mb-[18px] flex items-baseline justify-between">
        <h2 className="m-0 text-xl font-bold" style={{ color: "#1A1A2E" }}>
          Meine Kurse
        </h2>
        <a href="/kurse" className="text-sm font-semibold no-underline">
          Kurskatalog ansehen
        </a>
      </div>

      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {courseCards.map(({ course, tint, eyebrow, progress }) => {
          const notStarted = progress.completed === 0;

          return (
            <li key={course.id}>
              <a
                href={`/kurs/${course.slug}`}
                className="flex h-full flex-col overflow-hidden border no-underline"
                style={{ borderRadius: 14, borderColor: "#E7E8F2" }}
              >
                <div
                  className="h-[132px]"
                  style={{
                    backgroundColor: tint,
                    backgroundImage:
                      "repeating-linear-gradient(45deg, " +
                      tint +
                      " 0 10px, rgba(255,255,255,.55) 10px 20px)",
                  }}
                  aria-hidden="true"
                />
                <div className="flex flex-1 flex-col p-5">
                  {eyebrow && (
                    <div
                      className="mb-1.5 text-xs font-semibold uppercase"
                      style={{ color: "#A9AAC4", letterSpacing: "0.03em" }}
                    >
                      {eyebrow}
                    </div>
                  )}
                  <p className="mb-4 text-[17px] font-bold leading-snug" style={{ color: "#1A1A2E" }}>
                    {course.title}
                  </p>
                  <div className="mt-auto">
                    {notStarted ? (
                      <span
                        className="inline-flex items-center gap-2 rounded-[9px] px-3.5 py-2 text-[13px] font-bold"
                        style={{ background: "#F7EED4", color: "#1A1A2E" }}
                      >
                        <span
                          className="h-[7px] w-[7px] rounded-full"
                          style={{ background: "#3E3F66" }}
                          aria-hidden="true"
                        />
                        Nicht gestartet
                      </span>
                    ) : (
                      <>
                        <div className="mb-2 flex justify-between text-[13px] font-semibold">
                          <span style={{ color: "#66679B" }}>
                            Fortschritt
                            {progress.isComplete && " — abgeschlossen 🎉"}
                          </span>
                          <span style={{ color: "#5663AE" }}>{progress.percent}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-md" style={{ background: "#EEF0F7" }}>
                          <div
                            className="h-full rounded-md"
                            style={{ width: `${progress.percent}%`, background: "var(--color-primary)" }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
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
    </AppShell>
  );
}
