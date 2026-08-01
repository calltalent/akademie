import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { computeCourseProgress, type ModuleSummary } from "@/lib/progress/compute";
import { CertificateBadge } from "@/components/learn/certificate-badge";
import { PromoCards } from "@/components/learn/promo-cards";
import { AppShell } from "@/components/learn/app-shell";
import { CourseHeroHeader } from "@/components/learn/course-hero-header";
import { ProgressRing } from "@/components/learn/progress-ring";
import { getVideoThumbnailUrl } from "@/lib/bunny/client";

/**
 * Design-Block (16.07.2026, Claude-Design-Import KursUebersicht.dc.html aus
 * dem Design-Projekt „Calltalent-Akademie Studenten-Portal"). Neugestaltung
 * DIESER bereits vorhandenen Kurs-Übersichtsseite (`/kurs/[slug]`, hiess auch
 * vorher schon CourseOverviewPage): aus der schlichten, schalenlosen Alt-
 * Ansicht wird das Marken-Layout mit Hero + Gesamtfortschritt-Ring, Tabs,
 * „Weiter"-Banner und Modul-Liste mit Pro-Modul-Fortschrittsringen, gerahmt
 * von der gemeinsamen AppShell (Sidebar/TopBar) wie die übrigen Lernseiten.
 *
 * Alle Werte real aus Supabase (kein erfundener Zähler, DESIGN-MASTERPROMPT.md
 * §8.1): Gesamt-% und Pro-Modul-% aus `progress`, „Weiter"-Lektion = erste
 * noch nicht abgeschlossene Lektion in Reihenfolge, Modul-Meta „N Lektionen ·
 * M Min." aus `lessons.video_duration_s` (Minuten weggelassen, falls keine
 * Dauern hinterlegt — keine Fantasiezahl). Bewusste Abweichung vom Export:
 * das „Weiter"-Banner entfällt, wenn nichts mehr offen ist (Kurs fertig bzw.
 * leer) — dann steht dort ggf. das echte Zertifikat (CertificateBadge).
 *
 * NACHTRAG (24.07.2026, Josips Auftrag "Informations-Tab nach Baulig-
 * Vorbild"): der „Information"-Tab, der im Export nur auf `#` zeigte und
 * deshalb bisher bewusst weggelassen war (siehe vorherige Fassung dieses
 * Kommentars), existiert jetzt echt — Kursziele + Autor sind ergänzt
 * (Migration 20260724130000_course_information.sql), der Tab führt auf
 * `/kurs/[slug]/information`. Hero- und Tabs-Block liegen seither in der
 * gemeinsam genutzten `CourseHeroHeader`-Komponente (siehe
 * `src/components/learn/course-hero-header.tsx`).
 * Hero-Thumbnail zeigt `courses.cover_url` (18.07.2026, Kursbild-Upload-
 * Feature), sobald eines gesetzt ist — sonst der stilisierte CSS-Platzhalter
 * aus dem Export. Die „App"-Kachel rechts bleibt statischer Marketing-Inhalt
 * (kein erfundenes Datenmodell dafür).
 *
 * Modulkacheln zeigen analog `modules.cover_url` (19.07.2026, Modulbild-
 * Feature), das „Weiter"-Banner das Bunny-Video-Thumbnail der nächsten
 * Lektion (`getVideoThumbnailUrl()`, siehe Kopfkommentar dort zur
 * "erster Frame"-Einschränkung) — jeweils mit Fallback auf den bisherigen
 * Platzhalter, falls (noch) kein Bild bzw. kein Video gesetzt ist.
 */

const ACCENT = "#5663AE";
const NAVY = "#3E3F66";

