import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarHolidayRegionCode } from "@/lib/calendar/schema";
import { REGION_LABELS } from "@/lib/calendar/ai/holidays/prompt";
import {
  holidayResearchOutputSchema,
  holidayResearchRequestSchema,
  type HolidayCheck,
  type HolidayConflict,
} from "@/lib/calendar/ai/holidays/schema";

/**
 * Leseabfragen für die KI-Feiertagsrecherche (Block S5b, 08.08.2026) —
 * laufen über den regulären RLS-Client (`ai_jobs_staff_select` deckt
 * owner/admin über `calendar_is_admin()` ab, siehe Migration
 * `20260808145112_calendar_holiday_research.sql`). Kein separater
 * Admin-Client nötig, da hier nur gelesen wird. Gleiches Muster wie
 * `src/lib/calendar/ai/queries.ts` (S4-Vorbild).
 */

export type HolidayResearchJobListRow = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  year: number;
  regions: CalendarHolidayRegionCode[];
  createdAt: string;
  error: string | null;
};

export async function getHolidayResearchJobs(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<HolidayResearchJobListRow[]> {
  const { data } = await supabase
    .from("ai_jobs")
    .select("id, status, input, created_at, error")
    .eq("tenant_id", tenantId)
    .eq("kind", "holiday_research")
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as {
    id: string;
    status: string;
    input: unknown;
    created_at: string;
    error: string | null;
  }[];

  return rows.map((r) => {
    const parsedInput = holidayResearchRequestSchema.safeParse(r.input);
    return {
      id: r.id,
      status: r.status as HolidayResearchJobListRow["status"],
      year: parsedInput.success ? parsedInput.data.year : 0,
      regions: parsedInput.success ? parsedInput.data.regions : [],
      createdAt: r.created_at,
      error: r.error,
    };
  });
}

export type HolidayResearchJobDetail = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  year: number;
  regions: CalendarHolidayRegionCode[];
  error: string | null;
  draftNotes: string | null;
  draftRows: {
    id: string;
    region: CalendarHolidayRegionCode;
    regionLabel: string;
    date: string;
    name: string;
    check: HolidayCheck | null;
    conflict: HolidayConflict | null;
    alreadyApplied: boolean;
  }[];
};
export type HolidayResearchJobDetailRow = HolidayResearchJobDetail | null;

/** Lädt einen einzelnen Auftrag inkl. serverseitig aufgelöster Regionsbeschriftungen (`ai_jobs.output` enthält nur Codes, siehe `prompt.ts::REGION_LABELS`). */
export async function getHolidayResearchJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<HolidayResearchJobDetailRow> {
  const { data: job } = await supabase
    .from("ai_jobs")
    .select("id, status, input, output, error")
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .eq("kind", "holiday_research")
    .maybeSingle();
  if (!job) return null;

  const parsedInput = holidayResearchRequestSchema.safeParse(job.input);
  const parsedOutput = holidayResearchOutputSchema.safeParse(job.output ?? {});
  const draft = parsedOutput.success ? parsedOutput.data.draft : undefined;
  const appliedRowIds = new Set(parsedOutput.success ? parsedOutput.data.appliedRowIds : []);

  return {
    id: job.id,
    status: job.status as HolidayResearchJobDetail["status"],
    year: parsedInput.success ? parsedInput.data.year : 0,
    regions: parsedInput.success ? parsedInput.data.regions : [],
    error: job.error,
    draftNotes: draft?.notes ?? null,
    draftRows: (draft?.rows ?? []).map((r) => ({
      id: r.id,
      region: r.region,
      regionLabel: REGION_LABELS[r.region],
      date: r.date,
      name: r.name,
      check: r.check,
      conflict: r.conflict,
      alreadyApplied: appliedRowIds.has(r.id),
    })),
  };
}
