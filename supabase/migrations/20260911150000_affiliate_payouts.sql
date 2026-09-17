-- Affiliate-Modul, Block B8 "Auszahlung, Beleg, Steuer"
-- (PLAN_Affiliate-System.md Abschnitt 10/B8, 11.09.2026). Diese Datei setzt
-- Abschnitt 3.12 (affiliate_payouts und affiliate_document_counters) um, dazu
-- die beiden Datenbankfunktionen des Blocks -- next_affiliate_document_no()
-- (Plan 7.3) und approve_affiliate_payout() (Plan 7.2) -- und den privaten
-- Storage-Bucket `affiliate-documents` fuer die Gutschrift-PDF.
--
-- Sie setzt VORAUS:
--   20260910120000_affiliate_core.sql      affiliate_programs (mit
--                                          books_closed_until),
--                                          affiliate_partners (status,
--                                          payout_hold), affiliate_is_manager(),
--                                          affiliate_partner_id(),
--                                          affiliate_self_partner_id(),
--                                          affiliate_billing_profiles;
--   20260911130000_affiliate_commissions.sql  affiliate_commissions -- diese
--                                          Datei haengt den in 3.11 bewusst
--                                          offen gelassenen Fremdschluessel
--                                          `payout_id` nach (Abschnitt 3).
-- 20260910120100 (Einwilligung), 20260910120200 (Betreiber-Schalter),
-- 20260911120000 (Klick/Attribution) und 20260911140000 (Storno) sind fachlich
-- vorausgesetzt, strukturell hier nicht.
--
-- ANLASS
-- Mit dieser Datei verlaesst Geld den Mandanten, und es entsteht ein BELEG:
-- eine Gutschrift nach § 14 Abs. 2 UStG mit zehnjaehriger Aufbewahrungsfrist
-- (§ 147 AO, § 257 HGB). Daraus folgen drei Eigenschaften, die keine
-- Bequemlichkeit sind, sondern Anforderungen der Buchfuehrung:
--   (a) Die Belegnummer ist LUECKENLOS je Mandant und Jahr. Nicht "moeglichst
--       lueckenlos" -- eine Luecke muss erklaerbar sein, und "der Server hatte
--       einen Fehler" ist keine Erklaerung, die eine Betriebspruefung
--       akzeptiert.
--   (b) Die Zahlen des Belegs sind ab der Vergabe der Nummer eingefroren. Ein
--       nachtraegliches Neuerzeugen aus geaenderten Daten ist unzulaessig
--       (GoBD); das PDF ist nur die Darstellung, die eingefrorenen Zahlen SIND
--       der Beleg.
--   (c) Ein einmal erzeugter Beleg wird nie geloescht. Eine falsche Gutschrift
--       wird durch eine Stornogutschrift mit EIGENER Nummer neutralisiert
--       (Plan 7.7).
-- Dazu kommt G8: `payout_id` wird beim ENTWURF gestempelt, `status='paid'`
-- erst nach der Ueberweisung. Zwischen Entwurf und Bankabgleich als
-- "ausgezahlt" zu fuehren waere eine Falschdarstellung -- eine Erstattung in
-- diesem Fenster wuerde gegen angeblich schon geflossenes Geld buchen.
--
-- =================================================================
-- DIE LUECKENLOSIGKEIT, ZU ENDE GEDACHT
-- =================================================================
-- Die Nummer wird VOR dem Erzeugen des PDF gezogen, innerhalb der
-- Freigabe-Transaktion. Vier Faelle, und jeder hat eine Antwort:
--
--  (1) ABBRUCH VOR DEM COMMIT (Kontrollabgleich schlaegt fehl, Partner
--      gesperrt, Verbindungsabbruch, Deadlock). Der Zaehlerstand ist Teil
--      DERSELBEN Transaktion und wird mit zurueckgerollt. Die Nummer ist
--      nicht verbraucht, die naechste Freigabe zieht exakt dieselbe. KEINE
--      LUECKE. Genau deshalb steht hier kein Postgres-SEQUENCE-Objekt:
--      `nextval` ist absichtlich NICHT transaktional und haette bei jedem
--      Abbruch eine Luecke hinterlassen -- dazu je Mandant und Jahr ein
--      eigenes Sequenzobjekt, das niemand pflegt.
--
--  (2) ZWEI GLEICHZEITIGE FREIGABEN. Das `insert ... on conflict ... do
--      update ... returning` nimmt eine Zeilensperre auf (tenant_id, year).
--      Der zweite Aufruf wartet, liest nach dem Commit des ersten neu und
--      zaehlt von dessen Stand weiter: 173 und 174, nie zweimal 173 und nie
--      173 und 175. Rollt der erste zurueck, faellt der Zaehler auf seinen
--      Ausgangswert und der zweite bekommt 173. Dasselbe Race-Muster wie
--      `increment_usage` (20260711164826:47-59).
--      PREIS, ausgesprochen: die Zaehlerzeile serialisiert alle Freigaben
--      eines Mandanten und Jahres bis zum COMMIT. Deshalb wird sie in
--      approve_affiliate_payout() erst NACH allen Pruefungen angefasst -- das
--      Sperrfenster ist so kurz wie moeglich. Die Sperrreihenfolge ist in
--      jeder Freigabe dieselbe (Auszahlungssatz -> Provisionszeilen ->
--      Zaehler), ein Deadlock zwischen zwei Freigaben ist damit
--      ausgeschlossen.
--
--  (3) ABBRUCH NACH DEM COMMIT, BEIM PDF. Die Nummer ist vergeben, der Beleg
--      ist GUELTIG -- die eingefrorenen Zahlen auf der Zeile sind der Beleg.
--      `document_path` bleibt null, der Teilindex
--      affiliate_payouts_missing_document_idx findet den Satz, und ein
--      Reparaturlauf erzeugt das PDF deterministisch nach (gleiche Zahlen,
--      gleicher Pfad, gleiche Nummer). Deshalb -- und nur deshalb -- bleibt
--      `document_path` als EINZIGE Belegspalte schreibbar. KEINE LUECKE.
--
--  (4) DIE UMGEKEHRTE REIHENFOLGE (erst PDF, dann Nummer) haette genau
--      dieses Problem: jeder fehlgeschlagene Storage-Schreibvorgang liesse
--      eine Luecke, und Storage ist der unzuverlaessigste Teil des Ablaufs.
--      Sie ist hier ausgeschlossen, weil die Nummer in der RPC und damit vor
--      jedem Netzwerkaufruf faellt.
--
-- Was ausdruecklich NICHT passiert, wenn sich ein Beleg als falsch erweist:
-- er wird weder geloescht noch umnummeriert. Er bekommt eine Stornogutschrift
-- mit eigener Nummer (Plan 7.7). Der Loesch-Guard in Abschnitt 2.6 macht das
-- zu einer Eigenschaft der Tabelle statt zu einer Bitte an den Anwendungscode.
--
-- BEFUND (lesend gegen die Live-Datenbank vklqksdiyiijzoirntyt, 11.09.2026)
--   1. KEINE Affiliate-Tabelle existiert
--      (`information_schema.tables` kennt aus dieser Familie nichts). B1-B7
--      sind geschrieben, aber NICHT angewendet. Diese Datei ist die siebte
--      unangewendete Migration der Reihe und muss nach allen sechs laufen.
--   2. PostgreSQL 17.6. `on delete set null (spalte)` (PG 15+) und
--      `merge`/`on conflict` mit `returning` stehen zur Verfuegung.
--   3. `public.tenants` traegt `slug text not null unique check (slug ~
--      '^[a-z0-9][a-z0-9-]{1,40}$')`. Der Belegnummern-Praefix ist damit
--      `upper(slug)` und passt in `[A-Z0-9][A-Z0-9-]{1,40}` -- die
--      CHECK-Bedingung auf `document_no` ist deshalb erfuellbar und nicht
--      geraten. `tenants.legal` ist `jsonb not null default '{}'`; der
--      Rechtstraeger steht unter dem Schluessel `entity`
--      (src/lib/legal/company.ts:69-73).
--   4. Es gibt fuenf Storage-Buckets (branding, course-assets, submissions,
--      certificates, avatars), KEINEN `affiliate-documents`. Alle fuenf
--      tragen seit 20260801150100 `file_size_limit` und
--      `allowed_mime_types`; dieser Bucket bekommt beides im selben
--      Statement, in dem er entsteht (CLAUDE.md §2.5).
--   5. Neue Tabellen bekommen per `alter default privileges` ALLE Rechte fuer
--      anon, authenticated UND service_role, neue Funktionen EXECUTE fuer
--      dieselben Rollen. `revoke` ist deshalb die erste Schutzschicht, nicht
--      Zierrat; und `revoke ... from public` entfernt den eigenen anon-Grant
--      NICHT (20260907093000).
--   6. `service_role` traegt `rolbypassrls = true`, `authenticated` und
--      `anon` nicht. Beide RPCs dieser Datei laufen deshalb OHNE `security
--      definer` -- siehe Abweichung A3.
--
-- LOESUNG
-- Zwei Tabellen, vier Guard-Trigger (je Tabelle einer fuer INSERT/UPDATE und
-- einer fuer DELETE), ein Touch-Trigger, ein nachgetragener Fremdschluessel,
-- zwei RPCs und ein privater Storage-Bucket -- Tabelle, RLS und Policies
-- jeweils im selben Schritt (CLAUDE.md §2.1). Alle Betraege `int` in Cent,
-- alle Saetze in Basispunkten, kein `numeric`, kein Float (G12).
--
-- IBAN, BIC, Kontoinhaber, Steuernummer und PayPal-Adresse werden NICHT in
-- affiliate_payouts kopiert. Sie stehen in affiliate_billing_profiles, wo sie
-- bereits durch Spaltenrechte, eine eigene Policy und einen eigenen Guard
-- geschuetzt sind (20260910120000, Abschnitt 6). Eine zweite Kopie waere eine
-- zweite Stelle, die jede kuenftige Aenderung dieser Schutzschichten
-- mitnehmen muesste -- und die erste, die dabei vergessen wird. Der
-- Zahlungsweg-Export (SEPA/CSV, Plan 7.7) liest die Kontoverbindung
-- serverseitig aus dem Profil, mit ausdruecklicher Spaltenliste, und schreibt
-- sie in die Exportdatei, nicht in die Datenbank. Was hier steht, ist
-- ausschliesslich `method` -- der ZAHLWEG, nicht die Zahlungsverbindung.
--
-- =================================================================
-- ABWEICHUNGEN VOM PLAN (jede mit Grund, keine still)
-- =================================================================
-- A1  `on delete restrict` WIRD ZU `on delete no action deferrable initially
--     deferred` -- fuer program_id und partner_id an affiliate_payouts. Der
--     Plan (3.12) schreibt `restrict`, und er begruendet es richtig ("ein
--     Beleg darf nicht verschwinden, weil jemand einen Partner loescht").
--     Die SPERRE bleibt auch hier bestehen, nur der Pruefzeitpunkt wandert.
--     Grund, wortgleich zu Abweichung A1 in 20260911130000: RESTRICT ist in
--     Postgres fest NICHT aufschiebbar und feuert am Ende der ANWEISUNG. Beim
--     Loeschen eines Mandanten haengen mehrere Kaskaden am selben Ereignis
--     (tenants -> affiliate_partners, tenants -> affiliate_programs,
--     tenants -> affiliate_payouts); ihre Reihenfolge ist die alphabetische
--     Folge intern vergebener RI-Triggernamen und damit praktisch zufaellig.
--     Feuert die Partner-Kaskade zuerst, prueft RESTRICT, waehrend die
--     Auszahlungssaetze noch stehen, und die gesamte Mandantenloeschung
--     bricht mit 23503 ab. `no action deferrable initially deferred` prueft
--     inhaltlich dasselbe, nur beim COMMIT: ein direktes
--     `delete from affiliate_partners` scheitert weiterhin, eine
--     vollstaendige Kaskade ist beim COMMIT in sich stimmig und geht durch.
--     FOLGE, die B9 kennen muss: affiliate_partners_delete_guard()
--     (20260910120000) prueft heute auf affiliate_commissions, NICHT auf
--     affiliate_payouts. Ein Partner mit Auszahlungssaetzen scheitert
--     deshalb erst am COMMIT mit 23503 statt mit der sprechenden Kennung
--     'affiliate_partner_has_commissions'. Das ist kein Loch (geloescht wird
--     er in keinem Fall), aber eine unscharfe Fehlermeldung; die Erweiterung
--     des Guards gehoert in das DSGVO-Paket, das ohnehin auf Anonymisierung
--     statt Loeschung umstellt (Plan 7.8). Sie steht bewusst NICHT hier --
--     diese Datei fasst keinen Guard eines anderen Blocks an.
-- A2  DER FREMDSCHLUESSEL `affiliate_commissions.payout_id` IST
--     `no action deferrable initially deferred`, NICHT `on delete set null`.
--     Der Plan (3.12) schreibt `on delete set null`. Das waere hier ein
--     stiller Totalausfall: eine SET-NULL-Kaskade schlaegt auf
--     affiliate_commissions als UPDATE auf, und affiliate_commissions_guard()
--     (20260911130000, G8) wirft fuer jede Aenderung an `payout_id` an einer
--     Zeile, die nicht vor UND nach dem Update 'approved' ist --
--     'affiliate_commission_payout_stamp_forbidden'. Genau die BEZAHLTEN
--     Zeilen sind aber die, die dauerhaft auf einen Auszahlungssatz zeigen.
--     Die Loeschung eines Mandanten haette damit je nach Kaskadenreihenfolge
--     abgebrochen -- dieselbe Fehlerklasse, die in dieser Modulreihe schon
--     viermal gefunden wurde, nur diesmal als Fremdschluessel gegen einen
--     Guard.
--     Warum die Alternative nicht gebraucht wird: ein Auszahlungssatz wird
--     nie geloescht (Abschnitt 2.6). Bleibt allein die Mandantenkaskade, und
--     die ist beim COMMIT in sich stimmig, weil affiliate_commissions
--     ebenfalls an `tenants` haengt. Der reale Ablauf "Ueberweisung
--     fehlgeschlagen, Zeilen wieder freigeben" (Plan 7.7) ist KEINE
--     Loeschung, sondern ein UPDATE auf `payout_id = null` bei
--     `status = 'approved'` -- das laesst der Guard ausdruecklich zu.
-- A3  BEIDE RPCs OHNE `security definer`. Der Plan (7.2, 7.3) schreibt es
--     fuer beide vor. `service_role` traegt bereits `rolbypassrls` und ist
--     der einzige Aufrufer (Befund 6); `security definer` waere eine
--     Rechteverstaerkung ohne jeden Gewinn und zusaetzlich ein Dauertreffer
--     in den Advisor-Klassen `anon_security_definer_function_executable` /
--     `authenticated_security_definer_function_executable`. Gleiche
--     Entscheidung und gleiche Begruendung wie bei
--     book_affiliate_commissions() und book_affiliate_reversals().
-- A4  `approve_affiliate_payout` HAT ZWEI WEITERE PARAMETER:
--     `p_tenant_id uuid default null` und `p_actor_user_id uuid default null`.
--     Der Plan (7.2) zeigt die Funktion mit einem Argument.
--     `p_actor_user_id` traegt G15 ("ein Manager kann eine Auszahlung an sich
--     selbst nicht freigeben"). Ohne ihn ist die Regel in der Datenbank
--     ueberhaupt nicht durchsetzbar: die RPC laeuft unter `service_role`,
--     dort ist `auth.uid()` null und `affiliate_self_partner_id()` liefert
--     null -- der Guard-Zweig, der G15 fuer eine interaktive Aenderung
--     traegt, greift also genau auf dem Weg nicht, auf dem die Freigabe
--     tatsaechlich passiert.
--     `p_tenant_id` traegt CLAUDE.md §2.15: die Auszahlungskennung kommt aus
--     der Oberflaeche. Ohne Mandantenpruefung waere das
--     `where id = :clientId` ohne Besitz-Check, das §2.15 ausdruecklich
--     verbietet -- ein Manager des Mandanten A koennte eine Auszahlung des
--     Mandanten B freigeben und dessen Nummernkreis eine Nummer entnehmen.
--     Beide haben `default null`, damit ein Aufruf nach Plan-Signatur nicht
--     stumm durchlaeuft, sondern mit 'affiliate_payout_tenant_required' bzw.
--     'affiliate_payout_actor_required' abbricht. Die
--     PARAMETERREIHENFOLGE ist fuer den Aufrufer ohne Belang: supabase-js
--     ruft RPCs mit BENANNTEN Argumenten auf.
-- A5  ZUSAETZLICHE CHECK-BEDINGUNGEN, die der Plan nicht auffuehrt:
--     `subtotal_cents > 0` (eine Auszahlung ueber 0 oder weniger ist keine;
--     ein negativer Saldo wird laut 7.1 vorgetragen, nicht ausgezahlt, und
--     eine 0-Auszahlung verbrennte eine Belegnummer fuer nichts),
--     `tax_cents` als AUSGERECHNETE Bedingung (siehe Abschnitt 2.1 -- die
--     Steuerformel aus 7.4 steht damit in der Datenbank und nicht nur in
--     src/lib/affiliate/tax.ts), `(tax_rate_bp > 0) = (tax_mode =
--     'regular')` (die Steuertabelle aus 7.4 kennt genau einen Modus mit
--     Satz), `document_path` als exakter Pfad aus tenant_id und id
--     (Pfadkonvention `{tenant_id}/...` strukturell statt als Zusage),
--     `method is not null` ab 'approved', und die Kopplung von
--     `document_no`/`document_issued_at`/`approved_at` an den Status.
-- A6  EIN TEILWEISE EINDEUTIGER INDEX `(tenant_id, partner_id, currency)
--     where status = 'draft'`. Der Plan nennt ihn nicht, aber 7.1 sagt "je
--     (partner_id, currency) entsteht EIN Entwurf". Zwei gleichzeitige
--     Cron-Laeufe scheiterten sonst erst am CHECK `subtotal_cents > 0` (der
--     zweite Entwurf bliebe leer, weil die Zeilen schon gestempelt sind) --
--     derselbe Rollback, aber mit einer Fehlermeldung, die nicht sagt, was
--     los war.
-- A7  BERICHTIGUNG EINES RECHENFEHLERS IM PLAN (keine Abweichung im Aufbau,
--     aber eine im Ergebnis). Plan 7.4 rechnet sein eigenes Steuerbeispiel
--     falsch: `subtotal_cents = 15849` bei 1900 bp ergibt NICHT 3016 Cent und
--     188,65 EUR, sondern 3011 Cent und 188,60 EUR (15849 * 1900 = 30113100,
--     + 5000 = 30118100, / 10000 = 3011). Die Formel des Plans stimmt, nur
--     die Probe nicht. Ausgerechnet und lesend gegen PostgreSQL 17.6
--     gegengeprueft; die Rechnung steht bei der CHECK-Bedingung in Abschnitt
--     2.1. FOLGE FUER B8: src/lib/affiliate/tax.ts und tax.test.ts duerfen
--     das Beispiel des Plans NICHT uebernehmen -- ein Test, der 3016
--     erwartet, schreibt den Fehler fest und laesst die CHECK-Bedingung
--     dieser Tabelle beim ersten echten Beleg mit 23514 abbrechen.
--     Nebenbefund: das Beispiel taugt auch inhaltlich nicht, weil floor und
--     kaufmaennische Rundung bei 15849 dasselbe liefern. Ein Beispiel, das
--     den Unterschied zeigt, steht in Abschnitt 2.1.
--
-- =================================================================
-- ZUM MITLESEN (Plan G17, woertlich)
-- =================================================================
-- Genau eine SELECT-Policy je Tabelle, getrennte Schreib-Policies. Eine
-- zweite permissive Policy kann einer bestehenden nichts wegnehmen (sie
-- werden ver-ODER-t) und kostet Auswertungszeit pro Zeile. Eine einschraenkend
-- gemeinte Bedingung muss IN die konsolidierte SELECT-Policy hinein. Die
-- `for all ... using(false)`-Deny-Policy wird trotzdem gesetzt, aber
-- ausschliesslich als auditierbare Absichtserklaerung fuer den Linter -- der
-- tatsaechliche Schutz ist `revoke all` plus das Fehlen von Schreib-Policies.
-- affiliate_document_counters ist die reine Deny-Tabelle dieser Datei (Plan
-- 3.12 nennt sie ausdruecklich so).
--
-- =================================================================
-- FOLGEN FUER DEN ANWENDUNGSCODE (B8 und spaeter)
-- =================================================================
--   (1) `select('*')` bricht auf affiliate_payouts mit 42501 ab -- die
--       Tabelle traegt ein SPALTENrecht, kein Tabellenrecht (Abschnitt 2.5).
--       Nicht enthalten und damit fuer `authenticated` ueberhaupt nicht
--       lesbar: `reference` (Bankreferenz/interner Vermerk), `document_path`
--       (der Storage-Pfad -- der Zugriff laeuft ausschliesslich ueber die
--       Belegroute mit Besitzpruefung und kurzlebiger Signed URL) und
--       `created_by` (welcher Mensch freigegeben hat, geht den Partner
--       nichts an). Dieselbe Falle wie bei affiliate_partners,
--       affiliate_billing_profiles, affiliate_conditions,
--       affiliate_referrals und affiliate_commissions.
--   (2) Freigegeben wird AUSSCHLIESSLICH ueber approve_affiliate_payout(
--       p_payout_id, p_tenant_id, p_actor_user_id) -- alle drei Argumente
--       sind Pflicht, auch wenn sie in der Signatur `default null` tragen
--       (A4). Ein direktes
--       `update affiliate_payouts set status='approved'` aus TypeScript
--       kaeme am Guard nicht vorbei (er verlangt eine Belegnummer) und waere
--       vor allem nicht atomar: Nummer, Statuswechsel und
--       books_closed_until gehoeren in EINE Transaktion, sonst gibt es
--       entweder eine Nummer ohne Beleg oder einen Beleg ohne Riegel.
--   (3) Der ENTWURF bleibt Anwendungscode (src/lib/affiliate/payout.ts) und
--       laeuft als Compare-and-Swap IM `update` selbst, Muster
--       markPayoutPaid() (src/lib/platform/marketplace.ts:561). Der Filter
--       `.eq("currency", currency)` ist ZWINGEND -- ohne ihn landen zwei
--       Waehrungen in einem Satz mit genau einem `currency`-Feld. Die
--       Summen des Entwurfs werden aus den TATSAECHLICH reservierten Zeilen
--       gebildet, nie aus der Vorschau. approve_affiliate_payout() rechnet
--       das beim Freigeben nach (Kontrollabgleich 7.6, Gleichung 1) und
--       weist jeden Satz ab, dessen Kopf nicht zu seinen Positionen passt --
--       inklusive einer Zeile in fremder Waehrung.
--   (4) Das PDF wird NACH der erfolgreichen RPC erzeugt und abgelegt, unter
--       genau dem Pfad, den die CHECK-Bedingung vorschreibt:
--       `{tenant_id}/affiliate/payouts/{payout_id}.pdf`. Schlaegt das fehl,
--       ist der Beleg trotzdem gueltig; der Reparaturlauf findet den Satz
--       ueber affiliate_payouts_missing_document_idx.
--   (5) Der Bucket `affiliate-documents` hat fuer Clients KEINE Policy --
--       weder lesend noch schreibend. Das ist Absicht: die Gutschrift traegt
--       Anschrift, Steuerstatus und Umsaetze eines Partners, und eine
--       Storage-SELECT-Policy waere zugleich ein Listing-Recht auf den
--       Mandantenordner (derselbe Fund wie 20260710233735 und
--       20260801151000). Ausgeliefert wird ueber
--       src/app/api/affiliate/beleg/[id]/route.ts mit Besitzpruefung und
--       kurzlebiger Signed URL.
--   (6) CLAUDE.md §2.11: keine der Fehlerkennungen dieser Datei traegt einen
--       Wert. Weder Belegnummer noch Betrag noch IBAN noch Steuernummer
--       erscheinen in einer `raise exception` -- die Kennungen sind stabile
--       Bezeichner, die der Aufrufer uebersetzt.
--
-- =================================================================
-- DIESE MIGRATION IST NICHT ANGEWENDET
-- =================================================================
-- Sie wurde in dieser Umgebung auch nicht probeweise gefahren -- es gibt kein
-- lokales Postgres, keinen Docker und keine supabase/config.toml (Plan 12.7).
-- Das Anwenden bleibt Josip vorbehalten (CLAUDE.md §4.6); der Dateiname traegt
-- bis dahin einen Platzhalter-Zeitstempel. Reihenfolge: 20260910120000,
-- 20260910120100, 20260910120200, 20260911120000, 20260911130000,
-- 20260911140000, dann DIESE. Danach `get_advisors(security)` UND
-- `get_advisors(performance)` laufen lassen.
-- ERWARTUNG FUER DIESEN LAUF, damit niemand sie fuer eine Regression haelt:
--   * KEIN neuer Treffer der Klassen
--     `anon_security_definer_function_executable` und
--     `authenticated_security_definer_function_executable` -- diese Datei
--     legt KEINE einzige `security definer`-Funktion an (A3).
--   * KEIN neuer `rls_enabled_no_policy`: affiliate_payouts bekommt eine
--     echte SELECT-Policy, affiliate_document_counters die ausdrueckliche
--     Deny-Policy.
--   * Der Performance-Advisor kann `unused_index` fuer die neuen Indizes
--     melden, solange keine Auszahlung existiert. Das ist direkt nach dem
--     Anwenden erwartbar und kein Grund, einen FK-Index zu streichen.
--   * MOEGLICH ist ein Hinweis auf die aufschiebbaren Fremdschluessel (A1,
--     A2). Er ist beabsichtigt und oben begruendet.
--
-- WIEDERHOLBARKEIT: wie in B1, B3 und B4 bewusst NICHT nachgeruestet.
-- `create table if not exists` wuerde eine bestehende, inhaltlich abweichende
-- Tabelle stillschweigend durchwinken -- ein sauberer Abbruch mit 42P07 ist
-- die ehrlichere Auskunft. Vor jedem `create trigger` steht trotzdem ein
-- `drop trigger if exists`, weil die Trigger an `create or replace`-Funktionen
-- haengen.


-- =================================================================
-- 1. affiliate_document_counters (Plan 3.12) -- der Nummernkreis
-- =================================================================
-- Eine Zeile je Mandant und Jahr. Mehr braucht die Lueckenlosigkeit nicht:
-- der Zaehler ist transaktional, weil er eine gewoehnliche Tabellenzeile ist
-- und kein Sequenzobjekt (Begruendung im Kopf, Fall 1).

-- --- 1.1 Tabelle -------------------------------------------------
create table public.affiliate_document_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Untergrenze 2020, weil ein Beleg dieses Systems nicht aelter sein kann;
  -- Obergrenze 2100, damit ein Tippfehler (20026) nicht einen Nummernkreis
  -- eroeffnet, den niemand mehr findet.
  year      int  not null check (year between 2020 and 2100),
  -- LESART, damit sie niemand raten muss: `next_no` traegt nach jedem Zug die
  -- ZULETZT vergebene Nummer -- der erste Zug legt die Zeile mit 1 an und gibt
  -- 1 zurueck, der zweite setzt 2 und gibt 2 zurueck. Der Name kommt aus Plan
  -- 3.12 und bleibt, damit Plan und Schema dieselbe Spalte meinen; die
  -- Semantik steht hier, weil ein Reparaturskript sie sonst um eins
  -- danebenliest. Solch ein Fehler waere allerdings laut und nicht still:
  -- `unique (tenant_id, document_no)` faengt eine doppelte Nummer mit 23505.
  -- KEINE Obergrenze auf dieser Spalte, obwohl das Format sechs Stellen hat
  -- (7.3): stuende hier `check (next_no <= 999999)`, braeche der 1.000.000te
  -- Zug mit 23514 ab, BEVOR next_affiliate_document_no() seine sprechende
  -- Kennung werfen koennte -- die Pruefung dort waere toter Code. Sie steht
  -- deshalb allein in der Funktion; weil ihr `raise` in derselben
  -- Transaktion liegt wie die Erhoehung, bleibt der Zaehler trotzdem bei
  -- 999999 stehen und die Folge lueckenlos.
  next_no   int  not null default 1 check (next_no >= 1),
  -- Der Primaerschluessel traegt zugleich den Fremdschluessel auf `tenants`
  -- (fuehrende Spalte tenant_id) -- ein zusaetzlicher Index waere ein
  -- Dauerbefund "unused index".
  primary key (tenant_id, year)
);

-- --- 1.2 Guard: der Zaehler zaehlt, sonst nichts -----------------
-- Der eigentliche Schutz der Lueckenlosigkeit gegen einen FEHLER (nicht gegen
-- einen Angreifer -- die Tabelle ist fuer Clients vollstaendig zu). Die
-- Erhoehung um genau eins ist damit eine Eigenschaft der TABELLE und nicht
-- eine Zusage der RPC: selbst ein `set next_no = 500` aus einer kuenftigen,
-- falsch geschriebenen Server-Route wird auf `old.next_no + 1` zurechtgerueckt
-- und kann keine 326 Nummern ueberspringen.
-- OHNE `security definer`, weil die Funktion `current_user` fuer die
-- Erlaubnisliste sehen muss -- unter `security definer` waere das immer der
-- Eigentuemer und die Liste wirkungslos (empirisch belegt in
-- 20260909183548:70-75).
create or replace function public.affiliate_document_counters_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- GANZ VORN, weil OLD beim INSERT nicht zugewiesen ist und jeder `old.`-
  -- Zugriff darunter ein Laufzeitfehler waere (55000; Lehre aus
  -- 20260910120000, B12/B3).
  if tg_op = 'INSERT' then
    -- ERLAUBNISLISTE nur fuer Migration und Dashboard: ein Mandant, der aus
    -- einem Altsystem uebernimmt, muss seinen Nummernkreis dort fortsetzen
    -- koennen, wo das Altsystem aufgehoert hat (Startwert 500 heisst: die
    -- naechste vergebene Nummer ist 501, siehe Lesart oben). 'service_role'
    -- steht bewusst NICHT darin -- der laufende Serverbetrieb eroeffnet
    -- jeden Kreis bei 1.
    if current_user in ('postgres', 'supabase_admin') then
      return new;
    end if;
    new.next_no := 1;
    return new;
  end if;

  -- Fuer JEDE Rolle fest: eine Zaehlerzeile wechselt nie den Mandanten und
  -- nie das Jahr. Sonst liesse sich der Stand eines Jahres auf ein anderes
  -- umhaengen und beide Kreise waeren zerstoert.
  new.tenant_id := old.tenant_id;
  new.year      := old.year;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- Die einzige erlaubte Aenderung: plus eins. Nicht "hoechstens plus eins"
  -- und nicht "mindestens der alte Wert" -- genau eins, weil eine
  -- Belegnummernfolge ohne Luecken genau das heisst.
  new.next_no := old.next_no + 1;
  return new;
end;
$$;

drop trigger if exists affiliate_document_counters_guard_trg on public.affiliate_document_counters;
create trigger affiliate_document_counters_guard_trg
  before insert or update on public.affiliate_document_counters
  for each row execute function public.affiliate_document_counters_guard();

-- --- 1.3 Loesch-Guard --------------------------------------------
-- Eine geloeschte Zaehlerzeile startet den Kreis wieder bei 1. Das faellt
-- zwar sofort auf (die naechste Freigabe verletzt `unique (tenant_id,
-- document_no)` mit 23505), aber erst NACHDEM die Auszahlung freigegeben
-- werden sollte -- und ein Mandant, der in diesem Jahr noch keinen Beleg hat,
-- merkt es gar nicht. Gleiche Bauart wie
-- affiliate_commissions_delete_guard() (20260911130000, Abschnitt 2.7) und
-- affiliate_audit_log_guard() (20260910120000): Erlaubnisliste plus die
-- HERKUNFT der Anweisung. `pg_trigger_depth() > 1` ist die Mandantenkaskade
-- (tenants -> affiliate_document_counters) -- sie bleibt offen. 'service_role'
-- steht bewusst NICHT in der Liste: der normale Serverbetrieb loescht keinen
-- Nummernkreis.
create or replace function public.affiliate_document_counters_delete_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin')
     or pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'affiliate_document_counter_immutable';
end;
$$;

drop trigger if exists affiliate_document_counters_delete_guard_trg on public.affiliate_document_counters;
create trigger affiliate_document_counters_delete_guard_trg
  before delete on public.affiliate_document_counters
  for each row execute function public.affiliate_document_counters_delete_guard();

-- --- 1.4 RLS -----------------------------------------------------
alter table public.affiliate_document_counters enable row level security;
revoke all on public.affiliate_document_counters from anon, authenticated;
-- Kein einziger Grant: der Zaehler geht keinen Client etwas an, nicht einmal
-- lesend. Wer den Stand kennt, kennt die Zahl der Gutschriften eines
-- Mandanten -- eine Geschaeftszahl, die in keiner Oberflaeche vorkommt.
create policy affiliate_document_counters_deny_all on public.affiliate_document_counters
  for all to anon, authenticated using (false) with check (false);


-- =================================================================
-- 2. affiliate_payouts (Plan 3.12) -- der Auszahlungssatz und sein Beleg
-- =================================================================

-- --- 2.1 Tabelle -------------------------------------------------
create table public.affiliate_payouts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  program_id     uuid not null,
  partner_id     uuid not null,

  -- Der abgerechnete Zeitraum. Er steht auf dem Beleg und ist ab der
  -- Nummernvergabe eingefroren.
  period_from    date not null,
  period_to      date not null check (period_to >= period_from),

  -- EINE Waehrung je Satz. Der Entwurf filtert deshalb zwingend nach
  -- Waehrung (Plan 7.1); zwei Waehrungen ergeben zwei Saetze, nie einen
  -- gemischten. Gleiche Schreibweise wie affiliate_commissions.currency
  -- (klein, dreistellig), damit der Vergleich im Kontrollabgleich ohne
  -- Normalisierung funktioniert.
  currency       text not null default 'eur' check (currency ~ '^[a-z]{3}$'),

  -- Die drei Summen. `gross_cents` ist die Summe der positiven Zeilen,
  -- `reversal_cents` die der negativen (also <= 0), `subtotal_cents` das
  -- Netto-Honorar. Sie werden aus den TATSAECHLICH reservierten Zeilen
  -- gebildet, nie aus einer Vorschau, und approve_affiliate_payout() rechnet
  -- sie beim Freigeben gegen das Provisionsbuch nach (7.6, Gleichung 1).
  gross_cents    int  not null check (gross_cents >= 0),
  reversal_cents int  not null check (reversal_cents <= 0),
  subtotal_cents int  not null,

  -- Der Steuermodus wird aus affiliate_billing_profiles ABGELEITET (7.4), nie
  -- frei gewaehlt, und hier eingefroren. Die beiden blockierenden Faelle des
  -- Plans (EU ohne gueltige USt-IdNr., Privatperson) haben bewusst KEINEN
  -- Wert: fuer sie entsteht gar kein Satz.
  tax_mode       text not null check (tax_mode in
                   ('regular','small_business','reverse_charge','non_eu')),
  tax_rate_bp    int  not null default 0 check (tax_rate_bp between 0 and 10000),
  tax_cents      int  not null default 0 check (tax_cents >= 0),
  total_cents    int  not null,

  status         text not null default 'draft'
                   check (status in ('draft','approved','exported','paid','failed','cancelled')),
  -- NUR der Zahlweg. Die Zahlungsverbindung (IBAN, BIC, Kontoinhaber,
  -- PayPal-Adresse) bleibt in affiliate_billing_profiles -- Begruendung im
  -- Kopf.
  method         text check (method in ('sepa','paypal','manual')),

  -- Der Beleg. `document_no` ist die lueckenlose Nummer (7.3),
  -- `document_issued_at` das Ausstellungsdatum, `document_path` der Ort der
  -- Darstellung. Nur die letzte Spalte bleibt nach der Vergabe schreibbar.
  document_no    text,
  document_path  text,
  document_issued_at timestamptz,

  -- Bankreferenz nach dem Abgleich (7.7), zod-validiert vom Aufrufer.
  reference      text,
  approved_at    timestamptz,
  paid_at        timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (tenant_id, document_no),
  unique (id, tenant_id),

  -- --- Die Rechenkette, als Eigenschaft statt als Zusage ---
  check (subtotal_cents = gross_cents + reversal_cents),
  check (total_cents = subtotal_cents + tax_cents),
  -- A5: eine Auszahlung ueber 0 oder weniger ist keine. Plan 7.1 traegt den
  -- Fall bereits ("der Betrag bleibt stehen und wird vorgetragen"), aber nur
  -- als Regel des Entwurfslaufs; hier wird daraus eine Grenze, an der ein
  -- fehlerhafter Lauf abbricht, statt eine Belegnummer fuer nichts zu
  -- verbrennen.
  check (subtotal_cents > 0),
  -- A5 / Plan 7.4: die Steuertabelle kennt GENAU EINEN Modus mit Satz --
  -- 'regular' mit 1900 bp. 'small_business' (§ 19 UStG), 'reverse_charge'
  -- (Art. 196 MwStSystRL) und 'non_eu' weisen keine Steuer aus. Ein
  -- 'reverse_charge' mit 1900 bp waere ein falscher Steuerausweis und nach
  -- § 14c UStG geschuldet -- teurer als jede verzoegerte Auszahlung.
  check ((tax_rate_bp > 0) = (tax_mode = 'regular')),
  -- A5 / Plan 7.4, DIE STEUERFORMEL SELBST:
  --   tax_cents = floor((subtotal_cents * tax_rate_bp + 5000) / 10000)
  -- Das `+ 5000` ist KAUFMAENNISCHE Rundung und die EINZIGE Stelle des ganzen
  -- Moduls, an der nicht abgeschnitten wird (G12). Der Unterschied ist kein
  -- Geschmack: `tax_cents` rechnet auf eine ENDSUMME, waehrend jede andere
  -- Rundung des Moduls einen Betrag auf mehrere Zeilen VERTEILT -- dort
  -- erzeugt Aufrunden Cent, die niemand eingenommen hat.
  -- BERICHTIGUNG DES PLANS (nachgerechnet, nicht abgeschrieben): Plan 7.4
  -- fuehrt als Probe `subtotal_cents = 15849, tax_rate_bp = 1900` an und
  -- kommt auf "floor(3016,31) = 3016 -> 30,16 EUR, Gesamt 188,65 EUR". Das
  -- ist arithmetisch falsch. 15849 * 1900 = 30113100; + 5000 = 30118100;
  -- / 10000 = 3011 (exakt 3011,81 vor dem Abschneiden, 19 % von 158,49 EUR
  -- sind 30,1131 EUR). Richtig ist also 3011 Cent = 30,11 EUR und
  -- 15849 + 3011 = 18860 Cent = 188,60 EUR. Die FORMEL des Plans stimmt, nur
  -- sein Zahlenbeispiel nicht -- src/lib/affiliate/tax.ts und dessen Test
  -- muessen 3011 erwarten, sonst schreiben sie den Rechenfehler fest.
  -- Das Beispiel taugt ohnehin nicht als Beleg fuer die kaufmaennische
  -- Rundung, weil floor und Rundung hier DASSELBE ergeben. Eines, das sie
  -- unterscheidet: subtotal_cents = 15850 -> exakt 3011,5 Cent Steuer;
  -- abschneiden gaebe 3011, kaufmaennisch gerundet sind es 3012
  -- ((15850*1900 + 5000)/10000 = 30120000/10000 = 3012), Gesamt 18862 Cent =
  -- 188,62 EUR. Beide Werte lesend gegen PostgreSQL 17.6 nachgerechnet.
  -- `::bigint` ist Pflicht: 2,1 Mrd. Cent mal 10000 sprengt `int`.
  -- Ganzzahldivision schneidet in Postgres gegen null ab; weil
  -- subtotal_cents > 0 und tax_rate_bp >= 0 sind, ist das hier identisch mit
  -- floor().
  check (tax_cents = ((subtotal_cents::bigint * tax_rate_bp + 5000) / 10000)::int),
  -- Die Provision ist auf den Nettoumsatz des Haendlers gerechnet und damit
  -- das NETTO-Honorar des Partners; die Steuer kommt oben drauf. Wer das
  -- umdreht, zahlt dauerhaft 19 % zu wenig oder weist eine Steuer aus, die
  -- nicht abgefuehrt wurde. Genau deshalb steht oben
  -- `total = subtotal + tax` und nicht `subtotal = total - tax`.

  -- --- Der Lebenslauf, als Eigenschaft statt als Zusage ---
  -- Plan 3.12: sobald der Satz den Entwurfszustand verlaesst, hat er eine
  -- Belegnummer. Ein 'cancelled' ist ein verworfener ENTWURF und deshalb
  -- ausgenommen -- er hat nie eine Nummer gezogen.
  check (status in ('draft','cancelled') or document_no is not null),
  -- Nummer und Ausstellungsdatum entstehen zusammen; eines ohne das andere
  -- waere ein halber Beleg.
  check ((document_no is null) = (document_issued_at is null)),
  -- Format aus 7.3: GS-<TENANT_SLUG>-<JAHR>-<6-stellig>, z. B.
  -- GS-DEMO-BLAU-2026-000173. Der Slug-Teil folgt
  -- `tenants.slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'` in Grossschreibung
  -- (Befund 3).
  check (document_no is null or document_no ~ '^GS-[A-Z0-9][A-Z0-9-]{1,40}-[0-9]{4}-[0-9]{6}$'),
  -- A5 / CLAUDE.md §2.5: die Pfadkonvention `{tenant_id}/...` steht nicht in
  -- einem Kommentar, sondern in der Bedingung. Damit kann kein Aufrufer ein
  -- Dokument unter einem fremden Mandantenordner verbuchen, und der
  -- Reparaturlauf kann den Pfad aus der Zeile ERRECHNEN statt ihn zu lesen.
  check (document_path is null
         or document_path = tenant_id::text || '/affiliate/payouts/' || id::text || '.pdf'),
  -- Freigabe, Export, Ueberweisung und Fehlschlag setzen alle einen
  -- Freigabezeitpunkt voraus; Entwurf und verworfener Entwurf haben keinen.
  check ((approved_at is not null) = (status not in ('draft','cancelled'))),
  -- G8: 'paid' und `paid_at` sind dasselbe Ereignis.
  check ((status = 'paid') = (paid_at is not null)),
  -- A5: ohne Zahlweg gibt es keine Ueberweisung und keinen Export. Im Entwurf
  -- darf er noch fehlen (das Abrechnungsprofil kann unvollstaendig sein --
  -- dann erscheint der Fall unter "Nicht auszahlbar", Plan 7.1).
  check (status in ('draft','cancelled') or method is not null),

  -- A1: `no action deferrable initially deferred` statt `restrict` --
  -- inhaltlich dieselbe Sperre, aber am COMMIT statt am Anweisungsende
  -- geprueft. Begruendung ausfuehrlich im Kopf.
  constraint affiliate_payouts_program_fk
    foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id)
    on delete no action deferrable initially deferred,
  constraint affiliate_payouts_partner_fk
    foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id)
    on delete no action deferrable initially deferred
);

