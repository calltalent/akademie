-- Affiliate-Modul, Block B1 "Fundament" (PLAN_Affiliate-System.md Abschnitt 10/B1,
-- 10.09.2026). Diese Datei setzt Abschnitt 3.0 (a)-(d), 3.1, 3.2, 3.3, 3.4, 3.5,
-- 3.13 und 3.16 des Plans um. Sie ist vollstaendig inert: kein Anwendungscode
-- liest oder schreibt diese Tabellen, es gibt keine Route und keinen Menuepunkt.
--
-- ANLASS
-- Ein Mandant soll Partner werben lassen und ihnen Provision zahlen koennen.
-- Das ist Geld- und Personaldatenverarbeitung, also der Teil des Systems, bei dem
-- ein Fehler nicht "haesslich" ist, sondern teuer und aufbewahrungspflichtig.
--
-- BEFUND (gegen die Live-Datenbank vklqksdiyiijzoirntyt am 10.09.2026 gelesen)
--   1. `public.orders` und `public.products` haben KEIN `unique (id, tenant_id)`
--      (pg_constraint zeigt nur orders_pkey, orders_stripe_checkout_id_key,
--      products_pkey, products_tenant_id_slug_key). Ohne dieses Paar ist der
--      zusammengesetzte Fremdschluessel, der seit
--      20260807142619_shift_calendar.sql:46-49 fuer jede Kindtabelle verbindlich
--      ist, syntaktisch gar nicht anlegbar.
--   2. `orders.status` kennt heute nur ('pending','paid','refunded','failed'),
--      eine TEILerstattung ist damit nicht abbildbar.
--   3. `orders.stripe_payment_intent` hat weder Index noch Eindeutigkeit. Die
--      Bruecke von `charge.refunded` (traegt weder tenant_id noch order_id) zur
--      Bestellung laeuft aber ausschliesslich ueber diese Spalte.
--   4. `public.tenants_operator_settings_guard()` schuetzt heute exakt sechs
--      Betreiber-Schluessel (Live-Quelltext aus pg_proc gelesen, wortgleich mit
--      20260909183548_tenants_column_guard.sql:91-98). Ohne `affiliate_enabled`
--      in dieser Liste schaltet sich jeder Mandanten-Admin das Modul per
--      PostgREST-PATCH auf `tenants.settings` selbst frei.
--   5. Neue Tabellen bekommen in diesem Projekt per `alter default privileges`
--      automatisch ALLE Rechte fuer `anon` UND `authenticated` (an
--      public.calendar_workers nachgesehen). `revoke` ist deshalb kein Zierrat,
--      sondern die erste Schutzschicht.
--   6. `check_function_bodies` steht auf `on`. Eine Funktion mit
--      `language sql` wird deshalb schon beim Anlegen gegen die Tabellen
--      aufgeloest, auf die ihr Rumpf zeigt. Das bestimmt die Reihenfolge dieser
--      Datei, siehe unten.
--
-- LOESUNG
-- Sechs neue Tabellen (Programm, Gruppe, Partner, Kondition, Abrechnungsprofil,
-- Pruefpfad), drei Hilfsfunktionen und die vier Bestandsaenderungen -- alles in
-- EINEM Schritt, damit `tenant_id`, RLS und Policies nie auseinanderfallen
-- (CLAUDE.md §2.1). Betraege durchgaengig `int` in Cent, Saetze `int` in
-- Basispunkten; kein `numeric`, kein Float (Plan G12).
--
-- REIHENFOLGE (Abweichung vom Plan, mit Grund)
-- Der Plan legt die Hilfsfunktionen "vor allen Tabellen" an (3.1) und je Tabelle
-- Policies unmittelbar hinter die Tabelle (3. Vorspann). Beides zusammen ist
-- nicht ausfuehrbar: `affiliate_partner_id()` und `affiliate_downline_ids()`
-- sind `language sql` und lesen `public.affiliate_partners` -- bei
-- `check_function_bodies = on` schlaegt ihr `create` fehl, solange die Tabelle
-- nicht existiert. Umgekehrt wird der Ausdruck einer Policy beim Anlegen
-- aufgeloest, die Funktionen muessen also vor JEDER Policy stehen. Daraus folgt:
--   Abschnitt 0    Bestandsaenderungen
--   Abschnitt 1    affiliate_is_manager() (haengt nur an member_role(), existiert)
--   Abschnitt 2-7  die sechs Tabellen mit Index, Guard, Touch, RLS und Rechten
--   Abschnitt 8    affiliate_partner_id() und affiliate_downline_ids()
--   Abschnitt 9    alle Policies, je Tabelle gruppiert
--   Abschnitt 10   Ausfuehrungsrechte der Guard-Funktionen
-- Inhaltlich ist nichts verschoben: Tabelle, RLS und Policies entstehen im
-- selben Migrationsschritt, wie CLAUDE.md §2.1 es verlangt.
--
-- VORBILDER
--   - Aufbau, Kommentardichte, zusammengesetzte Fremdschluessel, "genau eine
--     SELECT-Policy je Tabelle": 20260807142619_shift_calendar.sql und
--     20260805090000_customer_area.sql.
--   - Standard-Deny ohne Client-Policy samt Begruendung im Kopf:
--     20260803100200_marketplace_ledger.sql:1-15.
--   - Spaltenrechte als zweite Ebene neben RLS und ein Guard-Trigger, der
--     geschuetzte Werte auf OLD zuruecksetzt statt abzulehnen:
--     20260909183548_tenants_column_guard.sql:31-46 und :77-133.
--   - `(select auth.uid())` statt nacktem `auth.uid()` in Policies (Advisor
--     `auth_rls_initplan`): 20260712233000 / 20260712234600_rls_consolidate_part_b.sql.
--   - `revoke execute ... from anon` zusaetzlich zu `from public`:
--     20260907093000_revoke_new_rpcs_from_anon.sql:1-19. Supabase vergibt EXECUTE
--     an `anon` als eigenen Grant ueber `alter default privileges`; `revoke from
--     public` entfernt ihn nachweislich NICHT (Fund vom 07.09.2026).
--
-- ZUM MITLESEN (Plan G17, woertlich): Genau eine SELECT-Policy je Tabelle,
-- getrennte Schreib-Policies. Eine zweite permissive Policy kann einer
-- bestehenden nichts wegnehmen (sie werden ver-ODER-t) und kostet
-- Auswertungszeit pro Zeile. Eine einschraenkend gemeinte Bedingung muss IN die
-- konsolidierte SELECT-Policy hinein. Die `for all ... using(false)`-Deny-Policy
-- wird trotzdem gesetzt, aber ausschliesslich als auditierbare
-- Absichtserklaerung fuer den Linter -- der tatsaechliche Schutz ist
-- `revoke all` plus das Fehlen von Schreib-Policies. In dieser Datei gibt es
-- keine reine Deny-Tabelle: jede der sechs Tabellen hat eine echte
-- SELECT-Policy, `affiliate_events` und `affiliate_document_counters` (Plan 3.10
-- und 3.12) kommen erst mit Block B4 und bringen ihre Deny-Policy dann selbst mit.
--
-- DIESE MIGRATION IST NOCH NICHT ANGEWENDET. Sie wurde in dieser Umgebung auch
-- nicht probeweise gefahren -- es gibt kein lokales Postgres, keinen Docker und
-- keine supabase/config.toml (Plan 12.7). Das Anwenden bleibt Josip vorbehalten
-- (CLAUDE.md §4.6); der Dateiname traegt bis dahin einen Platzhalter-Zeitstempel,
-- weil `apply_migration` die Version nach Ausfuehrungszeitpunkt vergibt.
-- Danach: `get_advisors(security)` UND `get_advisors(performance)` laufen lassen.

