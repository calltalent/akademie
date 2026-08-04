-- Marketplace M1 (Plan Abschnitt 1.3, 03.08.2026): Provisions-Einstellungen
-- und Auszahlungs-Ledger. Beide Tabellen OHNE Client-Policies — Praezedenzfall
-- `public.platform_admins` (20260711224500_platform_admins.sql): "RLS aktiv +
-- keine Policy = Standard-Deny" fuer anon/authenticated, nur `service_role`
-- (umgeht RLS grundsaetzlich) liest/schreibt, Pruefung ausschliesslich
-- serverseitig ueber Admin-Client (requirePlatformAdmin(), Plan Abschnitt 7).
--
-- Bewusste Abweichung von CLAUDE.md §2.1 ("Jede neue Tabelle: tenant_id + RLS
-- aktiviert + Policies im selben Migrationsschritt"): hier gibt es zwar
-- `tenant_id`, aber bewusst KEINE Policy fuer Mandanten selbst — dokumentiert
-- im Plan Abschnitt 11.3 und in PHASENSTATUS.md. Sobald Mandanten ihre
-- eigenen Erloese direkt einsehen sollen (spaeterer Block), kommt eine
-- eigene, engere Policy dazu; bis dahin laeuft die Mandanten-Ansicht ueber
-- eine Server-Route mit explizitem tenant_id-Filter (kein direkter
-- REST-Zugriff).
--
-- Provisionsrechnung in Basispunkten (Ganzzahl-Arithmetik, keine Rundungs-
-- Drift durch numeric/float): commission_cents = floor(gross_cents * rate_bp
-- / 10000). Standard-Provisionssatz 2000 bp = 20 % (mit Josip abgestimmt,
-- Plan Abschnitt "Grundsatzentscheidungen" Punkt 5). Der Satz wird in JEDE
-- Ledger-Zeile KOPIERT (marketplace_ledger.commission_rate_bp), nicht per
-- Fremdschluessel auf platform_settings referenziert — eine spaetere
-- Anpassung des globalen Satzes darf bereits abgerechnete Zeilen nicht
-- rueckwirkend veraendern. `unique(order_id)` liefert die Stripe-Webhook-
-- Idempotenz (doppelte Zustellung erzeugt keine zweite Ledger-Zeile).

create table public.platform_settings (
  id boolean primary key default true check (id),
  commission_rate_bp int not null default 2000 check (commission_rate_bp between 0 and 10000),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (true) on conflict do nothing;
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;

create table public.marketplace_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  listing_id uuid references public.marketplace_listings(id) on delete set null,
  gross_cents int not null,
  commission_rate_bp int not null,
  commission_cents int not null,
  net_cents int not null,
  currency text not null default 'eur',
  payout_status text not null default 'open' check (payout_status in ('open','paid','cancelled')),
  paid_at timestamptz,
  payout_reference text,
  created_at timestamptz not null default now()
);
create index marketplace_ledger_tenant_idx on public.marketplace_ledger (tenant_id, payout_status);
alter table public.marketplace_ledger enable row level security;
revoke all on public.marketplace_ledger from anon, authenticated;