-- --- 2.2 Indizes -------------------------------------------------
-- Die Partnerliste (Plan 8.2 "Auszahlungen") und der Fremdschluessel auf
-- affiliate_partners.
create index affiliate_payouts_partner_idx
  on public.affiliate_payouts (partner_id, tenant_id, created_at desc);
-- Die Admin-Liste je Zustand (Plan 8.1) und zugleich der Fremdschluessel auf
-- tenants (fuehrende Spalte tenant_id).
create index affiliate_payouts_status_idx
  on public.affiliate_payouts (tenant_id, status);
-- Traegt den Fremdschluessel auf affiliate_programs (Advisor
-- `unindexed_foreign_keys`).
create index affiliate_payouts_program_idx
  on public.affiliate_payouts (program_id, tenant_id);
-- Traegt den Fremdschluessel auf profiles. Partiell, weil `created_by` beim
-- Cron-Entwurf leer bleibt und fuer NULL ohnehin nichts geprueft wird.
create index affiliate_payouts_created_by_idx
  on public.affiliate_payouts (created_by) where created_by is not null;
-- DER REPARATURLAUF (Kopf, Fall 3): gueltiger Beleg ohne Datei. Ein
-- Teilindex, weil die Menge im Normalbetrieb leer ist -- genau dann ist eine
-- Abfrage ohne Index am teuersten, weil sie ueber alles laufen muss, um
-- nichts zu finden.
create index affiliate_payouts_missing_document_idx
  on public.affiliate_payouts (tenant_id, document_issued_at)
  where document_no is not null and document_path is null;
