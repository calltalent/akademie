-- Admin-verwaltbare "Positionen" in der rechten Spalte der Kurs-/Modulansicht
-- (Josips Auftrag, 24.07.2026: "eine Sektion hinzufügen unter der Link-
-- Bearbeitung, in welcher ich auch die Positionen auf der rechten Seite
-- hinzufügen, bearbeiten und anpassen kann"). Ersetzt die bisher fest im
-- Code verdrahteten Kärtchen ("Kostenloses Erstgespräch buchen"/"Nutze die
-- Calltalent-App") in kurs/[slug]/page.tsx und kurs/[slug]/m/[moduleId]/
-- page.tsx. Gleiches RLS-Muster wie sidebar_links (20260723090000): jedes
-- Mitglied darf lesen (die Positionen erscheinen in JEDER Lernansicht des
-- Mandanten), schreiben dürfen nur owner/admin — /admin/einstellungen ist
-- ohnehin schon auf dieser Stufe gegatet (checkAdminAccess()).
create table public.promo_cards (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  title          text not null,
  description    text,
  media_kind     text not null check (media_kind in ('image', 'video')),
  image_url      text,  -- Supabase Storage (course-assets), wenn media_kind = 'image'
  bunny_video_id text,  -- Bunny Stream, wenn media_kind = 'video' (CLAUDE.md: nie Video in Supabase Storage)
  link_url       text,  -- optional; relativer Pfad ("/kontakt") ODER absolute http(s)-URL
  position       int  not null default 0,
  created_at     timestamptz not null default now()
);
create index promo_cards_tenant_idx on public.promo_cards (tenant_id);

alter table public.promo_cards enable row level security;

create policy promo_cards_member_select on public.promo_cards
  for select using (public.member_role(tenant_id) is not null);

create policy promo_cards_admin_write on public.promo_cards
  for all using (public.member_role(tenant_id) in ('owner', 'admin'))
  with check (public.member_role(tenant_id) in ('owner', 'admin'));

-- Bestandsschutz: die beiden bisher fest verdrahteten Kärtchen als echte,
-- editierbare Zeilen für JEDEN bestehenden Mandanten anlegen — kein
-- Funktionsverlust beim Umschalten von statischem Code auf diese Tabelle.
insert into public.promo_cards (tenant_id, title, description, media_kind, link_url, position)
select id, 'Kostenloses Erstgespräch buchen', 'Individuelle Beratung für deinen Lernweg.', 'image', '/kontakt', 0
from public.tenants;

insert into public.promo_cards (tenant_id, title, description, media_kind, position)
select id, 'Nutze die Calltalent-App', 'Lerne unterwegs — jederzeit und überall.', 'image', 1
from public.tenants;
