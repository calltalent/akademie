-- Josips Auftrag (23.07.2026): Modul-/Sektions-Karten sollen wie im
-- LearningSuite-Referenzbeispiel eine kurze Beschreibung unter der
-- Überschrift zeigen koennen (eigenstaendige Umsetzung, kein uebernommener
-- Text/Assets, siehe CLAUDE.md 3.1). Beide Spalten nullable/optional -
-- bestehende Module/Sektionen bleiben unveraendert ohne Beschreibung.

alter table public.modules add column description text;
alter table public.sections add column description text;
