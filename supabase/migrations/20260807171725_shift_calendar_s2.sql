-- "Schichtplan" Block S2 — Admin-Schicht-CRUD, Zeitfenster-Verwaltung,
-- Freelancer-Selbstbuchung, Feiertagsimport, Freelancer-Sollstunden-
-- Selbstverwaltung (Josips Auftrag, architect-Plan, 08.08.2026).
--
-- KEINE neuen Tabellen/Spalten/Indizes — das komplette Schema für S1–S4
-- liegt bereits in 20260807142619_shift_calendar.sql (siehe dessen
-- Kopfkommentar, Architekturentscheidung "ein vollständiges Schema jetzt").
-- Diese Migration schließt die dort bewusst offen gelassenen S2-Lücken:
--
--   1. calendar_shifts_insert hatte KEINEN Zweig für Arbeiter-
--      Selbstbuchung (Freelancer bucht sich selbst in ein offenes
--      Zeitfenster ein) — nur Admin/Projektleiter konnten Schichten
--      anlegen.
--   2. calendar_workers_update erlaubte NUR Admin — kein
--      Spaltenschutz-Trigger für die jetzt gebaute Freelancer-
--      Selbstverwaltung von target_hours/target_period (Vorbild:
--      calendar_time_entries_guard() aus S1).
--
-- Plus drei Härtungspunkte, die laut architect-Review in dieselbe S2-
-- Migration gehören (kein eigener Nachzieh-Schritt):
--
--   3. calendar_self_may_book(t, slot) prüfte nicht die
--      Projektmitgliedschaft — ein Freelancer hätte sich in JEDES offene
--      Zeitfenster des Mandanten einbuchen können, nicht nur in die
--      Zeitfenster seiner eigenen Projekte.
--   4. calendar_slot_free_seats(slot) hatte keinen Mandantenbezug —
--      gleiche Fehlerklasse wie der S1-security-reviewer-Fund H1 bei der
--      Feiertags-Policy (jeder authentifizierte Nutzer der Plattform hätte
--      per direktem RPC-Aufruf freie Plätze fremder Mandanten auslesen
--      können).
--   5. src/lib/gdpr/export.ts zog calendar_* noch nicht nach — S2 fügt mit
--      kind='sick' ein Gesundheitsdatum (DSGVO Art. 9) zu
--      calendar_absences hinzu, das MUSS Teil der Selbstauskunft sein
--      (reiner Anwendungscode, keine Migration nötig, siehe dortige
--      Änderung).
--
-- Konventionen unverändert aus S1 (siehe dessen Kopfkommentar Punkt 5):
-- `drop policy` + `create policy` statt einer zweiten permissiven Policy
-- (sonst multiple_permissive_policies-Advisor-Fund), `security definer`
-- mit `set search_path = public`, `revoke ... from public` + `grant ...
-- to authenticated, service_role` bei jeder neuen/geänderten, DIREKT
-- aufrufbaren Funktion (Trigger-Funktionen bekommen wie in S1 KEINEN
-- Grant — sie laufen intern über den Trigger, nie per direktem RPC-Aufruf).
--
-- NICHT ANGEWENDET (CLAUDE.md §4.6): nur die Datei anlegen. Anwendung
-- (`apply_migration` + `get_advisors()`) übernimmt der Orchestrator nach
-- diesem Bau-Schritt.

-- =================================================================
-- 1. calendar_self_may_book() — jetzt MIT Projektmitgliedschafts-Prüfung
-- =================================================================
-- Vorher (S1) konnte sich ein Freelancer in JEDES offene Zeitfenster des
-- Mandanten einbuchen. Jetzt zusätzlich: das Zeitfenster muss ein Projekt
-- haben (kein Buchen ohne Projektbezug) UND der Arbeiter muss über
-- calendar_project_members diesem Projekt zugewiesen sein.
create or replace function public.calendar_self_may_book(t uuid, slot uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.calendar_workers w
    join public.calendar_slots s on s.tenant_id = w.tenant_id
    where w.tenant_id = t and w.user_id = auth.uid()
      and w.worker_type = 'freelancer' and w.status = 'active'
      and s.id = slot and s.status = 'open'
      and s.project_id is not null
      and exists (
        select 1 from public.calendar_project_members pm
        where pm.worker_id = w.id and pm.project_id = s.project_id
      )
  );
$$;

revoke execute on function public.calendar_self_may_book(uuid, uuid) from public;
grant execute on function public.calendar_self_may_book(uuid, uuid) to authenticated, service_role;

