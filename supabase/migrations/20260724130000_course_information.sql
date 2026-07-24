-- Informations-Tab für Kurse, nach Baulig-Vorbild (Josips Auftrag,
-- 24.07.2026: Baulig Akademie zeigt in der Kursübersicht einen dritten Tab
-- "Information" mit Beschreibung, Kursziele (Checkmark-Liste) und Autoren
-- (Bild, Name, Rolle, Bio) — bei Calltalent bisher bewusst weggelassen, weil
-- er auf keine echten Daten zeigte (Kopfkommentar in kurs/[slug]/page.tsx:
-- "keine toten Links"). Kursbeschreibung existiert bereits seit 23.07.2026;
-- dieser Auftrag ist die konsequente Fortsetzung: Kursziele + Autor
-- ergänzen, echten Tab verlinken.
--
-- `trainers`: wiederverwendbares Trainer-/Ansprechperson-Profil (Bild + Name
-- + optional Rolle/Bio), verwaltet unter Admin -> Einstellungen, im
-- Kurs-Editor pro Kurs auswählbar — NICHT der Mandanten-Logo/Firmenname.
-- Gleiches RLS-Muster wie `promo_cards` (Migration
-- 20260724120000_promo_cards.sql): jedes Mitglied darf lesen (Autorenprofile
-- erscheinen im Information-Tab jeder Lernansicht des Mandanten), schreiben
-- dürfen nur owner/admin — /admin/einstellungen ist ohnehin schon auf dieser
-- Stufe gegatet (checkAdminAccess()).
create table public.trainers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  role       text,
  bio        text,
  image_url  text,
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index trainers_tenant_idx on public.trainers (tenant_id);

alter table public.trainers enable row level security;

create policy trainers_member_select on public.trainers
  for select using (public.member_role(tenant_id) is not null);

create policy trainers_admin_write on public.trainers
  for all using (public.member_role(tenant_id) in ('owner', 'admin'))
  with check (public.member_role(tenant_id) in ('owner', 'admin'));

-- `courses.author_id`: optionale Verknüpfung auf ein Trainerprofil (Autor des
-- Kurses im Information-Tab). `on delete set null` — ein gelöschtes
-- Trainerprofil reißt keinen Kurs mit, der Kurs zeigt danach nur wieder den
-- ehrlichen Leerzustand "Noch keine Autoreninfo hinterlegt.".
alter table public.courses add column author_id uuid references public.trainers(id) on delete set null;

-- `courses.goals`: Kursziele als Checkmark-Liste (Information-Tab), einfache
-- Text-Array-Ablage als jsonb — gleiches Prinzip wie `lessons.blocks`, hier
-- aber nur ein Array von Strings (zod-validiert in courseSchema, keine
-- eigene Tabelle nötig, da Kursziele keine eigene Identität/Reihenfolge über
-- den Kurs hinaus brauchen).
alter table public.courses add column goals jsonb not null default '[]'::jsonb;
