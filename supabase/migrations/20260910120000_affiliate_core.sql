-- Affiliate-Modul, Block B1 "Fundament" (PLAN_Affiliate-System.md Abschnitt 10/B1,
-- 10.09.2026). Diese Datei setzt Abschnitt 3.0 (a)-(d), 3.1, 3.2, 3.3, 3.4, 3.5,
-- 3.13 und 3.16 des Plans um. Sie ist vollstaendig inert: kein Anwendungscode
-- liest oder schreibt diese Tabellen, es gibt keine Route und keinen Menuepunkt.
--
-- ANLASS
-- Ein Mandant soll Partner werben lassen und ihnen Provision zahlen koennen.
-- Das ist Geld- und Personaldatenverarbeitung, also der Teil des Systems, bei dem
-- ein Fehler nicht "haesslich" ist, sondern teuer und aufbewahrungspflichtig.
--
-- BEFUND (gegen die Live-Datenbank vklqksdiyiijzoirntyt am 10.09.2026 gelesen)
--   1. `public.orders` und `public.products` haben KEIN `unique (id, tenant_id)`
--      (pg_constraint zeigt nur orders_pkey, orders_stripe_checkout_id_key,
--      products_pkey, products_tenant_id_slug_key). Ohne dieses Paar ist der
--      zusammengesetzte Fremdschluessel, der seit
--      20260807142619_shift_calendar.sql:46-49 fuer jede Kindtabelle verbindlich
--      ist, syntaktisch gar nicht anlegbar.
--   2. `orders.status` kennt heute nur ('pending','paid','refunded','failed'),
--      eine TEILerstattung ist damit nicht abbildbar.
--   3. `orders.stripe_payment_intent` hat weder Index noch Eindeutigkeit. Die
--      Bruecke von `charge.refunded` (traegt weder tenant_id noch order_id) zur
--      Bestellung laeuft aber ausschliesslich ueber diese Spalte.
--   4. `public.tenants_operator_settings_guard()` schuetzt heute exakt sechs
--      Betreiber-Schluessel (Live-Quelltext aus pg_proc gelesen, wortgleich mit
--      20260909183548_tenants_column_guard.sql:91-98). Ohne `affiliate_enabled`
--      in dieser Liste schaltet sich jeder Mandanten-Admin das Modul per
--      PostgREST-PATCH auf `tenants.settings` selbst frei.
--      KORREKTUR (B13, 11.09.2026): Diese Datei fasst die Funktion NICHT mehr
--      an. Sie stand hier und wortgleich in
--      20260910120200_affiliate_enabled_guard.sql -- zwei Stellen, die dieselbe
--      Schluesselliste fuehren, sind eine Falle fuer den naechsten, der einen
--      Schalter ergaenzt. Sie lebt jetzt ausschliesslich in 20260910120200,
--      siehe Abschnitt 0 (d).
--   5. Neue Tabellen bekommen in diesem Projekt per `alter default privileges`
--      automatisch ALLE Rechte fuer `anon` UND `authenticated` (an
--      public.calendar_workers nachgesehen). `revoke` ist deshalb kein Zierrat,
--      sondern die erste Schutzschicht.
--   6. `check_function_bodies` steht auf `on`. Eine Funktion mit
--      `language sql` wird deshalb schon beim Anlegen gegen die Tabellen
--      aufgeloest, auf die ihr Rumpf zeigt. Das bestimmt die Reihenfolge dieser
--      Datei, siehe unten.
--
-- LOESUNG
-- Sechs neue Tabellen (Programm, Gruppe, Partner, Kondition, Abrechnungsprofil,
-- Pruefpfad), drei Hilfsfunktionen und die drei Bestandsaenderungen an
-- `products`/`orders` (die vierte, `affiliate_enabled` in der
-- Betreiber-Erlaubnisliste, ist nach B13 in
-- 20260910120200_affiliate_enabled_guard.sql abgegeben) -- alles in
-- EINEM Schritt, damit `tenant_id`, RLS und Policies nie auseinanderfallen
-- (CLAUDE.md §2.1). Betraege durchgaengig `int` in Cent, Saetze `int` in
-- Basispunkten; kein `numeric`, kein Float (Plan G12).
--
-- REIHENFOLGE (Abweichung vom Plan, mit Grund)
-- Der Plan legt die Hilfsfunktionen "vor allen Tabellen" an (3.1) und je Tabelle
-- Policies unmittelbar hinter die Tabelle (3. Vorspann). Beides zusammen ist
-- nicht ausfuehrbar: `affiliate_partner_id()` und `affiliate_downline_ids()`
-- sind `language sql` und lesen `public.affiliate_partners` -- bei
-- `check_function_bodies = on` schlaegt ihr `create` fehl, solange die Tabelle
-- nicht existiert. Umgekehrt wird der Ausdruck einer Policy beim Anlegen
-- aufgeloest, die Funktionen muessen also vor JEDER Policy stehen. Daraus folgt:
--   Abschnitt 0    Bestandsaenderungen
--   Abschnitt 1    affiliate_is_manager() (haengt nur an member_role(), existiert)
--   Abschnitt 2-7  die sechs Tabellen mit Index, Guard, Touch, RLS und Rechten
--   Abschnitt 8    affiliate_partner_id() und affiliate_downline_ids()
--   Abschnitt 9    alle Policies, je Tabelle gruppiert
--   Abschnitt 10   Ausfuehrungsrechte der Guard-Funktionen
-- Inhaltlich ist nichts verschoben: Tabelle, RLS und Policies entstehen im
-- selben Migrationsschritt, wie CLAUDE.md §2.1 es verlangt.
--
-- ZUGELASSENE VORWAERTSREFERENZEN: `affiliate_conditions_guard()` (Abschnitt 5)
-- und -- seit der Korrektur zu B4 -- `affiliate_partners_guard()` (Abschnitt 4)
-- rufen `affiliate_partner_id()` bzw. (zweite Runde) die neuen
-- `affiliate_self_partner_id()` und `affiliate_self_group_id()` auf, die erst
-- in Abschnitt 8 entstehen. Beide
-- sind `language plpgsql`, und plpgsql loest SQL-Ausdruecke erst bei der
-- ersten AUSFUEHRUNG der jeweiligen Anweisung auf -- weder `create function`
-- noch `create trigger` scheitert daran, und zwischen Abschnitt 4/5 und
-- Abschnitt 8 wird in dieser Datei in keine der beiden Tabellen geschrieben,
-- der Zweig also nie vorzeitig betreten. Dasselbe gilt fuer die
-- to_regclass-Pruefung auf affiliate_commissions in Abschnitt 4, die die
-- Tabelle aus Block B4 vorwegnimmt.
--
-- VORBILDER
--   - Aufbau, Kommentardichte, zusammengesetzte Fremdschluessel, "genau eine
--     SELECT-Policy je Tabelle": 20260807142619_shift_calendar.sql und
--     20260805090000_customer_area.sql.
--   - Standard-Deny ohne Client-Policy samt Begruendung im Kopf:
--     20260803100200_marketplace_ledger.sql:1-15.
--   - Spaltenrechte als zweite Ebene neben RLS und ein Guard-Trigger, der
--     geschuetzte Werte auf OLD zuruecksetzt statt abzulehnen:
--     20260909183548_tenants_column_guard.sql:31-46 und :77-133.
--   - `(select auth.uid())` statt nacktem `auth.uid()` in Policies (Advisor
--     `auth_rls_initplan`): 20260712233000 / 20260712234600_rls_consolidate_part_b.sql.
--   - `revoke execute ... from anon` zusaetzlich zu `from public`:
--     20260907093000_revoke_new_rpcs_from_anon.sql:1-19. Supabase vergibt EXECUTE
--     an `anon` als eigenen Grant ueber `alter default privileges`; `revoke from
--     public` entfernt ihn nachweislich NICHT (Fund vom 07.09.2026).
--
-- ZUM MITLESEN (Plan G17, woertlich): Genau eine SELECT-Policy je Tabelle,
-- getrennte Schreib-Policies. Eine zweite permissive Policy kann einer
-- bestehenden nichts wegnehmen (sie werden ver-ODER-t) und kostet
-- Auswertungszeit pro Zeile. Eine einschraenkend gemeinte Bedingung muss IN die
-- konsolidierte SELECT-Policy hinein. Die `for all ... using(false)`-Deny-Policy
-- wird trotzdem gesetzt, aber ausschliesslich als auditierbare
-- Absichtserklaerung fuer den Linter -- der tatsaechliche Schutz ist
-- `revoke all` plus das Fehlen von Schreib-Policies. In dieser Datei gibt es
-- keine reine Deny-Tabelle: jede der sechs Tabellen hat eine echte
-- SELECT-Policy, `affiliate_events` und `affiliate_document_counters` (Plan 3.10
-- und 3.12) kommen erst mit Block B4 und bringen ihre Deny-Policy dann selbst mit.
--
-- DIESE MIGRATION IST NOCH NICHT ANGEWENDET. Sie wurde in dieser Umgebung auch
-- nicht probeweise gefahren -- es gibt kein lokales Postgres, keinen Docker und
-- keine supabase/config.toml (Plan 12.7). Das Anwenden bleibt Josip vorbehalten
-- (CLAUDE.md §4.6); der Dateiname traegt bis dahin einen Platzhalter-Zeitstempel,
-- weil `apply_migration` die Version nach Ausfuehrungszeitpunkt vergibt.
-- Danach: `get_advisors(security)` UND `get_advisors(performance)` laufen lassen.
-- ERWARTUNG FUER DIESEN LAUF, damit niemand sie fuer eine Regression haelt:
-- `get_advisors(security)` meldet danach FUENF neue Treffer der Klasse
-- `authenticated_security_definer_function_executable` --
-- affiliate_is_manager, affiliate_partner_id, affiliate_downline_ids und (seit
-- der zweiten Runde) affiliate_self_partner_id, affiliate_self_group_id.
-- Sie sind gewollt und entsprechen genau der Einstufung von
-- public.member_role(uuid), die live bereits so in der Liste steht (der Lauf
-- vom 11.09.2026 zaehlt 22 Treffer dieser Klasse).
-- ENTSCHEIDUNG DAZU, begruendet statt hingenommen: `security definer` ist bei
-- allen fuenf nicht Bequemlichkeit, sondern Voraussetzung. Die Funktionen
-- werden in Policies AUF affiliate_partners bzw. in Ausdruecken benutzt, die
-- ihrerseits affiliate_partners lesen -- als SECURITY INVOKER laesen sie die
-- Tabelle unter deren eigener RLS und die Auswertung liefe im Kreis. Ohne den
-- `grant execute` an `authenticated` ist keine Policy dieser Datei mehr
-- auswertbar (42501 auf allen sechs Tabellen); DIE RECHTE DUERFEN ALSO NICHT
-- ENTZOGEN WERDEN. Ausnutzbar ist keine der fuenf: jede nimmt genau einen
-- tenant-Parameter und gibt ausschliesslich Auskunft ueber den Aufrufer
-- selbst, nie ueber Dritte.
--
-- =================================================================
-- VORAUSSETZUNGEN FUER SPAETERE BLOECKE (Stand 11.09.2026)
-- =================================================================
-- Mehrere Korrekturen dieser Datei nehmen `authenticated` ein Spalten- oder
-- Schreibrecht und verlagern den Vorgang damit auf eine Server-Route, die es
-- noch nicht gibt (src/lib/affiliate/ enthaelt heute nur access.ts, audit.ts,
-- compute.ts, schema.ts, state.ts, types.ts). Wer B3 baut, braucht diese
-- Routen, sonst scheitert die Oberflaeche mit 42501 -- und zwar erst im
-- Betrieb, weil in dieser Umgebung kein Test gegen eine echte Datenbank laeuft:
--   (1) ZAHLUNGSVERBINDUNG (aus B7): iban, bic, account_holder, paypal_email,
--       tax_number und vat_check_log sind fuer `authenticated` nicht lesbar --
--       auch nicht fuer den Partner auf seiner EIGENEN Zeile. Route mit
--       ausdruecklicher Spaltenliste und Maskierung.
--   (2) ZUSTIMMUNG (aus B9): terms_version_accepted, terms_accepted_at und
--       terms_accepted_ip_hash sind fuer `authenticated` nicht schreibbar.
--       Route, die IP und Textfassung serverseitig bestimmt und unter
--       service_role schreibt. Ohne sie entsteht der Nachweis nach Art. 7
--       Abs. 1 DSGVO gar nicht -- also genau der Nachweis, dessen
--       Faelschbarkeit B9 verhindern sollte.
--   (3) INTERNE TEXTE (aus B10 und der zweiten Runde): applicant_email,
--       status_reason, payout_hold_reason, internal_note, application,
--       terms_accepted_ip_hash auf affiliate_partners und `note` auf
--       affiliate_conditions sind fuer `authenticated` nicht lesbar. Die
--       Manager-Oberflaeche laedt sie ueber eine Route mit
--       requireAdminTenant() und createAdminClient().
--   (4) types.ts: AFFILIATE_PARTNER_CLIENT_COLUMNS
--       (src/lib/affiliate/types.ts:407-426) fuehrt "payout_hold_reason" noch,
--       obwohl das Spaltenrecht es seit der zweiten Runde nicht mehr hergibt.
--       Die Konstante hat heute keinen Aufrufer; wer sie als erster benutzt,
--       entfernt den Eintrag vorher.
--   (5) `select('*')` bricht auf affiliate_partners, affiliate_billing_profiles
--       UND (neu) affiliate_conditions mit 42501. Jede Client-Abfrage auf diese
--       drei Tabellen MUSS ihre Spalten benennen.
--   (6) B4, Satzaufloesung: die Eindeutigkeit der Vorrangkette liegt seit B6
--       nicht mehr im Constraint, sondern in der Sortierung
--       `specificity desc, valid_from desc, id` MIT Gueltigkeitsfilter. Sie
--       gehoert an genau EINE Stelle (benannte SQL-Funktion oder View, etwa
--       affiliate_resolve_condition(tenant, program, partner, product, at)) und
--       in die Vitest-Suite, mit dem Zeilenpaar Dauerregel + Aktion als Fall.
--
-- =================================================================
-- KORREKTUREN NACH GEGENLESEN (11.09.2026)
-- =================================================================
-- Ein adversarischer Gegenleser hat 15 Befunde erhoben, drei davon kritisch.
-- Gesamturteil war "nicht freigabefaehig". Jede Korrektur steht unten an Ort
-- und Stelle und traegt die Marke `KORREKTUR (B<n>)`. Uebersicht:
--
--   B1  KRITISCH -- Abschnitt 9, affiliate_conditions_select. Der Zweig
--       `or partner_id is null` stand ungebunden neben den beiden anderen und
--       hob sie auf (permissive Zweige werden ver-ODERt). Jeder eingeloggte
--       Nutzer der GANZEN Plattform las damit Gruppen- und Produktkonditionen
--       samt rate_bp, fixed_cents und Freitext-Notiz ALLER Mandanten. Der
--       Zweig ist jetzt an "der Aufrufer ist Partner DIESES Mandanten"
--       gebunden.
--   B2  KRITISCH -- Abschnitt 4. Zwei zusammengesetzte Fremdschluessel mit
--       `on delete set null` OHNE Spaltenliste. Postgres nullt dabei ALLE
--       referenzierenden Spalten, also auch `tenant_id`, die `not null` ist --
--       Gruppen-, Partner- und sogar Mandantenloeschung brachen mit 23502 ab.
--       Jetzt mit Spaltenliste (PG 15+; live ist 17.6, lesend nachgeprueft:
--       pg_constraint.confdelsetcols existiert).
--   B3  KRITISCH -- Abschnitt 6. `affiliate_billing_profiles_guard_trg` war
--       `before update`; der Partner setzte beim ANLEGEN seines Profils
--       `vat_check_result='valid'` selbst und erzeugte damit Reverse Charge
--       und Auszahlungsfreigabe. Jetzt `before insert or update`.
--   B4  HOCH -- Abschnitt 4 und 9. Die Selbstfreigabesperre G15 griff nur beim
--       UPDATE; ein owner/admin legte sich per INSERT in einem Schritt als
--       aktiven Partner an. Jetzt verengte INSERT-Policy UND INSERT-Zweig im
--       Guard.
--   B5  HOCH -- Abschnitt 7. Gemeldet war: der Unveraenderlichkeits-Guard
--       werfe auch fuer `service_role` beim DELETE und blockiere damit die
--       Mandantenloeschung im Betreiber-Portal. WIDERLEGT UND IN DER ZWEITEN
--       RUNDE ZURUECKGENOMMEN (siehe Z1 unten): die Kaskade laeuft nicht unter
--       der Rolle des Aufrufers, blockiert war nichts -- und die Korrektur der
--       ersten Runde ("service_role darf loeschen") machte den gesamten
--       Serverbetrieb zum Loescher des Pruefpfads.
--   B6  HOCH -- Abschnitt 5. Der EXCLUDE-Constraint verbot genau das
--       Zeilenpaar Dauerregel + befristete Aktionskondition, auf dem die
--       Satzaufloesung in Plan 5.2 beruht. Ersetzt durch eine Eindeutigkeit je
--       Geltungsbereich UND valid_from. Der Gegenleser hat die Entscheidung
--       ausdruecklich Josip ueberlassen und zwei Wege genannt (Constraint
--       streichen, oder um eine Rangspalte `tier` erweitern). Gewaehlt ist ein
--       dritter, der die Absicht des Constraints erhaelt, ohne den Plan an
--       einer zweiten Stelle zu aendern; die Alternative steht unten
--       beschrieben und bleibt jederzeit nachruestbar.
--   B7  MITTEL -- Abschnitt 6. Leserecht auf affiliate_billing_profiles war
--       ein Tabellenrecht; jeder Mandanten-Admin las IBAN, BIC, PayPal-Adresse
--       und Steuernummer aller Partner. Jetzt Spaltenrecht ohne Bankdaten.
--   B8  MITTEL -- Abschnitt 9. Der Partnerzweig von affiliate_audit_log_select
--       war nicht auf `entity` eingeschraenkt. Jetzt `entity = 'partner'`.
--       Teilweise WIDERLEGT: das Fehlerszenario des Gegenlesers ("der Partner
--       sieht die interne Notiz im Klartext") trifft nicht zu --
--       `internal_note` und `status_reason` stehen bereits in
--       AFFILIATE_AUDIT_REDACTED_KEYS (src/lib/affiliate/audit.ts:78-110) und
--       erscheinen als "***". Es fehlt allein `payout_hold_reason`; das ist
--       eine Aenderung an audit.ts, nicht an dieser Migration, und ist unten
--       als offener Punkt vermerkt. Die vorgeschlagene `action in (...)`-Liste
--       ist bewusst NICHT uebernommen, Begruendung unten.
--   B9  MITTEL -- Abschnitt 4. terms_version_accepted, terms_accepted_at und
--       terms_accepted_ip_hash sind aus dem UPDATE-Recht von `authenticated`
--       entfernt: ein Nachweis nach Art. 7 Abs. 1 DSGVO, den der
--       Nachzuweisende selbst schreibt, ist keiner.
--   B10 MITTEL -- Abschnitt 4 und 6. Hinweis fuer den Anwendungscode, dass das
--       Leserecht loechrig ist und `select('*')` mit 42501 bricht.
--   B11 MITTEL -- Wiederholbarkeit, siehe eigener Absatz unten.
--   B12 MITTEL -- Abschnitt 2 und 9. `books_closed_until` (G14) war beim
--       INSERT frei setzbar. Jetzt in Policy und Guard gesperrt.
--   B13 NIEDRIG -- tenants_operator_settings_guard() ist aus dieser Datei
--       ENTFERNT und lebt nur noch in 20260910120200, dort mit den fehlenden
--       `revoke execute`. Teilweise WIDERLEGT: die Begruendung des
--       Gegenlesers, es bleibe "ein Dauerbefund im Security-Advisor", stimmt
--       nicht -- die beiden einschlaegigen Lints erfassen nur
--       `security definer`-Funktionen, und diese ist SECURITY INVOKER
--       (get_advisors(security) am 11.09.2026 gegengeprueft, sie kommt dort
--       nicht vor). Die Korrektur bleibt trotzdem richtig, siehe dort.
--   B14 NIEDRIG -- Abschnitt 5. Plan und SQL nannten fuer Partner+Produkt
--       unterschiedliche Zahlen (30 gegen 25). Korrigiert wurde der PLAN
--       (1.1 und 5.2); die SQL-Summe 20+5=25 ist die natuerliche Form der
--       generierten Spalte, und die Ordnung 25>20>15>10>5 stimmt.
--   B15 NIEDRIG -- Abschnitt 2. `currency` hatte als einzige aufzaehlbare
--       Textspalte kein CHECK; `affiliate_programs_tenant_idx` war neben
--       `unique (tenant_id)` redundant. Beides erledigt.
--
-- =================================================================
-- KORREKTUREN NACH GEGENLESEN, ZWEITE RUNDE (11.09.2026)
-- =================================================================
-- Zwei unabhaengige Gegenpruefer haben die erste Runde gelesen. Einig waren
-- sie sich in einem Punkt, und der war blockierend: die Korrektur zu B5 hatte
-- ein NEUES Loch gerissen. Die uebrigen Befunde stehen darunter, jeder an
-- seiner Stelle im Text mit `KORREKTUR (ZWEITE RUNDE)` markiert.
--
--   Z1  BLOCKIEREND, Abschnitt 7 -- 'service_role' ist aus der
--       DELETE-Erlaubnisliste von affiliate_audit_log_guard() WIEDER
--       ENTFERNT. Die Begruendung der ersten Runde (die Mandantenloeschung
--       laufe sonst gegen die Wand) beruhte auf einer falschen Annahme ueber
--       ON-DELETE-Kaskaden; erkauft war damit, dass der gesamte Serverbetrieb
--       den Pruefpfad spurlos raeumen kann. Die Kaskade haengt jetzt an
--       `pg_trigger_depth() > 1` -- an der HERKUNFT der Anweisung statt an der
--       Rolle -- und ist damit von der Annahme unabhaengig. Ausfuehrliche
--       Begruendung samt Beleg und ausdruecklich benannter Restannahme im
--       Funktionsrumpf. Wortgleich in 20260910120100_tracking_consents.sql.
--   Z2  Abschnitt 9 -- affiliate_conditions_select oeffnete jedem Partner die
--       Konditionen ALLER Gruppen seines Mandanten. Jetzt zusaetzlich an die
--       EIGENE Gruppe gebunden.
--   Z3  Abschnitt 5 -- `note` ist aus dem Leserecht von `authenticated`
--       genommen (Spaltenrecht statt Tabellenrecht), weil die Notiz ein
--       Vermerk ueber den Partner ist.
--   Z4  Abschnitt 9 und 4 -- affiliate_partners_manager_delete haengte an
--       einem Status, den derselbe Manager eine Anweisung vorher setzt. Jetzt
--       an `user_id is null and terms_accepted_at is null` (beides nur
--       serverseitig setzbar) plus ein eigener DELETE-Guard, der das
--       Abrechnungsprofil und -- ab B4 -- die Provisionszeilen sieht.
--   Z5  Abschnitt 5 und 8 -- G15 war loechrig: der Guard pruefte nur
--       `partner_id` und nur gegen die AKTIVE eigene Partnerzeile. Jetzt
--       zusaetzlich die eigene Gruppe und ohne Statusfilter (neue Helfer
--       affiliate_self_partner_id / affiliate_self_group_id). Die verbleibende
--       Grenze -- Produktkondition und Programmstandard wirken auf alle,
--       einschliesslich des Managers -- ist im Guard ausdruecklich als GRENZE
--       benannt statt als Schutz behauptet.
--   Z6  Abschnitt 4 und src/lib/affiliate/audit.ts -- der Widerspruch um
--       `payout_hold_reason` ist aufgeloest: Spalte raus aus dem Leserecht,
--       rein in die Redaktionsliste.
--   Z7  Abschnitt 5 -- `rate_bp` und `fixed_cents` haben keinen Vorgabewert
--       mehr. `default 0` kehrte die Bedeutung um, weil eine Kondition den
--       Programmstandard immer schlaegt.
--   Z8  Abschnitt 6 -- das redundante `unique (partner_id, tenant_id)` ist
--       gestrichen (partner_id ist bereits Primaerschluessel).
--   Z9  Abschnitt 5 -- gegen den stillen Kippschalter aus B6: `valid_from` ist
--       beim UPDATE festgenagelt, und eine neue Zeile, die INNERHALB der
--       Laufzeit einer befristeten Zeile gleichen Geltungsbereichs beginnt,
--       wird abgewiesen. Die Aktionskondition selbst bleibt einfuegbar.
--   Z10 Abschnitt 4 -- der INSERT-Zweig des Partner-Guards schreibt Status,
--       Kontobindung und Zustimmungsfelder nicht mehr still um, sondern
--       bricht ab. Die gleichlautende INSERT-Policy konnte vorher nie
--       greifen; ein Manager, der `status: active` schickte, bekam still eine
--       pending-Zeile.
--   Z11 Kopf -- die drei (jetzt fuenf) SECURITY-DEFINER-Helfer erzeugen nach
--       dem Anwenden neue Advisor-Treffer. Das ist entschieden und oben unter
--       "ERWARTUNG FUER DIESEN LAUF" begruendet, nicht stillschweigend
--       hingenommen.
--
-- NICHT IN DIESER DATEI ERLEDIGT (liegt ausserhalb der vier Dateien dieses
-- Arbeitsblocks): PHASENSTATUS.md traegt seit dem 11.09.2026 den Abschnitt
-- "Affiliate-System: Plan und Fundament" mit Erledigt, Status und Offen
-- (CLAUDE.md §4.4). Was dort noch fehlt, sind die zwei Dauerrisiken dieses
-- Moduls: erstens das loechrige Leserecht auf `affiliate_partners`,
-- `affiliate_billing_profiles` und `affiliate_conditions` -- `select('*')`
-- bricht dort mit 42501 ab, jede Client-Abfrage muss Spalten benennen;
-- zweitens die Aufloesungsreihenfolge der Konditionen, die seit dem Wegfall
-- des EXCLUDE-Constraints nur noch der Anwendungscode garantiert.
--
-- ZUSAETZLICHE DURCHSICHT "INSERT-PFAD" (11.09.2026)
-- Das gemeinsame Muster hinter B3, B4 und B12 ist dasselbe: JEDER Guard dieser
-- Datei war `before update`, und ueberall dort, wo eine Zeile schon beim
-- ANLEGEN ihren gefaehrlichen Zustand tragen darf, war der Schutz leer. Diese
-- Frage ist deshalb als eigene Durchsicht ueber JEDE Tabelle, JEDEN Grant und
-- JEDE Policy gefuehrt worden. Ergebnis ueber die drei Einzelbefunde hinaus:
--   * affiliate_programs, affiliate_groups, affiliate_partners und
--     affiliate_billing_profiles sind jetzt `before insert or update` mit einem
--     eigenen `tg_op = 'INSERT'`-Zweig GANZ VORN. Vorn ist Pflicht, nicht
--     Geschmack: beim INSERT ist OLD nicht zugewiesen, jeder `old.`-Zugriff
--     darueber waere ein Laufzeitfehler (55000).
--   * NEU (nicht in der Befundliste): `created_at` und `updated_at` waren beim
--     INSERT frei setzbar, obwohl jeder Guard sie beim UPDATE festnagelt.
--     Genau die Asymmetrie, um die es hier geht. Der INSERT-Zweig setzt sie
--     jetzt fuer nicht privilegierte Rollen auf now().
--   * NEU (nicht in der Befundliste): ein Manager, der selbst Partner ist,
--     konnte an seiner eigenen Zeile die Gruppe wechseln -- und sich damit die
--     Kondition einer fremden Gruppe geben, ohne je eine Konditionszeile
--     anzufassen (der Riegel in Abschnitt 5 greift nur fuer partner_id).
--     Ausserdem konnte er sich als `referred_by` an JEDE Partnerzeile haengen
--     und so Tier-2-Provision auf den gesamten Bestand beziehen -- in beiden
--     Pfaden, INSERT wie UPDATE. Beides ist dieselbe Entscheidung ueber
--     eigenes Geld, die G15 meint; beides ist jetzt gesperrt.
--   * GEPRUEFT UND SAUBER: `public.tenants` traegt zwar ein INSERT-Recht fuer
--     anon und authenticated auf allen elf Spalten (live gegen
--     information_schema.column_privileges gelesen), es gibt dort aber KEINE
--     INSERT-Policy und RLS ist aktiv (pg_class.relrowsecurity = true). Der
--     INSERT-Pfad auf tenants ist also geschlossen; der `before update`-Guard
--     aus 20260910120200 hat kein offenes Gegenstueck.
--   * GEPRUEFT UND SAUBER: affiliate_audit_log und tracking_consents haben gar
--     kein INSERT-Recht fuer Clients -- dort ist der leere INSERT-Pfad kein
--     Loch, sondern der Entwurf. affiliate_conditions_guard war als einziger
--     schon `before insert or update`.
--   * GEPRUEFT UND SAUBER: jeder zusammengesetzte Fremdschluessel
--     `(x_id, tenant_id)` bindet die Kindzeile auch beim INSERT an denselben
--     Mandanten. Ein client-geliefertes program_id/group_id/product_id aus
--     einem fremden Mandanten scheitert am Fremdschluessel, nicht erst an einer
--     Policy.
--
-- WIEDERHOLBARKEIT (B11)
-- Abschnitt 0 aendert BESTEHENDE Objekte und ist wiederholbar gemacht: ein
-- `do`-Block mit pg_constraint-Pruefung (`add constraint` kennt kein
-- IF NOT EXISTS, und ein blindes `drop constraint` scheitert beim zweiten Lauf
-- an den Fremdschluesseln, die dann schon darauf zeigen), `add column if not
-- exists`, `create index if not exists`, `drop ... if exists` vor jedem
-- `create trigger`.
-- Alles ab Abschnitt 2 haengt an Tabellen, die DIESE Datei anlegt. Dort ist
-- Wiederholbarkeit bewusst NICHT nachgeruestet, und das ist kein Versaeumnis:
-- `create table if not exists` wuerde eine bestehende, inhaltlich abweichende
-- Tabelle stillschweigend durchwinken -- ein sauberer Abbruch mit 42P07 ist die
-- ehrlichere Auskunft. Und solange `create table` abbricht, werden die Indizes,
-- Constraints, Trigger und Policies derselben Tabelle gar nicht erst erreicht;
-- ein `if exists` davor waere Zierrat, der nur Lesbarkeit kostet.

-- =================================================================
-- 0. Aenderungen an Bestandstabellen (Plan 3.0)
-- =================================================================

-- (a) Voraussetzung fuer jeden zusammengesetzten Fremdschluessel weiter unten:
--     Postgres verlangt auf der referenzierten Seite eine exakt passende
--     UNIQUE-/PK-Constraint ueber BEIDE Spalten. `id` allein ist zwar bereits
--     eindeutig, das Paar (id, tenant_id) ist es aber noch nicht deklariert --
--     gleiche Stelle wie `memberships_id_tenant_uniq`
--     (20260807142619_shift_calendar.sql:73).
--     KORREKTUR (B11, Wiederholbarkeit): `alter table ... add constraint`
--     kennt kein IF NOT EXISTS, und ein vorgeschaltetes
--     `drop constraint if exists` waere hier SCHLECHTER als gar nichts: beim
--     zweiten Lauf zeigen die Fremdschluessel aus Abschnitt 3-6 bereits auf
--     dieses Paar, das DROP scheitert dann an der Abhaengigkeit (2BP01) statt
--     an der Dopplung. Deshalb der `do`-Block mit pg_constraint-Pruefung -- er
--     legt an, wenn nichts da ist, und laesst sonst alles stehen.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass and conname = 'products_id_tenant_uniq'
  ) then
    alter table public.products add constraint products_id_tenant_uniq unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_id_tenant_uniq'
  ) then
    alter table public.orders add constraint orders_id_tenant_uniq unique (id, tenant_id);
  end if;
