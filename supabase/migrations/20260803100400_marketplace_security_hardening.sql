-- Marketplace M1, Nachschärfung nach security-reviewer-Lauf (03.08.2026,
-- Plan "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt 10, Block M1).
-- Behebt zwei HOCH- und einen MITTEL-Fund aus der M1-Prüfung der vier
-- vorangegangenen Migrationen. Reihenfolge wichtig: läuft nach
-- 20260803100000/100100/100200/100300.

-- -------------------------------------------------------------
-- HOCH-Fund 1: embeddings_guest_select prüfte nur courses.status='published',
-- nicht zusätzlich lessons.status='published' — exakt die Lücke, die
-- 20260711210852_security_fix_embeddings_publish_filter.sql für die
-- member-Variante bereits geschlossen hat, hier aber nicht übernommen wurde.
-- Ein Marketplace-Gast konnte damit Roh-Text-Chunks einer noch
-- unveröffentlichten Lektion innerhalb seines eigenen, gekauften Kurses
-- lesen. Fix: gleicher Join wie in der member-Policy, zusätzlich
-- has_enrollment() (Gast-spezifisch, member-Policy braucht das nicht).
-- -------------------------------------------------------------
drop policy if exists embeddings_guest_select on public.embeddings;

create policy embeddings_guest_select on public.embeddings
  for select using (
    public.is_marketplace_guest(tenant_id)
    and public.has_enrollment(embeddings.course_id)
    and exists (
      select 1
      from public.lessons l
      join public.courses c on c.id = embeddings.course_id
      where l.id = embeddings.lesson_id
        and l.status = 'published'
        and c.status = 'published'
    )
  );

-- -------------------------------------------------------------
-- MITTEL-Fund: has_enrollment() ignorierte enrollments.expires_at — eine
-- abgelaufene Einschreibung zählte weiterhin als gültig für JEDE
-- Gast-Policy, die has_enrollment() nutzt (courses/modules/sections/lessons/
-- quizzes/embeddings). Fix: nur nicht abgelaufene Einschreibungen zählen.
-- -------------------------------------------------------------
create or replace function public.has_enrollment(c uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.enrollments e
    where e.course_id = c and e.user_id = auth.uid()
      and (e.expires_at is null or e.expires_at > now())
  );
$$;

-- -------------------------------------------------------------
-- HOCH-Fund 2: ml_staff_insert/ml_staff_update prüften nirgends, dass
-- course_id tatsächlich zum eigenen tenant_id gehört. Staff von Mandant A
-- konnte damit ein Listing mit course_id von Mandant B anlegen — wegen
-- unique(course_id) auf marketplace_listings blockierte das Mandant B
-- dauerhaft davor, den eigenen Kurs je zu listen (Cross-Tenant-Griefing über
-- eine Schreib-Policy). Fix: with-check erzwingt zusätzlich, dass course_id
-- zu tenant_id gehört (gleiches Muster wie is_staff(tenant_id) — Prüfung
-- direkt in der Policy, kein Trigger nötig).
-- -------------------------------------------------------------
drop policy if exists ml_staff_insert on public.marketplace_listings;
drop policy if exists ml_staff_update on public.marketplace_listings;

create policy ml_staff_insert on public.marketplace_listings
  for insert with check (
    public.is_staff(tenant_id)
    and status in ('draft','submitted')
    and exists (
      select 1 from public.courses c
      where c.id = marketplace_listings.course_id and c.tenant_id = marketplace_listings.tenant_id
    )
  );

create policy ml_staff_update on public.marketplace_listings
  for update using (public.is_staff(tenant_id))
  with check (
    public.is_staff(tenant_id)
    and status in ('draft','submitted')
    and exists (
      select 1 from public.courses c
      where c.id = marketplace_listings.course_id and c.tenant_id = marketplace_listings.tenant_id
    )
  );

-- -------------------------------------------------------------
-- MITTEL-Fund (kein Schema-Fix, nur Festlegung für M5): marketplace_listings.
-- product_id steht bewusst weiter auf "on delete set null" (konsistent mit
-- orders.product_id/subscriptions.product_id in 0001_init.sql, kein neues
-- Muster). Würde ein bezahltes Produkt gelöscht, während ein Listing noch
-- darauf verweist, wird product_id null — der Gratis-Erwerbspfad in M5
-- (src/lib/marketplace/acquire.ts) darf sich deshalb NICHT allein auf
-- "product_id is null" verlassen, um kostenlos vs. kostenpflichtig zu
-- unterscheiden, sondern muss zusätzlich price_cents = 0 prüfen (price_cents
-- ändert sich nie durch eine Produktlöschung). Diese Regel ist verbindlich
-- für die M5-Umsetzung, siehe PHASENSTATUS.md, Block "Marketplace M1".
-- -------------------------------------------------------------