-- A6: je (partner_id, currency) hoechstens EIN offener Entwurf (Plan 7.1).
-- Zwei gleichzeitige Cron-Laeufe brechen damit mit 23505 ab statt mit einer
-- Meldung ueber eine verletzte Summenbedingung.
create unique index affiliate_payouts_open_draft_uniq
  on public.affiliate_payouts (tenant_id, partner_id, currency)
  where status = 'draft';

-- --- 2.3 Der Beleg-Guard (Plan 3.12, G8, G15) --------------------
-- Er tut drei Dinge, und die Reihenfolge ist Teil der Aussage:
--   (a) INSERT-Zweig GANZ VORN -- beim INSERT ist OLD nicht zugewiesen;
--   (b) der Kaskaden-Ausweg fuer `created_by`, eng gefasst und vor jeder
--       Festnagelung;
--   (c) die Festnagelung der Belegzahlen, sobald eine Nummer vergeben ist,
--       dazu die Uebergangstabelle des Status.
-- OHNE `security definer`, weil die Funktion `current_user` fuer die
-- Erlaubnisliste sehen muss.
create or replace function public.affiliate_payouts_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_self_partner_id uuid;
begin
  -- ---------------- INSERT --------------------------------------------------
  if tg_op = 'INSERT' then
    -- Erlaubnisliste NUR fuer Migration und Dashboard. 'service_role' steht
    -- hier bewusst nicht: auch der Serverbetrieb legt keinen fertigen Beleg
    -- an, er laesst ihn entstehen.
    if current_user in ('postgres', 'supabase_admin') then
      return new;
    end if;

    -- Zeitstempel gehoeren der Datenbank. Ohne diese zwei Zeilen koennte ein
    -- Aufrufer einen Auszahlungssatz rueckdatieren.
    new.created_at := now();
    new.updated_at := now();

    -- Ein Satz wird IMMER als Entwurf geboren. Andernfalls waere der gesamte
    -- Freigabeweg (Entwurf -> Pruefung -> Nummer -> Ueberweisung) mit einem
    -- einzigen Insert ueberspringbar: eine Zeile, die als bezahlt im Buch
    -- steht, ohne dass je eine Nummer gezogen oder ein Mensch gefragt wurde.
    if new.status <> 'draft' then
      raise exception 'affiliate_payout_insert_must_be_draft';
    end if;
    if new.document_no is not null
       or new.document_issued_at is not null
       or new.document_path is not null
       or new.approved_at is not null
       or new.paid_at is not null then
      raise exception 'affiliate_payout_insert_not_issued';
    end if;

    return new;
  end if;

  -- ---------------- UPDATE --------------------------------------------------
  -- KASKADEN-AUSWEG, eng gefasst und VOR jeder anderen Pruefung.
  -- `created_by references public.profiles(id) on delete set null`, und
  -- `profiles` haengt per `profiles_id_fkey` mit `on delete cascade` an
  -- `auth.users`. Jede geloeschte Anmeldung kaskadiert also auf `profiles`
  -- und von dort per RI_FKey_setnull_del als UPDATE hierher. Ohne diesen
  -- Zweig nagelte die Festnagelung darunter `created_by` still auf `old`
  -- zurueck -- das UPDATE liefe durch, der Verweis bliebe stehen, und die
  -- Tabelle zeigte auf eine geloeschte Zeile. Bei SET NULL gibt es keine
  -- Nachpruefung durch Postgres, der Bruch faellt also NICHT auf. Derselbe
  -- Fund wie in affiliate_audit_log_guard() (20260910120000, 3. Runde).
  -- `pg_trigger_depth() > 1` prueft die HERKUNFT der Anweisung, nicht die
  -- Rolle; der Vergleich ueber `to_jsonb(...) - 'created_by'` stellt sicher,
  -- dass kein anderes Feld mitreist. Der Touch-Trigger laeuft erst NACH
  -- diesem Guard ('g' < 't'), `updated_at` ist hier also noch unveraendert.
  if pg_trigger_depth() > 1
     and old.created_by is not null
     and new.created_by is null
     and to_jsonb(new) - 'created_by' = to_jsonb(old) - 'created_by' then
    return new;
  end if;

  -- Identitaetsspalten sind fuer JEDE Rolle fest: ein Auszahlungssatz
  -- wechselt nie den Mandanten, nie das Programm, nie den Partner. Ein
  -- Partnerwechsel auf einem fertigen Beleg waere eine Umbuchung von Geld an
  -- eine andere Person unter derselben Belegnummer.
  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.program_id := old.program_id;
  new.partner_id := old.partner_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;

  -- G15: kein Eigengeschaeft. Wer selbst Partner dieses Mandanten ist, ruehrt
  -- SEINEN EIGENEN Auszahlungssatz nicht an -- nicht den Status, nicht die
  -- Referenz, gar nichts. `affiliate_self_partner_id()` fragt nach der PERSON
  -- und filtert bewusst NICHT auf `status = 'active'` (20260910120000,
  -- Abschnitt 8): die Frage "geht es um mein eigenes Geld?" haengt nicht am
  -- Freigabestatus der eigenen Partnerzeile.
  -- WICHTIG UND AUSDRUECKLICH: fuer `service_role` ist `auth.uid()` null, die
  -- Funktion liefert null, dieser Zweig greift nicht. Er traegt G15 also NUR
  -- fuer eine interaktive Aenderung -- und weil die Freigabe ueber eine RPC
  -- unter `service_role` laeuft, ist er dort wirkungslos. GENAU DESHALB nimmt
  -- approve_affiliate_payout() den handelnden Menschen als Parameter entgegen
  -- und prueft G15 selbst (Abweichung A4). Dieser Zweig ist die zweite Ebene,
  -- nicht die erste.
  v_self_partner_id := public.affiliate_self_partner_id(old.tenant_id);
  if v_self_partner_id is not null and v_self_partner_id = old.partner_id then
    raise exception 'affiliate_payout_self_dealing_forbidden';
  end if;

  -- DIE UEBERGANGSTABELLE (Plan 7.2, 7.7). 'paid', 'failed' und 'cancelled'
  -- sind Endzustaende -- fuer sie gibt es keine Kante nach draussen. Geld,
  -- das den Mandanten verlassen hat, wird nicht durch einen Statuswechsel
  -- zurueckgeholt, und ein fehlgeschlagener Beleg wird nicht "repariert",
  -- sondern durch eine Stornogutschrift mit eigener Nummer neutralisiert
  -- (7.7). Ein Entwurf, der nicht auszahlbar ist, wird verworfen
  -- ('cancelled') und NICHT geloescht -- geloescht wird hier gar nichts
  -- (2.6).
  if new.status is distinct from old.status then
    if not (
         (old.status = 'draft'    and new.status in ('approved','cancelled'))
      or (old.status = 'approved' and new.status in ('exported','paid','failed'))
      or (old.status = 'exported' and new.status in ('paid','failed'))
    ) then
      raise exception 'affiliate_payout_status_transition_forbidden';
    end if;
  end if;

  -- DIE FREIGABE. Nummer, Ausstellungsdatum und Freigabezeitpunkt entstehen
  -- in genau diesem einen Uebergang. Die Nummer muss der Aufrufer
  -- mitbringen -- sie kommt aus next_affiliate_document_no() und darf nicht
  -- hier gezogen werden, weil ein Guard kein Ort fuer eine Seitenwirkung auf
  -- eine andere Tabelle ist. Die beiden ZEITSTEMPEL dagegen setzt die
  -- Datenbank: `now()` ist innerhalb einer Transaktion stabil, sie sind damit
  -- exakt derselbe Zeitpunkt, aus dem die RPC das Belegjahr abgeleitet hat.
  if old.status = 'draft' and new.status = 'approved' then
    if new.document_no is null then
      raise exception 'affiliate_payout_document_no_required';
    end if;
    new.approved_at        := now();
    new.document_issued_at := now();
  end if;

  -- G8, zweite Haelfte: der Zeitpunkt der Ueberweisung kommt aus der
  -- Datenbank, nicht aus dem Aufrufer -- und er wird nie wieder angefasst.
  if new.status = 'paid' and old.status <> 'paid' then
    new.paid_at := now();
  end if;
  if old.paid_at is not null then
    new.paid_at := old.paid_at;
  end if;

  -- DER BELEGFROST (Plan 3.12, GoBD). Ab der Nummernvergabe sind die Zahlen
  -- des Belegs unveraenderlich: ein nachtraegliches Neuerzeugen aus
  -- geaenderten Daten ist unzulaessig.
  -- ERLAUBNISLISTE, und sie ist bewusst ENGER als die der anderen Guards
  -- dieses Moduls und WEITER als die von affiliate_commissions_guard():
  --   * 'service_role' steht NICHT darin. Der gesamte Serverbetrieb laeuft
  --     unter dieser Rolle; liesse man sie durch, waere der Frost eine
  --     Formulierung und kein Schutz -- ein falscher Filter in einer
  --     kuenftigen Server Action schriebe Belegsummen um.
  --   * 'postgres'/'supabase_admin' stehen darin, anders als beim
  --     Provisionsbuch (G4, dort ohne jede Liste). Grund: eine Provisionszeile
  --     wird durch eine GEGENBUCHUNG korrigiert, dafuer gibt es einen fertigen
  --     Weg. Ein Auszahlungssatz kennt den Weg auch (Stornogutschrift, 7.7),
  --     aber es gibt einen Fall davor: ein Steuerberater stellt VOR dem
  --     Versand fest, dass ein Steuermodus falsch abgeleitet wurde. Diesen
  --     Fall per Migration zu berichtigen ist die kleinere Luege als eine
  --     Storno- plus Neugutschrift ueber einen Beleg, den nie jemand gesehen
  --     hat. Die Huerde bleibt hoch und sichtbar: eine Migration, kein
  --     Serveraufruf.
  -- `document_path` ist die EINZIGE Belegspalte, die schreibbar bleibt --
  -- damit der Reparaturlauf ein fehlendes PDF aus den eingefrorenen Zahlen
  -- deterministisch nacherzeugen kann (Kopf, Fall 3). Die Zahlen sind der
  -- Beleg, die Datei ist nur ihre Darstellung.
  if old.document_no is not null
     and current_user not in ('postgres', 'supabase_admin') then
    new.period_from        := old.period_from;
    new.period_to          := old.period_to;
    new.currency           := old.currency;
    new.gross_cents        := old.gross_cents;
    new.reversal_cents     := old.reversal_cents;
    new.subtotal_cents     := old.subtotal_cents;
    new.tax_mode           := old.tax_mode;
    new.tax_rate_bp        := old.tax_rate_bp;
    new.tax_cents          := old.tax_cents;
    new.total_cents        := old.total_cents;
    new.document_no        := old.document_no;
    new.document_issued_at := old.document_issued_at;
    new.approved_at        := old.approved_at;
  end if;

  -- DER ZAHLUNGSFROST. Nach der Ueberweisung aendert sich auch das Drumherum
  -- nicht mehr: der Zahlweg ist gelaufen, die Bankreferenz ist der Nachweis
  -- des Abgleichs. Schreibbar bleibt allein `document_path` (siehe oben) und
  -- `updated_at` (Touch-Trigger).
  if old.status = 'paid'
     and current_user not in ('postgres', 'supabase_admin') then
    new.method    := old.method;
    new.reference := old.reference;
  end if;

  -- Aenderbar bleiben damit genau: status (entlang der Kanten oben), method
  -- und reference (bis zur Ueberweisung), document_path (immer -- der
  -- Reparaturlauf), die von der Datenbank gesetzten Zeitstempel und
  -- updated_at. Alles andere ist ab der Nummernvergabe Beleg.
  return new;
