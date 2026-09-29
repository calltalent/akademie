-- S7, S8, S9 (Sicherheitsaudit 27.09.2026), eine gemeinsame RLS-Migration.
--
-- S7 (vorher M9): Storage-Policy `submissions_own_all` prueft nur den
-- Nutzer-Ordner [2], nie den Mandanten-Ordner [1]. Jeder Angemeldete kann
-- unter `{fremder_mandant}/{eigene_id}/` Dateien anlegen, ueberschreiben und
-- loeschen; der fremde Staff sieht sie dann in seinem Abgaben-Bereich.
--
-- S8 (vorher H2/M20): `progress_own_insert/update` pruefen nur
-- `user_id = auth.uid()`. Fortschrittszeilen lassen sich mit fremder
-- tenant_id und beliebiger lesson_id anlegen und verfaelschen das Reporting
-- anderer Mandanten. Die Luecke ist in 20260803100000 (Zeile 257 ff.) als
-- bewusst nicht repariert vermerkt.
--
-- S9 (Erweiterung von H17): Der Selbst-Zweig von
-- `calendar_time_entries_insert` prueft nur `started_at` (+-5 Minuten), nicht
-- `ended_at`. Ein Arbeiter legt in einem Aufruf einen bereits abgeschlossenen
-- Eintrag ueber 500 Stunden an. Der Guard-Trigger laeuft nur bei UPDATE und
-- begrenzt dort `ended_at` nicht; Ausstempeln in die Zukunft ist moeglich.

-- =================================================================
-- S7: Abgaben-Dateien an Mitgliedschaft im Mandanten-Ordner binden
-- =================================================================
drop policy if exists submissions_own_all on storage.objects;
create policy submissions_own_all on storage.objects
  for all using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.can_participate(((storage.foldername(name))[1])::uuid)
  ) with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.can_participate(((storage.foldername(name))[1])::uuid)
  );

-- =================================================================
-- S8: Fortschritt nur im eigenen Mandanten und fuer dessen Lektionen
-- =================================================================
drop policy if exists progress_own_insert on public.progress;
create policy progress_own_insert on public.progress
  for insert with check (
    user_id = (select auth.uid())
    and public.can_participate(tenant_id)
    and exists (
      select 1 from public.lessons l
      where l.id = progress.lesson_id and l.tenant_id = progress.tenant_id
    )
  );

drop policy if exists progress_own_update on public.progress;
create policy progress_own_update on public.progress
  for update using (
    user_id = (select auth.uid())
  ) with check (
    user_id = (select auth.uid())
    and public.can_participate(tenant_id)
    and exists (
      select 1 from public.lessons l
      where l.id = progress.lesson_id and l.tenant_id = progress.tenant_id
    )
  );

-- =================================================================
-- S9: Einstempeln ohne Ende, Ausstempeln nicht in der Zukunft
-- =================================================================
drop policy if exists calendar_time_entries_insert on public.calendar_time_entries;
create policy calendar_time_entries_insert on public.calendar_time_entries
  for insert with check (
    public.calendar_is_admin(tenant_id)
    or public.calendar_leads_worker(worker_id)
    or (
      worker_id = public.calendar_worker_id(tenant_id)
      and source = 'self'
      and started_at between now() - interval '5 minutes' and now() + interval '5 minutes'
      and ended_at is null
    )
  );

-- Bestehender Guard (20260807173156) plus eine Zeile: fuer Arbeiter ohne
-- Admin-/Projektleiter-Recht wird ein Ende in der Zukunft auf jetzt gekappt.
-- Die Dauer eines Eintrags entspricht damit immer echter vergangener Zeit.
create or replace function public.calendar_time_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  if new.ended_at is not null and new.ended_at > now() then
    new.ended_at := now();
  end if;
  return new;
end;
$$;

-- Advisor-Fund (27.09.2026): Trigger-Funktionen brauchen kein EXECUTE fuer
-- anon/authenticated; Trigger laufen unabhaengig davon.
revoke execute on function public.calendar_time_entries_guard() from public, anon, authenticated;
