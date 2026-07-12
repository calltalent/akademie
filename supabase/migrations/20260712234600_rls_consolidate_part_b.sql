-- RLS-Konsolidierung TEIL B — multiple_permissive_policies (11 Tabellen).
-- NOCH NICHT ANGEWENDET (Stand 12.07.2026). Hier ueberlappt eine FOR-ALL-Staff-
-- Policy die SELECT-Policy. Loesung: FOR ALL in INSERT/UPDATE/DELETE aufteilen +
-- EINE konsolidierte SELECT-Policy. Semantik erhalten; bei modules/products/
-- quizzes bewusst "OR is_staff" ergaenzt (Staff sah diese Inhalte bisher ueber
-- die FOR-ALL-Policy). Idempotent (drop if exists vor create).
--
--  >>> VOR PRODUKTION: `npm run e2e` (auth-/RLS-Specs) ausfuehren. <<<
-- Anwenden lokal via `supabase db push` oder auf einem Supabase-Dev-Branch.

-- ===== Inhalts-Tabellen (Staff = FOR ALL is_staff) =====

-- courses: member_select deckt Staff bereits ab (…OR is_staff) -> SELECT bleibt.
drop policy if exists courses_staff_write on public.courses;
drop policy if exists courses_staff_insert on public.courses;
drop policy if exists courses_staff_update on public.courses;
drop policy if exists courses_staff_delete on public.courses;
create policy courses_staff_insert on public.courses for insert with check (is_staff(tenant_id));
create policy courses_staff_update on public.courses for update using (is_staff(tenant_id)) with check (is_staff(tenant_id));
create policy courses_staff_delete on public.courses for delete using (is_staff(tenant_id));

-- lessons: analog courses.
drop policy if exists lessons_staff_write on public.lessons;
drop policy if exists lessons_staff_insert on public.lessons;
drop policy if exists lessons_staff_update on public.lessons;
drop policy if exists lessons_staff_delete on public.lessons;
create policy lessons_staff_insert on public.lessons for insert with check (is_staff(tenant_id));
create policy lessons_staff_update on public.lessons for update using (is_staff(tenant_id)) with check (is_staff(tenant_id));
create policy lessons_staff_delete on public.lessons for delete using (is_staff(tenant_id));

-- modules
drop policy if exists modules_member_select on public.modules;
drop policy if exists modules_staff_write on public.modules;
drop policy if exists modules_select on public.modules;
drop policy if exists modules_staff_insert on public.modules;
drop policy if exists modules_staff_update on public.modules;
drop policy if exists modules_staff_delete on public.modules;
create policy modules_select on public.modules for select
  using (((member_role(tenant_id) is not null) or is_staff(tenant_id)));
create policy modules_staff_insert on public.modules for insert with check (is_staff(tenant_id));
create policy modules_staff_update on public.modules for update using (is_staff(tenant_id)) with check (is_staff(tenant_id));
create policy modules_staff_delete on public.modules for delete using (is_staff(tenant_id));

-- products (Staff sieht auch inaktive -> OR is_staff)
drop policy if exists products_member_select on public.products;
drop policy if exists products_staff_all on public.products;
drop policy if exists products_select on public.products;
drop policy if exists products_staff_insert on public.products;
drop policy if exists products_staff_update on public.products;
drop policy if exists products_staff_delete on public.products;
create policy products_select on public.products for select
  using ((((active = true) and (member_role(tenant_id) is not null)) or is_staff(tenant_id)));
create policy products_staff_insert on public.products for insert with check (is_staff(tenant_id));
create policy products_staff_update on public.products for update using (is_staff(tenant_id)) with check (is_staff(tenant_id));
create policy products_staff_delete on public.products for delete using (is_staff(tenant_id));

-- quizzes
drop policy if exists quizzes_member_select on public.quizzes;
drop policy if exists quizzes_staff_write on public.quizzes;
drop policy if exists quizzes_select on public.quizzes;
drop policy if exists quizzes_staff_insert on public.quizzes;
drop policy if exists quizzes_staff_update on public.quizzes;
drop policy if exists quizzes_staff_delete on public.quizzes;
create policy quizzes_select on public.quizzes for select
  using (((member_role(tenant_id) is not null) or is_staff(tenant_id)));
create policy quizzes_staff_insert on public.quizzes for insert with check (is_staff(tenant_id));
create policy quizzes_staff_update on public.quizzes for update using (is_staff(tenant_id)) with check (is_staff(tenant_id));
create policy quizzes_staff_delete on public.quizzes for delete using (is_staff(tenant_id));

-- ===== Nutzer-Daten (Staff = FOR ALL; Nutzer = eigene Zeilen) =====

-- enrollments (Writes staff-only)
drop policy if exists enrollments_own_select on public.enrollments;
drop policy if exists enrollments_staff_all on public.enrollments;
drop policy if exists enrollments_select on public.enrollments;
drop policy if exists enrollments_staff_insert on public.enrollments;
drop policy if exists enrollments_staff_update on public.enrollments;
drop policy if exists enrollments_staff_delete on public.enrollments;
create policy enrollments_select on public.enrollments for select
  using (((user_id = (select auth.uid())) or is_staff(tenant_id)));
