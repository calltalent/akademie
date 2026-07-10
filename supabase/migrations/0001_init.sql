-- =============================================================
-- Calltalent-Akademie — Initial Schema (Phase 0, 2026-07-10)
-- Multi-Tenant LMS: jede Tabelle traegt tenant_id, RLS ueberall.
-- Diese Datei nie nachtraeglich aendern — neue Migrationen anlegen.
-- =============================================================

create extension if not exists pgcrypto;
create extension if not exists vector;

-- -------------------------------------------------------------
-- 1. Tenants & Identitaet
-- -------------------------------------------------------------

create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name          text not null,
  custom_domain text unique,
  plan          text not null default 'komplett' check (plan in ('trial','komplett','enterprise')),
  status        text not null default 'active' check (status in ('active','trial','suspended')),
  branding      jsonb not null default '{}'::jsonb,   -- logo_url, color_primary, color_bg, font, radius
  legal         jsonb not null default '{}'::jsonb,   -- impressum_url, datenschutz_url
  settings      jsonb not null default '{}'::jsonb,   -- payments_enabled, tutor_enabled, default_locale
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  avatar_url text,
  locale     text not null default 'de',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid references public.profiles(id) on delete cascade,
  invited_email text,
  role          text not null default 'member' check (role in ('owner','admin','trainer','member')),
  status        text not null default 'active' check (status in ('invited','active','disabled')),
  created_at    timestamptz not null default now(),
  unique (tenant_id, user_id),
  check (user_id is not null or invited_email is not null)
);
create index memberships_tenant_idx on public.memberships (tenant_id);
create index memberships_user_idx on public.memberships (user_id);

-- Rollen-Helfer: liefert Rolle des eingeloggten Nutzers im Mandanten (oder null).
create or replace function public.member_role(t uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select m.role from public.memberships m
  where m.tenant_id = t and m.user_id = auth.uid() and m.status = 'active'
  limit 1;
$$;

create or replace function public.is_staff(t uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.member_role(t) in ('owner','admin','trainer'), false);
$$;

-- updated_at-Trigger (generisch)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -------------------------------------------------------------
-- 2. Kurse & Inhalte
-- -------------------------------------------------------------

create table public.courses (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  title       text not null,
  slug        text not null,
  description text,
  cover_url   text,
  status      text not null default 'draft' check (status in ('draft','published','archived')),
  position    int  not null default 0,
  settings    jsonb not null default '{}'::jsonb,  -- certificate_enabled, tutor_enabled, drip
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, slug)
);
create index courses_tenant_idx on public.courses (tenant_id);

create table public.modules (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title     text not null,
  position  int  not null default 0
);
create index modules_course_idx on public.modules (course_id);
create index modules_tenant_idx on public.modules (tenant_id);

create table public.lessons (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  module_id        uuid not null references public.modules(id) on delete cascade,
  title            text not null,
  position         int  not null default 0,
  blocks           jsonb not null default '[]'::jsonb, -- [{type:'text'|'image'|'video'|'audio'|'file'|'quiz'|'submission'|'callout'|'embed', ...}]
  video_bunny_id   text,
  video_duration_s int,
  transcript       text,
  summary          text,
  status           text not null default 'draft' check (status in ('draft','published')),
  updated_at       timestamptz not null default now()
);
create index lessons_module_idx on public.lessons (module_id);
create index lessons_tenant_idx on public.lessons (tenant_id);

create table public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  course_id   uuid not null references public.courses(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  source      text not null default 'manual' check (source in ('manual','purchase','import')),
  enrolled_at timestamptz not null default now(),
  expires_at  timestamptz,
  unique (course_id, user_id)
);
create index enrollments_tenant_idx on public.enrollments (tenant_id);
create index enrollments_user_idx on public.enrollments (user_id);

create table public.progress (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  lesson_id    uuid not null references public.lessons(id) on delete cascade,
  status       text not null default 'started' check (status in ('started','completed')),
  seconds_watched int not null default 0,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  unique (user_id, lesson_id)
);
create index progress_tenant_idx on public.progress (tenant_id);
create index progress_lesson_idx on public.progress (lesson_id);

