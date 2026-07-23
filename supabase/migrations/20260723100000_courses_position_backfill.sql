-- Backfill fuer courses.position (Josips Auftrag, 23.07.2026: Kursreihenfolge
-- per Auf/Ab selbst korrigieren koennen). createCourse() (src/lib/courses/
-- actions.ts) hat beim Anlegen nie einen position-Wert gesetzt -- jeder
-- bestehende Kurs steht auf dem Spalten-Default 0 (0001_init.sql:92). Ein
-- Swap-Reorder zwischen zwei Kursen, die beide auf 0 stehen, würde nichts
-- bewirken. Reihenfolge nach created_at (deterministisch) -- ändert die
-- heute sichtbare Reihenfolge nicht, gibt nur jedem Kurs einen eigenen Wert.
with ranked as (
  select id, row_number() over (partition by tenant_id order by created_at, id) - 1 as new_position
  from public.courses
)
update public.courses c
set position = ranked.new_position
from ranked
where ranked.id = c.id;
