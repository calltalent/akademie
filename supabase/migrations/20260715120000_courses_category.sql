-- Kategorie-Feld für den Kurskatalog-Filter (Folgeauftrag „Kurskatalog nach
-- Kurskatalog.dc.html"). Die Filter-Chips (Vertrieb/Telefonie/Abschluss/
-- Mindset) hatten bisher keine Datenquelle — `courses` bekommt dafür eine
-- optionale, freie Text-Kategorie. Nullable, ohne Check-Constraint, damit
-- Mandanten später eigene Kategorien nutzen können; der Katalog zeigt aktuell
-- die vier Standard-Chips. Kurse ohne Kategorie erscheinen nur unter „Alle
-- Kurse". Additiv, keine Datenmigration nötig.
alter table public.courses add column if not exists category text;