end $$;

-- (b) `orders.status` kennt heute nur 'refunded' als Ganz-oder-gar-nicht. Eine
--     Teilerstattung ist damit nicht abbildbar: 'paid' waere falsch (Geld ist
--     teilweise zurueck), 'refunded' ebenfalls (der Zugriff bleibt bestehen).
--     `refunded_cents` haelt den KUMULATIVEN Erstattungsbetrag, weil Stripe
--     genau so zaehlt (`charge.amount_refunded`, Plan G7) -- die Provisions-
--     Gegenbuchung rechnet daraus einen Zielwert und bucht nur das Delta.
--     KORREKTUR (B11): `if not exists`, damit ein zweiter Lauf nicht mit
--     42701 abbricht. Der inline-CHECK entsteht dabei mit der Anweisung oder
--     gar nicht -- er kann also nicht ohne seine Spalte zurueckbleiben.
alter table public.orders add column if not exists refunded_cents int not null default 0
  check (refunded_cents >= 0);
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','paid','partially_refunded','refunded','failed'));

-- (c) `charge.refunded` traegt weder tenant_id noch order_id. Die einzige
--     Bruecke ist charge.payment_intent -> orders.stripe_payment_intent. Der
--     Index macht die Aufloesung bezahlbar, die Eindeutigkeit verhindert, dass
--     eine Erstattung zwei Bestellungen trifft. Partiell, weil die Spalte fuer
--     nicht bezahlte Bestellungen leer bleibt.
--     Live geprueft am 10.09.2026: kein doppelter Wert vorhanden, der Index
--     laesst sich anlegen.
--     KORREKTUR (B11): `if not exists`.
create unique index if not exists orders_stripe_payment_intent_uniq
  on public.orders (stripe_payment_intent)
  where stripe_payment_intent is not null;

-- (d) `affiliate_enabled` in die Erlaubnisliste der Betreiber-Schluessel.
--     Ohne diesen Eintrag schaltet ein Mandanten-Admin das Modul selbst frei.
--
--     KORREKTUR (B13, 11.09.2026): HIER STAND DIE NEUDEFINITION VON
--     `public.tenants_operator_settings_guard()` SAMT TRIGGER-NEUBINDUNG. Sie
--     ist ersatzlos entfernt und lebt jetzt an GENAU EINER Stelle:
--
--         supabase/migrations/20260910120200_affiliate_enabled_guard.sql
--
--     Grund: dieselbe Schluesselliste stand wortgleich in beiden Dateien. Zwei
--     Stellen, die dieselbe Liste fuehren, sind eine Falle fuer den naechsten,
--     der einen Schalter ergaenzt -- er aendert eine davon, die andere laeuft
--     spaeter, gewinnt, und der neue Schluessel ist still wieder ungeschuetzt.
--     Genau diese Gefahr beschrieb 20260910120200 in seinem eigenen Kopf
--     ("wer die Schluesselliste erweitert, muss BEIDE Dateien anfassen"); die
--     Warnung ist jetzt gegenstandslos, weil es nur noch eine Datei gibt.
--
--     Fuer die Reihenfolge ist das unerheblich: 20260910120200 sortiert hinter
--     dieser Datei und wird von Supabase danach angewendet; die Funktion wird
--     von nichts in dieser Datei aufgerufen (sie haengt allein am
--     tenants-Trigger), es gibt also keine Abhaengigkeit zu bedienen. Die
--     fehlenden `revoke execute ... from public` / `from anon` sind dort
--     ebenfalls ergaenzt.
--
--     Die inhaltliche Begruendung -- BEWUSST OHNE `security definer`, weil die
--     Funktion `current_user` sehen muss, und ERLAUBNISLISTE statt Sperrliste
--     -- steht vollstaendig im Kopf von 20260910120200.

