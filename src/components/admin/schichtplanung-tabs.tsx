"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarWorkersPanel, type CalendarMembershipOption } from "@/components/admin/calendar-workers-panel";
import {
  CalendarProjectsPanel,
  type CalendarLeadOption,
  type CalendarWorkerOption,
} from "@/components/admin/calendar-projects-panel";
import { CalendarShiftsPanel } from "@/components/admin/calendar-shifts-panel";
import { CalendarSlotsPanel } from "@/components/admin/calendar-slots-panel";
import { CalendarAbsencesPanel } from "@/components/admin/calendar-absences-panel";
import { CalendarChangeRequestsPanel } from "@/components/admin/calendar-change-requests-panel";
import { CalendarKiPanel } from "@/components/admin/calendar-ki-panel";
import { CalendarKiReview } from "@/components/admin/calendar-ki-review";
import type {
  CalendarAbsenceRow,
  CalendarAdminShiftRow,
  CalendarChangeRequestRow,
  CalendarHolidayRegionCode,
  CalendarProjectRow,
  CalendarSlotRow,
  CalendarWorkerRow,
} from "@/lib/calendar/schema";
import type { ShiftPlanJobDetail, ShiftPlanJobListRow } from "@/lib/calendar/ai/queries";
import type { HolidayResearchJobDetail, HolidayResearchJobListRow } from "@/lib/calendar/ai/holidays/queries";

/**
 * Sechs Reiter (Arbeiter/Projekte/Schichten/Zeitfenster/Abwesenheiten/
 * Änderungsanfragen) plus ein siebter Admin-exklusiver Reiter "KI-Planung"
 * für `/admin/schichtplanung` — Block S1 (Arbeiter/Projekte) + Block S2
 * (08.08.2026, Schichten/Zeitfenster/Abwesenheiten) + Block S4 (08.08.2026,
 * KI-Planung, `ki` ist NICHT in `PLANNER_TAB_IDS` — siehe Dateikopf
 * `calendar-ki-panel.tsx`). Alle Daten kommen fertig vom Server geladen
 * (`admin/schichtplanung/page.tsx` lädt NUR die Daten des aktiven Reiters),
 * diese Komponente entscheidet nur noch, welcher Panel gerendert wird, und
 * steuert die URL (`?tab=…&week=…&year=…`, für "ki" zusätzlich `&job=…`).
 *
 * DOKUMENTIERTE ABWEICHUNG vom Bau-Auftrag-Wortlaut ("`<Link href="?tab=...">`
 * statt `onClick`/`useState`"): ein echtes `<Link>` hätte einen
 * Accessibility-Tree-Knoten mit Rolle `"link"` (bzw. explizit `"tab"`) —
 * `e2e/schichtplan.spec.ts` (S1, UNVERÄNDERT, Regressionsnetz) klickt aber
 * `page.getByRole("button", { name: "Projekte" })`. Ein `<a>`/`role="tab"`
 * matcht diese Rollen-Abfrage NICHT (bei Code-Review in Abschnitt 14 des
 * S2-Bauauftrags entdeckt) — S1 darf laut Auftrag NICHT geändert werden.
 * Deshalb: echte `<button>`-Elemente (native Rolle `"button"`, S1-Selektor
 * bleibt gültig) mit `onClick={() => router.push(href)}` — `router.push()`
 * navigiert trotzdem zu einer neuen URL mit neuen `searchParams`, der
 * Server-Component-Baum der Route wird dabei neu ausgeführt (exakt dieselbe
 * "URL-gesteuert, Wochen-/Jahresnavigation bleibt serverseitig konsistent"-
 * Eigenschaft wie ein `<Link>`, nur ohne dessen Fallback ohne JavaScript).
 * Macht diese Komponente zwangsläufig `"use client"` (ein Server Component
 * kann keinen Router-Hook verwenden) — die fünf Panels waren ohnehin bereits
 * `"use client"`.
 */
export type SchichtplanungTab = "workers" | "projects" | "shifts" | "slots" | "absences" | "requests" | "ki";

type ShiftsData = { shifts: CalendarAdminShiftRow[]; slots: CalendarSlotRow[]; absences: CalendarAbsenceRow[] } | null;
type SlotsData = { slots: CalendarSlotRow[] } | null;
type AbsencesData = {
  absences: CalendarAbsenceRow[];
  holidayRegions: CalendarHolidayRegionCode[];
  holidayJobs: HolidayResearchJobListRow[];
  holidayJobDetail: HolidayResearchJobDetail | null;
} | null;
type RequestsData = { requests: CalendarChangeRequestRow[]; status: "pending" | "decided" | "all" } | null;
type KiData = { jobs: ShiftPlanJobListRow[]; jobDetail: ShiftPlanJobDetail | null } | null;

function buildTabHref(tab: SchichtplanungTab, weekIso: string, year: number): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (weekIso) params.set("week", weekIso);
  if (year) params.set("year", String(year));
  if (tab === "requests") params.set("requestStatus", "pending");
  return `?${params.toString()}`;
}

