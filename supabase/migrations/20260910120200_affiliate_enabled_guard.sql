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
-- KORREKTUR (B13, 11.09.2026): Dessen Abschnitt 0 (d) enthielt dieselbe
-- Neudefinition wortgleich. Das war eine Falle: zwei Stellen, die dieselbe
-- Schluesselliste fuehren, und der naechste, der einen Betreiber-Schalter
-- ergaenzt, aendert eine davon -- die andere laeuft spaeter, gewinnt, und der
-- neue Schluessel ist still wieder ungeschuetzt. Genau davor warnte der
-- bisherige Text an dieser Stelle ("wer die Schluesselliste erweitert, muss
-- BEIDE Dateien anfassen"), und eine Warnung ist der schlechtere Schutz als
-- eine einzige Quelle.
-- Die Definition ist deshalb aus 20260910120000 ENTFERNT; dort steht nur noch
-- ein Verweiskommentar an der alten Stelle. DIESE DATEI IST SEITHER DIE
-- EINZIGE, die `public.tenants_operator_settings_guard()` fuehrt -- wer einen
-- Schalter ergaenzt, aendert das Array unten und sonst nichts.
-- Reihenfolge bleibt unkritisch: die Funktion wird von nichts in
-- 20260910120000 aufgerufen (sie haengt allein am tenants-Trigger), und die
-- Dateinamen sortieren ohnehin 120000 < 120100 < 120200.
--
-- KORREKTUR (B13, zweiter Teil): Am Ende dieser Datei stehen jetzt die
-- `revoke execute`, die hier fehlten -- obwohl dieselben drei Dateien sie fuer
-- JEDE andere Funktion als Pflicht deklarieren. Live traegt die Funktion
-- tatsaechlich `=X/postgres | anon=X/postgres | ...` (pg_proc.proacl lesend
-- gegengeprueft), also EXECUTE fuer PUBLIC und fuer anon. `create or replace`
-- aendert die ACL nicht, es entstand durch die Neudefinition also keine NEUE
-- Luecke -- aber die bestehende blieb.
-- EINSCHRAENKUNG ZUM BEFUND, gegen den Advisor nachgeprueft: der Gegenleser
-- schreibt, "der Supabase-Advisor-Befund dieser Klasse bleibt offen". Das
-- stimmt nicht. `get_advisors(security)` am 11.09.2026 meldet diese Funktion
-- NICHT, und kann es auch nicht: die beiden einschlaegigen Lints
-- (`anon_security_definer_function_executable`,
-- `authenticated_security_definer_function_executable`) erfassen
-- ausschliesslich `security definer`-Funktionen, und diese hier ist bewusst
-- SECURITY INVOKER (prosecdef = false). Ausnutzbar ist die ACL ebenfalls nicht
-- (ein direkter Aufruf endet mit 0A000 "trigger functions can only be called
-- as trigger triggers").
-- Der `revoke` steht trotzdem, und zwar aus dem einen Grund, der uebrig
-- bleibt und der genuegt: die Regel "ausdrueckliches `revoke execute from
-- anon` auf jeder eigenen Funktion" gilt in diesem Projekt ohne Ausnahme
-- (CLAUDE.md), und sie wurde in genau den Dateien gebrochen, die sie zweimal
-- aufstellen. Eine Regel, die in ihrer eigenen Datei einmal nicht befolgt
-- wird, halten spaetere Leser fuer unverbindlich -- und beim naechsten
-- `create or replace` einer Funktion, die DANN `security definer` traegt,
-- fehlte der Reflex.
--
-- DURCHSICHT "INSERT-PFAD" (11.09.2026): GEPRUEFT UND SAUBER. Der Guard unten
-- ist `before update` -- die naheliegende Frage ist also, ob ein Mandanten-
-- Admin die Betreiber-Schluessel stattdessen beim ANLEGEN einer tenants-Zeile
-- setzen kann. Kann er nicht: `public.tenants` traegt zwar ein INSERT-Recht
-- fuer anon und authenticated auf allen elf Spalten (live gegen
-- information_schema.column_privileges gelesen), RLS ist aktiv
-- (pg_class.relrowsecurity = true) und es gibt dort KEINE INSERT-Policy --
-- live existieren nur tenants_member_select, tenants_guest_select und
-- tenants_admin_update (pg_policy gelesen). Der INSERT-Pfad ist damit
-- geschlossen, und zwar durch das Fehlen der Policy, nicht durch den Guard.
-- Wer hier je eine INSERT-Policy ergaenzt, muss den Guard im selben Schritt
-- auf `before insert or update` ausweiten.
--
-- =================================================================
-- KORREKTUREN NACH GEGENLESEN, ZWEITE RUNDE (11.09.2026)
-- =================================================================
--   Z1 (MITTEL) -- Der Rumpf setzte stillschweigend voraus, dass
--      `new.settings` ein JSON-OBJEKT ist. `authenticated` hat aber
--      Spaltenrecht UPDATE auf `tenants.settings` (live gegen
--      information_schema.column_privileges gelesen: branding, legal, name,
--      settings), und `tenants_admin_update` laesst jeden owner/admin durch.
--      Fuer ein JSON-ARRAY laufen beide Operatoren FEHLERFREI durch und
--      erzeugen Unsinn: `'[]'::jsonb - array['payments_enabled']` ergibt `[]`,
--      und `[] || '{"payments_enabled":true}'` ergibt
--      `[{"payments_enabled": true}]` -- die bewahrten Betreiber-Schluessel
--      landen als ELEMENT eines Arrays und sind auf oberster Ebene nicht mehr
--      lesbar. Ein Skalar wirft erst spaeter und anderswo.
--      Szenario: ein Mandanten-Admin ruft PATCH /rest/v1/tenants?id=eq.<eigener>
--      mit {"settings": []} auf. Danach liest src/lib/marketplace/fulfil.ts
--      `marketplace_commission_bp` nicht mehr und faellt auf den
--      Plattformstandard zurueck -- ein Mandant mit ausgehandelten 30 %
--      Provision zahlt ab dem naechsten Verkauf 20 %. Nebenbei sind saemtliche
--      uebrigen Einstellungen des Mandanten weg (default_locale,
--      enabled_locales, support_email, certificates_enabled,
--      self_signup_enabled -- bei allen drei Live-Mandanten stehen genau
--      solche Werte in der Spalte).
--      Der Befund ist nicht durch diese Datei entstanden (der Live-Rumpf ist
--      identisch), aber diese Datei ist nach B13 die einzige Stelle, die die
--      Funktion fuehrt, und sie nimmt mit `affiliate_enabled` einen weiteren
--      Geld-Schalter in dieselbe Liste auf. Zwei Riegel, beide unten:
--      die Typpruefung im Rumpf und ein CHECK-Constraint an der Tabelle, der
--      unabhaengig vom Trigger gilt.
--      Lesend gegengeprueft am 11.09.2026: `settings` ist `not null` mit
--      Vorgabewert '{}', und alle drei Live-Zeilen tragen ein Objekt
--      (jsonb_typeof = 'object') -- der Constraint laesst sich also ohne
--      Datenbereinigung anlegen.

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
  -- KORREKTUR (ZWEITE RUNDE, Z1): Typpruefung VOR der Rollen-Erlaubnisliste.
  -- Die Stellung ist Absicht: `settings` ist fuer JEDEN Schreiber ein Objekt
  -- oder ein Fehler. Stuende die Pruefung hinter der Liste, koennte ein
  -- fehlerhafter Serverlauf (service_role) die Spalte weiterhin in ein Array
  -- verwandeln und damit saemtliche Mandanteneinstellungen unerreichbar
  -- machen -- der Guard soll auch diesen Fall laut abbrechen lassen statt ihn
  -- durchzuwinken. Die Anwendung schreibt ausnahmslos Objekte
  -- (`{...tenant.settings, ...}`, src/lib/tenant/actions.ts), fuer sie ist die
  -- Zeile ein No-op. `coalesce` deckt den theoretischen NULL-Fall ab; die
  -- Spalte ist live `not null`, aber die Pruefung soll nicht daran haengen.
  if jsonb_typeof(coalesce(new.settings, '{}'::jsonb)) <> 'object' then
    raise exception 'tenants_settings_must_be_object';
  end if;

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

-- KORREKTUR (ZWEITE RUNDE, Z1): zweiter Riegel, unabhaengig vom Trigger.
-- Der Trigger ist `before update` -- er sieht ein INSERT nicht, und er kann
-- durch ein spaeteres `drop trigger` verschwinden. Der Constraint gilt immer
-- und fuer jede Rolle, service_role eingeschlossen.
-- Idempotent wie Abschnitt 0 von 20260910120000: `add constraint` kennt kein
-- IF NOT EXISTS, und ein blindes `drop constraint if exists` davor waere
-- schlechter als nichts, weil es beim zweiten Lauf den bereits geprueften
-- Constraint fuer die Dauer der Transaktion entfernte.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenants'::regclass
      and conname = 'tenants_settings_is_object'
  ) then
    alter table public.tenants add constraint tenants_settings_is_object
      check (settings is null or jsonb_typeof(settings) = 'object');
  end if;
end $$;

-- Trigger neu binden. `create or replace function` allein wuerde genuegen; das
-- ausdrueckliche Neubinden haelt die Datei fuer sich lesbar und aendert die
-- Reihenfolge nicht: BEFORE-Trigger derselben Tabelle laufen alphabetisch,
-- 'tenants_operator_settings_guard' < 'tenants_touch', der Guard bleibt vorn.
drop trigger if exists tenants_operator_settings_guard on public.tenants;
create trigger tenants_operator_settings_guard
  before update on public.tenants
  for each row execute function public.tenants_operator_settings_guard();

-- KORREKTUR (B13): Der doppelte `revoke` ist Pflicht und kein Copy-Paste.
-- `revoke ... from public` entfernt das EXECUTE-Recht der Rolle `anon` NICHT,
-- weil Supabase es ueber `alter default privileges` als eigenen Grant vergibt
-- (nachgewiesener Fund vom 07.09.2026,
-- 20260907093000_revoke_new_rpcs_from_anon.sql:1-19). Beide Zeilen sind
-- noetig, und nach JEDEM kuenftigen `create or replace` dieser Funktion erneut
-- zu setzen -- `create or replace` laesst die ACL unberuehrt.
-- Beim Feuern eines Triggers prueft Postgres kein EXECUTE-Recht (das geschieht
-- beim `create trigger`); der `grant` an authenticated ist also nur die sichere
-- Seite, entscheidend ist das Wegnehmen.
revoke execute on function public.tenants_operator_settings_guard() from public;
revoke execute on function public.tenants_operator_settings_guard() from anon;
grant  execute on function public.tenants_operator_settings_guard() to authenticated, service_role;
