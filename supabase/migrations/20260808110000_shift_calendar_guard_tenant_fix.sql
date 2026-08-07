-- Sicherheits-Fix (security-reviewer, S2-Durchlauf, 08.08.2026, MITTEL):
--
-- calendar_workers_guard() (20260808100000_shift_calendar_s2.sql) und
-- calendar_time_entries_guard() (20260807142619_shift_calendar.sql, S1)
-- prüften beide `calendar_is_admin(new.tenant_id)` statt `old.tenant_id`,
-- BEVOR sie new.tenant_id auf old.tenant_id zurücksetzen.
--
-- Angriffsweg: ein Nutzer, der in Mandant A eine eigene calendar_workers-
-- Zeile hat (z. B. als Freelancer) UND in einem anderen Mandanten B
-- tatsächlich owner/admin ist, kann bei einem UPDATE auf seine eigene Zeile
-- in Mandant A `tenant_id = B` und `membership_id = <eigene membership_id
-- in B>` mitschicken. Die zusammengesetzte FK-Prüfung
-- (membership_id, tenant_id) -> memberships(id, tenant_id) ist dann erfüllt
-- (echte Mitgliedschaft in B), calendar_is_admin(new.tenant_id) liefert für
-- B `true`, der Guard überspringt den kompletten Spaltenschutz und lässt
-- NEW unverändert durch — die Zeile könnte inklusive worker_type/status
-- unbemerkt nach Mandant B wandern, sofern noch keine Kind-Zeilen
-- (calendar_shifts/calendar_time_entries/...) existieren, die ihrerseits
-- eine zusammengesetzte FK auf (id, tenant_id) der Arbeiterzeile halten und
-- den Wechsel verhindern würden.
--
-- Fix: `old.tenant_id` statt `new.tenant_id` prüfen — der Trigger fragt
-- damit "war der Aufrufer Admin des Mandanten, in dem die Zeile TATSÄCHLICH
-- lag", nicht "wird er es im vom Client vorgeschlagenen Zielzustand sein".
-- Kein Verhaltensunterschied für den regulären Admin-Pfad (Admins ändern
-- nie mandantenübergreifend eigene Zeilen), schließt aber den beschriebenen
-- Weg vollständig, unabhängig vom Zustand der Kind-Tabellen.
--
-- Betrifft aktuell 0 Zeilen live (calendar_workers/calendar_time_entries
-- sind noch leer) — kein akuter Datenschaden, aber vor dem ersten
-- produktiven Mehrmandanten-Nutzer zu schließen.

create or replace function public.calendar_workers_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.calendar_is_admin(old.tenant_id) then
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

create or replace function public.calendar_time_entries_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.calendar_is_admin(old.tenant_id) or public.calendar_leads_worker(old.worker_id) then
    return new;
  end if;

  new.tenant_id  := old.tenant_id;
  new.worker_id  := old.worker_id;
  new.shift_id   := old.shift_id;
  new.started_at := old.started_at;
  new.source     := old.source;
  new.note       := old.note;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  -- ended_at/updated_at bleiben NEW — das einzig erlaubte Delta.
  return new;
end;
$$;
