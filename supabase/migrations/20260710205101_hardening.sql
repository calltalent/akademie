-- Nachtraeglich lokal rekonstruiert (11.07.2026) aus dem Live-Zustand der
-- Supabase-Datenbank. Urspruenglich am 10.07.2026 (Phase 0) nur ueber
-- Supabase-MCP live angewendet, nie als lokale Datei geschrieben - siehe
-- PHASENSTATUS.md. Diese Datei bildet exakt nach, was in der DB steht.
--
-- Haertung nach Migration 0001_init: search_path der Trigger-/RLS-Helfer-
-- funktionen pinnen (verhindert search_path-Hijacking bei SECURITY DEFINER
-- Funktionen), plus EXECUTE-Rechte auf member_role/is_staff einschraenken.

alter function public.set_updated_at() set search_path = public;
alter function public.member_role(uuid) set search_path = public;
alter function public.is_staff(uuid) set search_path = public;

revoke execute on function public.member_role(uuid) from public;
revoke execute on function public.is_staff(uuid) from public;
grant execute on function public.member_role(uuid) to authenticated, service_role;
grant execute on function public.is_staff(uuid) to authenticated, service_role;
