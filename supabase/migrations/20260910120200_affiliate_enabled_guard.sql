-- Affiliate-Modul, Block B1 -- Feature-Schalter `affiliate_enabled` in die
-- Erlaubnisliste der Betreiber-Schluessel (PLAN_Affiliate-System.md 3.0d und 9.8).
--
-- ANLASS
-- Das Betreiber-Portal bekommt in diesem Block die Checkbox "Partnerprogramm
-- freischalten" (src/app/portal/mandanten/[id]/tenant-features-form.tsx). Sie
-- schreibt `tenants.settings.affiliate_enabled` ueber den Admin-Client
-- (service_role). Ohne diese Migration ist das aber nur ein Schalter in EINER
-- Oberflaeche, kein Entitlement: `public.tenants` erlaubt `authenticated`
-- UPDATE auf der Spalte `settings` (20260909183548_tenants_column_guard.sql:46),
-- und die Policy `tenants_admin_update` laesst jeden owner/admin des Mandanten
-- durch. Ein Mandanten-Admin koennte sich das Modul also per PostgREST-PATCH
-- auf die eigene `tenants`-Zeile selbst freischalten -- Entitlement-Bypass
-- derselben Klasse wie der Befund K2 (Provisionssatz auf 0 setzen), gegen den
-- 20260909183548 ueberhaupt erst geschrieben wurde.
--
-- BEFUND (lesend gegen die Live-Datenbank vklqksdiyiijzoirntyt am 11.09.2026,
-- `select prosrc, prosecdef, proconfig from pg_proc` bzw. `pg_trigger`)
--   * `public.tenants_operator_settings_guard()` fuehrt live exakt SECHS
--     Schluessel: payments_enabled, tutor_enabled, course_generator_enabled,
--     marketplace_enabled, shift_calendar_enabled, marketplace_commission_bp.
--     `affiliate_enabled` fehlt.
--   * Die Funktion ist live NICHT `security definer` (prosecdef = false) und
--     traegt `search_path=public`. Beides bleibt inhaltlich so; der search_path
--     wird nur um `pg_temp` ergaenzt (Supabase-Linter
--     `function_search_path_mutable`, gleiche Fassung wie in
--     20260910120000_affiliate_core.sql).
--   * Der Trigger `tenants_operator_settings_guard` ist gebunden und aktiv
--     (BEFORE UPDATE, FOR EACH ROW), neben `tenants_touch`.
--   * Angewandter Stand der Live-Datenbank ist 20260909183704; die Migration
--     20260910120000_affiliate_core.sql ist dort noch NICHT gefahren.
--
-- LOESUNG
-- Die Funktion wird vollstaendig neu definiert (`create or replace`, Vorbild
-- 20260909183548_tenants_column_guard.sql Zeile 84-124) -- ein Array-Literal
-- laesst sich nicht "in place" erweitern, plpgsql kennt keinen Patch auf einen
-- Funktionsrumpf. Der Rumpf ist der wortgleich uebernommene Live-Quelltext,
-- ergaenzt um genau einen Arrayeintrag.
--
-- BEWUSST OHNE `security definer` (unveraendert gegenueber 20260909183548:70-75):
-- die Funktion muss `current_user` sehen, also die Rolle, unter der die
-- Anweisung tatsaechlich laeuft. Mit `security definer` waere das immer der
-- Eigentuemer der Funktion, und die Pruefung waere wirkungslos. Die Pruefung
-- bleibt eine ERLAUBNISLISTE ('postgres', 'supabase_admin', 'service_role'):
-- wer nicht genannt ist, darf die Betreiber-Schluessel nicht aendern. Eine
-- Sperrliste wuerde bei einer kuenftigen, hier unbekannten Rolle stillschweigend
-- oeffnen.
--
-- Der Guard weist eine Aenderung nicht ab, sondern setzt die geschuetzten
-- Werte auf OLD zurueck (Vorbild `calendar_workers_guard()`,
-- 20260807171725_shift_calendar_s2.sql:175). Das ist vertraeglich mit der
-- Merge-Schreibweise in src/lib/tenant/actions.ts (`{...tenant.settings, ...}`):
-- solange ein Mandanten-Admin die Betreiber-Schluessel unveraendert
-- mitschickt, ist der Trigger ein No-op.
--
-- VERHAELTNIS ZU 20260910120000_affiliate_core.sql
-- Dessen Abschnitt 0 (d) enthaelt dieselbe Neudefinition. Diese Datei ist
-- deshalb bewusst reihenfolgeunabhaengig: `create or replace function` ist
-- idempotent, und beide Fassungen haben dieselbe Schluesselliste, dieselbe
-- Rollenliste, denselben search_path und denselben Rumpf -- einziger
-- Unterschied ist die Zeilenangabe in einem Kommentar. Welche der beiden
-- zuletzt laeuft, ist fuer das Ergebnis also gleichgueltig.
-- ACHTUNG fuer spaetere Aenderungen: wer die Schluesselliste erweitert, muss
-- BEIDE Dateien anfassen. Die spaeter laufende gewinnt, und ein nur in einer
-- Datei ergaenzter Schluessel waere danach still wieder ungeschuetzt.

create or replace function public.tenants_operator_settings_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- Gesetzt ausschliesslich vom Betreiber-Portal ueber den Admin-Client,
  -- siehe src/lib/platform/actions.ts Zeile 567-581 (updateTenantFeatures).
  betreiber_schluessel constant text[] := array[
    'payments_enabled',
    'tutor_enabled',
    'course_generator_enabled',
    'marketplace_enabled',
    'shift_calendar_enabled',
    'marketplace_commission_bp',
    'affiliate_enabled'
  ];
  bewahrt jsonb := '{}'::jsonb;
  schluessel text;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
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

-- Trigger neu binden. `create or replace function` allein wuerde genuegen; das
-- ausdrueckliche Neubinden haelt die Datei fuer sich lesbar und aendert die
-- Reihenfolge nicht: BEFORE-Trigger derselben Tabelle laufen alphabetisch,
-- 'tenants_operator_settings_guard' < 'tenants_touch', der Guard bleibt vorn.
drop trigger if exists tenants_operator_settings_guard on public.tenants;
create trigger tenants_operator_settings_guard
  before update on public.tenants
  for each row execute function public.tenants_operator_settings_guard();
