-- Affiliate-Modul, Block B3 "Klick und Attribution" (PLAN_Affiliate-System.md
-- Abschnitt 10/B3, 11.09.2026). Diese Datei setzt Abschnitt 3.6
-- (affiliate_clicks), 3.7 (affiliate_referrals), 3.8
-- (affiliate_customer_bindings) und 3.14 (affiliate_daily_stats) des Plans um,
-- dazu die datenbanknahen Teile der Attributionsregeln aus Abschnitt 4.
--
-- Sie setzt 20260910120000_affiliate_core.sql (B1) VORAUS: affiliate_programs,
-- affiliate_partners, affiliate_is_manager(), affiliate_partner_id(). Ohne
-- diese Datei bricht schon der erste zusammengesetzte Fremdschluessel ab.
-- 20260910120100_tracking_consents.sql (B2) ist fachlich vorausgesetzt
-- (`consent_at` unten verweist darauf), strukturell aber nicht.
--
-- ANLASS
-- Ein Klick auf einen Partnerlink muss serverseitig so festgehalten werden,
-- dass Wochen spaeter eine Bestellung eindeutig einem Partner zugeordnet werden
-- kann -- und zwar so, dass weder ein Partner noch ein Mandanten-Admin die
-- Zuordnung nachtraeglich verschieben kann. Ab hier haengt Geld an Zeilen, die
-- ein oeffentlich erreichbarer GET-Endpunkt schreibt. Gleichzeitig sind
-- Klickzeilen personenbezogen (IP-Hash, grobe User-Agent-Klasse): sie brauchen
-- eine Speicherdauer und einen Loeschweg, nicht nur einen Index.
--
-- BEFUND (lesend gegen die Live-Datenbank vklqksdiyiijzoirntyt, 11.09.2026)
--   1. Keine der vier Tabellen existiert (to_regclass = null fuer
--      affiliate_clicks, affiliate_referrals, affiliate_customer_bindings,
--      affiliate_daily_stats). Ebenso wenig affiliate_programs/-partners und
--      tracking_consents -- B1 und B2 sind geschrieben, aber NICHT angewendet.
--      Diese Datei ist damit die dritte unangewendete Migration in der Reihe;
--      sie muss in der Reihenfolge des Dateinamens nach beiden laufen.
--   2. `pg_cron` ist NICHT installiert (list_extensions: installed_version =
--      null). Ein Loeschlauf kann also nicht als Datenbank-Job eingerichtet
--      werden. Er entsteht hier deshalb als benannte Funktion, die der
--      bestehende Cron-Endpunkt aufruft (Plan 9.7,
--      src/app/api/admin/ki/process/route.ts mit x-cron-secret).
--   3. Neue Tabellen bekommen in diesem Projekt per `alter default privileges`
--      ALLE Rechte fuer anon UND authenticated -- pg_default_acl liest sich
--      woertlich `anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres`.
--      Dasselbe gilt fuer Funktionen (`anon=X/postgres`). `revoke` ist deshalb
--      die erste Schutzschicht, nicht Zierrat; gleicher Befund wie in
--      20260910120000 und 20260910120100.
--   4. `check_function_bodies` steht auf `on`. Alle Funktionen dieser Datei mit
--      Tabellenbezug sind `language plpgsql` (Rumpf wird erst bei der ersten
--      Ausfuehrung aufgeloest); die einzige `language sql`-Funktion,
--      affiliate_stats_day(), liest keine Tabelle. Die Reihenfolge ist damit
--      frei -- sie folgt trotzdem der Lesereihenfolge Tabelle -> Guard ->
--      Rechte -> Funktionen -> Policies.
--   5. Postgres 17.6. `on delete set null (spalte)` mit Spaltenliste ist ab
--      PG 15 verfuegbar (pg_constraint.confdelsetcols vorhanden) -- die
--      Korrektur B2 aus 20260910120000 ist hier also anwendbar und wird
--      angewendet, siehe Abweichung A1.
--   6. Die Zeitzone des Projekts ist `Europe/Berlin`
--      (src/lib/calendar/date.ts:27 CALENDAR_TIME_ZONE,
--      src/lib/certificates/pdf.ts:357). Die Tagesgrenze der Statistik folgt
--      dieser Festlegung, siehe Abweichung A9.
--
-- LOESUNG
-- Vier neue Tabellen, vier Guard-Trigger, drei Funktionen (Tagesgrenze,
-- Klick-Aufnahme, Loeschlauf) -- Tabelle, RLS und Policies jeweils im selben
-- Schritt (CLAUDE.md §2.1). Alle Betraege `int` in Cent, alle Saetze
-- Basispunkte (Plan G12); in dieser Datei kommen Betraege nur als Aggregate
-- vor. Keine Zeile dieser Datei wird von Anwendungscode gelesen, solange B3
-- nicht gebaut ist -- die Migration ist wie B1 inert.
--
-- VORBILDER
--   - Aufbau, Kommentardichte, zusammengesetzte Fremdschluessel, "genau eine
--     SELECT-Policy je Tabelle": 20260910120000_affiliate_core.sql.
--   - Spaltenrechte als zweite Ebene neben RLS (RLS trennt keine Spalten):
--     20260910120000, Abschnitt 4 und 6.
--   - Unveraenderlichkeit per Guard mit ERLAUBNISLISTE, Kaskade ueber
--     `pg_trigger_depth() > 1` statt ueber eine Rolle:
--     20260910120000, Abschnitt 7 (affiliate_audit_log_guard) und
--     20260910120100, Abschnitt 2 (tracking_consents_guard).
--   - Deny-Policy als auditierbare Absichtserklaerung fuer den Linter:
--     20260802121500_rate_limits_explicit_deny_policy.sql:1-20,
--     20260803100200_marketplace_ledger.sql:8-15.
--   - `revoke execute ... from anon` ZUSAETZLICH zu `from public`:
--     20260907093000_revoke_new_rpcs_from_anon.sql:1-19.
--   - Atomarer Zaehler in einem Statement statt Lesen-und-dann-Schreiben:
--     20260710235500_rate_limits.sql:20-45 (check_rate_limit).
--
-- =================================================================
-- ABWEICHUNGEN VOM PLAN (jede mit Grund, keine still)
-- =================================================================
-- A1  `foreign key (click_id, tenant_id) ... on delete set null` schreibt der
--     Plan (3.7) OHNE Spaltenliste. Das ist genau der Befund B2 aus dem
--     Gegenlesen von 20260910120000: Postgres nullt bei einem
--     zusammengesetzten SET NULL ALLE referenzierenden Spalten, also auch
--     `tenant_id` -- die `not null` ist. Der Loeschlauf auf affiliate_clicks
--     wuerde dann mit 23502 abbrechen und die 90-Tage-Frist waere nicht
--     einhaltbar. Hier steht deshalb `on delete set null (click_id)`.
-- A2  ZUSAETZLICHE FREMDSCHLUESSEL-INDIZES. Der Plan nennt je Tabelle nur die
--     Abfrage-Indizes. Jeder Fremdschluessel braucht aber einen Index in der
--     Spaltenreihenfolge des Schluessels, sonst meldet der Performance-Advisor
--     `unindexed_foreign_keys` und jede Elternloeschung wird zum Seq Scan
--     (20260807142948_shift_calendar_perf_fix.sql:8-15). Neu gegenueber dem
--     Plan sind: affiliate_clicks_program_idx, affiliate_referrals_program_idx,
--     affiliate_referrals_click_idx, affiliate_referrals_user_fk_idx,
--     affiliate_customer_bindings_program_idx,
--     affiliate_customer_bindings_user_idx, affiliate_daily_stats_program_idx,
--     affiliate_daily_stats_partner_idx. Jeder traegt seine Begruendung an Ort
--     und Stelle; affiliate_referrals_click_idx ist der wichtigste: ohne ihn
--     sucht der Loeschlauf je geloeschter Klickzeile die ganze
--     Referral-Tabelle ab.
-- A3  SPALTENRECHT AUF affiliate_referrals OHNE `token`. Der Plan sagt nur
--     "SELECT nur affiliate_is_manager". Das Token IST aber die Provision: wer
--     es kennt, haengt jede Bestellung an diesen Partner (`?aff=<token>`,
--     Plan 4.4 R5). Ein Tabellenrecht haette es jedem Mandanten-Admin in den
--     Browser gelegt. Begruendung ausfuehrlich in Abschnitt 2.
-- A4  NEUE FUNKTION public.affiliate_record_click(...). Der Plan setzt die
--     Tagesobergrenze (4.2 Schritt 6) und die Entdopplung in den
--     Anwendungscode (src/lib/affiliate/track.ts). Die Entdopplung ist als
--     `unique (tenant_id, dedup_key)` ohnehin ein Constraint; die
--     Tagesobergrenze waere ohne diese Funktion ein Lesen-und-dann-Schreiben
--     ueber drei Rundlaeufe -- zwei davon rennen gegeneinander, und der
--     Endpunkt hat ein Zeitbudget von 200 ms Serverzeit (Abnahme B3). Die
--     Funktion macht Deckelpruefung, Klickzeile und Tageszaehler zu EINEM
--     Rundlauf und ist damit zugleich die "pruefbare Struktur in der
--     Datenbank" statt einer Regel, die nur im TypeScript steht.
-- A5  NEUE FUNKTION public.affiliate_clicks_purge(...) plus 90-Tage-Frist.
--     Der Plan nennt die Frist im Fliesstext ("90-Tage-Loeschfrist"), aber
--     keinen Loeschweg. Ohne Weg ist die Frist eine Absichtserklaerung, und
--     die Tabelle waechst unbegrenzt mit personenbezogenen Daten (Art. 5
--     Abs. 1 lit. e DSGVO). Begruendung und die bewusst enge Rechtevergabe in
--     Abschnitt 5.
-- A6  GUARD-TRIGGER auf allen vier Tabellen. Der Plan nennt fuer diese vier
--     keine. Drei der vier tragen aber einen Zustand, an dem Geld haengt
--     (Zuordnung, Lifetime-Bindung, Tageszaehler), und der Serverbetrieb laeuft
--     unter `service_role`, das RLS umgeht und volle Tabellenrechte hat. Ohne
--     Guard gibt es fuer diese Tabellen ueberhaupt keinen Schutz gegen einen
--     falschen Filter in einer kuenftigen Server-Route.
-- A7  LAENGEN- UND FORMATSCHRANKEN auf allen Textspalten, die aus dem
--     oeffentlichen Klick-Endpunkt stammen. Gleicher Zusatz wie bei
--     tracking_consents.subject_key (20260910120100): eine unbegrenzte
--     Textspalte hinter einem oeffentlichen GET laedt zum Vollschreiben ein.
-- A8  SCHRANKEN AUF affiliate_referrals.expires_at (Plan nennt nur `not
--     null`): `expires_at > created_at` als CHECK, die Obergrenze von 366
--     Tagen im Guard. Plan 11.8 setzt fuer das Cookie eine harte Grenze von
--     365 Tagen; ohne Gegenstueck in der Datenbank waere eine unbegrenzte
--     Zuordnung eine einzige falsche Zahl weit entfernt.
-- A9  NEUE FUNKTION public.affiliate_stats_day(timestamptz). Der Plan sagt
--     nicht, in welcher Zeitzone `affiliate_daily_stats.day` liegt. Die Frage
--     hat zwei Antworten (UTC oder Ortszeit) und beide muessen an JEDER Stelle
--     dieselbe sein -- Klick-Aufnahme, Aggregationslauf (B4), Diagramm,
--     Tagesobergrenze. Deshalb genau eine Definition, und zwar `Europe/Berlin`
--     wie im uebrigen Projekt (CLAUDE.md §4.5: SPEC schweigt -> einfachste
--     Loesung, hier: die im Haus bereits getroffene).
-- A10 STATUSUEBERGAENGE auf affiliate_referrals: eine Zeile, die einmal
--     'superseded' oder 'revoked' war, wird nie wieder 'active'. Der Plan
--     kennt die Zustaende, aber keine Richtung. Ohne Richtung liesse sich eine
--     abgeloeste Zuordnung wiederbeleben -- das ist genau das Umhaengen, das
--     der Schnappschuss-Gedanke (Plan 3.7) verhindern soll.
--
-- =================================================================
-- DURCHSICHT "INSERT-PFAD" (Pflicht seit dem Gegenlesen von B1)
-- =================================================================
-- Die Frage ist fuer JEDE schuetzenswerte Spalte einzeln gestellt: ist sie
-- beim ANLEGEN ebenso geschuetzt wie beim AENDERN? Alle vier Guards sind
-- deshalb `before insert or update` (affiliate_clicks und affiliate_referrals
-- zusaetzlich `or delete`), mit dem `tg_op = 'INSERT'`-Zweig GANZ VORN -- beim
-- INSERT ist OLD nicht zugewiesen, jeder `old.`-Zugriff darueber waere ein
-- Laufzeitfehler (55000).
--   * affiliate_clicks.created_at -- beim Anlegen frei setzbar waere: eine
--     rueckdatierte Klickzeile faellt aus dem Loeschlauf heraus (der filtert
--     auf created_at) und verschiebt die Stundengrenze, an der `dedup_key`
--     haengt. Jetzt setzt der Guard sie auf now().
--   * affiliate_referrals.expires_at -- beim Anlegen frei setzbar waere: eine
--     Zuordnung auf 100 Jahre. Jetzt CHECK plus 366-Tage-Riegel im Guard.
--   * affiliate_referrals.status/user_id -- eine neue Zeile darf nicht schon
--     als 'revoked' entstehen (sonst ist sie tot, bevor sie wirkt) und nicht
--     schon an ein fremdes Konto gebunden sein. Beides im INSERT-Zweig.
--   * affiliate_customer_bindings.bound_at -- Zeitstempel der Lifetime-Zusage;
--     beim Anlegen frei setzbar waere er als Beweis wertlos. Jetzt now().
--   * affiliate_daily_stats.rebuilt_at -- dasselbe.
--   * GEPRUEFT UND SAUBER: keine der vier Tabellen hat ein INSERT-, UPDATE-
--     oder DELETE-Recht fuer anon/authenticated (Abschnitt 1-4, `revoke all`
--     plus gezieltes `grant select`). Der Client erreicht den INSERT-Pfad also
--     ueberhaupt nicht; die Guards schuetzen gegen `service_role`, und genau
--     dafuer sind sie da.
--   * GEPRUEFT UND SAUBER: jeder zusammengesetzte Fremdschluessel
--     `(x_id, tenant_id)` bindet die Kindzeile schon beim INSERT an denselben
--     Mandanten. Ein program_id/partner_id/click_id aus einem fremden
--     Mandanten scheitert am Fremdschluessel, nicht erst an einer Policy.
--
-- =================================================================
-- AUFBEWAHRUNG UND LOESCHUNG (Art. 5 Abs. 1 lit. e DSGVO)
-- =================================================================
--   affiliate_clicks            90 Tage, dann Loeschlauf (Abschnitt 5).
--                               `ip_hash` ist HMAC mit TAEGLICH rotierendem
--                               Salz (Plan 3.6) -- nach der Rotation ist die
--                               Zeile faktisch nicht mehr auf eine Person
--                               zurueckfuehrbar, die 90 Tage decken nur noch
--                               die Betrugspruefung.
--   affiliate_referrals         KEIN Loeschlauf in dieser Datei, und das ist
--                               eine Entscheidung: eine Referral-Zeile ist der
--                               Beleg, warum eine Provision entstanden ist.
--                               Ab B4 zeigt affiliate_commissions.referral_id
--                               darauf; ein Loeschlauf hier wuerde entweder am
--                               Fremdschluessel scheitern oder das
--                               Provisionsbuch entwurzeln. Personenbezug
--                               entsteht allein ueber `user_id`; der faellt
--                               mit der Kontoloeschung per `on delete set
--                               null` weg, und die Anonymisierung nach Plan
--                               7.8 ist der vorgesehene Weg. WER B9 BAUT,
--                               nimmt diese Tabelle in das Loeschkonzept auf.
--   affiliate_customer_bindings faellt mit dem Konto (`on delete cascade` auf
--                               profiles) -- der einzige Personenbezug IST die
--                               Konto-ID.
--   affiliate_daily_stats       aggregiert, kein Personenbezug, keine Frist.
--
-- =================================================================
-- PARTITIONIERUNG: BEWUSST NICHT (mit dem Grund, den der Plan nicht nennt)
-- =================================================================
-- Der Plan schiebt die Partitionierung von affiliate_clicks auf, weil
-- Tagesaggregate plus Loeschlauf die Laufzeit kaufen. Das stimmt, ist aber
-- nicht der harte Grund. Der harte Grund ist: eine UNIQUE-Constraint auf einer
-- partitionierten Tabelle MUSS alle Partitionsschluessel-Spalten enthalten.
-- Bei Partitionierung nach Monat (created_at) waeren damit BEIDE Constraints
-- dieser Tabelle nicht mehr anlegbar:
--   * `unique (tenant_id, dedup_key)` -- muesste `created_at` aufnehmen und
--     wuerde damit die Entdopplung aufweichen, die genau auf dem
--     Stundenfenster im dedup_key beruht;
--   * `unique (id, tenant_id)` -- und ohne dieses Paar gibt es den
--     zusammengesetzten Fremdschluessel von affiliate_referrals.click_id
--     nicht mehr.
-- Partitionierung ist hier also kein Schalter, sondern ein Umbau des
-- Zuordnungsmodells. Solange der Loeschlauf die Tabelle bei 90 Tagen haelt,
-- ist er die richtige Antwort; wer sie spaeter doch partitioniert, gibt den
-- Fremdschluessel auf click_id auf und muss ihn im Anwendungscode ersetzen.
--
-- =================================================================
-- FOLGEN FUER DEN ANWENDUNGSCODE (B3 und spaeter)
-- =================================================================
--   (1) `select('*')` bricht auf affiliate_clicks UND affiliate_referrals mit
--       42501 ab -- beide tragen ein SPALTENrecht, kein Tabellenrecht. Jede
--       Client-Abfrage MUSS ihre Spalten benennen. Dieselbe Falle wie bei
--       affiliate_partners/-billing_profiles/-conditions aus B1.
--       Client-Spalten affiliate_clicks: id, tenant_id, program_id,
--       partner_id, campaign, landing_path, referrer_host, country, is_bot,
--       created_at.
--       Client-Spalten affiliate_referrals: id, tenant_id, program_id,
--       partner_id, click_id, campaign, user_id, bound_at, status, expires_at,
--       created_at -- OHNE `token`.
--   (2) Klickzeile und Tageszaehler schreibt ausschliesslich
--       `affiliate_record_click(...)` (Abschnitt 5). src/lib/affiliate/track.ts
--       ruft die Funktion auf, statt die Regel ein zweites Mal in TypeScript zu
--       fuehren; der Rueckgabewert sagt, ob gezaehlt (`counted`), entdoppelt
--       (`deduped`) oder gedeckelt (`capped`) wurde. Nur bei `counted = true`
--       und `deduped = false` lohnt eine Referral-Zeile.
--   (3) Der Loeschlauf `affiliate_clicks_purge()` gehoert in den bestehenden
--       Cron-Endpunkt (Plan 9.7). Er laeuft stapelweise und gibt die Zahl der
--       geloeschten Zeilen zurueck -- der Aufrufer wiederholt, solange das
--       Ergebnis dem Stapellimit entspricht.
--   (4) Die Tagesgrenze der Statistik ist `affiliate_stats_day(now())`
--       (Europe/Berlin). Jeder weitere Schreiber auf affiliate_daily_stats --
--       insbesondere der Aggregationslauf aus B4 -- benutzt dieselbe Funktion,
--       sonst zerfaellt der Tag in zwei Definitionen.
--   (5) types.ts braucht die Zeilen-Typen und die beiden Spaltenlisten aus (1);
--       sie fehlen dort heute. Das ist eine Aenderung an
--       src/lib/affiliate/types.ts, nicht an dieser Migration.
--
-- =================================================================
-- DIESE MIGRATION IST NICHT ANGEWENDET
-- =================================================================
-- Sie wurde in dieser Umgebung auch nicht probeweise gefahren -- es gibt kein
-- lokales Postgres, keinen Docker und keine supabase/config.toml (Plan 12.7).
-- Das Anwenden bleibt Josip vorbehalten (CLAUDE.md §4.6); der Dateiname traegt
-- bis dahin einen Platzhalter-Zeitstempel, weil `apply_migration` die Version
-- nach Ausfuehrungszeitpunkt vergibt. Reihenfolge: 20260910120000, dann
-- 20260910120100, dann 20260910120200, dann DIESE.
-- Danach `get_advisors(security)` UND `get_advisors(performance)` laufen
-- lassen.
-- ERWARTUNG FUER DIESEN LAUF, damit niemand sie fuer eine Regression haelt:
--   * KEIN neuer Treffer der Klassen
--     `anon_security_definer_function_executable` (Stand 11.09.2026: 17) und
--     `authenticated_security_definer_function_executable` (Stand: 22). Die
--     einzige neue SECURITY-DEFINER-Funktion dieser Datei ist
--     affiliate_clicks_purge(), und sie ist ausdruecklich nur fuer
--     `service_role` ausfuehrbar -- beide Lints pruefen anon bzw.
--     authenticated.
--   * KEIN neuer `rls_enabled_no_policy` (Stand: 2, marketplace_ledger und
--     platform_settings): jede der vier Tabellen bekommt eine echte
--     SELECT-Policy und zusaetzlich die Deny-Policy als Absichtserklaerung.
--   * Der Performance-Advisor kann `unused_index` fuer die neuen Indizes
--     melden, solange kein Anwendungscode sie benutzt. Das ist bei einer
--     inerten Migration erwartbar und kein Grund, einen FK-Index zu streichen.
--
-- WIEDERHOLBARKEIT: wie in 20260910120000 bewusst NICHT nachgeruestet. `create
-- table if not exists` wuerde eine bestehende, inhaltlich abweichende Tabelle
-- stillschweigend durchwinken -- ein sauberer Abbruch mit 42P07 ist die
-- ehrlichere Auskunft, und solange `create table` abbricht, werden Indizes,
-- Trigger und Policies derselben Tabelle gar nicht erst erreicht. Vor jedem
-- `create trigger` steht trotzdem ein `drop trigger if exists`, weil die
-- Trigger an `create or replace`-Funktionen haengen.

