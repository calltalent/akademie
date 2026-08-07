-- "Schichtplan" — Kalender für Schichtplanung und Zeiterfassung (Josips
-- Auftrag, Block S1, 07.08.2026, architect-Plan + Josips Rückmeldung).
--
-- Festangestellte/Freelancer werden über den bestehenden Einladungsmechanismus
-- zur Academy eingeladen und bekommen optional eine Arbeiterzeile
-- (`calendar_workers`). Ein Admin/Projektleiter verwaltet Arbeiter und
-- Projekte; Arbeiter sehen ihre eigene Wochenansicht und können sich
-- ein-/ausstempeln. Pro Mandant über das Betreiber-Portal freischaltbar
-- (`tenants.settings.shift_calendar_enabled`, siehe src/lib/tenant/types.ts),
-- nicht vom Mandanten selbst — Marketplace-Opt-in-Muster
-- (20260803100100_marketplace_listings.sql-Familie), NICHT das
-- Wartungsmodus-Selbst-Schalter-Muster.
--
-- SCOPE-GRENZE (wichtig beim Lesen dieser Datei): Block S1 baut NUR
-- Datenmodell + Feature-Flag + Arbeiter-/Projektverwaltung + lesende
-- Wochenansicht + Ein-/Ausstempeln. Dieses EINE Migrationsfile enthält
-- trotzdem bereits ALLE acht Tabellen für S1–S4 (Entscheidung: ein
-- vollständiges Schema jetzt, S2–S4 sind reine Codeblöcke ohne weitere
-- Migration). Tabellen/Spalten/Policies, die S1 selbst nicht nutzt (Schicht-
-- CRUD durch Admin, Freelancer-Selbstbuchung, Änderungsanfragen, KI-Planung),
-- sind unten einzeln als "S2/S3/S4" markiert.
--
-- Architekturentscheidungen (bereits mit Josip abgestimmt, siehe
-- PHASENSTATUS.md-Eintrag "Schichtplan S1"):
--   1. Kein neuer memberships.role-Wert — eigenständige Tabelle
--      calendar_workers. 20260803100000_marketplace_guest_role.sql hat
--      member_role() bewusst auf ('owner','admin','trainer','member')
--      verengt; ~30 Policies hängen daran. Ein neuer Rollenwert würde
--      Kurszugriffsrechte überall mitverändern.
--   2. is_staff() wird NICHT verwendet (schließt 'trainer' ein, unnötiger
--      Zugriff auf Beschäftigtendaten). Verwaltungsrechte laufen über
--      member_role(tenant_id) in ('owner','admin'), wie in der Kunden-Area
--      (20260805090000_customer_area.sql, direktes Vorbild für RLS-Stil,
--      Hilfsfunktionen, Ein-Policy-je-Aktion-Konsolidierung).
--   3. calendar_workers.user_id ist NOT NULL — der Einladungsmechanismus legt
--      user_id immer sofort an, memberships.invited_email wird im Code
--      nirgends verwendet. RLS kann direkt user_id = auth.uid() prüfen.
--   4. Projektleiter ist projektbezogen (calendar_projects.lead_user_id),
--      kein globaler Rollentyp, keine mandantenweite Sicht.
--   5. Pro Tabelle GENAU EINE konsolidierte SELECT-Policy plus getrennte
--      INSERT/UPDATE/DELETE-Policies (vermeidet einen
--      multiple_permissive_policies-Nachzieh-Fix wie bei der Kunden-Area,
--      20260805090100_customer_area_rls_perf_fix.sql). Jeder Fremdschlüssel
--      ist sofort indiziert (vermeidet den fk-Index-Nachzieh-Fix wie
--      20260712233000_perf_advisors_fk_indexes_rls_initplan.sql).
--   6. Jede Kindtabelle bekommt einen ZUSAMMENGESETZTEN Fremdschlüssel
--      (fremd_id, tenant_id) gegen eltern(id, tenant_id) — exaktes Muster
--      aus customer_area_group_members (20260805090000_customer_area.sql).
--      Verhindert, dass eine Zeile auf einen fremden Mandanten zeigt.
--
-- NICHT ANGEWENDET (Auftrag, CLAUDE.md §4.6 "Nichts löschen oder deployen
-- ohne ausdrückliche Freigabe von Josip"): nur die Datei anlegen,
-- `npx supabase db push` bleibt Josip vorbehalten. Kein Supabase-MCP
-- `apply_migration`-Aufruf in dieser Sitzung.

-- =================================================================
-- 0. Voraussetzungen
-- =================================================================

-- btree_gist liefert die Gleichheits-Opklasse für uuid in einem EXCLUDE-
-- Constraint (siehe calendar_shifts/calendar_time_entries unten — ohne
-- diese Extension kennt GiST keinen "="-Operator für uuid-Spalten).
create extension if not exists btree_gist;

-- Voraussetzung für den zusammengesetzten Fremdschlüssel
-- calendar_workers.membership_id -> memberships(id, tenant_id): Postgres
-- verlangt für JEDE Seite eines zusammengesetzten Fremdschlüssels eine
-- exakt passende UNIQUE-/PRIMARY-KEY-Constraint auf den referenzierten
-- Spalten. memberships.id ist zwar bereits über den Primary Key eindeutig,
-- aber (id, tenant_id) als Paar ist es noch nicht separat deklariert.
alter table public.memberships add constraint memberships_id_tenant_uniq unique (id, tenant_id);

-- =================================================================
-- 1. calendar_workers — Arbeiterzeile (optional) zu einer Mitgliedschaft
-- =================================================================

create table public.calendar_workers (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  membership_id      uuid not null,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  worker_type        text not null check (worker_type in ('employee','freelancer')),
  status             text not null default 'active' check (status in ('active','inactive')),
  target_hours       numeric(5,2) check (target_hours > 0 and target_hours <= 400),
  target_period      text not null default 'week' check (target_period in ('week','month')),
  preferred_shift    text not null default 'any' check (preferred_shift in ('early','late','any')),
  preferred_weekdays smallint[] not null default '{}'::smallint[]
                       check (preferred_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (id, tenant_id),
  constraint calendar_workers_membership_fk
    foreign key (membership_id, tenant_id) references public.memberships(id, tenant_id) on delete cascade
);
create index calendar_workers_tenant_type_status_idx on public.calendar_workers (tenant_id, worker_type, status);
create index calendar_workers_user_idx on public.calendar_workers (user_id);
create index calendar_workers_membership_idx on public.calendar_workers (membership_id);

create trigger calendar_workers_touch before update on public.calendar_workers
  for each row execute function public.set_updated_at();

-- =================================================================
-- 2. calendar_projects — Projekte/Baustellen, denen Arbeiter zugewiesen werden
-- =================================================================

create table public.calendar_projects (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  description  text,
  color        text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  lead_user_id uuid references public.profiles(id) on delete set null,
  status       text not null default 'active' check (status in ('active','archived')),
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  unique (tenant_id, name),
  unique (id, tenant_id)
);
create index calendar_projects_tenant_status_idx on public.calendar_projects (tenant_id, status);
create index calendar_projects_lead_idx on public.calendar_projects (lead_user_id);

-- =================================================================
-- 3. calendar_project_members — welcher Arbeiter gehört zu welchem Projekt
-- =================================================================

create table public.calendar_project_members (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  worker_id  uuid not null,
  created_at timestamptz not null default now(),
  primary key (project_id, worker_id),
  constraint calendar_project_members_project_fk
    foreign key (project_id, tenant_id) references public.calendar_projects(id, tenant_id) on delete cascade,
  constraint calendar_project_members_worker_fk
    foreign key (worker_id, tenant_id) references public.calendar_workers(id, tenant_id) on delete cascade
);
create index calendar_project_members_worker_idx on public.calendar_project_members (worker_id);
create index calendar_project_members_project_tenant_idx on public.calendar_project_members (project_id, tenant_id);
create index calendar_project_members_tenant_idx on public.calendar_project_members (tenant_id);

-- =================================================================
-- 4. calendar_slots — Zeitfenster mit Kapazität (S2: Freelancer-Selbstbuchung)
-- =================================================================

create table public.calendar_slots (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  project_id uuid,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  capacity   int not null check (capacity between 1 and 500),
  status     text not null default 'open' check (status in ('open','closed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (id, tenant_id),
  constraint calendar_slots_project_fk
    foreign key (project_id, tenant_id) references public.calendar_projects(id, tenant_id) on delete cascade
);
create index calendar_slots_tenant_starts_idx on public.calendar_slots (tenant_id, starts_at);
create index calendar_slots_project_idx on public.calendar_slots (project_id);
create index calendar_slots_created_by_idx on public.calendar_slots (created_by);
-- Bewusst KEIN denormalisierter Buchungszähler auf dieser Tabelle — die
-- belegte Kapazität wird bei Bedarf live aus calendar_shifts gezählt
-- (calendar_slot_free_seats() unten, calendar_slot_capacity_guard()-Trigger
-- auf calendar_shifts), kein Konsistenzrisiko durch zwei Wahrheitsquellen.

-- =================================================================
-- 5. calendar_shifts — geplante Schichten
-- =================================================================
--
-- ÜBERLAPPUNGSSCHUTZ (EXCLUDE-Constraint, neues Muster in diesem Repo):
-- Ein Arbeiter darf nie zwei aktive (nicht stornierte) Schichten mit
-- überlappendem Zeitraum haben — z. B. verhindert das, dass ein Admin
-- versehentlich dieselbe Person für 08:00–16:00 UND 14:00–22:00 am selben
-- Tag einplant. Ein gewöhnlicher CHECK kann das nicht ausdrücken (CHECK
-- sieht immer nur EINE Zeile, nie die anderen Zeilen derselben Tabelle) —
-- dafür gibt es in Postgres EXCLUDE USING GIST: es definiert für JEDES Paar
-- von Zeilen, das laut den angegebenen Operatoren "kollidiert", einen
-- verbotenen Zustand. Hier: gleicher worker_id (Gleichheits-Operator "=",
-- braucht btree_gist für die uuid-Opklasse) UND sich überlappende
-- Zeitspannen (tstzrange(starts_at, ends_at) mit "&&", dem
-- Range-Overlap-Operator). Der WHERE-Filter (status <> 'cancelled') sorgt
-- dafür, dass stornierte Schichten den Slot wieder freigeben — ohne den
-- Filter würde eine stornierte alte Schicht eine neue Schicht in derselben
-- Zeit blockieren, obwohl sie logisch nicht mehr existiert. GiST prüft das
-- serverseitig bei JEDEM Insert/Update, race-sicher (anders als ein
-- Anwendungs-Check-vor-Insert).
--
-- FREMDSCHLÜSSEL-STRATEGIE (project_id/slot_id: RESTRICT statt SET NULL):
-- project_id und slot_id sind zusammengesetzte Fremdschlüssel (id, tenant_id)
-- gegen calendar_projects/calendar_slots — das verhindert, dass eine
-- Schicht auf ein Projekt/Zeitfenster eines FREMDEN Mandanten zeigt (Punkt 6
-- oben). Ein zusammengesetzter Fremdschlüssel mit ON DELETE SET NULL würde
-- aber scheitern: Postgres müsste BEIDE Spalten der Paarung auf NULL setzen,
-- project_id UND tenant_id — tenant_id ist hier aber NOT NULL, der
-- Löschversuch würde zur Laufzeit mit einem Constraint-Fehler abbrechen statt
-- die Schicht sauber zu entkoppeln. Deshalb RESTRICT: ein Projekt mit
-- zugewiesenen Schichten kann nicht gelöscht werden — Projekte werden
-- stattdessen archiviert (status='archived', nie hart gelöscht); ein
-- Zeitfenster mit Schichten kann erst nach deren Stornierung entfernt werden.
create table public.calendar_shifts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  worker_id     uuid not null,
  project_id    uuid,
  slot_id       uuid,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  break_minutes int not null default 0 check (break_minutes between 0 and 480),
  status        text not null default 'planned' check (status in ('planned','confirmed','cancelled')),
  source        text not null check (source in ('admin','self','ai')),
  note          text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (id, tenant_id),
  constraint calendar_shifts_worker_fk
    foreign key (worker_id, tenant_id) references public.calendar_workers(id, tenant_id) on delete cascade,
  constraint calendar_shifts_project_fk
    foreign key (project_id, tenant_id) references public.calendar_projects(id, tenant_id) on delete restrict,
  constraint calendar_shifts_slot_fk
    foreign key (slot_id, tenant_id) references public.calendar_slots(id, tenant_id) on delete restrict,
  constraint calendar_shifts_no_overlap exclude using gist (
    worker_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelled')
);
create index calendar_shifts_tenant_starts_idx on public.calendar_shifts (tenant_id, starts_at);
create index calendar_shifts_worker_starts_idx on public.calendar_shifts (worker_id, starts_at);
create index calendar_shifts_project_idx on public.calendar_shifts (project_id);
create index calendar_shifts_slot_idx on public.calendar_shifts (slot_id);
create index calendar_shifts_created_by_idx on public.calendar_shifts (created_by);

create trigger calendar_shifts_touch before update on public.calendar_shifts
  for each row execute function public.set_updated_at();

-- =================================================================
-- 6. calendar_absences — Urlaub/Krankheit/Feiertag (S2/S3 UI, Schema jetzt)
-- =================================================================
-- worker_id = NULL bedeutet ein mandantenweiter Feiertag (kind muss dann
-- zwingend 'holiday' sein, siehe Check unten) — kein eigener Arbeiter
-- betroffen, gilt für den ganzen Mandanten.

create table public.calendar_absences (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  worker_id  uuid,
  kind       text not null check (kind in ('vacation','holiday','sick','other')),
  starts_on  date not null,
  ends_on    date not null,
  note       text,
  status     text not null default 'approved' check (status in ('requested','approved','rejected')),
  created_by uuid references public.profiles(id),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check ((kind = 'holiday') = (worker_id is null)),
  constraint calendar_absences_worker_fk
    foreign key (worker_id, tenant_id) references public.calendar_workers(id, tenant_id) on delete cascade
);
create index calendar_absences_tenant_starts_idx on public.calendar_absences (tenant_id, starts_on);
create index calendar_absences_worker_idx on public.calendar_absences (worker_id);

-- =================================================================
-- 7. calendar_shift_change_requests — Änderungsanfragen (S3 UI, Schema jetzt)
-- =================================================================

create table public.calendar_shift_change_requests (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  shift_id               uuid not null,
  worker_id              uuid not null,
  kind                   text not null check (kind in ('update','cancel')),
  proposed_starts_at     timestamptz,
  proposed_ends_at       timestamptz,
  proposed_break_minutes int,
  -- Bewusst OHNE Fremdschlüssel (der Plan nennt hier "uuid, nullable" ohne
  -- FK-Vorgabe): dieses Feld wird erst mit dem S3-UI beschrieben, das dann
  -- den Projektwechsel-Wert vor dem Schreiben serverseitig gegen den
  -- aufrufenden Mandanten validiert (gleiches Prinzip wie
  -- resolveContactTrainerId() in src/lib/customer-area/actions.ts) statt
  -- sich auf einen DB-Constraint zu verlassen.
  proposed_project_id    uuid,
  reason                 text,
  status                 text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by             uuid references public.profiles(id),
  decided_at             timestamptz,
  decision_note          text,
  created_at             timestamptz not null default now(),
  constraint calendar_change_requests_shift_fk
    foreign key (shift_id, tenant_id) references public.calendar_shifts(id, tenant_id) on delete cascade,
  constraint calendar_change_requests_worker_fk
    foreign key (worker_id, tenant_id) references public.calendar_workers(id, tenant_id) on delete cascade,
  constraint calendar_change_requests_shape check (
       (kind = 'cancel' and proposed_starts_at is null and proposed_ends_at is null)
    or (kind = 'update' and proposed_starts_at is not null and proposed_ends_at is not null
        and proposed_ends_at > proposed_starts_at)
  )
);
-- Höchstens eine offene Anfrage je Schicht gleichzeitig.
create unique index calendar_change_requests_one_pending
  on public.calendar_shift_change_requests (shift_id) where status = 'pending';
create index calendar_change_requests_tenant_idx on public.calendar_shift_change_requests (tenant_id);
create index calendar_change_requests_worker_idx on public.calendar_shift_change_requests (worker_id);

-- =================================================================
-- 8. calendar_time_entries — echtes Ein-/Ausstempeln (S1-relevant)
-- =================================================================
--
-- FREMDSCHLÜSSEL-STRATEGIE (shift_id: EINFACHER Fremdschlüssel, NICHT
-- zusammengesetzt): anders als project_id/slot_id auf calendar_shifts oben
-- ist shift_id hier bewusst EIN einfacher Fremdschlüssel nur auf
-- calendar_shifts(id), nicht auf (id, tenant_id). Grund: ein Stempel-Eintrag
-- soll erhalten bleiben, auch wenn die zugehörige Schicht später gelöscht
-- wird (historische Zeiterfassung überlebt eine gelöschte Schicht) — das
-- verlangt ON DELETE SET NULL. Ein zusammengesetzter Fremdschlüssel mit
-- SET NULL hätte hier exakt dasselbe Problem wie bei calendar_shifts.project_id
-- oben (Postgres müsste tenant_id mit auf NULL setzen wollen, obwohl es
-- NOT NULL ist) — deshalb bewusst EIN einfacher FK auf shift_id allein,
-- tenant_id bleibt eine eigenständige, von diesem FK unberührte NOT-NULL-
-- Spalte. Das öffnet theoretisch die Möglichkeit, dass shift_id auf eine
-- Schicht eines ANDEREN Mandanten zeigt (kein DB-Constraint verhindert das
-- hier) — kein Sicherheitsleck (RLS auf calendar_shifts filtert beim
-- Auflösen des Verweises ohnehin nach dessen eigener tenant_id, ein
-- Querverweis liefert schlicht keine Zeile), aber ein Datenintegritäts-Punkt:
-- clockIn() (src/lib/calendar/actions.ts) validiert deshalb serverseitig,
-- dass ein übergebener shiftId zum selben Mandanten UND Arbeiter gehört,
-- bevor geschrieben wird — gleiches Prinzip wie resolveContactTrainerId()
-- in src/lib/customer-area/actions.ts.
create table public.calendar_time_entries (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  worker_id  uuid not null,
  shift_id   uuid references public.calendar_shifts(id) on delete set null,
  started_at timestamptz not null,
  ended_at   timestamptz,
  source     text not null check (source in ('admin','self')),
  note       text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at),
  constraint calendar_time_entries_worker_fk
    foreign key (worker_id, tenant_id) references public.calendar_workers(id, tenant_id) on delete cascade,
  -- Nur EIN offener Stempel je Arbeiter gleichzeitig (ended_at is null =
  -- "aktuell eingestempelt").
  constraint calendar_time_entries_no_overlap exclude using gist (
    worker_id with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz)) with &&
  )
);
create unique index calendar_time_entries_one_open
  on public.calendar_time_entries (worker_id) where ended_at is null;
create index calendar_time_entries_tenant_worker_started_idx
  on public.calendar_time_entries (tenant_id, worker_id, started_at);
create index calendar_time_entries_shift_idx on public.calendar_time_entries (shift_id);

create trigger calendar_time_entries_touch before update on public.calendar_time_entries
  for each row execute function public.set_updated_at();

-- =================================================================
-- 9. ai_jobs-Erweiterung (für S4 KI-Planung, sofort mitmigriert)
-- =================================================================
-- Gleiches Muster wie 20260717120000_ai_jobs_kind_translation.sql: 0001_init.sql
-- wird nie geändert (CLAUDE.md §3), Constraint per drop+add erweitert.
-- Reale, bestehende kind-Werte übernommen (0001_init.sql Zeile 281 plus
-- 'translation' aus 20260717120000_ai_jobs_kind_translation.sql) plus
-- 'shift_plan' als einzige Ergänzung für S4 (KI-Schichtplan-Vorschlag).
alter table public.ai_jobs drop constraint if exists ai_jobs_kind_check;
alter table public.ai_jobs add constraint ai_jobs_kind_check
  check (kind in ('course_gen','quiz_gen','transcript','summary','embed','translation','shift_plan'));

-- =================================================================
-- 10. Hilfsfunktionen (security definer, gleiches Stil-Vorbild wie
--     customer_area_can_see()/member_role()/is_staff() in 0001_init.sql)
-- =================================================================

-- Eigene Arbeiterzeile des aufrufenden Nutzers im Mandanten, oder NULL.
create or replace function public.calendar_worker_id(t uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select w.id from public.calendar_workers w
  where w.tenant_id = t and w.user_id = auth.uid()
  limit 1;
$$;

-- Verwaltungsrecht: owner/admin des Mandanten (bewusst NICHT is_staff(), das
-- schlösse 'trainer' mit ein — unnötiger Zugriff auf Beschäftigtendaten).
create or replace function public.calendar_is_admin(t uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.member_role(t) in ('owner','admin'), false);
$$;

-- Leitet der aufrufende Nutzer DIESES Projekt? Zusätzliche
-- member_role(...)-Prüfung stellt sicher, dass ein verwaister
-- lead_user_id-Verweis (z. B. nach Rollenänderung ohne Projekt-Update) nicht
-- automatisch Zugriff gewährt — "gleicher Mandant wie Aufrufer" (Plan).
create or replace function public.calendar_leads_project(p uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.calendar_projects cp
    where cp.id = p and cp.lead_user_id = auth.uid()
      and public.member_role(cp.tenant_id) is not null
  );
$$;

-- Leitet der aufrufende Nutzer irgendein Projekt, dem dieser Arbeiter
-- zugewiesen ist?
create or replace function public.calendar_leads_worker(w uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.calendar_project_members pm
    join public.calendar_projects cp on cp.id = pm.project_id
    where pm.worker_id = w and cp.lead_user_id = auth.uid()
  );
$$;

-- Für S2 vorbereitet (Freelancer-Selbstbuchung eines offenen Zeitfensters),
-- in S1 an KEINER Policy verwendet — reserviert, damit S2 keine weitere
-- Migration braucht.
create or replace function public.calendar_self_may_book(t uuid, slot uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.calendar_workers w
    join public.calendar_slots s on s.tenant_id = w.tenant_id
    where w.tenant_id = t and w.user_id = auth.uid()
      and w.worker_type = 'freelancer' and w.status = 'active'
      and s.id = slot and s.status = 'open'
  );
$$;

-- Für S2 vorbereitet (freie Plätze eines Zeitfensters für die
-- Selbstbuchungs-Ansicht), in S1 an KEINER Policy verwendet. Liefert NUR
-- eine Zahl (Plan), keine Buchungsdetails.
create or replace function public.calendar_slot_free_seats(slot uuid)
returns int
language sql stable security definer
set search_path = public
as $$
  select greatest(s.capacity - count(sh.id), 0)::int
  from public.calendar_slots s
  left join public.calendar_shifts sh on sh.slot_id = s.id and sh.status <> 'cancelled'
  where s.id = slot
  group by s.capacity;
$$;

revoke execute on function public.calendar_worker_id(uuid) from public;
revoke execute on function public.calendar_is_admin(uuid) from public;
revoke execute on function public.calendar_leads_project(uuid) from public;
revoke execute on function public.calendar_leads_worker(uuid) from public;
revoke execute on function public.calendar_self_may_book(uuid, uuid) from public;
revoke execute on function public.calendar_slot_free_seats(uuid) from public;
grant execute on function public.calendar_worker_id(uuid) to authenticated, service_role;
grant execute on function public.calendar_is_admin(uuid) to authenticated, service_role;
grant execute on function public.calendar_leads_project(uuid) to authenticated, service_role;
grant execute on function public.calendar_leads_worker(uuid) to authenticated, service_role;
grant execute on function public.calendar_self_may_book(uuid, uuid) to authenticated, service_role;
grant execute on function public.calendar_slot_free_seats(uuid) to authenticated, service_role;

-- =================================================================
-- 11. Kapazitäts-Trigger auf calendar_shifts (Schema-Teil für S2, jetzt
--     mitmigriert, da er direkt an der Tabelle hängt)
-- =================================================================
-- Prüft bei jedem Insert/relevanten Update: liegt die Schicht innerhalb des
-- zugewiesenen Zeitfensters (CT002) und ist das Zeitfenster noch nicht
-- überbucht (CT001)? security definer + `for update`-Zeilensperre auf den
-- Slot macht das race-sicher bei gleichzeitigen Buchungen.
create or replace function public.calendar_slot_capacity_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_slot record; v_taken int;
begin
  if new.slot_id is null or new.status = 'cancelled' then return null; end if;
  select capacity, starts_at, ends_at into v_slot
    from public.calendar_slots where id = new.slot_id for update;
  if not found then return null; end if;
  if new.starts_at < v_slot.starts_at or new.ends_at > v_slot.ends_at then
    raise exception 'calendar_shift_outside_slot' using errcode = 'CT002';
  end if;
  select count(*) into v_taken from public.calendar_shifts
    where slot_id = new.slot_id and status <> 'cancelled';
  if v_taken > v_slot.capacity then
    raise exception 'calendar_slot_full' using errcode = 'CT001';
  end if;
  return null;
end $$;

create trigger calendar_shifts_slot_capacity
  after insert or update of slot_id, status, starts_at, ends_at
  on public.calendar_shifts
  for each row execute function public.calendar_slot_capacity_guard();

-- =================================================================
-- 12. Spaltenschutz-Trigger auf calendar_time_entries (S1-relevant)
-- =================================================================
-- Ein Arbeiter darf per UPDATE NUR `ended_at` (und das begleitende
-- `updated_at`) einer eigenen, noch offenen Zeile setzen — "jetzt
-- ausstempeln", sonst nichts. Die RLS-UPDATE-Policy unten lässt Nicht-
-- Admins/Nicht-Projektleiter ohnehin nur an Zeilen mit OLD.ended_at IS NULL
-- heran (USING-Klausel), aber `with check` allein sieht nur die NEUE Zeile,
-- nicht die alte — es kann das Delta zum vorherigen Stand nicht ausdrücken.
-- Ohne diesen Trigger könnte ein Arbeiter beim Ausstempeln z. B. zusätzlich
-- `started_at` rückwirkend auf einen früheren Zeitpunkt verschieben und sich
-- so mehr Arbeitszeit gutschreiben. Admin/Projektleiter dürfen (für
-- Korrekturen) weiterhin alle Felder ändern.
create or replace function public.calendar_time_entries_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.calendar_is_admin(new.tenant_id) or public.calendar_leads_worker(new.worker_id) then
    return new;
  end if;

  new.tenant_id  := old.tenant_id;
  new.worker_id  := old.worker_id;
  new.shift_id   := old.shift_id;
  new.started_at := old.started_at;
  new.source     := old.source;
  new.note       := old.note;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  -- ended_at/updated_at bleiben NEW — das einzig erlaubte Delta.
  return new;
end;
$$;

create trigger calendar_time_entries_guard_trg
  before update on public.calendar_time_entries
  for each row execute function public.calendar_time_entries_guard();

-- =================================================================
-- 13. Row Level Security
-- =================================================================

alter table public.calendar_workers               enable row level security;
alter table public.calendar_projects               enable row level security;
alter table public.calendar_project_members        enable row level security;
alter table public.calendar_slots                  enable row level security;
alter table public.calendar_shifts                 enable row level security;
alter table public.calendar_absences               enable row level security;
alter table public.calendar_shift_change_requests   enable row level security;
alter table public.calendar_time_entries            enable row level security;

-- --- calendar_workers ---------------------------------------------------
-- `(select auth.uid())` statt bloßem `auth.uid()` — auth_rls_initplan-Muster,
-- gleiche Konvention wie 20260803100000_marketplace_guest_role.sql Zeile
-- 274ff.: Postgres cacht den Wert dann als InitPlan statt ihn pro Zeile neu
-- auszuwerten. Gilt nur für DIREKTE Vorkommen in der Policy selbst, nicht
-- für auth.uid() INNERHALB der security-definer-Hilfsfunktionen oben, dort
-- bleibt es bewusst bare wie bei member_role()/has_enrollment().
create policy calendar_workers_select on public.calendar_workers
  for select using (
    public.calendar_is_admin(tenant_id)
    or user_id = (select auth.uid())
    or public.calendar_leads_worker(id)
  );
create policy calendar_workers_insert on public.calendar_workers
  for insert with check (public.calendar_is_admin(tenant_id));
create policy calendar_workers_update on public.calendar_workers
  for update using (public.calendar_is_admin(tenant_id)) with check (public.calendar_is_admin(tenant_id));
create policy calendar_workers_delete on public.calendar_workers
  for delete using (public.calendar_is_admin(tenant_id));

-- --- calendar_projects ---------------------------------------------------
create policy calendar_projects_select on public.calendar_projects
  for select using (
    public.calendar_is_admin(tenant_id)
    or lead_user_id = (select auth.uid())
    or exists (
      select 1 from public.calendar_project_members pm
      where pm.project_id = calendar_projects.id
        and pm.worker_id = public.calendar_worker_id(tenant_id)
    )
  );
create policy calendar_projects_insert on public.calendar_projects
  for insert with check (public.calendar_is_admin(tenant_id));
create policy calendar_projects_update on public.calendar_projects
  for update using (public.calendar_is_admin(tenant_id)) with check (public.calendar_is_admin(tenant_id));
create policy calendar_projects_delete on public.calendar_projects
  for delete using (public.calendar_is_admin(tenant_id));

-- --- calendar_project_members --------------------------------------------
create policy calendar_project_members_select on public.calendar_project_members
  for select using (
    public.calendar_is_admin(tenant_id)
    or public.calendar_leads_project(project_id)
    or worker_id = public.calendar_worker_id(tenant_id)
  );
create policy calendar_project_members_insert on public.calendar_project_members
  for insert with check (public.calendar_is_admin(tenant_id));
create policy calendar_project_members_update on public.calendar_project_members
  for update using (public.calendar_is_admin(tenant_id)) with check (public.calendar_is_admin(tenant_id));
create policy calendar_project_members_delete on public.calendar_project_members
  for delete using (public.calendar_is_admin(tenant_id));

-- --- calendar_slots (S2-UI, RLS jetzt schon korrekt) ---------------------
create policy calendar_slots_select on public.calendar_slots
  for select using (
    public.calendar_is_admin(tenant_id)
    or public.calendar_leads_project(project_id)
    or (
      public.calendar_worker_id(tenant_id) is not null
      and project_id is not null
      and exists (
        select 1 from public.calendar_project_members pm
        where pm.project_id = calendar_slots.project_id
          and pm.worker_id = public.calendar_worker_id(tenant_id)
      )
    )
  );
create policy calendar_slots_insert on public.calendar_slots
  for insert with check (public.calendar_is_admin(tenant_id) or public.calendar_leads_project(project_id));
create policy calendar_slots_update on public.calendar_slots
  for update using (public.calendar_is_admin(tenant_id) or public.calendar_leads_project(project_id))
  with check (public.calendar_is_admin(tenant_id) or public.calendar_leads_project(project_id));
create policy calendar_slots_delete on public.calendar_slots
  for delete using (public.calendar_is_admin(tenant_id) or public.calendar_leads_project(project_id));

-- --- calendar_shifts ------------------------------------------------------
-- WICHTIG (S1-Scope-Grenze): bewusst KEINE Selbstbuchungs-INSERT-Policy für
-- Arbeiter — Admin/Projektleiter dürfen laut Plan bereits frei schreiben
-- (S1 baut dafür keine UI, die Policy steht aber schon korrekt für S2/S3).
create policy calendar_shifts_select on public.calendar_shifts
  for select using (
    public.calendar_is_admin(tenant_id)
    or worker_id = public.calendar_worker_id(tenant_id)
    or public.calendar_leads_project(project_id)
  );
create policy calendar_shifts_insert on public.calendar_shifts
  for insert with check (public.calendar_is_admin(tenant_id) or public.calendar_leads_project(project_id));
create policy calendar_shifts_update on public.calendar_shifts
  for update using (public.calendar_is_admin(tenant_id) or public.calendar_leads_project(project_id))
  with check (public.calendar_is_admin(tenant_id) or public.calendar_leads_project(project_id));
create policy calendar_shifts_delete on public.calendar_shifts
  for delete using (public.calendar_is_admin(tenant_id) or public.calendar_leads_project(project_id));

-- --- calendar_absences (S2/S3-UI, RLS jetzt schon korrekt) ---------------
create policy calendar_absences_select on public.calendar_absences
  for select using (
    public.calendar_is_admin(tenant_id)
    or worker_id = public.calendar_worker_id(tenant_id)
    -- Feiertag (worker_id is null) ist mandantenweit sichtbar, aber NUR fuer
    -- Mitglieder DIESES Mandanten -- ohne member_role()-Check waere dieser
    -- Zweig der einzige ohne Tenant-Bezug und liesse jeden authentifizierten
    -- Nutzer Feiertagszeilen JEDES Mandanten abfragen (Fund security-reviewer
    -- H1, 07.08.2026, vor dem ersten db push behoben).
    or (worker_id is null and public.member_role(tenant_id) is not null)
    or public.calendar_leads_worker(worker_id)
  );
create policy calendar_absences_insert on public.calendar_absences
  for insert with check (public.calendar_is_admin(tenant_id));
create policy calendar_absences_update on public.calendar_absences
  for update using (public.calendar_is_admin(tenant_id)) with check (public.calendar_is_admin(tenant_id));
create policy calendar_absences_delete on public.calendar_absences
  for delete using (public.calendar_is_admin(tenant_id));

-- --- calendar_shift_change_requests (S3-UI, RLS jetzt schon korrekt) -----
-- INSERT/UPDATE hier bewusst nur Admin/Projektleiter in S1 — die
-- Arbeiter-eigene INSERT-Policy (Änderungsanfrage stellen) kommt erst mit S3.
create policy calendar_change_requests_select on public.calendar_shift_change_requests
  for select using (
    public.calendar_is_admin(tenant_id)
    or worker_id = public.calendar_worker_id(tenant_id)
    or public.calendar_leads_worker(worker_id)
  );
create policy calendar_change_requests_insert on public.calendar_shift_change_requests
  for insert with check (public.calendar_is_admin(tenant_id) or public.calendar_leads_worker(worker_id));
create policy calendar_change_requests_update on public.calendar_shift_change_requests
  for update using (public.calendar_is_admin(tenant_id) or public.calendar_leads_worker(worker_id))
  with check (public.calendar_is_admin(tenant_id) or public.calendar_leads_worker(worker_id));
create policy calendar_change_requests_delete on public.calendar_shift_change_requests
  for delete using (public.calendar_is_admin(tenant_id));

-- --- calendar_time_entries (S1-relevant: Ein-/Ausstempeln) ---------------
-- INSERT: Admin/Projektleiter frei ODER der Arbeiter stempelt sich selbst
-- ein (source='self', eigener worker_id, started_at nahe "jetzt" — ±5
-- Minuten Toleranz für Client-Uhr-Drift/Ladezeit, verhindert aber
-- rückwirkendes Selbst-Einstempeln auf einen beliebigen Zeitpunkt).
-- UPDATE: Admin/Projektleiter frei; ein Arbeiter darf die eigene Zeile NUR
-- updaten, solange sie noch offen ist (OLD.ended_at is null) — der
-- Spaltenschutz-Trigger oben sorgt dafür, dass dabei wirklich nur ended_at
-- sich ändert.
create policy calendar_time_entries_select on public.calendar_time_entries
  for select using (
    public.calendar_is_admin(tenant_id)
    or worker_id = public.calendar_worker_id(tenant_id)
    or public.calendar_leads_worker(worker_id)
  );
create policy calendar_time_entries_insert on public.calendar_time_entries
  for insert with check (
    public.calendar_is_admin(tenant_id)
    or public.calendar_leads_worker(worker_id)
    or (
      worker_id = public.calendar_worker_id(tenant_id)
      and source = 'self'
      and started_at between now() - interval '5 minutes' and now() + interval '5 minutes'
    )
  );
create policy calendar_time_entries_update on public.calendar_time_entries
  for update using (
    public.calendar_is_admin(tenant_id)
    or public.calendar_leads_worker(worker_id)
    or (worker_id = public.calendar_worker_id(tenant_id) and ended_at is null)
  )
  with check (
    public.calendar_is_admin(tenant_id)
    or public.calendar_leads_worker(worker_id)
    or worker_id = public.calendar_worker_id(tenant_id)
  );
create policy calendar_time_entries_delete on public.calendar_time_entries
  for delete using (public.calendar_is_admin(tenant_id));
