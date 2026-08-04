-- Marketplace M1 (Plan Abschnitt 1.4, 03.08.2026): Herkunft von Einschreibung
-- und Mitgliedschaft um 'marketplace' erweitern. Gleiches Vorgehen wie beim
-- Vorbild 20260711223000_enrollments_source_add_api.sql (dort 'api' ergaenzt,
-- 0001_init.sql bewusst NICHT editiert, Constraint per ALTER erweitert,
-- CLAUDE.md §4).
--
-- `memberships.source` unterscheidet fuer Mandanten-Admins "eigener
-- Mitarbeiter" (invite/import) von "Marketplace-Kaeufer" (marketplace).
-- Zusammen mit `role='guest'` (20260803100000_marketplace_guest_role.sql)
-- doppelt eindeutig: `role` steuert die Rechte (RLS), `source` nur die
-- Herkunft (Reporting/Admin-UI) — keine der beiden Spalten ersetzt die
-- andere.

alter table public.enrollments drop constraint enrollments_source_check;

alter table public.enrollments
  add constraint enrollments_source_check
  check (source in ('manual', 'purchase', 'import', 'api', 'marketplace'));

alter table public.memberships add column source text not null default 'invite'
  check (source in ('invite', 'import', 'marketplace'));