end;
$$;

drop trigger if exists affiliate_payouts_guard_trg on public.affiliate_payouts;
-- BEFORE-Trigger derselben Tabelle laufen alphabetisch, `g < t` -- der Guard
-- muss vor dem Touch laufen (20260807171725:198-203).
create trigger affiliate_payouts_guard_trg
  before insert or update on public.affiliate_payouts
  for each row execute function public.affiliate_payouts_guard();

drop trigger if exists affiliate_payouts_touch on public.affiliate_payouts;
create trigger affiliate_payouts_touch before update on public.affiliate_payouts
  for each row execute function public.set_updated_at();

-- --- 2.4 RLS -----------------------------------------------------
alter table public.affiliate_payouts enable row level security;
revoke all on public.affiliate_payouts from anon, authenticated;

-- --- 2.5 Spaltenrecht --------------------------------------------
-- ZWEITE EBENE NEBEN RLS, weil RLS keine SPALTEN trennt. Draussen bleiben:
--   reference      -- Bankreferenz und interner Vermerk zum Abgleich; sie
--                     kann eine Kontoauszugszeile oder einen
--                     Verwendungszweck tragen und geht den Partner nichts an;
--   document_path  -- der Storage-Pfad. Der Bucket ist privat und traegt fuer
--                     Clients keine Policy (Abschnitt 6); der Pfad in der
--                     Hand des Clients waere trotzdem der Anfang jedes
--                     Versuchs, an der Belegroute vorbeizukommen. Wer den
--                     Beleg will, holt ihn ueber die Route mit
--                     Besitzpruefung und kurzlebiger Signed URL;
--   created_by     -- welcher Mensch freigegeben hat. Das ist eine
--                     Personalinformation des Mandanten, kein Belegdatum;
--                     dieselbe Einordnung wie `internal_note` und
--                     `payout_hold_reason` an affiliate_partners.
-- WICHTIG: Spaltenrechte sind NICHT rollenabhaengig. Diese Liste ist die
-- SCHNITTMENGE aus dem, was Partner UND Manager ueber PostgREST sehen
-- duerfen; der Manager bekommt die drei fehlenden Spalten ueber eine
-- Server-Route mit requireAdminTenant() und createAdminClient().
-- Folge fuer den Anwendungscode: `select('*')` bricht hier mit 42501 ab.
grant select (id, tenant_id, program_id, partner_id,
              period_from, period_to, currency,
              gross_cents, reversal_cents, subtotal_cents,
              tax_mode, tax_rate_bp, tax_cents, total_cents,
              status, method, document_no, document_issued_at,
              approved_at, paid_at, created_at, updated_at)
  on public.affiliate_payouts to authenticated;
