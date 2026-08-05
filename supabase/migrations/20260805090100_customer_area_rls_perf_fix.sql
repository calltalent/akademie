-- Nachbesserung zu 20260805090000_customer_area.sql, ausgelöst durch
-- get_advisors() direkt nach Anwenden der Basis-Migration (05.08.2026).
--
-- 1) multiple_permissive_policies auf customer_area_items: die separate
-- FOR-ALL-Policy (owner/admin) und die member_select-Policy überlappen sich
-- bei SELECT und werden beide ausgewertet. Gleiches Muster wie in
-- 20260712234600_rls_consolidate_part_b.sql (products_select/modules_select):
-- FOR ALL in INSERT/UPDATE/DELETE aufteilen, EINE konsolidierte SELECT-Policy.
-- owner/admin brauchen "OR member_role(...) in ('owner','admin')" in der
-- SELECT-Policy, sonst würden sie restricted Items ohne eigene Audience-
-- Zuordnung (z. B. neu angelegte, noch niemandem zugewiesene Items) nicht
-- mehr sehen — sie verwalten aber alle Items unabhängig von der Zielgruppe.
drop policy if exists customer_area_items_admin_all    on public.customer_area_items;
drop policy if exists customer_area_items_member_select on public.customer_area_items;

create policy customer_area_items_select on public.customer_area_items
  for select using (
    (public.member_role(tenant_id) in ('owner','admin'))
    or ( (public.member_role(tenant_id) is not null)
         and (visibility = 'all' or public.customer_area_can_see(id)) )
  );
create policy customer_area_items_admin_insert on public.customer_area_items
  for insert with check (public.member_role(tenant_id) in ('owner','admin'));
create policy customer_area_items_admin_update on public.customer_area_items
  for update using (public.member_role(tenant_id) in ('owner','admin'))
  with check (public.member_role(tenant_id) in ('owner','admin'));
create policy customer_area_items_admin_delete on public.customer_area_items
  for delete using (public.member_role(tenant_id) in ('owner','admin'));

-- 2) unindexed_foreign_keys: drei FKs auf customer_area_item_audience hatten
-- keinen abdeckenden Index (nur item_id war indexiert). Gleiche Begründung
-- wie 20260712233000_perf_advisors_fk_indexes_rls_initplan.sql.
create index customer_area_item_audience_group_id_idx
  on public.customer_area_item_audience (group_id);
create index customer_area_item_audience_tenant_id_idx
  on public.customer_area_item_audience (tenant_id);
create index customer_area_item_audience_user_id_idx
  on public.customer_area_item_audience (user_id);

-- Der zusammengesetzte FK (group_id, tenant_id) auf customer_area_group_members
-- war ebenfalls ohne exakt passenden Index (die PK (group_id, user_id) deckt
-- group_id nur als Präfix ab).
create index customer_area_group_members_group_tenant_idx
  on public.customer_area_group_members (group_id, tenant_id);
