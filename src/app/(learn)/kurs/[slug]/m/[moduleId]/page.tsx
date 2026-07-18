import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Play, ArrowLeft, ListVideo, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { AppShell } from "@/components/learn/app-shell";

/**
 * Design-Block (16.07.2026, Claude-Design-Import Modul.dc.html aus dem
 * Design-Projekt „Calltalent-Akademie Studenten-Portal"). NEUE Route
 * `/kurs/[slug]/m/[moduleId]` — die Modul-Detailseite gab es bisher nicht
 * (Kurs-Übersicht → direkt Lektion). Sie sitzt jetzt zwischen KursUebersicht
 * und Lektion: Hero + Lektionsliste eines einzelnen Moduls.
 *
 * SEKTIONEN (18.07.2026, Josips Auftrag, Migration 20260718150000): der
 * Export gruppierte Lektionen schon immer in „Sektionen" — dieses Level gab
 * es im Schema damals noch nicht (siehe PHASENSTATUS.md), jede Sektion wurde
 * deshalb notgedrungen zu EINER Karte zusammengefasst. Jetzt real: pro
 * Sektion eine eigene Karte mit eigener Überschrift; Lektionen OHNE Sektion
 * (vor der Migration angelegt oder über KI-Generator/CSV-Import entstanden)
 * erscheinen weiterhin, in einer Karte ohne Sektionstitel — keine Lektion
 * verschwindet durch die neue Gruppierung.
 *
 * Weiterhin bewusst weggelassen: die „DEIN COACH"-Karte des Exports (es
 * gibt kein Coach-/Trainer-Datenmodell pro Kurs — statt „Andrea Baumann"
 * hart zu verdrahten, bleibt sie weg, bis eine echte Quelle definiert ist)
 * und die „N Seiten"-Angabe je Lektion (kein Datenfeld dafür).
 */

const ACCENT = "#5663AE";
const NAVY = "#3E3F66";