-- KEIN `grant insert/update/delete`: geschrieben wird ausschliesslich ueber
-- approve_affiliate_payout() und die Server Actions aus B8 unter
-- createAdminClient(). Ein Client schreibt nie.

-- --- 2.6 Policies (genau eine SELECT-Policy, G17) ----------------
-- BEIDE Zweige haengen an der tenant_id DER ZEILE. Ein ungebundener Zweig
-- hoebe den anderen auf, weil permissive Policies ver-ODER-t werden.
-- `(select auth.uid())` waere hier ueberfluessig -- die beiden
-- Security-Definer-Helfer sind `stable` und werden ohnehin einmal je Abfrage
-- ausgewertet (Advisor auth_rls_initplan, 20260712233000:4-10).
create policy affiliate_payouts_select on public.affiliate_payouts for select using (
  public.affiliate_is_manager(tenant_id)
  or partner_id = public.affiliate_partner_id(tenant_id)
);
-- Auditierbare Absichtserklaerung fuer den Linter; der tatsaechliche Schutz
-- ist das `revoke all` oben plus das Fehlen jeder Schreib-Policy.
create policy affiliate_payouts_deny_write on public.affiliate_payouts
  for all to anon, authenticated using (false) with check (false);

-- --- 2.7 Der Loesch-Guard ----------------------------------------
-- Ein einmal erzeugter Beleg wird nie geloescht (Plan 7.7). Ohne diesen
-- Trigger galte das nur halb: umschreiben verhindert der Guard oben,
-- wegwerfen nicht. Ein `admin.from('affiliate_payouts').delete().eq(...)` mit
-- einem Filter zu wenig raeumte die Gutschriften eines Mandanten oder eines
-- Zeitraums restlos weg -- und nichts hielte das an: RLS gilt fuer
-- `service_role` wegen `rolbypassrls` nicht, eine DELETE-Policy gibt es nicht,
-- und das DELETE-Recht kommt aus `alter default privileges`. Was verschwaende,
-- waeren Belege mit zehnjaehriger Aufbewahrungsfrist -- und zusaetzlich die
-- LUECKENLOSIGKEIT: nach einem geloeschten Satz fehlt seine Nummer in der
-- Folge, und der Zaehler gibt sie nicht wieder her.
-- Gleiche Bauart wie affiliate_commissions_delete_guard() (20260911130000):
-- Erlaubnisliste plus die HERKUNFT der Anweisung. `pg_trigger_depth() > 1` ist
-- die Mandantenkaskade (tenants -> affiliate_payouts) -- sie bleibt offen,
-- dieser Guard blockiert sie NICHT. 'service_role' steht bewusst NICHT in der
-- Liste: der normale Serverbetrieb loescht keinen Beleg, auch keinen
-- verworfenen Entwurf -- der bekommt `status = 'cancelled'`.
-- OHNE `security definer`: unter `security definer` waere `current_user`
-- immer der Eigentuemer und die Erlaubnisliste damit wirkungslos.
create or replace function public.affiliate_payouts_delete_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin')
     or pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'affiliate_payout_immutable';
