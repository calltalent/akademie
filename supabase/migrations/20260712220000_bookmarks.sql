-- Design-Block (12.07.2026, Claude-Design-Export Teil 2, Lesezeichen.dc.html
-- / Kurs.dc.html — von Josip als verbindlich bestätigt). Echtes Datenmodell
-- für den "Lesezeichen"-Menüpunkt (bisher nur ehrliche Platzhalterseite,
-- siehe PHASENSTATUS.md "Design-Update"). Struktur/RLS-Muster 1:1 an
-- push_subscriptions (20260711225617) angelehnt: Nutzer verwaltet
-- ausschliesslich eigene Zeilen, RLS erzwingt Eigentum UND aktive
-- Mitgliedschaft im Mandanten, kein Staff-Zugriff noetig.
create table public.bookmarks (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  lesson_id  uuid not null references public.lessons(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);
create index bookmarks_tenant_idx on public.bookmarks (tenant_id);
create index bookmarks_user_idx on public.bookmarks (user_id);

alter table public.bookmarks enable row level security;

create policy bookmarks_own_all on public.bookmarks
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.member_role(tenant_id) is not null);
