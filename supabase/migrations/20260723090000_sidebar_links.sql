-- Admin-verwaltbare externe Links im "LINKS"-Bereich der Lernbereich-Sidebar
-- (Josips Auftrag, 23.07.2026: "z.B. Unser YouTube-Kanal, Feedback Gespräch").
-- Erscheint in JEDER Lernenden-Sidebar des Mandanten, deshalb member_select;
-- geschrieben wird nur von owner/admin, exakt dasselbe Muster wie
-- memberships_admin_write (0001_init.sql) — /admin/einstellungen, wo diese
-- Links verwaltet werden, ist insgesamt schon auf dieser Stufe gegatet
-- (checkAdminAccess(), nicht das allgemeinere is_staff()).

create table public.sidebar_links (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  label      text not null,
  url        text not null,
  position   int  not null default 0
);
create index sidebar_links_tenant_idx on public.sidebar_links (tenant_id);

alter table public.sidebar_links enable row level security;

create policy sidebar_links_member_select on public.sidebar_links
  for select using (public.member_role(tenant_id) is not null);

create policy sidebar_links_admin_write on public.sidebar_links
  for all using (public.member_role(tenant_id) in ('owner', 'admin'))
  with check (public.member_role(tenant_id) in ('owner', 'admin'));
