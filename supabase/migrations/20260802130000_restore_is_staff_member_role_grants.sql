-- Incident-Fix (02.08.2026, Josips Fund: kompletter Admin-Bereich fuer ALLE
-- Mandanten unerreichbar, "Kein Zugriff" trotz korrekter owner-Mitgliedschaft
-- in public.memberships).
--
-- Ursache: public.member_role(uuid) und public.is_staff(uuid) hatten auf der
-- Live-DB KEIN EXECUTE-Recht mehr fuer die Rolle "authenticated" (nur noch
-- service_role). Beide Funktionen laufen ohne SECURITY DEFINER (siehe
-- 0001_init.sql) und werden vom Client per supabase.rpc() als eingeloggter
-- Nutzer aufgerufen (src/lib/auth/staff.ts) -- ohne EXECUTE schlaegt der
-- RPC-Aufruf mit Permission-Denied fehl, was der Code (ungeprueftes `data`)
-- still als "kein Staff/keine Rolle" interpretiert.
--
-- 20260710205101_hardening.sql hatte das Recht urspruenglich korrekt gesetzt
-- (grant ... to authenticated, service_role) -- auf der Live-DB war es zum
-- Zeitpunkt dieses Fixes trotzdem weg, vermutlich durch einen manuellen
-- Dashboard-Eingriff im Rahmen der heutigen Security-Advisor-Bereinigung
-- (gleiches Drift-Muster wie bei rate_limits, siehe
-- 20260802120000_rate_limits_drop_permissive_policies.sql). Stellt exakt den
-- in hardening.sql dokumentierten Soll-Zustand wieder her.

grant execute on function public.member_role(uuid) to authenticated, service_role;
grant execute on function public.is_staff(uuid) to authenticated, service_role;
