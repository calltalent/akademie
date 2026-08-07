-- Nachzieh-Migration nach get_advisors()-Lauf direkt nach Anwendung von
-- 20260807142619_shift_calendar.sql (07.08.2026) — gleiches Vorgehen wie
-- 20260805090100_customer_area_rls_perf_fix.sql: fehlende FK-Indizes sofort
-- nachgezogen statt als technische Schuld stehen zu lassen. Alle Funde waren
-- INFO-Stufe (Tabellen noch leer, kein akutes Datenrisiko), aber dasselbe
-- Muster wie beim Vorbild.
--
-- Ursache: für zusammengesetzte Fremdschlüssel (fremd_id, tenant_id) reicht
-- laut Supabase-Performance-Advisor ein Index auf NUR die erste Spalte nicht
-- als "deckender Index" — er verlangt eine Indexspalte je FK-Spalte in
-- passender Reihenfolge. Die Basis-Migration hatte für mehrere Tabellen nur
-- die fachlich sinnvolleren Sortier-/Einzelspalten-Indizes angelegt (z. B.
-- (worker_id, starts_at) für die Wochenansicht) — die reinen
-- FK-Deckungsindizes fehlten zusätzlich. Beide Arten bleiben nebeneinander
-- bestehen, sie bedienen unterschiedliche Abfragen.

create index calendar_absences_created_by_idx on public.calendar_absences (created_by);
create index calendar_absences_decided_by_idx on public.calendar_absences (decided_by);
create index calendar_absences_worker_tenant_idx on public.calendar_absences (worker_id, tenant_id);

create index calendar_project_members_worker_tenant_idx on public.calendar_project_members (worker_id, tenant_id);

create index calendar_change_requests_shift_tenant_idx on public.calendar_shift_change_requests (shift_id, tenant_id);
create index calendar_change_requests_worker_tenant_idx on public.calendar_shift_change_requests (worker_id, tenant_id);
create index calendar_change_requests_decided_by_idx on public.calendar_shift_change_requests (decided_by);

create index calendar_shifts_project_tenant_idx on public.calendar_shifts (project_id, tenant_id);
create index calendar_shifts_slot_tenant_idx on public.calendar_shifts (slot_id, tenant_id);
create index calendar_shifts_worker_tenant_idx on public.calendar_shifts (worker_id, tenant_id);

create index calendar_slots_project_tenant_idx on public.calendar_slots (project_id, tenant_id);

create index calendar_time_entries_created_by_idx on public.calendar_time_entries (created_by);
create index calendar_time_entries_worker_tenant_idx on public.calendar_time_entries (worker_id, tenant_id);

create index calendar_workers_membership_tenant_idx on public.calendar_workers (membership_id, tenant_id);
