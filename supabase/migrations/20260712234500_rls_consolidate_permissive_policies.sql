-- RLS-Konsolidierung TEIL A (sicher) — multiple_permissive_policies.
-- Angewendet 12.07.2026 (Freigabe Josip). Zwei getrennte SELECT-Policies je
-- Tabelle -> eine mit OR. Beweisbar identisch (permissive Policies werden ge-ODER-t).
-- Kein FOR-ALL-Umbau, kein Verhaltensrisiko. Idempotent (drop if exists vor create).
-- auth.uid() als (select auth.uid()) gekapselt (initplan-konform).
--
-- TEIL B (11 Tabellen mit FOR-ALL-Umbau) liegt separat in
-- 20260712234600_rls_consolidate_part_b.sql und braucht E2E-Test vor Prod.

-- attempts
drop policy if exists attempts_own_select on public.attempts;
drop policy if exists attempts_staff_select on public.attempts;
drop policy if exists attempts_select on public.attempts;
create policy attempts_select on public.attempts for select
  using (((user_id = (select auth.uid())) or is_staff(tenant_id)));

-- certificates
drop policy if exists certificates_own_select on public.certificates;
drop policy if exists certificates_staff_select on public.certificates;
drop policy if exists certificates_select on public.certificates;
create policy certificates_select on public.certificates for select
  using (((user_id = (select auth.uid())) or is_staff(tenant_id)));

-- orders
drop policy if exists orders_own_select on public.orders;
drop policy if exists orders_staff_select on public.orders;
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select
  using (((user_id = (select auth.uid())) or is_staff(tenant_id)));

-- subscriptions
drop policy if exists subscriptions_own_select on public.subscriptions;
drop policy if exists subscriptions_staff_select on public.subscriptions;
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select
  using (((user_id = (select auth.uid())) or is_staff(tenant_id)));

-- tutor_messages (eigene Konversation ODER Staff)
drop policy if exists tutor_msg_own_select on public.tutor_messages;
drop policy if exists tutor_msg_staff_select on public.tutor_messages;
drop policy if exists tutor_msg_select on public.tutor_messages;
create policy tutor_msg_select on public.tutor_messages for select
  using ((
    (exists ( select 1 from tutor_conversations c
       where ((c.id = tutor_messages.conversation_id) and (c.user_id = (select auth.uid())))))
    or is_staff(tenant_id)
  ));