export default async function CourseOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("learn.overview");
  const tShared = await getTranslations("learn.shared");
  const tNotFound = await getTranslations("learn.notFound");
  const tenant = await getTenant();
  // Wie in lesezeichen/page.tsx: RSC wertet die Seite auch aus, wenn ein
  // übergeordneter Gate greift — defensiv statt auf tenant!.id zu laufen.
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
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : tShared("fallbackUserName"));

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description, status, cover_url")
    .eq("tenant_id", tenant.id)
    .eq("slug", slug)
    .maybeSingle();

  if (!course) {
    return (
      <AppShell
        isStaff={isStaff ?? false}
        userName={displayName}
        userEmail={user.email ?? undefined}
        breadcrumb={tShared("myCoursesBreadcrumb")}
        title={tNotFound("course.title")}
      >
        <p className="text-base" style={{ color: "#66679B" }}>
          {tNotFound("course.body")}
        </p>
      </AppShell>
    );
  }

  const { data: modules } = await supabase
    .from("modules")
    .select("id, title, position, cover_url")
    .eq("course_id", course.id)
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, module_id, status, position, video_duration_s, video_bunny_id")
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

  // Lektionen in Modul-/Positions-Reihenfolge; „Weiter" = erste offene.
  const orderedLessons = (modules ?? []).flatMap((m) =>
    (lessons ?? []).filter((l) => l.module_id === m.id),
  );
  const nextLesson = orderedLessons.find((l) => !completedIds.has(l.id)) ?? null;
  const nextLessonThumbUrl = nextLesson?.video_bunny_id
    ? getVideoThumbnailUrl(nextLesson.video_bunny_id as string)
    : null;

  const moduleCards = (modules ?? [])
    .map((m, i) => {
      const mLessons = (lessons ?? []).filter((l) => l.module_id === m.id);
      if (mLessons.length === 0) return null;
      const done = mLessons.filter((l) => completedIds.has(l.id)).length;
      const pct = Math.round((done / mLessons.length) * 100);
      const totalSeconds = mLessons.reduce(
        (sum, l) => sum + ((l.video_duration_s as number | null) ?? 0),
        0,
      );
      const minutes = Math.round(totalSeconds / 60);
      const lessonLabel = tShared("lessonsCount", { count: mLessons.length });
      const meta = minutes > 0 ? `${lessonLabel} · ${tShared("minutesShort", { count: minutes })}` : lessonLabel;
      return { id: m.id, title: m.title, coverUrl: (m.cover_url as string | null) ?? null, number: i + 1, pct, meta };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <AppShell
      isStaff={isStaff ?? false}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb={t("breadcrumb")}
      title={course.title}
      hideTitle
    >
      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[1fr_300px]">
        {/* Linke Spalte */}
        <div className="min-w-0">
          <CourseHeroHeader
            tenantId={tenant.id}
            userId={user.id}
            course={course}
            slug={slug}
            activeTab="overview"
          />

          {/* Zertifikat (nur bei abgeschlossenem Kurs sichtbar) */}
          <CertificateBadge tenantId={tenant.id} courseId={course.id} />

          {/* „Weiter"-Banner — nur wenn es eine offene Lektion gibt */}
          {nextLesson && (
            <Link
              href={`/kurs/${slug}/l/${nextLesson.id}`}
              className="mb-[30px] mt-4 flex items-center gap-[18px] rounded-[14px] p-[16px_18px] no-underline"
              style={{ background: NAVY }}
            >
              <div
                className="relative flex h-14 w-[88px] flex-none items-center justify-center overflow-hidden rounded-[9px]"
                style={
                  nextLessonThumbUrl
                    ? undefined
                    : {
                        backgroundColor: "#2C2D4A",
                        backgroundImage:
                          "repeating-linear-gradient(45deg,#2C2D4A 0 10px, rgba(86,99,174,.4) 10px 20px)",
                      }
                }
                aria-hidden="true"
              >
                {nextLessonThumbUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- Bunny-CDN-URL, kein next/image-Loader konfiguriert
                  <img src={nextLessonThumbUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-center" />
                )}
                <span
                  className="relative flex h-[30px] w-[30px] items-center justify-center rounded-full"
                  style={{ background: ACCENT }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold" style={{ letterSpacing: "0.14em", color: "#B9BBDA" }}>
                  {progress.completed > 0 ? t("continueBannerActive") : t("continueBannerStart")}
                </div>
                <div className="mt-[3px] truncate text-[17px] font-bold text-white">{nextLesson.title}</div>
              </div>
              <span
                className="inline-flex flex-none items-center gap-2 rounded-[11px] px-[18px] py-[11px] text-sm font-bold text-white"
                style={{ background: ACCENT }}
              >
                {progress.completed > 0 ? t("continueButton") : t("startButton")}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </span>
            </Link>
          )}

          {/* Module */}
          <div className="mb-3.5 flex items-center gap-2.5">
            <span className="h-[22px] w-1 rounded-[3px]" style={{ background: ACCENT }} />
            <h2 className="m-0 text-xl font-extrabold">{t("modulesHeading")}</h2>
          </div>

          {moduleCards.length === 0 ? (
            <p className="text-base" style={{ color: "#66679B" }}>
              {t("noPublishedContent")}
            </p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {moduleCards.map((m) => (
                <Link
                  key={m.id}
                  href={`/kurs/${slug}/m/${m.id}`}
                  className="flex items-center gap-[18px] rounded-[14px] border bg-white p-[16px_18px] text-inherit no-underline"
                  style={{ borderColor: "#E7E8F2" }}
                >
                  {m.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
                    <img src={m.coverUrl} alt="" className="h-16 w-24 flex-none rounded-[10px] object-cover object-center" />
                  ) : (
                    <div
                      className="flex h-16 w-24 flex-none items-center justify-center rounded-[10px] p-1.5 text-center"
                      style={{
                        backgroundColor: NAVY,
                        backgroundImage:
                          "repeating-linear-gradient(135deg,rgba(86,99,174,.5) 0 12px, rgba(62,63,102,.5) 12px 24px)",
                      }}
                      aria-hidden="true"
                    >
                      <span className="text-[11px] font-extrabold leading-tight" style={{ letterSpacing: "0.08em", color: "#C9CBE6" }}>
                        {tShared("moduleEyebrow", { number: m.number })}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-bold" style={{ color: "#1A1A2E" }}>
                      {m.title}
                    </div>
                    <div className="mt-[3px] text-[13px] font-semibold uppercase" style={{ letterSpacing: "0.04em", color: "#A9AAC4" }}>
                      {m.meta}
                    </div>
                  </div>
                  <div className="flex-none">
                    <ProgressRing
                      size={58}
                      radius={24}
                      stroke={6}
                      track="#EEF0F7"
                      color={ACCENT}
                      pct={m.pct}
                      label={`${m.pct}%`}
                      labelColor={NAVY}
                      labelSize={14}
                    />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Rechte Spalte — admin-verwaltete Positionen (Josips Auftrag,
            24.07.2026), ersetzen die bisher fest verdrahteten "Kostenloses
            Erstgespräch buchen"/"Nutze die Calltalent-App"-Kärtchen. */}
        <div className="flex flex-col gap-5">
          <PromoCards tenantId={tenant.id} />
        </div>
      </div>
    </AppShell>
  );
}
