"use server";

import { revalidatePath } from "next/cache";
import { requireAdminTenant } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";
import {
  calendarClockInSchema,
  calendarProjectMemberIdsSchema,
  calendarProjectSchema,
  calendarProjectStatusSchema,
  calendarWorkerCreateSchema,
  calendarWorkerEditableSchema,
  calendarWorkerStatusSchema,
  toCalendarProjectRow,
  type CalendarClockInInput,
  type CalendarProjectInput,
  type CalendarProjectRow,
  type CalendarProjectStatus,
  type CalendarTimeEntryRow,
  type CalendarWorkerCreateInput,
  type CalendarWorkerEditableInput,
  type CalendarWorkerRow,
  type CalendarWorkerStatus,
} from "@/lib/calendar/schema";

/**
 * Server Actions für "Schichtplan" (Block S1, 07.08.2026). Stilvorbild
 * `src/lib/customer-area/actions.ts`: `"use server"` → Tenant-/Rollen-
 * Prüfung → zod `safeParse` → Schreiben mit `.eq("tenant_id", tenant.id)` →
 * `translateDbError` → `revalidatePath`. Rückgabetyp `{ ok: true } | { ok:
 * false; error: string }`, exakt wie dort.
 *
 * Verwaltungs-Actions (Arbeiter/Projekte) laufen über `requireAdminTenant()`
 * (member_role in owner/admin) — deckt sich mit der RLS-Hilfsfunktion
 * `calendar_is_admin()` in der Migration. Bewusst NICHT `requireStaffTenant()`
 * (das schlösse `trainer` ein, siehe Migrationskopf-Begründung).
 *
 * `clockIn`/`clockOut` sind KEINE Admin-Actions — jeder Arbeiter stempelt
 * sich selbst ein/aus. Gleiches Muster wie `toggleBookmark()`
 * (`src/lib/bookmarks/actions.ts`): Tenant/Nutzer direkt auflösen, keine
 * Staff-Prüfung.
 */

type ActionResult = { ok: true } | { ok: false; error: string };
type WorkerResult = { ok: true; worker: CalendarWorkerRow } | { ok: false; error: string };
type ProjectResult = { ok: true; project: CalendarProjectRow } | { ok: false; error: string };
type TimeEntryResult = { ok: true; entry: CalendarTimeEntryRow } | { ok: false; error: string };

const ADMIN_PATH = "/admin/schichtplanung";
const LEARN_PATH = "/schichtplan";