-- =================================================================
-- 1. Hilfsfunktion ohne Tabellenbezug (Plan 3.1, Teil 1)
-- =================================================================

-- Geld- und Personaldaten: owner/admin, NICHT `is_staff()` -- das schliesst
-- 'trainer' ein (0001_init.sql:63-69). Gleiche Begruendung wie beim
-- Schichtkalender (20260807142619_shift_calendar.sql:30-34) und bei der
-- Kunden-Area (20260805090000_customer_area.sql).
create or replace function public.affiliate_is_manager(t uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.member_role(t) in ('owner','admin'), false);
$$;

-- Der doppelte `revoke` ist Pflicht und kein Copy-Paste: `revoke ... from public`
-- entfernt das EXECUTE-Recht der Rolle `anon` NICHT, weil Supabase es ueber
-- `alter default privileges` als eigenen Grant vergibt (nachgewiesener Fund vom
-- 07.09.2026, 20260907093000_revoke_new_rpcs_from_anon.sql). Nach JEDEM
-- kuenftigen `create or replace` dieser Funktion erneut setzen.
revoke execute on function public.affiliate_is_manager(uuid) from public;
revoke execute on function public.affiliate_is_manager(uuid) from anon;
grant  execute on function public.affiliate_is_manager(uuid) to authenticated, service_role;

-- =================================================================
-- 2. affiliate_programs (Plan 3.2) -- die Konfigurationszeile je Mandant
-- =================================================================

create table public.affiliate_programs (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  status                text not null default 'draft' check (status in ('draft','active','paused')),
  visibility            text not null default 'private' check (visibility in ('private','link','public')),
  approval_mode         text not null default 'manual' check (approval_mode in ('manual','auto')),

  -- Standardkondition: unterste Stufe der Vorrangkette. Eine Zeile in
  -- affiliate_conditions schlaegt sie, siehe Abschnitt 5.
  rate_kind             text not null default 'percent' check (rate_kind in ('percent','fixed')),
  rate_bp               int  not null default 2000 check (rate_bp between 0 and 10000),
  fixed_cents           int  not null default 0 check (fixed_cents >= 0),
  min_commission_cents  int  check (min_commission_cents is null or min_commission_cents >= 0),
  max_commission_cents  int  check (max_commission_cents is null or max_commission_cents >= 0),

  -- Provisionsbasis
  basis_kind            text not null default 'net' check (basis_kind in ('net','gross')),
  fee_deduction_bp      int  not null default 0 check (fee_deduction_bp between 0 and 10000),
  -- KORREKTUR (B15): `currency` war die einzige aufzaehlbare Textspalte dieser
  -- Datei ohne CHECK. Ein Tippfehler ('EUR') oder eine spaetere
  -- Mehrwaehrungs-Idee ('chf') faellt sonst erst im Auszahlungslauf auf --
  -- also nachdem SEPA-XML und Gutschrift-PDF bereits darauf aufgebaut haben.
  -- v1 kennt keine Waehrungsumrechnung (Plan 1.2), deshalb Gleichheit statt
  -- Liste: wer eine zweite Waehrung will, muss diesen Constraint bewusst
  -- anfassen und stolpert dabei ueber die Umrechnungsfrage.
  currency              text not null default 'eur'
                          constraint affiliate_programs_currency_check check (currency = 'eur'),

  -- Attribution
  attribution_model     text not null default 'last' check (attribution_model in ('last','first')),
  -- Obergrenze 365 Tage: das Attributions-Cookie traegt maxAge =
  -- cookie_ttl_days * 86400 (Plan 11.8). Die Grenze steht deshalb hier im
  -- Schema und nicht nur im zod-Schema.
  cookie_ttl_days       int  not null default 30 check (cookie_ttl_days between 1 and 365),
  overwrite_policy      text not null default 'allow' check (overwrite_policy in ('allow','deny')),
  lifetime_binding      boolean not null default false,
  self_referral         text not null default 'block' check (self_referral in ('block','allow_flagged')),
  referrer_blocklist    text[] not null default '{}',

  -- Abo
  recurring_mode        text not null default 'first_only'
                          check (recurring_mode in ('first_only','n_periods','all')),
  recurring_max_periods int  not null default 12 check (recurring_max_periods between 1 and 120),

  -- Zweite Stufe
  tier2_enabled         boolean not null default false,
  tier2_basis           text not null default 'commission' check (tier2_basis in ('commission','revenue')),
  tier2_rate_bp         int  not null default 1000 check (tier2_rate_bp between 0 and 10000),

  -- Geld und Fristen
  hold_days             int not null default 30 check (hold_days between 0 and 365),
  reserve_bp            int not null default 1000 check (reserve_bp between 0 and 10000),
  reserve_days          int not null default 60 check (reserve_days between 0 and 365),
  min_payout_cents      int not null default 2500 check (min_payout_cents >= 0),
  payout_schedule       text not null default 'monthly'
                          check (payout_schedule in ('weekly','semi_monthly','monthly')),
  -- Plan G14: beim Erzeugen einer Gutschrift auf `period_to` gesetzt. Danach
  -- weist die Buchungs-RPC (Block B4) jede Zeile ab, die in diesen Zeitraum
  -- datieren wuerde, und bucht sie mit heutigem Datum in die laufende Periode.
  books_closed_until    date,

  -- Texte
  description_md        text not null default '',
  terms_text            text not null default '',
  terms_version         int  not null default 1 check (terms_version >= 1),
  application_note      text not null default '',
  application_fields    jsonb not null default '[]'::jsonb,

  test_mode             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- v1: genau ein Programm je Mandant. Die Spalte program_id existiert trotzdem
  -- ueberall, damit ein zweites Programm spaeter kein Schema-Umbau wird.
  unique (tenant_id),
  unique (id, tenant_id),
  check (max_commission_cents is null or min_commission_cents is null
         or max_commission_cents >= min_commission_cents),
  -- Die Reserve laeuft nie vor der Sperrfrist ab, sonst waere der
  -- Sicherheitseinbehalt frueher auszahlbar als der Hauptbetrag.
  check (reserve_days >= hold_days)
);

-- KORREKTUR (B15): HIER STAND
--   create index affiliate_programs_tenant_idx on public.affiliate_programs (tenant_id, status);
-- Der Index ist ersatzlos gestrichen. `unique (tenant_id)` oben legt bereits
-- einen eindeutigen btree auf (tenant_id) an; bei hoechstens EINER Zeile je
-- Mandant kann ein zweiter Index mit angehaengtem `status` nichts mehr
-- verbessern -- er deckt denselben Fremdschluessel ab, kostet Schreiblast und
-- erzeugt einen Dauerbefund "unused index" im Performance-Advisor.

-- Guard OHNE `security definer`, weil die Funktion `current_user` sehen muss --
-- unter `security definer` waere das immer der Eigentuemer und die
-- Erlaubnisliste damit wirkungslos (empirisch belegt in 20260909183548:70-75).
-- Die Liste ist eine ERLAUBNISLISTE, keine Sperrliste: eine kuenftige, hier
-- unbekannte Rolle faellt in den geschuetzten Zweig statt still durchzurutschen.
create or replace function public.affiliate_programs_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- KORREKTUR (B12 + INSERT-Pfad-Durchgang): Dieser Zweig ist neu und MUSS
  -- ganz vorn stehen -- beim INSERT ist OLD nicht zugewiesen, jeder `old.`-
  -- Zugriff darunter waere ein Laufzeitfehler (55000).
  -- Was war falsch: der Trigger war `before update`. `books_closed_until` (der
  -- Riegel aus G14) war damit beim ANLEGEN des Programms frei setzbar, weil
  -- das Tabellenrecht in Abschnitt 2 alle Spalten umfasst und die
  -- INSERT-Policy nur die Mandantenzugehoerigkeit prueft.
  -- Szenario: ein Mandanten-Admin legt sein Programm mit
  -- {"books_closed_until":"2099-12-31"} an. Die Buchungs-RPC aus Block B4
  -- weist danach JEDE Provisionszeile als "in abgeschlossenem Zeitraum" ab und
  -- datiert alles in die laufende Periode um -- das Provisionsbuch datiert
  -- systematisch falsch, ohne dass je eine Gutschrift entstanden waere. Ein
  -- bewusst frueh gesetzter Wert ist umgekehrt die stille Vorbereitung, spaeter
  -- in einen bereits belegten Zeitraum nachzubuchen.
  -- Warum jetzt richtig: der Riegel entsteht ausschliesslich beim Erzeugen
  -- einer Gutschrift (service_role), nie durch einen Client -- weder beim
  -- Anlegen noch beim Aendern. Die INSERT-Policy in Abschnitt 9 fuehrt
  -- dieselbe Bedingung noch einmal; eine Policy kennt aber kein Spaltendelta,
  -- deshalb beides.
  if tg_op = 'INSERT' then
    if current_user in ('postgres', 'supabase_admin', 'service_role') then
      return new;
    end if;
    new.books_closed_until := null;
    -- Zeitstempel setzt der Server, nicht der Client: beim UPDATE nagelt der
    -- Guard `created_at` fest, beim INSERT war es frei -- genau die
    -- Asymmetrie, um die es in dieser Durchsicht geht.
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- Identitaetsspalten sind fuer JEDE Rolle fest: eine Programmzeile darf den
  -- Mandanten nie wechseln, auch nicht ueber den Admin-Client.
  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.created_at := old.created_at;

  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  -- books_closed_until ist der Riegel vor abgeschlossenen Abrechnungszeitraeumen
  -- (Plan G14). Wer ihn zuruecksetzen koennte, koennte in einen Zeitraum
  -- nachbuchen, fuer den bereits ein Beleg mit fester Summe existiert.
  new.books_closed_until := old.books_closed_until;
  return new;
end;
$$;

-- BEFORE-Trigger derselben Tabelle laufen alphabetisch; 'g' < 't', der Guard
-- laeuft vor dem Touch (20260807171725:198-203).
-- KORREKTUR (B12): `before insert or update` statt `before update`.
create trigger affiliate_programs_guard_trg before insert or update on public.affiliate_programs
  for each row execute function public.affiliate_programs_guard();
create trigger affiliate_programs_touch before update on public.affiliate_programs
  for each row execute function public.set_updated_at();

alter table public.affiliate_programs enable row level security;
-- Neue Tabellen erhalten in diesem Projekt per `alter default privileges` alle
-- Rechte fuer anon und authenticated (live nachgesehen). Erst wegnehmen, dann
-- gezielt zurueckgeben. Kein DELETE: ein Programm mit Buchungshistorie darf
-- nicht verschwinden.
revoke all on public.affiliate_programs from anon, authenticated;
grant select, insert, update on public.affiliate_programs to authenticated;

-- =================================================================
-- 3. affiliate_groups (Plan 3.4) -- vor affiliate_partners, weil
--    affiliate_partners.group_id darauf zeigt.
-- =================================================================
-- Abweichung von der Nummerierung des Plans (3.4 vor 3.3), nicht vom Inhalt:
-- ein Fremdschluessel kann nur auf eine bereits bestehende Tabelle zeigen.
--
-- Die Gruppe traegt selbst KEINEN Satz -- der steht als affiliate_conditions-
-- Zeile mit group_id. Damit gibt es genau einen Ort, an dem Saetze stehen, und
-- die Vorrangkette bleibt eine einzige Sortierung.

create table public.affiliate_groups (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  program_id uuid not null,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, program_id, name),
  unique (id, tenant_id),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade
);

-- Index auf BEIDE Spalten des zusammengesetzten Fremdschluessels, in dessen
-- Spaltenreihenfolge (Advisor "unindexed foreign keys",
-- 20260807142948_shift_calendar_perf_fix.sql:8-15). Der Fremdschluessel auf
-- tenant_id ist ueber `unique (tenant_id, program_id, name)` bereits indiziert.
create index affiliate_groups_program_idx on public.affiliate_groups (program_id, tenant_id);

create or replace function public.affiliate_groups_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- KORREKTUR (INSERT-Pfad-Durchgang): neuer Zweig, ganz vorn, weil OLD beim
  -- INSERT nicht zugewiesen ist.
  -- Was war falsch: nichts Gefaehrliches, aber dieselbe Asymmetrie wie bei den
  -- anderen Tabellen -- `created_at` wurde beim UPDATE festgenagelt und war
  -- beim INSERT frei. Mandant und Programm sind hier schon durch den
  -- zusammengesetzten Fremdschluessel (program_id, tenant_id) und die
  -- INSERT-Policy gebunden, es bleibt also nur der Zeitstempel.
  if tg_op = 'INSERT' then
    if current_user in ('postgres', 'supabase_admin', 'service_role') then
      return new;
    end if;
    new.created_at := now();
    return new;
  end if;

  -- Eine Gruppe wechselt nie den Mandanten und nie das Programm: sonst
  -- verschoebe eine Umbenennung stillschweigend die Kondition aller Partner,
  -- die an ihr haengen.
  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.program_id := old.program_id;
  new.created_at := old.created_at;
  return new;
end;
$$;
create trigger affiliate_groups_guard_trg before insert or update on public.affiliate_groups
  for each row execute function public.affiliate_groups_guard();

alter table public.affiliate_groups enable row level security;
revoke all on public.affiliate_groups from anon, authenticated;
grant select, insert, update, delete on public.affiliate_groups to authenticated;

-- =================================================================
-- 4. affiliate_partners (Plan 3.3)
-- =================================================================
-- `user_id` ist nullable, weil eine oeffentliche Bewerbung kein Konto
-- voraussetzen darf -- dasselbe Muster wie memberships.invited_email
-- (0001_init.sql:44-47); bei Freigabe geht eine Einladung mit
-- buildSetPasswordLink() raus (src/lib/users/import.ts:196).
--
-- Partner sind bewusst KEINE memberships-Rolle (Plan G9): eine Rolle
-- 'affiliate' waere exakt der Gast-Fund vom 03.08.2026
-- (20260803100000_marketplace_guest_role.sql) -- rund dreissig Policies pruefen
-- `member_role(tenant_id) is not null` und wuerden dem Partner den kompletten
-- veroeffentlichten Kursbestand oeffnen.

