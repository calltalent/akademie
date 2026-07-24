import Link from "next/link";
import type { ReactNode } from "react";
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

      {/* Tabs — reine Symbol-Buttons ohne Textlabel (24.07.2026, Josips
          Auftrag: "als Symbole darstellen"). Auf dem Handy als Gruppe
          zentriert (`justify-center`), ab `sm` linksbündig
          (`sm:justify-start`) — vorher wurden die Buttons auf dem Handy zu
          je 1/3 gestreckt, das entfällt mit dem Wegfall der Textlabel.
          Sichtbares Label entfällt hier bewusst zugunsten der
          Symbol-Optik (CLAUDE.md §3.4 "sichtbares Label, kein reines ARIA"
          gilt für Formularfelder; für diese reine Navigations-Leiste bleibt
          die Bedeutung stattdessen über `aria-label`/`title` je Button
          zugänglich, exakt wie bei `CourseCategorySelect`s `compact`-Fall).
          DRITTER Tab "Information" (24.07.2026, Informations-Tab nach
          Baulig-Vorbild) — `activeTab`-gesteuert: Übersicht und Information
          können beide aktiv sein, Lesezeichen bleibt nie aktiv (eigene Seite
          außerhalb dieses Kurs-Kontexts). */}
      <div className="my-[18px] mb-6 flex justify-center gap-2.5 sm:justify-start">
        <TabIconButton
          active={activeTab === "overview"}
          href={`/kurs/${slug}`}
          label="Übersicht"
          icon={(color) => (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          )}
        />
        <TabIconButton
          active={activeTab === "information"}
          href={`/kurs/${slug}/information`}
          label="Information"
          icon={(color) => (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="11" x2="12" y2="16" />
              <line x1="12" y1="8" x2="12" y2="8" />
            </svg>
          )}
        />
        <TabIconButton
          active={false}
          href="/lesezeichen"
          label="Lesezeichen"
          icon={(color) => (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          )}
        />
      </div>
    </>
  );
}

/**
 * Ein einzelner Symbol-Tab (aktiv = navy gefüllt + weißes Icon, inaktiv =
 * weiß mit Rand + Icon in ACCENT). Fester `h-11 w-11`-Touch-Bereich (44px,
 * gängige Mindestgröße) statt der bisherigen textbreiten Pille — `icon` ist
 * eine Funktion, weil Aktiv-/Inaktiv-Zustand unterschiedliche Strichfarben
 * brauchen.
 */
function TabIconButton({
  active,
  href,
  label,
  icon,
}: {
  active: boolean;
  href: string;
  label: string;
  icon: (color: string) => ReactNode;
}) {
  const className = `flex h-11 w-11 flex-none items-center justify-center rounded-[11px] no-underline${
    active ? "" : " border bg-white"
  }`;

  if (active) {
    return (
      <span
        className={className}
        style={{ background: NAVY }}
        aria-current="page"
        aria-label={label}
        title={label}
      >
        {icon("#fff")}
      </span>
    );
  }

  return (
    <Link href={href} className={className} style={{ borderColor: "#E0E2EF" }} aria-label={label} title={label}>
      {icon(ACCENT)}
    </Link>
  );
}
