-- Marketplace M1 (Plan Abschnitt 1.2, 03.08.2026): Freigabe-Datensatz je
-- Kurs. Eigene Tabelle statt Spalten direkt auf `courses`, weil der
-- Freigabestatus (`status`) dem Betreiber gehoert und der Inhalt dem
-- Mandanten — RLS kann Spaltenrechte innerhalb EINER Zeile nicht sauber
-- trennen (ein Mandant duerfte `headline`/`price_cents` schreiben, aber nie
-- `status`; eine Zeilen-Policy kann das nicht abbilden).
--
-- `public_slug` ist global eindeutig (anders als `courses.slug`, das nur
-- `unique(tenant_id, slug)` ist) — generiert als `{tenant_slug}-{course_slug}`
-- mit numerischem Suffix bei Kollision (Anwendungscode, Muster:
-- src/lib/courses/resolve-slug.ts). `status` (Betreiber-Review) und
-- `enabled` (Mandanten-Schalter) sind bewusst getrennt: oeffentlich sichtbar
-- ist ein Listing NUR bei `status='approved' AND enabled`.
--
-- KEINE Policy fuer anon/authenticated: der oeffentliche Marketplace-Katalog
-- laeuft ausschliesslich ueber service_role + explizite Spalten-Allowlist
-- (src/lib/marketplace/catalog.ts, Plan Abschnitt 3) — exakt die Lehre aus
-- dem behobenen `products_public_select`-Leck
-- (20260710233735_security_hardening_storage_listing_and_products.sql):
-- ein RLS-Policy auf `authenticated`/`anon` kann "nur genehmigte,
-- freigeschaltete Felder ausgewaehlter Spalten" strukturell nicht
-- durchsetzen, das kann nur eine Server-Funktion mit expliziter
-- Spaltenliste. Mandanten-Staff darf lesen/schreiben, aber `status` NIE
-- selbst auf 'approved' setzen — `with check` erzwingt das bei insert/update
-- exakt nach dem Vorbild der Selbst-Eskalations-Sperre in
-- 20260801150000_memberships_owner_escalation_fix.sql (dort: `role`-Wert
-- eingeschraenkt; hier: `status`-Wert eingeschraenkt).

create table public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  public_slug text not null unique,
  headline text,
  summary text,
  cover_url text,
  price_cents int not null default 0 check (price_cents >= 0),
  currency text not null default 'eur',
  product_id uuid references public.products(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','suspended')),
  enabled boolean not null default true,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id)
);
create index marketplace_listings_tenant_idx on public.marketplace_listings (tenant_id);
create index marketplace_listings_status_idx on public.marketplace_listings (status) where enabled;

-- updated_at-Trigger, gleiches generisches Muster wie courses/lessons/progress/
-- ai_jobs (0001_init.sql, public.set_updated_at()). Ergaenzung gegenueber dem
-- Plantext, der diesen Trigger nicht explizit erwaehnt, aber die Spalte
-- `updated_at` fordert — ohne Trigger bliebe sie nach Anlage dauerhaft
-- veraltet (siehe PHASENSTATUS.md, Block "Marketplace M1").
create trigger marketplace_listings_touch
  before update on public.marketplace_listings
  for each row execute function public.set_updated_at();

alter table public.marketplace_listings enable row level security;

create policy ml_staff_select on public.marketplace_listings
  for select using (public.is_staff(tenant_id));

create policy ml_staff_insert on public.marketplace_listings
  for insert with check (
    public.is_staff(tenant_id) and status in ('draft','submitted')
  );

create policy ml_staff_update on public.marketplace_listings
  for update using (public.is_staff(tenant_id))
  with check (
    public.is_staff(tenant_id) and status in ('draft','submitted')
  );

create policy ml_staff_delete on public.marketplace_listings
  for delete using (public.is_staff(tenant_id));