create table public.affiliate_partners (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  program_id    uuid not null,
  user_id       uuid references public.profiles(id) on delete set null,
  -- normalisiert vom Anwendungscode: lower(trim(...)), +suffix entfernt.
  applicant_email text not null,
  display_name  text not null,
  company       text,
  code          text not null check (code ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  status        text not null default 'pending'
                  check (status in ('pending','active','rejected','suspended')),
  status_reason text,
  group_id      uuid,
  referred_by   uuid,                      -- Werber (Tier 2), genau eine Stufe
  payout_hold   boolean not null default false,
  payout_hold_reason text,
  internal_note text,
  application   jsonb not null default '{}'::jsonb,

  terms_version_accepted int,
  terms_accepted_at      timestamptz,
  -- HMAC mit STATISCHEM, domaenenpraefixiertem Salz (Plan 11.6) -- nicht das
  -- tagesrotierende der Klicktabelle, sonst waere der Zustimmungsnachweis nach
  -- einem Tag nicht mehr verifizierbar.
  terms_accepted_ip_hash text,

  notify_sale     boolean not null default true,
  notify_reversal boolean not null default true,
  notify_payout   boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Je Mandant eindeutig, NICHT global: der Aufloesungspfad im Klick-Endpunkt
  -- ist immer `where tenant_id = <aus Host> and code = <aus Link>`. Ein globaler
  -- Namensraum waere gleichzeitig ein Datenleck (Codes eines Mandanten in einem
  -- anderen aufloesbar) und ein Attributionsfehler.
  unique (tenant_id, code),
  unique (tenant_id, program_id, applicant_email),
  unique (id, tenant_id),
  check (referred_by is null or referred_by <> id),
  foreign key (program_id, tenant_id)  references public.affiliate_programs (id, tenant_id) on delete cascade,
  -- KORREKTUR (B2, KRITISCH): hier stand `on delete set null` OHNE
  -- Spaltenliste. Postgres nullt bei SET NULL ohne Liste ALLE referenzierenden
  -- Spalten des Fremdschluessels -- also auch `tenant_id`, die oben `not null`
  -- ist. Jede Kaskade endete in 23502.
  -- Szenarien: (1) Ein Manager loescht eine Partnergruppe, der mindestens ein
  -- Partner zugeordnet ist -- affiliate_groups_manager_delete erlaubt es, die
  -- Anweisung brach ab mit 'null value in column "tenant_id" of relation
  -- "affiliate_partners" violates not-null constraint'; "Gruppe loeschen" war
  -- damit fuer jede nicht leere Gruppe tot. (2) Ein Manager loescht einen
  -- Partner in pending/rejected, der zuvor jemanden geworben hatte --
  -- dieselbe Wand ueber die Selbstreferenz `referred_by`. (3) Schwerer:
  -- `delete from tenants` im Betreiber-Portal (src/lib/platform/actions.ts:295)
  -- kaskadiert hierher, die Selbstreferenz feuert SET NULL auf Geschwisterzeilen
  -- und liess die ganze Mandantenloeschung scheitern.
  -- Warum jetzt richtig: die Spaltenliste sagt ausdruecklich, dass NUR die
  -- Kindspalte genullt wird; `tenant_id` bleibt stehen und bleibt gueltig, weil
  -- sie ihrerseits an tenants(id) haengt. Die Syntax `on delete set null
  -- (spalte)` gibt es seit PG 15; live laeuft 17.6, lesend gegengeprueft ueber
  -- die Existenz von pg_constraint.confdelsetcols (nur PG 15+). Im Repo war
  -- diese Stelle ohne Vorbild: alle bestehenden `on delete set null`
  -- (0001_init.sql:163/252/253/266/267/387, 20260807142619:114/339) sind
  -- einspaltig, dort stellt sich die Frage gar nicht. Der Plan 3.3 traegt
  -- denselben Fehler und ist damit an dieser Stelle ueberholt.
  foreign key (group_id, tenant_id)    references public.affiliate_groups   (id, tenant_id) on delete set null (group_id),
  foreign key (referred_by, tenant_id) references public.affiliate_partners (id, tenant_id) on delete set null (referred_by)
);

-- Ein Nutzerkonto ist je Mandant hoechstens einmal Partner. Partiell, weil
-- user_id bis zur Freigabe leer bleibt.
create unique index affiliate_partners_user_uniq
  on public.affiliate_partners (tenant_id, user_id) where user_id is not null;
create index affiliate_partners_program_idx  on public.affiliate_partners (program_id, tenant_id, status);
create index affiliate_partners_group_idx    on public.affiliate_partners (group_id, tenant_id);
create index affiliate_partners_referred_idx on public.affiliate_partners (referred_by, tenant_id);
-- Fremdschluessel user_id -> profiles(id). Partiell, weil nur freigegebene
-- Partner ueberhaupt einen Wert tragen; fuer NULL prueft der Fremdschluessel
-- nichts nach.
create index affiliate_partners_user_idx     on public.affiliate_partners (user_id) where user_id is not null;

-- Guard-Trigger, weil eine `with check`-Bedingung nur die NEUE Zeile sieht und
-- damit kein Spaltendelta ausdruecken kann (20260807142619:518-521).
-- OHNE `security definer`: die Erlaubnisliste unten braucht `current_user`, und
-- unter `security definer` waere das immer der Funktionseigentuemer -- jeder
-- Aufrufer liefe dann in den privilegierten Zweig und der Guard waere leer.
-- Folge davon: die `exists`-Abfrage auf affiliate_commissions laeuft mit den
-- Rechten des Aufrufers. Das ist vertretbar, weil sie nur im Manager-Zweig
-- ausgewertet wird und der Manager die Provisionszeilen seines Mandanten
-- ohnehin lesen darf.
create or replace function public.affiliate_partners_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- KORREKTUR (B4, HOCH -- und Kern der INSERT-Pfad-Durchsicht): Dieser Zweig
  -- ist neu und MUSS ganz vorn stehen; beim INSERT ist OLD nicht zugewiesen,
  -- jeder `old.`-Zugriff darunter waere ein Laufzeitfehler (55000).
  -- Was war falsch: der Trigger war `before update`. Die gesamte Sperre, die
  -- dieser Guard unten aufbaut -- allen voran die Selbstfreigabesperre G15 --
  -- galt damit erst ab der ZWEITEN Aenderung. `grant insert` in Abschnitt 4
  -- ist ein Tabellenrecht ueber ALLE Spalten, und
  -- affiliate_partners_manager_insert prueft (vor der Korrektur) nur die
  -- Mandantenzugehoerigkeit.
  -- Szenario: ein Mandanten-Admin ruft POST /rest/v1/affiliate_partners auf mit
  -- {"tenant_id":"<eigener>","program_id":"<seins>","code":"chef",
  --  "status":"active","user_id":"<eigene profiles.id>",
  --  "terms_version_accepted":1,"terms_accepted_at":"2026-01-01T00:00:00Z"}.
  -- Kein Trigger feuerte. Danach lieferte affiliate_partner_id() fuer ihn eine
  -- ID: er war aktiver Partner seines eigenen Programms und kassierte die
  -- Programm-Standardprovision auf eigene Kaeufe und auf jeden Kauf ueber
  -- seinen Link. Der Zustimmungsnachweis war im selben Zug faelschbar.
  -- Warum jetzt richtig: eine neue Partnerzeile entsteht IMMER als unbewertete
  -- Bewerbung. Freigabe, Kontoverknuepfung, Auszahlungssperre und der
  -- Zustimmungsnachweis sind Vorgaenge, keine Anfangszustaende -- sie laufen
  -- ueber das UPDATE unten und damit durch G15, oder ueber den Server
  -- (service_role), der die Erlaubnisliste passiert.
  if tg_op = 'INSERT' then
    if current_user in ('postgres', 'supabase_admin', 'service_role') then
      return new;
    end if;

    -- KORREKTUR (ZWEITE RUNDE): Hier stand ein stilles Umschreiben
    -- (`new.status := 'pending'`, `new.user_id := null`, ...). Der Gegenleser
    -- hat daran zu Recht bemaengelt, dass die gleichlautenden Bedingungen der
    -- INSERT-Policy damit NIE fehlschlagen koennen: BEFORE-ROW-Trigger laufen
    -- vor der `with check`-Auswertung, die Spalten sind also bereits
    -- zurechtgerueckt, wenn die Policy drankommt. Ein Manager, der bewusst
    -- {"status":"active","user_id":"..."} schickt, bekam kein 42501, sondern
    -- still eine pending-Zeile.
    -- ENTSCHEIDUNG: das bleibt NICHT so. Eine stille Umdeutung ist bei einer
    -- Entscheidung ueber Geld die falsche Antwort -- sie verschleiert den
    -- Programmierfehler beim Bauen von B3 ebenso wie den Angriffsversuch im
    -- Betrieb, und beide sind hier gleich wichtig. Ausdruecklicher Abbruch,
    -- sobald eine neue Zeile mehr sein will als eine unbewertete Bewerbung.
    -- Wer die Spalten weglaesst, merkt davon nichts: `status` traegt den
    -- Vorgabewert 'pending', `payout_hold` false, der Rest null.
    -- Preis, den das hat und der bewusst in Kauf genommen ist: eine
    -- Partnerzeile fuer jemanden, der die Bedingungen auf Papier akzeptiert
    -- hat, laesst sich nicht in EINEM INSERT anlegen -- der Nachweis entsteht
    -- danach ueber die Server-Route (service_role), die ihn ohnehin allein
    -- schreiben darf (B9).
    if new.status is distinct from 'pending'
       or new.user_id is not null
       or new.payout_hold is distinct from false
       or new.terms_version_accepted is not null
       or new.terms_accepted_at is not null
       or new.terms_accepted_ip_hash is not null then
      raise exception 'affiliate_partner_insert_must_be_pending';
    end if;

    -- Begruendungstexte ohne den Zustand, den sie begruenden, sind Rauschen:
    -- der Status ist 'pending', die Sperre false. Diese beiden werden weiter
    -- STILL genullt -- sie sind kein Rechteanspruch, sondern Beiwerk, und ein
    -- Abbruch dafuer waere Schikane statt Schutz.
    new.status_reason          := null;
    new.payout_hold_reason     := null;
    -- `internal_note` bleibt BEWUSST stehen (Abweichung vom Korrekturvorschlag
    -- des Gegenlesers): der Manager darf sie im UPDATE-Pfad ohnehin schreiben,
    -- ein Nullen beim Anlegen naehme also keinem Angreifer etwas und zwaenge
    -- nur jede manuell angelegte Partnerzeile in ein zweites UPDATE.
    new.created_at             := now();
    new.updated_at             := now();

    -- KORREKTUR (zusaetzlicher Fund, nicht aus der Befundliste): Ein Manager,
    -- der selbst Partner ist, konnte sich beim ANLEGEN einer fremden
    -- Partnerzeile als deren Werber eintragen -- und bezog damit
    -- Tier-2-Provision auf den Umsatz eines Partners, den er nie geworben hat.
    -- Dieselbe Entscheidung ueber eigenes Geld, die G15 meint; die Sperre in
    -- Abschnitt 5 deckt nur `partner_id` in affiliate_conditions ab, nicht die
    -- zweite Stufe.
    -- KORREKTUR (ZWEITE RUNDE): `affiliate_self_partner_id()` statt
    -- `affiliate_partner_id()`. Die zweite Funktion filtert `status =
    -- 'active'` -- ein Manager, dessen EIGENE Partnerzeile noch 'pending' oder
    -- 'suspended' ist, fiel damit durch die Pruefung hindurch und konnte sich
    -- vorab als Werber eintragen; die Zeile blieb stehen und wirkte ab dem
    -- Moment seiner Freigabe durch einen Kollegen. Die Frage "geht es um mein
    -- eigenes Geld?" haengt an der PERSON, nicht am Status.
    if new.referred_by is not null
       and new.referred_by = public.affiliate_self_partner_id(new.tenant_id) then
      raise exception 'affiliate_self_referral_forbidden';
    end if;
    return new;
  end if;

  -- Identitaetsspalten sind fuer JEDE Rolle fest.
  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.created_at := old.created_at;

  -- ERLAUBNISLISTE, keine Sperrliste (Korrektur am K2-Trigger,
  -- 20260909183548:77-90): Migrationen, Dashboard und der Admin-Client duerfen
  -- die Bewerbung freigeben, ein Konto verknuepfen und den Status setzen. Auf
  -- diesem Weg arbeiten die Server Actions dieses Moduls; ohne den Zweig waere
  -- die Freigabe einer Bewerbung ueberhaupt nicht moeglich, weil
  -- affiliate_is_manager() fuer service_role false liefert (auth.uid() ist dort
  -- null).
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  -- IMMER old.tenant_id pruefen, nie new.tenant_id: die new-Pruefung war der
  -- echte Cross-Tenant-Weg in 20260807173156:1-31 (wer in Mandant B Admin ist,
  -- schickte tenant_id=B mit, und der Spaltenschutz entfiel komplett). Hier ist
  -- new.tenant_id bereits auf old zurueckgesetzt; die Pruefung nennt
  -- old.tenant_id trotzdem ausdruecklich, damit eine spaetere Umstellung der
  -- Zeilen darueber nicht still kippt.
  if public.affiliate_is_manager(old.tenant_id) then
    -- Plan G15: ein Programm-Manager entscheidet nicht ueber Vorgaenge, in denen
    -- er selbst Partner ist. Ohne diese Sperre ist die Selbst-Empfehlungssperre
    -- wirkungslos, weil derselbe Mensch ueber den Verdachtsfall entscheidet.
    -- Neben `status` ist auch `payout_hold` erfasst: eine Auszahlungssperre an
    -- der eigenen Zeile zu loesen ist dieselbe Entscheidung ueber eigenes Geld.
    -- KORREKTUR (zusaetzlicher Fund, nicht aus der Befundliste): `group_id`
    -- gehoert in dieselbe Aufzaehlung. Die Gruppe traegt selbst keinen Satz,
    -- aber eine affiliate_conditions-Zeile mit group_id tut es -- wer sich
    -- selbst in eine besser dotierte Gruppe schiebt, gibt sich eine Kondition,
    -- ohne je eine Konditionszeile anzufassen. Der Riegel in Abschnitt 5
    -- (affiliate_conditions_guard) prueft nur `partner_id` und haette das nicht
    -- gesehen.
    if old.user_id = auth.uid()
       and (new.status is distinct from old.status
            or new.payout_hold is distinct from old.payout_hold
            or new.group_id is distinct from old.group_id) then
      raise exception 'affiliate_self_approval_forbidden';
    end if;

    -- KORREKTUR (zusaetzlicher Fund): Spiegelbild des INSERT-Zweigs oben. Ein
    -- Manager darf sich nicht nachtraeglich als Werber an eine fremde
    -- Partnerzeile haengen; sonst bezieht er Tier-2-Provision auf den gesamten
    -- Partnerbestand seines Mandanten.
    -- KORREKTUR (ZWEITE RUNDE): `affiliate_self_partner_id()` statt
    -- `affiliate_partner_id()`, gleiche Begruendung wie im INSERT-Zweig oben.
    if new.referred_by is distinct from old.referred_by
       and new.referred_by is not null
       and new.referred_by = public.affiliate_self_partner_id(old.tenant_id) then
      raise exception 'affiliate_self_referral_forbidden';
    end if;

    new.program_id      := old.program_id;
    -- Ein Konto wird ausschliesslich vom Server (service_role) verknuepft, nie
    -- vom Manager: sonst haengte er eine fremde Partnerzeile an sein eigenes
    -- Konto und lieste damit deren Abrechnungsdaten.
    new.user_id         := old.user_id;
    new.applicant_email := old.applicant_email;

    -- Der Code ist Teil der Attributionshistorie und nach der ersten Buchung
    -- fix. affiliate_commissions entsteht erst mit Block B4 (Plan 3.11); bis
    -- dahin gibt es keine Buchung, die eine Codeaenderung brechen koennte. Die
    -- to_regclass-Pruefung haelt den Trigger bis dahin lauffaehig -- plpgsql
    -- loest Tabellennamen erst beim Ausfuehren der jeweiligen Anweisung auf,
    -- der nicht betretene Zweig kostet also nichts.
    if to_regclass('public.affiliate_commissions') is not null then
      if exists (select 1 from public.affiliate_commissions c
                 where c.tenant_id = old.tenant_id and c.partner_id = old.id) then
        new.code := old.code;
      end if;
    end if;
    return new;
  end if;

  -- Selbstpflege durch den Partner: NEW bleibt nur fuer display_name, company
  -- und die drei notify_*-Schalter stehen. Die Zustimmungsfelder sind nach B9
  -- gar nicht mehr im UPDATE-Recht von `authenticated`; der Zweig ganz unten
  -- bleibt als Tiefenverteidigung, falls das Recht je zurueckkehrt.
  new.program_id         := old.program_id;
  new.user_id            := old.user_id;
  new.applicant_email    := old.applicant_email;
  new.code               := old.code;
  new.status             := old.status;
  new.status_reason      := old.status_reason;
  new.group_id           := old.group_id;
  new.referred_by        := old.referred_by;
  new.payout_hold        := old.payout_hold;
  new.payout_hold_reason := old.payout_hold_reason;
  new.internal_note      := old.internal_note;
  new.application        := old.application;

  -- Zustimmung ist einseitig: setzbar, nie zuruecksetzbar. Ein Partner, der
  -- seine einmal erteilte Zustimmung auf eine aeltere Fassung zuruecksetzen
  -- koennte, entwertete den Nachweis nach Art. 7 Abs. 1 DSGVO.
  if old.terms_accepted_at is not null
     and coalesce(new.terms_version_accepted, 0) < coalesce(old.terms_version_accepted, 0) then
    new.terms_version_accepted := old.terms_version_accepted;
    new.terms_accepted_at      := old.terms_accepted_at;
    new.terms_accepted_ip_hash := old.terms_accepted_ip_hash;
  end if;
  return new;
end;
$$;

-- KORREKTUR (B4): `before insert or update` statt `before update`.
create trigger affiliate_partners_guard_trg before insert or update on public.affiliate_partners
  for each row execute function public.affiliate_partners_guard();
create trigger affiliate_partners_touch before update on public.affiliate_partners
  for each row execute function public.set_updated_at();

-- KORREKTUR (ZWEITE RUNDE, neuer Befund): DELETE-Guard.
-- Was war falsch: `affiliate_partners_manager_delete` (Abschnitt 9) haengte
-- allein an `status in ('pending','rejected')` -- an einem Zustand also, den
-- derselbe Manager eine Anweisung vorher selbst setzen darf (`status` steht in
-- seinem UPDATE-Recht, und G15 greift nur an SEINER eigenen Zeile). Zwei
-- Requests genuegten: PATCH {"status":"rejected"}, danach DELETE. Weg waren
-- Stammdatenzeile, Abrechnungsprofil (Anschrift, Steuerstatus, IBAN -- ueber
-- `on delete cascade`, Abschnitt 6) und alle Sonderkonditionen mit partner_id.
-- Uebrig blieb ein Pruefpfad, dessen entity_id auf nichts mehr zeigt -- genau
-- der Zustand, den die Datei 24 Zeilen weiter unten ausschliessen will
-- ("Kein DELETE: das Profil gehoert zum Beleg und ist zehn Jahre
-- aufbewahrungspflichtig").
-- Warum beides, Policy UND Guard: die Policy (verengt, siehe Abschnitt 9)
-- bindet das DELETE an unveraenderliche Merkmale statt an den frei setzbaren
-- Status. Der Guard darunter ist die zweite Ebene -- er haelt auch dann, wenn
-- jemand die Policy spaeter wieder aufweicht, und er sieht etwas, das eine
-- Policy nicht sehen kann: den Bestand in ANDEREN Tabellen.
-- OHNE `security definer`: der Guard braucht `current_user`. Folge davon --
-- die `exists`-Abfragen laufen mit den Rechten des Aufrufers; der Manager darf
-- affiliate_billing_profiles seines Mandanten lesen (Policy in Abschnitt 9),
-- die Pruefung sieht also, was sie sehen muss. Zur Sicherheit fail-closed
-- gedacht: sieht er die Zeile NICHT, bleibt der Schutz trotzdem bestehen,
-- weil dann das Abrechnungsprofil zu einem fremden Mandanten gehoert und der
-- Fremdschluessel das DELETE ohnehin nicht zulaesst.
create or replace function public.affiliate_partners_delete_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Erlaubnisliste wie ueberall in dieser Datei, PLUS die Herkunft der
  -- Anweisung: `pg_trigger_depth() > 1` heisst "aus einer Fremdschluessel-
  -- kaskade heraus", und das ist hier der Loeschvorgang eines ganzen
  -- Mandanten (`delete from tenants` kaskadiert auf affiliate_partners).
  -- Ohne diesen Zweig haette der Guard die Mandantenloeschung blockiert --
  -- derselbe Fehler, der in Abschnitt 7 gerade zurueckgenommen wurde, nur
  -- eine Tabelle weiter. Begruendung der Zahl: siehe Abschnitt 7.
  if current_user in ('postgres', 'supabase_admin')
     or pg_trigger_depth() > 1 then
    return old;
  end if;

  -- Ein Abrechnungsprofil entsteht erst, wenn jemand tatsaechlich Partner
  -- geworden ist und Geld erwartet. Es ist damit das haltbarste Merkmal fuer
  -- "diese Zeile gehoert zum Beleg" -- haltbarer als jeder Status, weil es der
  -- Partner selbst anlegt und der Manager es nicht zuruecksetzen kann.
  if exists (select 1 from public.affiliate_billing_profiles b
             where b.partner_id = old.id and b.tenant_id = old.tenant_id) then
    raise exception 'affiliate_partner_has_billing_profile';
  end if;

  -- Vorgriff auf Block B4: sobald es Provisionszeilen gibt, ist die Zeile
  -- unwiderruflich Teil des Buches. Die to_regclass-Pruefung haelt den Guard
  -- bis dahin lauffaehig (plpgsql loest Tabellennamen erst beim Ausfuehren der
  -- jeweiligen Anweisung auf), gleiche Bauart wie im UPDATE-Zweig oben.
  if to_regclass('public.affiliate_commissions') is not null then
    if exists (select 1 from public.affiliate_commissions c
               where c.tenant_id = old.tenant_id and c.partner_id = old.id) then
      raise exception 'affiliate_partner_has_commissions';
    end if;
  end if;

  return old;
end;
$$;
create trigger affiliate_partners_delete_guard_trg before delete on public.affiliate_partners
  for each row execute function public.affiliate_partners_delete_guard();

alter table public.affiliate_partners enable row level security;
revoke all on public.affiliate_partners from anon, authenticated;

-- Zweite Ebene neben RLS: Spaltenrechte, weil RLS keine Spalten trennt (Muster
-- 20260909183548:31-46). Was hier fehlt, ist fuer `authenticated` gar nicht
-- lesbar bzw. schreibbar -- unabhaengig von jeder Policy.
--   Nicht lesbar: applicant_email, status_reason, payout_hold_reason,
--   internal_note, application, terms_accepted_ip_hash. Die Admin-Oberflaeche
--   laedt diese Spalten ueber eine Server-Route mit requireAdminTenant() und
--   createAdminClient().
--
--   KORREKTUR (ZWEITE RUNDE): `payout_hold_reason` ist aus dieser Liste
--   ENTFERNT, und damit ist ein Widerspruch aufgeloest, den beide Gegenleser
--   gefunden haben. Er lautete: die Datei erklaerte den Freitext zum
--   schutzwuerdigen Internum (offener Punkt zur Redaktionsliste in
--   src/lib/affiliate/audit.ts, siehe Abschnitt 9) und gab ihn dem Partner
--   gleichzeitig hier an der Quelle zu lesen -- waehrend `status_reason`,
--   inhaltlich dasselbe, ausgenommen war. Beides zugleich ging nicht.
--   Entschieden ist es wie bei `status_reason`: der Text ist ein interner
--   Vermerk ("Verdacht auf Eigenbestellungen, Anwalt eingeschaltet"), kein
--   Text an den Partner. Der Partner erfaehrt weiterhin DASS gesperrt ist
--   (`payout_hold` bleibt lesbar) und bekommt in der Oberflaeche einen
--   neutralen Hinweis; die Begruendung liest der Manager ueber die
--   Server-Route. Gegenstueck in src/lib/affiliate/audit.ts: die Spalte steht
--   jetzt zusaetzlich in AFFILIATE_AUDIT_REDACTED_KEYS, sonst haette der
--   Pruefpfad das hier gerade Weggenommene wieder ausgeliefert.
--   VORAUSSETZUNG FUER B3: AFFILIATE_PARTNER_CLIENT_COLUMNS
--   (src/lib/affiliate/types.ts:407-426) fuehrt "payout_hold_reason" noch --
--   die Konstante bildet genau dieses Spaltenrecht ab und hat heute keinen
--   Aufrufer (lesend geprueft). Wer sie als erster benutzt, muss den Eintrag
--   vorher entfernen, sonst scheitert die Abfrage mit 42501.
--
--   KORREKTUR (B10): ACHTUNG FUER DEN ANWENDUNGSCODE -- dieses Leserecht ist
--   LOECHRIG, und affiliate_partners ist die erste Tabelle des Projekts, bei
--   der das so ist (live gegengeprueft: `public.tenants` traegt den
--   SELECT-Grant auf allen elf Spalten, dort faellt es deshalb nie auf).
--   `supabase.from('affiliate_partners').select('*')` scheitert hier mit 42501
--   `permission denied for column applicant_email` -- und zwar erst im
--   Betrieb, weil in dieser Umgebung kein Test gegen eine echte Datenbank
--   laeuft. JEDE Client-Abfrage auf diese Tabelle MUSS ihre Spalten benennen.
--   Dasselbe gilt nach der Korrektur zu B7 fuer affiliate_billing_profiles.
--   Gehoert zusaetzlich unter "Risiken" in PHASENSTATUS.md.
grant select (id, tenant_id, program_id, user_id, display_name, company, code, status,
              group_id, referred_by, payout_hold,
              terms_version_accepted, terms_accepted_at,
              notify_sale, notify_reversal, notify_payout, created_at, updated_at)
  on public.affiliate_partners to authenticated;
--   Nicht schreibbar: code, user_id, tenant_id, program_id, applicant_email.
--   Die Rollentrennung INNERHALB der erlaubten Spalten leistet der Guard oben --
--   Spaltenrechte sind nicht rollenabhaengig und koennen das nicht.
--
--   KORREKTUR (B9): terms_version_accepted, terms_accepted_at und
--   terms_accepted_ip_hash sind aus dieser Liste ENTFERNT.
--   Was war falsch: der Guard verhinderte nur das Zuruecksetzen auf eine
--   AELTERE Fassung; Zeitstempel und IP-Hash waren vom Partner frei setzbar.
--   Szenario: ein Partner bestreitet eine Konditionsaenderung und schickt
--   vorher PATCH /rest/v1/affiliate_partners?id=eq.<eigene> mit
--   {"terms_accepted_at":"2027-03-01T00:00:00Z","terms_accepted_ip_hash":"..."}.
--   terms_version_accepted bleibt gleich, die Rueckfall-Bedingung greift nicht,
--   der Zeitstempel wird uebernommen -- der Mandant kann im Streitfall nicht
--   mehr belegen, wann welche Fassung akzeptiert wurde.
--   Warum jetzt richtig: ein Nachweis nach Art. 7 Abs. 1 DSGVO, den der
--   Nachzuweisende selbst schreibt, ist keiner. Die Zustimmung schreibt
--   ausschliesslich die Server Action ueber createAdminClient(), nachdem sie
--   IP und Textfassung serverseitig bestimmt hat. Der Guard-Zweig weiter oben
--   bleibt als Tiefenverteidigung stehen.
grant update (display_name, company, notify_sale, notify_reversal, notify_payout,
              status, status_reason, group_id, referred_by,
              payout_hold, payout_hold_reason, internal_note)
  on public.affiliate_partners to authenticated;
-- INSERT und DELETE als Tabellenrecht; die Einschraenkung leisten die Policies
-- in Abschnitt 9. Ohne diese beiden Zeilen waeren die Manager-Policies
-- wirkungslos -- `revoke all` hat auch INSERT und DELETE entfernt.
grant insert on public.affiliate_partners to authenticated;
grant delete on public.affiliate_partners to authenticated;

-- =================================================================
-- 5. affiliate_conditions (Plan 3.5) -- die Vorrangkette der Saetze
-- =================================================================

create table public.affiliate_conditions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  program_id  uuid not null,
  partner_id  uuid,                        -- null = alle Partner
  group_id    uuid,                        -- null = alle Gruppen
  product_id  uuid,                        -- null = alle Produkte
  rate_kind   text not null default 'percent' check (rate_kind in ('percent','fixed')),
  -- KORREKTUR (ZWEITE RUNDE): HIER STAND `default 0` an beiden Spalten.
  -- Was war falsch: der Vorgabewert kehrte die Bedeutung um. Eine
  -- Konditionszeile hat IMMER hoehere Spezifitaet als der Programmstandard
  -- (affiliate_programs.rate_bp, dort `default 2000`) und schlaegt ihn damit
  -- IMMER. Wer eine Zeile ohne Satz anlegte, setzte die Provision also nicht
  -- auf den Standard, sondern auf null.
  -- Szenario: ein Manager nimmt ein einzelnes Produkt ins Programm auf und
  -- schickt POST /rest/v1/affiliate_conditions {"tenant_id":...,
  -- "program_id":...,"product_id":"P"} -- ohne rate_bp, weil er die 20 % des
  -- Programms erwartet. Ab Block B4 bucht jede Bestellung auf P 0 Cent
  -- Provision; die Partner reklamieren Wochen spaeter, und die Gegenbuchung
  -- auf bereits ausgezahlte Gutschriften ist der teure Teil.
  -- Warum jetzt richtig: ohne Vorgabewert MUSS der Satz genannt werden, sonst
  -- bricht der INSERT mit 23502 ab -- laut statt still. Eine bewusste
  -- Null-Kondition ("dieses Produkt ist von der Provision ausgenommen") bleibt
  -- moeglich, muss aber ausgeschrieben werden. Preis: auch die jeweils NICHT
  -- benutzte Spalte muss mitgeschickt werden (bei rate_kind 'percent' also
  -- `fixed_cents: 0`); das ist der Sinn der Sache, weil "0" hier eine Aussage
  -- ist und keine Auslassung.
  rate_bp     int  not null check (rate_bp between 0 and 10000),
  fixed_cents int  not null check (fixed_cents >= 0),
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Die Rangfolge ist eine generierte Spalte und damit nicht durch einen
  -- Tippfehler kippbar. Partner schlaegt Gruppe schlaegt Produkt; die Summe
  -- macht die Kette zu genau einer Sortierung.
  -- KORREKTUR (B14): Die ABSOLUTEN Werte sind bedeutungslos, allein die
  -- Ordnung zaehlt: Partner+Produkt 25 > Partner 20 > Gruppe+Produkt 15 >
  -- Gruppe 10 > Produkt 5 > kein Treffer (= Programmstandard). Der Plan nannte
  -- fuer die oberste Stufe 30 statt 25 -- dieselbe Kette, andere Zahl. Der
  -- PLAN ist korrigiert (Abschnitt 1.1 und 5.2), nicht diese Spalte: 20+5 ist
  -- die natuerliche Summe der Zuschlaege, 30 waere ein Sonderfall, den man
  -- ausrechnen statt addieren muesste. Wer hier eine Zahl aendert, muss die
  -- ORDNUNG pruefen, nicht die Zahl.
  specificity int generated always as (
      (case when partner_id is not null then 20 else 0 end)
    + (case when group_id   is not null then 10 else 0 end)
    + (case when product_id is not null then  5 else 0 end)
  ) stored,
  check (valid_to is null or valid_to > valid_from),
  -- Partner ODER Gruppe, nie beides: sonst waere die Rangfolge zweideutig.
  check (num_nonnulls(partner_id, group_id) <= 1),
  -- Mindestens ein Geltungsbereich: eine Zeile ohne jeden Bezug waere eine
  -- zweite Standardkondition neben affiliate_programs.
  check (num_nonnulls(partner_id, group_id, product_id) >= 1),
  unique (id, tenant_id),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade,
  foreign key (group_id, tenant_id)   references public.affiliate_groups   (id, tenant_id) on delete cascade,
  foreign key (product_id, tenant_id) references public.products           (id, tenant_id) on delete cascade
);

-- Der Aufloesungsindex der Vorrangkette: ein Treffer je Bestellung, sortiert
-- ohne Nachsortierung im Speicher.
create index affiliate_conditions_lookup_idx
  on public.affiliate_conditions (tenant_id, program_id, specificity desc, valid_from desc);
-- Je ein Index auf BEIDE Spalten jedes zusammengesetzten Fremdschluessels, in
-- dessen Spaltenreihenfolge. affiliate_conditions_lookup_idx zaehlt fuer
-- (program_id, tenant_id) NICHT: er beginnt mit tenant_id, der Fremdschluessel
-- aber mit program_id.
create index affiliate_conditions_program_idx on public.affiliate_conditions (program_id, tenant_id);
create index affiliate_conditions_partner_idx on public.affiliate_conditions (partner_id, tenant_id);
create index affiliate_conditions_group_idx   on public.affiliate_conditions (group_id, tenant_id);
create index affiliate_conditions_product_idx on public.affiliate_conditions (product_id, tenant_id);

-- KORREKTUR (B6, HOCH): HIER STAND EIN EXCLUDE-CONSTRAINT
--   affiliate_conditions_no_overlap ... exclude using gist (... tstzrange(valid_from, valid_to) with &&)
-- der sich mit `&&` gegen JEDE Zeitueberschneidung bei gleichem Geltungsbereich
-- richtete. Er ist ersetzt.
--
-- Was war falsch: er verbot genau das Zeilenpaar, auf dem die Satzaufloesung
-- des Plans (5.2) aufbaut. Dort steht woertlich, `valid_from desc` solle dafuer
-- sorgen, "dass eine befristete Aktionskondition eine dauerhafte Regel gleicher
-- Spezifitaet schlaegt" -- gleiche Spezifitaet bei gleichem Geltungsbereich
-- heisst aber identische Werte in allen fuenf Schluesselspalten, und die
-- Zeitraeume ueberschneiden sich zwangslaeufig, weil die Dauerregel
-- `valid_to is null` traegt.
-- Szenario: fuer Partner P gilt eine Dauerkondition (valid_from 2026-01-01,
-- valid_to null, 20 %). Der Manager legt fuer den Black Friday eine Aktion an
-- (valid_from 2026-11-27, valid_to 2026-12-01, 35 %).
-- tstzrange('2026-01-01',NULL) && tstzrange('2026-11-27','2026-12-01') ist
-- true -- 23P01 exclusion_violation. Die Aktionskondition, die Plan 1.1 und 5.2
-- als Kernfunktion beschreiben, war nie anlegbar; der Manager haette die
-- Dauerregel beenden und danach neu anlegen muessen, was die Vorrangkette und
-- den condition_snapshot-Nachweis zerreisst.
--
-- Warum die neue Fassung richtig ist: das Schutzgut war nie
-- "Ueberschneidungsfreiheit", sondern "kein Wuerfelwurf" -- es darf nicht zwei
-- Zeilen geben, zwischen denen die Sortierung aus 5.2 nicht sachlich
-- entscheiden kann. Die Sortierung lautet
-- `specificity desc, valid_from desc, id` und ist bereits deterministisch; sie
-- entscheidet sachlich, SOLANGE sich die Zeilen in `valid_from` unterscheiden.
-- Genau das erzwingt die Eindeutigkeit unten: je Geltungsbereich hoechstens
-- EINE Zeile mit demselben `valid_from`. Damit ist die Aktionskondition
-- einfuegbar (anderes valid_from, gewinnt waehrend ihrer Laufzeit ueber
-- `valid_from desc`, und nach `valid_to` faellt sie durch die WHERE-Bedingung
-- aus 5.2 heraus, worauf die Dauerregel unveraendert wieder greift), waehrend
-- zwei sachlich ununterscheidbare Zeilen weiterhin abgewiesen werden.
-- `coalesce` auf die Nulluuid bleibt noetig, weil NULL in einem eindeutigen
-- Index nie mit NULL kollidiert und der Fall "alle Partner" sonst ungeschuetzt
-- bliebe.
-- Josip kann dies spaeter durch die zweite saubere Variante ersetzen (eine
-- Rangspalte `tier in ('base','promo')` im EXCLUDE-Schluessel plus
-- `(tier = 'promo') desc` in der Sortierung von 5.2). Sie ist nicht gewaehlt
-- worden, weil sie den Plan an einer zweiten Stelle aendern wuerde und das hier
-- nicht beauftragt war.
-- btree_gist wird damit von dieser Datei nicht mehr gebraucht; die Extension
-- bleibt unberuehrt (sie hat Abhaengige, 20260807142619:63).
create unique index affiliate_conditions_scope_uniq
  on public.affiliate_conditions (
    tenant_id,
    program_id,
    (coalesce(partner_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(group_id,   '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    valid_from
  );

-- Eine Kategorie-Stufe ist bewusst NICHT vorgesehen: course_categories haengt
-- an courses (20260722180000:47), ein Produkt traegt course_ids[]
-- (0001_init.sql:238) -- es gibt also keine eine Kategorie je Bestellung. Ein
-- solcher Spezifitaetsrang waere eine Spalte, die nie gefuellt wird.

-- Guard OHNE `security definer`: die Funktion braucht keine erhoehten Rechte,
-- `affiliate_partner_id()` ist selbst security definer und wird zur Laufzeit
-- aufgeloest (plpgsql), darf hier also vor ihrer eigenen Definition stehen.
create or replace function public.affiliate_conditions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    new.id         := old.id;
    new.tenant_id  := old.tenant_id;
    new.program_id := old.program_id;
    new.created_at := old.created_at;
    -- KORREKTUR (B6, ZWEITE RUNDE): `valid_from` ist beim UPDATE fuer JEDE
    -- Rolle fest -- der stille Kippschalter, den der Ersatz des
    -- EXCLUDE-Constraints geoeffnet hatte, ist damit zur Haelfte zu (die
    -- andere Haelfte steht unten). Begruendung ausfuehrlich am Index
    -- affiliate_conditions_scope_uniq; kurz: `valid_from` ist nicht irgendein
    -- Feld, sondern der Tiebreaker der Satzaufloesung aus Plan 5.2. Wer ihn an
    -- einer bestehenden Dauerregel neu setzt, schlaegt eine laufende
    -- Aktionskondition, ohne dass irgendwo etwas passiert waere. Eine
    -- Korrektur des Beginns ist weiterhin moeglich -- als Loeschen und
    -- Neuanlegen, also als sichtbarer Vorgang mit eigenem Pruefpfadeintrag.
    new.valid_from := old.valid_from;
  -- KORREKTUR (INSERT-Pfad-Durchgang): Dieser Guard war als EINZIGER der Datei
  -- schon `before insert or update` -- aber auch hier galt die Asymmetrie bei
  -- den Zeitstempeln: `created_at` wurde beim UPDATE festgenagelt und war beim
  -- INSERT client-setzbar. Mandant und Programm sind beim INSERT ueber die
  -- INSERT-Policy und die zusammengesetzten Fremdschluessel gebunden, dort ist
  -- nichts nachzuholen.
  elsif current_user not in ('postgres', 'supabase_admin', 'service_role') then
    new.created_at := now();
    new.updated_at := now();
  end if;

  -- Plan G15: niemand setzt sich selbst einen Satz. Geprueft wird die PERSON,
  -- nicht die Rolle -- affiliate_self_partner_id() liefert fuer service_role
  -- null (auth.uid() ist dort null), der Server-Pfad laeuft unberuehrt durch.
  --
  -- KORREKTUR (ZWEITE RUNDE, beide Gegenleser): hier stand ausschliesslich die
  -- Pruefung auf `new.partner_id`, und zwar gegen `affiliate_partner_id()`.
  -- Zwei Loecher in einer Zeile:
  --   (a) GRUPPE. Ein Manager, der selbst Partner ist, legte statt einer
  --       Partnerkondition eine Kondition fuer DIE GRUPPE an, in der er
  --       ohnehin steht -- partner_id blieb null, der Guard schwieg, die Zeile
  --       hatte Spezifitaet 10 und schlug den Programmstandard. 90 % auf jeden
  --       Kauf ueber seinen Link. Der zusaetzliche group_id-Riegel in
  --       affiliate_partners_guard (Abschnitt 4) half nicht: der verhindert
  --       den WECHSEL der Gruppe, nicht das Aufwerten der eigenen.
  --   (b) STATUS. `affiliate_partner_id()` filtert `status = 'active'`. Wessen
  --       eigene Partnerzeile noch 'pending' oder 'suspended' war, fiel durch
  --       die Pruefung hindurch; die Zeile blieb stehen und wirkte ab der
  --       Freigabe. Deshalb steht hier jetzt affiliate_self_partner_id() --
  --       dieselbe Auskunft OHNE Statusfilter.
  if public.affiliate_self_partner_id(new.tenant_id) is not null
     and (
       new.partner_id = public.affiliate_self_partner_id(new.tenant_id)
       or (new.group_id is not null
           and new.group_id = public.affiliate_self_group_id(new.tenant_id))
     ) then
    raise exception 'affiliate_self_condition_forbidden';
  end if;
  -- GRENZE VON G15, ausdruecklich benannt statt als Schutz behauptet (das war
  -- der eigentliche Vorwurf beider Gegenleser -- der Kommentar versprach mehr
  -- als der Code hielt):
  --   * Eine reine PRODUKTkondition (partner_id und group_id null) gilt fuer
  --     ALLE Partner und damit auch fuer einen Manager, der selbst Partner
  --     ist. Sie laesst sich nicht sperren, ohne demselben Manager die
  --     Konfiguration seines Programms unmoeglich zu machen -- ein Betreiber,
  --     der sein eigener erster Partner ist, koennte dann gar keine
  --     Produktsaetze mehr pflegen.
  --   * Dasselbe gilt erst recht fuer affiliate_programs.rate_bp: den
  --     Standardsatz seines eigenen Programms MUSS der Manager setzen duerfen.
  -- G15 schuetzt also gegen GEZIELTE Selbstbevorzugung (eigene Zeile, eigene
  -- Gruppe, eigene Werberstellung), nicht gegen einen Manager, der die Saetze
  -- fuer alle anhebt. Gegen den zweiten Fall wirken die Mittel, die dafuer
  -- gebaut sind: jede dieser Aenderungen trifft jeden Partner sichtbar, der
  -- Pruefpfad haelt sie fest, und die Vier-Augen-Regel liegt in der Anwendung.
  --
  -- KORREKTUR (B6, ZWEITE RUNDE, zweite Haelfte): Der Ersatz des
  -- EXCLUDE-Constraints laesst zwei Zeilen gleichen Geltungsbereichs mit
  -- ueberlappender Laufzeit ausdruecklich zu -- das MUSS er, sonst waere die
  -- Aktionskondition wieder un-einfuegbar. Er laesst damit aber auch das
  -- Umgekehrte zu: eine NEUE Dauerregel mit heutigem valid_from schlaegt eine
  -- laufende Aktion still, weil `valid_from desc` entscheidet. Genau das
  -- faengt die Pruefung hier ab -- und zwar nur diesen einen Fall.
  -- Gelesen: "die neue Zeile beginnt INNERHALB der Laufzeit einer befristeten
  -- Zeile desselben Geltungsbereichs und wuerde sie damit ueberholen".
  -- Nicht betroffen und weiterhin moeglich: die Aktionskondition selbst (sie
  -- misst sich an Zeilen mit `valid_to is not null`, die Dauerregel hat
  -- keins), das Aendern des Satzes einer bestehenden Zeile (valid_from ist
  -- oben festgenagelt, die Zeile misst sich an ihrem eigenen alten Beginn),
  -- und jede Aktion nach dem Ende der vorigen.
  -- Wer die laufende Aktion wirklich ueberschreiben will, beendet sie
  -- (valid_to) und legt danach an -- ein sichtbarer Vorgang statt eines
  -- stillen. 'postgres'/'supabase_admin' bleiben aussen vor, damit ein
  -- Migrations- oder Dashboard-Eingriff Altdaten geradeziehen kann.
  if current_user not in ('postgres', 'supabase_admin')
     and exists (
       select 1
       from public.affiliate_conditions c
       where c.tenant_id  = new.tenant_id
         and c.program_id = new.program_id
         and c.id <> new.id
         and coalesce(c.partner_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(new.partner_id, '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(c.group_id,   '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(new.group_id,   '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(c.product_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(new.product_id, '00000000-0000-0000-0000-000000000000'::uuid)
         and c.valid_to is not null
         and new.valid_from >= c.valid_from
         and new.valid_from <  c.valid_to
     ) then
    raise exception 'affiliate_condition_would_shadow_promo';
  end if;
  return new;
end;
$$;
create trigger affiliate_conditions_guard_trg before insert or update on public.affiliate_conditions
  for each row execute function public.affiliate_conditions_guard();
create trigger affiliate_conditions_touch before update on public.affiliate_conditions
  for each row execute function public.set_updated_at();

alter table public.affiliate_conditions enable row level security;
revoke all on public.affiliate_conditions from anon, authenticated;
-- KORREKTUR (ZWEITE RUNDE): HIER STAND
--   grant select, insert, update, delete ... to authenticated;
-- also ein SELECT als Tabellenrecht ueber ALLE Spalten, `note` eingeschlossen.
-- Was war falsch: die verengte SELECT-Policy (Abschnitt 9) gibt dem Partner
-- jetzt nur noch die Konditionen, die fuer IHN gelten -- aber auf diesen
-- Zeilen las er weiterhin den Freitext des Managers mit. `note` ist derselbe
-- Datentyp wie `internal_note` auf affiliate_partners: ein Vermerk UEBER den
-- Partner, nicht FUER ihn ("Sonderkondition, weil Kuendigung droht"). Die
-- Datei nimmt solche Spalten sonst konsequent aus dem Leserecht.
-- Warum Spaltenrecht und nicht Policy: RLS trennt keine Spalten. Und weil
-- Spaltenrechte nicht rollenabhaengig sind, verliert auch der MANAGER das
-- Leserecht auf `note` -- das ist kein Versehen, sondern der bekannte Preis
-- dieses Musters (gleiche Stelle wie bei applicant_email und internal_note in
-- Abschnitt 4). Schreiben darf er die Spalte weiterhin.
-- ACHTUNG FUER DEN ANWENDUNGSCODE (B10): dieses Leserecht ist damit ebenfalls
-- loechrig -- `select('*')` bricht hier mit 42501. Spalten benennen.
-- VORAUSSETZUNG FUER B3/B7: die Konditionsliste der Manager-Oberflaeche muss
-- `note` ueber eine Server-Route mit requireAdminTenant() und
-- createAdminClient() nachladen, so wie es die Partnerliste fuer
-- internal_note und status_reason ohnehin schon tun muss. Ohne diese Route
-- gibt es die Notiz in der Oberflaeche nicht.
grant insert, update, delete on public.affiliate_conditions to authenticated;
grant select (id, tenant_id, program_id, partner_id, group_id, product_id,
              rate_kind, rate_bp, fixed_cents, valid_from, valid_to,
              specificity, created_at, updated_at)
  on public.affiliate_conditions to authenticated;

-- =================================================================
-- 6. affiliate_billing_profiles (Plan 3.13)
-- =================================================================
-- Anschrift, Steuerstatus und Zahlungsverbindung -- getrennt von den Stammdaten,
-- damit keine Partnerliste und kein Export sie versehentlich mitselektiert.

create table public.affiliate_billing_profiles (
  partner_id     uuid primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  entity_kind    text check (entity_kind in ('business','private')),
  legal_name     text,
  street         text,
  postal_code    text,
  city           text,
  country        text check (country is null or country ~ '^[A-Z]{2}$'),
  small_business boolean not null default false,     -- § 19 UStG
  vat_id         text,
  tax_number     text,
  vat_checked_at   timestamptz,
  vat_check_result text check (vat_check_result in ('valid','invalid','unchecked')),
  vat_check_log    jsonb not null default '{}'::jsonb,
  payout_method  text check (payout_method in ('sepa','paypal','manual')),
  account_holder text,
  iban           text,
  bic            text,
  paypal_email   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- KORREKTUR (ZWEITE RUNDE): HIER STAND `unique (partner_id, tenant_id)`.
  -- Das war vollstaendig redundant: `partner_id` ist Primaerschluessel und
  -- damit bereits eindeutig, eine zweite Eindeutigkeit ueber dasselbe Feld
  -- plus tenant_id kann nichts zusaetzlich ausschliessen. Gebraucht wird eine
  -- Eindeutigkeit ueber (id, tenant_id) nur auf der REFERENZIERTEN Seite eines
  -- zusammengesetzten Fremdschluessels -- die steht in Abschnitt 4 an
  -- affiliate_partners. Uebrig blieb ein zweiter btree-Index auf jeder
  -- Schreiboperation und ein Dauerbefund "unused index" im
  -- Performance-Advisor; dieselbe Redundanz, die B15 fuer
  -- affiliate_programs_tenant_idx entfernt hat.
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade
);
-- Fremdschluessel tenant_id -> tenants(id). Der zusammengesetzte
-- Fremdschluessel (partner_id, tenant_id) braucht keinen eigenen Index: der
-- Primaerschluessel-Index ueber `partner_id` ist sein fuehrendes Spaltenpraefix
-- und traegt jede Suche nach der Kindzeile (eine je Partner), tenant_id bleibt
-- Restfilter auf genau dieser einen Zeile.
create index affiliate_billing_profiles_tenant_idx on public.affiliate_billing_profiles (tenant_id);

-- Die drei vat_check_*-Felder brauchen einen Guard, KEINEN Spalten-Grant:
-- Spaltenrechte sind nicht rollenabhaengig, und da der Partner auf derselben
-- Tabelle UPDATE braucht, koennte er sonst seinen eigenen USt-IdNr.-Pruefstatus
-- auf 'valid' setzen und damit Reverse Charge und die Auszahlungsfreigabe selbst
-- erzeugen -- ein direkter Steuer- und Geldfluss-Bypass.
-- OHNE `security definer`, weil die Funktion `current_user` sehen muss (dieselbe
-- Begruendung wie in Abschnitt 0 (d)); sie liest keine andere Tabelle und
-- braucht keine erhoehten Rechte.
create or replace function public.affiliate_billing_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- KORREKTUR (B3, KRITISCH): Dieser Zweig ist neu und MUSS ganz vorn stehen;
  -- beim INSERT ist OLD nicht zugewiesen, jeder `old.`-Zugriff darunter waere
  -- ein Laufzeitfehler (55000).
  -- Was war falsch: der Trigger war `before update`, der INSERT-Pfad damit
  -- voellig ungeschuetzt. affiliate_billing_self_insert laesst den Partner
  -- seine eigene Profilzeile anlegen, und `grant ... insert` gilt fuer ALLE
  -- Spalten. Der Guard schuetzte also erst die ZWEITE und jede weitere
  -- Aenderung -- genau der Bypass, den der Kommentar direkt darueber
  -- ausschliessen will.
  -- Szenario: ein freigegebener Partner ruft
  -- POST /rest/v1/affiliate_billing_profiles auf mit
  -- {"partner_id":"<eigene>","tenant_id":"<eigener>","entity_kind":"business",
  --  "vat_id":"DE999999999","vat_check_result":"valid",
  --  "vat_checked_at":"2026-09-11T00:00:00Z","payout_method":"sepa","iban":"..."}.
  -- Die Policy prueft nur partner_id, kein Trigger lief. Das Profil stand
  -- danach als VIES-geprueft im Buch, obwohl nie eine Pruefung stattfand:
  -- Reverse Charge auf der Gutschrift und die Auszahlungsfreigabe waren selbst
  -- erzeugt.
  -- Warum jetzt richtig: kein Client legt je ein Pruefergebnis an. Ein neues
  -- Profil startet immer ungeprueft; das Ergebnis schreibt ausschliesslich der
  -- Serverlauf, der die Erlaubnisliste passiert.
  if tg_op = 'INSERT' then
    if current_user in ('postgres', 'supabase_admin', 'service_role') then
      return new;
    end if;
    new.vat_checked_at   := null;
    new.vat_check_result := 'unchecked';
    new.vat_check_log    := '{}'::jsonb;
    new.created_at       := now();
    new.updated_at       := now();
    return new;
  end if;

  -- Fuer JEDE Rolle fest: das Profil wechselt nie den Partner und nie den
  -- Mandanten.
  new.partner_id := old.partner_id;
  new.tenant_id  := old.tenant_id;
  new.created_at := old.created_at;

  -- ERLAUBNISLISTE: nur diese drei Rollen schreiben das Ergebnis der
  -- VIES-Pruefung. Wer nicht genannt ist, faellt in den geschuetzten Zweig.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  new.vat_checked_at   := old.vat_checked_at;
  new.vat_check_result := old.vat_check_result;
  new.vat_check_log    := old.vat_check_log;

  -- Jede Aenderung der USt-IdNr. setzt den Pruefstatus zurueck. Die
  -- Zuruecksetzung steht ausdruecklich NUR in diesem Zweig: der Serverlauf
  -- schreibt neue Nummer und neues Pruefergebnis in einer Anweisung und darf
  -- sich nicht selbst ueberschreiben. Den zugehoerigen Audit-Eintrag schreibt
  -- die Server Action (Plan 3.16) -- dasselbe gilt fuer Aenderungen an IBAN und
  -- PayPal-Adresse.
  if new.vat_id is distinct from old.vat_id then
    new.vat_check_result := 'unchecked';
    new.vat_checked_at   := null;
  end if;
  return new;
end;
$$;
-- KORREKTUR (B3): `before insert or update` statt `before update`.
create trigger affiliate_billing_profiles_guard_trg before insert or update on public.affiliate_billing_profiles
  for each row execute function public.affiliate_billing_guard();
create trigger affiliate_billing_profiles_touch before update on public.affiliate_billing_profiles
  for each row execute function public.set_updated_at();

alter table public.affiliate_billing_profiles enable row level security;
revoke all on public.affiliate_billing_profiles from anon, authenticated;
-- Kein DELETE: das Profil gehoert zum Beleg und ist zehn Jahre
-- aufbewahrungspflichtig; die DSGVO-Loeschung laeuft ueber Anonymisierung
-- (Plan 7.8).
--
-- KORREKTUR (B7): HIER STAND
--   grant select, insert, update on public.affiliate_billing_profiles to authenticated;
-- also ein SELECT als Tabellenrecht ueber ALLE Spalten.
-- Was war falsch: affiliate_billing_select laesst jeden owner/admin des
-- Mandanten lesen. Damit standen `iban`, `bic`, `paypal_email`, `tax_number`
-- und `vat_id` saemtlicher Partner im Browser jedes Mandanten-Admins. Die
-- Datei benutzt fuer genau dieses Problem bei affiliate_partners die zweite
-- Ebene aus Spaltenrechten -- hier nicht, obwohl der Policy-Kommentar in
-- Abschnitt 9 den Angriff ("Auszahlungen umleiten, sobald ein Haendler-Konto
-- uebernommen wurde") selbst benennt und nur gegen SCHREIBEN absichert.
-- Szenario: ein Mandanten-Admin-Konto wird uebernommen (Phishing, geteiltes
-- Passwort, ausgeschiedener Mitarbeiter mit noch aktiver Mitgliedschaft). Der
-- Angreifer ruft GET /rest/v1/affiliate_billing_profiles?select=* auf und
-- exfiltriert IBAN, BIC, PayPal-Adresse, Steuernummer und USt-IdNr. aller
-- Partner in EINEM Request -- ohne etwas zu aendern und damit ohne
-- Audit-Eintrag, denn protokolliert werden nur Schreibvorgaenge.
-- Warum jetzt richtig: der Manager braucht fuer den Beleg Anschrift und
-- Steuerstatus, nicht die Zahlungsverbindung. Bankdaten laedt die
-- Auszahlungsroute serverseitig ueber createAdminClient() mit ausdruecklicher
-- Spaltenliste; der Partner sieht seine eigene IBAN ueber dieselbe Route,
-- maskiert.
-- ACHTUNG FUER DEN ANWENDUNGSCODE (B10): auch dieses Leserecht ist loechrig --
-- `select('*')` bricht hier mit 42501. Spalten benennen.
-- INSERT und UPDATE bleiben Tabellenrechte: die Einschraenkung leisten dort
-- die Policies in Abschnitt 9 und der Guard oben, und der Partner muss seine
-- Bankdaten schreiben koennen.
grant insert, update on public.affiliate_billing_profiles to authenticated;
grant select (partner_id, tenant_id, entity_kind, legal_name, street, postal_code,
              city, country, small_business, vat_id, vat_checked_at,
              vat_check_result, payout_method, created_at, updated_at)
  on public.affiliate_billing_profiles to authenticated;
-- Ohne Leserecht bleiben: iban, bic, account_holder, paypal_email, tax_number,
-- vat_check_log. `account_holder` steht ausdruecklich dabei -- er gehoert zur
-- Zahlungsverbindung, nicht zum Beleg (dieselbe Einordnung wie in
-- src/lib/affiliate/audit.ts, Redaktionsgruppe (a)); `vat_id` bleibt lesbar,
-- weil der Steuermodus der Gutschrift ohne sie nicht pruefbar ist.

-- =================================================================
-- 7. affiliate_audit_log (Plan 3.16)
-- =================================================================
-- Ein Pruefpfad, der aenderbar ist, ist keiner -- und er ist nicht nachruestbar.

create table public.affiliate_audit_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_kind    text not null check (actor_kind in ('manager','partner','system')),
  entity        text not null check (entity in
                  ('program','partner','condition','group','commission','payout','profile',
                   'referral','creative')),
  entity_id     uuid,
  action        text not null,
  -- before/after werden VOR dem Schreiben redigiert: IBAN, paypal_email,
  -- tax_number, vat_id und terms_accepted_ip_hash erscheinen nur als "***" mit
  -- Aenderungsmarker, nie im Klartext (Plan 11.11, src/lib/affiliate/audit.ts).
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);

create index affiliate_audit_log_entity_idx
  on public.affiliate_audit_log (tenant_id, entity, entity_id, created_at desc);
-- Fremdschluessel actor_user_id -> profiles(id) (Advisor "unindexed foreign
-- keys"); der Index traegt zugleich die Auskunft nach Art. 15 DSGVO.
create index affiliate_audit_log_actor_idx on public.affiliate_audit_log (actor_user_id);

-- Unveraenderlich auch gegenueber dem Admin-Client. Die ERLAUBNISLISTE fuer
-- das AENDERN laesst nur Migrationen und Dashboard-Eingriffe durch
-- ('postgres'/'supabase_admin'), damit die Anonymisierung nach Plan 7.8 als
-- bewusster, protokollierter Eingriff moeglich bleibt -- 'service_role', also
-- der normale Serverbetrieb, steht dort bewusst NICHT. Fuer das LOESCHEN gilt
-- eine eigene Liste -- dieselben zwei Rollen, ERGAENZT UM DIE HERKUNFT DER
-- ANWEISUNG (`pg_trigger_depth() > 1`, also: nur als Kaskade eines
-- Elternloeschens). 'service_role' steht auch dort NICHT; Begruendung im
-- Funktionsrumpf. OHNE `security definer` (braucht current_user).
create or replace function public.affiliate_audit_log_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- KORREKTUR (B5, ZWEITE RUNDE -- die Korrektur der ersten Runde ist
  -- ZURUECKGENOMMEN). Der DELETE-Fall bleibt aus der gemeinsamen
  -- Erlaubnisliste herausgeloest, laesst 'service_role' aber NICHT mehr durch.
  --
  -- WAS IN DER ERSTEN RUNDE FALSCH WAR: die Liste des DELETE-Zweigs war um
  -- 'service_role' erweitert worden, weil die Mandantenloeschung im
  -- Betreiber-Portal (src/lib/platform/actions.ts:295,
  -- `admin.from("tenants").delete()`) sonst angeblich blockiert sei. Die
  -- PRAEMISSE traegt nicht (gleich darunter belegt), die FOLGE war ein echter
  -- Schutzverlust: der gesamte Serverbetrieb laeuft unter 'service_role' --
  -- jede Route mit createAdminClient() konnte den Pruefpfad danach zeilenweise
  -- und spurlos raeumen. Bei einer Tabelle, deren einziger Zweck
  -- Unveraenderlichkeit ist, genuegt dafuer ein falscher Filter in einer
  -- kuenftigen Server Action oder ein geleakter service_role-Schluessel.
  --
  -- WARUM DIE PRAEMISSE NICHT TRAEGT (lesend gegen die Live-Datenbank
  -- vklqksdiyiijzoirntyt belegt, 11.09.2026): eine ON-DELETE-Kaskade laeuft
  -- nicht unter der Rolle des Aufrufers. Die Aktion haengt als INTERNER
  -- Trigger an der ELTERN-Tabelle -- `pg_trigger` join `pg_proc` fuer
  -- `relname = 'tenants'` liefert je Kind-Fremdschluessel ein
  -- RI_ConstraintTrigger mit tgisinternal = true und der Funktion
  -- `RI_FKey_cascade_del` -- und PostgreSQL schaltet dabei die
  -- Benutzerkennung auf den EIGENTUEMER der referenzierenden Tabelle um
  -- (ri_PerformCheck/SetUserIdAndSecContext auf relowner; deshalb braucht
  -- eine Kaskade auch kein DELETE-Recht auf der Kindtabelle). Eigentuemer ist
  -- hier 'postgres': ALLE 52 Tabellen in `public` gehoeren dieser Rolle
  -- (pg_class.relowner gegen pg_roles gelesen), und die Tabellen dieser Datei
  -- entstehen unter derselben Rolle, weil die Migration so angewendet wird.
  -- 'postgres' stand von Anfang an in der Liste -- die Mandantenloeschung war
  -- also nie blockiert.
  -- ANNAHME, DIE LESEND NICHT BEWEISBAR IST: dass `current_user` im
  -- Kind-Trigger tatsaechlich 'postgres' ZEIGT, folgt aus dem Quelltext von
  -- ri_triggers.c, nicht aus einer Messung -- die braeuchte einen
  -- Schreibvorgang, und diese Umgebung darf nicht in die Live-Datenbank
  -- schreiben (auch nicht "mit ROLLBACK"). Genau deshalb haengt die Kaskade
  -- unten NICHT mehr an dieser Annahme.
  --
  -- WARUM ZUSAETZLICH `pg_trigger_depth() > 1`: dieser Zweig macht die
  -- Kaskade von der Rollenfrage unabhaengig -- er prueft die HERKUNFT der
  -- Anweisung statt der Rolle. Die Zahl ist geprueft und nicht geraten:
  --   * Ein direktes `delete from public.affiliate_audit_log ...` ruft den
  --     BEFORE-Trigger DIESER Anweisung auf, und der sieht bereits Tiefe 1.
  --     `> 1` laesst ihn also NICHT durch -- das ist der springende Punkt:
  --     das gezielte Einzel-DELETE aus einer Server-Route bleibt verboten,
  --     und genau das war der Schaden der ersten Runde.
  --   * Eine Kaskade ist dagegen immer mindestens zwei Ebenen tief: die
  --     RI-Aktion IST ein Trigger auf der Elterntabelle (Tiefe 1, oben
  --     belegt), und das von ihr abgesetzte `delete` auf der Kindtabelle
  --     bringt deren Trigger auf Tiefe 2. Verschachtelte Kaskaden liegen
  --     hoeher -- deshalb `> 1` und nicht `= 2`.
  -- Was der Zweig NICHT oeffnet: eine Kaskade kann kein Client ausloesen --
  -- `authenticated` hat auf `public.tenants` kein DELETE-Recht und es gibt
  -- dort keine DELETE-Policy (live gegen pg_policy gelesen). Und wer einen
  -- Mandanten loeschen darf, raeumt dessen Pruefpfad ohnehin mit weg; das ist
  -- der Zweck des Vorgangs und das Ende jedes Aufbewahrungszwecks.
  if tg_op = 'DELETE' then
    if current_user in ('postgres', 'supabase_admin')
       or pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'affiliate_audit_log_immutable';
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- KORREKTUR 3. RUNDE (11.09.2026): Der UPDATE-Zweig hatte den Ausweg des
  -- DELETE-Zweigs nicht und warf fuer jede andere Rolle. `actor_user_id`
  -- traegt aber `references public.profiles(id) on delete set null`, und
  -- `profiles` haengt per `profiles_id_fkey` mit `on delete cascade` an
  -- `auth.users`. Jede geloeschte Anmeldung kaskadiert also auf `profiles`
  -- und von dort per RI_FKey_setnull_del als UPDATE hierher -- genau in den
  -- ungehaerteten Zweig. Ohne diese Ausnahme endete "Testnutzer loeschen"
  -- nach dem Anwenden mit `affiliate_audit_log_immutable`, dieselbe Klasse
  -- Totalblockade wie der SET-NULL-Befund der ersten Runde. Von den fuenf
  -- Tabellen, die `profiles` heute per SET NULL referenzieren, traegt keine
  -- einen eigenen BEFORE-UPDATE-Trigger; diese waere die erste.
  -- Enger gefasst als der DELETE-Zweig: aus einem Trigger heraus ist
  -- ausschliesslich das Nullen DIESER EINEN Spalte erlaubt, jede andere
  -- Aenderung wirft weiter. Der Vergleich laeuft ueber `to_jsonb(...) - 'actor_user_id'`,
  -- damit kein Feld unbemerkt mitreist.
  if pg_trigger_depth() > 1
     and old.actor_user_id is not null
     and new.actor_user_id is null
     and to_jsonb(new) - 'actor_user_id' = to_jsonb(old) - 'actor_user_id' then
    return new;
  end if;

  raise exception 'affiliate_audit_log_immutable';
end;
$$;
create trigger affiliate_audit_log_guard_trg before update or delete on public.affiliate_audit_log
  for each row execute function public.affiliate_audit_log_guard();

alter table public.affiliate_audit_log enable row level security;
revoke all on public.affiliate_audit_log from anon, authenticated;
-- Nur SELECT: geschrieben wird ausschliesslich ueber den Admin-Client
-- (service_role umgeht RLS), es gibt bewusst keine INSERT-, UPDATE- oder
-- DELETE-Policy fuer Clients. Der tatsaechliche Schutz ist dieses fehlende
-- Recht, nicht die Policy-Liste.
grant select on public.affiliate_audit_log to authenticated;

-- =================================================================
-- 8. Hilfsfunktionen mit Tabellenbezug (Plan 3.1, Teil 2)
-- =================================================================
-- Erst hier, weil `language sql`-Rumpfe bei `check_function_bodies = on` schon
-- beim Anlegen gegen public.affiliate_partners aufgeloest werden (siehe
-- Reihenfolge-Absatz im Kopf).

-- Partner-Identitaet des eingeloggten Nutzers. Ein Partner hat in der Regel
-- KEINE memberships-Zeile (Plan G9) -- `member_role()` liefert fuer ihn null.
create or replace function public.affiliate_partner_id(t uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id from public.affiliate_partners p
  where p.tenant_id = t and p.user_id = auth.uid() and p.status = 'active'
  limit 1;
$$;

-- Tier-2-Sicht: die IDs der vom aufrufenden Partner geworbenen Partner.
-- BEWUSST eine Funktion statt eines "or referred_by = affiliate_partner_id(...)"-
-- Zweigs in der SELECT-Policy: RLS trennt keine Spalten, ein solcher Zweig gaebe
-- dem Werber per PostgREST die VOLLEN Zeilen seiner Geworbenen (application,
-- internal_note, terms_accepted_ip_hash). Die Partner-Ansicht laedt diese Daten
-- ueber eine Server-Route mit ausdruecklicher Spaltenliste.
create or replace function public.affiliate_downline_ids(t uuid)
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id from public.affiliate_partners p
  where p.tenant_id = t and p.referred_by = public.affiliate_partner_id(t);
$$;

-- KORREKTUR (ZWEITE RUNDE): zwei zusaetzliche Hilfsfunktionen. Beide geben
-- Auskunft ueber den AUFRUFER SELBST und beide BEWUSST OHNE Statusfilter --
-- darin liegt ihr ganzer Unterschied zu affiliate_partner_id() oben.
-- Anlass: die Selbstbedienungssperre G15 haengte an affiliate_partner_id(),
-- und die liefert fuer eine noch nicht freigegebene oder gesperrte eigene
-- Partnerzeile null. Wer also seine Bewerbung vorbereitet hatte, durfte sich
-- selbst Konditionen und eine Werberstellung eintragen; beides wirkte ab dem
-- Moment der Freigabe durch einen Kollegen. Die Frage "geht es um mein eigenes
-- Geld?" haengt an der Person, nicht am Status -- fuer die POLICIES bleibt
-- dagegen affiliate_partner_id() richtig, denn dort geht es um "darf ich als
-- taetiger Partner lesen?", und das setzt 'active' zu Recht voraus.
create or replace function public.affiliate_self_partner_id(t uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id from public.affiliate_partners p
  where p.tenant_id = t and p.user_id = auth.uid()
  limit 1;
$$;

-- Die Gruppe der eigenen Partnerzeile -- Grundlage sowohl fuer die
-- G15-Pruefung auf Gruppenkonditionen (Abschnitt 5) als auch fuer die
-- verengte SELECT-Policy auf affiliate_conditions (Abschnitt 9). Auch hier
-- ohne Statusfilter: in der Policy steht die Aktiv-Pruefung ohnehin schon
-- davor (`affiliate_partner_id(tenant_id) is not null`), im Guard soll sie
-- gerade nicht gelten.
create or replace function public.affiliate_self_group_id(t uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.group_id from public.affiliate_partners p
  where p.tenant_id = t and p.user_id = auth.uid()
  limit 1;
$$;

-- `anon` bekommt bewusst nichts: die oeffentliche Programmseite liest ueber
-- createAdminClient() mit ausdruecklicher Spaltenliste (Plan 3.2), nicht ueber
-- eine anon-Policy. Zum doppelten `revoke` siehe Abschnitt 1.
revoke execute on function public.affiliate_self_partner_id(uuid) from public;
revoke execute on function public.affiliate_self_partner_id(uuid) from anon;
grant  execute on function public.affiliate_self_partner_id(uuid) to authenticated, service_role;

revoke execute on function public.affiliate_self_group_id(uuid)   from public;
revoke execute on function public.affiliate_self_group_id(uuid)   from anon;
grant  execute on function public.affiliate_self_group_id(uuid)   to authenticated, service_role;

revoke execute on function public.affiliate_partner_id(uuid)   from public;
revoke execute on function public.affiliate_partner_id(uuid)   from anon;
grant  execute on function public.affiliate_partner_id(uuid)   to authenticated, service_role;

revoke execute on function public.affiliate_downline_ids(uuid) from public;
revoke execute on function public.affiliate_downline_ids(uuid) from anon;
grant  execute on function public.affiliate_downline_ids(uuid) to authenticated, service_role;

-- =================================================================
-- 9. Policies (je Tabelle genau eine SELECT-Policy, G17)
-- =================================================================
-- `(select auth.uid())` gekapselt (Advisor auth_rls_initplan,
-- 20260712233000:4-10) -- ohne die Klammerung wertet Postgres den Ausdruck je
-- Zeile aus. Die Security-Definer-Helfer bleiben ungekapselt, sie sind `stable`.

-- --- affiliate_programs -----------------------------------------
-- Der Partner liest die Programmzeile vollstaendig; das ist bewusst in Kauf
-- genommen, weil RLS keine Spalten trennt und die Konditionen des Programms
-- ohnehin Vertragsinhalt des Partners sind. Die OEFFENTLICHE Programmseite
-- liest hierueber NICHT, sondern per createAdminClient() mit ausdruecklicher
-- Spaltenliste (Muster src/lib/marketplace/catalog.ts); terms_text und
-- books_closed_until gehoeren nicht in diese Liste.
create policy affiliate_programs_select on public.affiliate_programs for select using (
  public.affiliate_is_manager(tenant_id)
  or public.affiliate_partner_id(tenant_id) is not null
);
-- KORREKTUR (B12): `books_closed_until is null` ergaenzt. Der Riegel aus G14
-- entsteht ausschliesslich beim Erzeugen einer Gutschrift (service_role,
-- umgeht RLS) -- ein Programm wird nie mit bereits abgeschlossenen Buechern
-- angelegt. Den tatsaechlichen Schutz leistet der Guard in Abschnitt 2
-- (BEFORE-ROW-Trigger laufen vor der `with check`-Auswertung, die Spalte ist
-- also schon null, wenn die Policy drankommt); die Policy ist die auditierbare
-- Absichtserklaerung und traegt den Schutz weiter, falls der Guard je
-- entfaellt. Dieselbe Begruendung wie bei
-- affiliate_partners_manager_insert unten.
create policy affiliate_programs_manager_insert on public.affiliate_programs for insert
  with check (
    public.affiliate_is_manager(tenant_id)
    and books_closed_until is null
  );
create policy affiliate_programs_manager_update on public.affiliate_programs for update
  using (public.affiliate_is_manager(tenant_id))
  with check (public.affiliate_is_manager(tenant_id));

-- --- affiliate_groups -------------------------------------------
-- Der Partner darf den Namen seiner Gruppe sehen (er steht in seiner
-- Konditionsuebersicht), schreiben darf nur der Manager.
create policy affiliate_groups_select on public.affiliate_groups for select using (
  public.affiliate_is_manager(tenant_id)
  or public.affiliate_partner_id(tenant_id) is not null
);
create policy affiliate_groups_manager_insert on public.affiliate_groups for insert
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_groups_manager_update on public.affiliate_groups for update
  using (public.affiliate_is_manager(tenant_id))
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_groups_manager_delete on public.affiliate_groups for delete
  using (public.affiliate_is_manager(tenant_id));

-- --- affiliate_partners -----------------------------------------
-- Der Werber-Zweig steht bewusst NICHT in dieser Policy, siehe
-- affiliate_downline_ids() in Abschnitt 8.
create policy affiliate_partners_select on public.affiliate_partners for select using (
  public.affiliate_is_manager(tenant_id) or user_id = (select auth.uid())
);
-- KORREKTUR (B4, HOCH): Die Policy prueft nicht mehr nur die
-- Mandantenzugehoerigkeit. Was war falsch und welches Szenario: siehe den
-- INSERT-Zweig von affiliate_partners_guard() in Abschnitt 4 -- ein owner/admin
-- legte sich in EINEM Schritt selbst als aktiven Partner an und umging damit
-- die gesamte Selbstfreigabesperre G15.
-- Warum beides: den ersten Schutz leistet der GUARD. Postgres fuehrt
-- BEFORE-ROW-Trigger vor der `with check`-Auswertung aus -- der Guard sieht
-- die Zeile also zuerst.
-- NACHTRAG ZWEITE RUNDE: solange er die Spalten dabei still UMSCHRIEB, konnte
-- diese Policy nie fehlschlagen, und ein Manager, der bewusst
-- {"status":"active"} schickte, bekam statt einer Fehlermeldung still eine
-- pending-Zeile. Der Guard BRICHT DESHALB JETZT AB (Abschnitt 4,
-- 'affiliate_partner_insert_must_be_pending'). Damit sagen Guard und Policy
-- nicht mehr nur dasselbe, sie tun auch dasselbe: was die Policy verbietet,
-- meldet der Guard als Fehler, und zwar mit dem genaueren Text.
-- Die Policy bleibt trotzdem stehen -- sie ist die auditierbare
-- Absichtserklaerung (derselbe Gedanke wie bei den Deny-Policies, Vorspann)
-- und traegt den Schutz weiter, falls der Guard je entfaellt oder auf
-- `before update` zurueckfaellt, also genau der Fehler, den B4 behoben hat.
-- Umgekehrt kann die Policy den Guard nicht ersetzen: eine `with
-- check`-Bedingung sieht nur die neue Zeile und kennt kein Spaltendelta --
-- und sie kann die Zustimmungsfelder nicht mitpruefen, ohne den Server-Pfad
-- (service_role, umgeht RLS ohnehin) mitzureissen.
-- Beide sagen dasselbe: eine neue Partnerzeile ist eine unbewertete Bewerbung,
-- nichts weiter.
create policy affiliate_partners_manager_insert on public.affiliate_partners for insert
  with check (
    public.affiliate_is_manager(tenant_id)
    and status = 'pending'
    and user_id is null
    and payout_hold = false
  );
create policy affiliate_partners_update on public.affiliate_partners for update
  using (public.affiliate_is_manager(tenant_id) or user_id = (select auth.uid()))
  with check (public.affiliate_is_manager(tenant_id) or user_id = (select auth.uid()));
-- DELETE nur aus unkritischen Status, Vorbild ml_staff_delete
-- (20260804090000:27-31): ein Partner mit Buchungshistorie darf nie geloescht
-- werden, sonst reisst der Pruefpfad. Fuer die DSGVO gibt es Anonymisierung
-- (Plan 7.8), nicht Loeschung.
--
-- KORREKTUR (ZWEITE RUNDE): Hier stand als einzige Bedingung neben der
-- Managerrolle `status in ('pending','rejected')`.
-- Was war falsch: das ist ein Zustand, den derselbe Manager eine Anweisung
-- vorher selbst setzen darf -- `status` steht in seinem UPDATE-Spaltenrecht,
-- und die G15-Sperre greift nur an SEINER eigenen Zeile. Der erklaerte
-- Schutzzweck war damit nicht durchgesetzt.
-- Szenario: ein Mandanten-Admin will einen unbequemen Partner loswerden,
-- bevor B4 die Provisionstabelle mit ihrem Fremdschluessel bringt. Zwei
-- Requests: PATCH ?id=eq.X {"status":"rejected"}, danach DELETE ?id=eq.X. Weg
-- sind Stammdatenzeile, Abrechnungsprofil (Anschrift, Steuerstatus, IBAN) und
-- alle Sonderkonditionen -- beides ueber `on delete cascade`. Uebrig bleibt
-- ein Pruefpfad mit einer entity_id, die auf nichts mehr zeigt.
-- Warum jetzt richtig: das DELETE haengt zusaetzlich an zwei Merkmalen, die
-- der Manager NICHT setzen kann. `user_id` schreibt ausschliesslich der Server
-- (Guard, Abschnitt 4) -- wer je ein Konto verknuepft hatte, war Partner.
-- `terms_accepted_at` schreibt seit B9 ebenfalls nur der Server -- wer je die
-- Bedingungen akzeptiert hat, hat einen Nachweis, der zur Akte gehoert.
-- Was das kostet, ausdruecklich und bewusst: sobald B3 die Zustimmung schon
-- bei der BEWERBUNG erfasst (und das soll es, Art. 7 Abs. 1 DSGVO), ist auch
-- eine abgelehnte Bewerbung nicht mehr loeschbar. Das ist die richtige
-- Richtung fuer den Irrtumsfall -- die Zeile bleibt als 'rejected' stehen und
-- wird im Loeschfall anonymisiert (Plan 7.8), statt dass ein Klick Beleg und
-- Pruefpfad auseinanderreisst. Loeschbar bleibt genau das, was auch loeschbar
-- sein soll: die vom Manager selbst angelegte Zeile, die nie jemand benutzt
-- hat. Die zweite Ebene dazu ist affiliate_partners_delete_guard() in
-- Abschnitt 4; sie sieht zusaetzlich den Bestand in anderen Tabellen, den eine
-- Policy nicht sehen kann.
create policy affiliate_partners_manager_delete on public.affiliate_partners for delete
  using (
    public.affiliate_is_manager(tenant_id)
    and status in ('pending','rejected')
    and user_id is null
    and terms_accepted_at is null
  );

-- --- affiliate_conditions ---------------------------------------
-- Der Partner darf sehen, welcher Satz FUER IHN gilt -- seine eigene Zeile,
-- die Zeilen seiner eigenen Gruppe und die Zeilen ohne Partner- und
-- Gruppenbezug. Fremde Sonderkonditionen sieht er nicht.
--
-- KORREKTUR (B1, KRITISCH): Hier stand
--     public.affiliate_is_manager(tenant_id)
--     or partner_id is null
--     or partner_id = public.affiliate_partner_id(tenant_id)
-- Was war falsch: der mittlere Zweig `or partner_id is null` war VOELLIG
-- ungebunden -- ohne Mandantenbezug und ohne die Pruefung, ob der Aufrufer
-- ueberhaupt Partner dieses Mandanten ist. Genau die Bauart, vor der der
-- Vorspann dieser Datei warnt (G17): eine einschraenkend GEMEINTE Bedingung
-- wird ver-ODERt und hebt die beiden anderen Zweige auf. Zusammen mit dem
-- Tabellenrecht `grant select ... to authenticated` in Abschnitt 5 las damit
-- JEDER eingeloggte Nutzer der ganzen Plattform alle Konditionszeilen ALLER
-- Mandanten, bei denen partner_id leer ist.
-- Szenario: jemand registriert sich auf irgendeinem Mandanten (Registrierung
-- ist oeffentlich) und ruft mit seinem gueltigen authenticated-JWT auf:
-- GET /rest/v1/affiliate_conditions?select=tenant_id,rate_kind,rate_bp,
-- fixed_cents,valid_from,valid_to,note . Zweig 1 ist false, Zweig 3 ist NULL
-- -- Zweig 2 ist fuer jede Gruppen- und jede Produktkondition true,
-- mandantenuebergreifend. Ergebnis: die vollstaendige Provisionsstruktur samt
-- Freitext-Notizen jedes Mandanten der Plattform.
-- Warum jetzt richtig: die beiden Partner-Zweige stehen geklammert hinter der
-- EINEN Voraussetzung, die vorher fehlte -- `affiliate_partner_id(tenant_id)
-- is not null`, also "der Aufrufer ist aktiver Partner GENAU DIESES
-- Mandanten". Fuer jeden anderen bleibt nur der Manager-Zweig, der seinerseits
-- mandantengebunden ist.
-- Zum mehrfachen Aufruf von affiliate_partner_id(): das Argument ist die
-- Spalte `tenant_id`, der Ausdruck laesst sich also nicht in einen InitPlan
-- heben und wird je Zeile ausgewertet -- so war es vorher auch schon. Die
-- Funktion ist `stable` und liest eine Zeile ueber
-- affiliate_partners_user_uniq; bei den Groessenordnungen dieser Tabelle
-- (eine Konditionszeile je Sonderfall, nicht je Bestellung) ist das der
-- richtige Tausch gegen eine Formulierung, die lesbar bleibt. Wird die Tabelle
-- je gross, gehoert der Aufruf in eine eigene `stable`-Hilfsfunktion mit
-- mandantenfreiem Ergebnis, nicht in eine weitere ODER-Verzweigung.
--
-- KORREKTUR (ZWEITE RUNDE, beide Gegenleser): Der Partner-Zweig war nach B1
-- zwar an den Mandanten gebunden, INNERHALB des Mandanten aber immer noch viel
-- zu weit -- `partner_id is null` trifft JEDE Gruppen- und JEDE Produkt-
-- kondition, also auch die fremder Gruppen. Das widersprach dem Kommentar drei
-- Zeilen darueber ("Fremde Sonderkonditionen sieht er nicht") direkt.
-- Szenario: Partner A steht in Gruppe 'Bronze' (10 %). Er ruft
-- GET /rest/v1/affiliate_conditions?select=group_id,rate_bp,valid_from auf und
-- bekommt die Gold-Gruppe mit 40 % mitgeliefert. Folge: Neidkonflikt und
-- offengelegte Verhandlungsposition des Mandanten -- vor der ersten
-- Gehaltsverhandlung, nicht danach.
-- Warum jetzt richtig: eine Gruppenkondition gilt fuer ihn nur, wenn es SEINE
-- Gruppe ist; steht er in keiner Gruppe, sieht er gar keine gruppenbezogene
-- Zeile (`group_id = null` ergibt NULL und damit false -- fail-closed).
-- Reine Produktkonditionen (partner_id und group_id null) gelten fuer alle
-- Partner und bleiben deshalb sichtbar; das ist kein Leck, sondern sein
-- eigener Satz. Der Freitext `note` ist ihm dabei zusaetzlich ueber das
-- Spaltenrecht in Abschnitt 5 entzogen -- RLS trennt keine Spalten, und die
-- Notiz ist ein Vermerk UEBER ihn, nicht FUER ihn.
create policy affiliate_conditions_select on public.affiliate_conditions for select using (
  public.affiliate_is_manager(tenant_id)
  or (
    public.affiliate_partner_id(tenant_id) is not null
    and (partner_id is null or partner_id = public.affiliate_partner_id(tenant_id))
    and (group_id   is null or group_id   = public.affiliate_self_group_id(tenant_id))
  )
);
create policy affiliate_conditions_manager_insert on public.affiliate_conditions for insert
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_conditions_manager_update on public.affiliate_conditions for update
  using (public.affiliate_is_manager(tenant_id))
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_conditions_manager_delete on public.affiliate_conditions for delete
  using (public.affiliate_is_manager(tenant_id));

-- --- affiliate_billing_profiles ---------------------------------
-- Enger als bei den Stammdaten: der Manager (owner/admin) darf LESEN -- er
-- braucht Anschrift und Steuerstatus fuer den Beleg --, aendern darf
-- ausschliesslich der Partner selbst. Bankdaten durch den Haendler aendern zu
-- lassen waere der klassische Weg, Auszahlungen umzuleiten, sobald ein
-- Haendler-Konto uebernommen wurde.
-- Nach der Korrektur zu B7 gilt das jetzt auch fuers LESEN: die Policy laesst
-- den Manager zwar auf die Zeile, aber das Spaltenrecht in Abschnitt 6 nimmt
-- iban, bic, account_holder, paypal_email, tax_number und vat_check_log aus.
-- RLS trennt keine Spalten -- diese Policy allein waere also der komplette
-- Bankdatenbestand des Mandanten gewesen.
create policy affiliate_billing_select on public.affiliate_billing_profiles for select using (
  public.affiliate_is_manager(tenant_id)
  or partner_id = public.affiliate_partner_id(tenant_id)
);
create policy affiliate_billing_self_insert on public.affiliate_billing_profiles for insert
  with check (partner_id = public.affiliate_partner_id(tenant_id));
create policy affiliate_billing_self_update on public.affiliate_billing_profiles for update
  using (partner_id = public.affiliate_partner_id(tenant_id))
  with check (partner_id = public.affiliate_partner_id(tenant_id));

-- --- affiliate_audit_log ----------------------------------------
-- Der Partner sieht die Eintraege zu seiner eigenen Partnerzeile -- Transparenz
-- ueber Statuswechsel und Sperren, die ihn betreffen.
--
-- KORREKTUR (B8): Hier stand `or entity_id = public.affiliate_partner_id(...)`
-- ohne jede Einschraenkung auf `entity`.
-- Was war falsch: `grant select on public.affiliate_audit_log to authenticated`
-- ist ein Tabellenrecht ueber alle Spalten, `before`/`after` eingeschlossen.
-- Ohne `entity`-Bedingung traf der Zweig jede Zeile, deren entity_id zufaellig
-- die Partner-ID ist -- auch aus anderen Entitaeten, die mit derselben ID
-- schluesseln (affiliate_billing_profiles hat partner_id als Primaerschluessel,
-- ein 'profile'-Eintrag traegt also dieselbe UUID).
-- Warum jetzt richtig: der Partner bekommt genau die Vorgaenge zu SEINER
-- Stammdatenzeile. Die Zeilenhoheit der uebrigen Entitaeten bleibt beim
-- Manager.
-- BEWUSST KEINE zusaetzliche `action in (...)`-Erlaubnisliste, obwohl der
-- Gegenleser eine vorgeschlagen hat: `affiliate_audit_log.action` hat
-- ausdruecklich KEIN CHECK, die Vorgangsliste waechst mit jedem Block, und die
-- Konvention der Schreiber ist `<entity>.<verb>`
-- (src/lib/affiliate/types.ts:565-568, z. B. 'partner.approve'). Die
-- vorgeschlagenen Werte ('status_changed', 'payout_hold_set', ...) treffen
-- diese Konvention nicht und haetten den Partner vollstaendig ausgesperrt --
-- eine Liste in SQL, die bei jedem neuen Vorgang mitgepflegt werden muesste,
-- waere ausserdem genau die Doppelfuehrung, die B13 hier gerade beseitigt.
-- ERLEDIGT IN DER ZWEITEN RUNDE (war hier als offener Punkt vermerkt):
-- `payout_hold_reason` stand weder in AFFILIATE_AUDIT_REDACTED_KEYS noch traf
-- eine der Endungen -- der Freitext einer Auszahlungssperre erreichte den
-- Partner also ueber `before`/`after` im Klartext, waehrend `internal_note`
-- und `status_reason` derselben Zeile korrekt als "***" erschienen. Der
-- Gegenleser hat zusaetzlich den Widerspruch dazu gefunden: dieselbe Spalte
-- stand im SELECT-Spaltenrecht des Partners (Abschnitt 4), er las sie also
-- ohnehin an der Quelle, und die Redaktion waere Theater gewesen.
-- Beide Stellen sind jetzt gleichgezogen: die Spalte ist aus dem Spaltenrecht
-- ENTFERNT (Abschnitt 4, mit Begruendung und der Voraussetzung fuer
-- types.ts) und zugleich in AFFILIATE_AUDIT_REDACTED_KEYS aufgenommen
-- (src/lib/affiliate/audit.ts, Gruppe (b) -- "Spalten, die die Spaltenrechte
-- dem Partner vorenthalten"). Der Partner sieht weiterhin DASS gesperrt ist.
create policy affiliate_audit_log_select on public.affiliate_audit_log for select using (
  public.affiliate_is_manager(tenant_id)
  or (
    entity = 'partner'
    and entity_id = public.affiliate_partner_id(tenant_id)
  )
);

-- =================================================================
-- 10. Ausfuehrungsrechte der Guard-Funktionen
-- =================================================================
-- Beim Feuern eines Triggers prueft Postgres kein EXECUTE-Recht (das geschieht
-- beim `create trigger`); der `grant` an authenticated ist also die sichere
-- Seite. Entscheidend ist, dass `anon` ausdruecklich entfernt wird -- `revoke
-- from public` allein liesse den eigenen anon-Grant stehen (Fund vom
-- 07.09.2026). Nach jedem kuenftigen `create or replace` erneut setzen.
revoke execute on function public.affiliate_programs_guard()  from public;
revoke execute on function public.affiliate_programs_guard()  from anon;
grant  execute on function public.affiliate_programs_guard()  to authenticated, service_role;

revoke execute on function public.affiliate_groups_guard()    from public;
revoke execute on function public.affiliate_groups_guard()    from anon;
grant  execute on function public.affiliate_groups_guard()    to authenticated, service_role;

revoke execute on function public.affiliate_partners_guard()  from public;
revoke execute on function public.affiliate_partners_guard()  from anon;
grant  execute on function public.affiliate_partners_guard()  to authenticated, service_role;

-- KORREKTUR (ZWEITE RUNDE): neu hinzugekommen mit dem DELETE-Guard aus
-- Abschnitt 4.
revoke execute on function public.affiliate_partners_delete_guard() from public;
revoke execute on function public.affiliate_partners_delete_guard() from anon;
grant  execute on function public.affiliate_partners_delete_guard() to authenticated, service_role;

revoke execute on function public.affiliate_conditions_guard() from public;
revoke execute on function public.affiliate_conditions_guard() from anon;
grant  execute on function public.affiliate_conditions_guard() to authenticated, service_role;

revoke execute on function public.affiliate_billing_guard()   from public;
revoke execute on function public.affiliate_billing_guard()   from anon;
grant  execute on function public.affiliate_billing_guard()   to authenticated, service_role;

revoke execute on function public.affiliate_audit_log_guard() from public;
revoke execute on function public.affiliate_audit_log_guard() from anon;
grant  execute on function public.affiliate_audit_log_guard() to authenticated, service_role;
