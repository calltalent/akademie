-- Einstellungen-Bereich (Referenz Einstellungen.dc.html, „Voller Ausbau"):
-- erweiterte Profilfelder, Benachrichtigungs-Präferenzen und Zugriff auf die
-- eigenen Auth-Sessions (Geräte-Tab).

-- 1) Erweiterte Profilfelder + Benachrichtigungs-Präferenzen (jsonb).
--    `full_name`/`avatar_url`/`email`/`locale` existieren bereits. `position`
--    heißt bewusst `job_position` (vermeidet das Postgres-Schlüsselwort).
alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone text,
  add column if not exists city text,
  add column if not exists job_position text,
  add column if not exists about text,
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- 2) Avatar-Bucket. Öffentlich lesbar (Anzeige in TopBar/Einstellungen),
--    Schreiben/Ändern/Löschen nur im eigenen Ordner {user_id}/...
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy avatars_public_read on storage.objects
  for select using (bucket_id = 'avatars');

create policy avatars_own_write on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_own_update on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_own_delete on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3) Eigene aktive Sessions (Geräte-Tab). Das auth-Schema ist dem normalen
--    Client nicht zugänglich, daher SECURITY DEFINER — die Funktion filtert
--    strikt auf den aufrufenden Nutzer (auth.uid()) und markiert die aktuelle
--    Session über den `session_id`-Claim des JWT.
create or replace function public.my_sessions()
returns table (
  id uuid,
  user_agent text,
  ip text,
  updated_at timestamptz,
  created_at timestamptz,
  is_current boolean
)
language sql stable security definer
set search_path = public, auth
as $$
  select
    s.id,
    s.user_agent,
    host(s.ip) as ip,
    s.updated_at,
    s.created_at,
    s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid as is_current
  from auth.sessions s
  where s.user_id = auth.uid()
  order by s.updated_at desc nulls last;
$$;

revoke all on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated;

-- Eine eigene Session abmelden (nie die aktuelle). Löscht die Session-Zeile →
-- Refresh-Token ungültig, das Gerät ist ausgeloggt.
create or replace function public.revoke_my_session(target uuid)
returns void
language plpgsql volatile security definer
set search_path = public, auth
as $$
begin
  delete from auth.sessions s
  where s.id = target
    and s.user_id = auth.uid()
    and s.id <> nullif(auth.jwt() ->> 'session_id', '')::uuid;
end;
$$;

revoke all on function public.revoke_my_session(uuid) from public, anon;
grant execute on function public.revoke_my_session(uuid) to authenticated;
