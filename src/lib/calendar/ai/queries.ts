import type { SupabaseClient } from "@supabase/supabase-js";
import { shiftPlanOutputSchema, shiftPlanRequestSchema } from "@/lib/calendar/ai/schema";

/**
 * Leseabfragen für die KI-Schichtplanung (Block S4, 08.08.2026) — laufen
 * über den regulären RLS-Client (`ai_jobs_staff_select` deckt owner/admin
 * über `is_staff()` ab, siehe `0001_init.sql`). Kein separater Admin-Client
 * nötig, da hier nur gelesen wird.
 */

export type ShiftPlanJobListRow = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  projectId: string;
  projectName: string | null;
  fromDate: string;
  toDate: string;
  createdAt: string;
  error: string | null;
};

export async function getShiftPlanJobs(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ShiftPlanJobListRow[]> {
  const { data } = await supabase
    .from("ai_jobs")
    .select("id, status, input, created_at, error")
    .eq("tenant_id", tenantId)
    .eq("kind", "shift_plan")
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as { id: string; status: string; input: unknown; created_at: string; error: string | null }[];
  if (rows.length === 0) return [];

  const projectIds = Array.from(
    new Set(
      rows
        .map((r) => shiftPlanRequestSchema.safeParse(r.input))
        .filter((p) => p.success)
        .map((p) => (p.success ? p.data.projectId : null))
        .filter((id): id is string => id !== null),
    ),
  );
  const { data: projectRows } = await supabase
    .from("calendar_projects")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("id", projectIds.length > 0 ? projectIds : ["00000000-0000-0000-0000-000000000000"]);
  const projectNameById = new Map((projectRows ?? []).map((p) => [p.id as string, p.name as string]));

  return rows.map((r) => {
    const parsedInput = shiftPlanRequestSchema.safeParse(r.input);
    return {
      id: r.id,
      status: r.status as ShiftPlanJobListRow["status"],
      projectId: parsedInput.success ? parsedInput.data.projectId : "",
      projectName: parsedInput.success ? (projectNameById.get(parsedInput.data.projectId) ?? null) : null,
      fromDate: parsedInput.success ? parsedInput.data.fromDate : "",
      toDate: parsedInput.success ? parsedInput.data.toDate : "",
      createdAt: r.created_at,
      error: r.error,
    };
  });
}

export type ShiftPlanJobDetail = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  projectId: string;
  projectName: string | null;
  fromDate: string;
  toDate: string;
  note: string | null;
  error: string | null;
  draftRows: {
    id: string;
    workerId: string;
    workerName: string;
    date: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    note?: string;
    conflict: "overlap" | "absence" | "outside-period" | "duplicate" | null;
    alreadyApplied: boolean;
    targetHours: number | null;
    targetPeriod: "week" | "month" | null;
  }[];
  draftNotes: string | null;
};
export type ShiftPlanJobDetailRow = ShiftPlanJobDetail | null;

/** Lädt einen einzelnen Auftrag inkl. serverseitig aufgelöster Arbeiternamen (`ai_jobs.output` enthält nur UUIDs, siehe `prompt.ts`-Dateikopf). */
export async function getShiftPlanJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<ShiftPlanJobDetailRow> {
  const { data: job } = await supabase
    .from("ai_jobs")
    .select("id, status, input, output, error")
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .eq("kind", "shift_plan")
    .maybeSingle();
  if (!job) return null;

  const parsedInput = shiftPlanRequestSchema.safeParse(job.input);
  const parsedOutput = shiftPlanOutputSchema.safeParse(job.output ?? {});
  const draft = parsedOutput.success ? parsedOutput.data.draft : undefined;
  const appliedRowIds = new Set(parsedOutput.success ? parsedOutput.data.appliedRowIds : []);

  let projectName: string | null = null;
  if (parsedInput.success) {
    const { data: project } = await supabase
      .from("calendar_projects")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("id", parsedInput.data.projectId)
      .maybeSingle();
    projectName = project?.name ?? null;
  }

  const workerIds = Array.from(new Set((draft?.rows ?? []).map((r) => r.workerId)));
  const workerInfoById = new Map<string, { name: string; targetHours: number | null; targetPeriod: "week" | "month" | null }>();
  if (workerIds.length > 0) {
    const { data: workerRows } = await supabase
      .from("calendar_workers")
      .select("id, target_hours, target_period, profiles(full_name, email)")
      .eq("tenant_id", tenantId)
      .in("id", workerIds);
    for (const w of workerRows ?? []) {
      const profile = Array.isArray(w.profiles) ? w.profiles[0] : w.profiles;
      const name = (profile?.full_name as string | null) || (profile?.email as string | undefined) || "—";
      workerInfoById.set(w.id as string, {
        name,
        targetHours: w.target_hours as number | null,
        targetPeriod: w.target_period as "week" | "month" | null,
      });
    }
  }

  return {
    id: job.id,
    status: job.status as ShiftPlanJobDetail["status"],
    projectId: parsedInput.success ? parsedInput.data.projectId : "",
    projectName,
    fromDate: parsedInput.success ? parsedInput.data.fromDate : "",
    toDate: parsedInput.success ? parsedInput.data.toDate : "",
    note: parsedInput.success ? (parsedInput.data.note ?? null) : null,
    error: job.error,
    draftNotes: draft?.notes ?? null,
    draftRows: (draft?.rows ?? []).map((r) => ({
      id: r.id,
      workerId: r.workerId,
      workerName: workerInfoById.get(r.workerId)?.name ?? "—",
      date: r.date,
      startTime: r.startTime,
      endTime: r.endTime,
      breakMinutes: r.breakMinutes,
      note: r.note,
      conflict: r.conflict,
      alreadyApplied: appliedRowIds.has(r.id),
      targetHours: workerInfoById.get(r.workerId)?.targetHours ?? null,
      targetPeriod: workerInfoById.get(r.workerId)?.targetPeriod ?? null,
    })),
  };
}