-- -------------------------------------------------------------
-- 3. Quiz, Abgaben, Zertifikate
-- -------------------------------------------------------------

create table public.quizzes (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  title     text not null,
  kind      text not null default 'quiz' check (kind in ('quiz','exam')),
  pass_pct  int  not null default 70 check (pass_pct between 0 and 100),
  settings  jsonb not null default '{}'::jsonb  -- time_limit_s, attempts_allowed, shuffle
);
create index quizzes_tenant_idx on public.quizzes (tenant_id);

create table public.questions (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quiz_id   uuid not null references public.quizzes(id) on delete cascade,
  position  int  not null default 0,
  kind      text not null default 'single' check (kind in ('single','multi','gap','open')),
  prompt    text not null,
  options   jsonb not null default '[]'::jsonb,
  answer    jsonb not null default '{}'::jsonb,  -- korrekte Loesung (nur staff-lesbar; Client bekommt Fragen ohne answer via View/API)
  points    int  not null default 1
);
create index questions_quiz_idx on public.questions (quiz_id);
create index questions_tenant_idx on public.questions (tenant_id);

create table public.attempts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  started_at   timestamptz not null default now(),
  submitted_at timestamptz,
  answers      jsonb not null default '{}'::jsonb,
  score_pct    int,
  passed       boolean
);
create index attempts_tenant_idx on public.attempts (tenant_id);
create index attempts_user_idx on public.attempts (user_id);

create table public.submissions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lesson_id   uuid not null references public.lessons(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'text' check (kind in ('text','file','video','audio')),
  content     text,
  file_path   text,             -- Storage-Pfad {tenant_id}/...
  status      text not null default 'submitted' check (status in ('submitted','approved','revision','rejected')),
  grade       text,
  feedback    text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index submissions_tenant_idx on public.submissions (tenant_id);
create index submissions_lesson_idx on public.submissions (lesson_id);

create table public.certificates (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  serial    text not null unique,
  pdf_path  text,
  issued_at timestamptz not null default now(),
  unique (course_id, user_id)
);
create index certificates_tenant_idx on public.certificates (tenant_id);

-- -------------------------------------------------------------
-- 4. Commerce (Stripe)
-- -------------------------------------------------------------

create table public.products (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  title            text not null,
  slug             text not null,
  course_ids       uuid[] not null default '{}',
  kind             text not null default 'one_time' check (kind in ('one_time','subscription')),
  price_cents      int  not null,
  currency         text not null default 'eur',
  stripe_product_id text,
  stripe_price_id   text,
  active           boolean not null default true,
  unique (tenant_id, slug)
);
create index products_tenant_idx on public.products (tenant_id);

create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  user_id               uuid references public.profiles(id) on delete set null,
  product_id            uuid references public.products(id) on delete set null,
  stripe_checkout_id    text unique,
  stripe_payment_intent text,
  amount_cents          int,
  currency              text default 'eur',
  status                text not null default 'pending' check (status in ('pending','paid','refunded','failed')),
  created_at            timestamptz not null default now()
);
create index orders_tenant_idx on public.orders (tenant_id);

create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  user_id                uuid references public.profiles(id) on delete set null,
  product_id             uuid references public.products(id) on delete set null,
  stripe_subscription_id text unique,
  status                 text not null default 'active' check (status in ('active','past_due','canceled')),
  current_period_end     timestamptz
);
create index subscriptions_tenant_idx on public.subscriptions (tenant_id);

-- -------------------------------------------------------------
-- 5. KI: Jobs, Embeddings, Tutor, Kontingente
-- -------------------------------------------------------------

create table public.ai_jobs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  kind       text not null check (kind in ('course_gen','quiz_gen','transcript','summary','embed')),
  status     text not null default 'queued' check (status in ('queued','running','done','error')),
  input      jsonb not null default '{}'::jsonb,
  output     jsonb,
  model      text,
  tokens_in  int not null default 0,
  tokens_out int not null default 0,
  cost_usd   numeric(10,4) not null default 0,
  error      text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_jobs_tenant_idx on public.ai_jobs (tenant_id);

