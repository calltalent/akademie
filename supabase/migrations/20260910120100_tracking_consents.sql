-- Affiliate-Modul, Block B2 "Einwilligung" (PLAN_Affiliate-System.md Abschnitt
-- 10/B2, Datenmodell 3.17, 10.09.2026). Diese Datei legt genau eine Tabelle an:
-- public.tracking_consents, den Nachweis nach Art. 7 Abs. 1 DSGVO fuer die eine
-- zusaetzliche Cookie-Kategorie "Partner-Empfehlung".
--
-- ANLASS
-- Das Attributions-Cookie `ct_aff` (Block B3) ist kein technisch notwendiges
-- Cookie; es dient der Wiedererkennung ueber Seitenaufrufe hinweg und ist damit
-- nach § 25 Abs. 1 TDDDG einwilligungspflichtig. Bis heute gibt es im ganzen
-- Repo keinerlei Einwilligungs-Infrastruktur -- weder Tabelle noch Dialog --,
-- und messages/de.json sagt woertlich "Kein Tracking, keine Werbe-Cookies".
-- Ohne diese Tabelle darf der Klick-Endpunkt aus B3 nicht scharfgeschaltet
-- werden (Plan 1.3, dritte Grenze).
--
-- BEFUND (gegen die Live-Datenbank vklqksdiyiijzoirntyt am 10.09.2026 gelesen)
--   1. `public.tracking_consents` existiert nicht (to_regclass = null); es gibt
--      auch keine andere Tabelle, die eine Einwilligung protokolliert.
--   2. Neue Tabellen bekommen in diesem Projekt per `alter default privileges`
--      automatisch ALLE Rechte fuer `anon` UND `authenticated`
--      (pg_default_acl: `anon=arwdDxtm/postgres`). `revoke all` ist deshalb
--      kein Zierrat, sondern die erste Schutzschicht -- gleicher Befund wie in
--      20260910120000_affiliate_core.sql.
--   3. `check_function_bodies` steht auf `on`. Die Guard-Funktion unten liest
--      keine Tabelle, ist davon also nicht betroffen; der Trigger wird
--      trotzdem erst nach der Tabelle angelegt.
--
-- LOESUNG
-- Eine append-only Tabelle: ein Widerruf ist eine NEUE Zeile mit
-- `decision = 'withdrawn'`, keine Aenderung der alten -- dieselbe Logik wie im
-- Provisionsbuch (Plan 3.11). Der aktuelle Zustand ist die juengste Zeile je
-- Subjekt und Kategorie; die Aufloesung dieser Regel liegt in
-- src/lib/consent/read.ts und ist dort getestet. Geschrieben wird
-- ausschliesslich serverseitig ueber `service_role`
-- (src/lib/consent/actions.ts, createAdminClient()).
--
-- Kein neuer Fremdschluessel ausser `tenant_id`: `subject_key` traegt je nach
-- `subject_kind` entweder die opake Consent-ID aus dem Cookie ('anon') oder
-- `profiles.id` ('user'). Eine FK-Spalte kann nicht zwei Wertebereiche
-- referenzieren, und eine anonyme Einwilligung darf gerade KEIN Konto
-- benennen -- deshalb `text` ohne Fremdschluessel (Plan 3.17).
--
-- KEINE neue SECURITY-DEFINER-Funktion in dieser Datei. Die einzige Funktion
-- ist der Unveraenderlichkeits-Guard, und der braucht bewusst KEIN
-- `security definer`, weil er `current_user` sehen muss (unter
-- `security definer` waere das immer der Funktionseigentuemer und die
-- Erlaubnisliste damit wirkungslos) -- identische Begruendung wie
-- 20260910120000_affiliate_core.sql:828 (affiliate_audit_log_guard).
--
-- VORBILDER
--   - Deny-Tabelle mit ausdruecklicher Deny-Policy statt "gar keine Policy":
--     20260802121500_rate_limits_explicit_deny_policy.sql:1-20 und
--     20260803100200_marketplace_ledger.sql:1-15.
--   - Unveraenderlichkeit per Trigger mit Erlaubnisliste
--     ('postgres'/'supabase_admin'), damit die DSGVO-Anonymisierung als
--     bewusster Eingriff moeglich bleibt:
--     20260910120000_affiliate_core.sql:824-848 (affiliate_audit_log).
--   - `revoke execute ... from anon` zusaetzlich zu `from public`:
--     20260907093000_revoke_new_rpcs_from_anon.sql:1-19. Supabase vergibt
--     EXECUTE an `anon` als eigenen Grant; `revoke from public` entfernt ihn
--     nachweislich NICHT (Fund vom 07.09.2026).
--
-- DIESE MIGRATION IST NOCH NICHT ANGEWENDET und wurde in dieser Umgebung auch
-- nicht probeweise gefahren -- es gibt kein lokales Postgres und keine
-- supabase/config.toml (Plan 12.7). Das Anwenden bleibt Josip vorbehalten
-- (CLAUDE.md §4.6). Danach: `get_advisors(security)` UND
-- `get_advisors(performance)` laufen lassen.
--
-- =================================================================
-- KORREKTUREN NACH GEGENLESEN (11.09.2026)
-- =================================================================
--   B5 (HOCH) -- Gemeldet war: `tracking_consents_guard()` werfe fuer
--      `service_role` auch beim DELETE und mache damit die BESTEHENDE
--      Mandantenloeschung im Betreiber-Portal unmoeglich. WIDERLEGT UND IN DER
--      ZWEITEN RUNDE ZURUECKGENOMMEN, siehe unten -- blockiert war nichts,
--      und die Korrektur der ersten Runde machte den gesamten Serverbetrieb
--      zum Loescher des Einwilligungsnachweises. Richtig bleibt nur der
--      Nebensatz: eine Mandantenloeschung IST ein Vorgang des laufenden
--      Betriebs (src/lib/platform/actions.ts:295).
--   B11 (MITTEL) -- Wiederholbarkeit. Diese Datei braucht dafuer keine
--      Aenderung, und das ist eine Entscheidung, keine Auslassung: die einzige
--      Funktion steht bereits als `create or replace` da, und alles andere
--      (`create index`, `create trigger`, `create policy`) haengt an der
--      Tabelle, die diese Datei selbst anlegt. `create table if not exists`
--      wuerde eine bestehende, inhaltlich abweichende Tabelle stillschweigend
--      durchwinken -- ein Abbruch mit 42P07 ist die ehrlichere Auskunft. Und
--      solange `create table` abbricht, wird nichts darunter erreicht; ein
--      `if exists` davor waere Zierrat, der nur Lesbarkeit kostet. Vor dem
--      `create trigger` steht trotzdem ein `drop trigger if exists`, weil der
--      Trigger an einer `create or replace`-Funktion haengt und die Zeile so
--      fuer sich lesbar bleibt.
--
-- DURCHSICHT "INSERT-PFAD" (11.09.2026): Kein RECHTE-Loch -- `revoke all`
-- nimmt anon und authenticated jedes Recht, es gibt keine erlaubende Policy,
-- geschrieben wird ausschliesslich unter `service_role`. Ein Client erreicht
-- den INSERT-Pfad also nicht direkt, und weil die Tabelle append-only ist
-- (ein Widerruf ist eine NEUE Zeile), gibt es auch keinen "gefaehrlichen
-- Anfangszustand", den eine Zeile beim Anlegen tragen koennte. `created_at`
-- braucht aus demselben Grund keinen Server-Zeitstempel-Zwang wie in
-- 20260910120000.
-- NACHTRAG ZWEITE RUNDE: der INSERT-Pfad ist trotzdem nicht ungeschuetzt
-- geblieben. Er ist zwar kein RECHTE-Pfad, aber ein MENGEN-Pfad: der einzige
-- Schreiber ist eine oeffentlich aufrufbare Server Action, die fuer 'denied'
-- und 'withdrawn' bewusst kein Rate-Limit hat. Der Guard traegt deshalb jetzt
-- einen INSERT-Zweig mit Entdopplung und Mengenbegrenzung; Begruendung dort.
--
-- =================================================================
-- KORREKTUREN NACH GEGENLESEN, ZWEITE RUNDE (11.09.2026)
-- =================================================================
--   Z1 BLOCKIEREND, Abschnitt 2 -- 'service_role' ist aus der
--      DELETE-Erlaubnisliste WIEDER ENTFERNT. Die Kaskade der
--      Mandantenloeschung haengt jetzt an `pg_trigger_depth() > 1`, also an
--      der HERKUNFT der Anweisung statt an der Rolle. Begruendung, Beleg und
--      die ausdruecklich benannte Restannahme stehen im Funktionsrumpf;
--      wortgleich in 20260910120000_affiliate_core.sql, Abschnitt 7.
--   Z2 Abschnitt 2 -- die Tabelle hatte weder Entdopplung noch
--      Mengenbegrenzung, obwohl ihr einziger Schreiber oeffentlich aufrufbar
--      ist und fuer 'denied'/'withdrawn' bewusst kein Rate-Limit hat. Der
--      Guard bekommt einen INSERT-Zweig: eine inhaltsgleiche Wiederholung und
--      alles jenseits von 100 Entscheidungen je Subjekt und Kategorie wird
--      uebersprungen -- klaglos, nicht mit einer Ausnahme, damit ein Widerruf
--      niemals an der Technik scheitert (Art. 7 Abs. 3 DSGVO).
--
-- VORAUSSETZUNG FUER B3 (und gleich mit, sobald jemand consent/actions.ts
-- anfasst): Der Riegel im Trigger begrenzt je SUBJEKT. `subject_key` waehlt
-- aber der Aufrufer -- wer die opake Consent-ID je Aufruf rotiert, umgeht ihn.
-- Dagegen hilft nur ein Rate-Limit im Aufrufer, und zwar fuer ALLE Richtungen
-- statt nur fuer 'granted' (src/lib/consent/actions.ts:145-150). Es darf den
-- Widerruf nicht abweisen -- also grosszuegiges Fenster, und bei
-- Ueberschreitung nur den INSERT ueberspringen, waehrend Cookie und Rueckgabe
-- unveraendert weiterlaufen. Diese Datei kann das nicht leisten: ein Trigger
-- sieht keine Aufruferkennung ausser dem, was in der Zeile steht.

