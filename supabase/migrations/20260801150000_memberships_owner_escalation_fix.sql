-- Sicherheitsfix: Rollen-Eskalation ueber memberships-RLS verhindern.
-- Bisher konnte jeder admin (nicht nur owner) per direktem PostgREST-Aufruf:
--   - eine neue Zeile mit role='owner' anlegen (Selbst-Befoerderung)
--   - die Zeile eines bestehenden Owners auf eine andere Rolle aendern/loeschen (Entmachtung)
-- weil die bisherigen Policies (siehe 20260712234600_rls_consolidate_part_b.sql)
-- nur die Rolle des AUFRUFERS pruefen, nie die betroffene bzw. resultierende
-- Zeile. Fix: role='owner' darf nur von einem bestehenden Owner vergeben
-- werden; Zeilen, die aktuell role='owner' sind, duerfen nur von einem Owner
-- ueberhaupt angefasst (update/delete) werden. Live angewendet am 01.08.2026.

drop policy if exists memberships_admin_insert on public.memberships;
drop policy if exists memberships_admin_update on public.memberships;
drop policy if exists memberships_admin_delete on public.memberships;

create policy memberships_admin_insert on public.memberships for insert
  with check (
    member_role(tenant_id) = any (array['owner'::text, 'admin'::text])
    and (role <> 'owner' or member_role(tenant_id) = 'owner')
  );

create policy memberships_admin_update on public.memberships for update
  using (
    member_role(tenant_id) = any (array['owner'::text, 'admin'::text])
    and (role <> 'owner' or member_role(tenant_id) = 'owner')
  )
  with check (
    member_role(tenant_id) = any (array['owner'::text, 'admin'::text])
    and (role <> 'owner' or member_role(tenant_id) = 'owner')
  );

create policy memberships_admin_delete on public.memberships for delete
  using (
    member_role(tenant_id) = any (array['owner'::text, 'admin'::text])
    and (role <> 'owner' or member_role(tenant_id) = 'owner')
  );
