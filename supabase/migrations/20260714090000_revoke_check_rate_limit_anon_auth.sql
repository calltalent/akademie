-- Security-Advisor: public.check_rate_limit (SECURITY DEFINER) war fuer anon
-- UND authenticated per /rest/v1/rpc/check_rate_limit aufrufbar. Ein Angreifer
-- haette mit frei waehlbarem p_key (z. B. "login:<Opfer-IP>") den Zaehler eines
-- fremden Schluessels hochtreiben und so gezielt Login-/API-Anfragen fremder
-- Nutzer aussperren koennen (DoS), bzw. eigene Schluessel-Limits ausprobieren.
--
-- Fix (14.07.2026): rate-limit.ts ruft den Limiter jetzt ueber den Admin-Client
-- (service_role) auf -> anon/authenticated brauchen KEIN EXECUTE mehr. Muster
-- identisch zu 20260711164931_ai_rpc_revoke_anon_authenticated.sql.
--
-- REIHENFOLGE WICHTIG: Erst NACH dem Deploy der rate-limit.ts-Aenderung
-- anwenden. Vorher wuerde der Limiter fail-open laufen (kein Ausfall, aber
-- bis zum Deploy kein Rate-Limit). service_role/postgres behalten EXECUTE.

revoke execute on function public.check_rate_limit(text, integer, integer) from anon, authenticated;
