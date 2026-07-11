-- Josips Entscheidung (11.07.2026, nach Empfehlung Cowork): eigener
-- source-Wert 'api' statt der bisherigen, technisch erzwungenen Abweichung
-- 'manual' bei API-erzeugten Einschreibungen (POST /api/v1/enrollments,
-- Phase 3 Block 7) -- ermöglicht saubere Unterscheidung zwischen
-- Staff-Admin-UI-Einträgen und externen Integrationen im Reporting/Audit.
-- 0001_init.sql wird NICHT editiert (CLAUDE.md §4) -- Constraint hier per
-- ALTER erweitert.

alter table public.enrollments drop constraint enrollments_source_check;

alter table public.enrollments
  add constraint enrollments_source_check
  check (source in ('manual', 'purchase', 'import', 'api'));