end;
$$;

drop trigger if exists affiliate_payouts_delete_guard_trg on public.affiliate_payouts;
create trigger affiliate_payouts_delete_guard_trg
  before delete on public.affiliate_payouts
  for each row execute function public.affiliate_payouts_delete_guard();


-- =================================================================
-- 3. Der nachgetragene Fremdschluessel auf affiliate_commissions
-- =================================================================
-- 20260911130000 hat `payout_id` bewusst ohne Fremdschluessel angelegt
-- ("KEIN Fremdschluessel: affiliate_payouts entsteht erst mit Block B8"). Er
-- kommt hier, zusammengesetzt ueber (payout_id, tenant_id), damit eine
-- Provisionszeile niemals auf einen Auszahlungssatz eines FREMDEN Mandanten
-- zeigen kann -- dieselbe Bauart wie alle Fremdschluessel des Moduls.
-- A2: `no action deferrable initially deferred`, NICHT `on delete set null`.
-- Begruendung ausfuehrlich im Kopf; kurz: eine SET-NULL-Kaskade liefe als
-- UPDATE in affiliate_commissions_guard() und wuerde dort fuer jede bezahlte
-- Zeile mit 'affiliate_commission_payout_stamp_forbidden' abbrechen -- und
-- damit die Mandantenloeschung mitnehmen.
-- Der Index dafuer existiert bereits: affiliate_commissions_payout_idx
-- (payout_id, tenant_id), 20260911130000 Abschnitt 2.2, exakt in dieser
-- Spaltenreihenfolge.
alter table public.affiliate_commissions
  add constraint affiliate_commissions_payout_fk
  foreign key (payout_id, tenant_id)
  references public.affiliate_payouts (id, tenant_id)
  on delete no action deferrable initially deferred;


-- =================================================================
-- 4. RPC next_affiliate_document_no(uuid, int) -- Plan 7.3
-- =================================================================
-- Ein einziges `insert ... on conflict ... do update ... returning` --
-- dasselbe Race-Absicherungsmuster wie `increment_usage`
-- (20260711164826:47-59). Warum kein Sequenzobjekt, warum diese Reihenfolge
-- und was bei einem Abbruch passiert: ausfuehrlich im Kopf dieser Datei.
--
-- Die Funktion wird AUSSCHLIESSLICH innerhalb von approve_affiliate_payout()
-- aufgerufen, also in derselben Transaktion wie der Statuswechsel. Schlaegt
-- der fehl, wird der Zaehler mit zurueckgerollt.
--
-- A3: ohne `security definer`. Der einzige Aufrufer ist `service_role` und
-- hat die Rechte bereits.
create or replace function public.next_affiliate_document_no(p_tenant_id uuid, p_year int)
returns int
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_no int;
begin
  if p_tenant_id is null or p_year is null then
    raise exception 'affiliate_document_no_arguments_missing';
  end if;

  -- Der Guard aus Abschnitt 1.2 rueckt den Wert ohnehin auf
  -- `old.next_no + 1` zurecht; `returning` liefert den Stand NACH den
  -- BEFORE-Triggern und damit genau die vergebene Nummer.
  insert into public.affiliate_document_counters (tenant_id, year, next_no)
  values (p_tenant_id, p_year, 1)
  on conflict (tenant_id, year) do update
    set next_no = affiliate_document_counters.next_no + 1
  returning affiliate_document_counters.next_no into v_no;

  -- Das Format hat sechs Stellen (7.3), also ist bei 999999 Schluss. Die
  -- Pruefung steht HIER und nicht als CHECK auf der Zaehlerspalte (siehe
  -- dort): so bekommt der Aufrufer eine uebersetzbare Kennung statt 23514.
  -- Der `raise` liegt in derselben Transaktion wie die Erhoehung, die also
  -- mit zurueckgerollt wird -- der Zaehler bleibt bei 999999 stehen, es geht
  -- keine Nummer verloren. 999.999 Gutschriften je Mandant und Jahr sind
  -- keine realistische Grenze; die Pruefung steht da, damit der Tag, an dem
  -- sie es doch ist, nicht mit einem verbrannten Beleg endet.
  if v_no > 999999 then
    raise exception 'affiliate_payout_document_no_exhausted';
  end if;

  return v_no;
end;
$$;


