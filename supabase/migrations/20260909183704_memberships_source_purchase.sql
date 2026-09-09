-- K1 (Projektanalyse 09.09.2026, Abschnitt 5.2 Position 4), Teil 1 von 2:
-- Herkunft 'purchase' fuer Mitgliedschaften erlauben.
--
-- Befund: `handleCheckoutCompleted()` in src/app/api/stripe/webhook/route.ts
-- legt ueber `enrollFromProduct()` (Zeile 198) ausschliesslich eine
-- `enrollments`-Zeile an, nie eine in `memberships`. Die Lese-Policies
-- verlangen aber eine Mitgliedschaft: `courses_member_select`
-- (0001_init.sql Zeile 465) prueft `member_role(tenant_id) is not null`,
-- `courses_guest_select` (20260803100000 Zeile 124) prueft
-- `is_marketplace_guest(tenant_id)`. Wer sich selbst registriert (Standard
-- `self_signup_enabled`) und dann ueber /kaufen bezahlt, erfuellt keines von
-- beidem und sieht nach der Zahlung nichts.
--
-- Der Marketplace-Pfad macht es bereits richtig: src/lib/marketplace/fulfil.ts
-- Zeile 67-78 legt vor der Einschreibung eine Mitgliedschaft mit
-- `role='guest'`, `source='marketplace'` an. Der Direktkauf bekommt dasselbe
-- Muster, aber eine eigene Herkunft, damit ein Mandanten-Admin in der
-- Teilnehmerliste weiterhin unterscheiden kann, woher jemand kommt.
--
-- Vorgehen wie 20260711223000_enrollments_source_add_api.sql und
-- 20260803100300_enrollments_membership_source.sql: 0001_init.sql bleibt
-- unangetastet, der Constraint wird per ALTER erweitert (CLAUDE.md §4).
--
-- Teil 2 ist die Aenderung im Webhook selbst, siehe denselben Commit.

alter table public.memberships drop constraint memberships_source_check;

alter table public.memberships
  add constraint memberships_source_check
  check (source in ('invite', 'import', 'marketplace', 'purchase'));