-- =================================================================
-- 2. calendar_shifts_insert — dritter Zweig: Freelancer-Selbstbuchung
-- =================================================================
-- Weiterhin KEIN UPDATE/DELETE-Zweig für Arbeiter auf calendar_shifts —
-- der Änderungsweg für eine bereits gebuchte Schicht ist
-- calendar_shift_change_requests (S3, Schema bereits vorhanden). Eine
-- Selbstbuchung ist nur ein reines INSERT mit source='self',
-- status='planned', gebunden an ein konkretes Zeitfenster.
drop policy calendar_shifts_insert on public.calendar_shifts;
create policy calendar_shifts_insert on public.calendar_shifts
  for insert with check (
    public.calendar_is_admin(tenant_id)
    or public.calendar_leads_project(project_id)
    or (
      source = 'self'
      and status = 'planned'
      and slot_id is not null
      and worker_id = public.calendar_worker_id(tenant_id)
      and public.calendar_self_may_book(tenant_id, slot_id)
    )
  );

-- =================================================================
-- 3. calendar_slot_capacity_guard() — dritte Prüfung: Projekt-Konsistenz
-- =================================================================
-- Bisher (S1) prüfte der Trigger nur "innerhalb des Zeitfensters" (CT002)
-- und "nicht überbucht" (CT001). Jetzt zusätzlich: das project_id der
-- Schicht muss zum project_id des Zeitfensters passen — ohne diese Prüfung
-- könnte ein Admin (der laut RLS-Policy oben weiterhin frei schreiben darf)
-- versehentlich eine Schicht mit einem ABWEICHENDEN Projekt an ein
-- Zeitfenster eines anderen Projekts hängen, was die Selbstbuchungs-
-- Sichtprüfung in calendar_open_slots() (Abschnitt 6) inkonsistent machen
-- würde.
create or replace function public.calendar_slot_capacity_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_slot record; v_taken int;
begin
  if new.slot_id is null or new.status = 'cancelled' then return null; end if;
  select capacity, starts_at, ends_at, project_id into v_slot
    from public.calendar_slots where id = new.slot_id for update;
  if not found then return null; end if;
  if new.starts_at < v_slot.starts_at or new.ends_at > v_slot.ends_at then
    raise exception 'calendar_shift_outside_slot' using errcode = 'CT002';
  end if;
  if new.project_id is distinct from v_slot.project_id then
    raise exception 'calendar_shift_wrong_project' using errcode = 'CT003';
  end if;
  select count(*) into v_taken from public.calendar_shifts
    where slot_id = new.slot_id and status <> 'cancelled';
  if v_taken > v_slot.capacity then
    raise exception 'calendar_slot_full' using errcode = 'CT001';
  end if;
  return null;
end $$;

-- Trigger neu erstellen (project_id jetzt Teil der "update of"-Spaltenliste
-- — ein reiner Projektwechsel auf einer bestehenden Schicht muss den Guard
-- erneut auslösen, sonst würde CT003 nur beim initialen Insert greifen).
drop trigger if exists calendar_shifts_slot_capacity on public.calendar_shifts;
create trigger calendar_shifts_slot_capacity
  after insert or update of slot_id, status, starts_at, ends_at, project_id
  on public.calendar_shifts
  for each row execute function public.calendar_slot_capacity_guard();

