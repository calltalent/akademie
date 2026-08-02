-- Security-Fix (Advisor 02.08.2026): "RLS Enabled No Policy" auf
-- public.rate_limits. RLS ohne jede Policy bedeutet fuer anon/authenticated
-- bereits Default-Deny (bestaetigt: beide Rollen haben rolbypassrls=false),
-- der Linter kann das aber nicht von einer vergessenen Policy unterscheiden.
--
-- Fix: eine einzige explizite Deny-All-Policy fuer anon/authenticated statt
-- gar keiner Policy. Macht die Absicht aus 20260710235500_rate_limits.sql
-- ("Nur service_role darf lesen/schreiben") auditierbar, ohne die zuvor in
-- 20260802120000_rate_limits_drop_permissive_policies.sql entfernten
-- true/true-Policies wiedereinzufuehren. service_role und der Owner der
-- check_rate_limit()-RPC (postgres, rolbypassrls=true) sind von RLS
-- ohnehin nicht betroffen und bleiben voll funktionsfaehig.

create policy rate_limits_deny_all
on public.rate_limits
for all
to anon, authenticated
using (false)
with check (false);
