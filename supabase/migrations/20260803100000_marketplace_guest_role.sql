-- Marketplace M1, Sicherheitskern (Josips Auftrag, Plan
-- "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt 0 + 1.1, 03.08.2026).
--
-- Der Fund, der diese Migration erzwingt: `lessons_member_select` und
-- identisch `courses_member_select`, `modules_member_select` (heute
-- `modules_select`), `quizzes_member_select` (heute `quizzes_select`),
-- `sections_member_select`, `embeddings_member_select` pruefen fuer den
-- Lesezugriff auf veroeffentlichte Inhalte NUR `member_role(tenant_id) is
-- not null` — es gibt KEINE Einschreibungspruefung, weder in RLS noch in der
-- Anwendungsschicht. Wuerde ein Marketplace-Kaeufer beim Verkaeufer-Mandanten
-- einfach als gewoehnliches `member` angelegt, koennte er fuer den Preis
-- eines einzelnen Kurses den kompletten veroeffentlichten Kursbestand dieses
-- Mandanten lesen — der Normalfall des Features, kein Randfall.
--
-- Loesung: eine neue Rolle `guest`, die `public.member_role()` bewusst NICHT
-- zurueckgibt. Eine einzige Funktionsaenderung schliesst damit alle
-- bestehenden `member_role(...) is not null`-Policies fuer Gaeste
-- automatisch (siehe unten, Abschnitt b) — statt jede der rund 30
-- Fundstellen einzeln umzubauen. Fuer Bestandsmandanten aendert sich nichts,
-- solange keine `guest`-Zeile existiert.
--
-- Vorbilder in diesem Repo fuer die einzelnen Bausteine:
--   - Gleiche Fundklasse wie der behobene embeddings-Leck
--     (20260711210852_security_fix_embeddings_publish_filter.sql) und der
--     products-Leck (20260710233735_security_hardening_storage_listing_and_
--     products.sql): Policies, die weniger pruefen als die Anwendung
--     stillschweigend voraussetzt.
--   - EXECUTE-Grants auf neue SECURITY-DEFINER-Helferfunktionen:
--     20260802130000_restore_is_staff_member_role_grants.sql.
--   - Selbst-Eskalations-Schutz per `with check`-Statuseinschraenkung:
--     20260801150000_memberships_owner_escalation_fix.sql (Vorbild fuer
--     Migration 2 dieses Blocks, nicht fuer diese Datei).

-- -------------------------------------------------------------
-- a) Neue Rolle 'guest'
-- -------------------------------------------------------------
alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check
  check (role in ('owner','admin','trainer','member','guest'));

-- -------------------------------------------------------------
-- b) member_role() verengen — die zentrale Sicherheitsmassnahme dieser Datei.
--    'guest' wird bewusst NICHT zurueckgegeben: dadurch greifen alle
--    bestehenden "member_role(tenant_id) is not null"-Policies (u. a.
--    courses_member_select, lessons_member_select, modules_select,
--    quizzes_select, sections_member_select, course_categories_member_select,
--    trainers_member_select, sidebar_links_member_select,
--    embeddings_member_select, tenants_member_select, products_select) fuer
--    Gaeste automatisch nicht mehr.
-- -------------------------------------------------------------
create or replace function public.member_role(t uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select m.role from public.memberships m
  where m.tenant_id = t and m.user_id = auth.uid() and m.status = 'active'
    and m.role in ('owner','admin','trainer','member')
  limit 1;
$$;

-- -------------------------------------------------------------
-- c) Drei neue Hilfsfunktionen fuer den Marketplace-Gastzugriff.
--    Gleiches Muster wie member_role()/is_staff(): sql stable security
--    definer, search_path gepinnt (siehe 20260710205101_hardening.sql).
-- -------------------------------------------------------------

-- Ist der eingeloggte Nutzer bei Mandant t als 'guest' aktiv?
create or replace function public.is_marketplace_guest(t uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = t and m.user_id = auth.uid()
      and m.status = 'active' and m.role = 'guest'
  );
$$;

-- Hat der eingeloggte Nutzer eine Einschreibung fuer Kurs c (unabhaengig von
-- der Mandantenrolle)?
create or replace function public.has_enrollment(c uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.enrollments e
    where e.course_id = c and e.user_id = auth.uid()
  );
$$;

