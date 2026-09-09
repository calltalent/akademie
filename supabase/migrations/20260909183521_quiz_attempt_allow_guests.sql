-- H3 (Projektanalyse 09.09.2026, Abschnitt 5.2 Position 2): Regression vom
-- 07.09.2026.
--
-- `submit_quiz_attempt()` aus 20260907091500_quiz_attempt_limit_rpc.sql prueft
-- in Zeile 65 `public.member_role(v_tenant_id) is null` und wirft sonst
-- `not_a_member`. Marketplace-Gaeste haben aber keine Rolle in
-- `memberships` -- fuer sie ist `member_role()` null, obwohl sie den Kurs
-- bezahlt haben.
--
-- Genau dafuer existiert seit dem 03.08.2026 `public.can_participate(t)`
-- (20260803100000_marketplace_guest_role.sql Zeile 97): regulaeres Mitglied
-- ODER Marketplace-Gast. Alle uebrigen Mitwirkungs-Policies (Fortschritt,
-- Abgaben, Lesezeichen, Tutor-Chat) benutzen sie bereits; die neue RPC hat
-- sie uebersehen und damit Gaeste von der Pruefungsabgabe ausgesperrt.
--
-- Wirkung heute: ein ueber den Marketplace gekaufter Kurs laesst sich lernen,
-- aber seine Pruefung nicht abschliessen. Das trifft den einzigen Kaufweg,
-- der technisch vollstaendig funktioniert.
--
-- Geaendert wird ausschliesslich diese eine Bedingung. Rechte, Signatur,
-- Sperre und Versuchszaehlung bleiben unveraendert; die Funktion wird per
-- `create or replace` vollstaendig neu geschrieben, weil Postgres keine
-- Teilaenderung eines Funktionskoerpers kennt.

create or replace function public.submit_quiz_attempt(
  p_quiz_id uuid,
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
  select tenant_id, nullif(settings->>'attempts_allowed', '')::int
    into v_tenant_id, v_attempts_allowed
  from public.quizzes
  where id = p_quiz_id;

  if v_tenant_id is null then
    raise exception 'quiz_not_found';
  end if;
  -- H3: vorher member_role(...) is null -- sperrte Marketplace-Gaeste aus.
  if not public.can_participate(v_tenant_id) then
    raise exception 'not_a_member';
  end if;

  -- Serialisiert konkurrierende Aufrufe DESSELBEN Nutzers für DASSELBE Quiz
  -- (Doppelklick/zwei Tabs) — schließt die Race auch dann, wenn zwei
  -- Transaktionen wirklich zeitgleich starten (siehe Kommentar oben).
  perform pg_advisory_xact_lock(hashtext(p_quiz_id::text || ':' || auth.uid()::text));

  insert into public.attempts (tenant_id, quiz_id, user_id, started_at, submitted_at, answers, score_pct, passed)
  select v_tenant_id, p_quiz_id, auth.uid(), now(), now(), p_answers, p_score_pct, p_passed
  where v_attempts_allowed is null
     or (
          select count(*) from public.attempts
          where quiz_id = p_quiz_id and user_id = auth.uid()
        ) < v_attempts_allowed
  returning * into v_row;

  if v_row.id is null then
    raise exception 'attempts_limit_reached';
  end if;

  return v_row;
end;
$$;

-- Rechte nach `create or replace` erneut setzen: die Ersetzung behaelt sie
-- zwar, aber 20260907093000_revoke_new_rpcs_from_anon.sql hat gezeigt, dass
-- ein stiller Rechte-Drift teuer ist. Ausdruecklich wie dort: kein `anon`.
revoke execute on function public.submit_quiz_attempt(uuid, jsonb, int, boolean) from public;
revoke execute on function public.submit_quiz_attempt(uuid, jsonb, int, boolean) from anon;
grant execute on function public.submit_quiz_attempt(uuid, jsonb, int, boolean) to authenticated, service_role;
