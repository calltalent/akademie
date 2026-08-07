import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  toCalendarProjectRow,
  type CalendarAbsenceRow,
  type CalendarAdminShiftRow,
  type CalendarChangeRequestRow,
  type CalendarOpenSlotRow,
  type CalendarProjectRow,
  type CalendarShiftRow,
  type CalendarSlotRow,
  type CalendarTimeEntryRow,
  type CalendarWorkerRow,
} from "@/lib/calendar/schema";

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

// =====================================================================
// Block S2 (08.08.2026) — Admin-Schicht-CRUD, Zeitfenster-Verwaltung,
// Freelancer-Selbstbuchung, Abwesenheiten/Feiertage.
// =====================================================================

/**
 * ALLE Schichten des Mandanten in einem Zeitraum [from, to) für das
 * Admin-Wochenraster — ANDERS als `getWorkerShifts` oben bewusst OHNE
 * `.neq("status", "cancelled")`: Admin soll auch Stornos sehen (UI blendet
 * sie visuell aus, siehe `calendar-shifts-panel.tsx`).
 */
export async function getAdminCalendarShifts(
  supabase: SupabaseServerClient,
  tenantId: string,
  fromIso: string,
  toIso: string,
): Promise<CalendarAdminShiftRow[]> {
  const { data } = await supabase
    .from("calendar_shifts")
    .select(
      "id, worker_id, project_id, slot_id, starts_at, ends_at, break_minutes, status, source, note, calendar_projects(name, color), calendar_workers(profiles(full_name, email))",
    )
    .eq("tenant_id", tenantId)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .order("starts_at", { ascending: true });

  return (data ?? []).map((row) => {
    const project = embeddedOne(row.calendar_projects as { name: string; color: string | null } | { name: string; color: string | null }[] | null);
    const worker = embeddedOne(
      row.calendar_workers as { profiles: unknown } | { profiles: unknown }[] | null,
    );
    const profile = worker
      ? embeddedOne(worker.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null)
      : null;
    return {
      id: row.id,
      workerId: row.worker_id,
      workerName: profile ? profile.full_name || profile.email : null,
      projectId: row.project_id,
      projectName: project?.name ?? null,
      projectColor: project?.color ?? null,
      slotId: row.slot_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      breakMinutes: row.break_minutes,
      status: row.status,
      source: row.source,
      note: row.note,
    };
  });
}

/**
 * Zeitfenster des Mandanten in einem Zeitraum [from, to), mit gebuchter
 * Anzahl je Zeitfenster (zweite Abfrage auf calendar_shifts mit
 * `in("slot_id", ids)`, in JS gruppiert — kein PostgREST-Aggregat über die
 * Relation nötig für eine Handvoll Zeitfenster pro Woche).
 */
export async function getAdminCalendarSlots(
  supabase: SupabaseServerClient,
  tenantId: string,
  fromIso: string,
  toIso: string,
): Promise<CalendarSlotRow[]> {
  const { data: slotsRaw } = await supabase
    .from("calendar_slots")
    .select("id, project_id, starts_at, ends_at, capacity, status, calendar_projects(name, color)")
    .eq("tenant_id", tenantId)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .order("starts_at", { ascending: true });

  const slots = slotsRaw ?? [];
  const slotIds = slots.map((s) => s.id as string);

  let bookedBySlot = new Map<string, number>();
  if (slotIds.length > 0) {
    const { data: bookings } = await supabase
      .from("calendar_shifts")
      .select("slot_id")
      .eq("tenant_id", tenantId)
      .in("slot_id", slotIds)
      .neq("status", "cancelled");
    bookedBySlot = new Map();
    for (const row of bookings ?? []) {
      const key = row.slot_id as string;
      bookedBySlot.set(key, (bookedBySlot.get(key) ?? 0) + 1);
    }
  }

  return slots.map((row) => {
    const project = embeddedOne(row.calendar_projects as { name: string; color: string | null } | { name: string; color: string | null }[] | null);
    return {
      id: row.id,
      projectId: row.project_id,
      projectName: project?.name ?? null,
      projectColor: project?.color ?? null,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      capacity: row.capacity,
      status: row.status,
      bookedCount: bookedBySlot.get(row.id as string) ?? 0,
    };
  });
}

