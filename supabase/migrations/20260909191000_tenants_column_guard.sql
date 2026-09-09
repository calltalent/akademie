-- K2 (Projektanalyse 09.09.2026, Abschnitt 5.2 Position 3): Mandanten-Admins
-- koennen Betreiber-Felder selbst setzen.
--
-- Befund: `tenants_admin_update` (0001_init.sql Zeile 442) lautet
--   for update using (public.member_role(id) in ('owner','admin'));
-- ohne `with check` und ohne Spaltenliste. Gleichzeitig haben `authenticated`
-- UND `anon` laut information_schema UPDATE auf JEDER Spalte von
-- `public.tenants`. Zwischen einem Mandanten-Admin und den Betreiber-Feldern
-- steht damit nur diese eine Policy.
--
-- Was ein owner/admin heute per PostgREST-PATCH mit der eigenen Sitzung
-- erreichen kann:
--   plan = 'enterprise'        -> 100-fache KI-Kontingente auf Betreiberkosten
--                                 (ai/config.ts Zeile 67-69: trial 20/1 bis
--                                 enterprise 2000/20)
--   status = 'active'          -> hebt eine Sperrung durch den Betreiber auf
--   custom_domain = <fremd>    -> `resolveTenantByHost` trifft zwei Zeilen,
--                                 `maybeSingle()` liefert PGRST116, der fremde
--                                 Mandant ist fuer alle Besucher offline
--   settings.marketplace_commission_bp = 0
--                              -> Betreiber erhaelt 0 % Provision auf alle
--                                 eigenen Marketplace-Verkaeufe
--   settings.tutor_enabled u. a. -> kostenpflichtige Funktionen selbst
--                                 freischalten
--
-- Zwei Ebenen, weil eine nicht reicht: Spaltenrechte schuetzen die eigenen
-- Spalten (plan, status, slug, custom_domain), fangen aber nichts INNERHALB
-- von `settings` -- dort liegen Mandanten- und Betreiber-Schluessel in
-- derselben jsonb-Spalte.

-- =================================================================
-- 1. Spaltenrechte
-- =================================================================
-- Nach `revoke ... from` gilt Standard-Deny; der folgende `grant` gibt genau
-- die vier Spalten zurueck, die Mandantenseite heute schreibt oder laut
-- Analyse (H22/H23) kuenftig schreiben soll:
--   name     -> src/lib/tenant/actions.ts Zeile 64
--   settings -> src/lib/tenant/actions.ts Zeile 64 und 117
--   branding -> heute nur Betreiber-Portal, soll in den Mandanten-Admin
--   legal    -> Impressum je Mandant, heute nur per SQL setzbar
-- plan, status, slug, custom_domain, id, created_at und updated_at bleiben
-- ausschliesslich service_role. `updated_at` setzt weiterhin der Trigger
-- `tenants_touch` (0001_init.sql Zeile 397) -- Spaltenrechte gelten fuer die
-- SET-Liste der Anweisung, nicht fuer das, was ein Trigger daran aendert.
revoke update on public.tenants from anon, authenticated;
grant update (name, branding, legal, settings) on public.tenants to authenticated;

-- =================================================================
-- 2. Policy um `with check` ergaenzen
-- =================================================================
-- Ohne `with check` prueft Postgres nur die Zeile VOR der Aenderung. Der
-- Ausdruck ist derselbe wie in `using`: nach der Aenderung muss der Nutzer
-- den Mandanten immer noch verwalten.
drop policy if exists tenants_admin_update on public.tenants;
create policy tenants_admin_update on public.tenants
  for update
  using (public.member_role(id) in ('owner','admin'))
  with check (public.member_role(id) in ('owner','admin'));

-- =================================================================
-- 3. Schutz der Betreiber-Schluessel in `settings`
-- =================================================================
-- Vorbild: `calendar_workers_guard()` (20260807171725_shift_calendar_s2.sql
-- Zeile 175) -- statt die Aenderung abzulehnen, werden die geschuetzten
-- Werte auf OLD zurueckgesetzt. Das ist vertraeglich mit der bestehenden
-- Merge-Schreibweise in tenant/actions.ts (`{...tenant.settings, ...}`):
-- solange ein Mandanten-Admin die Betreiber-Schluessel unveraendert
-- mitschickt, ist der Trigger ein No-op.
--
-- BEWUSST OHNE `security definer`: die Funktion muss `current_user` sehen,
-- also die Rolle, unter der die Anweisung tatsaechlich laeuft. Mit
-- `security definer` waere das immer der Eigentuemer der Funktion.
-- PostgREST setzt fuer Client-Anfragen `authenticated` bzw. `anon`, fuer den
-- Admin-Client `service_role`; Migrationen laufen als `postgres` oder
-- `supabase_admin`. Nur die ersten beiden werden eingeschraenkt.
create or replace function public.tenants_operator_settings_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- Gesetzt ausschliesslich vom Betreiber-Portal ueber den Admin-Client,
  -- siehe src/lib/platform/actions.ts Zeile 548-559.
  betreiber_schluessel constant text[] := array[
    'payments_enabled',
    'tutor_enabled',
    'course_generator_enabled',
    'marketplace_enabled',
    'shift_calendar_enabled',
    'marketplace_commission_bp'
  ];
  bewahrt jsonb := '{}'::jsonb;
  schluessel text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  foreach schluessel in array betreiber_schluessel loop
    if old.settings ? schluessel then
      bewahrt := bewahrt || jsonb_build_object(schluessel, old.settings -> schluessel);
    end if;
  end loop;

  -- Erst alle Betreiber-Schluessel aus der eingehenden Fassung entfernen
  -- (auch die, die frueher gar nicht gesetzt waren), dann die bewahrten
  -- Werte daraufsetzen.
  new.settings := (coalesce(new.settings, '{}'::jsonb) - betreiber_schluessel) || bewahrt;
  return new;
end;
$$;

drop trigger if exists tenants_operator_settings_guard on public.tenants;
create trigger tenants_operator_settings_guard
  before update on public.tenants
  for each row execute function public.tenants_operator_settings_guard();
