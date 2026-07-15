-- Rekonstruktion einer auf der Live-DB bereits vorhandenen, im Repo aber
-- fehlenden Migration (Architekt-Bericht 16.07.2026). Die Tabelle
-- tenant_domains (Zuordnung Custom-Domain -> Mandant, vom Middleware-
-- Host-Resolver genutzt) existiert produktiv seit 12.07.2026; diese Datei
-- bildet ihren IST-Zustand 1:1 ab und ist bewusst vollstaendig idempotent,
-- damit ihr Nachziehen auf der Live-DB ein echtes No-Op ist:
--   * create table if not exists  -> Tabelle existiert dort bereits
--   * enable row level security   -> von sich aus idempotent (kein Fehler,
--                                    wenn RLS schon an ist)
--   * create policy kennt KEIN if not exists -> in einen DO-Block mit
--     Exception-Handling (duplicate_object) gepackt
--   * create index if not exists
--
-- Namensgenauigkeit: Constraint-Namen (tenant_domains_pkey,
-- tenant_domains_domain_key, tenant_domains_tenant_id_fkey) ergeben sich aus
-- der Inline-Spaltensyntax und entsprechen exakt den live vergebenen Namen.
-- Der tenant_id-Index heisst live tenant_domains_tenant_id_idx (NICHT die
-- repo-uebliche *_tenant_idx-Form) — dieser Name wird bewusst uebernommen,
-- sonst wuerde `create index if not exists tenant_domains_tenant_idx` auf der
-- Live-DB einen zweiten, redundanten Index anlegen statt ein No-Op zu sein.
--
-- Policy tenant_domains_member_select: Lesezugriff fuer jedes aktive Mitglied
-- des Mandanten (member_role(tenant_id) is not null) — identisch zur
-- Live-Definition. Es gibt hier kein blankes auth.uid() im Policy-Ausdruck,
-- daher entfaellt die (select auth.uid())-Initplan-Umschreibung; auth.uid()
-- steckt bereits im security-definer-Helfer public.member_role (0001_init.sql).
create table if not exists public.tenant_domains (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  domain     text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists tenant_domains_tenant_id_idx
  on public.tenant_domains (tenant_id);

alter table public.tenant_domains enable row level security;

-- CREATE POLICY hat kein IF NOT EXISTS: DO-Block faengt den erneuten Anlegen-
-- Versuch (duplicate_object) ab, damit die Datei auf der Live-DB ein No-Op ist.
do $$
begin
  create policy tenant_domains_member_select on public.tenant_domains
    for select
    using (public.member_role(tenant_id) is not null);
exception
  when duplicate_object then null;
end
$$;
