-- Performance-Advisors (Supabase) — vorbereitet 12.07.2026 aus der Fehleranalyse.
-- Behebt zwei Advisor-Klassen aus dem Live-Projekt (ref vklqksdiyiijzoirntyt):
--   Teil 1: 18 Fremdschluessel ohne deckenden Index (unindexed_foreign_keys)
--   Teil 2: 17 RLS-Policies, die auth.uid() PRO ZEILE neu auswerten
--           (auth_rls_initplan)
--
-- Sicherheit unveraendert: die Policy-Logik bleibt 1:1 identisch, es wird nur
-- auth.uid() in (select auth.uid()) gekapselt, damit Postgres den Wert EINMAL
-- (InitPlan) statt je Zeile berechnet. Kein DROP POLICY -> kein Zeitfenster
-- ohne Schutz. Vollstaendig idempotent (mehrfaches Anwenden ist gefahrlos).
--
-- NICHT enthalten (bewusst, groesserer Umbau): 85x multiple_permissive_policies
-- (own_* + staff_* SELECT je Tabelle zusammenlegen) und 1x unused_index
-- (embeddings_vec_idx).

-- ==========================================================================
-- Teil 1 — fehlende FK-Indizes (18)
-- ==========================================================================
create index if not exists idx_ai_jobs_created_by            on public.ai_jobs (created_by);
create index if not exists idx_attempts_quiz_id              on public.attempts (quiz_id);
create index if not exists idx_audit_log_user_id             on public.audit_log (user_id);
create index if not exists idx_bunny_videos_created_by       on public.bunny_videos (created_by);
create index if not exists idx_certificates_user_id          on public.certificates (user_id);
create index if not exists idx_courses_created_by            on public.courses (created_by);
create index if not exists idx_deletion_requests_processed_by on public.deletion_requests (processed_by);
create index if not exists idx_orders_product_id             on public.orders (product_id);
create index if not exists idx_orders_user_id                on public.orders (user_id);
create index if not exists idx_quizzes_course_id             on public.quizzes (course_id);
create index if not exists idx_quizzes_lesson_id             on public.quizzes (lesson_id);
create index if not exists idx_submissions_reviewed_by       on public.submissions (reviewed_by);
create index if not exists idx_submissions_user_id           on public.submissions (user_id);
create index if not exists idx_subscriptions_product_id      on public.subscriptions (product_id);
create index if not exists idx_subscriptions_user_id         on public.subscriptions (user_id);
create index if not exists idx_tutor_conversations_course_id on public.tutor_conversations (course_id);
create index if not exists idx_tutor_conversations_user_id   on public.tutor_conversations (user_id);
create index if not exists idx_webhook_deliveries_webhook_id on public.webhook_deliveries (webhook_id);
create index if not exists idx_bookmarks_lesson_id           on public.bookmarks (lesson_id);

-- ==========================================================================
-- Teil 2 — RLS auth_rls_initplan (17 Policies): auth.uid() -> (select auth.uid())
-- ==========================================================================

-- attempts
alter policy attempts_own_select on public.attempts
  using ((user_id = (select auth.uid())));
alter policy attempts_own_insert on public.attempts
  with check (((user_id = (select auth.uid())) and (member_role(tenant_id) is not null)));

-- certificates
alter policy certificates_own_select on public.certificates
  using ((user_id = (select auth.uid())));

-- deletion_requests
alter policy deletion_requests_select on public.deletion_requests
  using (((user_id = (select auth.uid())) or is_staff(tenant_id)));
alter policy deletion_requests_self_insert on public.deletion_requests
  with check (((user_id = (select auth.uid())) and (member_role(tenant_id) is not null)));

-- enrollments
alter policy enrollments_own_select on public.enrollments
  using ((user_id = (select auth.uid())));

-- memberships
alter policy memberships_own_select on public.memberships
  using ((user_id = (select auth.uid())));

-- orders
alter policy orders_own_select on public.orders
  using ((user_id = (select auth.uid())));

-- profiles
alter policy profiles_own on public.profiles
  using ((id = (select auth.uid())))
  with check ((id = (select auth.uid())));

-- progress
alter policy progress_own on public.progress
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

-- push_subscriptions
alter policy push_subscriptions_own_all on public.push_subscriptions
  using ((user_id = (select auth.uid())))
  with check (((user_id = (select auth.uid())) and (member_role(tenant_id) is not null)));

-- submissions
alter policy submissions_own_select on public.submissions
  using ((user_id = (select auth.uid())));
alter policy submissions_own_insert on public.submissions
  with check (((user_id = (select auth.uid())) and (member_role(tenant_id) is not null)));

-- subscriptions
alter policy subscriptions_own_select on public.subscriptions
  using ((user_id = (select auth.uid())));

-- tutor_conversations
alter policy tutor_conv_own on public.tutor_conversations
  using ((user_id = (select auth.uid())))
  with check (((user_id = (select auth.uid())) and (member_role(tenant_id) is not null)));

-- tutor_messages
alter policy tutor_msg_own_select on public.tutor_messages
  using ((exists ( select 1
     from tutor_conversations c
    where ((c.id = tutor_messages.conversation_id) and (c.user_id = (select auth.uid()))))));
alter policy tutor_msg_own_insert on public.tutor_messages
  with check (((role = 'user'::text) and (exists ( select 1
     from tutor_conversations c
    where ((c.id = tutor_messages.conversation_id) and (c.user_id = (select auth.uid())))))));

-- bookmarks (heute hinzugefuegt, gleiches Muster wie push_subscriptions_own_all)
alter policy bookmarks_own_all on public.bookmarks
  using ((user_id = (select auth.uid())))
  with check (((user_id = (select auth.uid())) and (member_role(tenant_id) is not null)));