-- =================================================================
-- 0. Aenderungen an Bestandstabellen (Plan 3.0)
-- =================================================================

-- (a) Voraussetzung fuer jeden zusammengesetzten Fremdschluessel weiter unten:
--     Postgres verlangt auf der referenzierten Seite eine exakt passende
--     UNIQUE-/PK-Constraint ueber BEIDE Spalten. `id` allein ist zwar bereits
--     eindeutig, das Paar (id, tenant_id) ist es aber noch nicht deklariert --
--     gleiche Stelle wie `memberships_id_tenant_uniq`
--     (20260807142619_shift_calendar.sql:73).
alter table public.products add constraint products_id_tenant_uniq unique (id, tenant_id);
alter table public.orders   add constraint orders_id_tenant_uniq   unique (id, tenant_id);

-- (b) `orders.status` kennt heute nur 'refunded' als Ganz-oder-gar-nicht. Eine
--     Teilerstattung ist damit nicht abbildbar: 'paid' waere falsch (Geld ist
--     teilweise zurueck), 'refunded' ebenfalls (der Zugriff bleibt bestehen).
--     `refunded_cents` haelt den KUMULATIVEN Erstattungsbetrag, weil Stripe
--     genau so zaehlt (`charge.amount_refunded`, Plan G7) -- die Provisions-
--     Gegenbuchung rechnet daraus einen Zielwert und bucht nur das Delta.
alter table public.orders add column refunded_cents int not null default 0
  check (refunded_cents >= 0);
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','paid','partially_refunded','refunded','failed'));

-- (c) `charge.refunded` traegt weder tenant_id noch order_id. Die einzige
--     Bruecke ist charge.payment_intent -> orders.stripe_payment_intent. Der
--     Index macht die Aufloesung bezahlbar, die Eindeutigkeit verhindert, dass
--     eine Erstattung zwei Bestellungen trifft. Partiell, weil die Spalte fuer
--     nicht bezahlte Bestellungen leer bleibt.
--     Live geprueft am 10.09.2026: kein doppelter Wert vorhanden, der Index
--     laesst sich anlegen.
create unique index orders_stripe_payment_intent_uniq
  on public.orders (stripe_payment_intent)
  where stripe_payment_intent is not null;

-- (d) `affiliate_enabled` in die Erlaubnisliste der Betreiber-Schluessel.
--     Ohne diese Zeile schaltet ein Mandanten-Admin das Modul selbst frei.
--     BEWUSST OHNE `security definer` (unveraendert gegenueber
--     20260909183548:70-75): die Funktion muss `current_user` sehen, also die
--     Rolle, unter der die Anweisung tatsaechlich laeuft. Mit `security definer`
--     waere das immer der Eigentuemer der Funktion und die Pruefung waere
--     wirkungslos. Die Pruefung bleibt eine ERLAUBNISLISTE: wer nicht genannt
--     ist, darf die Betreiber-Schluessel nicht aendern.
--     Der Rumpf ist wortgleich uebernommen (Live-Quelltext aus pg_proc gelesen),
--     ergaenzt um genau einen Arrayeintrag und um `pg_temp` im search_path.
create or replace function public.tenants_operator_settings_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- Gesetzt ausschliesslich vom Betreiber-Portal ueber den Admin-Client,
  -- siehe src/lib/platform/actions.ts Zeile 548-559.
  betreiber_schluessel constant text[] := array[
    'payments_enabled',
    'tutor_enabled',
    'course_generator_enabled',
    'marketplace_enabled',
    'shift_calendar_enabled',
    'marketplace_commission_bp',
    'affiliate_enabled'
  ];
  bewahrt jsonb := '{}'::jsonb;
  schluessel text;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  foreach schluessel in array betreiber_schluessel loop
    if old.settings ? schluessel then
      bewahrt := bewahrt || jsonb_build_object(schluessel, old.settings -> schluessel);
    end if;
  end loop;

  -- Erst alle Betreiber-Schluessel aus der eingehenden Fassung entfernen
  -- (auch die, die frueher gar nicht gesetzt waren), dann die bewahrten
  -- Werte daraufsetzen.
  new.settings := (coalesce(new.settings, '{}'::jsonb) - betreiber_schluessel) || bewahrt;
  return new;
end;
$$;

-- Trigger neu binden. `create or replace function` allein wuerde genuegen; das
-- ausdrueckliche Neubinden haelt die Datei fuer sich lesbar und aendert die
-- Reihenfolge nicht: BEFORE-Trigger derselben Tabelle laufen alphabetisch,
-- 'tenants_operator_settings_guard' < 'tenants_touch', der Guard bleibt vorn.
drop trigger if exists tenants_operator_settings_guard on public.tenants;
create trigger tenants_operator_settings_guard
  before update on public.tenants
  for each row execute function public.tenants_operator_settings_guard();

-- =================================================================
-- 1. Hilfsfunktion ohne Tabellenbezug (Plan 3.1, Teil 1)
-- =================================================================

-- Geld- und Personaldaten: owner/admin, NICHT `is_staff()` -- das schliesst
-- 'trainer' ein (0001_init.sql:63-69). Gleiche Begruendung wie beim
-- Schichtkalender (20260807142619_shift_calendar.sql:30-34) und bei der
-- Kunden-Area (20260805090000_customer_area.sql).
create or replace function public.affiliate_is_manager(t uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.member_role(t) in ('owner','admin'), false);
$$;

-- Der doppelte `revoke` ist Pflicht und kein Copy-Paste: `revoke ... from public`
-- entfernt das EXECUTE-Recht der Rolle `anon` NICHT, weil Supabase es ueber
-- `alter default privileges` als eigenen Grant vergibt (nachgewiesener Fund vom
-- 07.09.2026, 20260907093000_revoke_new_rpcs_from_anon.sql). Nach JEDEM
-- kuenftigen `create or replace` dieser Funktion erneut setzen.
revoke execute on function public.affiliate_is_manager(uuid) from public;
revoke execute on function public.affiliate_is_manager(uuid) from anon;
grant  execute on function public.affiliate_is_manager(uuid) to authenticated, service_role;

