-- Nachtrag zu 20260907090000 und 20260907091500 (07.09.2026):
-- `revoke execute ... from public` entfernt NICHT das EXECUTE-Recht der Rolle
-- `anon`. Supabase vergibt es ueber `alter default privileges` als eigenen,
-- expliziten Grant an anon und authenticated; die PUBLIC-Pseudorolle ist davon
-- unabhaengig. Die Pruefung gegen die Live-Datenbank zeigte nach dem Anwenden
-- der beiden Migrationen entsprechend `anon=EXECUTE` auf allen vier neuen
-- Funktionen.
--
-- Praktisch war kein Zugriff moeglich (auth.uid() ist bei anon null, damit
-- liefert member_role() null und is_staff() false, beide Funktionen brechen
-- mit einer Exception ab), aber es weicht vom Haertungsstandard des Projekts
-- ab, siehe 20260714090000_revoke_check_rate_limit_anon_auth.sql.
--
-- authenticated behaelt EXECUTE: Lernende rufen submit_quiz_attempt() und
-- Staff die drei swap_*-Funktionen ueber PostgREST auf.
--
-- Angewendet auf Projekt vklqksdiyiijzoirntyt am 07.09.2026, Ergebnis per
-- information_schema.routine_privileges gegengeprueft: anon ist auf allen
-- vier Funktionen entfernt.

revoke execute on function public.submit_quiz_attempt(uuid, jsonb, int, boolean) from anon;
revoke execute on function public.swap_module_positions(uuid, uuid, uuid) from anon;
revoke execute on function public.swap_section_positions(uuid, uuid, uuid) from anon;
revoke execute on function public.swap_question_positions(uuid, uuid, uuid) from anon;
