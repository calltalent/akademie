import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { computeCourseProgress, type ModuleSummary } from "@/lib/progress/compute";
import { CertificateBadge } from "@/components/learn/certificate-badge";
import { AppShell } from "@/components/learn/app-shell";

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
 * Dauern hinterlegt — keine Fantasiezahl). Bewusste Abweichungen vom Export:
 * (1) der „Information"-Tab zeigt im Export auf `#` — weggelassen statt als
 * toter Link auszuliefern (gleiche Linie wie Josips „keine toten Links");
 * (2) das „Weiter"-Banner entfällt, wenn nichts mehr offen ist (Kurs fertig
 * bzw. leer) — dann steht dort ggf. das echte Zertifikat (CertificateBadge).
 * Hero-Thumbnail zeigt `courses.cover_url` (18.07.2026, Kursbild-Upload-
 * Feature), sobald eines gesetzt ist — sonst der stilisierte CSS-Platzhalter
 * aus dem Export. Die „App"-Kachel rechts bleibt statischer Marketing-Inhalt
 * (kein erfundenes Datenmodell dafür).
 */

const ACCENT = "#5663AE";
const NAVY = "#3E3F66";

export default async function CourseOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
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
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");

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
        breadcrumb="Lernen · Meine Kurse"
        title="Kurs nicht gefunden"
      >
        <p className="text-base" style={{ color: "#66679B" }}>
          Kurs nicht gefunden oder nicht veröffentlicht.
        </p>
      </AppShell>
    );
  }

  const { data: modules } = await supabase
    .from("modules")
    .select("id, title, position")
    .eq("course_id", course.id)
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, module_id, status, position, video_duration_s")
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
      const lessonLabel = `${mLessons.length} ${mLessons.length === 1 ? "Lektion" : "Lektionen"}`;
      const meta = minutes > 0 ? `${lessonLabel} · ${minutes} Min.` : lessonLabel;
      return { id: m.id, title: m.title, number: i + 1, pct, meta };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <AppShell
      isStaff={isStaff ?? false}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb="Lernen · Meine Kurse · Übersicht"
      title={course.title}
    >
      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[1fr_300px]">
        {/* Linke Spalte */}
        <div className="min-w-0">
          {/* Hero */}
          <div
            className="flex items-center gap-6 overflow-hidden rounded-[18px] p-[26px]"
            style={{
              background: NAVY,
              backgroundImage:
                "repeating-linear-gradient(135deg,rgba(86,99,174,.5) 0 16px, rgba(62,63,102,.5) 16px 32px)",
            }}
          >
            {course.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
              <img
                src={course.cover_url}
                alt=""
                className="hidden h-[130px] w-[180px] flex-none rounded-[12px] object-cover object-center sm:block"
              />
            ) : (
              <div
                className="hidden h-[130px] w-[180px] flex-none items-center justify-center rounded-[12px] sm:flex"
                style={{
                  backgroundColor: "#2C2D4A",
                  backgroundImage:
                    "repeating-linear-gradient(45deg,#2C2D4A 0 12px, rgba(86,99,174,.35) 12px 24px)",
                }}
                aria-hidden="true"
              >
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#C9CBE6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 9V5a3 3 0 0 0-6 0v4" />
                  <rect x="2" y="9" width="20" height="12" rx="2" />
                </svg>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold" style={{ letterSpacing: "0.2em", color: "#B9BBDA" }}>
                KURS
              </div>
              <h1 className="mb-2 mt-1.5 text-[26px] font-extrabold text-white">{course.title}</h1>
              {course.description && (
                <p className="m-0 max-w-[520px] text-[15px]" style={{ color: "#DDDEEE" }}>
                  {course.description}
                </p>
              )}
            </div>
            <div className="hidden flex-none md:block">
              <ProgressRing
                size={96}
                radius={42}
                stroke={7}
                track="rgba(255,255,255,.18)"
                color="#8BE0B7"
                pct={progress.percent}
                label={`${progress.percent}%`}
                labelColor="#fff"
                labelSize={22}
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="my-[18px] mb-6 flex gap-2.5">
            <span
              className="inline-flex items-center gap-2 rounded-[11px] px-[18px] py-[11px] text-sm font-bold text-white"
              style={{ background: NAVY }}
              aria-current="page"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Übersicht
            </span>
            <Link
              href="/lesezeichen"
              className="inline-flex items-center gap-2 rounded-[11px] border bg-white px-[18px] py-[11px] text-sm font-semibold no-underline"
              style={{ borderColor: "#E0E2EF", color: NAVY }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              Lesezeichen
            </Link>
          </div>

          {/* Zertifikat (nur bei abgeschlossenem Kurs sichtbar) */}
          <CertificateBadge tenantId={tenant.id} courseId={course.id} isComplete={progress.isComplete} />

          {/* „Weiter"-Banner — nur wenn es eine offene Lektion gibt */}
          {nextLesson && (
            <Link
              href={`/kurs/${slug}/l/${nextLesson.id}`}
              className="mb-[30px] mt-4 flex items-center gap-[18px] rounded-[14px] p-[16px_18px] no-underline"
              style={{ background: NAVY }}
            >
              <div
                className="flex h-14 w-[88px] flex-none items-center justify-center rounded-[9px]"
                style={{
                  backgroundColor: "#2C2D4A",
                  backgroundImage:
                    "repeating-linear-gradient(45deg,#2C2D4A 0 10px, rgba(86,99,174,.4) 10px 20px)",
                }}
                aria-hidden="true"
              >
                <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full" style={{ background: ACCENT }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold" style={{ letterSpacing: "0.14em", color: "#B9BBDA" }}>
                  {progress.completed > 0 ? "MACHE DIREKT WEITER!" : "STARTE DEINEN KURS!"}
                </div>
                <div className="mt-[3px] truncate text-[17px] font-bold text-white">{nextLesson.title}</div>
              </div>
              <span
                className="inline-flex flex-none items-center gap-2 rounded-[11px] px-[18px] py-[11px] text-sm font-bold text-white"
                style={{ background: ACCENT }}
              >
                {progress.completed > 0 ? "Fortsetzen" : "Starten"}
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
            <h2 className="m-0 text-xl font-extrabold">Module</h2>
          </div>

          {moduleCards.length === 0 ? (
            <p className="text-base" style={{ color: "#66679B" }}>
              Dieser Kurs hat noch keine veröffentlichten Inhalte.
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
                      MODUL {m.number}
                    </span>
                  </div>
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

          <div className="overflow-hidden rounded-[16px] border" style={{ background: "#EDEEF7", borderColor: "#E0E2EF" }}>
            <div
              className="h-[130px]"
              style={{
                backgroundColor: "#DFE2F4",
                backgroundImage:
                  "repeating-linear-gradient(45deg,#DFE2F4 0 12px, rgba(255,255,255,.55) 12px 24px)",
              }}
              aria-hidden="true"
            />
            <div className="p-[16px_18px]">
              <div className="text-base font-extrabold" style={{ color: NAVY }}>
                Nutze die Calltalent-App
              </div>
              <div className="mt-1 text-[13px]" style={{ color: "#66679B" }}>
                Lerne unterwegs — jederzeit und überall.
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Reiner SVG-Fortschrittsring (Server-Component). Umfang = 2πr, der sichtbare
 * Bogen wird über stroke-dashoffset gesteuert; um 90° gedreht, damit er oben
 * beginnt — 1:1 wie im Design-Export.
 */
function ProgressRing({
  size,
  radius,
  stroke,
  track,
  color,
  pct,
  label,
  labelColor,
  labelSize,
}: {
  size: number;
  radius: number;
  stroke: number;
  track: string;
  color: string;
  pct: number;
  label: string;
  labelColor: string;
  labelSize: number;
}) {
  const circumference = 2 * Math.PI * radius;
  const offset = Math.max(0, Math.round(circumference - (circumference * pct) / 100));
  const c = size / 2;
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`${pct}% abgeschlossen`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={c}
          cy={c}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center font-extrabold"
        style={{ color: labelColor, fontSize: labelSize }}
      >
        {label}
      </div>
    </div>
  );
}