-- =================================================================
-- 5. RPC approve_affiliate_payout(uuid, uuid, uuid) -- Plan 7.2
-- =================================================================
-- DAS UNUMKEHRBARE, in genau dieser Reihenfolge und in EINER Transaktion:
--   1. Auszahlungssatz sperren und auf 'draft' pruefen (Compare-and-Swap);
--   2. G15 -- der Freigebende ist nicht der Empfaenger;
--   3. Partner und Rechtstraeger sind heute noch auszahlbar;
--   4. KONTROLLABGLEICH (Plan 7.6, Gleichung 1): die zugeordneten
--      Provisionszeilen werden gesperrt und ihre Summe gegen den Belegkopf
--      gerechnet;
--   5. ERST JETZT die Belegnummer ziehen (7.3);
--   6. Status, Nummer und Zeitstempel setzen (die Zeitstempel setzt der
--      Guard);
--   7. books_closed_until = greatest(books_closed_until, period_to) (G14).
--
-- Warum Schritt 5 so spaet: die Zaehlerzeile serialisiert alle Freigaben
-- eines Mandanten und Jahres bis zum COMMIT. Je weniger Arbeit danach
-- kommt, desto kuerzer das Sperrfenster. Die Sperrreihenfolge
-- (Auszahlungssatz -> Provisionszeilen -> Zaehler) ist in jeder Freigabe
-- dieselbe; zwei gleichzeitige Freigaben koennen sich deshalb nicht
-- verklemmen.
--
-- Das PDF wird DANACH erzeugt und abgelegt; `document_path` bleibt bis dahin
-- null. Scheitert der Storage-Schreibvorgang, ist der Beleg trotzdem gueltig
-- (Kopf, Fall 3).
--
-- A3: ohne `security definer`. A4: `p_tenant_id` und `p_actor_user_id` sind
-- neu gegenueber dem Plan -- der eine traegt CLAUDE.md §2.15, der andere G15
-- in die Datenbank.
create or replace function public.approve_affiliate_payout(
  p_payout_id      uuid,
  p_tenant_id      uuid default null,
  p_actor_user_id  uuid default null
)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_payout        public.affiliate_payouts%rowtype;
  v_partner_status      text;
  v_partner_hold        boolean;
  v_partner_user_id     uuid;
  v_partner_program_id  uuid;
  v_slug          text;
  v_legal         jsonb;
  v_rows          int;
  v_gross         int;
  v_reversal      int;
  v_bad_status    int;
  v_bad_currency  int;
  v_bad_partner   int;
  v_bad_test      int;
  v_bad_flagged   int;
  -- Das Belegdatum in DEUTSCHER Zeitzone, nicht in UTC. Die Gutschrift ist
  -- ein deutscher Beleg (§ 14 Abs. 2 UStG, GoBD), und in der Stunde nach
  -- Mitternacht am 1. Januar wuerde UTC eine Nummer aus dem ALTEN Jahr auf
  -- einen Beleg schreiben, der das NEUE Datum traegt -- ein Bruch im
  -- Nummernkreis, den niemand mehr erklaeren kann. `now()` ist innerhalb der
  -- Transaktion stabil; der Guard setzt `document_issued_at` aus demselben
  -- `now()`, Jahr und Datum koennen also nicht auseinanderlaufen.
  -- ANNAHME, ausgesprochen: 'Europe/Berlin' ist fest verdrahtet, weil der
  -- gesamte Steuerteil des Plans (7.4) deutsches Recht abbildet. Sollte ein
  -- Mandant je in einer anderen Zeitzone bilanzieren, gehoert die Zone in
  -- `tenants.legal` -- dann ist DIESE Zeile die einzige, die sich aendert.
  v_issued_on     date := (now() at time zone 'Europe/Berlin')::date;
  v_year          int;
  v_no            int;
  v_document_no   text;
begin
  if p_payout_id is null then
    raise exception 'affiliate_payout_id_missing';
  end if;
  -- A4, erster Teil (CLAUDE.md §2.15): die Auszahlungskennung kommt aus der
  -- Oberflaeche, also vom Client. `where id = :clientId` ohne Mandantenpruefung
  -- ist genau das Muster, das §2.15 verbietet -- ein Manager des Mandanten A
  -- koennte mit einer erratenen oder abgelesenen uuid eine Auszahlung des
  -- Mandanten B freigeben und ihr eine Belegnummer AUS DESSEN Nummernkreis
  -- verbrennen. Die Server Action prueft den Mandanten ueber
  -- requireAdminTenant(); hier wird derselbe Wert mitgegeben und nachgeprueft,
  -- damit ein vergessener Filter im Aufrufer nicht reicht.
  if p_tenant_id is null then
    raise exception 'affiliate_payout_tenant_required';
  end if;
  -- A4, zweiter Teil: ohne handelnden Menschen keine Freigabe. Ein Aufruf
  -- nach der Plan-Signatur (ein Argument) landet hier und bricht sprechend
  -- ab, statt G15 stumm zu uebergehen.
  if p_actor_user_id is null then
    raise exception 'affiliate_payout_actor_required';
  end if;

  v_year := extract(year from v_issued_on)::int;

  -- --- 1. Compare-and-Swap auf den Entwurf -------------------------------
  -- `for update` sperrt den Satz fuer die gesamte Transaktion. Zwei
  -- gleichzeitige Freigaben desselben Satzes greifen damit nie beide zu: die
  -- zweite sieht nach dem Commit der ersten 'approved' und bricht ab, OHNE
  -- eine Nummer gezogen zu haben.
  -- BEIDE Bedingungen im WHERE, nicht `id` suchen und `tenant_id` danach
  -- vergleichen: eine fremde Auszahlung soll nicht einmal gesperrt werden,
  -- und die Fehlermeldung darf nicht verraten, ob es die Kennung anderswo
  -- gibt (CLAUDE.md §2.15, kein Enumerations-Leck ueber unterschiedliche
  -- Fehlertexte). "Nicht gefunden" heisst hier deshalb beides: existiert
  -- nicht ODER gehoert einem anderen Mandanten.
  select * into v_payout
    from public.affiliate_payouts p
   where p.id = p_payout_id
     and p.tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'affiliate_payout_not_found';
  end if;
  if v_payout.status <> 'draft' then
    raise exception 'affiliate_payout_not_draft';
  end if;

  -- --- 2. G15 -- kein Eigengeschaeft --------------------------------------
  -- Ein Programm-Manager darf keine Auszahlung an sich selbst freigeben.
  -- Ohne diese Regel ist die Selbst-Empfehlungssperre wirkungslos, weil
  -- derselbe Mensch ueber den Verdachtsfall entscheidet. Die Server Action
  -- prueft es zusaetzlich und schreibt den Versuch in affiliate_audit_log;
  -- hier steht die Regel, damit sie nicht an einem vergessenen Aufrufpfad
  -- haengt.
  select ap.status, ap.payout_hold, ap.user_id, ap.program_id
    into v_partner_status, v_partner_hold, v_partner_user_id, v_partner_program_id
    from public.affiliate_partners ap
   where ap.id = v_payout.partner_id and ap.tenant_id = v_payout.tenant_id;
  if not found then
    -- Der zusammengesetzte Fremdschluessel faenge das ebenfalls, aber erst am
    -- COMMIT (A1) und ohne Kennung fuer den Aufrufer.
    raise exception 'affiliate_payout_partner_tenant_mismatch';
  end if;
  if v_partner_user_id is not null and v_partner_user_id = p_actor_user_id then
    raise exception 'affiliate_payout_self_dealing_forbidden';
  end if;

  -- --- 3. Ist der Empfaenger heute noch auszahlbar? -----------------------
  -- Der Entwurf hat das geprueft (7.1), aber zwischen Entwurf und Freigabe
  -- liegt ein menschlicher Arbeitsschritt. Wird ein Partner in diesem Fenster
  -- gesperrt oder auf Auszahlungsstopp gesetzt, ist die Freigabe der letzte
  -- Moment, an dem das noch folgenlos auffallen kann -- danach ist eine
  -- Belegnummer verbraucht.
  if v_partner_status <> 'active' or v_partner_hold then
    raise exception 'affiliate_payout_partner_not_payable';
  end if;
  if v_partner_program_id <> v_payout.program_id then
    -- Die beiden zusammengesetzten Fremdschluessel binden Partner und
    -- Programm je an den Mandanten, aber nicht aneinander. Ein Satz, der
    -- einen Partner des einen Programms unter dem anderen abrechnet, waere
    -- mit falschen Konditionen belegt.
    raise exception 'affiliate_payout_program_mismatch';
  end if;
  -- Ohne Zahlweg gibt es weder Export noch Ueberweisung. Die CHECK-Bedingung
  -- der Tabelle faenge das ebenfalls -- aber erst beim UPDATE in Schritt 6,
  -- also NACHDEM die Belegnummer gezogen ist. Der Zug wuerde zwar mit
  -- zurueckgerollt (Kopf, Fall 1), die Zaehlerzeile waere aber fuer nichts
  -- gesperrt worden, und der Aufrufer bekaeme 23514 statt einer Kennung, die
  -- er dem Manager als "Zahlweg im Abrechnungsprofil fehlt" anzeigen kann.
  if v_payout.method is null then
    raise exception 'affiliate_payout_method_missing';
  end if;

  -- Plan 7.1: ohne hinterlegten Rechtstraeger ist die Auszahlung gesperrt --
  -- dieselbe Logik wie das 404-Gate im Rechtsbereich
  -- (src/app/(legal)/layout.tsx:39-41). Auf einer White-Label-Domain darf nie
  -- das Impressum des Betreibers auf einem fremden Beleg landen. Geprueft
  -- wird hier nur die MINDESTFORM (Name und mindestens eine Anschriftszeile);
  -- die vollstaendige Pruefung bleibt resolveLegalEntity()
  -- (src/lib/legal/company.ts:69-73), weil sie ein zod-Schema ist und nicht
  -- doppelt in SQL gepflegt werden soll.
  select t.slug, t.legal into v_slug, v_legal
    from public.tenants t
   where t.id = v_payout.tenant_id;
  if not found then
    raise exception 'affiliate_payout_tenant_not_found';
  end if;
  if coalesce(v_legal->'entity'->>'name', '') = ''
     or jsonb_typeof(v_legal->'entity'->'addressLines') <> 'array'
     or jsonb_array_length(v_legal->'entity'->'addressLines') = 0 then
    raise exception 'affiliate_payout_tenant_legal_entity_missing';
  end if;

  -- --- 4. Kontrollabgleich (Plan 7.6, Gleichung 1) ------------------------
  -- Ohne diesen Schritt bindet NICHTS den Belegkopf an seine Positionen: die
  -- CHECK-Bedingung `subtotal = gross + reversal` prueft nur die Zeile mit
  -- sich selbst. Eine nachtraeglich entstempelte Provisionszeile faellt sonst
  -- erst auf, wenn jemand Beleg und Buch von Hand vergleicht.
  --
  -- Zuerst SPERREN, dann rechnen -- in einer eigenen Anweisung, weil
  -- `for update` nicht mit Aggregatfunktionen zusammengeht. `order by c.id`
  -- legt eine feste Sperrreihenfolge fest. Danach kann kein gleichzeitiger
  -- Lauf die Menge unter der Rechnung wegziehen: der Entwurfs-CAS
  -- (`is('payout_id', null)`) greift ohnehin nicht mehr, und ein
  -- Entstempeln (`payout_id = null`) wartet bis zum COMMIT.
  perform c.id
     from public.affiliate_commissions c
    where c.tenant_id = v_payout.tenant_id
      and c.payout_id = v_payout.id
    order by c.id
      for no key update;

  select count(*)::int,
         coalesce(sum(c.amount_cents) filter (where c.amount_cents > 0), 0)::int,
         coalesce(sum(c.amount_cents) filter (where c.amount_cents < 0), 0)::int,
         count(*) filter (where c.status <> 'approved')::int,
         count(*) filter (where c.currency <> v_payout.currency)::int,
         count(*) filter (where c.partner_id <> v_payout.partner_id)::int,
         count(*) filter (where c.is_test)::int,
         count(*) filter (where c.flagged)::int
    into v_rows, v_gross, v_reversal,
         v_bad_status, v_bad_currency, v_bad_partner, v_bad_test, v_bad_flagged
    from public.affiliate_commissions c
   where c.tenant_id = v_payout.tenant_id
     and c.payout_id = v_payout.id;

  if v_rows = 0 then
    -- Ein Beleg ohne Positionen. Entsteht, wenn zwei Entwurfslaeufe sich
    -- ueberholt haben und der zweite nichts mehr reservieren konnte.
    raise exception 'affiliate_payout_no_rows';
  end if;
  if v_bad_status > 0 then
    -- G8: gestempelt wird nur, was 'approved' ist, und 'paid' wird eine Zeile
    -- erst NACH der Ueberweisung. Beides andere hier waere ein Bruch des
    -- Auszahlungswegs.
    raise exception 'affiliate_payout_row_status_invalid';
  end if;
  if v_bad_currency > 0 then
    -- Der Waehrungsfilter des Entwurfs (7.1) hat gefehlt. Ein gemischter Satz
    -- hat genau ein `currency`-Feld und waere damit ein falscher Beleg.
    raise exception 'affiliate_payout_row_currency_mismatch';
  end if;
  if v_bad_partner > 0 then
    raise exception 'affiliate_payout_row_partner_mismatch';
  end if;
  if v_bad_test > 0 then
    -- Plan 4.5: eine Testbuchung ist nie werthaltig.
    raise exception 'affiliate_payout_row_is_test';
  end if;
  if v_bad_flagged > 0 then
    -- Ein Verdachtsfall wird von einem Menschen entschieden, nicht
    -- mitausgezahlt.
    raise exception 'affiliate_payout_row_flagged';
  end if;
  if v_gross <> v_payout.gross_cents then
    raise exception 'affiliate_payout_gross_mismatch';
  end if;
  if v_reversal <> v_payout.reversal_cents then
    raise exception 'affiliate_payout_reversal_mismatch';
  end if;
  if v_gross + v_reversal <> v_payout.subtotal_cents then
    raise exception 'affiliate_payout_subtotal_mismatch';
  end if;

  -- --- 5. Die Belegnummer -------------------------------------------------
  -- Erst hier, nachdem alles geprueft ist: von diesem Aufruf bis zum COMMIT
  -- steht der Nummernkreis dieses Mandanten und Jahres still.
  v_no := public.next_affiliate_document_no(v_payout.tenant_id, v_year);
  -- Format 7.3: GS-<TENANT_SLUG>-<JAHR>-<6-stellig>.
  -- HINWEIS ZUM PRAEFIX: `tenants.slug` ist aenderbar. Eine Umbenennung
  -- mitten im Jahr aendert den Praefix kuenftiger Belege, waehrend der
  -- ZAEHLER weiterlaeuft -- die Nummernfolge bleibt also lueckenlos, sieht
  -- aber zweigeteilt aus. Die Lueckenlosigkeit haengt am Zaehler, nicht am
  -- Text; ein Mandant sollte trotzdem nicht mitten im Geschaeftsjahr
  -- umbenannt werden.
  v_document_no := 'GS-' || upper(v_slug) || '-' || v_year::text || '-' || lpad(v_no::text, 6, '0');

  -- --- 6. Der Statuswechsel -----------------------------------------------
  -- `approved_at` und `document_issued_at` setzt der Guard aus `now()` --
  -- derselbe Zeitpunkt, aus dem oben das Belegjahr stammt.
  update public.affiliate_payouts p
     set status      = 'approved',
         document_no = v_document_no
   where p.id = v_payout.id
     and p.status = 'draft';
  if not found then
    -- Kann nach der Sperre in Schritt 1 nicht eintreten; die Bedingung steht
    -- trotzdem im UPDATE, damit der Compare-and-Swap auch dann traegt, wenn
    -- diese Funktion je ohne die vorgelagerte Sperre aufgerufen wird.
    raise exception 'affiliate_payout_not_draft';
  end if;

  -- --- 7. G14: den Abrechnungszeitraum schliessen -------------------------
  -- `greatest()` uebergeht NULL, ein noch nie geschlossenes Programm bekommt
  -- also schlicht `period_to`. Der Riegel darf nie zurueckwandern: sonst
  -- koennte in einen Zeitraum nachgebucht werden, fuer den bereits ein Beleg
  -- mit fester Summe existiert. Der Guard von affiliate_programs laesst
  -- `service_role` hier durch (20260910120000, Abschnitt 2) -- ein Client
  -- kaeme nicht vorbei.
  update public.affiliate_programs pr
     set books_closed_until = greatest(pr.books_closed_until, v_payout.period_to)
   where pr.id = v_payout.program_id
     and pr.tenant_id = v_payout.tenant_id;

  -- Die Rueckgabe traegt alles, was der Aufrufer fuer das PDF und die
  -- Benachrichtigung braucht -- und NICHTS aus dem Abrechnungsprofil: weder
  -- IBAN noch Steuernummer noch E-Mail-Adresse (CLAUDE.md §2.11). Die
  -- Zahlungsverbindung holt der Export separat und schreibt sie in die
  -- Exportdatei, nicht in ein Protokoll.
  return jsonb_build_object(
    'payout_id',      v_payout.id,
    'tenant_id',      v_payout.tenant_id,
    'program_id',     v_payout.program_id,
    'partner_id',     v_payout.partner_id,
    'document_no',    v_document_no,
    'document_year',  v_year,
    'document_seq',   v_no,
    'document_date',  v_issued_on,
    'document_path',  v_payout.tenant_id::text || '/affiliate/payouts/' || v_payout.id::text || '.pdf',
    'period_from',    v_payout.period_from,
    'period_to',      v_payout.period_to,
    'currency',       v_payout.currency,
    'gross_cents',    v_payout.gross_cents,
    'reversal_cents', v_payout.reversal_cents,
    'subtotal_cents', v_payout.subtotal_cents,
    'tax_mode',       v_payout.tax_mode,
    'tax_rate_bp',    v_payout.tax_rate_bp,
    'tax_cents',      v_payout.tax_cents,
    'total_cents',    v_payout.total_cents,
    'method',         v_payout.method,
    'row_count',      v_rows
  );
