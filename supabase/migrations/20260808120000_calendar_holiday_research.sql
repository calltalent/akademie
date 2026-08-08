-- "Schichtplan" Block S5a — Vorbereitung fuer die KI-Feiertagsrecherche
-- (Josips Auftrag, architect-Plan "plane-und-erstelle-mit-floofy-curry-
-- agent-a2931f285e454e395.md" Abschnitt 7). Diese Migration wird laut
-- Bauplan in Block S5a NUR GESCHRIEBEN, nicht angewendet — der Dateiname
-- traegt einen Platzhalter-Zeitstempel und wird beim tatsaechlichen
-- Anwenden (Block S5b) auf den echten Anwendezeitpunkt umbenannt, gleiches
-- Vorgehen wie bei allen bisherigen Schichtplan-Migrationen dieses Projekts.
--
-- Kein neues Schema: keine neue Tabelle, keine neue Spalte, kein neuer
-- Index, kein neuer Fremdschluessel. Nur ein neuer `ai_jobs.kind`-Wert
-- und eine RLS-Verengung auf zwei bereits bestehenden Policies.

-- ---------------------------------------------------------------------
-- 1) CHECK-Constraint: `ai_jobs.kind` um 'holiday_research' erweitern.
-- Gleiches Muster wie 20260717120000_ai_jobs_kind_translation.sql und
-- Abschnitt 9 von 20260807142619_shift_calendar.sql (drop + add mit der
-- vollstaendigen, um einen Wert erweiterten Liste).
-- ---------------------------------------------------------------------

alter table public.ai_jobs drop constraint if exists ai_jobs_kind_check;
alter table public.ai_jobs add constraint ai_jobs_kind_check
  check (kind in (
    'course_gen', 'quiz_gen', 'transcript', 'summary', 'embed',
    'translation', 'shift_plan', 'holiday_research'
  ));

-- ---------------------------------------------------------------------
-- 2) RLS-Verengung: `ai_jobs_staff_select`/`ai_jobs_staff_insert`
-- (zuletzt verengt fuer kind='shift_plan' in
-- 20260808061159_shift_calendar_s4_ai_jobs_scope_fix.sql) zusaetzlich fuer
-- kind='holiday_research' auf `calendar_is_admin(tenant_id)` verengen.
--
-- Begruendung — AUSDRUECKLICH Kostenkontrolle, NICHT Geheimhaltung:
-- Ein Feiertag ist eine oeffentlich bekannte Rechtstatsache. Weder
-- `ai_jobs.input` (`{year, regions}`) noch `ai_jobs.output` (Datum, Name,
-- Regionscode) dieses `kind`-Werts enthalten Beschaeftigtendaten — ein
-- `trainer`, der diese Zeilen laese, erfuehre nichts, was nicht in jedem
-- Kalender oeffentlich nachzulesen ist. Aus reiner Vertraulichkeitssicht
-- waere die generische `is_staff()`-Policy also ausreichend.
--
-- Kritisch ist stattdessen die Kostenseite: ein INSERT mit diesem `kind`
-- loest beim naechsten Cron-Tick (`/api/admin/ki/process`) einen
-- kostenpflichtigen Claude-Aufruf aus und verbraucht eine Einheit des
-- geteilten `course_gen`-Kontingents. Ueber den direkten Supabase-Client
-- wuerde ein `trainer` dabei sowohl das Rate-Limit der Server Action
-- (3 Laeufe/Tag) als auch deren serverseitige Regionsaufloesung umgehen
-- und koennte in wenigen Sekunden das Monatskontingent eines
-- Trial-Mandanten leeren. Die Verengung schliesst diesen
-- Kosten-Missbrauchspfad und haelt die Regel einfach merkbar: "jeder
-- Kalender-`kind` in `ai_jobs` ist Admin-only" statt einer wachsenden
-- Ausnahmeliste, die ein spaeterer Leser neu herleiten muesste.
-- ---------------------------------------------------------------------

drop policy if exists ai_jobs_staff_select on public.ai_jobs;
create policy ai_jobs_staff_select on public.ai_jobs
  for select using (
    public.is_staff(tenant_id)
    and (kind not in ('shift_plan', 'holiday_research') or public.calendar_is_admin(tenant_id))
  );

drop policy if exists ai_jobs_staff_insert on public.ai_jobs;
create policy ai_jobs_staff_insert on public.ai_jobs
  for insert with check (
    public.is_staff(tenant_id)
    and (kind not in ('shift_plan', 'holiday_research') or public.calendar_is_admin(tenant_id))
  );
