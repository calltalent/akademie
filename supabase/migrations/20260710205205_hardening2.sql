-- Nachtraeglich lokal rekonstruiert (11.07.2026) aus dem Live-Zustand der
-- Supabase-Datenbank. Urspruenglich am 10.07.2026 (Phase 0) nur ueber
-- Supabase-MCP live angewendet, nie als lokale Datei geschrieben - siehe
-- PHASENSTATUS.md.
--
-- pgvector-Extension aus dem public-Schema in ein dediziertes extensions-
-- Schema verschoben (Supabase-Empfehlung: Extensions nicht in public, um
-- Namespace-Kollisionen und ungewollte Sichtbarkeit ueber die REST-API zu
-- vermeiden).
create schema if not exists extensions;
alter extension vector set schema extensions;
