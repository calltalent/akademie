import { getTranslations } from "next-intl/server";
import { checkShiftPlannerAccess } from "@/lib/calendar/access";
import { createClient } from "@/lib/supabase/server";
import { SchichtplanungTabs, type SchichtplanungTab } from "@/components/admin/schichtplanung-tabs";
import {
  getActiveCalendarWorkersForSelection,
  getAdminCalendarAbsences,
  getAdminCalendarProjects,
  getAdminCalendarShifts,
  getAdminCalendarSlots,
  getAdminCalendarWorkers,
  getCalendarChangeRequests,
  getMembershipsWithoutWorker,
  getPlannerWorkerNames,
} from "@/lib/calendar/queries";
import { addDays, formatDayLabel, formatShortDayLabel, isoDateString, startOfIsoWeek } from "@/lib/calendar/date";
import { parseTenantHolidayRegions, type CalendarChangeRequestRow, type CalendarWorkerRow } from "@/lib/calendar/schema";
import { getShiftPlanJob, getShiftPlanJobs } from "@/lib/calendar/ai/queries";
import { getHolidayResearchJob, getHolidayResearchJobs } from "@/lib/calendar/ai/holidays/queries";

const ADMIN_TAB_IDS: SchichtplanungTab[] = ["workers", "projects", "shifts", "slots", "absences", "requests", "ki"];
/** Projektleiter (Block S3): NUR lesendes Wochenraster + Änderungsanfragen-Entscheidung — kein Schicht-/Zeitfenster-CRUD, kein Arbeiter-/Projektzugriff (Bauauftrag, "minimal" bewusst so entschieden). */
const PLANNER_TAB_IDS: SchichtplanungTab[] = ["shifts", "requests"];
const REQUEST_STATUS_VALUES = ["pending", "decided", "all"] as const;

/**
 * `getAdminCalendarWorkers()`/`getCalendarChangeRequests()` liefern für einen
 * Projektleiter (kein `is_staff()`, siehe `profiles_select`-Policy) keinen
 * Profil-Namen mit — die S3-Migration schließt diese Lücke über die
 * `security definer`-Funktion `calendar_planner_worker_names()`
 * (`getPlannerWorkerNames()`), die NUR die Arbeiter liefert, die der
 * Aufrufer laut RLS auch sehen darf. Diese beiden Merge-Helfer füllen
 * fehlende Namen/E-Mails nach — für einen Admin ist das ein No-op (dessen
 * Profil-Embeds sind bereits vollständig).
 */
function mergeWorkerNames(
  workers: CalendarWorkerRow[],
  names: Map<string, { fullName: string | null; email: string }>,
): CalendarWorkerRow[] {
  if (names.size === 0) return workers;
  return workers.map((w) => {
    const known = names.get(w.id);
    if (!known) return w;
    return { ...w, fullName: w.fullName ?? known.fullName, email: w.email || known.email };
  });
}

function mergeRequestWorkerNames(
  requests: CalendarChangeRequestRow[],
  names: Map<string, { fullName: string | null; email: string }>,
): CalendarChangeRequestRow[] {
  if (names.size === 0) return requests;
  return requests.map((r) => {
    const known = names.get(r.workerId);
    if (!known) return r;
    return { ...r, workerName: known.fullName || known.email || r.workerName };
  });
}

/**
 * "Schichtplanung" (Block S1 07.08.2026, URL-gesteuerte Reiter + Schicht-/
 * Zeitfenster-/Abwesenheiten-Verwaltung ergänzt Block S2 08.08.2026,
 * Änderungsanfragen + Projektleiter-Zugang ergänzt Block S3 09.08.2026).
 *
 * Zugriff über `checkShiftPlannerAccess()` (owner/admin ODER Projektleiter
 * eines Projekts, siehe `src/lib/calendar/access.ts`) — ANDERS als bis S2
 * (`checkAdminAccess()`, owner/admin exklusiv). Route liegt seit S3 in der
 * eigenen Route-Gruppe `(planung)` (reines Code-Refactoring, URL bleibt
 * `/admin/schichtplanung` — Route-Gruppen erscheinen nicht in der URL),
 * `(planung)/layout.tsx` gated bereits vorher — der `!access.ok`-Zweig hier
 * ist defensive Rückfallebene, siehe dortiger Kommentar.
 *
 * S2-Änderung (weiterhin gültig): `tab`/`week`/`year` sind echte
 * URL-Query-Parameter, S3 ergänzt `requestStatus`. Es werden NUR die Daten
 * des jeweils aktiven Reiters geladen.
 */
