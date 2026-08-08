"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireAdminTenant } from "@/lib/auth/staff";
import { requireShiftPlannerTenant } from "@/lib/calendar/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/context";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";
import { sendEmail } from "@/lib/email/client";
import { shiftChangeRequestDecided, shiftChangeRequestSubmitted } from "@/lib/email/templates";
import { resolveTenantEmailLocale } from "@/i18n/config";
import type { PublicTenant } from "@/lib/tenant/types";
import {
  calendarAbsenceSchema,
  calendarChangeDecisionSchema,
  calendarChangeRequestSchema,
  calendarClockInSchema,
  calendarHolidayImportSchema,
  calendarProjectMemberIdsSchema,
  calendarProjectSchema,
  calendarProjectStatusSchema,
  calendarSelfBookingSchema,
  calendarShiftSchema,
  calendarShiftStatusSchema,
  calendarSlotSchema,
  calendarSlotStatusSchema,
  calendarWorkerCreateSchema,
  calendarWorkerEditableSchema,
  calendarWorkerStatusSchema,
  calendarWorkerTargetSchema,
  toCalendarProjectRow,
  type CalendarAbsenceInput,
  type CalendarAdminShiftRow,
  type CalendarChangeDecisionInput,
  type CalendarChangeRequestInput,
  type CalendarClockInInput,
  type CalendarHolidayImportInput,
  type CalendarProjectInput,
  type CalendarProjectRow,
  type CalendarProjectStatus,
  type CalendarShiftInput,
  type CalendarShiftStatus,
  type CalendarSlotInput,
  type CalendarSlotStatus,
  type CalendarTimeEntryRow,
  type CalendarWorkerCreateInput,
  type CalendarWorkerEditableInput,
  type CalendarWorkerRow,
  type CalendarWorkerStatus,
  type CalendarWorkerTargetInput,
} from "@/lib/calendar/schema";
import { buildWeeklySeries, formatDayLabel, formatTimeRange } from "@/lib/calendar/date";
import { buildHolidays } from "@/lib/calendar/holidays";

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
type ShiftResult = { ok: true; shift: CalendarAdminShiftRow } | { ok: false; error: string };
type SlotsCreateResult = { ok: true; created: number } | { ok: false; error: string };
type HolidayImportResult = { ok: true; inserted: number; skipped: number } | { ok: false; error: string };
type SelfBookingResult = { ok: true; shiftId: string } | { ok: false; error: string };

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
    // Migrationskopf 20260807142619_shift_calendar.sql, Abschnitt 8), diese
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

// =====================================================================
// Block S2 (08.08.2026) — Admin-Schicht-CRUD, Zeitfenster-Verwaltung,
// Freelancer-Selbstbuchung, Feiertagsimport, Sollstunden-Selbstverwaltung.
// =====================================================================

