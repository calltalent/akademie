-- "Schichtplan" Block S3 — Änderungsanfragen-UI, Projektleiter-Zugang zum
-- Admin-Bereich (Josips Auftrag, architect-Plan, 09.08.2026).
--
-- KEINE neuen Tabellen/Spalten/Indizes über die vier Ergänzungen unten hinaus
-- — das komplette Schema für S1–S4 liegt bereits in
-- 20260807142619_shift_calendar.sql (siehe dessen Kopfkommentar,
-- Architekturentscheidung "ein vollständiges Schema jetzt"). Diese Migration
-- behebt vier beim S3-Review verifizierte RLS-Lücken:
--
--   1. calendar_change_requests_insert (S1, Zeile 685) hatte KEINEN Zweig für
--      Arbeiter-Selbstanfrage — nur calendar_is_admin()/calendar_leads_worker(),
--      ein Arbeiter konnte selbst KEINE Änderungsanfrage stellen.
--   2. Kein Schutz dagegen, dass ein Arbeiter eine Anfrage auf die Schicht
--      eines KOLLEGEN stellt — der zusammengesetzte FK (shift_id, tenant_id)
--      bindet nur an den Mandanten, nicht an den Arbeiter. Neue Funktion
--      calendar_may_request_change() schließt das.
--   3. proposed_break_minutes hatte KEINEN Wertebereich-Check, anders als
--      calendar_shifts.break_minutes (0-480).
--   4. profiles_select (20260712234600_rls_consolidate_part_b.sql) verlangt
--      is_staff() — ein Projektleiter mit reiner 'member'-Kursrolle sieht
--      dadurch KEINE Arbeiternamen. Statt profiles_select aufzuweichen (das
--      würde JEDES Profil-Feld für JEDEN Projektleiter öffnen): neue
--      security-definer-Funktion calendar_planner_worker_names(), liefert
--      NUR id/full_name/email der Arbeiter, die der Aufrufer tatsächlich
--      sehen darf (Admin: alle, Projektleiter: nur die eigenen Projekte).
--
-- Konventionen unverändert aus S1/S2: `create or replace`, `drop policy` +
-- `create policy` (kein multiple_permissive_policies-Fund), `security
-- definer` mit `set search_path = public`, `revoke ... from public` +
-- `grant ... to authenticated, service_role` bei jeder neuen/geänderten,
-- DIREKT aufrufbaren Funktion.
--
-- NICHT ANGEWENDET (CLAUDE.md §4.6): nur die Datei anlegen. Anwendung
-- (`apply_migration` + `get_advisors()`) übernimmt der Orchestrator nach
-- diesem Bau-Schritt.

-- =================================================================
-- 1. calendar_may_request_change() — darf dieser Arbeiter für DIESE Schicht
--    überhaupt eine Änderungsanfrage stellen?
-- =================================================================
-- Nur die eigene, nicht bereits stornierte Schicht — verhindert, dass ein
-- Arbeiter (trotz des zusammengesetzten FK, der nur an den Mandanten bindet)
-- eine Anfrage auf die Schicht eines Kollegen einreicht.
create or replace function public.calendar_may_request_change(t uuid, shift uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.calendar_shifts s
    where s.id = shift and s.tenant_id = t
      and s.status <> 'cancelled'
      and s.worker_id = public.calendar_worker_id(t)
  );
$$;

revoke execute on function public.calendar_may_request_change(uuid, uuid) from public;
grant execute on function public.calendar_may_request_change(uuid, uuid) to authenticated, service_role;

-- =================================================================
-- 2. calendar_planner_worker_names() — Arbeitername/E-Mail für die
--    Änderungsanfragen-Inbox, OHNE profiles_select (is_staff()) aufzuweichen
-- =================================================================
-- Admin sieht alle Arbeiter des Mandanten, ein Projektleiter nur die Arbeiter
-- seiner eigenen Projekte (calendar_leads_worker()), jeder andere Aufrufer
-- bekommt eine leere Ergebnismenge.
create or replace function public.calendar_planner_worker_names(t uuid)
returns table (id uuid, full_name text, email text)
language sql stable security definer
set search_path = public
as $$
  select w.id, p.full_name, p.email
  from public.calendar_workers w
  join public.profiles p on p.id = w.user_id
  where w.tenant_id = t
    and (public.calendar_is_admin(t) or public.calendar_leads_worker(w.id));
$$;

revoke execute on function public.calendar_planner_worker_names(uuid) from public;
grant execute on function public.calendar_planner_worker_names(uuid) to authenticated, service_role;

-- =================================================================
-- 3. calendar_change_requests_insert — dritter Zweig: Arbeiter-Selbstanfrage
-- =================================================================
-- Ein Arbeiter darf eine Anfrage NUR für die eigene, aktive Schicht stellen,
-- immer im Status 'pending', ohne bereits eine Entscheidung/einen
-- Projektwechsel mitzuschicken (decided_by/decided_at/decision_note müssen
-- NULL sein, proposed_project_id ebenfalls — Projektwechsel bleibt in S3
-- exklusiv Admin/Projektleiter vorbehalten, siehe Bauauftrag).
drop policy calendar_change_requests_insert on public.calendar_shift_change_requests;
create policy calendar_change_requests_insert on public.calendar_shift_change_requests
  for insert with check (
    public.calendar_is_admin(tenant_id)
    or public.calendar_leads_worker(worker_id)
    or (
      worker_id = public.calendar_worker_id(tenant_id)
      and status = 'pending'
      and decided_by is null and decided_at is null and decision_note is null
      and proposed_project_id is null
      and public.calendar_may_request_change(tenant_id, shift_id)
    )
  );

-- =================================================================
-- 4. Wertebereich für proposed_break_minutes (analog calendar_shifts.break_minutes)
-- =================================================================
alter table public.calendar_shift_change_requests
  add constraint calendar_change_requests_break_range
  check (proposed_break_minutes is null or proposed_break_minutes between 0 and 480);

-- =================================================================
-- 5. Index für die Änderungsanfragen-Inbox (Filter tenant_id/status, sortiert
--    nach created_at) — bisher nur ein Einzel-Index auf tenant_id.
-- =================================================================
create index calendar_change_requests_tenant_status_created_idx
  on public.calendar_shift_change_requests (tenant_id, status, created_at desc);
