-- "Meine Kunden Area" (Josips Auftrag, 05.08.2026 — Umsetzungsplan
-- verwende-den-planungs-agenten-sequential-frost.md). Neue Unterseite in der
-- Lernansicht: der Mandant (Kunden-Admin) stellt seinen Nutzern individuelle
-- Links (Drive-Ordner, WhatsApp-/Facebook-Gruppen etc.), Ansprechpartner
-- (Foto, Name, Rolle, Telefon, E-Mail) und Ankündigungen/Angebote bereit.
--
-- Architekturentscheidung (Plan Abschnitt 0.1): EINE Inhaltstabelle
-- `customer_area_items` mit Diskriminator `kind` statt drei separate
-- Tabellen oder einer polymorphen Zuordnung — Postgres kann eine polymorphe
-- Spalte nicht als Fremdschlüssel absichern (kein `on delete cascade`, keine
-- referenzielle Integrität, verwaiste Sichtbarkeitszeilen). Mit einer
-- Inhaltstabelle bleibt die Zuordnungstabelle ein gewöhnlicher FK.
--
-- Personalisierung (Plan Abschnitt 0, bindende Nutzerentscheidung 1): frei
-- pro Nutzer/Gruppe, nicht nur mandantenweit/rollenbasiert. Der
-- Mandanten-Admin definiert eigene Gruppen (`customer_area_groups`) und
-- weist Inhalte gezielt einzelnen Personen oder Gruppen zu
-- (`customer_area_item_audience`).
--
-- Variante-A-Entscheidung (Plan Abschnitt 0, vierte Entscheidung, Risiko
-- 8.1): Ansprechpartner-Kontaktdaten (Telefon/E-Mail) bleiben für ALLE
-- Tenant-Mitglieder lesbar — `trainers_member_select`
-- (20260724130000_course_information.sql) bleibt UNVERÄNDERT. Die
-- Gruppen-Einschränkung wirkt bei Kontakten nur auf Anzeige-Ebene
-- (customer_area_items.visibility), nicht in der Datenbank auf trainers
-- selbst. Begründung: dienstliche Kontaktdaten, kein Geheimnis; vermeidet
-- Regressionsrisiko an Kurs-Editor/Autorenauswahl/Marketplace-Gast-Pfad
-- (trainers_guest_select, 20260803100000_marketplace_guest_role.sql).

-- -------------------------------------------------------------
-- 1.1 Trainer-Erweiterung
-- -------------------------------------------------------------
alter table public.trainers add column phone text;
alter table public.trainers add column email text;

-- -------------------------------------------------------------
-- 1.2 Gruppen
-- -------------------------------------------------------------
create table public.customer_area_groups (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (id, tenant_id)
);
create index customer_area_groups_tenant_idx on public.customer_area_groups (tenant_id);

-- `user_id -> profiles(id)`: nur Nutzer mit angelegtem Profil zuweisbar;
-- eingeladene Mitgliedschaften ohne `user_id` erst nach Annahme zuweisbar
-- (siehe PHASENSTATUS.md).
create table public.customer_area_group_members (
  group_id   uuid not null references public.customer_area_groups(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id),
  -- Zusammengesetzter FK verhindert, dass eine Zeile auf eine Gruppe eines
  -- fremden Mandanten zeigt.
  foreign key (group_id, tenant_id)
    references public.customer_area_groups(id, tenant_id) on delete cascade
);
create index customer_area_group_members_user_idx   on public.customer_area_group_members (user_id);
create index customer_area_group_members_tenant_idx on public.customer_area_group_members (tenant_id);

-- -------------------------------------------------------------
-- 1.3 Inhalte
-- -------------------------------------------------------------
-- `url`-Prüfung: zod in der Server Action ist die erste Linie (weist
-- `javascript:`-URLs ab, Vorbild `sidebarLinkSchema`), der CHECK unten die
-- zweite. `icon`: feste Werteliste statt Freitext/Upload — kein SVG, keine
-- XSS-Fläche (gleiche Begründung wie asset-upload-schema.ts).
create table public.customer_area_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        text not null check (kind in ('link','contact','announcement')),
  title       text,
  description text,
  url         text,
  image_url   text,        -- Supabase Storage (course-assets), nur announcement
  icon        text,        -- feste Auswahl, nur link
  item_date   date,        -- Anzeigedatum, nur announcement
  trainer_id  uuid references public.trainers(id) on delete cascade,
  visibility  text not null default 'all' check (visibility in ('all','restricted')),
  position    int  not null default 0,
  created_at  timestamptz not null default now(),

  constraint customer_area_items_kind_shape check (
       (kind = 'link'         and title is not null and url is not null and trainer_id is null)
    or (kind = 'contact'      and trainer_id is not null and title is null)
    or (kind = 'announcement' and title is not null and trainer_id is null)
  ),
  constraint customer_area_items_url_scheme check (
    url is null or url ~ '^https?://' or url ~ '^/'
  ),
  constraint customer_area_items_icon_allowed check (
    icon is null or icon in ('link','folder','video','message-circle','users',
                             'calendar','file-text','globe','mail','phone')
  )
);
-- Pflicht-FK-Index (Vorbild-Migration
-- 20260712233000_perf_advisors_fk_indexes_rls_initplan.sql existiert genau
-- wegen fehlender FK-Indizes).
create index customer_area_items_tenant_kind_idx on public.customer_area_items (tenant_id, kind, position);
create index customer_area_items_trainer_idx     on public.customer_area_items (trainer_id);