-- Darf der eingeloggte Nutzer bei Mandant t ueberhaupt mitwirken (Fortschritt,
-- Versuche, Abgaben, Lesezeichen, Tutor-Chat, Loeschantrag, Push)? Regulaeres
-- Mitglied ODER Marketplace-Gast.
create or replace function public.can_participate(t uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.member_role(t) is not null or public.is_marketplace_guest(t);
$$;

revoke execute on function public.is_marketplace_guest(uuid) from public;
revoke execute on function public.has_enrollment(uuid) from public;
revoke execute on function public.can_participate(uuid) from public;
grant execute on function public.is_marketplace_guest(uuid) to anon, authenticated, service_role;
grant execute on function public.has_enrollment(uuid) to anon, authenticated, service_role;
grant execute on function public.can_participate(uuid) to anon, authenticated, service_role;

-- -------------------------------------------------------------
-- d) Additive Gast-Lese-Policies. Additiv = zusaetzlich zu den bestehenden
--    (permissive Policies werden ge-ODER-t), NICHT ersetzend. Jede Policy:
--    is_marketplace_guest(tenant_id) AND (Kurs-)status='published' AND
--    has_enrollment(<zugehoerige course_id>). Bei tiefer verschachtelten
--    Tabellen wird ueber Join zur zugehoerigen courses-Zeile aufgeloest,
--    exakt der Join-Pfad, den die bestehenden "..._member_select"/"..._select"
--    Policies bzw. der embeddings-Fix (20260711210852) schon nutzen.
--    `questions` bleibt bewusst unveraendert staff-only (enthaelt Loesungen).
-- -------------------------------------------------------------

-- courses: eigener status-Wert vorhanden.
create policy courses_guest_select on public.courses
  for select using (
    public.is_marketplace_guest(tenant_id)
    and status = 'published'
    and public.has_enrollment(id)
  );

-- modules: kein eigener status, ueber courses.status aufloesen (modules.course_id
-- ist eine direkte Spalte, siehe 0001_init.sql).
create policy modules_guest_select on public.modules
  for select using (
    public.is_marketplace_guest(tenant_id)
    and exists (
      select 1 from public.courses c
      where c.id = modules.course_id
        and c.status = 'published'
        and public.has_enrollment(c.id)
    )
  );

-- sections: kein eigener status, ueber modules -> courses aufloesen
-- (sections.module_id, siehe 20260718150000_sections.sql).
create policy sections_guest_select on public.sections
  for select using (
    public.is_marketplace_guest(tenant_id)
    and exists (
      select 1 from public.modules m
      join public.courses c on c.id = m.course_id
      where m.id = sections.module_id
        and c.status = 'published'
        and public.has_enrollment(c.id)
    )
  );

-- lessons: eigener status-Wert vorhanden (wie bei courses_member_select
-- geprueft), zusaetzlich ueber modules -> courses fuer has_enrollment
-- aufloesen (lessons hat kein direktes course_id).
create policy lessons_guest_select on public.lessons
  for select using (
    public.is_marketplace_guest(tenant_id)
    and status = 'published'
    and exists (
      select 1 from public.modules m
      join public.courses c on c.id = m.course_id
      where m.id = lessons.module_id
        and c.status = 'published'
        and public.has_enrollment(c.id)
    )
  );

-- quizzes: course_id ODER lesson_id kann gesetzt sein (0001_init.sql), daher
-- coalesce auf den tatsaechlichen Kurs aufloesen.
create policy quizzes_guest_select on public.quizzes
  for select using (
    public.is_marketplace_guest(tenant_id)
    and exists (
      select 1 from public.courses c
      where c.id = coalesce(
          quizzes.course_id,
          (select m.course_id
             from public.lessons l
             join public.modules m on m.id = l.module_id
            where l.id = quizzes.lesson_id)
        )
        and c.status = 'published'
        and public.has_enrollment(c.id)
    )
  );

-- embeddings: hat course_id UND lesson_id direkt (0001_init.sql), gleicher
-- Praezedenzfall wie der behobene Leck aus 20260711210852.
create policy embeddings_guest_select on public.embeddings
  for select using (
    public.is_marketplace_guest(tenant_id)
    and public.has_enrollment(embeddings.course_id)
    and exists (
      select 1 from public.courses c
      where c.id = embeddings.course_id and c.status = 'published'
    )
  );

-- course_categories: KEINE volle Kategorienliste freigeben (Plan Abschnitt 2:
-- "Nicht sichtbar: ... Kategorienliste"), sondern ausschliesslich die eine
-- Kategorie-Zeile, die vom gekauften, freigegebenen Kurs referenziert wird
-- (courses.category_id, siehe 20260722180000_course_categories.sql). Der Join
-- ueber has_enrollment(c.id) begrenzt das strukturell auf genau diese Zeile.
create policy course_categories_guest_select on public.course_categories
  for select using (
    public.is_marketplace_guest(tenant_id)
    and exists (
      select 1 from public.courses c
      where c.category_id = course_categories.id
        and c.status = 'published'
        and public.has_enrollment(c.id)
    )
  );