-- =================================================================
-- 1. affiliate_clicks (Plan 3.6) -- die Rohaufzeichnung
-- =================================================================
-- Pruefpfad und Betrugsbasis, NICHT Statistikquelle: die Auswertung liest
-- ausschliesslich affiliate_daily_stats (Abschnitt 4). Das ist die
-- schnellstwachsende Tabelle des Moduls -- deshalb schlank, indexarm und mit
-- Loeschfrist.

create table public.affiliate_clicks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  program_id    uuid not null,
  partner_id    uuid not null,

  -- Kampagnenkennung aus `?cam=`; dasselbe Muster wie
  -- AFFILIATE_CAMPAIGN_PATTERN (src/lib/affiliate/schema.ts). Schranke als
  -- Zusatz zum Plan (A7): der Wert stammt aus einem oeffentlich erreichbaren
  -- GET, eine unbegrenzte Textspalte laedt zum Vollschreiben ein.
  campaign      text check (campaign is null or campaign ~ '^[A-Za-z0-9_.-]{1,64}$'),

  -- Validierter INTERNER Pfad, nie eine fremde URL (Plan G11). Der zweite
  -- Zeichenvergleich ist kein Zierrat: '//boese.example' ist ein
  -- protokollrelativer Verweis und waere als Weiterleitungsziel eine offene
  -- Weiterleitung. Das Muster laesst ihn nicht zu, weil nach dem fuehrenden
  -- '/' ein Buchstabe oder eine Ziffer stehen muss.
  landing_path  text check (landing_path is null or landing_path = '/'
                            or landing_path ~ '^/[a-z0-9][a-z0-9/-]{0,198}$'),

  -- Nur der Host, nie die volle Referrer-URL (die traegt Suchbegriffe und
  -- Sitzungskennungen fremder Seiten). Zeichenklasse und Laenge statt
  -- vollstaendiger Hostnamen-Grammatik -- die prueft zod im Endpunkt, hier
  -- geht es um die Schranke.
  referrer_host text check (referrer_host is null or
                            (char_length(referrer_host) between 1 and 253
                             and referrer_host ~ '^[a-z0-9.-]+$')),

  -- Grobe Klasse ('chrome', 'safari', 'bot'), nie der volle User-Agent: der
  -- ist zusammen mit der IP ein Wiedererkennungsmerkmal (Fingerprinting).
  ua_family     text check (ua_family is null or ua_family ~ '^[A-Za-z0-9 ._-]{1,40}$'),

  country       text check (country is null or country ~ '^[A-Z]{2}$'),

  -- HMAC-SHA-256 der IP mit TAEGLICH rotierendem Salz (Plan 3.6), nie die IP.
  -- Reicht fuer Entdopplung und Tagesheuristik und macht die Zeile nach der
  -- Rotation faktisch nicht mehr rueckfuehrbar.
  ip_hash       text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),

  is_bot        boolean not null default false,

  -- Gesetzt, wenn zum Zeitpunkt des Klicks eine Einwilligung vorlag und ein
  -- Cookie gesetzt werden durfte (tracking_consents, Block B2). Null heisst:
  -- einwilligungsfreier Pfad ueber `?aff=`.
  consent_at    timestamptz,

  -- sha256(partner|ip_hash|ua_family|YYYYMMDDHH), Plan 3.6. Traegt das
  -- Stundenfenster in sich -- die Entdopplung ist damit ein Constraint statt
  -- einer Abfrage: `insert ... on conflict (tenant_id, dedup_key) do nothing`,
  -- ein Statement, kein Vorab-SELECT.
  dedup_key     text not null check (dedup_key ~ '^[0-9a-f]{64}$'),

  created_at    timestamptz not null default now(),

  unique (tenant_id, dedup_key),
  -- Gegenstueck fuer den zusammengesetzten Fremdschluessel aus
  -- affiliate_referrals.click_id (Abschnitt 2).
  unique (id, tenant_id),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade
);