-- -------------------------------------------------------------
-- 1.4 Sichtbarkeits-Zuordnung
-- -------------------------------------------------------------
-- Eine Zeile bindet ein Item entweder an eine Gruppe oder an eine Person
-- (ODER-Semantik, nie an beides — `num_nonnulls`-Check).
create table public.customer_area_item_audience (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id   uuid not null references public.customer_area_items(id) on delete cascade,
  group_id  uuid references public.customer_area_groups(id) on delete cascade,
  user_id   uuid references public.profiles(id) on delete cascade,
  check (num_nonnulls(group_id, user_id) = 1)
);
create index customer_area_audience_item_idx on public.customer_area_item_audience (item_id);
create unique index customer_area_audience_group_uidx
  on public.customer_area_item_audience (item_id, group_id) where group_id is not null;
create unique index customer_area_audience_user_uidx
  on public.customer_area_item_audience (item_id, user_id) where user_id is not null;

-- -------------------------------------------------------------
-- 1.5 Hilfsfunktion (security definer) — notwendig, weil sonst die
-- SELECT-Policy von customer_area_items die RLS der referenzierten
-- Tabellen mitzieht und genau die Zeilen versteckt, die sie auswerten will.
-- Gleiches Muster wie member_role()/is_staff()/has_enrollment()/
-- is_marketplace_guest() (20260803100000_marketplace_guest_role.sql).
-- -------------------------------------------------------------
create or replace function public.customer_area_can_see(item uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.customer_area_item_audience a
    where a.item_id = item
      and ( a.user_id = auth.uid()
            or exists (
              select 1 from public.customer_area_group_members gm
              where gm.group_id = a.group_id and gm.user_id = auth.uid()
            ) )
  );
$$;

revoke execute on function public.customer_area_can_see(uuid) from public;
grant  execute on function public.customer_area_can_see(uuid) to anon, authenticated, service_role;

-- -------------------------------------------------------------
-- 1.6 RLS
-- -------------------------------------------------------------
alter table public.customer_area_groups        enable row level security;
alter table public.customer_area_group_members enable row level security;
alter table public.customer_area_items         enable row level security;
alter table public.customer_area_item_audience enable row level security;

-- Gruppen, Mitgliedschaften, Zuordnungen: ausschliesslich owner/admin lesbar
-- und schreibbar. Bewusst KEINE Leseberechtigung für gewöhnliche Mitglieder —
-- ein Mitarbeiter soll nicht auslesen können, dass es z. B. eine Gruppe
-- "Geschäftsführung" gibt. Die Lernansicht braucht diese Tabellen nicht, die
-- Filterung passiert vollständig in der SELECT-Policy von
-- customer_area_items unten.
create policy customer_area_groups_admin_all on public.customer_area_groups
  for all using (public.member_role(tenant_id) in ('owner','admin'))
  with check (public.member_role(tenant_id) in ('owner','admin'));

create policy customer_area_group_members_admin_all on public.customer_area_group_members
  for all using (public.member_role(tenant_id) in ('owner','admin'))
  with check (public.member_role(tenant_id) in ('owner','admin'));

create policy customer_area_audience_admin_all on public.customer_area_item_audience
  for all using (public.member_role(tenant_id) in ('owner','admin'))
  with check (public.member_role(tenant_id) in ('owner','admin'));

-- Inhalte: Mitglieder lesen gefiltert, owner/admin schreiben.
-- `member_role(tenant_id) is not null` liefert für die Rolle 'guest' seit
-- 20260803100000_marketplace_guest_role.sql bewusst NICHT true — ein
-- Marketplace-Käufer sieht die Kunden-Area also nicht, keine eigene
-- Guest-Policy nötig (Plan Abschnitt 0.4).
create policy customer_area_items_member_select on public.customer_area_items
  for select using (
    public.member_role(tenant_id) is not null
    and ( visibility = 'all' or public.customer_area_can_see(id) )
  );

create policy customer_area_items_admin_all on public.customer_area_items
  for all using (public.member_role(tenant_id) in ('owner','admin'))
  with check (public.member_role(tenant_id) in ('owner','admin'));