function embeddedOne<T>(value: T[] | T | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type Supa = Awaited<ReturnType<typeof requireAdminTenant>>["supabase"];

async function loadWorkerRow(supabase: Supa, tenantId: string, workerId: string): Promise<CalendarWorkerRow | null> {
  const { data } = await supabase
    .from("calendar_workers")
    .select(
      "id, membership_id, user_id, worker_type, status, target_hours, target_period, preferred_shift, preferred_weekdays, note, profiles(full_name, email)",
    )
    .eq("id", workerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const profile = embeddedOne(data.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null);
  return {
    id: data.id,
    membershipId: data.membership_id,
    userId: data.user_id,
    fullName: profile?.full_name ?? null,
    email: profile?.email ?? "",
    workerType: data.worker_type,
    status: data.status,
    targetHours: data.target_hours,
    targetPeriod: data.target_period,
    preferredShift: data.preferred_shift,
    preferredWeekdays: data.preferred_weekdays ?? [],
    note: data.note,
  };
}

// --- Arbeiter -------------------------------------------------------------

export async function createCalendarWorker(input: CalendarWorkerCreateInput): Promise<WorkerResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = calendarWorkerCreateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    // Mitgliedschaft muss zu DIESEM Mandanten gehören und ein angenommenes
    // Konto haben (user_id gesetzt) — gleiches Prüfprinzip wie
    // resolveContactTrainerId() in src/lib/customer-area/actions.ts, RLS
    // fängt das bei einer fremden membershipId zwar auch ab (0 Zeilen),
    // hier aber mit einer sprechenden deutschen Fehlermeldung statt eines
    // stillen "nicht gefunden".
    const { data: membership } = await supabase
      .from("memberships")
      .select("id, user_id, status")
      .eq("id", data.membershipId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!membership) return { ok: false, error: "Mitgliedschaft nicht gefunden." };
    if (!membership.user_id) {
      return { ok: false, error: "Diese Einladung wurde noch nicht angenommen — Arbeiterprofil erst nach Anmeldung möglich." };
    }

    const { data: worker, error } = await supabase
      .from("calendar_workers")
      .insert({
        tenant_id: tenant.id,
        membership_id: data.membershipId,
        user_id: membership.user_id,
        worker_type: data.workerType,
        target_hours: data.targetHours ?? null,
        target_period: data.targetPeriod,
        preferred_shift: data.preferredShift,
        preferred_weekdays: data.preferredWeekdays,
        note: data.note ?? null,
      })
      .select("id")
      .single();
    if (error || !worker) {
      return { ok: false, error: error ? translateDbError(error) : "Anlegen fehlgeschlagen." };
    }

    const row = await loadWorkerRow(supabase, tenant.id, worker.id);
    if (!row) return { ok: false, error: "Anlegen fehlgeschlagen." };

    revalidatePath(ADMIN_PATH);
    return { ok: true, worker: row };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function updateCalendarWorker(workerId: string, input: CalendarWorkerEditableInput): Promise<WorkerResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = calendarWorkerEditableSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    const { error } = await supabase
      .from("calendar_workers")
      .update({
        worker_type: data.workerType,
        target_hours: data.targetHours ?? null,
        target_period: data.targetPeriod,
        preferred_shift: data.preferredShift,
        preferred_weekdays: data.preferredWeekdays,
        note: data.note ?? null,
      })
      .eq("id", workerId)
      .eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    const row = await loadWorkerRow(supabase, tenant.id, workerId);
    if (!row) return { ok: false, error: "Arbeiter nicht gefunden." };

    revalidatePath(ADMIN_PATH);
    return { ok: true, worker: row };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function setCalendarWorkerStatus(workerId: string, status: CalendarWorkerStatus): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = calendarWorkerStatusSchema.safeParse(status);
    if (!parsed.success) return { ok: false, error: "Ungültiger Status." };

    const { error } = await supabase
      .from("calendar_workers")
      .update({ status: parsed.data })
      .eq("id", workerId)
      .eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/** Cascade räumt calendar_project_members/calendar_time_entries/… ab (FK `on delete cascade`); geplante Schichten bleiben stehen, wenn calendar_shifts.worker_id ebenfalls kaskadiert (siehe Migration — dort cascade). */
export async function deleteCalendarWorker(workerId: string): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase.from("calendar_workers").delete().eq("id", workerId).eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// --- Projekte ---------------------------------------------------------

async function resolveLeadUserId(supabase: Supa, tenantId: string, leadUserId: string | undefined): Promise<string | null> {
  if (!leadUserId) return null;
  const { data } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", leadUserId)
    .eq("status", "active")
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

async function loadProjectRow(supabase: Supa, tenantId: string, projectId: string): Promise<CalendarProjectRow | null> {
  const [{ data: project }, { data: members }] = await Promise.all([
    supabase
      .from("calendar_projects")
      .select("id, name, description, color, lead_user_id, status, position, profiles(full_name, email)")
      .eq("id", projectId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase.from("calendar_project_members").select("worker_id").eq("project_id", projectId).eq("tenant_id", tenantId),
  ]);
  if (!project) return null;
  const lead = embeddedOne(project.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null);
  return toCalendarProjectRow(
    project,
    lead ? lead.full_name || lead.email : null,
    (members ?? []).map((m) => m.worker_id as string),
  );
}

export async function createCalendarProject(input: CalendarProjectInput): Promise<ProjectResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = calendarProjectSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;
    const leadUserId = await resolveLeadUserId(supabase, tenant.id, data.leadUserId);
    if (data.leadUserId && !leadUserId) return { ok: false, error: "Projektleiter nicht gefunden." };

    const { count } = await supabase
      .from("calendar_projects")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);

    const { data: project, error } = await supabase
      .from("calendar_projects")
      .insert({
        tenant_id: tenant.id,
        name: data.name,
        description: data.description ?? null,
        color: data.color ?? null,
        lead_user_id: leadUserId,
        position: count ?? 0,
      })
      .select("id")
      .single();
    if (error || !project) return { ok: false, error: error ? translateDbError(error) : "Anlegen fehlgeschlagen." };

    const row = await loadProjectRow(supabase, tenant.id, project.id);
    if (!row) return { ok: false, error: "Anlegen fehlgeschlagen." };

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);
    return { ok: true, project: row };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function updateCalendarProject(projectId: string, input: CalendarProjectInput): Promise<ProjectResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = calendarProjectSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;
    const leadUserId = await resolveLeadUserId(supabase, tenant.id, data.leadUserId);
    if (data.leadUserId && !leadUserId) return { ok: false, error: "Projektleiter nicht gefunden." };

    const { error } = await supabase
      .from("calendar_projects")
      .update({
        name: data.name,
        description: data.description ?? null,
        color: data.color ?? null,
        lead_user_id: leadUserId,
      })
      .eq("id", projectId)
      .eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    const row = await loadProjectRow(supabase, tenant.id, projectId);
    if (!row) return { ok: false, error: "Projekt nicht gefunden." };

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);
    return { ok: true, project: row };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/** Projekte werden nie hart gelöscht (siehe Migrationskopf, RESTRICT-Begründung) — nur archiviert/reaktiviert. */
export async function archiveCalendarProject(projectId: string, status: CalendarProjectStatus): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = calendarProjectStatusSchema.safeParse(status);
    if (!parsed.success) return { ok: false, error: "Ungültiger Status." };

    const { error } = await supabase
      .from("calendar_projects")
      .update({ status: parsed.data })
      .eq("id", projectId)
      .eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/** Ersetzen-Operation (gleiches Prinzip wie setCustomerAreaGroupMembers): alle bestehenden Zuweisungen löschen, dann die neue Menge einfügen. */
export async function setCalendarProjectMembers(projectId: string, workerIds: string[]): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = calendarProjectMemberIdsSchema.safeParse(workerIds);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Auswahl." };
    }

    let validWorkerIds: string[] = [];
    if (parsed.data.length > 0) {
      const { data: workers } = await supabase
        .from("calendar_workers")
        .select("id")
        .eq("tenant_id", tenant.id)
        .in("id", parsed.data);
      validWorkerIds = (workers ?? []).map((w) => w.id as string);
    }

    const { error: deleteError } = await supabase
      .from("calendar_project_members")
      .delete()
      .eq("project_id", projectId)
      .eq("tenant_id", tenant.id);
    if (deleteError) return { ok: false, error: translateDbError(deleteError) };

    if (validWorkerIds.length > 0) {
      const { error: insertError } = await supabase
        .from("calendar_project_members")
        .insert(validWorkerIds.map((workerId) => ({ project_id: projectId, worker_id: workerId, tenant_id: tenant.id })));
      if (insertError) return { ok: false, error: translateDbError(insertError) };
    }

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// --- Zeiterfassung (Ein-/Ausstempeln, S1) --------------------------------

