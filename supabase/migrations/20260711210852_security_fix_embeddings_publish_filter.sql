-- Security-Review Phase 3 (11.07.2026), HOCH-Fund #1:
-- embeddings_member_select erlaubte JEDEM Mandanten-Mitglied uneingeschränktes
-- SELECT auf ALLE embeddings-Zeilen des eigenen Mandanten, unabhängig vom
-- Veröffentlichungsstatus der zugehörigen Lektion/des Kurses. Der Anwendungs-
-- Nachfilter (search.ts/tutor/actions.ts) ließ sich damit über direkten
-- PostgREST-Zugriff (anon key + eigene Session-JWT) umgehen. Fix: Policy
-- erfordert jetzt zusätzlich, dass sowohl die referenzierte Lektion als auch
-- der referenzierte Kurs status='published' haben -- exakt das bestehende
-- Muster aus courses_member_select/lessons_member_select. Staff (is_staff)
-- behält weiterhin uneingeschränkten Zugriff (z.B. fuer Embedding-Verwaltung).

drop policy if exists embeddings_member_select on public.embeddings;

create policy embeddings_member_select on public.embeddings
for select
using (
  is_staff(tenant_id)
  or (
    member_role(tenant_id) is not null
    and exists (
      select 1
      from public.lessons l
      join public.courses c on c.id = embeddings.course_id
      where l.id = embeddings.lesson_id
        and l.status = 'published'
        and c.status = 'published'
    )
  )
);
