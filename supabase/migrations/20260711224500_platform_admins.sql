-- Phase 4, Block 1 (Betreiber-Portal-Fundament): plattformweite, NICHT
-- mandantengebundene Admin-Rolle. `memberships.tenant_id` ist `not null` --
-- eine eigene Tabelle ist sauberer als ein Sonderfall in bestehenden
-- RLS-Policies/Queries. KEINE Client-Policies: nur service_role liest/
-- schreibt, Pruefung ausschliesslich serverseitig ueber Admin-Client
-- (src/lib/platform/auth.ts, requirePlatformAdmin()), analog zum Muster,
-- dass sensible Cross-Tenant-Daten nie direkt per RLS an `authenticated`
-- freigegeben werden.

create table public.platform_admins (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
-- Bewusst KEINE Policies: RLS aktiv + keine Policy = Standard-Deny fuer
-- anon/authenticated, nur service_role (umgeht RLS grundsaetzlich) kann
-- lesen/schreiben.

revoke all on public.platform_admins from anon, authenticated;