-- Kein `updated_at` und kein `_touch`-Trigger: Klickzeilen werden nie
-- geaendert (der Guard unten weist jedes UPDATE ab), und ein `updated_at` ohne
-- Trigger veraltet dauerhaft (20260803100100:53-60).

-- Abfrage-Index des Plans: die Klickliste eines Partners, absteigend nach
-- Zeit. Deckt zugleich den Fremdschluessel (partner_id, tenant_id) ab.
create index affiliate_clicks_partner_idx on public.affiliate_clicks (partner_id, tenant_id, created_at desc);

-- Loeschlauf-Index des Plans: `where created_at < ...` (Abschnitt 5).
create index affiliate_clicks_cleanup_idx on public.affiliate_clicks (created_at);

-- ZUSATZ (A2): Fremdschluessel (program_id, tenant_id). Der Preis ist bewusst
-- bezahlt und hier hoeher als anderswo -- das ist die schreiblastigste Tabelle
-- des Moduls, jeder Index kostet bei jedem Klick. Er bleibt trotzdem, aus zwei
-- Gruenden: erstens meldet der Performance-Advisor sonst dauerhaft
-- `unindexed_foreign_keys`, und ein Dauerbefund macht die Liste wertlos;
-- zweitens ist die Kaskade beim Loeschen eines Programms ohne ihn ein Seq Scan
-- ueber die groesste Tabelle des Moduls.
-- Zur Abwaegung, falls jemand ihn spaeter streichen will: `unique (tenant_id,
-- dedup_key)` fuehrt tenant_id an erster Stelle und ist damit fuer die Kaskade
-- grundsaetzlich benutzbar (Gleichheit auf tenant_id, program_id als Filter) --
-- der Advisor-Befund bliebe aber, und die Kaskade laese den halben
-- Mandantenbestand statt weniger Zeilen.
create index affiliate_clicks_program_idx on public.affiliate_clicks (program_id, tenant_id);

