import { getTranslations } from "next-intl/server";
import { checkAdminAccess } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { SchichtplanungTabs, type SchichtplanungTab } from "@/components/admin/schichtplanung-tabs";
import {
  getActiveCalendarWorkersForSelection,
  getAdminCalendarAbsences,
  getAdminCalendarProjects,
  getAdminCalendarShifts,
  getAdminCalendarSlots,
  getAdminCalendarWorkers,
  getMembershipsWithoutWorker,
} from "@/lib/calendar/queries";
import { addDays, formatDayLabel, formatShortDayLabel, isoDateString, startOfIsoWeek } from "@/lib/calendar/date";

const TAB_IDS: SchichtplanungTab[] = ["workers", "projects", "shifts", "slots", "absences"];

/**
 * "Schichtplanung" (Block S1 07.08.2026, URL-gesteuerte Reiter + Schicht-/
 * Zeitfenster-/Abwesenheiten-Verwaltung ergänzt Block S2 08.08.2026).
 * Zugriff über `checkAdminAccess()` (owner/admin), NICHT `checkStaffAccess()`
 * — deckt sich mit `calendar_is_admin()` (siehe Migrationskopf S1).
 *
 * S2-Änderung: `tab`/`week`/`year` sind jetzt echte URL-Query-Parameter
 * (`?tab=shifts&week=2026-08-10`) statt internem `useState` in
 * `schichtplanung-tabs.tsx` — Wochen-/Jahresnavigation bleibt dadurch
 * serverseitig konsistent (ein Link-Klick ist ein normaler Seitenaufruf),
 * UND es werden NUR die Daten des jeweils aktiven Reiters geladen (die
 * teuren Abfragen `getAdminCalendarShifts`/`getAdminCalendarSlots`/
 * `getAdminCalendarAbsences` laufen bewusst nicht bei jedem Seitenaufruf
 * mit, nur wenn der passende Reiter aktiv ist).
 */
export default async function AdminSchichtplanungPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; week?: string; year?: string }>;
}) {
  const { tab: tabParam, week: weekParam, year: yearParam } = await searchParams;
  const t = await getTranslations("admin.shiftCalendar");
  const tTeilnehmer = await getTranslations("admin.teilnehmer");
  const access = await checkAdminAccess();

  if (!access.ok) {
    const text =
      access.reason === "not-admin"
        ? tTeilnehmer("accessDeniedNotAdmin")
        : access.reason === "not-authenticated"
          ? tTeilnehmer("accessDeniedNotAuthenticated")
          : tTeilnehmer("accessDeniedNoTenant");
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-base">{text}</p>
      </div>
    );
  }

  const { tenant } = access;
  const supabase = await createClient();

  const activeTab: SchichtplanungTab = TAB_IDS.includes(tabParam as SchichtplanungTab)
    ? (tabParam as SchichtplanungTab)
    : "workers";

  const referenceDate = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? new Date(`${weekParam}T12:00:00Z`) : new Date();
  const weekStart = startOfIsoWeek(referenceDate);
  const weekEnd = addDays(weekStart, 7);
  const currentWeekStart = startOfIsoWeek(new Date());
  const isCurrentWeek = isoDateString(weekStart) === isoDateString(currentWeekStart);
  const weekIso = isoDateString(weekStart);

  const yearNum = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : new Date().getFullYear();

  // Immer geladen — von mehreren Reitern gemeinsam genutzt (Arbeiter-/
  // Projekt-Auswahllisten in den Formularen von Schichten/Zeitfenstern/
  // Abwesenheiten), Kosten gering (kleine Mandanten-Listen).
  const [workers, memberships, projects, workerOptions, leadMembershipsRaw] = await Promise.all([
    getAdminCalendarWorkers(supabase, tenant.id),
    getMembershipsWithoutWorker(supabase, tenant.id),
    getAdminCalendarProjects(supabase, tenant.id),
    getActiveCalendarWorkersForSelection(supabase, tenant.id),
    supabase
      .from("memberships")
      .select("user_id, profiles(full_name, email)")
      .eq("tenant_id", tenant.id)
      .eq("status", "active"),
  ]);

  const leadOptions = (leadMembershipsRaw.data ?? [])
    .map((m) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      if (!profile?.email) return null;
      return { userId: m.user_id as string, fullName: profile.full_name ?? null, email: profile.email as string };
    })
    .filter((m): m is { userId: string; fullName: string | null; email: string } => m !== null);

  // Nur der jeweils aktive Reiter lädt seine (teureren) Zusatzdaten.
  const shiftsData =
    activeTab === "shifts"
      ? {
          shifts: await getAdminCalendarShifts(supabase, tenant.id, weekStart.toISOString(), weekEnd.toISOString()),
          slots: await getAdminCalendarSlots(supabase, tenant.id, weekStart.toISOString(), weekEnd.toISOString()),
          absences: await getAdminCalendarAbsences(supabase, tenant.id, weekStart.getUTCFullYear()),
        }
      : null;

  const slotsData =
    activeTab === "slots"
      ? { slots: await getAdminCalendarSlots(supabase, tenant.id, weekStart.toISOString(), weekEnd.toISOString()) }
      : null;

  const absencesData =
    activeTab === "absences" ? { absences: await getAdminCalendarAbsences(supabase, tenant.id, yearNum) } : null;

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    return {
      isoDate: isoDateString(date),
      dayLabel: formatDayLabel(date),
      shortLabel: formatShortDayLabel(date),
      isToday: isoDateString(date) === isoDateString(new Date()),
    };
  });

  const weekYear = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(weekStart);
  const weekLabel = `${formatShortDayLabel(weekStart)} – ${formatShortDayLabel(addDays(weekStart, 6))} ${weekYear}`;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
          {t("eyebrow")}
        </div>
        <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
          {t("title")}
        </h1>
      </header>

      <SchichtplanungTabs
        activeTab={activeTab}
        weekIso={weekIso}
        prevWeekIso={isoDateString(addDays(weekStart, -7))}
        nextWeekIso={isoDateString(addDays(weekStart, 7))}
        year={yearNum}
        weekLabel={weekLabel}
        isCurrentWeek={isCurrentWeek}
        days={days}
        workers={workers}
        memberships={memberships}
        projects={projects}
        leadOptions={leadOptions}
        workerOptions={workerOptions}
        shiftsData={shiftsData}
        slotsData={slotsData}
        absencesData={absencesData}
      />
    </div>
  );
}