export default async function AdminSchichtplanungPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    week?: string;
    year?: string;
    requestStatus?: string;
    job?: string;
    holidayJob?: string;
  }>;
}) {
  const {
    tab: tabParam,
    week: weekParam,
    year: yearParam,
    requestStatus: requestStatusParam,
    job: jobParam,
    holidayJob: holidayJobParam,
  } = await searchParams;
  const t = await getTranslations("admin.shiftCalendar");
  const access = await checkShiftPlannerAccess();

  if (!access.ok) {
    // Defensive Rückfallebene — `(planung)/layout.tsx` gated bereits vorher
    // mit denselben `admin.shell`-Textschlüsseln (siehe dortiger Kommentar),
    // dieser Zweig ist im Normalbetrieb unerreichbar.
    const tShell = await getTranslations("admin.shell");
    const reasonText: Record<typeof access.reason, string> = {
      "no-tenant": tShell("reasonNoTenant"),
      "not-authenticated": tShell("reasonNotAuthenticated"),
      "feature-disabled": tShell("reasonShiftCalendarDisabled"),
      "not-allowed": tShell("reasonNotShiftPlanner"),
    };
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-base">{reasonText[access.reason]}</p>
      </div>
    );
  }

  const { tenant, isAdmin } = access;
  const supabase = await createClient();

  const allowedTabs = isAdmin ? ADMIN_TAB_IDS : PLANNER_TAB_IDS;
  const activeTab: SchichtplanungTab = allowedTabs.includes(tabParam as SchichtplanungTab)
    ? (tabParam as SchichtplanungTab)
    : allowedTabs[0];

  const requestStatus = REQUEST_STATUS_VALUES.includes(requestStatusParam as (typeof REQUEST_STATUS_VALUES)[number])
    ? (requestStatusParam as (typeof REQUEST_STATUS_VALUES)[number])
    : "pending";

  const referenceDate = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? new Date(`${weekParam}T12:00:00Z`) : new Date();
  const weekStart = startOfIsoWeek(referenceDate);
  const weekEnd = addDays(weekStart, 7);
  const currentWeekStart = startOfIsoWeek(new Date());
  const isCurrentWeek = isoDateString(weekStart) === isoDateString(currentWeekStart);
  const weekIso = isoDateString(weekStart);

  const yearNum = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : new Date().getFullYear();

  // Immer geladen — von mehreren Reitern gemeinsam genutzt. Arbeiter-
  // Auswahllisten (Mitgliedschaften ohne Arbeiterzeile, Projektleiter-
  // Optionen, aktive Arbeiter für Projektzuweisung) sind exklusiv
  // Admin-Formulare (Reiter "Arbeiter"/"Projekte") — für Projektleiter
  // übersprungen (spart Abfragen, für die RLS ohnehin nichts zurückgäbe).
  const [workersRaw, memberships, projects, workerOptions, leadMembershipsRaw, plannerNames] = await Promise.all([
    getAdminCalendarWorkers(supabase, tenant.id),
    isAdmin ? getMembershipsWithoutWorker(supabase, tenant.id) : Promise.resolve([]),
    getAdminCalendarProjects(supabase, tenant.id),
    isAdmin ? getActiveCalendarWorkersForSelection(supabase, tenant.id) : Promise.resolve([]),
    isAdmin
      ? supabase
          .from("memberships")
          .select("user_id, profiles(full_name, email)")
          .eq("tenant_id", tenant.id)
          .eq("status", "active")
      : Promise.resolve({ data: [] as { user_id: string; profiles: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null }[] }),
    getPlannerWorkerNames(supabase, tenant.id),
  ]);

  const workers = mergeWorkerNames(workersRaw, plannerNames);

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

  // Feiertagsrecherche ist admin-only (wie beim Auslösen selbst, siehe
  // `startHolidayResearchJob()`-Dateikopf) — der "absences"-Reiter ist zwar
  // bereits nicht in `PLANNER_TAB_IDS`, das `isAdmin`-Gate hier bleibt
  // trotzdem explizit, statt sich allein auf die Reiterliste zu verlassen.
  const absencesData =
    activeTab === "absences"
      ? {
          absences: await getAdminCalendarAbsences(supabase, tenant.id, yearNum),
          holidayRegions: parseTenantHolidayRegions(tenant.settings.shift_calendar_holiday_regions ?? []),
          holidayJobs: isAdmin ? await getHolidayResearchJobs(supabase, tenant.id) : [],
          holidayJobDetail:
            isAdmin && holidayJobParam ? await getHolidayResearchJob(supabase, tenant.id, holidayJobParam) : null,
        }
      : null;

  const requestsData =
    activeTab === "requests"
      ? {
          requests: mergeRequestWorkerNames(
            await getCalendarChangeRequests(supabase, tenant.id, requestStatus),
            plannerNames,
          ),
          status: requestStatus,
        }
      : null;

  // "ki" ist Admin-exklusiv (nicht in `PLANNER_TAB_IDS`) — für einen
  // Projektleiter kann `activeTab` diesen Wert daher nie annehmen.
  const kiData =
    activeTab === "ki"
      ? {
          jobs: await getShiftPlanJobs(supabase, tenant.id),
          jobDetail: jobParam ? await getShiftPlanJob(supabase, tenant.id, jobParam) : null,
        }
      : null;

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
        allowedTabs={allowedTabs}
        isAdmin={isAdmin}
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
        requestsData={requestsData}
        kiData={kiData}
      />
    </div>
  );
}