-- =================================================================
-- 2. affiliate_programs (Plan 3.2) -- die Konfigurationszeile je Mandant
-- =================================================================

create table public.affiliate_programs (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  status                text not null default 'draft' check (status in ('draft','active','paused')),
  visibility            text not null default 'private' check (visibility in ('private','link','public')),
  approval_mode         text not null default 'manual' check (approval_mode in ('manual','auto')),

  -- Standardkondition: unterste Stufe der Vorrangkette. Eine Zeile in
  -- affiliate_conditions schlaegt sie, siehe Abschnitt 5.
  rate_kind             text not null default 'percent' check (rate_kind in ('percent','fixed')),
  rate_bp               int  not null default 2000 check (rate_bp between 0 and 10000),
  fixed_cents           int  not null default 0 check (fixed_cents >= 0),
  min_commission_cents  int  check (min_commission_cents is null or min_commission_cents >= 0),
  max_commission_cents  int  check (max_commission_cents is null or max_commission_cents >= 0),

  -- Provisionsbasis
  basis_kind            text not null default 'net' check (basis_kind in ('net','gross')),
  fee_deduction_bp      int  not null default 0 check (fee_deduction_bp between 0 and 10000),
  currency              text not null default 'eur',

  -- Attribution
  attribution_model     text not null default 'last' check (attribution_model in ('last','first')),
  -- Obergrenze 365 Tage: das Attributions-Cookie traegt maxAge =
  -- cookie_ttl_days * 86400 (Plan 11.8). Die Grenze steht deshalb hier im
  -- Schema und nicht nur im zod-Schema.
  cookie_ttl_days       int  not null default 30 check (cookie_ttl_days between 1 and 365),
  overwrite_policy      text not null default 'allow' check (overwrite_policy in ('allow','deny')),
  lifetime_binding      boolean not null default false,
  self_referral         text not null default 'block' check (self_referral in ('block','allow_flagged')),
  referrer_blocklist    text[] not null default '{}',

  -- Abo
  recurring_mode        text not null default 'first_only'
                          check (recurring_mode in ('first_only','n_periods','all')),
  recurring_max_periods int  not null default 12 check (recurring_max_periods between 1 and 120),

  -- Zweite Stufe
  tier2_enabled         boolean not null default false,
  tier2_basis           text not null default 'commission' check (tier2_basis in ('commission','revenue')),
  tier2_rate_bp         int  not null default 1000 check (tier2_rate_bp between 0 and 10000),

  -- Geld und Fristen
  hold_days             int not null default 30 check (hold_days between 0 and 365),
  reserve_bp            int not null default 1000 check (reserve_bp between 0 and 10000),
  reserve_days          int not null default 60 check (reserve_days between 0 and 365),
  min_payout_cents      int not null default 2500 check (min_payout_cents >= 0),
  payout_schedule       text not null default 'monthly'
                          check (payout_schedule in ('weekly','semi_monthly','monthly')),
  -- Plan G14: beim Erzeugen einer Gutschrift auf `period_to` gesetzt. Danach
  -- weist die Buchungs-RPC (Block B4) jede Zeile ab, die in diesen Zeitraum
  -- datieren wuerde, und bucht sie mit heutigem Datum in die laufende Periode.
  books_closed_until    date,

  -- Texte
  description_md        text not null default '',
  terms_text            text not null default '',
  terms_version         int  not null default 1 check (terms_version >= 1),
  application_note      text not null default '',
  application_fields    jsonb not null default '[]'::jsonb,

  test_mode             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- v1: genau ein Programm je Mandant. Die Spalte program_id existiert trotzdem
  -- ueberall, damit ein zweites Programm spaeter kein Schema-Umbau wird.
  unique (tenant_id),
  unique (id, tenant_id),
  check (max_commission_cents is null or min_commission_cents is null
         or max_commission_cents >= min_commission_cents),
  -- Die Reserve laeuft nie vor der Sperrfrist ab, sonst waere der
  -- Sicherheitseinbehalt frueher auszahlbar als der Hauptbetrag.
  check (reserve_days >= hold_days)
);

create index affiliate_programs_tenant_idx on public.affiliate_programs (tenant_id, status);

-- Guard OHNE `security definer`, weil die Funktion `current_user` sehen muss --
-- unter `security definer` waere das immer der Eigentuemer und die
-- Erlaubnisliste damit wirkungslos (empirisch belegt in 20260909183548:70-75).
-- Die Liste ist eine ERLAUBNISLISTE, keine Sperrliste: eine kuenftige, hier
-- unbekannte Rolle faellt in den geschuetzten Zweig statt still durchzurutschen.
create or replace function public.affiliate_programs_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Identitaetsspalten sind fuer JEDE Rolle fest: eine Programmzeile darf den
  -- Mandanten nie wechseln, auch nicht ueber den Admin-Client.
  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.created_at := old.created_at;

  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  -- books_closed_until ist der Riegel vor abgeschlossenen Abrechnungszeitraeumen
  -- (Plan G14). Wer ihn zuruecksetzen koennte, koennte in einen Zeitraum
  -- nachbuchen, fuer den bereits ein Beleg mit fester Summe existiert.
  new.books_closed_until := old.books_closed_until;
  return new;
end;
$$;

-- BEFORE-Trigger derselben Tabelle laufen alphabetisch; 'g' < 't', der Guard
-- laeuft vor dem Touch (20260807171725:198-203).
create trigger affiliate_programs_guard_trg before update on public.affiliate_programs
  for each row execute function public.affiliate_programs_guard();
create trigger affiliate_programs_touch before update on public.affiliate_programs
  for each row execute function public.set_updated_at();

alter table public.affiliate_programs enable row level security;
-- Neue Tabellen erhalten in diesem Projekt per `alter default privileges` alle
-- Rechte fuer anon und authenticated (live nachgesehen). Erst wegnehmen, dann
-- gezielt zurueckgeben. Kein DELETE: ein Programm mit Buchungshistorie darf
-- nicht verschwinden.
revoke all on public.affiliate_programs from anon, authenticated;
grant select, insert, update on public.affiliate_programs to authenticated;

-- =================================================================
-- 3. affiliate_groups (Plan 3.4) -- vor affiliate_partners, weil
--    affiliate_partners.group_id darauf zeigt.
-- =================================================================
-- Abweichung von der Nummerierung des Plans (3.4 vor 3.3), nicht vom Inhalt:
-- ein Fremdschluessel kann nur auf eine bereits bestehende Tabelle zeigen.
--
-- Die Gruppe traegt selbst KEINEN Satz -- der steht als affiliate_conditions-
-- Zeile mit group_id. Damit gibt es genau einen Ort, an dem Saetze stehen, und
-- die Vorrangkette bleibt eine einzige Sortierung.