-- Guard OHNE `security definer`, weil die Funktion `current_user` sehen muss --
-- unter `security definer` waere das immer der Funktionseigentuemer und die
-- Erlaubnisliste damit wirkungslos (empirisch belegt in 20260909183548:70-75).
-- Die Liste ist eine ERLAUBNISLISTE, keine Sperrliste: eine kuenftige, hier
-- unbekannte Rolle faellt in den geschuetzten Zweig statt still durchzurutschen.
create or replace function public.affiliate_clicks_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- INSERT-Zweig GANZ VORN: beim INSERT ist OLD nicht zugewiesen, jeder
  -- `old.`-Zugriff darunter waere ein Laufzeitfehler (55000).
  -- Geschuetzt wird hier genau eine Spalte, und die ist es wert: `created_at`.
  -- Sie entscheidet, ob eine Zeile in den Loeschlauf faellt (Abschnitt 5, er
  -- filtert auf created_at) und in welchen Tag sie zaehlt. Eine rueckdatierte
  -- Klickzeile ist deshalb nicht "unsauber", sondern unsichtbar -- fuer die
  -- Frist wie fuer die Statistik.
  if tg_op = 'INSERT' then
    if current_user in ('postgres', 'supabase_admin') then
      return new;
    end if;
    new.created_at := now();
    return new;
  end if;

  -- DELETE: erlaubt sind Migrationen und Dashboard-Eingriffe -- und ueber sie
  -- der Loeschlauf, weil affiliate_clicks_purge() `security definer` ist und
  -- `current_user` dort der Eigentuemer 'postgres' ist. 'service_role', also
  -- der normale Serverbetrieb, steht NICHT in der Liste: eine Route mit
  -- createAdminClient() und einem falschen Filter soll die Betrugsgrundlage
  -- nicht zeilenweise raeumen koennen. Der Weg dahin ist genau eine benannte,
  -- stapelbegrenzte Funktion mit Mindestfrist.
  -- `pg_trigger_depth() > 1` gibt zusaetzlich die KASKADE frei (Mandant,
  -- Programm oder Partner geloescht) -- an der HERKUNFT der Anweisung statt an
  -- der Rolle, weil eine ON-DELETE-Kaskade nicht unter der Rolle des Aufrufers
  -- laeuft. Die Zahl ist geprueft und nicht geraten: ein direktes `delete from
  -- public.affiliate_clicks` sieht bereits Tiefe 1 und wird NICHT
  -- durchgelassen; eine Kaskade ist immer mindestens zwei Ebenen tief, weil
  -- die RI-Aktion selbst ein Trigger auf der Elterntabelle ist. Ausfuehrliche
  -- Herleitung samt Beleg: 20260910120000, Abschnitt 7.
  if tg_op = 'DELETE' then
    if current_user in ('postgres', 'supabase_admin')
       or pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'affiliate_clicks_immutable';
  end if;

  -- UPDATE: es gibt keinen fachlichen Fall. Anders als beim Pruefpfad
  -- (20260910120000, Abschnitt 7) braucht dieser Zweig auch keine
  -- Kaskaden-Ausnahme: diese Tabelle hat keine Spalte mit `on delete set
  -- null`, es gibt also keinen Weg, auf dem eine fremde Loeschung hier ein
  -- UPDATE ausloest. WER JE EINE SOLCHE SPALTE ERGAENZT, muss diesen Zweig um
  -- den `pg_trigger_depth() > 1`-Ausweg erweitern -- sonst endet die
  -- Kontoloeschung mit 'affiliate_clicks_immutable'.
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  raise exception 'affiliate_clicks_immutable';
end;
$$;

drop trigger if exists affiliate_clicks_guard_trg on public.affiliate_clicks;
create trigger affiliate_clicks_guard_trg before insert or update or delete on public.affiliate_clicks
  for each row execute function public.affiliate_clicks_guard();

alter table public.affiliate_clicks enable row level security;
-- Erst wegnehmen, dann gezielt zurueckgeben (pg_default_acl vergibt sonst
-- alles an anon und authenticated).
revoke all on public.affiliate_clicks from anon, authenticated;

-- SPALTENRECHTE als zweite Ebene, weil RLS keine Spalten trennt. `ip_hash`,
-- `ua_family` und `dedup_key` erreichen damit niemals einen Browser -- auch
-- nicht den eines Mandanten-Admins. `dedup_key` steht bewusst mit auf der
-- Verbotsliste, obwohl er "nur" ein Hash ist: er ist aus ip_hash und
-- ua_family gebildet und damit ein Wiedererkennungsmerkmal ueber Zeilen
-- hinweg -- genau das, was ip_hash nicht verlassen soll. `consent_at` bleibt
-- ebenfalls draussen (Plan 3.6 nennt es nicht in der Liste); es gibt heute
-- keinen Aufrufer, und wer einen baut, holt es serverseitig.
grant select (id, tenant_id, program_id, partner_id, campaign, landing_path,
              referrer_host, country, is_bot, created_at)
  on public.affiliate_clicks to authenticated;

-- =================================================================
-- 2. affiliate_referrals (Plan 3.7) -- der Zuordnungszustand
-- =================================================================
-- Eine Zeile je Klick mit einem undurchsichtigen Token, die Cookie und Geraet
-- ueberdauert und als Momentaufnahme in die Stripe-Metadata wandert. Die Zeile
-- wird NICHT verbraucht: sie kann viele Bestellungen tragen (Upsell,
-- Ratenzahlung, Abo). Ein Nachfolgerklick setzt die Vorgaengerzeile auf
-- 'superseded' und legt eine neue an -- er ueberschreibt sie nie. Genau daran
-- haengt der Schnappschuss-Gedanke: weil die Zuordnungsspalten unveraenderlich
-- sind, bedeutet das Token in der Stripe-Metadata dauerhaft denselben Partner.
-- Ein Upsert auf (tenant_id, user_id) waere das Gegenteil und wuerde exakt das
-- Umhaengen erlauben, das der Schnappschuss verhindern soll.
--
-- Eine Zeile mit gesetztem `user_id` und ohne zugehoerige Bestellung ist
-- zugleich der Lead -- dafuer braucht es keine eigene Tabelle.

create table public.affiliate_referrals (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  program_id  uuid not null,
  partner_id  uuid not null,
  click_id    uuid,

  -- 32 Zufallsbytes hex (64 Zeichen), undurchsichtig. Das Muster ist
  -- AFFILIATE_REFERRAL_TOKEN_PATTERN (src/lib/affiliate/schema.ts:67) --
  -- dieselbe Regel an beiden Enden, damit ein zu kurzes Token nicht erst im
  -- Betrieb auffaellt. Kuerze ist hier ein Geldrisiko: ein erratbares Token
  -- haengt fremde Bestellungen an einen Partner.
  token       text not null check (token ~ '^[0-9a-f]{64}$'),

  campaign    text check (campaign is null or campaign ~ '^[A-Za-z0-9_.-]{1,64}$'),

  -- Kontobindung nach Registrierung/Login (Plan 4.3). `on delete set null`,
  -- weil die Zuordnung selbst den Beleg fuer eine bereits entstandene
  -- Provision bildet und eine Kontoloeschung ihn nicht mitnehmen darf.
  user_id     uuid references public.profiles(id) on delete set null,
  bound_at    timestamptz,

  status      text not null default 'active' check (status in ('active','superseded','revoked')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),

  unique (tenant_id, token),
  unique (id, tenant_id),

  -- ZUSATZ (A8): eine Zuordnung, die vor ihrer Entstehung ablaeuft, ist ein
  -- Rechenfehler; die Obergrenze von 366 Tagen steht im Guard, weil sie
  -- `now()`-Arithmetik braucht und ein CHECK mit nicht-immutablen Ausdruecken
  -- beim Wiedereinspielen eines Dumps kippt.
  check (expires_at > created_at),

  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade,
  -- KORREKTUR GEGENUEBER DEM PLAN (A1): MIT SPALTENLISTE. Ohne sie nullt
  -- Postgres bei einem zusammengesetzten SET NULL ALLE referenzierenden
  -- Spalten -- also auch `tenant_id`, die `not null` ist. Der 90-Tage-
  -- Loeschlauf auf affiliate_clicks braeche dann mit 23502 ab, und damit die
  -- gesamte Aufbewahrungsfrist. Identischer Befund wie B2 in
  -- 20260910120000; PG 15+ vorausgesetzt, live laeuft 17.6.
  foreign key (click_id, tenant_id) references public.affiliate_clicks (id, tenant_id) on delete set null (click_id)
);

-- Lead-Liste und Regel R7 aus Plan 4.4 (Referral-Zeilen eines Kaeufers,
-- sortiert nach created_at je nach attribution_model). Partiell, weil die
-- grosse Mehrheit der Zeilen nie an ein Konto gebunden wird.
create index affiliate_referrals_user_idx on public.affiliate_referrals
  (tenant_id, user_id, created_at desc) where user_id is not null;

-- Die lebenden Zuordnungen eines Programms (Ablauf pruefen, aufraeumen).
create index affiliate_referrals_live_idx on public.affiliate_referrals
  (tenant_id, program_id, expires_at) where status = 'active';

-- Fremdschluessel (partner_id, tenant_id), zugleich die Partneransicht.
create index affiliate_referrals_partner_idx on public.affiliate_referrals (partner_id, tenant_id);

-- ZUSATZ (A2): Fremdschluessel (program_id, tenant_id). affiliate_referrals_live_idx
-- fuehrt zwar tenant_id an, ist aber partiell (`where status = 'active'`) und
-- damit fuer die Kaskade unbrauchbar -- die muss auch abgeloeste Zeilen finden.
create index affiliate_referrals_program_idx on public.affiliate_referrals (program_id, tenant_id);

-- ZUSATZ (A2), der wichtigste dieser Datei: Fremdschluessel (click_id,
-- tenant_id). Der Loeschlauf entfernt taeglich Klickzeilen; fuer JEDE
-- geloeschte Zeile muss Postgres die referenzierenden Referrals finden, um
-- click_id zu nullen. Ohne diesen Index ist das je Klickzeile ein Seq Scan
-- ueber die Referral-Tabelle -- der Loeschlauf waere quadratisch und damit
-- praktisch nicht durchfuehrbar. Partiell, weil nur gesetzte Werte gesucht
-- werden (die Suche ist immer `click_id = <uuid>`, nie `is null`).
create index affiliate_referrals_click_idx on public.affiliate_referrals (click_id, tenant_id)
  where click_id is not null;

-- ZUSATZ (A2): Fremdschluessel user_id -> profiles(id). Der Index oben fuehrt
-- tenant_id an und taugt fuer die Kaskade einer Kontoloeschung nicht.
create index affiliate_referrals_user_fk_idx on public.affiliate_referrals (user_id)
  where user_id is not null;