/** Kein `requireAdminTenant()` — jeder Arbeiter stempelt sich selbst ein. */
export async function clockIn(input: CalendarClockInInput = {}): Promise<TimeEntryResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Nicht angemeldet." };
    const tenant = await getTenant();
    if (!tenant) return { ok: false, error: "Kein Mandant zu diesem Host gefunden." };

    const parsed = calendarClockInSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    const { data: worker } = await supabase
      .from("calendar_workers")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!worker) return { ok: false, error: "Kein Arbeiterprofil in diesem Mandanten." };

    const { data: openEntry } = await supabase
      .from("calendar_time_entries")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("worker_id", worker.id)
      .is("ended_at", null)
      .maybeSingle();
    if (openEntry) return { ok: false, error: "Du bist bereits eingestempelt." };

    // shiftId (falls angegeben) muss zu DIESEM Mandanten UND diesem
    // Arbeiter gehören — calendar_time_entries.shift_id ist bewusst ein
    // einfacher, nicht zusammengesetzter Fremdschlüssel (siehe
    // Migrationskopf 20260807090000_shift_calendar.sql, Abschnitt 8), diese
    // Prüfung ist die dafür vorgesehene Anwendungs-Verteidigungslinie.
    let shiftId: string | null = null;
    if (data.shiftId) {
      const { data: shift } = await supabase
        .from("calendar_shifts")
        .select("id")
        .eq("id", data.shiftId)
        .eq("tenant_id", tenant.id)
        .eq("worker_id", worker.id)
        .maybeSingle();
      if (!shift) return { ok: false, error: "Schicht nicht gefunden." };
      shiftId = shift.id;
    }

    const { data: entry, error } = await supabase
      .from("calendar_time_entries")
      .insert({
        tenant_id: tenant.id,
        worker_id: worker.id,
        shift_id: shiftId,
        started_at: new Date().toISOString(),
        source: "self",
        note: data.note ?? null,
      })
      .select("id, worker_id, shift_id, started_at, ended_at, source, note")
      .single();
    if (error || !entry) return { ok: false, error: error ? translateDbError(error) : "Einstempeln fehlgeschlagen." };

    revalidatePath(LEARN_PATH);
    return {
      ok: true,
      entry: {
        id: entry.id,
        workerId: entry.worker_id,
        shiftId: entry.shift_id,
        startedAt: entry.started_at,
        endedAt: entry.ended_at,
        source: entry.source,
        note: entry.note,
      },
    };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/** Kein `requireAdminTenant()` — jeder Arbeiter stempelt sich selbst aus. Der Spaltenschutz-Trigger `calendar_time_entries_guard()` sorgt dafür, dass dabei serverseitig nur `ended_at` sich wirklich ändert. */