-- =================================================================
-- 4. calendar_workers_update — zweiter Zweig: Freelancer-Selbstverwaltung
-- =================================================================
-- Nur Sollstunden/-zeitraum sind über diesen Zweig erreichbar — der
-- eigentliche Spaltenschutz liegt NICHT in dieser Policy (USING/WITH CHECK
-- sehen nur "darf die Zeile überhaupt angefasst werden", nicht "welche
-- Spalte"), sondern im Trigger calendar_workers_guard() in Abschnitt 5.
-- Nur AKTIVE Freelancer — Festangestellte verwalten ihre Sollstunden nicht
-- selbst (Josips ausdrückliche Vorgabe), ein deaktivierter Freelancer
-- ebenfalls nicht.
drop policy calendar_workers_update on public.calendar_workers;
create policy calendar_workers_update on public.calendar_workers
  for update using (
    public.calendar_is_admin(tenant_id)
    or (user_id = (select auth.uid()) and worker_type = 'freelancer' and status = 'active')
  )
  with check (
    public.calendar_is_admin(tenant_id)
    or (user_id = (select auth.uid()) and worker_type = 'freelancer' and status = 'active')
  );

-- =================================================================
-- 5. calendar_workers_guard() — Spaltenschutz-Trigger (Vorbild:
--    calendar_time_entries_guard() aus S1)
-- =================================================================
-- Für Nicht-Admins wird JEDE Spalte außer target_hours/target_period/
-- updated_at zwingend auf OLD zurückgesetzt — ein Freelancer könnte sich
-- über die Policy oben sonst z. B. selbst zum 'employee' machen oder
-- worker_type/status/membership_id manipulieren, obwohl die Policy nur
-- "target_hours ändern" ermöglichen soll. Gleiches Funktionsprinzip wie
-- calendar_time_entries_guard(): NEW wird zeilenweise auf OLD
-- zurückgeschrieben, außer bei den erlaubten Spalten.
create or replace function public.calendar_workers_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.calendar_is_admin(new.tenant_id) then
    return new;
  end if;

  new.id                := old.id;
  new.tenant_id          := old.tenant_id;
  new.membership_id      := old.membership_id;
  new.user_id            := old.user_id;
  new.worker_type        := old.worker_type;
  new.status             := old.status;
  new.preferred_shift    := old.preferred_shift;
  new.preferred_weekdays := old.preferred_weekdays;
  new.note               := old.note;
  new.created_at         := old.created_at;
  -- target_hours/target_period/updated_at bleiben NEW — das einzig erlaubte
  -- Delta für die Freelancer-Selbstverwaltung.
  return new;
end;
$$;

-- WICHTIG: Trigger-Name muss alphabetisch VOR calendar_workers_touch
-- liegen (Postgres führt BEFORE-Trigger auf derselben Tabelle in
-- alphabetischer Namensreihenfolge aus) — "calendar_workers_guard_trg" <
-- "calendar_workers_touch" (g < t), der Spaltenschutz greift also, bevor
-- set_updated_at() updated_at anfasst. Reihenfolge hier bewusst so
-- benannt, nicht zufällig korrekt.
drop trigger if exists calendar_workers_guard_trg on public.calendar_workers;
create trigger calendar_workers_guard_trg
  before update on public.calendar_workers
  for each row execute function public.calendar_workers_guard();

-- =================================================================
-- 6. calendar_slot_free_seats() härten + neue calendar_open_slots()
-- =================================================================
-- calendar_slot_free_seats(): gleiche Fehlerklasse wie der S1-security-
-- reviewer-Fund H1 (calendar_absences_select) — ohne Mandantenbezug hätte
-- JEDER authentifizierte Nutzer der Plattform per direktem RPC-Aufruf die
-- freie Platzzahl eines Zeitfensters aus einem FREMDEN Mandanten auslesen
-- können. member_role(s.tenant_id) is not null (0001_init.sql) liefert
-- null für Nicht-Mitglieder, exakt der richtige Baustein (wie beim H1-Fix).
create or replace function public.calendar_slot_free_seats(slot uuid)
returns int
language sql stable security definer
set search_path = public
as $$
  select greatest(s.capacity - count(sh.id), 0)::int
  from public.calendar_slots s
  left join public.calendar_shifts sh on sh.slot_id = s.id and sh.status <> 'cancelled'
  where s.id = slot
    and public.member_role(s.tenant_id) is not null
  group by s.capacity;
$$;

revoke execute on function public.calendar_slot_free_seats(uuid) from public;
grant execute on function public.calendar_slot_free_seats(uuid) to authenticated, service_role;

-- calendar_open_slots(): liefert die offenen Zeitfenster der eigenen
-- Projekte für die Selbstbuchungs-Ansicht des Arbeiters — EIN RPC-Aufruf
-- statt einer Abfrage direkt auf calendar_slots (Freelancer haben laut
-- calendar_slots_select-Policy aus S1 zwar bereits Lesezugriff auf die
-- Zeitfenster ihrer Projekte, aber weder "freie Plätze" noch "bereits
-- gebucht" sind dort direkt sichtbar). security definer, da die
-- Kapazitätsberechnung über calendar_shifts geht, auf das ein Freelancer
-- keinen mandantenweiten Lesezugriff hat.
create or replace function public.calendar_open_slots(t uuid, from_ts timestamptz, to_ts timestamptz)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity int,
  free_seats int,
  already_booked boolean
)
language sql stable security definer
set search_path = public
as $$
  select
    s.id,
    s.project_id,
    cp.name as project_name,
    s.starts_at,
    s.ends_at,
    s.capacity,
    greatest(s.capacity - count(sh.id) filter (where sh.status <> 'cancelled'), 0)::int as free_seats,
    coalesce(
      bool_or(sh.worker_id = public.calendar_worker_id(t) and sh.status <> 'cancelled'),
      false
    ) as already_booked
  from public.calendar_slots s
  join public.calendar_projects cp on cp.id = s.project_id and cp.tenant_id = s.tenant_id
  join public.calendar_project_members pm
    on pm.project_id = s.project_id and pm.worker_id = public.calendar_worker_id(t)
  left join public.calendar_shifts sh on sh.slot_id = s.id
  where s.tenant_id = t
    and s.status = 'open'
    and s.starts_at >= from_ts
    and s.starts_at < to_ts
  group by s.id, s.project_id, cp.name, s.starts_at, s.ends_at, s.capacity
  order by s.starts_at;
$$;

revoke execute on function public.calendar_open_slots(uuid, timestamptz, timestamptz) from public;
grant execute on function public.calendar_open_slots(uuid, timestamptz, timestamptz) to authenticated, service_role;