export default async function ModulePage({
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
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
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
    .select("id, title, position")
    .eq("course_id", course.id)
    .order("position", { ascending: true });

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

  // Sektionen dieses Moduls (Migration 20260718150000_sections.sql).
  const { data: sections } = await supabase
    .from("sections")
    .select("id, title, position")
    .eq("module_id", mod.id)
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, section_id, position, status, video_duration_s")
    .eq("module_id", mod.id)
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

  const lessonList = lessons ?? [];
  const totalSeconds = lessonList.reduce(
    (sum, l) => sum + ((l.video_duration_s as number | null) ?? 0),
    0,
  );
  const totalMinutes = Math.round(totalSeconds / 60);
  const lessonCountLabel = `${lessonList.length} ${lessonList.length === 1 ? "Lektion" : "Lektionen"}`;
  const heroMeta = totalMinutes > 0 ? `${lessonCountLabel} · ${totalMinutes} Minuten` : lessonCountLabel;

  function lessonMinutes(seconds: number | null): string | null {
    if (!seconds) return null;
    const m = Math.round(seconds / 60);
    return `${m} ${m === 1 ? "Minute" : "Minuten"}`;
  }

  // Eine Karte je Sektion (statt vorher EINER Karte fürs ganze Modul, siehe
  // Dateikopf) + eine Auffang-Karte für Lektionen ohne Sektion. Fehlt jede
  // Sektion (Modul noch nicht auf Sektionen umgestellt), zeigt die
  // Auffang-Karte den Modultitel — exakt das bisherige Aussehen, keine
  // Regression für unveränderte Module.
  const sectionsWithLessons = (sections ?? []).map((s) => ({
    key: s.id,
    title: s.title,
    lessons: lessonList.filter((l) => l.section_id === s.id),
  }));
  const looseLessons = lessonList.filter((l) => !l.section_id);
  const lessonCards = [
    ...sectionsWithLessons,
    ...(looseLessons.length > 0
      ? [{ key: "loose", title: sectionsWithLessons.length > 0 ? "Weitere Lektionen" : mod.title, lessons: looseLessons }]
      : []),
  ].filter((card) => card.lessons.length > 0);

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb={`Lernen · ${course.title}`}
      title={mod.title}
    >
      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[1fr_300px]">
        {/* Linke Spalte */}
        <div className="min-w-0">
          <Link
            href={`/kurs/${slug}`}
            className="mb-5 inline-flex items-center gap-2 text-sm font-semibold no-underline"
            style={{ color: ACCENT }}
          >
            <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" />
            Zurück zur Kursübersicht
          </Link>

          {/* Modul-Hero */}
          <div
            className="mb-[30px] flex items-center gap-[22px] overflow-hidden rounded-[18px] p-6"
            style={{
              background: NAVY,
              backgroundImage:
                "repeating-linear-gradient(135deg,rgba(86,99,174,.5) 0 16px, rgba(62,63,102,.5) 16px 32px)",
            }}
          >
            <div
              className="hidden h-[120px] w-[170px] flex-none items-center justify-center rounded-[12px] p-1.5 text-center sm:flex"
              style={{
                backgroundColor: "#2C2D4A",
                backgroundImage:
                  "repeating-linear-gradient(45deg,#2C2D4A 0 12px, rgba(86,99,174,.35) 12px 24px)",
              }}
              aria-hidden="true"
            >
              <span className="text-xs font-extrabold leading-tight" style={{ letterSpacing: "0.08em", color: "#C9CBE6" }}>
                MODUL {moduleIndex + 1}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="mb-2 text-2xl font-extrabold text-white">{mod.title}</h1>
              <div className="text-sm font-semibold" style={{ letterSpacing: "0.04em", color: "#C9CBE6" }}>
                {heroMeta}
              </div>
            </div>
          </div>

          {/* Lektionen — eine Karte je Sektion (siehe Dateikopf) */}
          {lessonCards.length === 0 ? (
            <p className="text-base" style={{ color: "#66679B" }}>
              Dieses Modul hat noch keine veröffentlichten Lektionen.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {lessonCards.map((card) => {
                const cardSeconds = card.lessons.reduce(
                  (sum, l) => sum + ((l.video_duration_s as number | null) ?? 0),
                  0,
                );
                const cardMinutes = Math.round(cardSeconds / 60);
                return (
                  <div
                    key={card.key}
                    className="rounded-[16px] border bg-white p-[20px_22px]"
                    style={{ borderColor: "#E7E8F2" }}
                  >
                    <div className="mb-4 flex items-center gap-3.5">
                      <span
                        className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px]"
                        style={{ background: "#EDEEF7" }}
                        aria-hidden="true"
                      >
                        <ListVideo size={18} color={ACCENT} strokeWidth={2} />
                      </span>
                      <div className="flex-1 text-lg font-extrabold" style={{ color: "#1A1A2E" }}>
                        {card.title}
                      </div>
                      {cardMinutes > 0 && (
                        <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
                          <Clock size={14} strokeWidth={2} aria-hidden="true" />
                          {cardMinutes} Min.
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {card.lessons.map((l) => {
                        const done = completedIds.has(l.id);
                        const mins = lessonMinutes((l.video_duration_s as number | null) ?? null);
                        return (
                          <Link
                            key={l.id}
                            href={`/kurs/${slug}/l/${l.id}`}
                            className="flex items-center gap-3.5 rounded-[12px] border p-[12px_14px] text-inherit no-underline"
                            style={{ borderColor: "#EEF0F7" }}
                          >
                            <span
                              className="flex h-12 w-[74px] flex-none items-center justify-center rounded-[8px]"
                              style={{
                                backgroundColor: "#DFE2F4",
                                backgroundImage:
                                  "repeating-linear-gradient(45deg,#DFE2F4 0 9px, rgba(255,255,255,.55) 9px 18px)",
                              }}
                              aria-hidden="true"
                            >
                              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full" style={{ background: ACCENT }}>
                                <Play size={10} color="#fff" fill="#fff" />
                              </span>
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-base font-bold" style={{ color: "#1A1A2E" }}>
                                {l.title}
                              </div>
                              {mins && (
                                <div className="mt-1 text-xs font-semibold" style={{ color: "#A9AAC4" }}>
                                  {mins}
                                </div>
                              )}
                            </div>
                            <span
                              className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full"
                              style={{ background: done ? "#E4F5EC" : "#F0F1F8" }}
                              aria-hidden="true"
                            >
                              <Check size={14} strokeWidth={3} color={done ? "#3CA36A" : "#C6C8DC"} />
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Rechte Spalte */}
        <div className="flex flex-col gap-5">
          <Link
            href="/kontakt"
            className="block overflow-hidden rounded-[16px] no-underline"
            style={{ background: NAVY }}
          >
            <div
              className="h-[150px]"
              style={{
                backgroundColor: "#2C2D4A",
                backgroundImage:
                  "repeating-linear-gradient(135deg,#2C2D4A 0 14px, rgba(86,99,174,.4) 14px 28px)",
              }}
              aria-hidden="true"
            />
            <div className="p-[16px_18px]">
              <div className="text-base font-extrabold text-white">Kostenloses Erstgespräch buchen</div>
              <div className="mt-1 text-[13px]" style={{ color: "#C9CBE6" }}>
                Individuelle Beratung für deinen Lernweg.
              </div>
            </div>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