create table public.affiliate_groups (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  program_id uuid not null,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, program_id, name),
  unique (id, tenant_id),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade
);

-- Index auf BEIDE Spalten des zusammengesetzten Fremdschluessels, in dessen
-- Spaltenreihenfolge (Advisor "unindexed foreign keys",
-- 20260807142948_shift_calendar_perf_fix.sql:8-15). Der Fremdschluessel auf
-- tenant_id ist ueber `unique (tenant_id, program_id, name)` bereits indiziert.
create index affiliate_groups_program_idx on public.affiliate_groups (program_id, tenant_id);

create or replace function public.affiliate_groups_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Eine Gruppe wechselt nie den Mandanten und nie das Programm: sonst
  -- verschoebe eine Umbenennung stillschweigend die Kondition aller Partner,
  -- die an ihr haengen.
  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.program_id := old.program_id;
  new.created_at := old.created_at;
  return new;
end;
$$;
create trigger affiliate_groups_guard_trg before update on public.affiliate_groups
  for each row execute function public.affiliate_groups_guard();

alter table public.affiliate_groups enable row level security;
revoke all on public.affiliate_groups from anon, authenticated;
grant select, insert, update, delete on public.affiliate_groups to authenticated;

-- =================================================================
-- 4. affiliate_partners (Plan 3.3)
-- =================================================================
-- `user_id` ist nullable, weil eine oeffentliche Bewerbung kein Konto
-- voraussetzen darf -- dasselbe Muster wie memberships.invited_email
-- (0001_init.sql:44-47); bei Freigabe geht eine Einladung mit
-- buildSetPasswordLink() raus (src/lib/users/import.ts:196).
--
-- Partner sind bewusst KEINE memberships-Rolle (Plan G9): eine Rolle
-- 'affiliate' waere exakt der Gast-Fund vom 03.08.2026
-- (20260803100000_marketplace_guest_role.sql) -- rund dreissig Policies pruefen
-- `member_role(tenant_id) is not null` und wuerden dem Partner den kompletten
-- veroeffentlichten Kursbestand oeffnen.