-- =================================================================
-- 1. Tabelle
-- =================================================================

create table public.tracking_consents (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  subject_kind   text not null check (subject_kind in ('anon','user')),
  -- Opake Consent-ID (32 Hex aus dem ct_consent-Cookie) bzw. profiles.id.
  -- Laengenschranke als Zusatz zum Plan: der Wert stammt aus einem oeffentlich
  -- erreichbaren Pfad; eine unbegrenzte Textspalte laedt zum Vollschreiben ein.
  subject_key    text not null check (char_length(subject_key) between 1 and 128),
  category       text not null check (category in ('affiliate')),
  decision       text not null check (decision in ('granted','denied','withdrawn')),
  -- Stand der Rechtstexte zum Zeitpunkt der Entscheidung (LEGAL_LAST_UPDATED,
  -- src/lib/legal/updated.ts). Aendert sich der Text inhaltlich, ist die alte
  -- Einwilligung nicht mehr die, die erteilt wurde -- die Leseseite behandelt
  -- eine abweichende Version deshalb als "keine Einwilligung" (fail-closed).
  policy_version text not null check (char_length(policy_version) between 1 and 40),
  -- HMAC-SHA-256 der IP mit STATISCHEM, domaenenpraefixiertem Salz (nie die IP
  -- selbst). Statisch, nicht tagesrotierend wie bei affiliate_clicks: ein
  -- Nachweis, der nach einem Tag nicht mehr verifizierbar ist, ist kein
  -- Nachweis (Plan 11.6). Nullable, weil hinter Cloudflare nicht jede Anfrage
  -- eine verwertbare IP traegt und eine fehlende IP kein Grund ist, die
  -- Entscheidung des Nutzers zu verwerfen.
  ip_hash        text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now()
);

