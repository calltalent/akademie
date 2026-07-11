-- Phase 3, Block 6 (Auto-Transkript + Kapitel + Zusammenfassung).
-- lessons.video_bunny_id/video_duration_s/transcript/summary existieren
-- bereits seit 0001_init.sql (Zeilen 118-121) - nur "chapters" fehlt noch.
alter table public.lessons
  add column chapters jsonb not null default '[]'::jsonb;

-- RLS-Hinweis (CLAUDE.md §3.3: "Jede neue Tabelle oder Spalte: eigene
-- Migration mit RLS im selben Schritt"): kein neues Grant/keine neue Policy
-- nötig. RLS auf public.lessons ist tabellenweit über tenant_id gesteuert
-- (Policies lessons_member_select/lessons_staff_write, 0001_init.sql Zeilen
-- 478-486) - eine neue Spalte fällt automatisch unter diese bestehenden
-- Policies, es gibt keine spaltenspezifische RLS in Postgres. Geprüft und
-- bestätigt: kein Ausnahmefall, keine zusätzliche Policy erforderlich.