create table public.affiliate_partners (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  program_id    uuid not null,
  user_id       uuid references public.profiles(id) on delete set null,
  -- normalisiert vom Anwendungscode: lower(trim(...)), +suffix entfernt.
  applicant_email text not null,
  display_name  text not null,
  company       text,
  code          text not null check (code ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  status        text not null default 'pending'
                  check (status in ('pending','active','rejected','suspended')),
  status_reason text,
  group_id      uuid,
  referred_by   uuid,                      -- Werber (Tier 2), genau eine Stufe
  payout_hold   boolean not null default false,
  payout_hold_reason text,
  internal_note text,
  application   jsonb not null default '{}'::jsonb,

  terms_version_accepted int,
  terms_accepted_at      timestamptz,
  -- HMAC mit STATISCHEM, domaenenpraefixiertem Salz (Plan 11.6) -- nicht das
  -- tagesrotierende der Klicktabelle, sonst waere der Zustimmungsnachweis nach
  -- einem Tag nicht mehr verifizierbar.
  terms_accepted_ip_hash text,

  notify_sale     boolean not null default true,
  notify_reversal boolean not null default true,
  notify_payout   boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Je Mandant eindeutig, NICHT global: der Aufloesungspfad im Klick-Endpunkt
  -- ist immer `where tenant_id = <aus Host> and code = <aus Link>`. Ein globaler
  -- Namensraum waere gleichzeitig ein Datenleck (Codes eines Mandanten in einem
  -- anderen aufloesbar) und ein Attributionsfehler.
  unique (tenant_id, code),
  unique (tenant_id, program_id, applicant_email),
  unique (id, tenant_id),
  check (referred_by is null or referred_by <> id),
  foreign key (program_id, tenant_id)  references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (group_id, tenant_id)    references public.affiliate_groups   (id, tenant_id) on delete set null,
  foreign key (referred_by, tenant_id) references public.affiliate_partners (id, tenant_id) on delete set null
);

-- Ein Nutzerkonto ist je Mandant hoechstens einmal Partner. Partiell, weil
-- user_id bis zur Freigabe leer bleibt.
create unique index affiliate_partners_user_uniq
  on public.affiliate_partners (tenant_id, user_id) where user_id is not null;
create index affiliate_partners_program_idx  on public.affiliate_partners (program_id, tenant_id, status);
create index affiliate_partners_group_idx    on public.affiliate_partners (group_id, tenant_id);
create index affiliate_partners_referred_idx on public.affiliate_partners (referred_by, tenant_id);
-- Fremdschluessel user_id -> profiles(id). Partiell, weil nur freigegebene
-- Partner ueberhaupt einen Wert tragen; fuer NULL prueft der Fremdschluessel
-- nichts nach.
create index affiliate_partners_user_idx     on public.affiliate_partners (user_id) where user_id is not null;

-- Guard-Trigger, weil eine `with check`-Bedingung nur die NEUE Zeile sieht und
-- damit kein Spaltendelta ausdruecken kann (20260807142619:518-521).
-- OHNE `security definer`: die Erlaubnisliste unten braucht `current_user`, und
-- unter `security definer` waere das immer der Funktionseigentuemer -- jeder
-- Aufrufer liefe dann in den privilegierten Zweig und der Guard waere leer.
-- Folge davon: die `exists`-Abfrage auf affiliate_commissions laeuft mit den
-- Rechten des Aufrufers. Das ist vertretbar, weil sie nur im Manager-Zweig
-- ausgewertet wird und der Manager die Provisionszeilen seines Mandanten
-- ohnehin lesen darf.
create or replace function public.affiliate_partners_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Identitaetsspalten sind fuer JEDE Rolle fest.
  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.created_at := old.created_at;

  -- ERLAUBNISLISTE, keine Sperrliste (Korrektur am K2-Trigger,
  -- 20260909183548:77-90): Migrationen, Dashboard und der Admin-Client duerfen
  -- die Bewerbung freigeben, ein Konto verknuepfen und den Status setzen. Auf
  -- diesem Weg arbeiten die Server Actions dieses Moduls; ohne den Zweig waere
  -- die Freigabe einer Bewerbung ueberhaupt nicht moeglich, weil
  -- affiliate_is_manager() fuer service_role false liefert (auth.uid() ist dort
  -- null).
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  -- IMMER old.tenant_id pruefen, nie new.tenant_id: die new-Pruefung war der
  -- echte Cross-Tenant-Weg in 20260807173156:1-31 (wer in Mandant B Admin ist,
  -- schickte tenant_id=B mit, und der Spaltenschutz entfiel komplett). Hier ist
  -- new.tenant_id bereits auf old zurueckgesetzt; die Pruefung nennt
  -- old.tenant_id trotzdem ausdruecklich, damit eine spaetere Umstellung der
  -- Zeilen darueber nicht still kippt.
  if public.affiliate_is_manager(old.tenant_id) then
    -- Plan G15: ein Programm-Manager entscheidet nicht ueber Vorgaenge, in denen
    -- er selbst Partner ist. Ohne diese Sperre ist die Selbst-Empfehlungssperre
    -- wirkungslos, weil derselbe Mensch ueber den Verdachtsfall entscheidet.
    -- Neben `status` ist auch `payout_hold` erfasst: eine Auszahlungssperre an
    -- der eigenen Zeile zu loesen ist dieselbe Entscheidung ueber eigenes Geld.
    if old.user_id = auth.uid()
       and (new.status is distinct from old.status
            or new.payout_hold is distinct from old.payout_hold) then
      raise exception 'affiliate_self_approval_forbidden';
    end if;

    new.program_id      := old.program_id;
    -- Ein Konto wird ausschliesslich vom Server (service_role) verknuepft, nie
    -- vom Manager: sonst haengte er eine fremde Partnerzeile an sein eigenes
    -- Konto und lieste damit deren Abrechnungsdaten.
    new.user_id         := old.user_id;
    new.applicant_email := old.applicant_email;

    -- Der Code ist Teil der Attributionshistorie und nach der ersten Buchung
    -- fix. affiliate_commissions entsteht erst mit Block B4 (Plan 3.11); bis
    -- dahin gibt es keine Buchung, die eine Codeaenderung brechen koennte. Die
    -- to_regclass-Pruefung haelt den Trigger bis dahin lauffaehig -- plpgsql
    -- loest Tabellennamen erst beim Ausfuehren der jeweiligen Anweisung auf,
    -- der nicht betretene Zweig kostet also nichts.
    if to_regclass('public.affiliate_commissions') is not null then
      if exists (select 1 from public.affiliate_commissions c
                 where c.tenant_id = old.tenant_id and c.partner_id = old.id) then
        new.code := old.code;
      end if;
    end if;
    return new;
  end if;

  -- Selbstpflege durch den Partner: NEW bleibt nur fuer display_name, company,
  -- die drei notify_*-Schalter und die Zustimmungsfelder stehen.
  new.program_id         := old.program_id;
  new.user_id            := old.user_id;
  new.applicant_email    := old.applicant_email;
  new.code               := old.code;
  new.status             := old.status;
  new.status_reason      := old.status_reason;
  new.group_id           := old.group_id;
  new.referred_by        := old.referred_by;
  new.payout_hold        := old.payout_hold;
  new.payout_hold_reason := old.payout_hold_reason;
  new.internal_note      := old.internal_note;
  new.application        := old.application;

  -- Zustimmung ist einseitig: setzbar, nie zuruecksetzbar. Ein Partner, der
  -- seine einmal erteilte Zustimmung auf eine aeltere Fassung zuruecksetzen
  -- koennte, entwertete den Nachweis nach Art. 7 Abs. 1 DSGVO.
  if old.terms_accepted_at is not null
     and coalesce(new.terms_version_accepted, 0) < coalesce(old.terms_version_accepted, 0) then
    new.terms_version_accepted := old.terms_version_accepted;
    new.terms_accepted_at      := old.terms_accepted_at;
    new.terms_accepted_ip_hash := old.terms_accepted_ip_hash;
  end if;
  return new;
end;
$$;

create trigger affiliate_partners_guard_trg before update on public.affiliate_partners
  for each row execute function public.affiliate_partners_guard();
create trigger affiliate_partners_touch before update on public.affiliate_partners
  for each row execute function public.set_updated_at();

alter table public.affiliate_partners enable row level security;
revoke all on public.affiliate_partners from anon, authenticated;

-- Zweite Ebene neben RLS: Spaltenrechte, weil RLS keine Spalten trennt (Muster
-- 20260909183548:31-46). Was hier fehlt, ist fuer `authenticated` gar nicht
-- lesbar bzw. schreibbar -- unabhaengig von jeder Policy.
--   Nicht lesbar: applicant_email, status_reason, internal_note, application,
--   terms_accepted_ip_hash. Die Admin-Oberflaeche laedt diese Spalten ueber eine
--   Server-Route mit requireAdminTenant() und createAdminClient().
grant select (id, tenant_id, program_id, user_id, display_name, company, code, status,
              group_id, referred_by, payout_hold, payout_hold_reason,
              terms_version_accepted, terms_accepted_at,
              notify_sale, notify_reversal, notify_payout, created_at, updated_at)
  on public.affiliate_partners to authenticated;
--   Nicht schreibbar: code, user_id, tenant_id, program_id, applicant_email.
--   Die Rollentrennung INNERHALB der erlaubten Spalten leistet der Guard oben --
--   Spaltenrechte sind nicht rollenabhaengig und koennen das nicht.
grant update (display_name, company, notify_sale, notify_reversal, notify_payout,
              terms_version_accepted, terms_accepted_at, terms_accepted_ip_hash,
              status, status_reason, group_id, referred_by,
              payout_hold, payout_hold_reason, internal_note)
  on public.affiliate_partners to authenticated;
-- INSERT und DELETE als Tabellenrecht; die Einschraenkung leisten die Policies
-- in Abschnitt 9. Ohne diese beiden Zeilen waeren die Manager-Policies
-- wirkungslos -- `revoke all` hat auch INSERT und DELETE entfernt.
grant insert on public.affiliate_partners to authenticated;
grant delete on public.affiliate_partners to authenticated;

-- =================================================================
-- 5. affiliate_conditions (Plan 3.5) -- die Vorrangkette der Saetze
-- =================================================================

create table public.affiliate_conditions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  program_id  uuid not null,
  partner_id  uuid,                        -- null = alle Partner
  group_id    uuid,                        -- null = alle Gruppen
  product_id  uuid,                        -- null = alle Produkte
  rate_kind   text not null default 'percent' check (rate_kind in ('percent','fixed')),
  rate_bp     int  not null default 0 check (rate_bp between 0 and 10000),
  fixed_cents int  not null default 0 check (fixed_cents >= 0),
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Die Rangfolge ist eine generierte Spalte und damit nicht durch einen
  -- Tippfehler kippbar. Partner schlaegt Gruppe schlaegt Produkt; die Summe
  -- macht die Kette zu genau einer Sortierung.
  specificity int generated always as (
      (case when partner_id is not null then 20 else 0 end)
    + (case when group_id   is not null then 10 else 0 end)
    + (case when product_id is not null then  5 else 0 end)
  ) stored,
  check (valid_to is null or valid_to > valid_from),
  -- Partner ODER Gruppe, nie beides: sonst waere die Rangfolge zweideutig.
  check (num_nonnulls(partner_id, group_id) <= 1),
  -- Mindestens ein Geltungsbereich: eine Zeile ohne jeden Bezug waere eine
  -- zweite Standardkondition neben affiliate_programs.
  check (num_nonnulls(partner_id, group_id, product_id) >= 1),
  unique (id, tenant_id),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade,
  foreign key (group_id, tenant_id)   references public.affiliate_groups   (id, tenant_id) on delete cascade,
  foreign key (product_id, tenant_id) references public.products           (id, tenant_id) on delete cascade
);