-- Deckt beide Zugriffe ab: die Zustandsaufloesung (juengste Zeile je Subjekt
-- und Kategorie) und -- weil `tenant_id` fuehrende Spalte ist -- zugleich den
-- Fremdschluessel auf tenants (Advisor "unindexed foreign keys").
create index tracking_consents_subject_idx
  on public.tracking_consents (tenant_id, subject_kind, subject_key, created_at desc);

-- Kein `updated_at` und kein `_touch`-Trigger: diese Zeilen werden nie
-- geaendert, und ein `updated_at` ohne Trigger veraltet dauerhaft
-- (20260803100100:53-60). Kein `unique (id, tenant_id)`: die Tabelle hat keine
-- Kindtabelle, die einen zusammengesetzten Fremdschluessel braeuchte (Plan
-- 11.1 verlangt das Paar nur fuer Kindtabellen).

-- =================================================================
-- 2. Unveraenderlichkeit
-- =================================================================
-- Ein Einwilligungsnachweis, der aenderbar ist, ist keiner. `service_role`
-- umgeht RLS und traegt volle Tabellenrechte -- ohne diesen Trigger koennte
-- ein Fehler im Serverbetrieb eine erteilte oder widerrufene Einwilligung
-- nachtraeglich umschreiben. Die Erlaubnisliste fuer das AENDERN laesst nur
-- Migrationen und Dashboard-Eingriffe durch ('postgres'/'supabase_admin'),
-- damit die Anonymisierung nach Art. 17 DSGVO als bewusster, protokollierter
-- Eingriff moeglich bleibt; 'service_role', also der normale Serverbetrieb,
-- steht dort bewusst NICHT. Fuer das LOESCHEN gilt eine eigene Liste --
-- dieselben zwei Rollen, ERGAENZT UM DIE HERKUNFT DER ANWEISUNG
-- (`pg_trigger_depth() > 1`); Begruendung direkt darunter.
--
-- KORREKTUR (B5, ZWEITE RUNDE -- die Korrektur der ersten Runde ist
-- ZURUECKGENOMMEN).
-- Was in der ERSTEN Runde falsch war: der DELETE-Zweig war um 'service_role'
-- erweitert worden, weil die Mandantenloeschung im Betreiber-Portal
-- (src/lib/platform/actions.ts:295, `admin.from("tenants").delete()`) sonst
-- angeblich blockiert sei. Die Praemisse traegt nicht, und die Folge war ein
-- echter Schutzverlust: der gesamte Serverbetrieb laeuft unter dieser Rolle --
-- jede Route mit createAdminClient() konnte den Einwilligungsnachweis danach
-- zeilenweise und spurlos raeumen. Bei einer Tabelle, die es ausschliesslich
-- wegen Art. 7 Abs. 1 DSGVO gibt, ist das der Verlust ihres Zwecks.
-- Warum die Praemisse nicht traegt (lesend belegt, 11.09.2026): eine
-- ON-DELETE-Kaskade laeuft nicht unter der Rolle des Aufrufers. Sie haengt als
-- INTERNER Trigger an der ELTERN-Tabelle -- `pg_trigger` join `pg_proc` fuer
-- `relname = 'tenants'` zeigt je Kind-Fremdschluessel ein
-- RI_ConstraintTrigger mit tgisinternal = true und der Funktion
-- `RI_FKey_cascade_del` -- und PostgreSQL schaltet dabei die Benutzerkennung
-- auf den EIGENTUEMER der referenzierenden Tabelle um
-- (ri_PerformCheck/SetUserIdAndSecContext auf relowner). Eigentuemer ist
-- 'postgres': alle 52 Tabellen in `public` gehoeren dieser Rolle
-- (pg_class.relowner gegen pg_roles gelesen), und 'postgres' stand von Anfang
-- an in der Liste. Die Mandantenloeschung war also nie blockiert.
-- ANNAHME, die lesend nicht beweisbar ist: dass `current_user` im
-- Kind-Trigger tatsaechlich 'postgres' ZEIGT, folgt aus dem Quelltext von
-- ri_triggers.c, nicht aus einer Messung -- die braeuchte einen
-- Schreibvorgang, und diese Umgebung darf nicht in die Live-Datenbank
-- schreiben. Deshalb haengt die Kaskade unten nicht an dieser Annahme,
-- sondern an der Herkunft der Anweisung.
-- Warum `pg_trigger_depth() > 1` die richtige Schranke ist: ein direktes
-- `delete from public.tracking_consents ...` ruft den BEFORE-Trigger DIESER
-- Anweisung auf und sieht bereits Tiefe 1 -- `> 1` laesst es also NICHT
-- durch, das gezielte Einzel-DELETE aus einer Server-Route bleibt verboten.
-- Eine Kaskade ist dagegen mindestens zwei Ebenen tief: die RI-Aktion IST ein
-- Trigger auf der Elterntabelle (Tiefe 1), das von ihr abgesetzte `delete`
-- bringt die Trigger der Kindtabelle auf Tiefe 2; verschachtelte Kaskaden
-- liegen hoeher, deshalb `> 1` statt `= 2`. Ausloesen kann eine Kaskade kein
-- Client: auf `public.tenants` haben anon und authenticated kein DELETE-Recht
-- und es gibt dort keine DELETE-Policy.
-- Unberuehrt bleibt, worum es hier geht: UPDATE ist fuer service_role
-- weiterhin gesperrt -- eine erteilte oder widerrufene Einwilligung laesst
-- sich nicht nachtraeglich umschreiben.
--
-- KORREKTUR (ZWEITE RUNDE, neuer Befund): Der Guard bekommt einen
-- INSERT-Zweig -- Entdopplung und Mengenbegrenzung. Begruendung im Rumpf.
create or replace function public.tracking_consents_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  juengste public.tracking_consents%rowtype;
  anzahl bigint;