/** Feiertage/Abwesenheiten des Mandanten, die das Jahr `year` berühren (Overlap, nicht nur "beginnt in diesem Jahr" — eine Abwesenheit über den Jahreswechsel soll in beiden Jahren erscheinen). */
export async function getAdminCalendarAbsences(
  supabase: SupabaseServerClient,
  tenantId: string,
  year: number,
): Promise<CalendarAbsenceRow[]> {
  const { data } = await supabase
    .from("calendar_absences")
    .select("id, worker_id, kind, starts_on, ends_on, note, status, calendar_workers(profiles(full_name, email))")
    .eq("tenant_id", tenantId)
    .lte("starts_on", `${year}-12-31`)
    .gte("ends_on", `${year}-01-01`)
    .order("starts_on", { ascending: true });

  return (data ?? []).map((row) => {
    const worker = embeddedOne(
      row.calendar_workers as { profiles: unknown } | { profiles: unknown }[] | null,
    );
    const profile = worker
      ? embeddedOne(worker.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null)
      : null;
    return {
      id: row.id,
      workerId: row.worker_id,
      workerName: profile ? profile.full_name || profile.email : null,
      kind: row.kind,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      note: row.note,
      status: row.status,
    };
  });
}

/**
 * Offene Zeitfenster der eigenen Projekte für die Selbstbuchungs-Ansicht
 * (Freelancer) — EIN Aufruf der `security definer`-Funktion
 * `calendar_open_slots()` (S2-Migration), liefert Kapazität/freie
 * Plätze/"bereits gebucht" bereits fertig berechnet.
 */
type CalendarOpenSlotDbRow = {
  id: string;
  project_id: string;
  project_name: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  free_seats: number;
  already_booked: boolean;
};

export async function getOpenSlotsForWorker(
  supabase: SupabaseServerClient,
  tenantId: string,
  fromIso: string,
  toIso: string,
): Promise<CalendarOpenSlotRow[]> {
  // `calendar_open_slots` ist eine neue RPC-Funktion (S2-Migration, noch
  // nicht auf der DB angewendet) — die generierten Supabase-Typen kennen sie
  // deshalb noch nicht, `.rpc()` liefert hier `unknown`. Manuelles Casting
  // auf die per Migration definierte `returns table(...)`-Form (Abschnitt 6
  // von 20260807171725_shift_calendar_s2.sql). Nach `npx supabase gen types`
  // (nach Anwendung der Migration) kann dieser Cast entfallen.
  const { data } = await supabase.rpc("calendar_open_slots", { t: tenantId, from_ts: fromIso, to_ts: toIso });
  const rows = (data ?? []) as unknown as CalendarOpenSlotDbRow[];

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    freeSeats: row.free_seats,
    alreadyBooked: row.already_booked,
  }));
}

// =====================================================================
// Block S3 (09.08.2026) — Änderungsanfragen-UI, Projektleiter-Zugang.
// =====================================================================

type CalendarChangeRequestDbRow = {
  id: string;
  shift_id: string;
  worker_id: string;
  kind: "update" | "cancel";
  proposed_starts_at: string | null;
  proposed_ends_at: string | null;
  proposed_break_minutes: number | null;
  proposed_project_id: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  calendar_shifts:
    | {
        starts_at: string;
        ends_at: string;
        break_minutes: number;
        status: CalendarAdminShiftRow["status"];
        calendar_projects: { name: string; color: string | null } | { name: string; color: string | null }[] | null;
      }
    | {
        starts_at: string;
        ends_at: string;
        break_minutes: number;
        status: CalendarAdminShiftRow["status"];
        calendar_projects: { name: string; color: string | null } | { name: string; color: string | null }[] | null;
      }[]
    | null;
};

function toChangeRequestRow(row: CalendarChangeRequestDbRow, workerName: string | null): CalendarChangeRequestRow {
  const shift = embeddedOne(row.calendar_shifts);
  const project = shift ? embeddedOne(shift.calendar_projects) : null;
  return {
    id: row.id,
    shiftId: row.shift_id,
    workerId: row.worker_id,
    workerName,
    kind: row.kind,
    proposedStartsAt: row.proposed_starts_at,
    proposedEndsAt: row.proposed_ends_at,
    proposedBreakMinutes: row.proposed_break_minutes,
    proposedProjectId: row.proposed_project_id,
    reason: row.reason,
    status: row.status,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    shiftStartsAt: shift?.starts_at ?? row.created_at,
    shiftEndsAt: shift?.ends_at ?? row.created_at,
    shiftBreakMinutes: shift?.break_minutes ?? 0,
    shiftStatus: shift?.status ?? "planned",
    projectName: project?.name ?? null,
    projectColor: project?.color ?? null,
  };
}

