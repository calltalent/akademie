-- Schichtplan Block S4 — Sicherheitsfund HOCH aus dem security-reviewer-
-- Durchlauf (08.08.2026), sofort behoben.
--
-- `ai_jobs_staff_select`/`ai_jobs_staff_insert` (0001_init.sql) sind
-- kind-unabhaengig ueber `is_staff(tenant_id)` gegated — das schliesst
-- `trainer` mit ein (member_role in ('owner','admin','trainer')). Fuer
-- kind='shift_plan' ist die Admin-Beschraenkung ("Projektleiter/Trainer
-- kommen an die KI-Planung nicht heran", src/lib/calendar/ai/actions.ts
-- Dateikopf) bislang AUSSCHLIESSLICH in der Next.js-Server-Action-Schicht
-- durchgesetzt (`isAdmin`-Pruefung), nicht per RLS. Ein authentifizierter
-- Nutzer mit Rolle 'trainer' konnte deshalb per direktem Supabase-Client
-- einen `shift_plan`-Auftrag anlegen (Cron-Prozess ausloesen, Rate-Limit/
-- Vorprüfung der Server-Action umgangen) oder bestehende Auftraege lesen
-- (Arbeiter-UUIDs, Datum/Zeit, KI-Freitext-Notizen).
--
-- Fix: beide Policies bleiben fuer alle anderen `kind`-Werte unveraendert
-- (`is_staff()`, deckt weiterhin course_gen/translation/tutor ab), fuer
-- kind='shift_plan' zusaetzlich `calendar_is_admin(tenant_id)` verlangt.
-- Gleiches Reparatur-Muster wie `20260807173156_shift_calendar_guard_tenant_fix.sql`/
-- `20260807222443_shift_calendar_s3_change_request_scope_fix.sql`: nur
-- betroffene Policies ersetzen, kein Schema-Wechsel.

drop policy if exists ai_jobs_staff_select on public.ai_jobs;
create policy ai_jobs_staff_select on public.ai_jobs
  for select using (
    public.is_staff(tenant_id)
    and (kind <> 'shift_plan' or public.calendar_is_admin(tenant_id))
  );

drop policy if exists ai_jobs_staff_insert on public.ai_jobs;
create policy ai_jobs_staff_insert on public.ai_jobs
  for insert with check (
    public.is_staff(tenant_id)
    and (kind <> 'shift_plan' or public.calendar_is_admin(tenant_id))
  );
