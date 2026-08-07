import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { toCalendarProjectRow, type CalendarProjectRow, type CalendarShiftRow, type CalendarTimeEntryRow, type CalendarWorkerRow } from "@/lib/calendar/schema";

/**
 * Leseabfragen für Server Components (Block S1, 07.08.2026) — eigene Woche,
 * eigene Projekte, Admin-Arbeiterliste, Admin-Projektliste. Gleiches Prinzip
 * wie `admin/marketplace/page.tsx`: RLS filtert automatisch auf den eigenen
 * Mandanten/die eigene Zeile, `.eq("tenant_id", …)` ist zusätzliche
 * Defense-in-Depth, kein Ersatz für RLS.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Eingebettete n:1-Relation (postgrest-js typisiert sie als Array, liefert zur Laufzeit ein Objekt) — gleicher Fallstrick wie in admin/teilnehmer/page.tsx/kunden-area/page.tsx. */
function embeddedOne<T>(value: T[] | T | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Eigene Arbeiterzeile des angemeldeten Nutzers, oder `null` (kein Schichtplan-Zugriff). */
export async function getOwnCalendarWorker(
  supabase: SupabaseServerClient,
  tenantId: string,
  userId: string,
): Promise<CalendarWorkerRow | null> {
  const { data } = await supabase
    .from("calendar_workers")
    .select(
      "id, membership_id, user_id, worker_type, status, target_hours, target_period, preferred_shift, preferred_weekdays, note, profiles(full_name, email)",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
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

/** Geplante Schichten eines Arbeiters in einem Zeitraum [from, to) — für die Wochenansicht. */
export async function getWorkerShifts(
  supabase: SupabaseServerClient,
  tenantId: string,
  workerId: string,
  fromIso: string,
  toIso: string,
): Promise<CalendarShiftRow[]> {
  const { data } = await supabase
    .from("calendar_shifts")
    .select(
      "id, worker_id, project_id, starts_at, ends_at, break_minutes, status, note, calendar_projects(name, color)",
    )
    .eq("tenant_id", tenantId)
    .eq("worker_id", workerId)
    .neq("status", "cancelled")
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .order("starts_at", { ascending: true });

  return (data ?? []).map((row) => {
    const project = embeddedOne(row.calendar_projects as { name: string; color: string | null } | { name: string; color: string | null }[] | null);
    return {
      id: row.id,
      workerId: row.worker_id,
      projectId: row.project_id,
      projectName: project?.name ?? null,
      projectColor: project?.color ?? null,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      breakMinutes: row.break_minutes,
      status: row.status,
      note: row.note,
    };
  });
}

/** Offener Stempel-Eintrag (eingestempelt, noch nicht ausgestempelt) eines Arbeiters, oder `null`. */
export async function getOpenTimeEntry(
  supabase: SupabaseServerClient,
  tenantId: string,
  workerId: string,
): Promise<CalendarTimeEntryRow | null> {
  const { data } = await supabase
    .from("calendar_time_entries")
    .select("id, worker_id, shift_id, started_at, ended_at, source, note")
    .eq("tenant_id", tenantId)
    .eq("worker_id", workerId)
    .is("ended_at", null)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    workerId: data.worker_id,
    shiftId: data.shift_id,
    startedAt: data.started_at,
    endedAt: data.ended_at,
    source: data.source,
    note: data.note,
  };
}

/** Stempel-Einträge eines Arbeiters in einem Zeitraum [from, to) — für die Wochenansicht (Ist-Zeiten neben geplanten Schichten). */
export async function getWorkerTimeEntries(
  supabase: SupabaseServerClient,
  tenantId: string,
  workerId: string,
  fromIso: string,
  toIso: string,
): Promise<CalendarTimeEntryRow[]> {
  const { data } = await supabase
    .from("calendar_time_entries")
    .select("id, worker_id, shift_id, started_at, ended_at, source, note")
    .eq("tenant_id", tenantId)
    .eq("worker_id", workerId)
    .gte("started_at", fromIso)
    .lt("started_at", toIso)
    .order("started_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    workerId: row.worker_id,
    shiftId: row.shift_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    source: row.source,
    note: row.note,
  }));
}

