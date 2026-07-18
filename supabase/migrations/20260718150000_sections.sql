-- Sektionen als neue Zwischenebene Modul -> Sektion -> Lektion (Josips
-- Auftrag, 18.07.2026). Der Design-Export "Modul.dc.html" gruppierte
-- Lektionen bereits in Sektionen; der damalige Umsetzungskommentar
-- (src/app/(learn)/kurs/[slug]/m/[moduleId]/page.tsx) hielt fest, dass es
-- dieses Level im Schema noch nicht gab ("keine Fantasie-Sektionen
-- erfinden") — das wird hier nachgeholt.
--
-- BEWUSST ADDITIV, NICHT ersetzend: `lessons.module_id` bleibt unverändert
-- die tenant-/mandantenscopende Pflicht-Fremdschlüssel-Spalte (18 Dateien
-- lesen/schreiben sie: KI-Generator, CSV-Import, Reporting, Embeddings/
-- Suche, Zertifikate, Fortschritt, Lesezeichen, Abgaben — ein Ersetzen durch
-- section_id hätte all das anfassen müssen, ohne fachlichen Zusatznutzen).
-- Neu ist ausschließlich `lessons.section_id` — NULLABLE, `on delete set
-- null`: eine Lektion OHNE Sektion bleibt gültig und weiterhin über ihr
-- Modul auffindbar (kein Datenverlust, keine Zwangsmigration bestehender
-- Lektionen nötig). Der Editor/die Lernansicht gruppieren Lektionen mit
-- gesetzter section_id unter ihrer Sektion, alle anderen lose unter dem
-- Modul selbst.

create table public.sections (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  title     text not null,
  position  int  not null default 0
);
create index sections_module_idx on public.sections (module_id);
create index sections_tenant_idx on public.sections (tenant_id);

alter table public.lessons
  add column section_id uuid references public.sections(id) on delete set null;
create index lessons_section_idx on public.lessons (section_id);

alter table public.sections enable row level security;

-- Exakt dasselbe Muster wie modules_member_select/modules_staff_write
-- (0001_init.sql Zeilen 473-476): Mitglieder lesen, Staff verwaltet
-- mandantenweit.
create policy sections_member_select on public.sections
  for select using (public.member_role(tenant_id) is not null);
create policy sections_staff_write on public.sections
  for all using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));
