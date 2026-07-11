-- Phase 4, Block 5 — PWA/Web-Push-Fundament
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_tenant_idx on public.push_subscriptions (tenant_id);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Nutzer verwaltet ausschliesslich die eigenen Subscriptions (anlegen beim
-- Aktivieren von Push, loeschen beim Abbestellen). Kein Staff-Zugriff noetig
-- fuer dieses Fundament (kein Admin-UI fuer Push in diesem Block).
create policy push_subscriptions_own_all on public.push_subscriptions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.member_role(tenant_id) is not null);