create table public.embeddings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  course_id   uuid not null references public.courses(id) on delete cascade,
  lesson_id   uuid not null references public.lessons(id) on delete cascade,
  chunk_index int  not null,
  content     text not null,
  embedding   vector(1024),
  unique (lesson_id, chunk_index)
);
create index embeddings_tenant_idx on public.embeddings (tenant_id);
create index embeddings_course_idx on public.embeddings (course_id);
create index embeddings_vec_idx on public.embeddings using hnsw (embedding vector_cosine_ops);

create table public.tutor_conversations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index tutor_conv_tenant_idx on public.tutor_conversations (tenant_id);

create table public.tutor_messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.tutor_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  source_lessons  uuid[] default '{}',
  escalated       boolean not null default false,
  tokens_in       int not null default 0,
  tokens_out      int not null default 0,
  cost_usd        numeric(10,4) not null default 0,
  created_at      timestamptz not null default now()
);
create index tutor_msg_conv_idx on public.tutor_messages (conversation_id);
create index tutor_msg_tenant_idx on public.tutor_messages (tenant_id);

create table public.usage_counters (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  month         date not null,                      -- immer 1. des Monats
  tutor_answers int not null default 0,
  course_gens   int not null default 0,
  unique (tenant_id, month)
);
create index usage_tenant_idx on public.usage_counters (tenant_id);

-- -------------------------------------------------------------
-- 6. Integration & System
-- -------------------------------------------------------------

create table public.api_keys (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  key_hash   text not null unique,   -- sha256; Klartext nur einmal bei Erzeugung sichtbar
  last_used  timestamptz,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index api_keys_tenant_idx on public.api_keys (tenant_id);

create table public.webhooks (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  url        text not null,
  events     text[] not null default '{}',
  secret     text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index webhooks_tenant_idx on public.webhooks (tenant_id);

create table public.webhook_deliveries (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  webhook_id   uuid not null references public.webhooks(id) on delete cascade,
  event        text not null,
  payload      jsonb not null,
  status_code  int,
  attempts     int not null default 0,
  delivered_at timestamptz,
  created_at   timestamptz not null default now()
);
create index wh_del_tenant_idx on public.webhook_deliveries (tenant_id);

create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  action     text not null,
  entity     text,
  entity_id  uuid,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_tenant_idx on public.audit_log (tenant_id);

-- updated_at-Trigger anlegen
create trigger tenants_touch   before update on public.tenants   for each row execute function public.set_updated_at();
create trigger profiles_touch  before update on public.profiles  for each row execute function public.set_updated_at();
create trigger courses_touch   before update on public.courses   for each row execute function public.set_updated_at();
create trigger lessons_touch   before update on public.lessons   for each row execute function public.set_updated_at();
create trigger progress_touch  before update on public.progress  for each row execute function public.set_updated_at();
create trigger ai_jobs_touch   before update on public.ai_jobs   for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- 7. Row Level Security
-- Muster:
--   member_select  = Mitglied des Mandanten darf lesen (ggf. nur published)
--   staff_all      = owner/admin/trainer verwalten mandantenweit
--   own_rows       = Lernende sehen/schreiben nur eigene Zeilen
--   Server-Aufgaben (Stripe, KI-Jobs, Webhooks) laufen ueber service_role (umgeht RLS).
-- -------------------------------------------------------------

alter table public.tenants             enable row level security;
alter table public.profiles            enable row level security;
alter table public.memberships         enable row level security;
alter table public.courses             enable row level security;
alter table public.modules             enable row level security;
alter table public.lessons             enable row level security;
alter table public.enrollments         enable row level security;
alter table public.progress            enable row level security;
alter table public.quizzes             enable row level security;
alter table public.questions           enable row level security;
alter table public.attempts            enable row level security;
alter table public.submissions         enable row level security;
alter table public.certificates        enable row level security;
alter table public.products            enable row level security;
alter table public.orders              enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.ai_jobs             enable row level security;
alter table public.embeddings          enable row level security;
alter table public.tutor_conversations enable row level security;
alter table public.tutor_messages      enable row level security;
alter table public.usage_counters      enable row level security;
alter table public.api_keys            enable row level security;
alter table public.webhooks            enable row level security;
alter table public.webhook_deliveries  enable row level security;
alter table public.audit_log           enable row level security;

-- tenants: Mitglieder lesen; nur owner/admin aendern. Anlegen nur ueber service_role (Betreiber-Portal).
create policy tenants_member_select on public.tenants
  for select using (public.member_role(id) is not null);
create policy tenants_admin_update on public.tenants
  for update using (public.member_role(id) in ('owner','admin'));

-- profiles: jeder sieht/aendert nur sich selbst; Staff sieht Profile seiner Mandanten-Mitglieder.
create policy profiles_own on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_staff_select on public.profiles
  for select using (exists (
    select 1 from public.memberships m
    where m.user_id = profiles.id
      and public.is_staff(m.tenant_id)
  ));

-- memberships: eigene Zeilen lesen; Staff verwaltet mandantenweit (nur owner/admin schreiben).
create policy memberships_own_select on public.memberships
  for select using (user_id = auth.uid());
create policy memberships_staff_select on public.memberships
  for select using (public.is_staff(tenant_id));
create policy memberships_admin_write on public.memberships
  for all using (public.member_role(tenant_id) in ('owner','admin'))
  with check (public.member_role(tenant_id) in ('owner','admin'));

-- courses/modules/lessons: Mitglieder lesen published; Staff alles.
create policy courses_member_select on public.courses
  for select using (
    (status = 'published' and public.member_role(tenant_id) is not null)
    or public.is_staff(tenant_id)
  );
create policy courses_staff_write on public.courses
  for all using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));

