-- Security-Fix (Advisor 02.08.2026): public.rate_limits hatte auf der Live-DB
-- vier RLS-Policies (rate_limits_select/insert/update/no_access), die in
-- keiner Migration im Repo existieren - vermutlich direkt im Dashboard
-- angelegt. rate_limits_select/insert/update erlaubten der Rolle
-- "authenticated" mit USING(true)/WITH CHECK(true) vollen Lese-/Schreib-
-- zugriff auf ALLE Zeilen der Tabelle per PostgREST, unabhaengig vom
-- eigentlichen Limiter-RPC. Damit haette jede eingeloggte Nutzerin fremde
-- Rate-Limit-Zaehler auslesen oder hochtreiben koennen (DoS, siehe bereits
-- 20260714090000_revoke_check_rate_limit_anon_auth.sql).
--
-- check_rate_limit() ist SECURITY DEFINER mit Owner "postgres"
-- (rolbypassrls = true) und funktioniert daher unabhaengig von RLS auf
-- rate_limits weiter. Nach dem Entfernen der Policies bleibt RLS aktiv,
-- aber ohne Policy fuer anon/authenticated -> Default-Deny, exakt die in
-- 20260710235500_rate_limits.sql beschriebene Absicht ("Nur service_role
-- darf lesen/schreiben"). service_role/postgres umgehen RLS ohnehin.

drop policy if exists rate_limits_select on public.rate_limits;
drop policy if exists rate_limits_insert on public.rate_limits;
drop policy if exists rate_limits_update on public.rate_limits;
drop policy if exists rate_limits_no_access on public.rate_limits;
