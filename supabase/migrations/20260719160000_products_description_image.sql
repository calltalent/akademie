-- Josips Auftrag (19.07.2026): neue /admin/produkte-Unterseite erlaubt jetzt
-- auch das Bearbeiten von "Texten und Bildern" der Kaufseite
-- (/kaufen/[productSlug]) — bisher rein aus title/kind/price/course_ids
-- abgeleitet, kein eigenes Inhaltsfeld. Gleiches Muster wie
-- 20260719090000_modules_cover_url.sql (nullable, additiv, kein Backfill
-- nötig).
alter table public.products add column description text;
alter table public.products add column image_url text;
