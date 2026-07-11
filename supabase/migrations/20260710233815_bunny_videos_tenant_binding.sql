-- Security-Fix (security-reviewer-Audit 11.07.2026, MITTEL): Bunny-Video-IDs
-- hatten keine Mandantenbindung in der DB - ein Staff-Mitglied konnte
-- theoretisch ein fremdes bunnyVideoId (falls bekannt) in die eigene
-- Lektion einbetten, da saveLessonBlocks nur das Format pruefte, nie das
-- Eigentum. Diese Tabelle haelt fest, welches Bunny-Video zu welchem
-- Mandanten gehoert (beim create-video-Aufruf befuellt); saveLessonBlocks
-- prueft ab jetzt dagegen.
create table public.bunny_videos (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  video_id   text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index bunny_videos_tenant_idx on public.bunny_videos (tenant_id);

alter table public.bunny_videos enable row level security;

create policy bunny_videos_staff_all on public.bunny_videos
  for all using (is_staff(tenant_id)) with check (is_staff(tenant_id));