async function loadAdminShiftRow(supabase: Supa, tenantId: string, shiftId: string): Promise<CalendarAdminShiftRow | null> {
  const { data } = await supabase
    .from("calendar_shifts")
    .select(
      "id, worker_id, project_id, slot_id, starts_at, ends_at, break_minutes, status, source, note, calendar_projects(name, color), calendar_workers(profiles(full_name, email))",
    )
    .eq("id", shiftId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;

  const project = embeddedOne(data.calendar_projects as { name: string; color: string | null } | { name: string; color: string | null }[] | null);
  const worker = embeddedOne(data.calendar_workers as { profiles: unknown } | { profiles: unknown }[] | null);
  const profile = worker
    ? embeddedOne(worker.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null)
    : null;

  return {
    id: data.id,
    workerId: data.worker_id,
    workerName: profile ? profile.full_name || profile.email : null,
    projectId: data.project_id,
    projectName: project?.name ?? null,
    projectColor: project?.color ?? null,
    slotId: data.slot_id,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    breakMinutes: data.break_minutes,
    status: data.status,
    source: data.source,
    note: data.note,
  };
}

/** projectId/workerId/slotId serverseitig gegen den eigenen Mandanten validieren — nicht blind aus dem Formular übernehmen (RLS fängt eine fremde ID zwar auch ab, aber mit einer stillen "0 Zeilen" statt einer sprechenden Fehlermeldung). */
async function assertOwnTenantRow(supabase: Supa, tenantId: string, table: "calendar_projects" | "calendar_slots" | "calendar_workers", id: string): Promise<boolean> {
  const { data } = await supabase.from(table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return Boolean(data);
}

export async function createCalendarShift(input: CalendarShiftInput): Promise<ShiftResult> {
  try {
    const { tenant, supabase, user } = await requireAdminTenant();
    const parsed = calendarShiftSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    if (!(await assertOwnTenantRow(supabase, tenant.id, "calendar_workers", data.workerId))) {
      return { ok: false, error: "Arbeiter nicht gefunden." };
    }
    if (data.projectId && !(await assertOwnTenantRow(supabase, tenant.id, "calendar_projects", data.projectId))) {
      return { ok: false, error: "Projekt nicht gefunden." };
    }
    if (data.slotId && !(await assertOwnTenantRow(supabase, tenant.id, "calendar_slots", data.slotId))) {
      return { ok: false, error: "Zeitfenster nicht gefunden." };
    }

    // buildWeeklySeries(..., 1) liefert genau EINEN Termin — wiederverwendet
    // statt einer eigenen Berlin->UTC-Umrechnung hier, gleiche
    // Nachtschicht-Logik (endTime <= startTime -> Ende am Folgetag) wie bei
    // der Zeitfenster-Serienanlage unten.
    const [{ startsAt, endsAt }] = buildWeeklySeries(data.date, data.startTime, data.endTime, 1);

    const { data: shift, error } = await supabase
      .from("calendar_shifts")
      .insert({
        tenant_id: tenant.id,
        worker_id: data.workerId,
        project_id: data.projectId ?? null,
        slot_id: data.slotId ?? null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        break_minutes: data.breakMinutes,
        status: "planned",
        source: "admin",
        note: data.note ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error || !shift) return { ok: false, error: error ? translateDbError(error) : "Anlegen fehlgeschlagen." };

    const row = await loadAdminShiftRow(supabase, tenant.id, shift.id);
    if (!row) return { ok: false, error: "Anlegen fehlgeschlagen." };

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);
    return { ok: true, shift: row };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function updateCalendarShift(shiftId: string, input: CalendarShiftInput): Promise<ShiftResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = calendarShiftSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    if (!(await assertOwnTenantRow(supabase, tenant.id, "calendar_workers", data.workerId))) {
      return { ok: false, error: "Arbeiter nicht gefunden." };
    }
    if (data.projectId && !(await assertOwnTenantRow(supabase, tenant.id, "calendar_projects", data.projectId))) {
      return { ok: false, error: "Projekt nicht gefunden." };
    }
    if (data.slotId && !(await assertOwnTenantRow(supabase, tenant.id, "calendar_slots", data.slotId))) {
      return { ok: false, error: "Zeitfenster nicht gefunden." };
    }

    const [{ startsAt, endsAt }] = buildWeeklySeries(data.date, data.startTime, data.endTime, 1);

    const { error } = await supabase
      .from("calendar_shifts")
      .update({
        worker_id: data.workerId,
        project_id: data.projectId ?? null,
        slot_id: data.slotId ?? null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        break_minutes: data.breakMinutes,
        note: data.note ?? null,
      })
      .eq("id", shiftId)
      .eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    const row = await loadAdminShiftRow(supabase, tenant.id, shiftId);
    if (!row) return { ok: false, error: "Schicht nicht gefunden." };

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);
    return { ok: true, shift: row };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function setCalendarShiftStatus(shiftId: string, status: CalendarShiftStatus): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = calendarShiftStatusSchema.safeParse(status);
    if (!parsed.success) return { ok: false, error: "Ungültiger Status." };

    const { error } = await supabase
      .from("calendar_shifts")
      .update({ status: parsed.data })
      .eq("id", shiftId)
      .eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// --- Zeitfenster ------------------------------------------------------

/** Erzeugt die komplette Serie über buildWeeklySeries() und fügt ALLE Zeilen in EINEM .insert([...]) ein — schlägt eine Zeile fehl, scheitert die ganze Serie bewusst (kein Teilerfolg, der Admin müsste sonst manuell nachprüfen, welche Wochen schon angelegt wurden). */
export async function createCalendarSlots(input: CalendarSlotInput): Promise<SlotsCreateResult> {
  try {
    const { tenant, supabase, user } = await requireAdminTenant();
    const parsed = calendarSlotSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    if (!(await assertOwnTenantRow(supabase, tenant.id, "calendar_projects", data.projectId))) {
      return { ok: false, error: "Projekt nicht gefunden." };
    }

    const series = buildWeeklySeries(data.date, data.startTime, data.endTime, data.repeatWeeks);
    const rows = series.map(({ startsAt, endsAt }) => ({
      tenant_id: tenant.id,
      project_id: data.projectId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      capacity: data.capacity,
      status: "open" as const,
      created_by: user.id,
    }));

    const { data: inserted, error } = await supabase.from("calendar_slots").insert(rows).select("id");
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(ADMIN_PATH);
    return { ok: true, created: inserted?.length ?? 0 };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function setCalendarSlotStatus(slotId: string, status: CalendarSlotStatus): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = calendarSlotStatusSchema.safeParse(status);
    if (!parsed.success) return { ok: false, error: "Ungültiger Status." };

    const { error } = await supabase
      .from("calendar_slots")
      .update({ status: parsed.data })
      .eq("id", slotId)
      .eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/** Kann mit 23503 (FK RESTRICT, siehe Migrationskopf 20260807142619) scheitern, wenn noch Schichten an diesem Zeitfenster hängen — translateDbError deckt das ab, das UI warnt zusätzlich vorher, wenn bookedCount > 0. */
export async function deleteCalendarSlot(slotId: string): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase.from("calendar_slots").delete().eq("id", slotId).eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// --- Abwesenheiten/Feiertage -------------------------------------------

export async function createCalendarAbsence(input: CalendarAbsenceInput): Promise<ActionResult> {
  try {
    const { tenant, supabase, user } = await requireAdminTenant();
    const parsed = calendarAbsenceSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    if (data.workerId && !(await assertOwnTenantRow(supabase, tenant.id, "calendar_workers", data.workerId))) {
      return { ok: false, error: "Arbeiter nicht gefunden." };
    }

    const nowIso = new Date().toISOString();
    const { error } = await supabase.from("calendar_absences").insert({
      tenant_id: tenant.id,
      worker_id: data.workerId ?? null,
      kind: data.kind,
      starts_on: data.startsOn,
      ends_on: data.endsOn,
      note: data.note ?? null,
      status: "approved",
      created_by: user.id,
      decided_by: user.id,
      decided_at: nowIso,
    });
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function deleteCalendarAbsence(absenceId: string): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase.from("calendar_absences").delete().eq("id", absenceId).eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/** Lädt vorher bestehende kind='holiday'-Zeilen des Jahres und filtert die neue Liste dagegen (kein Unique-Index auf calendar_absences für diesen Fall, App-seitige Entdopplung, siehe Migrationskopf S1). */
export async function importCalendarHolidays(input: CalendarHolidayImportInput): Promise<HolidayImportResult> {
  try {
    const { tenant, supabase, user } = await requireAdminTenant();
    const parsed = calendarHolidayImportSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    // S5a (08.08.2026): `calendarHolidayImportSchema` akzeptiert seit der
    // Umbenennung von CALENDAR_HOLIDAY_COUNTRIES auf CALENDAR_HOLIDAY_REGIONS
    // (schema.ts) alle acht Regionscodes — `buildHolidays()` (holidays.ts)
    // kennt aber weiterhin nur DE/AT/CH. Der deterministische Import bleibt
    // bis Block S5c (Ablösung durch die KI-Feiertagsrecherche) auf diese drei
    // beschränkt; die übrigen fünf Codes bekommen hier eine eigene, klare
    // Fehlermeldung statt eines TypeScript-Fehlers, der die eigentliche
    // Ursache verschleiern würde.
    if (data.country !== "DE" && data.country !== "AT" && data.country !== "CH") {
      return { ok: false, error: "Für diese Region gibt es noch keinen Feiertagsimport." };
    }

    const holidays = buildHolidays(data.country, data.year);

    const { data: existingRaw } = await supabase
      .from("calendar_absences")
      .select("starts_on")
      .eq("tenant_id", tenant.id)
      .eq("kind", "holiday")
      .gte("starts_on", `${data.year}-01-01`)
      .lte("starts_on", `${data.year}-12-31`);
    const existingDates = new Set((existingRaw ?? []).map((r) => r.starts_on as string));

    const toInsert = holidays.filter((h) => !existingDates.has(h.date));

    if (toInsert.length > 0) {
      const nowIso = new Date().toISOString();
      const { error } = await supabase.from("calendar_absences").insert(
        toInsert.map((h) => ({
          tenant_id: tenant.id,
          worker_id: null,
          kind: "holiday" as const,
          starts_on: h.date,
          ends_on: h.date,
          note: h.name,
          status: "approved" as const,
          created_by: user.id,
          decided_by: user.id,
          decided_at: nowIso,
        })),
      );
      if (error) return { ok: false, error: translateDbError(error) };
    }

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);
    return { ok: true, inserted: toInsert.length, skipped: holidays.length - toInsert.length };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// --- Freelancer-Selbstbuchung/-Selbstverwaltung (kein requireAdminTenant) -

/** Kein requireAdminTenant() — jeder Freelancer bucht sich selbst in ein offenes Zeitfenster ein. Muster exakt wie clockIn() oben: normaler RLS-Client, auth.getUser(), getTenant(), eigene Arbeiterzeile laden. Die eigentliche Absicherung (Freelancer/aktiv/Projektmitgliedschaft/Kapazität/Projekt-Konsistenz) liegt in der RLS-Policy calendar_shifts_insert + den Triggern (S2-Migration), nicht in dieser Funktion. */
export async function bookOwnShift(input: { slotId: string }): Promise<SelfBookingResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Nicht angemeldet." };
    const tenant = await getTenant();
    if (!tenant) return { ok: false, error: "Kein Mandant zu diesem Host gefunden." };

    const parsed = calendarSelfBookingSchema.safeParse(input);
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

    const { data: slot } = await supabase
      .from("calendar_slots")
      .select("id, project_id, starts_at, ends_at")
      .eq("id", data.slotId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!slot) return { ok: false, error: "Zeitfenster nicht gefunden." };

    const { data: shift, error } = await supabase
      .from("calendar_shifts")
      .insert({
        tenant_id: tenant.id,
        worker_id: worker.id,
        project_id: slot.project_id,
        slot_id: slot.id,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        break_minutes: 0,
        status: "planned",
        source: "self",
      })
      .select("id")
      .single();
    if (error || !shift) return { ok: false, error: error ? translateDbError(error) : "Buchung fehlgeschlagen." };

    revalidatePath(LEARN_PATH);
    return { ok: true, shiftId: shift.id };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/** Kein requireAdminTenant() — schreibt NUR target_hours/target_period der eigenen Zeile. Die eigentliche Absicherung liegt im Trigger calendar_workers_guard() + der Policy calendar_workers_update (S2-Migration), nicht in dieser Funktion — ein Nicht-Freelancer/inaktiver Freelancer bekommt hier kein UI, könnte die Action aber theoretisch trotzdem aufrufen; die DB verwirft dann still (0 betroffene Zeilen laut RLS) oder der Guard-Trigger setzt die Spalten zurück (falls die Policy WIDER Erwarten durchließe). */
export async function updateOwnTargetHours(input: CalendarWorkerTargetInput): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Nicht angemeldet." };
    const tenant = await getTenant();
    if (!tenant) return { ok: false, error: "Kein Mandant zu diesem Host gefunden." };

    const parsed = calendarWorkerTargetSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    const { error } = await supabase
      .from("calendar_workers")
      .update({ target_hours: data.targetHours ?? null, target_period: data.targetPeriod })
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(LEARN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// =====================================================================
// Block S3 (09.08.2026) — Änderungsanfragen (Arbeiter-Selbstanfrage +
// Admin-/Projektleiter-Entscheidung).
// =====================================================================

type ChangeRequestCreateResult = { ok: true; requestId: string } | { ok: false; error: string };

/** "Montag, 10. August, 08:00–16:00 Uhr" — reine Anzeige-Kürzel für E-Mails, bewusst fest in de-DE-Format (gleiches Prinzip wie die hartcodierten deutschen Fehlermeldungen in diesem Modul — die umgebenden Textbausteine der Mail sind über i18n lokalisiert, dieser Zeitstempel-Wert nicht). */
function buildShiftLabel(startsAt: Date, endsAt: Date): string {
  return `${formatDayLabel(startsAt)}, ${formatTimeRange(startsAt, endsAt)} Uhr`;
}

/**
 * Empfängerkreis + Mailversand für eine NEUE Änderungsanfrage — alle
 * `owner`/`admin` des Mandanten PLUS der Projektleiter des betroffenen
 * Projekts (falls gesetzt). Fail-soft (CLAUDE.md/tutor-actions.ts-Muster):
 * wird IMMER per `.catch()` am Aufrufort abgefangen, wirft hier absichtlich
 * nicht nach außen durch.
 */
async function notifyChangeRequestSubmitted(params: {
  tenant: PublicTenant;
  workerUserId: string;
  kind: "update" | "cancel";
  reason: string | null;
  shiftStartsAt: string;
  shiftEndsAt: string;
  proposedStartsAt: string | null;
  proposedEndsAt: string | null;
  projectId: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { tenant } = params;

  const { data: workerProfile } = await admin
    .from("profiles")
    .select("full_name, email")
    .eq("id", params.workerUserId)
    .maybeSingle();
  const workerName = workerProfile?.full_name?.trim() || workerProfile?.email || "Ein Arbeiter";

  const recipientIds = new Set<string>();
  const { data: staffMemberships } = await admin
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenant.id)
    .eq("status", "active")
    .in("role", ["owner", "admin"]);
  for (const m of staffMemberships ?? []) {
    if (m.user_id) recipientIds.add(m.user_id as string);
  }

  if (params.projectId) {
    const { data: project } = await admin
      .from("calendar_projects")
      .select("lead_user_id")
      .eq("id", params.projectId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (project?.lead_user_id) recipientIds.add(project.lead_user_id as string);
  }
  if (recipientIds.size === 0) return;

  const { data: recipientProfiles } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("id", Array.from(recipientIds));

  const shiftLabel = buildShiftLabel(new Date(params.shiftStartsAt), new Date(params.shiftEndsAt));
  const proposedLabel =
    params.kind === "update" && params.proposedStartsAt && params.proposedEndsAt
      ? buildShiftLabel(new Date(params.proposedStartsAt), new Date(params.proposedEndsAt))
      : undefined;

  const locale = resolveTenantEmailLocale(tenant.settings.default_locale);
  const tSubject = await getTranslations({ locale, namespace: "email" });

  for (const profile of recipientProfiles ?? []) {
    if (!profile.email) continue;
    const html = await shiftChangeRequestSubmitted({
      tenantName: tenant.name,
      recipientName: profile.full_name ?? undefined,
      workerName,
      shiftLabel,
      proposedLabel,
      kind: params.kind,
      reason: params.reason ?? undefined,
      accentColor: tenant.branding.color_primary,
      locale,
    });
    const result = await sendEmail({
      to: profile.email,
      subject: tSubject("shiftChangeRequestSubmitted.subject"),
      html,
      tenant: { name: tenant.name },
    });
    if (!result.success) {
      console.error("[calendar/actions] Anfragemail fehlgeschlagen (fail-soft):", result.error);
    }
  }
}

/** Kein `requireAdminTenant()`/`requireShiftPlannerTenant()` — jeder Arbeiter stellt eine Anfrage NUR für die eigene Schicht (Muster wie `bookOwnShift()`), RLS (`calendar_may_request_change()`) ist die eigentliche Sperre gegen fremde Schichten. */
export async function createShiftChangeRequest(input: CalendarChangeRequestInput): Promise<ChangeRequestCreateResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Nicht angemeldet." };
    const tenant = await getTenant();
    if (!tenant) return { ok: false, error: "Kein Mandant zu diesem Host gefunden." };

    const parsed = calendarChangeRequestSchema.safeParse(input);
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

    const { data: shift } = await supabase
      .from("calendar_shifts")
      .select("id, status, starts_at, ends_at, project_id")
      .eq("id", data.shiftId)
      .eq("tenant_id", tenant.id)
      .eq("worker_id", worker.id)
      .maybeSingle();
    if (!shift) return { ok: false, error: "Schicht nicht gefunden." };
    if (shift.status === "cancelled") return { ok: false, error: "Diese Schicht ist bereits storniert." };

    const { data: existingPending } = await supabase
      .from("calendar_shift_change_requests")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("shift_id", data.shiftId)
      .eq("status", "pending")
      .maybeSingle();
    if (existingPending) return { ok: false, error: "Für diese Schicht liegt bereits eine offene Anfrage vor." };

    let proposedStartsAt: string | null = null;
    let proposedEndsAt: string | null = null;
    let proposedBreakMinutes: number | null = null;
    if (data.kind === "update") {
      const [{ startsAt, endsAt }] = buildWeeklySeries(data.date, data.startTime, data.endTime, 1);
      proposedStartsAt = startsAt.toISOString();
      proposedEndsAt = endsAt.toISOString();
      proposedBreakMinutes = data.breakMinutes;
    }

    const { data: inserted, error } = await supabase
      .from("calendar_shift_change_requests")
      .insert({
        tenant_id: tenant.id,
        shift_id: data.shiftId,
        worker_id: worker.id,
        kind: data.kind,
        proposed_starts_at: proposedStartsAt,
        proposed_ends_at: proposedEndsAt,
        proposed_break_minutes: proposedBreakMinutes,
        proposed_project_id: null,
        reason: data.reason ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !inserted) {
      if (error?.code === "23505") {
        return { ok: false, error: "Für diese Schicht liegt bereits eine offene Anfrage vor." };
      }
      return { ok: false, error: error ? translateDbError(error) : "Anfrage konnte nicht gespeichert werden." };
    }

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);

    void notifyChangeRequestSubmitted({
      tenant,
      workerUserId: user.id,
      kind: data.kind,
      reason: data.reason ?? null,
      shiftStartsAt: shift.starts_at,
      shiftEndsAt: shift.ends_at,
      proposedStartsAt,
      proposedEndsAt,
      projectId: shift.project_id,
    }).catch((e) => {
      console.error("[calendar/actions] notifyChangeRequestSubmitted fehlgeschlagen (fail-soft):", e);
    });

    return { ok: true, requestId: inserted.id };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/** Mailversand an den Arbeiter nach einer Entscheidung — fail-soft, siehe notifyChangeRequestSubmitted() oben. */
async function notifyChangeRequestDecided(params: {
  tenant: PublicTenant;
  workerId: string;
  shiftId: string;
  kind: "update" | "cancel";
  decision: "approved" | "rejected";
  decisionNote: string | null;
  proposedStartsAt: string | null;
  proposedEndsAt: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { tenant } = params;

  const { data: workerRow } = await admin
    .from("calendar_workers")
    .select("user_id")
    .eq("id", params.workerId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (!workerRow) return;

  const { data: profile } = await admin
    .from("profiles")
    .select("email, full_name")
    .eq("id", workerRow.user_id)
    .maybeSingle();
  if (!profile?.email) return;

  const { data: shiftRow } = await admin
    .from("calendar_shifts")
    .select("starts_at, ends_at")
    .eq("id", params.shiftId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (!shiftRow) return;
  const shiftLabel = buildShiftLabel(new Date(shiftRow.starts_at), new Date(shiftRow.ends_at));
  const proposedLabel =
    params.kind === "update" && params.proposedStartsAt && params.proposedEndsAt
      ? buildShiftLabel(new Date(params.proposedStartsAt), new Date(params.proposedEndsAt))
      : undefined;

  const locale = resolveTenantEmailLocale(tenant.settings.default_locale);
  const tSubject = await getTranslations({ locale, namespace: "email" });

  const html = await shiftChangeRequestDecided({
    tenantName: tenant.name,
    recipientName: profile.full_name ?? undefined,
    decision: params.decision,
    kind: params.kind,
    shiftLabel,
    proposedLabel,
    decisionNote: params.decisionNote ?? undefined,
    accentColor: tenant.branding.color_primary,
    locale,
  });
  const result = await sendEmail({
    to: profile.email,
    subject: tSubject("shiftChangeRequestDecided.subject"),
    html,
    tenant: { name: tenant.name },
  });
  if (!result.success) {
    console.error("[calendar/actions] Entscheidungsmail fehlgeschlagen (fail-soft):", result.error);
  }
}

/**
 * Entscheidung über eine Änderungsanfrage — Admin ODER Projektleiter
 * (`requireShiftPlannerTenant()`, NICHT `requireAdminTenant()`). Reihenfolge
 * ist die Lösung für die Nebenläufigkeits-Anforderung: erst die Schicht
 * schreiben (Ablehnung überspringt das), dann die Anfrage abschließen — drei
 * Fehlerfälle beim Schicht-Schreiben lassen die Anfrage bewusst `pending`
 * (sofortiges Return, kein Schreibversuch auf die Anfrage).
 */
export async function decideShiftChangeRequest(requestId: string, input: CalendarChangeDecisionInput): Promise<ActionResult> {
  try {
    const { tenant, supabase, user } = await requireShiftPlannerTenant();
    const parsed = calendarChangeDecisionSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    const { data: request } = await supabase
      .from("calendar_shift_change_requests")
      .select(
        "id, shift_id, worker_id, kind, proposed_starts_at, proposed_ends_at, proposed_break_minutes, proposed_project_id",
      )
      .eq("id", requestId)
      .eq("tenant_id", tenant.id)
      .eq("status", "pending")
      .maybeSingle();
    if (!request) return { ok: false, error: "Diese Anfrage wurde bereits entschieden." };

    const CONFLICT_MESSAGE =
      "Genehmigung nicht möglich: Die vorgeschlagene Zeit überschneidet sich mit einer anderen Schicht dieses Arbeiters. Die Anfrage bleibt offen — stornieren Sie zuerst die überlappende Schicht und versuchen Sie es dann erneut.";

    if (data.decision === "approved") {
      if (request.kind === "cancel") {
        const { data: updated, error } = await supabase
          .from("calendar_shifts")
          .update({ status: "cancelled" })
          .eq("id", request.shift_id)
          .eq("tenant_id", tenant.id)
          .select("id");
        if (error) return { ok: false, error: error.code === "23P01" ? CONFLICT_MESSAGE : translateDbError(error) };
        if (!updated || updated.length === 0) {
          return { ok: false, error: "Kein Zugriff auf diese Schicht — bitte an einen Administrator übergeben." };
        }
      } else {
        if (request.proposed_project_id) {
          const validProject = await assertOwnTenantRow(supabase, tenant.id, "calendar_projects", request.proposed_project_id);
          if (!validProject) return { ok: false, error: "Projekt nicht gefunden." };
        }
        const updatePayload: Record<string, unknown> = {
          starts_at: request.proposed_starts_at,
          ends_at: request.proposed_ends_at,
          break_minutes: request.proposed_break_minutes,
        };
        if (request.proposed_project_id) updatePayload.project_id = request.proposed_project_id;

        const { data: updated, error } = await supabase
          .from("calendar_shifts")
          .update(updatePayload)
          .eq("id", request.shift_id)
          .eq("tenant_id", tenant.id)
          .select("id");
        if (error) return { ok: false, error: error.code === "23P01" ? CONFLICT_MESSAGE : translateDbError(error) };
        if (!updated || updated.length === 0) {
          return { ok: false, error: "Kein Zugriff auf diese Schicht — bitte an einen Administrator übergeben." };
        }
      }
    }

    const { data: decided, error: decideError } = await supabase
      .from("calendar_shift_change_requests")
      .update({
        status: data.decision,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        decision_note: data.decisionNote ?? null,
      })
      .eq("id", requestId)
      .eq("tenant_id", tenant.id)
      .eq("status", "pending")
      .select("id");
    if (decideError) return { ok: false, error: translateDbError(decideError) };
    if (!decided || decided.length === 0) return { ok: false, error: "Diese Anfrage wurde bereits entschieden." };

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);

    void notifyChangeRequestDecided({
      tenant,
      workerId: request.worker_id,
      shiftId: request.shift_id,
      kind: request.kind,
      decision: data.decision,
      decisionNote: data.decisionNote ?? null,
      proposedStartsAt: request.proposed_starts_at,
      proposedEndsAt: request.proposed_ends_at,
    }).catch((e) => {
      console.error("[calendar/actions] notifyChangeRequestDecided fehlgeschlagen (fail-soft):", e);
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// KEIN Typ-Re-Export hier (Turbopack-Server-Actions-Bug, siehe
// PHASENSTATUS.md "Kunden Area", Bugfix-Absatz) — Panels importieren
// `CalendarWorkerRow`/`CalendarProjectRow`/… direkt aus
// `@/lib/calendar/schema`.