begin
  -- INSERT: die Tabelle hatte weder Entdopplung noch Mengenbegrenzung, und ihr
  -- einziger Schreiber ist eine OEFFENTLICH aufrufbare Server Action, die fuer
  -- 'denied' und 'withdrawn' bewusst KEIN Rate-Limit hat
  -- (src/lib/consent/actions.ts:145-150; die Begruendung Art. 7 Abs. 3 DSGVO
  -- traegt fuer das Cookie, nicht fuer die Datenbankzeile -- das Cookie setzt
  -- dieselbe Action unabhaengig davon, ob der INSERT gelingt).
  -- Szenario: ein anonymer Aufrufer schickt setTrackingConsent('denied') in
  -- einer Schleife gegen einen Mandanten-Host. Jeder Aufruf schreibt eine
  -- Zeile; die Tabelle und ihr Index wachsen unbegrenzt, die
  -- Zustandsaufloesung (juengste Zeile je Subjekt) wird langsam und die
  -- DSGVO-Auskunft zu diesem Subjekt unlesbar.
  --
  -- Warum ein Trigger und KEIN unique index: der Schreiber wertet einen
  -- INSERT-Fehler als Misserfolg und bricht die zustimmende Richtung ab
  -- (actions.ts:200-206). Ein Nutzer, der zweimal auf "Annehmen" klickt,
  -- bekaeme dann eine Fehlermeldung, obwohl seine Einwilligung laengst im
  -- Nachweis steht -- der Riegel wuerde als Fehler erscheinen. Ein BEFORE
  -- INSERT-Trigger, der `null` zurueckgibt, laesst die Anweisung dagegen
  -- klaglos durchlaufen und schreibt nur nichts.
  --
  -- (1) ENTDOPPLUNG, semantisch statt zeitfensterbasiert: uebersprungen wird
  --     nur, was KEINE neue Auskunft traegt -- die juengste Zeile desselben
  --     Subjekts und derselben Kategorie sagt bereits dasselbe (gleiche
  --     `decision` UND gleiche `policy_version`). Die Kette Zustimmung ->
  --     Widerruf -> erneute Zustimmung bleibt damit vollstaendig, und eine
  --     erneute Zustimmung nach einer Textaenderung ebenfalls (andere
  --     policy_version). Verloren geht allein ein abweichender `ip_hash` einer
  --     inhaltsgleichen Wiederholung -- der Nachweis fuer diese Entscheidung
  --     existiert dann bereits.
  -- (2) MENGENBEGRENZUNG je Subjekt und Kategorie. 100 Entscheidungen sind fuer
  --     einen Menschen unerreichbar viel und fuer eine Schleife in Sekunden
  --     erreicht. Darueber wird nicht geworfen, sondern uebersprungen: ein
  --     Widerruf, der an einer Ausnahme scheitert, waere Art. 7 Abs. 3 DSGVO
  --     zuwider, und das Cookie -- der operative Zustand -- setzt die Action
  --     ohnehin unabhaengig vom INSERT.
  --     ACHTUNG, Grenze dieses Riegels: `subject_key` waehlt der Aufrufer
  --     (opake Consent-ID aus dem Cookie). Wer sie je Aufruf rotiert, umgeht
  --     die Begrenzung -- dagegen hilft nur ein Rate-Limit im Aufrufer, siehe
  --     VORAUSSETZUNG im Kopf dieser Datei.
  -- 'postgres'/'supabase_admin' bleiben aussen vor: ein Migrations- oder
  -- Dashboard-Eingriff soll genau das schreiben, was er schreibt.
  if tg_op = 'INSERT' then
    if current_user in ('postgres', 'supabase_admin') then
      return new;
    end if;

    select * into juengste
    from public.tracking_consents c
    where c.tenant_id = new.tenant_id
      and c.subject_kind = new.subject_kind
      and c.subject_key = new.subject_key
      and c.category = new.category
    order by c.created_at desc, c.id desc
    limit 1;

    if found
       and juengste.decision = new.decision
       and juengste.policy_version = new.policy_version then
      return null;                            -- inhaltsgleiche Wiederholung
    end if;

    select count(*) into anzahl
    from public.tracking_consents c
    where c.tenant_id = new.tenant_id
      and c.subject_kind = new.subject_kind
      and c.subject_key = new.subject_key
      and c.category = new.category;

    -- KORREKTUR 3. RUNDE (11.09.2026): Der Deckel galt vorher auch fuer einen
    -- WIDERRUF und tat damit genau das, wogegen der Absatz darueber
    -- argumentiert. `setTrackingConsent` hat fuer 'denied' bewusst kein
    -- Rate-Limit (src/lib/consent/actions.ts); wer 100-mal zwischen 'granted'
    -- und 'denied' wechselt, passiert jedes Mal die Entdopplung und erreicht
    -- den Deckel. Der naechste Klick auf "Widerrufen" setzte dann zwar das
    -- Cookie und meldete Erfolg -- `return null` ist kein Fehler, supabase-js
    -- sieht error = null --, die Zeile entstand aber nicht. Juengste Zeile
    -- blieb 'granted', und `resolveConsentRows()` lieferte serverseitig den
    -- falschen Zustand. Bei der einen Tabelle, die es ausschliesslich wegen
    -- Art. 7 Abs. 1 DSGVO gibt, und in der Richtung, die nie verlorengehen
    -- darf (Art. 7 Abs. 3 DSGVO: Widerruf so leicht wie die Erteilung).
    -- Der Deckel bleibt wirksam: eine WIEDERHOLTE 'withdrawn'-Zeile faengt
    -- die semantische Entdopplung eine Anweisung frueher ab, weil
    -- `juengste.decision` dann bereits 'withdrawn' ist. Nach Erreichen des
    -- Deckels entsteht also hoechstens EINE weitere Zeile je Subjekt und
    -- Kategorie, und nur bei einem echten Zustandswechsel.
    if anzahl >= 100 and new.decision <> 'withdrawn' then
      return null;                            -- Mengenbegrenzung
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if current_user in ('postgres', 'supabase_admin')
       or pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'tracking_consents_immutable';
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  raise exception 'tracking_consents_immutable';
end;
$$;