export function SchichtplanungTabs({
  activeTab,
  allowedTabs,
  isAdmin,
  weekIso,
  prevWeekIso,
  nextWeekIso,
  year,
  weekLabel,
  isCurrentWeek,
  days,
  workers,
  memberships,
  projects,
  leadOptions,
  workerOptions,
  shiftsData,
  slotsData,
  absencesData,
  requestsData,
  kiData,
}: {
  activeTab: SchichtplanungTab;
  /** Rollenfilterung (Block S3) — Admin: alle sieben Reiter, Projektleiter: nur `["shifts", "requests"]`. */
  allowedTabs: SchichtplanungTab[];
  /** Steuert `readOnly` auf dem Schichten-Panel — Projektleiter dürfen NUR lesen (kein Schicht-CRUD). */
  isAdmin: boolean;
  weekIso: string;
  prevWeekIso: string;
  nextWeekIso: string;
  year: number;
  weekLabel: string;
  isCurrentWeek: boolean;
  days: { isoDate: string; dayLabel: string; shortLabel: string; isToday: boolean }[];
  workers: CalendarWorkerRow[];
  memberships: CalendarMembershipOption[];
  projects: CalendarProjectRow[];
  leadOptions: CalendarLeadOption[];
  workerOptions: CalendarWorkerOption[];
  shiftsData: ShiftsData;
  slotsData: SlotsData;
  absencesData: AbsencesData;
  requestsData: RequestsData;
  kiData: KiData;
}) {
  const t = useTranslations("admin.shiftCalendar.tabs");
  const router = useRouter();

  const TAB_LABELS: Record<SchichtplanungTab, string> = {
    workers: t("workers"),
    projects: t("projects"),
    shifts: t("shifts"),
    slots: t("slots"),
    absences: t("absences"),
    requests: t("requests"),
    ki: t("ki"),
  };

  const activeProjects = projects.filter((p) => p.status === "active");

  return (
    <div>
      <div className="mb-[22px] flex flex-wrap gap-1.5 border-b border-border-200">
        {allowedTabs.map((tabId) => {
          const active = tabId === activeTab;
          return (
            <button
              key={tabId}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => router.push(buildTabHref(tabId, weekIso, year))}
              className="-mb-px px-[18px] py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/40"
              style={{
                fontWeight: active ? 700 : 500,
                color: active ? "#5663AE" : "#66679B",
                borderBottom: active ? "2px solid #5663AE" : "2px solid transparent",
              }}
            >
              {TAB_LABELS[tabId]}
            </button>
          );
        })}
      </div>

      {activeTab === "workers" && <CalendarWorkersPanel workers={workers} memberships={memberships} />}
      {activeTab === "projects" && (
        <CalendarProjectsPanel projects={projects} leadOptions={leadOptions} workerOptions={workerOptions} />
      )}
      {activeTab === "shifts" && shiftsData && (
        <CalendarShiftsPanel
          workers={workers.filter((w) => w.status === "active")}
          projects={activeProjects}
          days={days}
          shifts={shiftsData.shifts}
          slots={shiftsData.slots}
          absences={shiftsData.absences}
          weekLabel={weekLabel}
          isCurrentWeek={isCurrentWeek}
          prevWeekHref={buildTabHref("shifts", prevWeekIso, year)}
          nextWeekHref={buildTabHref("shifts", nextWeekIso, year)}
          todayHref="?tab=shifts"
          readOnly={!isAdmin}
        />
      )}
      {activeTab === "slots" && slotsData && (
        <CalendarSlotsPanel
          projects={activeProjects}
          slots={slotsData.slots}
          weekLabel={weekLabel}
          isCurrentWeek={isCurrentWeek}
          prevWeekHref={buildTabHref("slots", prevWeekIso, year)}
          nextWeekHref={buildTabHref("slots", nextWeekIso, year)}
          todayHref="?tab=slots"
        />
      )}
      {activeTab === "absences" && absencesData && (
        <CalendarAbsencesPanel
          workers={workers.filter((w) => w.status === "active")}
          absences={absencesData.absences}
          year={year}
          holidayRegions={absencesData.holidayRegions}
          holidayJobs={absencesData.holidayJobs}
          holidayJobDetail={absencesData.holidayJobDetail}
        />
      )}
      {activeTab === "requests" && requestsData && (
        <CalendarChangeRequestsPanel
          requests={requestsData.requests}
          status={requestsData.status}
          weekIso={weekIso}
          year={year}
        />
      )}
      {activeTab === "ki" && kiData && kiData.jobDetail && (
        <CalendarKiReview job={kiData.jobDetail} backHref="?tab=ki" />
      )}
      {activeTab === "ki" && kiData && !kiData.jobDetail && (
        <CalendarKiPanel
          projects={activeProjects}
          workers={workers.filter((w) => w.status === "active")}
          jobs={kiData.jobs}
          onOpenJob={(jobId) => router.push(`?tab=ki&job=${jobId}`)}
        />
      )}
    </div>
  );
}
