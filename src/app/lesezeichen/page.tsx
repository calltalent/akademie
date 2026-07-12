import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { AppShell } from "@/components/learn/app-shell";

/**
 * Design-Block (12.07.2026, Claude-Design-Export Teil 2, Lesezeichen.dc.html
 * — von Josip als verbindlich bestätigt, siehe PHASENSTATUS.md "Design-
 * Update Teil 2"). Löst die bisherige ehrliche Platzhalterseite ab, jetzt
 * mit echtem Datenmodell (supabase/migrations/20260712220000_bookmarks.sql,
 * src/lib/bookmarks/actions.ts).
 */
export default async function LesezeichenPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenant = await getTenant();
  if (!tenant) redirect("/login");

  const { data: bookmarks } = await supabase
    .from("bookmarks")
    .select("id, created_at, lesson_id, lessons(id, title, video_duration_s, module_id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Korrektur (Josips Build-Lauf, 12.07.2026): Supabase generiert für
  // eingebettete Relationen (hier "lessons(...)"/"courses(...)") durchweg
  // Array-Typen, auch bei einer klassischen n:1-Fremdschlüsselbeziehung
  // (ohne "!inner"-Modifikator). Die vorherige Array.isArray-Verzweigung
  // ging defensiv von einem möglichen Einzelobjekt aus — TypeScript kann
  // aber beweisen, dass der else-Zweig nie eintritt ("never"), das bricht
  // den Build ab. Deshalb hier direkt konsequent als Array behandelt.
  const lessonIds = (bookmarks ?? [])
    .map((b) => b.lessons?.[0]?.id)
    .filter((id): id is string => Boolean(id));

  const { data: modules } = await supabase
    .from("modules")
    .select("id, title, course_id, courses(slug, title)")
    .in(
      "id",
      (bookmarks ?? [])
        .map((b) => b.lessons?.[0]?.module_id)
        .filter((id): id is string => Boolean(id)),
    );

  const { data: isStaff } = await supabase.rpc("is_staff", { t: tenant.id });
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");

  const items = (bookmarks ?? [])
    .map((b) => {
      const lesson = b.lessons?.[0];
      if (!lesson) return null;
      const mod = (modules ?? []).find((m) => m.id === lesson.module_id);
      const course = mod?.courses?.[0] ?? null;
      return {
        id: b.id,
        lessonId: lesson.id,
        title: lesson.title as string,
        courseTitle: course?.title ?? "",
        courseSlug: course?.slug ?? "",
        durationS: (lesson.video_duration_s as number | null) ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  void lessonIds; // nur für obige .in()-Ableitung genutzt

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb="Lernen · Lesezeichen"
      title="Lesezeichen"
    >
      <p className="mb-6 text-base" style={{ color: "#66679B" }}>
        Deine markierten Lektionen — schnell zurück zu dem, was zählt.
      </p>

      {items.length === 0 ? (
        <div
          className="rounded-2xl border bg-white px-6 py-10 text-center text-sm"
          style={{ borderColor: "#E7E8F2", color: "#A9AAC4" }}
        >
          Noch keine Lesezeichen. Markiere eine Lektion über den „Lesezeichen&quot;-Button im Kurs.
        </div>
      ) : (
        <div className="flex max-w-[820px] flex-col gap-3.5">
          {items.map((item) => (
            <a
              key={item.id}
              href={`/kurs/${item.courseSlug}/l/${item.lessonId}`}
              className="flex items-center gap-4.5 rounded-2xl border bg-white px-5 py-4 no-underline"
              style={{ borderColor: "#E7E8F2" }}
            >
              <span
                className="h-14 w-14 flex-shrink-0 rounded-xl"
                style={{ background: "#DFE2F4" }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold" style={{ color: "#A9AAC4" }}>
                  {item.courseTitle}
                </div>
                <div className="text-base font-bold" style={{ color: "#1A1A2E" }}>
                  {item.title}
                </div>
              </div>
              {item.durationS && (
                <span className="flex-shrink-0 text-[13px]" style={{ color: "#A9AAC4" }}>
                  {Math.floor(item.durationS / 60)}:{String(item.durationS % 60).padStart(2, "0")}
                </span>
              )}
            </a>
          ))}
        </div>
      )}
    </AppShell>
  );
}
