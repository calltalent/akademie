"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarWorkersPanel, type CalendarMembershipOption } from "@/components/admin/calendar-workers-panel";
import {
  CalendarProjectsPanel,
  type CalendarLeadOption,
  type CalendarWorkerOption,
} from "@/components/admin/calendar-projects-panel";
import type { CalendarProjectRow, CalendarWorkerRow } from "@/lib/calendar/schema";

/**
 * Zwei Reiter (Arbeiter/Projekte) für `/admin/schichtplanung` (Block S1,
 * 07.08.2026) — optische Vorlage `einstellungen-tabs.tsx` (aktiv #5663AE).
 */
type Tab = "workers" | "projects";

export function SchichtplanungTabs({
  workers,
  memberships,
  projects,
  leadOptions,
  workerOptions,
}: {
  workers: CalendarWorkerRow[];
  memberships: CalendarMembershipOption[];
  projects: CalendarProjectRow[];
  leadOptions: CalendarLeadOption[];
  workerOptions: CalendarWorkerOption[];
}) {
  const t = useTranslations("admin.shiftCalendar.tabs");
  const [tab, setTab] = useState<Tab>("workers");
  const TAB_LABELS: Record<Tab, string> = { workers: t("workers"), projects: t("projects") };

  return (
    <div>
      <div className="mb-[22px] flex gap-1.5 border-b border-border-200">
        {(Object.keys(TAB_LABELS) as Tab[]).map((tabId) => {
          const active = tabId === tab;
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => setTab(tabId)}
              aria-current={active ? "page" : undefined}
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

      {tab === "workers" && <CalendarWorkersPanel workers={workers} memberships={memberships} />}
      {tab === "projects" && (
        <CalendarProjectsPanel projects={projects} leadOptions={leadOptions} workerOptions={workerOptions} />
      )}
    </div>
  );
}