create policy modules_member_select on public.modules
  for select using (public.member_role(tenant_id) is not null);
create policy modules_staff_write on public.modules
  for all using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));

create policy lessons_member_select on public.lessons
  for select using (
    (status = 'published' and public.member_role(tenant_id) is not null)
    or public.is_staff(tenant_id)
  );
create policy lessons_staff_write on public.lessons
  for all using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));

-- enrollments: eigene lesen; Staff verwaltet.
create policy enrollments_own_select on public.enrollments
  for select using (user_id = auth.uid());
create policy enrollments_staff_all on public.enrollments
  for all using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));

-- progress: Lernende schreiben eigenen Fortschritt; Staff liest mandantenweit.
create policy progress_own on public.progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy progress_staff_select on public.progress
  for select using (public.is_staff(tenant_id));

-- quizzes: Mitglieder lesen; Staff schreibt.
create policy quizzes_member_select on public.quizzes
  for select using (public.member_role(tenant_id) is not null);
create policy quizzes_staff_write on public.quizzes
  for all using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));

-- questions: NUR Staff direkt (enthaelt Loesungen). Lernende erhalten Fragen ohne 'answer' ueber Server-API.
create policy questions_staff_all on public.questions
  for all using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));

-- attempts: eigene anlegen/lesen; Bewertung serverseitig; Staff liest.
create policy attempts_own_select on public.attempts
  for select using (user_id = auth.uid());
create policy attempts_own_insert on public.attempts
  for insert with check (user_id = auth.uid() and public.member_role(tenant_id) is not null);
create policy attempts_staff_select on public.attempts
  for select using (public.is_staff(tenant_id));

-- submissions: eigene anlegen/lesen; Staff liest und bewertet.
create policy submissions_own_select on public.submissions
  for select using (user_id = auth.uid());
create policy submissions_own_insert on public.submissions
  for insert with check (user_id = auth.uid() and public.member_role(tenant_id) is not null);
create policy submissions_staff_all on public.submissions
  for all using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));