/** Alle Arbeiter des Mandanten (Admin-Arbeiterliste), mit Namen/E-Mail aus dem Profil. */
export async function getAdminCalendarWorkers(
  supabase: SupabaseServerClient,
  tenantId: string,
): Promise<CalendarWorkerRow[]> {
  const { data } = await supabase
    .from("calendar_workers")
    .select(
      "id, membership_id, user_id, worker_type, status, target_hours, target_period, preferred_shift, preferred_weekdays, note, created_at, profiles(full_name, email)",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => {
    const profile = embeddedOne(row.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null);
    return {
      id: row.id,
      membershipId: row.membership_id,
      userId: row.user_id,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? "",
      workerType: row.worker_type,
      status: row.status,
      targetHours: row.target_hours,
      targetPeriod: row.target_period,
      preferredShift: row.preferred_shift,
      preferredWeekdays: row.preferred_weekdays ?? [],
      note: row.note,
    };
  });
}

/** Aktive Mandanten-Mitgliedschaften OHNE bestehende Arbeiterzeile — Auswahlliste für "Arbeiter anlegen". */
export async function getMembershipsWithoutWorker(
  supabase: SupabaseServerClient,
  tenantId: string,
): Promise<{ membershipId: string; userId: string; fullName: string | null; email: string; role: string }[]> {
  const [{ data: memberships }, { data: workers }] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, user_id, role, profiles(full_name, email)")
      .eq("tenant_id", tenantId)
      .eq("status", "active"),
    supabase.from("calendar_workers").select("membership_id").eq("tenant_id", tenantId),
  ]);

  const takenMembershipIds = new Set((workers ?? []).map((w) => w.membership_id as string));

  return (memberships ?? [])
    .filter((m) => !takenMembershipIds.has(m.id))
    .map((m) => {
      const profile = embeddedOne(m.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null);
      return {
        membershipId: m.id as string,
        userId: m.user_id as string,
        fullName: profile?.full_name ?? null,
        email: profile?.email ?? "",
        role: m.role as string,
      };
    })
    .filter((m) => m.email !== "");
}

/** Alle Projekte des Mandanten (Admin-Projektliste), mit Projektleiter-Name und zugewiesenen Arbeiter-IDs. */
export async function getAdminCalendarProjects(
  supabase: SupabaseServerClient,
  tenantId: string,
): Promise<CalendarProjectRow[]> {
  const [{ data: projectsRaw }, { data: membersRaw }] = await Promise.all([
    supabase
      .from("calendar_projects")
      .select("id, name, description, color, lead_user_id, status, position, profiles(full_name, email)")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    supabase.from("calendar_project_members").select("project_id, worker_id").eq("tenant_id", tenantId),
  ]);

  return (projectsRaw ?? []).map((row) => {
    const lead = embeddedOne(row.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null);
    const leadName = lead ? lead.full_name || lead.email : null;
    const memberWorkerIds = (membersRaw ?? [])
      .filter((m) => m.project_id === row.id)
      .map((m) => m.worker_id as string);
    return toCalendarProjectRow(row, leadName, memberWorkerIds);
  });
}

/** Aktive Arbeiter des Mandanten für die Projektleiter-/Mitglieder-Auswahl im Admin-UI. */
export async function getActiveCalendarWorkersForSelection(
  supabase: SupabaseServerClient,
  tenantId: string,
): Promise<{ id: string; fullName: string | null; email: string }[]> {
  const { data } = await supabase
    .from("calendar_workers")
    .select("id, status, profiles(full_name, email)")
    .eq("tenant_id", tenantId)
    .eq("status", "active");

  return (data ?? []).map((row) => {
    const profile = embeddedOne(row.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null);
    return { id: row.id, fullName: profile?.full_name ?? null, email: profile?.email ?? "" };
  });
}