const CHANGE_REQUEST_SELECT =
  "id, shift_id, worker_id, kind, proposed_starts_at, proposed_ends_at, proposed_break_minutes, proposed_project_id, reason, status, decision_note, decided_at, created_at, calendar_shifts(starts_at, ends_at, break_minutes, status, calendar_projects(name, color))";

/**
 * Änderungsanfragen des Mandanten (Admin-/Projektleiter-Inbox) — EINE
 * Abfrage mit eingebetteter Relation auf `calendar_shifts` (Kontext der
 * Ursprungsschicht), sortiert `created_at desc`. Bewusst KEIN
 * `calendar_workers(profiles(...))`-Embed hier — `profiles_select` verlangt
 * `is_staff()`, ein Projektleiter mit reiner `member`-Kursrolle bekäme sonst
 * still eine leere Relation zurück (RLS-Lücke 4 des S3-Bauauftrags). Der
 * Arbeitername kommt stattdessen separat aus `getPlannerWorkerNames()`
 * (`calendar_planner_worker_names()`-RPC), das die Sichtbarkeit korrekt nach
 * Admin/Projektleiter filtert.
 */
export async function getCalendarChangeRequests(
  supabase: SupabaseServerClient,
  tenantId: string,
  filter: "pending" | "decided" | "all",
): Promise<CalendarChangeRequestRow[]> {
  let query = supabase
    .from("calendar_shift_change_requests")
    .select(CHANGE_REQUEST_SELECT)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (filter === "pending") query = query.eq("status", "pending");
  else if (filter === "decided") query = query.neq("status", "pending");

  const { data } = await query;
  return ((data ?? []) as unknown as CalendarChangeRequestDbRow[]).map((row) => toChangeRequestRow(row, null));
}

/** Alle eigenen Änderungsanfragen eines Arbeiters (Lernbereich-Ansicht). */
export async function getWorkerChangeRequests(
  supabase: SupabaseServerClient,
  tenantId: string,
  workerId: string,
): Promise<CalendarChangeRequestRow[]> {
  const { data } = await supabase
    .from("calendar_shift_change_requests")
    .select(CHANGE_REQUEST_SELECT)
    .eq("tenant_id", tenantId)
    .eq("worker_id", workerId)
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as CalendarChangeRequestDbRow[]).map((row) => toChangeRequestRow(row, null));
}

/** Arbeitername/E-Mail für die Änderungsanfragen-Inbox — `calendar_planner_worker_names()`-RPC (S3-Migration), liefert für Admin alle Arbeiter des Mandanten, für Projektleiter nur die seiner eigenen Projekte. */
export async function getPlannerWorkerNames(
  supabase: SupabaseServerClient,
  tenantId: string,
): Promise<Map<string, { fullName: string | null; email: string }>> {
  // Gleicher Grund wie bei calendar_open_slots() (S2, siehe dortiger
  // Kommentar): neue RPC-Funktion, noch nicht auf der DB angewendet, die
  // generierten Supabase-Typen kennen sie deshalb noch nicht.
  const { data } = await supabase.rpc("calendar_planner_worker_names", { t: tenantId });
  const rows = (data ?? []) as unknown as { id: string; full_name: string | null; email: string }[];
  return new Map(rows.map((r) => [r.id, { fullName: r.full_name, email: r.email }]));
}

/** Anzahl offener (pending) Änderungsanfragen des Mandanten — für das Sidebar-Badge. */
export async function getPendingChangeRequestCount(
  supabase: SupabaseServerClient,
  tenantId: string,
): Promise<number> {
  const { count } = await supabase
    .from("calendar_shift_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "pending");
  return count ?? 0;
}

/** Abwesenheiten eines Arbeiters (inkl. mandantenweiter Feiertage, worker_id null) in einem Zeitraum — für die Markierung im eigenen Wochenraster. */
export async function getWorkerAbsences(
  supabase: SupabaseServerClient,
  tenantId: string,
  workerId: string,
  fromIso: string,
  toIso: string,
): Promise<CalendarAbsenceRow[]> {
  const { data } = await supabase
    .from("calendar_absences")
    .select("id, worker_id, kind, starts_on, ends_on, note, status")
    .eq("tenant_id", tenantId)
    .or(`worker_id.eq.${workerId},worker_id.is.null`)
    .lte("starts_on", toIso)
    .gte("ends_on", fromIso)
    .order("starts_on", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    workerId: row.worker_id,
    workerName: null,
    kind: row.kind,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    note: row.note,
    status: row.status,
  }));
}