-- Guard OHNE `security definer` (braucht current_user), Erlaubnisliste wie
-- oben. Diese Funktion ist der eigentliche Schnappschuss-Schutz: sie nagelt
-- die Zuordnungsspalten fest, und zwar auch gegen `service_role`.
create or replace function public.affiliate_referrals_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- ---------------- INSERT (ganz vorn, OLD ist hier nicht zugewiesen) -------
  if tg_op = 'INSERT' then
    if current_user in ('postgres', 'supabase_admin') then
      return new;
    end if;

    new.created_at := now();

    -- A8: Obergrenze der Zuordnungsdauer. Plan 11.8 begrenzt das Cookie auf
    -- 365 Tage und affiliate_programs.cookie_ttl_days traegt denselben CHECK
    -- (20260910120000, Abschnitt 2). Ohne Gegenstueck HIER waere eine
    -- unbegrenzte Zuordnung eine einzige falsche Zahl im Anwendungscode weit
    -- entfernt -- und sie faellt niemandem auf, weil eine zu lange Zuordnung
    -- sich wie eine funktionierende verhaelt. 366 statt 365, damit ein
    -- Schaltjahr und die Sommerzeitstunde nicht an der Grenze kratzen.
    -- Abbruch statt stillem Kuerzen: die Laufzeit einer Zuordnung ist
    -- Vertragsinhalt gegenueber dem Partner, sie darf nicht unbemerkt eine
    -- andere werden.
    if new.expires_at > new.created_at + interval '366 days' then
      raise exception 'affiliate_referral_ttl_too_long';
    end if;

    -- Eine neue Zuordnung ist immer lebendig. Eine Zeile, die schon als
    -- 'revoked' entsteht, ist tot, bevor sie wirkt -- und eine, die schon als
    -- 'superseded' entsteht, taeuscht eine Vorgeschichte vor, die es nicht
    -- gibt. Beides waere ein Fehler im Aufrufer, kein Betriebsfall.
    if new.status <> 'active' then
      raise exception 'affiliate_referral_insert_must_be_active';
    end if;

    -- Die Kontobindung entsteht erst durch bindReferral() (Plan 4.3), nie
    -- beim Anlegen: beim Klick ist niemand angemeldet, und eine beim Anlegen
    -- mitgelieferte user_id waere eine Zuordnung auf ein fremdes Konto ohne
    -- jede Pruefung. `bound_at` folgt derselben Regel.
    -- ABBRUCH statt stillem Nullen -- die Lehre aus Befund Z10 in
    -- 20260910120000: ein Guard, der einen gefaehrlichen Wert stillschweigend
    -- umschreibt, laesst den Aufrufer im Glauben, es sei geschehen. Hier hiesse
    -- das: die Oberflaeche meldet "Zuordnung gebunden", und niemand merkt,
    -- dass sie es nicht ist.
    if new.user_id is not null or new.bound_at is not null then
      raise exception 'affiliate_referral_insert_must_be_unbound';
    end if;
    return new;
  end if;

  -- ---------------- DELETE --------------------------------------------------
  -- Eine Referral-Zeile ist der Beleg, warum eine Provision entstanden ist.
  -- Erlaubt sind Migration und Dashboard -- und die Kaskade ueber die
  -- HERKUNFT der Anweisung (`pg_trigger_depth() > 1`), nicht ueber eine Rolle.
  -- 'service_role' steht bewusst NICHT in der Liste; Herleitung wie in
  -- Abschnitt 1 und ausfuehrlich in 20260910120000, Abschnitt 7.
  if tg_op = 'DELETE' then
    if current_user in ('postgres', 'supabase_admin')
       or pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'affiliate_referrals_immutable';
  end if;

  -- ---------------- UPDATE --------------------------------------------------
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- KASKADEN-AUSWEG, eng gefasst und vor jeder anderen Pruefung. Zwei fremde
  -- Loeschungen schlagen als UPDATE hier auf:
  --   * `profiles`-Loeschung -> user_id per RI_FKey_setnull_del auf null;
  --   * der Klick-Loeschlauf  -> click_id per SET NULL auf null.
  -- Ohne diesen Zweig endete "Testnutzer loeschen" bzw. der taegliche
  -- Loeschlauf mit 'affiliate_referrals_immutable' -- dieselbe Klasse
  -- Totalblockade, die in 20260910120000 in der dritten Runde am Pruefpfad
  -- gefunden wurde. Erlaubt ist ausschliesslich das NULLEN genau dieser
  -- beiden Spalten aus einem Trigger heraus; jede andere Aenderung faellt
  -- weiter in die Festnagelung darunter. Der Vergleich laeuft ueber
  -- `to_jsonb(...) - 'click_id' - 'user_id'`, damit kein Feld unbemerkt
  -- mitreist.
  if pg_trigger_depth() > 1
     and ((old.click_id is not null and new.click_id is null)
       or (old.user_id  is not null and new.user_id  is null))
     and (new.click_id is null or new.click_id = old.click_id)
     and (new.user_id  is null or new.user_id  = old.user_id)
     and to_jsonb(new) - 'click_id' - 'user_id' = to_jsonb(old) - 'click_id' - 'user_id' then
    return new;
  end if;

  -- SCHNAPPSCHUSS: die Zuordnungsspalten sind fuer JEDE Rolle fest -- auch
  -- fuer 'service_role'. Wer partner_id oder token aendern koennte, koennte
  -- eine bereits in der Stripe-Metadata liegende Zuordnung nachtraeglich auf
  -- einen anderen Partner umhaengen, und zwar rueckwirkend fuer alle
  -- Bestellungen, die dieses Token noch tragen. Genau dafuer gibt es
  -- stattdessen die Umbuchung mit Pruefpfad (Plan 4.6): stornieren und neu
  -- buchen, sichtbar im Audit-Log.
  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.program_id := old.program_id;
  new.partner_id := old.partner_id;
  new.token      := old.token;
  new.campaign   := old.campaign;
  new.click_id   := old.click_id;
  new.expires_at := old.expires_at;
  new.created_at := old.created_at;

  -- A10: Statusrichtung. 'superseded' und 'revoked' sind Endzustaende. Ohne
  -- diese Schranke liesse sich eine abgeloeste Zuordnung wiederbeleben und
  -- damit eine aeltere Zuordnung ueber eine neuere stellen -- dasselbe
  -- Umhaengen, nur ueber eine andere Spalte.
  if old.status <> 'active' and new.status = 'active' then
    raise exception 'affiliate_referral_status_not_reversible';
  end if;

  -- Die Kontobindung ist einmalig (Plan 4.3: "referral.user_id <> auth.uid()
  -- -> NICHTS tun"). Einmal gebunden, bleibt gebunden -- sonst uebernaehme ein
  -- zweiter Nutzer auf demselben Geraet die Zuordnung des ersten.
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    new.user_id  := old.user_id;
    new.bound_at := old.bound_at;
  end if;

  return new;
end;
$$;

drop trigger if exists affiliate_referrals_guard_trg on public.affiliate_referrals;
create trigger affiliate_referrals_guard_trg before insert or update or delete on public.affiliate_referrals
  for each row execute function public.affiliate_referrals_guard();

alter table public.affiliate_referrals enable row level security;
revoke all on public.affiliate_referrals from anon, authenticated;

-- SPALTENRECHT statt Tabellenrecht (A3, Abweichung vom Plan). `token` ist kein
-- Datenfeld, sondern ein Inhaber-Geheimnis: wer es kennt, haengt mit
-- `?aff=<token>` jede eigene Bestellung an diesen Partner (Plan 4.4, R5) --
-- ohne Cookie, ohne Klick, von jedem Geraet aus. Ein Tabellenrecht haette es
-- jedem Mandanten-Admin in den Browser gelegt und zusaetzlich in jedes
-- PostgREST-Log, das eine Antwort mitschreibt. Der Manager braucht das Token
-- fuer keinen einzigen Vorgang: fuer den Attributionsstreit genuegen
-- partner_id, campaign, Zeitpunkt und Status, und fuer die Umbuchung arbeitet
-- er ohnehin ueber die Bestellung.
grant select (id, tenant_id, program_id, partner_id, click_id, campaign,
              user_id, bound_at, status, expires_at, created_at)
  on public.affiliate_referrals to authenticated;

-- =================================================================
-- 3. affiliate_customer_bindings (Plan 3.8) -- die Lifetime-Bindung
-- =================================================================
-- Getrennt von affiliate_referrals, weil sie eine andere Lebensdauer hat
-- (dauerhaft statt cookie_ttl_days) und eine andere Eindeutigkeit (genau ein
-- Partner je Kunde und Programm).
--
-- Die Bindung haengt an der Konto-ID, nicht an der E-Mail: E-Mail-Bindung ist
-- ueber Adresswechsel, Gross-/Kleinschreibung und Plus-Adressen angreifbar.
-- Geschrieben wird mit `on conflict do nothing` -- die erste Bindung gewinnt.

create table public.affiliate_customer_bindings (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  program_id uuid not null,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  partner_id uuid not null,
  source     text not null check (source in ('click','coupon','manual')),
  bound_at   timestamptz not null default now(),
  unique (tenant_id, program_id, user_id),
  unique (id, tenant_id),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade
);

-- Fremdschluessel (partner_id, tenant_id), zugleich "alle Kunden dieses
-- Partners" fuer den Aggregationslauf.
create index affiliate_customer_bindings_partner_idx
  on public.affiliate_customer_bindings (partner_id, tenant_id);

-- ZUSATZ (A2): Fremdschluessel (program_id, tenant_id). `unique (tenant_id,
-- program_id, user_id)` fuehrt tenant_id an und taugt fuer die
-- Programm-Kaskade nicht.
create index affiliate_customer_bindings_program_idx
  on public.affiliate_customer_bindings (program_id, tenant_id);

-- ZUSATZ (A2): Fremdschluessel user_id -> profiles(id). Ohne ihn ist jede
-- Kontoloeschung ein Seq Scan ueber diese Tabelle.
create index affiliate_customer_bindings_user_idx
  on public.affiliate_customer_bindings (user_id);

create or replace function public.affiliate_customer_bindings_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- INSERT-Zweig ganz vorn (OLD ist hier nicht zugewiesen). Geschuetzt wird
  -- `bound_at`: der Zeitstempel ist der Beleg dafuer, WANN die dauerhafte
  -- Zusage an diesen Partner entstanden ist. Frei setzbar waere er als Beleg
  -- wertlos -- und bei einem Streit zwischen zwei Partnern ist er genau das,
  -- worauf es ankommt.
  if tg_op = 'INSERT' then
    if current_user in ('postgres', 'supabase_admin') then
      return new;
    end if;
    new.bound_at := now();
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- UPDATE: Identitaet ist fest. Eine Bindung, die den Mandanten, das Programm
  -- oder den KUNDEN wechselt, ist keine geaenderte Bindung mehr, sondern eine
  -- andere -- und waere die stille Uebertragung einer Lifetime-Zusage auf
  -- einen fremden Kunden.
  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.program_id := old.program_id;
  new.user_id    := old.user_id;

  -- `partner_id` und `source` bleiben fuer 'service_role' AENDERBAR, und das
  -- ist eine Entscheidung, keine Luecke: Plan 3.8 sieht die Aenderung
  -- ausdruecklich vor ("eine Aenderung laeuft ausschliesslich ueber die
  -- Umbuchung mit Pruefpfad", Plan 4.6). Wer den Weg dicht machte, muesste
  -- ihn durch Loeschen-und-neu-Anlegen ersetzen -- dasselbe Ergebnis, nur
  -- ohne `id`-Stetigkeit fuer den Pruefpfad. Der Schutz liegt hier also nicht
  -- in der Datenbank, sondern in der Server Action, die den Audit-Eintrag
  -- schreibt; das ist in Plan 11.16 als eigener Pruefpunkt gefuehrt.
  -- Aus demselben Grund hat diese Funktion KEINEN DELETE-Zweig: die Bindung
  -- ist ein Zustand, kein Beweis. Der Beweis liegt in affiliate_audit_log und
  -- ab B4 in affiliate_commissions, und beide sind dort unveraenderlich.
  return new;
end;
$$;

drop trigger if exists affiliate_customer_bindings_guard_trg on public.affiliate_customer_bindings;
create trigger affiliate_customer_bindings_guard_trg before insert or update on public.affiliate_customer_bindings
  for each row execute function public.affiliate_customer_bindings_guard();

alter table public.affiliate_customer_bindings enable row level security;
revoke all on public.affiliate_customer_bindings from anon, authenticated;
-- Tabellenrecht statt Spaltenrecht, weil hier keine Spalte schuetzenswerter
-- ist als die Zeile selbst: `user_id` IST der Personenbezug, und wer die Zeile
-- sehen darf, darf ihn sehen. Die Auswahl trifft die Policy in Abschnitt 6 --
-- nur der Manager, nie ein Partner (Plan 11.15: ein Partner sieht nie
-- Kaeuferdaten).
grant select on public.affiliate_customer_bindings to authenticated;

-- =================================================================
-- 4. affiliate_daily_stats (Plan 3.14) -- der Tagescache
-- =================================================================
-- Die EINZIGE Statistikquelle fuer Partner und Admin-Diagramme, damit
-- Rohklicks serverseitig bleiben und die Auswertung nicht mit der Klicktabelle
-- mitwaechst. Ausdruecklich ein CACHE, keine zweite Wahrheit:
-- `commission_cents` und `reversal_cents` werden nicht fortgeschrieben,
-- sondern je Lauf aus affiliate_commissions fuer den betroffenen Tag NEU
-- BERECHNET und per Upsert ueberschrieben (Block B4) -- der Aggregationslauf
-- ist damit idempotent und selbstheilend. Die drei Klickzaehler dagegen WERDEN
-- fortgeschrieben, weil ihre Quelle nach 90 Tagen geloescht ist (Abschnitt 1)
-- und eine Neuberechnung sie dann nicht mehr herstellen koennte.

create table public.affiliate_daily_stats (
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  program_id       uuid not null,
  partner_id       uuid not null,
  -- Tagesgrenze in Europe/Berlin, siehe affiliate_stats_day() in Abschnitt 5.
  day              date not null,
  -- '' statt null, weil null in einem Primaerschluessel nicht vergleichbar
  -- waere und der Upsert dann je Klick eine neue Zeile erzeugte.
  campaign         text not null default ''
                     check (campaign = '' or campaign ~ '^[A-Za-z0-9_.-]{1,64}$'),

  -- Jeder angenommene Klick (auch ein entdoppelter Wiederholungsklick
  -- desselben Besuchers) -- die Bezugsgroesse der Tagesobergrenze.
  clicks           int not null default 0 check (clicks >= 0),
  -- Nur die Klicks, die eine neue Zeile in affiliate_clicks erzeugt haben,
  -- also je Besucher und Stunde hoechstens einer.
  unique_clicks    int not null default 0 check (unique_clicks >= 0),
  -- Teilmenge von `clicks`, nicht daneben: ein Bot-Klick zaehlt in beiden.
  bot_clicks       int not null default 0 check (bot_clicks >= 0),

  leads            int not null default 0 check (leads >= 0),
  orders_count     int not null default 0 check (orders_count >= 0),
  -- Betraege ohne `>= 0`-CHECK, anders als die Zaehler: eine Erstattung kann
  -- einen Tag rechnerisch ins Minus drehen (Plan 5.8), und ein CHECK wuerde
  -- dann den Aggregationslauf abbrechen statt die Wahrheit abzubilden.
  revenue_cents    int not null default 0,
  commission_cents int not null default 0,
  reversal_cents   int not null default 0,

  rebuilt_at       timestamptz not null default now(),

  primary key (tenant_id, partner_id, day, campaign),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade
);

-- Kein `unique (id, tenant_id)` und keine `id`-Spalte: diese Tabelle hat keine
-- Kindtabelle, die einen zusammengesetzten Fremdschluessel braeuchte (Plan
-- 11.1 verlangt das Paar nur fuer Kindtabellen), und der Primaerschluessel ist
-- der fachliche.

-- ZUSATZ (A2): Fremdschluessel (partner_id, tenant_id). Der Primaerschluessel
-- fuehrt tenant_id an und taugt fuer die Partner-Kaskade nicht.
create index affiliate_daily_stats_partner_idx
  on public.affiliate_daily_stats (partner_id, tenant_id);

-- ZUSATZ (A2): Fremdschluessel (program_id, tenant_id).
create index affiliate_daily_stats_program_idx
  on public.affiliate_daily_stats (program_id, tenant_id);

-- Kein eigener Index fuer die Tagesobergrenze: sie fragt
-- `where tenant_id = ? and partner_id = ? and day = ?` und das ist genau das
-- fuehrende Praefix des Primaerschluessels.

create or replace function public.affiliate_daily_stats_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('postgres', 'supabase_admin') then
      return new;
    end if;
    new.rebuilt_at := now();
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- UPDATE: Schluessel und Programmzuordnung sind fest. Die vier
  -- Schluesselspalten kann ein Upsert ohnehin nicht aendern; `program_id`
  -- schon, und ein Wechsel dort haenge die Tageszahlen eines Partners an ein
  -- fremdes Programm. In v1 gibt es genau ein Programm je Mandant (Plan 3.2),
  -- die Festnagelung kostet also nichts -- wer spaeter ein zweites Programm
  -- baut, verschiebt eine Tageszeile per Loeschen und Neuaufbau, nicht per
  -- UPDATE.
  new.tenant_id  := old.tenant_id;
  new.partner_id := old.partner_id;
  new.day        := old.day;
  new.campaign   := old.campaign;
  new.program_id := old.program_id;
  -- Der Zeitstempel sagt, wann der Cache zuletzt angefasst wurde. Ihn vom
  -- Aufrufer setzen zu lassen hiesse, einen veralteten Cache als frisch
  -- ausgeben zu koennen -- und genau daran haengt der Abgleichsbericht aus
  -- Plan 7.6.
  new.rebuilt_at := now();
  return new;
end;
$$;

drop trigger if exists affiliate_daily_stats_guard_trg on public.affiliate_daily_stats;
create trigger affiliate_daily_stats_guard_trg before insert or update on public.affiliate_daily_stats
  for each row execute function public.affiliate_daily_stats_guard();

alter table public.affiliate_daily_stats enable row level security;
revoke all on public.affiliate_daily_stats from anon, authenticated;
-- Tabellenrecht: jede Spalte ist ein Aggregat ueber die eigenen Zahlen des
-- Partners bzw. des Mandanten. Es gibt hier nichts, was die Zeile nicht
-- ohnehin verraet -- anders als bei affiliate_clicks und affiliate_referrals.
grant select on public.affiliate_daily_stats to authenticated;

-- =================================================================
-- 5. Funktionen: Tagesgrenze, Klick-Aufnahme, Loeschlauf
-- =================================================================

-- ---- 5.1 Tagesgrenze (A9) ------------------------------------------------
-- Genau EINE Definition, was ein "Tag" in affiliate_daily_stats ist. Der Plan
-- laesst die Frage offen; offen bleiben kann sie nicht, weil vier Stellen sie
-- gleich beantworten muessen (Klick-Aufnahme, Aggregationslauf aus B4,
-- Diagramm, Tagesobergrenze). Waehlt eine davon UTC und eine andere Ortszeit,
-- wandern Klicks zwischen 00:00 und 02:00 in den falschen Tag -- und die
-- Tagesobergrenze liesse sich in dieser Luecke verdoppeln.
-- `Europe/Berlin` ist keine neue Entscheidung, sondern die des Hauses:
-- src/lib/calendar/date.ts:27 (CALENDAR_TIME_ZONE) und
-- src/lib/certificates/pdf.ts:357. `stable`, nicht `immutable`: die Umrechnung
-- haengt an der Zeitzonendatenbank.
--
-- NICHT ZU VERWECHSELN mit dem UTC-Tag in src/lib/affiliate/hash.ts:95-107.
-- Der dortige `utcDayStamp`/`utcHourStamp` bestimmt die Rotation des
-- IP-Salzes und das Entdopplungsfenster und ist dort zu Recht UTC: Worker
-- laufen in wechselnden Regionen, und ein Salz, das je nach ausfuehrender
-- Region rotiert, machte denselben Klick zu zwei Zeilen. Hier geht es um den
-- BERICHTSTAG, den ein deutscher Haendler in seinem Diagramm sieht und an dem
-- die Tagesobergrenze haengt. Zwei verschiedene Fragen, zwei verschiedene
-- Antworten -- wer sie spaeter "vereinheitlicht", bricht entweder die
-- Entdopplung oder die Tagesgrenze der Auswertung.
create or replace function public.affiliate_stats_day(p_at timestamptz)
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (p_at at time zone 'Europe/Berlin')::date;
$$;

-- ---- 5.2 Klick-Aufnahme (A4) ---------------------------------------------
-- Der einzige Schreibweg auf affiliate_clicks und auf die drei Klickzaehler in
-- affiliate_daily_stats. Er buendelt drei Regeln aus Plan 4.2, die sonst als
-- drei Rundlaeufe im Anwendungscode staenden:
--   Schritt 6a  Tagesobergrenze je Partner und Tag (G18): 50 000. Darueber
--               wird GAR NICHTS geschrieben, nur zurueckgemeldet -- der
--               Endpunkt leitet trotzdem weiter, ein Besucher darf nie eine
--               Fehlerseite sehen, weil jemand anders eine Schleife faehrt.
--   Schritt 6b  Entdopplung als Constraint statt als Abfrage
--               (`on conflict (tenant_id, dedup_key) do nothing`).
--   Schritt 6c  Fortschreibung der Tageszaehler.
-- WARUM IN DER DATENBANK und nicht in track.ts: die Obergrenze ist ein
-- Lesen-und-dann-Schreiben. Zwischen dem Lesen des Zaehlers und dem Schreiben
-- der Zeile liegt im Anwendungscode ein Netzweg; zwei gleichzeitige Klicks
-- lesen denselben Stand. Hier liegt dazwischen nichts, und der Endpunkt
-- braucht statt drei Rundlaeufen einen -- er hat 200 ms Serverzeit (Abnahme
-- B3) und der Schreibvorgang liegt ausdruecklich VOR der Antwort (Plan 4.2),
-- kostet also unmittelbar Antwortzeit.
--
-- SECURITY INVOKER, also ausdruecklich NICHT `security definer`: der einzige
-- Aufrufer ist der Server unter `service_role` (die Rolle umgeht RLS und hat
-- volle Tabellenrechte). Mit `security definer` waere `current_user` im
-- Rumpf der Eigentuemer 'postgres' -- und damit fiele der Guard aus
-- Abschnitt 1 in seinen Erlaubniszweig und setzte `created_at` nicht mehr
-- serverseitig. Der Schutz soll aber auch fuer diesen Weg gelten.
--
-- BEWUSSTE GRENZE: die Deckelpruefung liest, bevor sie schreibt, und ist
-- damit nicht serialisierbar. Zwei gleichzeitige Aufrufe koennen beide knapp
-- unter der Grenze lesen. Die Ueberschreitung ist auf die Zahl gleichzeitiger
-- Anfragen begrenzt und bei einem Deckel von 50 000 ohne Bedeutung; ein
-- `for update` auf der Tageszeile waere ein Serialisierungspunkt auf dem
-- heissesten Pfad des Moduls und der schlechtere Tausch. Der eigentliche
-- Schutz gegen Massenklicks ist ohnehin die Cloudflare-Regel vor dem Endpunkt
-- (G18, Abnahmebedingung von B3).
create or replace function public.affiliate_record_click(
  p_tenant_id     uuid,
  p_program_id    uuid,
  p_partner_id    uuid,
  p_dedup_key     text,
  p_campaign      text        default null,
  p_landing_path  text        default null,
  p_referrer_host text        default null,
  p_ua_family     text        default null,
  p_country       text        default null,
  p_ip_hash       text        default null,
  p_is_bot        boolean     default false,
  p_consent_at    timestamptz default null
)
returns table (click_id uuid, counted boolean, deduped boolean, capped boolean)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  -- Plan 4.2 Schritt 6: 50 000 Klicks je Partner und Tag. Die Zahl steht
  -- genau hier, damit sie nicht in TypeScript und SQL auseinanderlaufen kann.
  c_daily_cap constant bigint := 50000;
  v_day       date;
  v_used      bigint;
  v_campaign  text;
  v_click_id  uuid;
begin
  v_day := public.affiliate_stats_day(now());
  -- Leere Kampagne und fehlende Kampagne sind dasselbe; in affiliate_clicks
  -- ist das null, in affiliate_daily_stats '' (dort Teil des Schluessels).
  v_campaign := nullif(btrim(coalesce(p_campaign, '')), '');

  -- Deckel ueber ALLE Kampagnen desselben Partners: der Deckel je Zeile waere
  -- durch einfaches Variieren von `?cam=` beliebig oft zu haben.
  select coalesce(sum(s.clicks), 0) into v_used
  from public.affiliate_daily_stats s
  where s.tenant_id = p_tenant_id
    and s.partner_id = p_partner_id
    and s.day = v_day;

  if v_used >= c_daily_cap then
    return query select null::uuid, false, false, true;
    return;
  end if;

  -- Die Mandantenbindung von program_id und partner_id prueft der
  -- zusammengesetzte Fremdschluessel, nicht diese Funktion: ein Wertepaar aus
  -- einem fremden Mandanten scheitert an der Datenbank, nicht an einer
  -- Bedingung, die jemand spaeter umformuliert (CLAUDE.md §2.15).
  insert into public.affiliate_clicks (
    tenant_id, program_id, partner_id, campaign, landing_path, referrer_host,
    ua_family, country, ip_hash, is_bot, consent_at, dedup_key
  ) values (
    p_tenant_id, p_program_id, p_partner_id, v_campaign, p_landing_path, p_referrer_host,
    p_ua_family, p_country, p_ip_hash, coalesce(p_is_bot, false), p_consent_at, p_dedup_key
  )
  on conflict (tenant_id, dedup_key) do nothing
  returning id into v_click_id;

  -- `clicks` zaehlt auch den entdoppelten Wiederholungsklick: sonst waere die
  -- Tagesobergrenze wirkungslos, denn Cookie-Stuffing wiederholt genau
  -- dieselbe Kennung. `unique_clicks` zaehlt nur die neu entstandene Zeile.
  insert into public.affiliate_daily_stats as s (
    tenant_id, program_id, partner_id, day, campaign, clicks, unique_clicks, bot_clicks
  ) values (
    p_tenant_id, p_program_id, p_partner_id, v_day, coalesce(v_campaign, ''), 1,
    case when v_click_id is null then 0 else 1 end,
    case when coalesce(p_is_bot, false) then 1 else 0 end
  )
  on conflict (tenant_id, partner_id, day, campaign) do update
    set clicks        = s.clicks        + 1,
        unique_clicks = s.unique_clicks + excluded.unique_clicks,
        bot_clicks    = s.bot_clicks    + excluded.bot_clicks;

  return query select v_click_id, true, v_click_id is null, false;
end;
$$;

-- ---- 5.3 Loeschlauf (A5) --------------------------------------------------
-- Die 90-Tage-Frist aus Plan 3.6 als ausfuehrbarer Weg statt als Satz im
-- Fliesstext. Ohne ihn waechst eine Tabelle mit personenbezogenen Daten
-- (IP-Hash, User-Agent-Klasse) unbegrenzt weiter -- Art. 5 Abs. 1 lit. e
-- DSGVO ist keine Empfehlung, und der Betreiber muesste die Frist sonst von
-- Hand einhalten.
--
-- WARUM EINE FUNKTION UND KEIN JOB: `pg_cron` ist in diesem Projekt nicht
-- installiert (lesend geprueft, 11.09.2026). Der Lauf haengt deshalb am
-- bestehenden Cron-Endpunkt mit `x-cron-secret` (Plan 9.7).
--
-- WARUM `security definer`: der Guard aus Abschnitt 1 verbietet 'service_role'
-- das Loeschen von Klickzeilen. Diese Funktion gehoert 'postgres' (die Rolle,
-- unter der Migrationen laufen); im Rumpf ist `current_user` damit 'postgres'
-- und faellt in die Erlaubnisliste des Guards. Das ist die ganze Absicht:
-- Klickzeilen verschwinden ausschliesslich ueber DIESEN benannten, begrenzten
-- Weg -- nicht ueber einen `delete`-Aufruf in irgendeiner Server-Route mit
-- einem falschen Filter.
--
-- Der Stapel ist begrenzt, weil ein `delete` ueber Millionen Zeilen in einem
-- Rutsch die Tabelle lange sperrt und das Anweisungs-Zeitlimit des
-- Cron-Aufrufs reisst. Der Aufrufer wiederholt, solange die Rueckgabe dem
-- Stapellimit entspricht.
create or replace function public.affiliate_clicks_purge(
  p_retention_days int default 90,
  p_limit          int default 20000
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted int;
begin
  -- Untergrenze 30 Tage: ohne sie waere `p_retention_days => 0` ein
  -- Ein-Parameter-Weg, die gesamte Betrugsgrundlage zu loeschen -- und zwar
  -- ueber genau die Funktion, die als einzige loeschen darf. Obergrenze, damit
  -- ein Vertipper nicht stillschweigend gar nichts tut und die Frist dadurch
  -- unbemerkt ausfaellt.
  if p_retention_days is null or p_retention_days < 30 or p_retention_days > 400 then
    raise exception 'affiliate_clicks_purge_invalid_retention';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200000 then
    raise exception 'affiliate_clicks_purge_invalid_limit';
  end if;

  -- `skip locked` statt Warten: der Lauf ist wiederholbar, eine gerade
  -- gesperrte Zeile faellt einfach in den naechsten Stapel. Wichtiger ist,
  -- dass er nie an einer laufenden Klickaufnahme haengen bleibt.
  with doomed as (
    select c.id
    from public.affiliate_clicks c
    where c.created_at < now() - make_interval(days => p_retention_days)
    order by c.created_at
    limit p_limit
    for update skip locked
  )
  delete from public.affiliate_clicks t
  using doomed d
  where t.id = d.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---- 5.4 Ausfuehrungsrechte der drei Funktionen --------------------------
-- Der doppelte `revoke` ist Pflicht und kein Copy-Paste: `revoke ... from
-- public` entfernt das EXECUTE-Recht der Rolle `anon` NICHT, weil Supabase es
-- ueber `alter default privileges` als eigenen Grant vergibt (live in
-- pg_default_acl nachgelesen: `anon=X/postgres`; Fund vom 07.09.2026,
-- 20260907093000_revoke_new_rpcs_from_anon.sql:1-19). Dasselbe gilt fuer
-- `authenticated`. Nach JEDEM kuenftigen `create or replace` erneut setzen.
--
-- Alle drei bleiben ausschliesslich `service_role` vorbehalten. Keine davon
-- gehoert in die Haende eines Clients:
--   * affiliate_stats_day    -- harmlos, aber ohne Aufrufer im Browser;
--   * affiliate_record_click -- schriebe Klickzeilen frei erfundener Partner;
--   * affiliate_clicks_purge -- loescht, als einzige Funktion dieses Moduls.
-- Nebenwirkung, die so gewollt ist: keine der drei taucht in den Advisor-Lints
-- `anon_security_definer_function_executable` bzw.
-- `authenticated_security_definer_function_executable` auf, weil beide genau
-- diese zwei Rollen pruefen.
revoke execute on function public.affiliate_stats_day(timestamptz) from public;
revoke execute on function public.affiliate_stats_day(timestamptz) from anon;
revoke execute on function public.affiliate_stats_day(timestamptz) from authenticated;
grant  execute on function public.affiliate_stats_day(timestamptz) to service_role;

revoke execute on function public.affiliate_record_click(uuid, uuid, uuid, text, text, text, text, text, text, text, boolean, timestamptz) from public;
revoke execute on function public.affiliate_record_click(uuid, uuid, uuid, text, text, text, text, text, text, text, boolean, timestamptz) from anon;
revoke execute on function public.affiliate_record_click(uuid, uuid, uuid, text, text, text, text, text, text, text, boolean, timestamptz) from authenticated;
grant  execute on function public.affiliate_record_click(uuid, uuid, uuid, text, text, text, text, text, text, text, boolean, timestamptz) to service_role;

revoke execute on function public.affiliate_clicks_purge(int, int) from public;
revoke execute on function public.affiliate_clicks_purge(int, int) from anon;
revoke execute on function public.affiliate_clicks_purge(int, int) from authenticated;
grant  execute on function public.affiliate_clicks_purge(int, int) to service_role;

-- =================================================================
-- 6. Policies (je Tabelle genau eine SELECT-Policy, G17)
-- =================================================================
-- Zum Mitlesen (Plan G17, woertlich): eine zweite permissive Policy kann einer
-- bestehenden nichts wegnehmen (sie werden ver-ODERt) und kostet
-- Auswertungszeit pro Zeile. Eine einschraenkend gemeinte Bedingung muss IN
-- die konsolidierte SELECT-Policy hinein.
-- Die `for all ... using (false)`-Deny-Policy steht trotzdem bei jeder
-- Tabelle, aber ausschliesslich als auditierbare Absichtserklaerung fuer den
-- Linter (sonst Dauerbefund `rls_enabled_no_policy`, Plan 11.18). Der
-- tatsaechliche Schutz ist das `revoke all` oben plus das Fehlen jeder
-- INSERT/UPDATE/DELETE-Policy -- der Plan schreibt dieses Paar in 3.6
-- woertlich so vor.
--
-- `auth.uid()` kommt in keinem dieser Ausdruecke vor: die Zuordnung laeuft
-- ueber affiliate_is_manager() und affiliate_partner_id(), die beide
-- `security definer` und `stable` sind und den Aufrufer selbst aufloesen. Die
-- Vorgabe aus Plan 11.18 (`(select auth.uid())` statt nacktem `auth.uid()`,
-- Advisor `auth_rls_initplan`) greift erst, sobald ein Policy-Ausdruck den
-- Aufruf tatsaechlich enthaelt -- hier gibt es also nichts zu kapseln.
-- Gleiche Lage wie in 20260910120100, Abschnitt 3.

-- --- affiliate_clicks -------------------------------------------
-- Nur der Manager (owner/admin), und auch der nur auf den Spalten aus
-- Abschnitt 1. Ein Partner sieht Klicks AUSSCHLIESSLICH aggregiert ueber
-- affiliate_daily_stats -- eine Rohklickliste waere fuer ihn ein
-- Bewegungsprotokoll seiner Besucher, und er ist nicht der Verantwortliche
-- dafuer. Geschrieben wird ausschliesslich vom Klick-Endpunkt ueber
-- `service_role` (Abschnitt 5.2).
create policy affiliate_clicks_select on public.affiliate_clicks for select using (
  public.affiliate_is_manager(tenant_id)
);
create policy affiliate_clicks_deny_write on public.affiliate_clicks
  for all to anon, authenticated using (false) with check (false);

-- --- affiliate_referrals ----------------------------------------
-- Ebenfalls nur der Manager: er braucht die Zuordnung fuer den
-- Attributionsstreit und die Umbuchung (Plan 4.6). Der Partner sieht Leads
-- nur aggregiert (`affiliate_daily_stats.leads`) -- eine Zeilenliste wuerde
-- ihm ueber `user_id` verraten, WELCHE Konten er geworben hat, und das ist
-- Kundendatenbestand des Mandanten, nicht seiner (Plan 11.15).
-- Das Token bleibt zusaetzlich ueber das Spaltenrecht draussen, auch fuer den
-- Manager -- RLS trennt keine Spalten.
create policy affiliate_referrals_select on public.affiliate_referrals for select using (
  public.affiliate_is_manager(tenant_id)
);
create policy affiliate_referrals_deny_write on public.affiliate_referrals
  for all to anon, authenticated using (false) with check (false);

-- --- affiliate_customer_bindings --------------------------------
-- Nur der Manager. Die Zeile sagt "dieser Kunde gehoert dauerhaft diesem
-- Partner" -- fuer den Partner waere das eine Kundenliste, fuer den Kunden
-- eine Auskunft ueber sich selbst, die er nicht ueber PostgREST holen soll.
create policy affiliate_customer_bindings_select on public.affiliate_customer_bindings for select using (
  public.affiliate_is_manager(tenant_id)
);
create policy affiliate_customer_bindings_deny_write on public.affiliate_customer_bindings
  for all to anon, authenticated using (false) with check (false);

-- --- affiliate_daily_stats --------------------------------------
-- Die einzige Tabelle dieser Datei, die ein Partner liest -- und zwar genau
-- seine eigenen Zeilen. `affiliate_partner_id()` loest den aufrufenden Nutzer
-- auf seine AKTIVE Partnerzeile dieses Mandanten auf; fuer jeden anderen
-- ergibt der Vergleich NULL und damit false (fail-closed).
-- BEWUSST NICHT dabei: die Zeilen der geworbenen Partner (Tier 2). Der Plan
-- sieht das nicht vor, und `affiliate_downline_ids()` in einer SELECT-Policy
-- gaebe dem Werber die vollen Tageszeilen seiner Geworbenen -- also deren
-- Umsatz, nicht nur die eigene Zweitstufen-Provision. Wer die Zweitstufen-
-- Ansicht baut, baut sie ueber eine Server-Route mit ausdruecklicher
-- Spaltenliste, genau wie bei affiliate_partners in B1.
create policy affiliate_daily_stats_select on public.affiliate_daily_stats for select using (
  public.affiliate_is_manager(tenant_id)
  or partner_id = public.affiliate_partner_id(tenant_id)
);
create policy affiliate_daily_stats_deny_write on public.affiliate_daily_stats
  for all to anon, authenticated using (false) with check (false);

-- =================================================================
-- 7. Ausfuehrungsrechte der Guard-Funktionen
-- =================================================================
-- Beim Feuern eines Triggers prueft Postgres kein EXECUTE-Recht (das geschieht
-- beim `create trigger`); der `grant` an authenticated ist also die sichere
-- Seite. Entscheidend ist, dass `anon` ausdruecklich entfernt wird -- `revoke
-- from public` allein liesse den eigenen anon-Grant stehen. Nach jedem
-- kuenftigen `create or replace` erneut setzen.
revoke execute on function public.affiliate_clicks_guard()             from public;
revoke execute on function public.affiliate_clicks_guard()             from anon;
grant  execute on function public.affiliate_clicks_guard()             to authenticated, service_role;

revoke execute on function public.affiliate_referrals_guard()          from public;
revoke execute on function public.affiliate_referrals_guard()          from anon;
grant  execute on function public.affiliate_referrals_guard()          to authenticated, service_role;

revoke execute on function public.affiliate_customer_bindings_guard()  from public;
revoke execute on function public.affiliate_customer_bindings_guard()  from anon;
grant  execute on function public.affiliate_customer_bindings_guard()  to authenticated, service_role;

revoke execute on function public.affiliate_daily_stats_guard()        from public;
revoke execute on function public.affiliate_daily_stats_guard()        from anon;
grant  execute on function public.affiliate_daily_stats_guard()        to authenticated, service_role;
