-- Sicherheits-Fix (security-reviewer, S3-Durchlauf, 09.08.2026, HOCH):
--
-- calendar_change_requests_select/calendar_change_requests_update prüften
-- calendar_leads_worker(worker_id) — "leitet der Aufrufer IRGENDEIN Projekt,
-- dem dieser Arbeiter zugewiesen ist". Das ist arbeiter-, nicht
-- schichtbezogen. Ein Arbeiter kann Mitglied mehrerer Projekte sein
-- (calendar_project_members hat keinen Unique-Constraint pro Arbeiter).
--
-- Angriffsweg: Arbeiter W ist Mitglied von Projekt A (Lead X) UND Projekt B
-- (Lead Y). W stellt eine Änderungsanfrage für eine Schicht aus Projekt B.
-- Lead X (leitet NICHT B) erfüllt trotzdem calendar_leads_worker(W) = true,
-- weil er Projekt A leitet. Für die GENEHMIGUNG war das schon vorher
-- folgenlos (calendar_shifts_update prüft zusätzlich
-- calendar_leads_project(project_id), Lead X scheitert dort korrekt, die
-- Anfrage bleibt pending). Für ABLEHNUNG wird calendar_shifts gar nicht
-- angefasst (decideShiftChangeRequest() schreibt bei rejected direkt auf
-- calendar_shift_change_requests) — dort griff bisher nur die schwache
-- calendar_leads_worker()-Policy. Lead X konnte damit fremde Anfragen lesen
-- (reason/proposed_*) UND ablehnen (inkl. eigener decision_note),
-- Lead Y die Entscheidung entziehend.
--
-- Fix: neue Hilfsfunktion calendar_leads_change_request(shift) prüft
-- gezielt, ob der Aufrufer das PROJEKT DIESER SCHICHT leitet (über
-- calendar_leads_project(), nicht calendar_leads_worker()). Ersetzt den
-- entsprechenden Zweig in SELECT und UPDATE. INSERT bleibt unverändert
-- (calendar_leads_worker() dort ist harmlos — kein UI-Pfad nutzt diesen
-- Zweig aktuell, Admin/Projektleiter legen in S3 keine Anfragen im Namen
-- eines Arbeiters an).

create or replace function public.calendar_leads_change_request(request_shift_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.calendar_shifts s
    where s.id = request_shift_id and public.calendar_leads_project(s.project_id)
  );
$$;

revoke execute on function public.calendar_leads_change_request(uuid) from public;
grant execute on function public.calendar_leads_change_request(uuid) to authenticated, service_role;

drop policy calendar_change_requests_select on public.calendar_shift_change_requests;
create policy calendar_change_requests_select on public.calendar_shift_change_requests
  for select using (
    public.calendar_is_admin(tenant_id)
    or worker_id = public.calendar_worker_id(tenant_id)
    or public.calendar_leads_change_request(shift_id)
  );

drop policy calendar_change_requests_update on public.calendar_shift_change_requests;
create policy calendar_change_requests_update on public.calendar_shift_change_requests
  for update using (
    public.calendar_is_admin(tenant_id)
    or public.calendar_leads_change_request(shift_id)
  )
  with check (
    public.calendar_is_admin(tenant_id)
    or public.calendar_leads_change_request(shift_id)
  );