export async function clockOut(): Promise<TimeEntryResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Nicht angemeldet." };
    const tenant = await getTenant();
    if (!tenant) return { ok: false, error: "Kein Mandant zu diesem Host gefunden." };

    const { data: worker } = await supabase
      .from("calendar_workers")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!worker) return { ok: false, error: "Kein Arbeiterprofil in diesem Mandanten." };

    const { data: openEntry } = await supabase
      .from("calendar_time_entries")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("worker_id", worker.id)
      .is("ended_at", null)
      .maybeSingle();
    if (!openEntry) return { ok: false, error: "Du bist aktuell nicht eingestempelt." };

    const { data: entry, error } = await supabase
      .from("calendar_time_entries")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", openEntry.id)
      .eq("tenant_id", tenant.id)
      .select("id, worker_id, shift_id, started_at, ended_at, source, note")
      .single();
    if (error || !entry) return { ok: false, error: error ? translateDbError(error) : "Ausstempeln fehlgeschlagen." };

    revalidatePath(LEARN_PATH);
    return {
      ok: true,
      entry: {
        id: entry.id,
        workerId: entry.worker_id,
        shiftId: entry.shift_id,
        startedAt: entry.started_at,
        endedAt: entry.ended_at,
        source: entry.source,
        note: entry.note,
      },
    };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// KEIN Typ-Re-Export hier (Turbopack-Server-Actions-Bug, siehe
// PHASENSTATUS.md "Kunden Area", Bugfix-Absatz) — Panels importieren
// `CalendarWorkerRow`/`CalendarProjectRow`/… direkt aus
// `@/lib/calendar/schema`.