-- Der Aufloesungsindex der Vorrangkette: ein Treffer je Bestellung, sortiert
-- ohne Nachsortierung im Speicher.
create index affiliate_conditions_lookup_idx
  on public.affiliate_conditions (tenant_id, program_id, specificity desc, valid_from desc);
-- Je ein Index auf BEIDE Spalten jedes zusammengesetzten Fremdschluessels, in
-- dessen Spaltenreihenfolge. affiliate_conditions_lookup_idx zaehlt fuer
-- (program_id, tenant_id) NICHT: er beginnt mit tenant_id, der Fremdschluessel
-- aber mit program_id.
create index affiliate_conditions_program_idx on public.affiliate_conditions (program_id, tenant_id);
create index affiliate_conditions_partner_idx on public.affiliate_conditions (partner_id, tenant_id);
create index affiliate_conditions_group_idx   on public.affiliate_conditions (group_id, tenant_id);
create index affiliate_conditions_product_idx on public.affiliate_conditions (product_id, tenant_id);

-- Ueberschneidungsfreiheit je Geltungsbereich: zwei gleichzeitig gueltige
-- Saetze fuer denselben Partner und dasselbe Produkt waeren ein Wuerfelwurf
-- ueber den Provisionsbetrag. `coalesce` auf die Nulluuid, weil NULL mit `=` in
-- einem EXCLUDE-Constraint nie kollidiert und der Fall "alle Partner" sonst
-- ungeschuetzt bliebe.
-- btree_gist liefert die "="-Opklasse fuer uuid und ist bereits installiert
-- (20260807142619:63, live gegengeprueft) -- die Extension wird NICHT
-- verschoben und nicht neu angelegt, sie hat Abhaengige.
alter table public.affiliate_conditions add constraint affiliate_conditions_no_overlap
  exclude using gist (
    tenant_id  with =,
    program_id with =,
    (coalesce(partner_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(group_id,   '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    tstzrange(valid_from, valid_to) with &&
  );

-- Eine Kategorie-Stufe ist bewusst NICHT vorgesehen: course_categories haengt
-- an courses (20260722180000:47), ein Produkt traegt course_ids[]
-- (0001_init.sql:238) -- es gibt also keine eine Kategorie je Bestellung. Ein
-- solcher Spezifitaetsrang waere eine Spalte, die nie gefuellt wird.

-- Guard OHNE `security definer`: die Funktion braucht keine erhoehten Rechte,
-- `affiliate_partner_id()` ist selbst security definer und wird zur Laufzeit
-- aufgeloest (plpgsql), darf hier also vor ihrer eigenen Definition stehen.
create or replace function public.affiliate_conditions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    new.id         := old.id;
    new.tenant_id  := old.tenant_id;
    new.program_id := old.program_id;
    new.created_at := old.created_at;
  end if;

  -- Plan G15: niemand setzt sich selbst einen Satz. Geprueft wird die Person,
  -- nicht die Rolle -- affiliate_partner_id() liefert fuer service_role null
  -- (auth.uid() ist dort null), der Server-Pfad laeuft also unberuehrt durch.
  if new.partner_id is not null
     and new.partner_id = public.affiliate_partner_id(new.tenant_id) then
    raise exception 'affiliate_self_condition_forbidden';
  end if;
  return new;
end;
$$;
create trigger affiliate_conditions_guard_trg before insert or update on public.affiliate_conditions
  for each row execute function public.affiliate_conditions_guard();
create trigger affiliate_conditions_touch before update on public.affiliate_conditions
  for each row execute function public.set_updated_at();

alter table public.affiliate_conditions enable row level security;
revoke all on public.affiliate_conditions from anon, authenticated;
grant select, insert, update, delete on public.affiliate_conditions to authenticated;

-- =================================================================
-- 6. affiliate_billing_profiles (Plan 3.13)
-- =================================================================
-- Anschrift, Steuerstatus und Zahlungsverbindung -- getrennt von den Stammdaten,
-- damit keine Partnerliste und kein Export sie versehentlich mitselektiert.

create table public.affiliate_billing_profiles (
  partner_id     uuid primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  entity_kind    text check (entity_kind in ('business','private')),
  legal_name     text,
  street         text,
  postal_code    text,
  city           text,
  country        text check (country is null or country ~ '^[A-Z]{2}$'),
  small_business boolean not null default false,     -- § 19 UStG
  vat_id         text,
  tax_number     text,
  vat_checked_at   timestamptz,
  vat_check_result text check (vat_check_result in ('valid','invalid','unchecked')),
  vat_check_log    jsonb not null default '{}'::jsonb,
  payout_method  text check (payout_method in ('sepa','paypal','manual')),
  account_holder text,
  iban           text,
  bic            text,
  paypal_email   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (partner_id, tenant_id),
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade
);
-- Fremdschluessel tenant_id -> tenants(id). Der zusammengesetzte
-- Fremdschluessel (partner_id, tenant_id) ist ueber `unique (partner_id,
-- tenant_id)` bereits indiziert, partner_id zusaetzlich ueber den Primaerschluessel.
create index affiliate_billing_profiles_tenant_idx on public.affiliate_billing_profiles (tenant_id);

-- Die drei vat_check_*-Felder brauchen einen Guard, KEINEN Spalten-Grant:
-- Spaltenrechte sind nicht rollenabhaengig, und da der Partner auf derselben
-- Tabelle UPDATE braucht, koennte er sonst seinen eigenen USt-IdNr.-Pruefstatus
-- auf 'valid' setzen und damit Reverse Charge und die Auszahlungsfreigabe selbst
-- erzeugen -- ein direkter Steuer- und Geldfluss-Bypass.
-- OHNE `security definer`, weil die Funktion `current_user` sehen muss (dieselbe
-- Begruendung wie in Abschnitt 0 (d)); sie liest keine andere Tabelle und
-- braucht keine erhoehten Rechte.
create or replace function public.affiliate_billing_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Fuer JEDE Rolle fest: das Profil wechselt nie den Partner und nie den
  -- Mandanten.
  new.partner_id := old.partner_id;
  new.tenant_id  := old.tenant_id;
  new.created_at := old.created_at;

  -- ERLAUBNISLISTE: nur diese drei Rollen schreiben das Ergebnis der
  -- VIES-Pruefung. Wer nicht genannt ist, faellt in den geschuetzten Zweig.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  new.vat_checked_at   := old.vat_checked_at;
  new.vat_check_result := old.vat_check_result;
  new.vat_check_log    := old.vat_check_log;

  -- Jede Aenderung der USt-IdNr. setzt den Pruefstatus zurueck. Die
  -- Zuruecksetzung steht ausdruecklich NUR in diesem Zweig: der Serverlauf
  -- schreibt neue Nummer und neues Pruefergebnis in einer Anweisung und darf
  -- sich nicht selbst ueberschreiben. Den zugehoerigen Audit-Eintrag schreibt
  -- die Server Action (Plan 3.16) -- dasselbe gilt fuer Aenderungen an IBAN und
  -- PayPal-Adresse.
  if new.vat_id is distinct from old.vat_id then
    new.vat_check_result := 'unchecked';
    new.vat_checked_at   := null;
  end if;
  return new;
end;
$$;
create trigger affiliate_billing_profiles_guard_trg before update on public.affiliate_billing_profiles
  for each row execute function public.affiliate_billing_guard();
create trigger affiliate_billing_profiles_touch before update on public.affiliate_billing_profiles
  for each row execute function public.set_updated_at();

alter table public.affiliate_billing_profiles enable row level security;
revoke all on public.affiliate_billing_profiles from anon, authenticated;
-- Kein DELETE: das Profil gehoert zum Beleg und ist zehn Jahre
-- aufbewahrungspflichtig; die DSGVO-Loeschung laeuft ueber Anonymisierung
-- (Plan 7.8).
grant select, insert, update on public.affiliate_billing_profiles to authenticated;

-- =================================================================
-- 7. affiliate_audit_log (Plan 3.16)
-- =================================================================
-- Ein Pruefpfad, der aenderbar ist, ist keiner -- und er ist nicht nachruestbar.

create table public.affiliate_audit_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_kind    text not null check (actor_kind in ('manager','partner','system')),
  entity        text not null check (entity in
                  ('program','partner','condition','group','commission','payout','profile',
                   'referral','creative')),
  entity_id     uuid,
  action        text not null,
  -- before/after werden VOR dem Schreiben redigiert: IBAN, paypal_email,
  -- tax_number, vat_id und terms_accepted_ip_hash erscheinen nur als "***" mit
  -- Aenderungsmarker, nie im Klartext (Plan 11.11, src/lib/affiliate/audit.ts).
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);

create index affiliate_audit_log_entity_idx
  on public.affiliate_audit_log (tenant_id, entity, entity_id, created_at desc);
-- Fremdschluessel actor_user_id -> profiles(id) (Advisor "unindexed foreign
-- keys"); der Index traegt zugleich die Auskunft nach Art. 15 DSGVO.
create index affiliate_audit_log_actor_idx on public.affiliate_audit_log (actor_user_id);

-- Unveraenderlich auch gegenueber dem Admin-Client. Die ERLAUBNISLISTE laesst
-- nur Migrationen und Dashboard-Eingriffe durch ('postgres'/'supabase_admin'),
-- damit die Anonymisierung nach Plan 7.8 als bewusster, protokollierter
-- Eingriff moeglich bleibt -- 'service_role', also der normale Serverbetrieb,
-- steht hier bewusst NICHT. OHNE `security definer` (braucht current_user).
create or replace function public.affiliate_audit_log_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'affiliate_audit_log_immutable';
end;
$$;
create trigger affiliate_audit_log_guard_trg before update or delete on public.affiliate_audit_log
  for each row execute function public.affiliate_audit_log_guard();

alter table public.affiliate_audit_log enable row level security;
revoke all on public.affiliate_audit_log from anon, authenticated;
-- Nur SELECT: geschrieben wird ausschliesslich ueber den Admin-Client
-- (service_role umgeht RLS), es gibt bewusst keine INSERT-, UPDATE- oder
-- DELETE-Policy fuer Clients. Der tatsaechliche Schutz ist dieses fehlende
-- Recht, nicht die Policy-Liste.
grant select on public.affiliate_audit_log to authenticated;

-- =================================================================
-- 8. Hilfsfunktionen mit Tabellenbezug (Plan 3.1, Teil 2)
-- =================================================================
-- Erst hier, weil `language sql`-Rumpfe bei `check_function_bodies = on` schon
-- beim Anlegen gegen public.affiliate_partners aufgeloest werden (siehe
-- Reihenfolge-Absatz im Kopf).

-- Partner-Identitaet des eingeloggten Nutzers. Ein Partner hat in der Regel
-- KEINE memberships-Zeile (Plan G9) -- `member_role()` liefert fuer ihn null.
create or replace function public.affiliate_partner_id(t uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id from public.affiliate_partners p
  where p.tenant_id = t and p.user_id = auth.uid() and p.status = 'active'
  limit 1;
$$;

-- Tier-2-Sicht: die IDs der vom aufrufenden Partner geworbenen Partner.
-- BEWUSST eine Funktion statt eines "or referred_by = affiliate_partner_id(...)"-
-- Zweigs in der SELECT-Policy: RLS trennt keine Spalten, ein solcher Zweig gaebe
-- dem Werber per PostgREST die VOLLEN Zeilen seiner Geworbenen (application,
-- internal_note, terms_accepted_ip_hash). Die Partner-Ansicht laedt diese Daten
-- ueber eine Server-Route mit ausdruecklicher Spaltenliste.
create or replace function public.affiliate_downline_ids(t uuid)
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id from public.affiliate_partners p
  where p.tenant_id = t and p.referred_by = public.affiliate_partner_id(t);
$$;

-- `anon` bekommt bewusst nichts: die oeffentliche Programmseite liest ueber
-- createAdminClient() mit ausdruecklicher Spaltenliste (Plan 3.2), nicht ueber
-- eine anon-Policy. Zum doppelten `revoke` siehe Abschnitt 1.
revoke execute on function public.affiliate_partner_id(uuid)   from public;
revoke execute on function public.affiliate_partner_id(uuid)   from anon;
grant  execute on function public.affiliate_partner_id(uuid)   to authenticated, service_role;

revoke execute on function public.affiliate_downline_ids(uuid) from public;
revoke execute on function public.affiliate_downline_ids(uuid) from anon;
grant  execute on function public.affiliate_downline_ids(uuid) to authenticated, service_role;

-- =================================================================
-- 9. Policies (je Tabelle genau eine SELECT-Policy, G17)
-- =================================================================
-- `(select auth.uid())` gekapselt (Advisor auth_rls_initplan,
-- 20260712233000:4-10) -- ohne die Klammerung wertet Postgres den Ausdruck je
-- Zeile aus. Die Security-Definer-Helfer bleiben ungekapselt, sie sind `stable`.

-- --- affiliate_programs -----------------------------------------
-- Der Partner liest die Programmzeile vollstaendig; das ist bewusst in Kauf
-- genommen, weil RLS keine Spalten trennt und die Konditionen des Programms
-- ohnehin Vertragsinhalt des Partners sind. Die OEFFENTLICHE Programmseite
-- liest hierueber NICHT, sondern per createAdminClient() mit ausdruecklicher
-- Spaltenliste (Muster src/lib/marketplace/catalog.ts); terms_text und
-- books_closed_until gehoeren nicht in diese Liste.
create policy affiliate_programs_select on public.affiliate_programs for select using (
  public.affiliate_is_manager(tenant_id)
  or public.affiliate_partner_id(tenant_id) is not null
);
create policy affiliate_programs_manager_insert on public.affiliate_programs for insert
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_programs_manager_update on public.affiliate_programs for update
  using (public.affiliate_is_manager(tenant_id))
  with check (public.affiliate_is_manager(tenant_id));

-- --- affiliate_groups -------------------------------------------
-- Der Partner darf den Namen seiner Gruppe sehen (er steht in seiner
-- Konditionsuebersicht), schreiben darf nur der Manager.
create policy affiliate_groups_select on public.affiliate_groups for select using (
  public.affiliate_is_manager(tenant_id)
  or public.affiliate_partner_id(tenant_id) is not null
);
create policy affiliate_groups_manager_insert on public.affiliate_groups for insert
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_groups_manager_update on public.affiliate_groups for update
  using (public.affiliate_is_manager(tenant_id))
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_groups_manager_delete on public.affiliate_groups for delete
  using (public.affiliate_is_manager(tenant_id));

-- --- affiliate_partners -----------------------------------------
-- Der Werber-Zweig steht bewusst NICHT in dieser Policy, siehe
-- affiliate_downline_ids() in Abschnitt 8.
create policy affiliate_partners_select on public.affiliate_partners for select using (
  public.affiliate_is_manager(tenant_id) or user_id = (select auth.uid())
);
create policy affiliate_partners_manager_insert on public.affiliate_partners for insert
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_partners_update on public.affiliate_partners for update
  using (public.affiliate_is_manager(tenant_id) or user_id = (select auth.uid()))
  with check (public.affiliate_is_manager(tenant_id) or user_id = (select auth.uid()));
-- DELETE nur aus unkritischen Status, Vorbild ml_staff_delete
-- (20260804090000:27-31): ein Partner mit Buchungshistorie darf nie geloescht
-- werden, sonst reisst der Pruefpfad. Fuer die DSGVO gibt es Anonymisierung
-- (Plan 7.8), nicht Loeschung.
create policy affiliate_partners_manager_delete on public.affiliate_partners for delete
  using (public.affiliate_is_manager(tenant_id) and status in ('pending','rejected'));

-- --- affiliate_conditions ---------------------------------------
-- Der Partner darf sehen, welcher Satz fuer ihn gilt: seine eigene Zeile und
-- die Zeilen ohne Partnerbezug. Fremde Sonderkonditionen sieht er nicht.
create policy affiliate_conditions_select on public.affiliate_conditions for select using (
  public.affiliate_is_manager(tenant_id)
  or partner_id is null
  or partner_id = public.affiliate_partner_id(tenant_id)
);
create policy affiliate_conditions_manager_insert on public.affiliate_conditions for insert
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_conditions_manager_update on public.affiliate_conditions for update
  using (public.affiliate_is_manager(tenant_id))
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_conditions_manager_delete on public.affiliate_conditions for delete
  using (public.affiliate_is_manager(tenant_id));

-- --- affiliate_billing_profiles ---------------------------------
-- Enger als bei den Stammdaten: der Manager (owner/admin) darf LESEN -- er
-- braucht Anschrift und Steuerstatus fuer den Beleg --, aendern darf
-- ausschliesslich der Partner selbst. Bankdaten durch den Haendler aendern zu
-- lassen waere der klassische Weg, Auszahlungen umzuleiten, sobald ein
-- Haendler-Konto uebernommen wurde.
create policy affiliate_billing_select on public.affiliate_billing_profiles for select using (
  public.affiliate_is_manager(tenant_id)
  or partner_id = public.affiliate_partner_id(tenant_id)
);
create policy affiliate_billing_self_insert on public.affiliate_billing_profiles for insert
  with check (partner_id = public.affiliate_partner_id(tenant_id));
create policy affiliate_billing_self_update on public.affiliate_billing_profiles for update
  using (partner_id = public.affiliate_partner_id(tenant_id))
  with check (partner_id = public.affiliate_partner_id(tenant_id));

-- --- affiliate_audit_log ----------------------------------------
-- Der Partner sieht die Eintraege zu seiner eigenen Partnerzeile -- Transparenz
-- ueber Statuswechsel, Sperren und Konditionsaenderungen, die ihn betreffen.
create policy affiliate_audit_log_select on public.affiliate_audit_log for select using (
  public.affiliate_is_manager(tenant_id)
  or entity_id = public.affiliate_partner_id(tenant_id)
);

-- =================================================================
-- 10. Ausfuehrungsrechte der Guard-Funktionen
-- =================================================================
-- Beim Feuern eines Triggers prueft Postgres kein EXECUTE-Recht (das geschieht
-- beim `create trigger`); der `grant` an authenticated ist also die sichere
-- Seite. Entscheidend ist, dass `anon` ausdruecklich entfernt wird -- `revoke
-- from public` allein liesse den eigenen anon-Grant stehen (Fund vom
-- 07.09.2026). Nach jedem kuenftigen `create or replace` erneut setzen.
revoke execute on function public.affiliate_programs_guard()  from public;
revoke execute on function public.affiliate_programs_guard()  from anon;
grant  execute on function public.affiliate_programs_guard()  to authenticated, service_role;

revoke execute on function public.affiliate_groups_guard()    from public;
revoke execute on function public.affiliate_groups_guard()    from anon;
grant  execute on function public.affiliate_groups_guard()    to authenticated, service_role;

revoke execute on function public.affiliate_partners_guard()  from public;
revoke execute on function public.affiliate_partners_guard()  from anon;
grant  execute on function public.affiliate_partners_guard()  to authenticated, service_role;

revoke execute on function public.affiliate_conditions_guard() from public;
revoke execute on function public.affiliate_conditions_guard() from anon;
grant  execute on function public.affiliate_conditions_guard() to authenticated, service_role;

revoke execute on function public.affiliate_billing_guard()   from public;
revoke execute on function public.affiliate_billing_guard()   from anon;
grant  execute on function public.affiliate_billing_guard()   to authenticated, service_role;

revoke execute on function public.affiliate_audit_log_guard() from public;
revoke execute on function public.affiliate_audit_log_guard() from anon;
grant  execute on function public.affiliate_audit_log_guard() to authenticated, service_role;
