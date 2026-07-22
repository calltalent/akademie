-- Kurskategorien werden mandantenfähig (Josips Auftrag, 22.07.2026: "unter
-- Kurse im Admin-Bereich Kategorien hinzufügen, bearbeiten, löschen können").
-- Bisher war die Kategorie-Liste ein globaler, fest codierter TypeScript-
-- Const (COURSE_CATEGORIES), gemeinsam für alle Mandanten. Die ursprüngliche
-- Migration 20260715120000_courses_category.sql hat courses.category bewusst
-- OHNE Check-Constraint angelegt, mit dem Kommentar "damit Mandanten später
-- eigene Kategorien nutzen können" — das wird hier eingelöst.
--
-- Eine echte Tabelle statt weiterhin freiem Text: `courses` referenziert die
-- Kategorie über eine ID. Umbenennen ändert dadurch nur die eine Zeile hier
-- (kein Text-Abgleich über alle Kurse nötig), Löschen setzt betroffene Kurse
-- automatisch auf "keine Kategorie" zurück (on delete set null) — exakt das
-- Muster, das sections.sql schon für lessons.section_id nutzt.
--
-- normalizeCategory() (src/lib/courses/actions.ts) garantierte bisher, dass
-- jeder courses.category-Wert einer der vier Standardnamen ist — die
-- Rückmigration unten kann sich deshalb gefahrlos darauf verlassen.

create table public.course_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  position   int  not null default 0,
  unique (tenant_id, name)
);
create index course_categories_tenant_idx on public.course_categories (tenant_id);

alter table public.course_categories enable row level security;

-- Exakt dasselbe Muster wie sections_member_select/sections_staff_write
-- (20260718150000_sections.sql): Mitglieder lesen, Staff verwaltet
-- mandantenweit.
create policy course_categories_member_select on public.course_categories
  for select using (public.member_role(tenant_id) is not null);
create policy course_categories_staff_write on public.course_categories
  for all using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));

-- Backfill: die vier bisherigen Standardkategorien für jeden bestehenden
-- Mandanten anlegen, damit sich beim Umstieg an der sichtbaren Auswahl
-- zunächst nichts ändert.
insert into public.course_categories (tenant_id, name, position)
select t.id, cat.name, cat.ord
from public.tenants t
cross join (values ('Vertrieb', 0), ('Telefonie', 1), ('Abschluss', 2), ('Mindset', 3)) as cat(name, ord)
on conflict (tenant_id, name) do nothing;

alter table public.courses add column category_id uuid references public.course_categories(id) on delete set null;

update public.courses c
set category_id = cc.id
from public.course_categories cc
where cc.tenant_id = c.tenant_id and cc.name = c.category;

alter table public.courses drop column category;
