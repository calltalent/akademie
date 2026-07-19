import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { getAuthUser } from "@/lib/auth/context";
import { computeCourseProgress, type ModuleSummary } from "@/lib/progress/compute";
import { AppShell } from "@/components/learn/app-shell";

/**
 * Studenten-Dashboard „Meine Kurse" (Referenz: „Calltalent-Akademie
 * Studenten-Portal/Dashboard.dc.html"). Zog vom Root `/` hierher nach
 * /dashboard um (Folgeauftrag); `/` (app/page.tsx) leitet angemeldete
 * Mandanten-Nutzer nur noch hierher weiter. Datenabfragen und Darstellung
 * unverändert übernommen.
 *
 * Sichtbarkeit der Kurse über RLS `courses_member_select` (published +
 * Mitglied ODER Staff sieht alles) — keine Enrollment-Zeile nötig (bewusste
 * Vereinfachung Phase 1, siehe PHASENSTATUS.md). Fortschritt kommt aus
 * `progress` des eingeloggten Nutzers, Modul-Eyebrow aus dem Titel des ersten
 * Moduls (kein erfundenes Tag-Datenmodell).
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const [user, tenant] = await Promise.all([getAuthUser(), getTenant()]);

  // Kein Mandant (Dev-Root/localhost): der Hinweis lebt an `/` — dorthin
  // zurück. Nicht angemeldet → Login. Beide Fälle spiegeln app/page.tsx.
  if (!tenant) redirect("/");
  if (!user) redirect("/login");

  // Performance-Fix (19.07.2026, Josips Fund: Login in den Lernbereich
  // fühlt sich langsam an — `/dashboard` ist die erste Seite danach):
  // `is_staff`/`profiles` hängen nur an `user.id`/`tenant.id`, nicht an den
  // Kursdaten — liefen aber sequenziell NACH der courses-Abfrage statt
  // parallel dazu.
  const [{ data: courses }, { data: isStaff }, { data: profile }] = await Promise.all([
    supabase
      .from("courses")
      .select("id, title, slug, status, cover_url")
      .eq("tenant_id", tenant.id)
      .eq("status", "published")
      .order("position", { ascending: true }),
    supabase.rpc("is_staff", { t: tenant.id }),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  const courseIds = (courses ?? []).map((c) => c.id);

  // `title` zusätzlich für die Eyebrow-Kategorie über dem Kurstitel — nutzt
  // den Titel des ERSTEN Moduls als echte, vorhandene Kategorisierung.
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

  // `updated_at` bestimmt, welcher angefangene Kurs im „Weiterlernen"-Banner
  // erscheint (zuletzt bearbeiteter Fortschritt).
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

  // Anzeigename: `profiles.full_name` ist optional (bei manchen Konten leer) —
  // Fallback auf den E-Mail-Namensteil statt einer leeren Begrüßung.
  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");
  // Begrüßung nur mit Vornamen (Referenz: „Willkommen zurück, Jonas"), der
  // Profil-Chip in der TopBar zeigt weiterhin den vollen Namen.
  const firstName = displayName.split(/\s+/)[0] || displayName;

  // Thumbnail-Tönungen wie im Mockup (helle Periwinkle-Abstufungen mit
  // Diagonalstreifen-Muster).
  const THUMB_TINTS = ["#DFE2F4", "#E7E9F6", "#EDE7F5"];

  // Pro Kurs Fortschritt + geordnete Lektionsliste + Modul-Eyebrow einmal
  // vorab berechnen (auch für die Banner-Kandidatensuche nutzbar).
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
      coverUrl: (course.cover_url as string | null) ?? null,
      tint: THUMB_TINTS[index % THUMB_TINTS.length],
      eyebrow: courseModules[0]?.title ?? null,
      progress,
      nextLesson,
      lastTouchedAt,
    };
  });

  // Kandidat fürs „Weiterlernen"-Banner: angefangen, aber nicht abgeschlossen,
  // mit dem jüngsten Fortschritts-Zeitstempel. Kein Kandidat → kein Banner
  // (keine erfundene Empfehlung ohne echten Fortschritt).
  const continueCourse = courseCards
    .filter((c) => c.progress.completed > 0 && !c.progress.isComplete && c.lastTouchedAt)
    .sort((a, b) => (b.lastTouchedAt! > a.lastTouchedAt! ? 1 : -1))[0];

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      title={`Willkommen zurück, ${firstName}`}
    >
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
        <a href="/kurskatalog" className="text-sm font-semibold no-underline">
          Kurskatalog ansehen
        </a>
      </div>

      <ul className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 320px))" }}>
        {courseCards.map(({ course, coverUrl, tint, eyebrow, progress }) => {
          const notStarted = progress.completed === 0;

          return (
            <li key={course.id}>
              <a
                href={`/kurs/${course.slug}`}
                className="flex h-full flex-col overflow-hidden border no-underline"
                style={{
                  borderRadius: 14,
                  borderColor: "#D8DAEA",
                  boxShadow: "0 1px 2px rgba(26,26,46,.05), 0 4px 10px rgba(26,26,46,.06)",
                }}
              >
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
                  <img src={coverUrl} alt="" className="aspect-video w-full object-cover object-center" />
                ) : (
                  <div
                    className="aspect-video w-full"
                    style={{
                      backgroundColor: tint,
                      backgroundImage:
                        "repeating-linear-gradient(45deg, " +
                        tint +
                        " 0 10px, rgba(255,255,255,.55) 10px 20px)",
                    }}
                    aria-hidden="true"
                  />
                )}
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
                        <div className="h-2 overflow-hidden rounded-[6px]" style={{ background: "#EEF0F7" }}>
                          <div
                            className="h-full rounded-[6px]"
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