-- trainers: nur das Autorenprofil des gekauften Kurses (courses.author_id,
-- siehe 20260724130000_course_information.sql), analog course_categories.
create policy trainers_guest_select on public.trainers
  for select using (
    public.is_marketplace_guest(tenant_id)
    and exists (
      select 1 from public.courses c
      where c.author_id = trainers.id
        and c.status = 'published'
        and public.has_enrollment(c.id)
    )
  );

-- tenants: nur die Branding-Zeile des Mandanten, bei dem eine aktive
-- guest-Mitgliedschaft besteht. Kein Kurs-Join noetig.
create policy tenants_guest_select on public.tenants
  for select using (public.is_marketplace_guest(id));

-- -------------------------------------------------------------
-- e) Bestehende Schreib-Policies auf can_participate(tenant_id) umstellen,
--    damit Gaeste eigenen Fortschritt/Versuche/Abgaben/Lesezeichen/
--    Loeschantraege/Push/Tutor-Chat anlegen koennen (Plan Abschnitt 2:
--    "eigener Fortschritt/Versuche/Abgaben/Lesezeichen/Zertifikate" bzw.
--    "Tutor-Chat ... bleiben nutzbar"). Nur dort geaendert, wo die
--    JEWEILS LETZTGUELTIGE with-check-Klausel woertlich
--    "member_role(tenant_id) is not null" enthaelt — per `alter policy`,
--    das aendert nur die genannte Klausel, alles andere bleibt unveraendert
--    (gleiches Werkzeug wie 20260712233000_perf_advisors_fk_indexes_rls_
--    initplan.sql).
--
--    Abweichung vom urspruenglichen Plantext (Plan Abschnitt 1.1e nennt acht
--    Tabellen: progress, attempts, submissions, bookmarks,
--    deletion_requests, push_subscriptions, tutor_conversations,
--    tutor_messages): bei ZWEI der acht enthaelt die aktuell gueltige
--    Policy diese Klausel NICHT woertlich, daher unveraendert gelassen
--    (siehe PHASENSTATUS.md, Block "Marketplace M1"):
--      - progress (progress_own_insert/progress_own_update, seit
--        20260712234600_rls_consolidate_part_b.sql): pruefen nur noch
--        user_id = (select auth.uid()), gar keine Mandantenbindung mehr.
--        Vorbestehende Luecke, mit dem Marketplace nicht neu entstanden,
--        hier bewusst nicht mit-repariert (ausserhalb des Auftrags dieser
--        Migration).
--      - tutor_messages (tutor_msg_own_insert): prueft nur, dass die
--        referenzierte tutor_conversations-Zeile dem Nutzer gehoert; die
--        Mandantenbindung laeuft bereits vollstaendig ueber
--        tutor_conv_own_insert/tutor_conv_own_update (unten geaendert) —
--        eine Konversation kann ueberhaupt nur unter can_participate()
--        angelegt/fortgeschrieben werden, tutor_messages erbt das
--        transitiv, ohne eigene Aenderung noetig.
-- -------------------------------------------------------------

-- attempts (0001_init.sql, zuletzt gewrappt in 20260712233000)
alter policy attempts_own_insert on public.attempts
  with check ((user_id = (select auth.uid())) and public.can_participate(tenant_id));

-- submissions (letztgueltig: submissions_insert aus
-- 20260712234600_rls_consolidate_part_b.sql, ersetzt submissions_own_insert)
alter policy submissions_insert on public.submissions
  with check (
    (((user_id = (select auth.uid())) and public.can_participate(tenant_id)))
    or public.is_staff(tenant_id)
  );

-- bookmarks (20260712220000, zuletzt gewrappt in 20260712233000)
alter policy bookmarks_own_all on public.bookmarks
  with check ((user_id = (select auth.uid())) and public.can_participate(tenant_id));

-- deletion_requests (20260711222020, zuletzt gewrappt in 20260712233000)
alter policy deletion_requests_self_insert on public.deletion_requests
  with check ((user_id = (select auth.uid())) and public.can_participate(tenant_id));

-- push_subscriptions (20260711225617, zuletzt gewrappt in 20260712233000)
alter policy push_subscriptions_own_all on public.push_subscriptions
  with check ((user_id = (select auth.uid())) and public.can_participate(tenant_id));

-- tutor_conversations (letztgueltig: tutor_conv_own_insert/_update aus
-- 20260712234600_rls_consolidate_part_b.sql, ersetzt tutor_conv_own)
alter policy tutor_conv_own_insert on public.tutor_conversations
  with check ((user_id = (select auth.uid())) and public.can_participate(tenant_id));
alter policy tutor_conv_own_update on public.tutor_conversations
  with check ((user_id = (select auth.uid())) and public.can_participate(tenant_id));