-- KORREKTUR (B11): `drop trigger if exists` vorangestellt -- der Trigger haengt
-- an einer `create or replace`-Funktion, ein zweiter Lauf dieses Abschnitts
-- soll nicht mit 42710 abbrechen.
-- KORREKTUR (ZWEITE RUNDE): `before insert or update or delete` statt
-- `before update or delete` -- der INSERT-Zweig oben traegt Entdopplung und
-- Mengenbegrenzung.
drop trigger if exists tracking_consents_guard_trg on public.tracking_consents;
create trigger tracking_consents_guard_trg before insert or update or delete on public.tracking_consents
  for each row execute function public.tracking_consents_guard();

-- Beim Feuern eines Triggers prueft Postgres kein EXECUTE-Recht (das geschieht
-- beim `create trigger`); entscheidend ist, dass `anon` ausdruecklich entfernt
-- wird -- `revoke from public` allein liesse den eigenen anon-Grant stehen
-- (Fund vom 07.09.2026). Nach jedem kuenftigen `create or replace` erneut
-- setzen.
revoke execute on function public.tracking_consents_guard() from public;
revoke execute on function public.tracking_consents_guard() from anon;
grant  execute on function public.tracking_consents_guard() to authenticated, service_role;

-- =================================================================
-- 3. RLS, Rechte, Policy
-- =================================================================
-- Kein Client liest oder schreibt diese Tabelle -- weder anonym noch
-- eingeloggt, auch kein Mandanten-Admin. Der Besucher sieht seinen eigenen
-- Zustand aus dem ct_consent-Cookie (src/lib/consent/read.ts), der Nachweis
-- selbst gehoert dem Verantwortlichen und wird bei Bedarf serverseitig mit
-- ausdruecklichem tenant_id-Filter gelesen. Der tatsaechliche Schutz ist das
-- `revoke all` plus das Fehlen jeder erlaubenden Policy; die Deny-Policy
-- darunter ist die auditierbare Absichtserklaerung fuer den Linter (sonst
-- entsteht der Dauerbefund "RLS Enabled No Policy", Plan 11.18).
--
-- In dieser Policy kommt `auth.uid()` nicht vor -- es gibt hier also auch
-- nichts als `(select auth.uid())` zu kapseln; die Vorgabe aus Plan 11.18
-- (Advisor `auth_rls_initplan`) greift erst, sobald ein Policy-Ausdruck den
-- Aufruf tatsaechlich enthaelt.
alter table public.tracking_consents enable row level security;
revoke all on public.tracking_consents from anon, authenticated;

create policy tracking_consents_deny_all
on public.tracking_consents
for all
to anon, authenticated
using (false)
with check (false);