create policy enrollments_staff_insert on public.enrollments for insert with check (is_staff(tenant_id));
create policy enrollments_staff_update on public.enrollments for update using (is_staff(tenant_id)) with check (is_staff(tenant_id));
create policy enrollments_staff_delete on public.enrollments for delete using (is_staff(tenant_id));

-- memberships (Writes owner/admin)
drop policy if exists memberships_own_select on public.memberships;
drop policy if exists memberships_staff_select on public.memberships;
drop policy if exists memberships_admin_write on public.memberships;
drop policy if exists memberships_select on public.memberships;
drop policy if exists memberships_admin_insert on public.memberships;
drop policy if exists memberships_admin_update on public.memberships;
drop policy if exists memberships_admin_delete on public.memberships;
create policy memberships_select on public.memberships for select
  using (((user_id = (select auth.uid())) or is_staff(tenant_id)));
create policy memberships_admin_insert on public.memberships for insert
  with check ((member_role(tenant_id) = any (array['owner'::text, 'admin'::text])));
create policy memberships_admin_update on public.memberships for update
  using ((member_role(tenant_id) = any (array['owner'::text, 'admin'::text])))
  with check ((member_role(tenant_id) = any (array['owner'::text, 'admin'::text])));
create policy memberships_admin_delete on public.memberships for delete
  using ((member_role(tenant_id) = any (array['owner'::text, 'admin'::text])));

-- profiles (eigene Writes)
drop policy if exists profiles_own on public.profiles;
drop policy if exists profiles_staff_select on public.profiles;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_own_insert on public.profiles;
drop policy if exists profiles_own_update on public.profiles;
drop policy if exists profiles_own_delete on public.profiles;
create policy profiles_select on public.profiles for select
  using (((id = (select auth.uid()))
    or (exists ( select 1 from memberships m
        where ((m.user_id = profiles.id) and is_staff(m.tenant_id))))));
create policy profiles_own_insert on public.profiles for insert with check ((id = (select auth.uid())));
create policy profiles_own_update on public.profiles for update using ((id = (select auth.uid()))) with check ((id = (select auth.uid())));
create policy profiles_own_delete on public.profiles for delete using ((id = (select auth.uid())));

-- progress (eigene Writes)
drop policy if exists progress_own on public.progress;
drop policy if exists progress_staff_select on public.progress;
drop policy if exists progress_select on public.progress;
drop policy if exists progress_own_insert on public.progress;
drop policy if exists progress_own_update on public.progress;
drop policy if exists progress_own_delete on public.progress;
create policy progress_select on public.progress for select
  using (((user_id = (select auth.uid())) or is_staff(tenant_id)));
create policy progress_own_insert on public.progress for insert with check ((user_id = (select auth.uid())));
create policy progress_own_update on public.progress for update using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
create policy progress_own_delete on public.progress for delete using ((user_id = (select auth.uid())));

-- submissions (SELECT own OR staff; INSERT nutzer ODER staff; UPDATE/DELETE staff)
drop policy if exists submissions_staff_all on public.submissions;
drop policy if exists submissions_own_insert on public.submissions;
drop policy if exists submissions_own_select on public.submissions;
drop policy if exists submissions_select on public.submissions;
drop policy if exists submissions_insert on public.submissions;
drop policy if exists submissions_staff_update on public.submissions;
drop policy if exists submissions_staff_delete on public.submissions;
create policy submissions_select on public.submissions for select
  using (((user_id = (select auth.uid())) or is_staff(tenant_id)));
create policy submissions_insert on public.submissions for insert
  with check (((((user_id = (select auth.uid())) and (member_role(tenant_id) is not null))) or is_staff(tenant_id)));
create policy submissions_staff_update on public.submissions for update using (is_staff(tenant_id)) with check (is_staff(tenant_id));
create policy submissions_staff_delete on public.submissions for delete using (is_staff(tenant_id));

-- tutor_conversations (eigene Writes)
drop policy if exists tutor_conv_own on public.tutor_conversations;
drop policy if exists tutor_conv_staff_select on public.tutor_conversations;
drop policy if exists tutor_conv_select on public.tutor_conversations;
drop policy if exists tutor_conv_own_insert on public.tutor_conversations;
drop policy if exists tutor_conv_own_update on public.tutor_conversations;
drop policy if exists tutor_conv_own_delete on public.tutor_conversations;
create policy tutor_conv_select on public.tutor_conversations for select
  using (((user_id = (select auth.uid())) or is_staff(tenant_id)));
create policy tutor_conv_own_insert on public.tutor_conversations for insert
  with check (((user_id = (select auth.uid())) and (member_role(tenant_id) is not null)));
create policy tutor_conv_own_update on public.tutor_conversations for update
  using ((user_id = (select auth.uid())))
  with check (((user_id = (select auth.uid())) and (member_role(tenant_id) is not null)));
create policy tutor_conv_own_delete on public.tutor_conversations for delete using ((user_id = (select auth.uid())));