end;
$$;


-- =================================================================
-- 6. Storage-Bucket `affiliate-documents` (Plan 10/B8, CLAUDE.md §2.5)
-- =================================================================
-- PRIVAT. Hier liegen Gutschriften mit Anschrift, Steuerstatus und Umsatz
-- eines Partners -- die Datenschutzstufe des Bucket `submissions`, nicht die
-- von `branding`.
-- Pfadkonvention: `{tenant_id}/affiliate/payouts/{payout_id}.pdf`, erzwungen
-- durch die CHECK-Bedingung auf `affiliate_payouts.document_path`
-- (Abschnitt 2.1) -- der Pfad ist aus der Zeile ERRECHENBAR und muss nirgends
-- geraten werden.
--
-- `do update` statt `do nothing`: ein bereits vorhandener Bucket bekaeme
-- sonst die Whitelist NICHT. Genau dieser Fall war der Anlass fuer
-- 20260801150100 -- fuenf Buckets liefen monatelang mit
-- `file_size_limit = NULL` und `allowed_mime_types = NULL`, weil die
-- Whitelist nur in der zod-Validierung der Upload-Route stand und der
-- tatsaechliche PUT gegen die Signed URL ungeprueft durchlief.
-- 10 MiB und ausschliesslich `application/pdf`, gleiche Werte wie beim
-- Bucket `certificates` (serverseitig erzeugte PDFs, gleiche Groessenklasse).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('affiliate-documents', 'affiliate-documents', false,
        10 * 1024 * 1024, array['application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- KEINE Lese- und keine Schreib-Policy fuer Clients -- und das ist eine
-- Entscheidung, keine Auslassung:
--   * Eine SELECT-Policy auf storage.objects ist zugleich ein LISTING-Recht
--     auf den Ordner. Genau dieses Leck wurde in diesem Repo zweimal gefunden
--     und geschlossen (20260710233735 fuer branding/course-assets,
--     20260801151000 fuer avatars). Bei Gutschriften waere die Dateiliste
--     eines Mandantenordners schon fuer sich eine Auskunft: wie viele
--     Partner ausgezahlt wurden und wann.
--   * Ein Partner hat in der Regel gar keine `memberships`-Zeile (G9);
--     `member_role()` liefert fuer ihn null. Eine Policy muesste den
--     Auszahlungssatz ueber den aus dem DATEINAMEN geparsten Schluessel
--     nachschlagen -- eine Autorisierung, die an einer Zeichenkette haengt.
--   * Gebraucht wird sie nicht: geschrieben wird unter `service_role` (das
--     umgeht RLS), und ausgeliefert wird ueber
--     src/app/api/affiliate/beleg/[id]/route.ts -- Besitzpruefung gegen
--     affiliate_payouts, dann eine kurzlebige Signed URL. Damit gibt es
--     genau einen Weg an den Beleg, und der prueft Rolle, Mandant und
--     Eigentuemerschaft (CLAUDE.md §2.15).
-- Die folgende Policy ist -- wie bei affiliate_document_counters -- die
-- auditierbare Absichtserklaerung fuer den Linter (G17). Der tatsaechliche
-- Schutz ist das Fehlen jeder erlaubenden Policy auf einem privaten Bucket.
drop policy if exists affiliate_documents_deny_all on storage.objects;
create policy affiliate_documents_deny_all on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'affiliate-documents' and false)
  with check (bucket_id = 'affiliate-documents' and false);


-- =================================================================
-- 7. Ausfuehrungsrechte
-- =================================================================
-- Beim Feuern eines Triggers prueft Postgres kein EXECUTE-Recht (das
-- geschieht beim `create trigger`); der `grant` an authenticated ist also die
-- sichere Seite. Entscheidend ist, dass `anon` AUSDRUECKLICH entfernt wird --
-- `revoke from public` allein liesse den eigenen anon-Grant stehen, den
-- Supabase ueber `alter default privileges` vergibt (nachgewiesener Fund vom
-- 07.09.2026, 20260907093000_revoke_new_rpcs_from_anon.sql:1-19). Nach JEDEM
-- kuenftigen `create or replace` dieser Funktionen erneut setzen.
revoke execute on function public.affiliate_document_counters_guard()        from public;
revoke execute on function public.affiliate_document_counters_guard()        from anon;
grant  execute on function public.affiliate_document_counters_guard()        to authenticated, service_role;

revoke execute on function public.affiliate_document_counters_delete_guard() from public;
revoke execute on function public.affiliate_document_counters_delete_guard() from anon;
grant  execute on function public.affiliate_document_counters_delete_guard() to authenticated, service_role;

revoke execute on function public.affiliate_payouts_guard()                  from public;
revoke execute on function public.affiliate_payouts_guard()                  from anon;
grant  execute on function public.affiliate_payouts_guard()                  to authenticated, service_role;

revoke execute on function public.affiliate_payouts_delete_guard()           from public;
revoke execute on function public.affiliate_payouts_delete_guard()           from anon;
grant  execute on function public.affiliate_payouts_delete_guard()           to authenticated, service_role;

-- Die beiden RPCs vergeben Belegnummern und geben Geld frei. `authenticated`
-- wird hier ZUSAETZLICH entzogen -- anders als bei den Guards, die als
-- Trigger laufen muessen. Einziger Aufrufer ist der Serverbetrieb unter
-- `service_role` (Plan 11.10): der Cron-Verarbeiter fuer den Entwurf, die
-- Server Action mit requireAdminTenant() fuer die Freigabe.
revoke execute on function public.next_affiliate_document_no(uuid, int) from public;
revoke execute on function public.next_affiliate_document_no(uuid, int) from anon;
revoke execute on function public.next_affiliate_document_no(uuid, int) from authenticated;
grant  execute on function public.next_affiliate_document_no(uuid, int) to service_role;

revoke execute on function public.approve_affiliate_payout(uuid, uuid, uuid) from public;
revoke execute on function public.approve_affiliate_payout(uuid, uuid, uuid) from anon;
revoke execute on function public.approve_affiliate_payout(uuid, uuid, uuid) from authenticated;
grant  execute on function public.approve_affiliate_payout(uuid, uuid, uuid) to service_role;