-- certificates: eigene lesen; Staff liest; Erzeugung serverseitig.
create policy certificates_own_select on public.certificates
  for select using (user_id = auth.uid());
create policy certificates_staff_select on public.certificates
  for select using (public.is_staff(tenant_id));

-- products: Mitglieder + anonyme Kaufseite lesen aktive Produkte; Staff verwaltet.
create policy products_public_select on public.products
  for select using (active = true);
create policy products_staff_all on public.products
  for all using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));

-- orders/subscriptions: eigene lesen; Staff liest; Schreiben nur service_role (Stripe-Webhooks).
create policy orders_own_select on public.orders
  for select using (user_id = auth.uid());
create policy orders_staff_select on public.orders
  for select using (public.is_staff(tenant_id));
create policy subscriptions_own_select on public.subscriptions
  for select using (user_id = auth.uid());
create policy subscriptions_staff_select on public.subscriptions
  for select using (public.is_staff(tenant_id));

-- ai_jobs: Staff liest/erzeugt (Ausfuehrung serverseitig via service_role).
create policy ai_jobs_staff_select on public.ai_jobs
  for select using (public.is_staff(tenant_id));
create policy ai_jobs_staff_insert on public.ai_jobs
  for insert with check (public.is_staff(tenant_id));

-- embeddings: Mitglieder lesen (Suche); Schreiben nur service_role.
create policy embeddings_member_select on public.embeddings
  for select using (public.member_role(tenant_id) is not null);

-- tutor: eigene Konversationen; Staff liest (Qualitaet/Eskalation).
create policy tutor_conv_own on public.tutor_conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.member_role(tenant_id) is not null);
create policy tutor_conv_staff_select on public.tutor_conversations
  for select using (public.is_staff(tenant_id));
create policy tutor_msg_own_select on public.tutor_messages
  for select using (exists (
    select 1 from public.tutor_conversations c
    where c.id = tutor_messages.conversation_id and c.user_id = auth.uid()
  ));
create policy tutor_msg_own_insert on public.tutor_messages
  for insert with check (
    role = 'user' and exists (
      select 1 from public.tutor_conversations c
      where c.id = tutor_messages.conversation_id and c.user_id = auth.uid()
    )
  );
create policy tutor_msg_staff_select on public.tutor_messages
  for select using (public.is_staff(tenant_id));

-- usage_counters: Staff liest; Schreiben nur service_role.
create policy usage_staff_select on public.usage_counters
  for select using (public.is_staff(tenant_id));

-- api_keys/webhooks: nur owner/admin.
create policy api_keys_admin_all on public.api_keys
  for all using (public.member_role(tenant_id) in ('owner','admin'))
  with check (public.member_role(tenant_id) in ('owner','admin'));
create policy webhooks_admin_all on public.webhooks
  for all using (public.member_role(tenant_id) in ('owner','admin'))
  with check (public.member_role(tenant_id) in ('owner','admin'));
create policy wh_del_admin_select on public.webhook_deliveries
  for select using (public.member_role(tenant_id) in ('owner','admin'));

-- audit_log: Staff liest; Schreiben serverseitig.
create policy audit_staff_select on public.audit_log
  for select using (public.is_staff(tenant_id));

-- -------------------------------------------------------------
-- 8. Hinweise fuer Phase 1
-- -------------------------------------------------------------
-- Storage-Buckets (per Dashboard/CLI anlegen): branding (public),
--   course-assets (public), submissions (private), certificates (private).
--   Storage-Policies: Pfad muss mit {tenant_id}/ beginnen; Schreibrechte analog RLS.
-- Anonyme Kaufseite: products_public_select erlaubt anon-Lesen aktiver Produkte;
--   Kurskatalog fuer Gaeste laeuft ueber Server-Rendering mit service_role und bewusster Filterung.
-- Semantische Suche (Phase 3): RPC-Funktion match_embeddings(tenant, course_ids, query_vector, k)
--   als security definer mit Enrollment-Pruefung.
