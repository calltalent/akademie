-- Phase 4, Block 3 — DSGVO-Loeschantraege (Art. 17 DSGVO)
-- Loeschung ist bewusst KEIN Sofort-Hard-Delete: legt nur einen Antrag an,
-- die eigentliche Pruefung/Loeschung bleibt manueller Prozess (Aufbewahrungs-
-- pflichten wie Rechnungen/HGB/AO koennen dem entgegenstehen).

create table public.deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  reason       text,
  status       text not null default 'pending' check (status in ('pending','completed','rejected')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.profiles(id)
);
create index deletion_requests_tenant_idx on public.deletion_requests (tenant_id);
create index deletion_requests_user_idx on public.deletion_requests (user_id);
-- Nur EIN offener Antrag pro Nutzer/Mandant gleichzeitig (partieller Unique-Index).
create unique index deletion_requests_pending_unique on public.deletion_requests (tenant_id, user_id) where status = 'pending';

alter table public.deletion_requests enable row level security;

-- Nutzer darf fuer sich selbst einen Antrag anlegen, aber nur fuer einen
-- Mandanten, in dem er tatsaechlich Mitglied ist.
create policy deletion_requests_self_insert on public.deletion_requests
  for insert
  with check (user_id = auth.uid() and public.member_role(tenant_id) is not null);

-- Nutzer sieht die eigenen Antraege, Staff sieht alle Antraege des eigenen Mandanten.
create policy deletion_requests_select on public.deletion_requests
  for select
  using (user_id = auth.uid() or public.is_staff(tenant_id));

-- Nur owner/admin duerfen einen Antrag bearbeiten (Status/processed_at/processed_by) —
-- analog memberships_admin_write.
create policy deletion_requests_admin_update on public.deletion_requests
  for update
  using (public.member_role(tenant_id) in ('owner','admin'));
