-- S1 (Sicherheitsaudit 27.09.2026): Lernende setzen Pruefungsergebnis und
-- Abgaben-Bewertung selbst.
--
-- Befund 1: `submit_quiz_attempt(p_quiz_id, p_answers, p_score_pct, p_passed)`
-- (20260909183521_quiz_attempt_allow_guests.sql) ist `security definer`, fuer
-- `authenticated` ausfuehrbar und schreibt Punktzahl und Bestanden-Status so,
-- wie der Aufrufer sie schickt. Ein direkter Aufruf per PostgREST
--   POST /rest/v1/rpc/submit_quiz_attempt
--   {"p_quiz_id":"…","p_answers":{},"p_score_pct":100,"p_passed":true}
-- besteht jede Pruefung, ohne dass die serverseitige Bewertung
-- (`gradeAttempt()` in src/lib/quiz/actions.ts) je laeuft.
--
-- Befund 2: Die Policy `attempts_own_insert` existiert daneben weiter
-- (0001_init.sql Zeile 511, zuletzt geaendert in 20260803100000). Sie prueft
-- nur `user_id = auth.uid() and can_participate(tenant_id)`, ohne
-- Spaltenschutz. `POST /rest/v1/attempts {"passed":true,…}` umgeht zusaetzlich
-- das Versuchslimit.
--
-- Befund 3: `submissions_insert` (20260712234600, Zeile 141) hat ebenfalls
-- keinen Spaltenschutz. Ein Lernender legt seine Abgabe gleich mit
-- status = 'approved', grade, feedback, reviewed_by an.
--
-- Loesung:
-- 1. Die RPC wird zur reinen Server-Funktion: nur `service_role`, Nutzer als
--    Parameter. Die Server Action ruft sie nach der Bewertung ueber den
--    Admin-Client auf. Ein Lernender kann sie nicht mehr erreichen.
-- 2. `attempts_own_insert` entfaellt. Der einzige Schreibweg fuer Versuche
--    ist die RPC.
-- 3. Ein `before insert`-Trigger auf `submissions` setzt die Bewertungsfelder
--    fuer Nicht-Staff auf den Ausgangszustand. Muster und Rollen-Erkennung wie
--    `tenants_operator_settings_guard()` (20260909183548).

-- =================================================================
-- 1. submit_quiz_attempt nur noch serverseitig
-- =================================================================
drop function if exists public.submit_quiz_attempt(uuid, jsonb, int, boolean);

create or replace function public.submit_quiz_attempt(
  p_quiz_id uuid,
  p_user_id uuid,
  p_answers jsonb,
  p_score_pct int,
  p_passed boolean
)
returns public.attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_attempts_allowed int;
  v_row public.attempts;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_score_pct is null or p_score_pct < 0 or p_score_pct > 100 then
    raise exception 'invalid_score';
  end if;

  select tenant_id, nullif(settings->>'attempts_allowed', '')::int
    into v_tenant_id, v_attempts_allowed
  from public.quizzes
  where id = p_quiz_id;

  if v_tenant_id is null then
    raise exception 'quiz_not_found';
  end if;

  -- Gleiche Bedeutung wie can_participate(t), aber fuer den uebergebenen
  -- Nutzer statt auth.uid() (unter service_role ist auth.uid() null):
  -- aktive Mitgliedschaft in beliebiger Rolle, Marketplace-Gast eingeschlossen.
  if not exists (
    select 1 from public.memberships m
    where m.tenant_id = v_tenant_id
      and m.user_id = p_user_id
      and m.status = 'active'
  ) then
    raise exception 'not_a_member';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_quiz_id::text || ':' || p_user_id::text));

  insert into public.attempts (tenant_id, quiz_id, user_id, started_at, submitted_at, answers, score_pct, passed)
  select v_tenant_id, p_quiz_id, p_user_id, now(), now(), p_answers, p_score_pct, p_passed
  where v_attempts_allowed is null
     or (
          select count(*) from public.attempts
          where quiz_id = p_quiz_id and user_id = p_user_id
        ) < v_attempts_allowed
  returning * into v_row;

  if v_row.id is null then
    raise exception 'attempts_limit_reached';
  end if;

  return v_row;
end;
$$;

-- Supabase vergibt EXECUTE ueber Default-Privileges explizit an anon und
-- authenticated (siehe 20260907093000); `from public` allein reicht nicht.
revoke execute on function public.submit_quiz_attempt(uuid, uuid, jsonb, int, boolean) from public;
revoke execute on function public.submit_quiz_attempt(uuid, uuid, jsonb, int, boolean) from anon;
revoke execute on function public.submit_quiz_attempt(uuid, uuid, jsonb, int, boolean) from authenticated;
grant execute on function public.submit_quiz_attempt(uuid, uuid, jsonb, int, boolean) to service_role;

-- =================================================================
-- 2. Direktes Schreiben von Versuchen fuer Lernende entziehen
-- =================================================================
drop policy if exists attempts_own_insert on public.attempts;

-- =================================================================
-- 3. Bewertungsfelder bei Abgaben schuetzen
-- =================================================================
-- BEWUSST OHNE `security definer`: die Funktion muss `current_user` sehen
-- (Begruendung wie in 20260909183548_tenants_column_guard.sql).
create or replace function public.submissions_review_fields_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if public.is_staff(new.tenant_id) then
    return new;
  end if;

  new.status := 'submitted';
  new.grade := null;
  new.feedback := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  return new;
end;
$$;

drop trigger if exists submissions_review_fields_guard on public.submissions;
create trigger submissions_review_fields_guard
  before insert on public.submissions
  for each row execute function public.submissions_review_fields_guard();
