-- Builder-Auftrag 07.09.2026 (tester-Fund, siehe PHASENSTATUS.md):
-- src/lib/quiz/actions.ts `submitAttempt()` zählte bisherige Versuche
-- (`select count(*) from attempts where quiz_id = ... and user_id = ...`)
-- und schrieb den neuen Versuch (`insert into attempts ...`) als ZWEI
-- getrennte Anfragen ohne Sperre. `attempts` hat keinen Unique-Index auf
-- (quiz_id, user_id, ...) (0001_init.sql).
--
-- Fehlerszenario: Prüfung mit `attempts_allowed = 1`. Der Lernende sendet
-- dasselbe Formular zweimal fast gleichzeitig (Doppelklick/zwei Tabs). Beide
-- Aufrufe lesen `count = 0`, beide bestehen die Limit-Prüfung, beide
-- schreiben eine `attempts`-Zeile — zwei Versuche trotz Limit 1, und das
-- bessere Ergebnis zählt (Race Condition, klassisches TOCTOU).
--
-- Fix: Zählung und Insert in EINER Datenbankanweisung/Transaktion
-- zusammengezogen — exakt das im Auftrag vorgeschlagene Muster
-- `insert ... select ... where (select count(*) ...) < limit`, ergänzt um
-- eine Session-Advisory-Lock (`pg_advisory_xact_lock`) auf (quiz_id, user_id):
-- ein `insert...select` allein schließt die Race unter Standard-
-- Isolationslevel (READ COMMITTED) nicht zuverlässig, wenn zwei
-- Transaktionen wirklich gleichzeitig starten (die COUNT-Subquery liest
-- dann in beiden Transaktionen denselben, noch nicht committeten Stand) —
-- die Lock-Zeile serialisiert konkurrierende Aufrufe DESSELBEN Nutzers für
-- DASSELBE Quiz, ohne andere Nutzer/Quizze zu blockieren. `pg_advisory_xact_lock`
-- gibt die Sperre automatisch beim Transaktionsende frei (Funktionsende).
--
-- `security definer`: Mitgliedschaft/Mandant werden HIER erneut aus der DB
-- abgeleitet (`quizzes.tenant_id`, `member_role()`), NIE aus Client-Eingaben
-- — `user_id` kommt ausschließlich aus `auth.uid()` (der echten JWT-Identität
-- des Aufrufers, funktioniert unter `security definer` genau wie unter
-- normalen RLS-Policies), niemals als Parameter vom Client. `pass_pct`/Fragen-
-- Auswertung bleiben unverändert Aufgabe von `gradeAttempt()` im Anwendungs-
-- code (Server Action) — diese Funktion bekommt `score_pct`/`passed` bereits
-- fertig berechnet übergeben und vertraut nur der eigenen, serverseitig
-- ermittelten Limit-Prüfung.
--
-- ANGEWENDET WIRD DIESE MIGRATION NICHT VON MIR — das bleibt Josips
-- Entscheidung (siehe Auftrag). Der Anwendungscode in
-- src/lib/quiz/actions.ts ruft diese RPC bereits auf; bis zur Anwendung
-- schlägt `submitAttempt()` fehl (siehe PHASENSTATUS.md-Hinweis).

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
  if public.member_role(v_tenant_id) is null then
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

revoke execute on function public.submit_quiz_attempt(uuid, jsonb, int, boolean) from public;
grant execute on function public.submit_quiz_attempt(uuid, jsonb, int, boolean) to authenticated, service_role;
