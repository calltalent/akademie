import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeCourseProgress, type ModuleSummary } from "@/lib/progress/compute";
import { ProgressRing } from "@/components/learn/progress-ring";

const ACCENT = "#5663AE";
const NAVY = "#3E3F66";

/**
 * Hero-Block (Kursbild + Titel/Beschreibung + Gesamtfortschritt-Ring) +
 * Tabs-Leiste, gemeinsam genutzt von der Kurs-Übersichtsseite
 * (`kurs/[slug]/page.tsx`) UND dem neuen Information-Tab
 * (`kurs/[slug]/information/page.tsx`) — Josips Auftrag, 24.07.2026:
 * Informations-Tab für Kurse nach Baulig-Vorbild. Vorher lag dieser Block
 * unverändert nur in der Übersichtsseite; 1:1 hierher übernommen (kein
 * optischer Unterschied auf der Übersichtsseite), Tabs-Leiste um den
 * dritten Eintrag "Information" erweitert.
 *
 * Async Server Component, gleiches Selbst-Fetch-Muster wie `CertificateBadge`/
 * `PromoCards` — holt Module/Lektionen/Fortschritt selbst (identische Queries
 * wie vorher in `kurs/[slug]/page.tsx`), damit beide Seiten nur
 * `<CourseHeroHeader ... activeTab="…" />` einbinden müssen, ohne die Queries
 * zu duplizieren.
 */
export async function CourseHeroHeader({
  tenantId,
  userId,
  course,
  slug,
  activeTab,
}: {
  tenantId: string;
  userId: string;
  course: { id: string; title: string; description: string | null; cover_url: string | null };
  slug: string;
  activeTab: "overview" | "information";
}) {
  const supabase = await createClient();

  const { data: modules } = await supabase
    .from("modules")
    .select("id")
    .eq("course_id", course.id)
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, module_id")
    .in("module_id", (modules ?? []).map((m) => m.id))
    .eq("status", "published");

  const { data: progressRows } = await supabase
    .from("progress")
    .select("lesson_id, status")
    .eq("user_id", userId)
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

  return (
    <>
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
            className="hidden aspect-video w-[180px] flex-none rounded-[12px] object-cover object-center sm:block"
          />
        ) : (
          <div
            className="hidden aspect-video w-[180px] flex-none items-center justify-center rounded-[12px] sm:flex"
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

      {/* Tabs — unter `sm` je zur Hälfte gestreckt statt nur inhaltsbreit
          (24.07.2026, Josips Fund: viel Leerraum rechts auf dem Handy),
          ab `sm` wieder die ursprüngliche Inhaltsbreite (keine optische
          Änderung am Desktop). DRITTER Tab "Information" (24.07.2026,
          Informations-Tab nach Baulig-Vorbild) — vorher zwei Tabs
          (Übersicht/Lesezeichen), "Übersicht" fest als aktiv markiert. Jetzt
          `activeTab`-gesteuert: Übersicht und Information können beide aktiv
          sein, Lesezeichen bleibt nie aktiv (eigene Seite außerhalb dieses
          Kurs-Kontexts). */}
      <div className="my-[18px] mb-6 flex gap-2.5">
        {activeTab === "overview" ? (
          <span
            className="flex flex-1 items-center justify-center gap-2 rounded-[11px] px-[18px] py-[11px] text-sm font-bold text-white sm:flex-none"
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
        ) : (
          <Link
            href={`/kurs/${slug}`}
            className="flex flex-1 items-center justify-center gap-2 rounded-[11px] border bg-white px-[18px] py-[11px] text-sm font-semibold no-underline sm:flex-none"
            style={{ borderColor: "#E0E2EF", color: NAVY }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Übersicht
          </Link>
        )}

        {activeTab === "information" ? (
          <span
            className="flex flex-1 items-center justify-center gap-2 rounded-[11px] px-[18px] py-[11px] text-sm font-bold text-white sm:flex-none"
            style={{ background: NAVY }}
            aria-current="page"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="11" x2="12" y2="16" />
              <line x1="12" y1="8" x2="12" y2="8" />
            </svg>
            Information
          </span>
        ) : (
          <Link
            href={`/kurs/${slug}/information`}
            className="flex flex-1 items-center justify-center gap-2 rounded-[11px] border bg-white px-[18px] py-[11px] text-sm font-semibold no-underline sm:flex-none"
            style={{ borderColor: "#E0E2EF", color: NAVY }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="11" x2="12" y2="16" />
              <line x1="12" y1="8" x2="12" y2="8" />
            </svg>
            Information
          </Link>
        )}

        <Link
          href="/lesezeichen"
          className="flex flex-1 items-center justify-center gap-2 rounded-[11px] border bg-white px-[18px] py-[11px] text-sm font-semibold no-underline sm:flex-none"
          style={{ borderColor: "#E0E2EF", color: NAVY }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          Lesezeichen
        </Link>
      </div>
    </>
  );
}
