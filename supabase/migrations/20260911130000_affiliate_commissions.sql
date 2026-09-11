-- Affiliate-Modul, Block B4 "Buchung" (PLAN_Affiliate-System.md Abschnitt
-- 10/B4, 11.09.2026). Diese Datei setzt Abschnitt 3.9
-- (affiliate_subscription_bindings), 3.10 (affiliate_events, die Outbox) und
-- 3.11 (affiliate_commissions, das Provisionsbuch) um, dazu die beiden
-- Datenbankfunktionen des Blocks: book_affiliate_commissions(jsonb) und
-- approve_due_affiliate_commissions(int).
--
-- Sie setzt VORAUS:
--   20260910120000_affiliate_core.sql   affiliate_programs, affiliate_partners,
--                                       affiliate_is_manager(),
--                                       affiliate_partner_id(),
--                                       affiliate_self_partner_id(),
--                                       orders/products `unique (id, tenant_id)`;
--   20260911120000_affiliate_tracking.sql  affiliate_referrals (Fremdschluessel
--                                       von affiliate_commissions.referral_id).
-- 20260910120100 (Einwilligung) und 20260910120200 (Betreiber-Schalter) sind
-- fachlich vorausgesetzt, strukturell hier nicht.
--
-- ANLASS
-- Ab dieser Datei steht Geld in der Datenbank. Eine Zeile in
-- affiliate_commissions ist der Beleg, aus dem spaeter eine Gutschrift mit
-- zehnjaehriger Aufbewahrungsfrist entsteht. Entsprechend ist die Tabelle
-- nicht als Arbeitsstand gebaut, sondern als Buch: Zeilen werden angehaengt,
-- nie umgeschrieben; eine Korrektur ist eine Gegenbuchung (G4/G6).
-- Gleichzeitig stellt Stripe Ereignisse mehrfach, verspaetet und in falscher
-- Reihenfolge zu. Beides zusammen ergibt die drei Tabellen dieser Datei: eine
-- Outbox, die "warten" zu einem gueltigen Zustand macht (G1), eine Bindung,
-- die eine Abo-Folgerate ueberhaupt erst zuordenbar macht (3.9), und das Buch
-- selbst.
--
-- BEFUND (lesend gegen die Live-Datenbank vklqksdiyiijzoirntyt, 11.09.2026)
--   1. KEINE Affiliate-Tabelle existiert (information_schema.tables kennt aus
--      dieser Familie nichts). B1, B2 und B3 sind geschrieben, aber NICHT
--      angewendet. Diese Datei ist die vierte unangewendete Migration der
--      Reihe und muss nach allen dreien laufen.
--   2. `public.orders` hat heute zehn Spalten und KEIN `refunded_cents`;
--      `orders.status` ist `not null` ohne die Stufe 'partially_refunded'.
--      Beides kommt aus 20260910120000 (Plan 3.0 b) und wird hier nur
--      vorausgesetzt, nicht erneut angefasst. `orders.tenant_id` haengt mit
--      `on delete cascade` an `tenants` -- das ist der Grund fuer Abweichung
--      A1 unten.
--   3. Neue Tabellen bekommen per `alter default privileges` ALLE Rechte fuer
--      anon, authenticated UND service_role
--      (`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--      authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`),
--      neue Funktionen EXECUTE fuer dieselben vier Rollen (`=X/postgres`).
--      `revoke` ist deshalb die erste Schutzschicht, nicht Zierrat; und
--      `revoke ... from public` entfernt den eigenen anon-Grant NICHT.
--   4. `service_role` traegt `rolbypassrls = true`, `authenticated` und `anon`
--      nicht. Beide RPCs dieser Datei laufen deshalb OHNE `security definer`
--      und sind ausschliesslich fuer `service_role` ausfuehrbar -- genau wie
--      affiliate_record_click() aus B3 (20260911120000:1416-1419). Eine
--      `security definer`-Funktion waere hier eine Rechteverstaerkung ohne
--      jeden Gewinn: der einzige Aufrufer hat die Rechte bereits.
--   5. Es gibt im Bestand bereits zusammengesetzte Fremdschluessel mit
--      `on delete restrict` im Mandanten-Kaskadenpfad
--      (calendar_shifts -> calendar_projects/calendar_slots, confdeltype='r',
--      nicht deferrable). Genau dieses Muster wird hier NICHT uebernommen,
--      siehe Abweichung A1.
--   6. `check_function_bodies` steht auf `on`. Alle Funktionen dieser Datei
--      sind `language plpgsql`; plpgsql loest Tabellennamen erst bei der
--      Ausfuehrung der jeweiligen Anweisung auf. Die Reihenfolge ist damit
--      frei und folgt der Lesereihenfolge: Outbox, Buch, Abo-Bindung, RPCs.
--
-- LOESUNG
-- Drei Tabellen, drei Guard-Trigger, ein Touch-Trigger, zwei RPCs -- Tabelle,
-- RLS und Policies jeweils im selben Schritt (CLAUDE.md §2.1). Alle Betraege
-- `int` in Cent, alle Saetze `int` in Basispunkten, kein `numeric`, kein Float
-- (Plan G12). `amount_cents` ist VORZEICHENBEHAFTET: eine Gegenbuchung ist
-- negativ, der Saldo ist immer eine Summe und nie ein Abgleich.
--
-- =================================================================
-- ABWEICHUNGEN VOM PLAN (jede mit Grund, keine still)
-- =================================================================
-- A1  `on delete restrict` WIRD ZU `on delete no action deferrable initially
--     deferred` -- fuer program_id, partner_id, order_id, parent_id und
--     reverses_id an affiliate_commissions und sinngemaess an
--     affiliate_subscription_bindings. Der Plan (3.9, 3.11) schreibt
--     `restrict`.
--     Was daran falsch ist: RESTRICT ist in Postgres fest NICHT aufschiebbar
--     (der RI-Trigger wird mit deferrable=false angelegt, unabhaengig von der
--     Klausel am Constraint) und feuert am Ende der ANWEISUNG, die die
--     Elternzeile loescht. Beim Loeschen eines Mandanten haengen aber MEHRERE
--     Kaskaden am selben Ereignis: tenants -> affiliate_partners,
--     tenants -> orders, tenants -> affiliate_commissions. Die Reihenfolge, in
--     der sie feuern, ist die alphabetische Reihenfolge der intern vergebenen
--     RI-Triggernamen ("RI_ConstraintTrigger_a_<oid>") -- also praktisch
--     zufaellig. Feuert die Partner-Kaskade vor der Provisions-Kaskade, prueft
--     RESTRICT, waehrend die Provisionszeilen noch stehen, und die gesamte
--     Mandantenloeschung bricht mit 23503 ab. Das ist dieselbe Fehlerklasse,
--     die in 20260910120000 dreimal an Guards gefunden wurde ("ein Guard im
--     Kaskadenpfad blockiert die Mandantenloeschung"), nur diesmal als
--     Fremdschluessel.
--     Warum `no action deferrable initially deferred` richtig ist: die
--     Pruefung ist inhaltlich dieselbe ("es darf keine verweisende Zeile mehr
--     geben"), sie laeuft nur beim COMMIT statt am Anweisungsende. Ein
--     direktes `delete from affiliate_partners` scheitert also weiterhin --
--     zusaetzlich faengt es schon vorher der DELETE-Guard aus
--     20260910120000 ab, der ausdruecklich auf affiliate_commissions prueft
--     ('affiliate_partner_has_commissions'). Eine vollstaendige Kaskade
--     dagegen ist beim COMMIT in sich stimmig und geht durch.
--     Was es NICHT bedeutet: eine Aufweichung. Wer in EINER Transaktion erst
--     die Provisionszeilen und dann den Partner loescht, kommt durch -- das
--     konnte `service_role` aber ohnehin, weil das Buch keine DELETE-Sperre
--     gegen `service_role` hat (Plan 3.11, bewusst kein DELETE-Trigger).
-- A2  `on delete set null` BEKOMMT EINE SPALTENLISTE. Der Plan (3.11)
--     schreibt fuer product_id und referral_id `on delete set null` ohne
--     Liste. Bei einem ZUSAMMENGESETZTEN Fremdschluessel nullt Postgres dann
--     ALLE referenzierenden Spalten -- also auch `tenant_id`, die `not null`
--     ist. Das Loeschen eines Produkts bzw. der Loeschlauf auf
--     affiliate_referrals braeche mit 23502 ab. Hier steht deshalb
--     `on delete set null (product_id)` bzw. `(referral_id)`, wie in B3
--     (Abweichung A1 dort) bereits entschieden.
-- A3  SPALTENRECHT AUF affiliate_commissions. Der Plan (3.11) gibt
--     `grant select on public.affiliate_commissions to authenticated` und
--     verlaesst sich fuer die Kaeuferdatengrenze allein darauf, dass ein
--     Partner `orders` nicht lesen darf. Das stimmt fuer die Bestellzeile,
--     nicht aber fuer die IDENTIFIKATOREN, die in dieser Tabelle selbst
--     stehen: `order_id`, `stripe_invoice_id`, `stripe_subscription_id`,
--     `stripe_charge_id` -- und, das ist der unauffaelligste Weg, `dedup_key`,
--     der genau diese Kennungen IM KLARTEXT traegt ('sale:<order_id>',
--     'recurring:<stripe_invoice_id>'). Ein Partner haette damit eine
--     vollstaendige, exportierbare Liste der Bestell- und Rechnungskennungen
--     seiner Kaeufer, mit Zeitstempel und Betrag. Das ist keine Bestellzeile,
--     aber es ist ein Personenbezug (Art. 4 Nr. 1 DSGVO: einzeln
--     herausgegriffene Vorgaenge einer Person) und es ist genau das, was
--     Plan 11.15 ausschliesst. Diese sechs Spalten stehen deshalb NICHT im
--     Grant; dazu `flag_reason` und `note`, die Managertexte tragen koennen
--     (Vorbild: `payout_hold_reason` an affiliate_partners, B1). Siehe
--     Abschnitt 2.5 fuer die vollstaendige Liste und die Folge fuer den
--     Anwendungscode.
-- A4  ZUSAETZLICHE CHECK-CONSTRAINTS gegenueber dem Plan, alle aus Saetzen des
--     Plans abgeleitet, die dort nur im Fliesstext stehen:
--       * `is_test = false or status = 'cancelled'`  (Plan 4.5: eine
--         Testbuchung entsteht, ist aber nie werthaltig);
--       * `cancel_reason is null or status = 'cancelled'`;
--       * `payout_id is null or status in ('approved','paid')`  (G8);
--       * `(status = 'paid') = (paid_at is not null)` und
--         `status <> 'paid' or payout_id is not null`  (G8);
--       * `amount_cents >= 0 or kind in ('reversal','manual')`;
--       * `currency ~ '^[a-z]{3}$'` (Plan 5.11 kennt mehrere Waehrungen, aber
--         keine Umrechnung -- geprueft wird die Form, nicht der Wert);
--       * `campaign ~ '^[A-Za-z0-9_.-]{1,64}$'` (identisch zu
--         AFFILIATE_CAMPAIGN_PATTERN, src/lib/affiliate/schema.ts:56, und zu
--         affiliate_referrals.campaign aus B3);
--       * `dedup_key <> '' and length(dedup_key) <= 200`.
--     Warum als CHECK und nicht im Guard: ein CHECK steht im Schema und ist
--     fuer jeden lesbar, der spaeter eine zweite Schreibstelle baut.
-- A5  ZUSAETZLICHE FREMDSCHLUESSEL-INDIZES und ein praeziserer Freigabe-Index.
--     Der Plan nennt zehn Indizes; `(program_id, tenant_id)` fehlt darin,
--     obwohl der Fremdschluessel existiert (Performance-Advisor
--     `unindexed_foreign_keys`, Vorbild 20260807142948:8-15). Der Index
--     affiliate_commissions_due_idx bekommt zusaetzlich `is_test = false` ins
--     Praedikat, weil der Freigabelauf (6.4) genau danach filtert -- sonst
--     liest er Testzeilen mit, die er nie freigibt.
-- A6  G14 (`books_closed_until`) WIRD IM GUARD DURCHGESETZT, nicht in der
--     Buchungs-RPC. Der Plan beschreibt die Regel als Verhalten der RPC. Es
--     gibt aber mehr als eine Schreibstelle: die RPC dieser Datei, die
--     Storno-RPC aus B5 und die Handbuchung aus B6. Eine Regel, die in der
--     Datenbank steht, aber nur in einem von drei Pfaden greift, ist keine
--     Regel. Im BEFORE-INSERT-Guard greift sie in allen dreien, und die RPC
--     bleibt frei davon.
-- A7  ZUSAETZLICHE FREMDSCHLUESSEL AN affiliate_subscription_bindings. Der
--     Plan (3.9) deklariert nur `(partner_id, tenant_id)`. `program_id`,
--     `referral_id` und `origin_commission_id` stehen dort als blanke uuid --
--     ohne zusammengesetzten Fremdschluessel ist damit eine
--     mandantenuebergreifende Bindung einfuegbar, und genau diese Pruefung ist
--     seit 20260807142619:46-49 fuer jede Kindtabelle verbindlich.
-- A8  KEIN `unique (id, tenant_id)` an affiliate_events und
--     affiliate_subscription_bindings -- beide haben keine `id`-Spalte bzw.
--     werden von keiner Kindtabelle ueber ein Paar referenziert.
--     affiliate_subscription_bindings ist ueber `stripe_subscription_id`
--     geschluesselt (Stripe-IDs sind global eindeutig), affiliate_events ueber
--     `id` plus `unique (stripe_event_id)`.
-- A9  STATUSUEBERGAENGE UND DIE AUSNAHME VON G4 STEHEN IM GUARD, nicht nur im
--     Anwendungscode. Der Plan gibt in 6.3 eine Uebergangstabelle an, setzt
--     sie aber nirgends in der Datenbank durch; der Guard aus 3.11 nagelt nur
--     Spalten fest und laesst `status` voellig frei. Damit waere
--     'paid' -> 'pending' moeglich, und "Es gibt keinen Rueckweg von paid"
--     (6.3) waere eine Absichtserklaerung statt einer Eigenschaft. Siehe
--     Abschnitt 2.3.
-- A10 RLS UND POLICY FUER affiliate_subscription_bindings ERGAENZT. Plan 3.9
--     zeigt fuer diese Tabelle `create table` und einen Index -- und sonst
--     nichts: kein `enable row level security`, kein `revoke`, keine Policy.
--     Das ist eine Luecke im Plan, keine Entscheidung des Plans: CLAUDE.md
--     §2.1 laesst fuer eine neue Tabelle keine Ausnahme zu, und Plan 11.1
--     zaehlt die beiden bewussten Deny-Ausnahmen namentlich auf
--     (affiliate_events, affiliate_document_counters) -- diese Tabelle steht
--     nicht darunter. Sie bekommt deshalb RLS, `revoke all`, genau eine
--     SELECT-Policy (nur Manager, Begruendung in Abschnitt 3) und die
--     Deny-Write-Policy. Ohne diesen Zusatz waere die Tabelle mit dem
--     `alter default privileges`-Grant aus Befund 3 fuer jeden angemeldeten
--     Nutzer JEDES Mandanten lesbar -- eine Liste laufender Abonnements samt
--     Stripe-Kennung, also ein mandantenuebergreifender Kundenbestand.
--
-- =================================================================
-- DIE AUSNAHME VON DER UNVERAENDERLICHKEIT, UND WARUM SIE SICHER IST
-- =================================================================
-- G4 sagt: eine Provisionszeile ist unveraenderlich, auch fuer `service_role`,
-- und eine Korrektur ist ausschliesslich eine Gegenbuchung. Der Guard setzt
-- das um, indem er bei JEDEM Update jede Spalte des Rechenwegs und der
-- Herkunft auf `old` zuruecksetzt -- ohne Rollen-Erlaubnisliste. Genau eine
-- Gruppe von Spalten bleibt aenderbar, weil sie den BELEG nicht beruehrt,
-- sondern seinen LEBENSLAUF: status, cancel_reason, payout_id, paid_at,
-- flagged, flag_reason, note, updated_at.
--
-- Warum das sicher ist -- drei Eigenschaften, und jede einzelne wird vom Guard
-- durchgesetzt, nicht nur behauptet:
--   (1) KEIN BETRAG AENDERT SICH. amount_cents, base_cents, rate_bp,
--       fixed_cents, basis_kind, rate_kind, currency, condition_snapshot und
--       booked_at sind festgenagelt. Was eine Gutschrift ausweist, kann sich
--       also nicht mehr bewegen -- egal in welchen Status die Zeile geraet.
--       Der Statuswechsel verschiebt nur, in WELCHEM Saldo-Eimer der bereits
--       feststehende Betrag steht (5.10).
--   (2) DIE RICHTUNG IST EINSEITIG. Erlaubt sind ausschliesslich die Kanten
--       aus 6.3: pending -> on_hold/approved/cancelled, on_hold ->
--       approved/cancelled, approved -> paid. 'paid' und 'cancelled' sind
--       Endzustaende; es gibt keine Kante zurueck. Eine irrtuemlich als
--       ausgezahlt markierte Zeile ist damit nicht "reparierbar" -- sie
--       verlangt eine Gegenbuchung, und genau das ist gewollt.
--   (3) DAS STEMPELN VON payout_id IST FOLGENLOS UND UMKEHRBAR, SOLANGE
--       NICHT UEBERWIESEN IST. Der Entwurf (G8) setzt payout_id, laesst den
--       Status aber auf 'approved'. Der Guard erlaubt eine Aenderung von
--       payout_id NUR, wenn die Zeile vor UND nach dem Update 'approved' ist
--       -- also nie im selben Schritt wie der Wechsel nach 'paid', und nie
--       mehr, nachdem 'paid' erreicht ist. Ein verworfener Entwurf setzt
--       payout_id zurueck auf null, die Zeile faellt in "verfuegbar" zurueck,
--       und niemand hat Geld gesehen. Erst der zweite, getrennte Schritt --
--       Compare-and-Swap auf status='approved' nach dem Bankabgleich -- macht
--       aus dem Stempel eine Zahlung; `paid_at` setzt dabei die DATENBANK mit
--       now(), nicht der Aufrufer.
-- Zusaetzlich gilt G15 auch hier: wer selbst Partner dieses Mandanten ist,
-- kann an SEINEN EIGENEN Zeilen keine dieser Spalten aendern -- nicht den
-- Status, nicht das Flag, nicht die Auszahlung. Die Pruefung haengt an der
-- Person (affiliate_self_partner_id(), ohne Statusfilter), nicht an der
-- Rolle; fuer `service_role` (auth.uid() ist null) greift sie nicht, und das
-- ist richtig: der Cron ist kein Mensch mit Interessenkonflikt.
--
-- WAS BEWUSST FEHLT: kein `before delete`-Trigger und keine `rule`. Eine Rule
-- griffe beim Kaskadenloeschen eines Mandanten still und hinterliesse
-- Geldzeilen mit einer tenant_id auf einen geloeschten Mandanten; ein
-- werfender DELETE-Trigger blockierte die Mandantenloeschung ganz. Der Schutz
-- ist `revoke all` plus das Fehlen jeder DELETE-Policy -- ein Client kommt
-- nie durch, `service_role` und die Kaskade kommen durch (Plan 3.11
-- woertlich). Wer spaeter eine Datenkorrektur per Migration braucht, muss den
-- Guard bewusst abschalten (`alter table ... disable trigger
-- affiliate_commissions_guard_trg`) -- das ist keine Luecke, sondern die
-- verlangte Huerde.
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
-- affiliate_events ist die einzige reine Deny-Tabelle dieser Datei (Plan 11.1
-- nennt sie ausdruecklich, Vorbild 20260803100200_marketplace_ledger.sql:8-15).
--
-- =================================================================
-- FOLGEN FUER DEN ANWENDUNGSCODE (B4 und spaeter)
-- =================================================================
--   (1) `select('*')` bricht auf affiliate_commissions mit 42501 ab -- die
--       Tabelle traegt ein SPALTENrecht, kein Tabellenrecht (A3). Jede
--       Abfrage mit Session-Client MUSS ihre Spalten benennen. Nicht
--       enthalten und daher fuer `authenticated` ueberhaupt nicht lesbar:
--       order_id, stripe_invoice_id, stripe_subscription_id, stripe_charge_id,
--       dedup_key, note, flag_reason. Die Admin-Oberflaeche (B6) und der
--       Partnerbereich (B7) laden diese Spalten ueber eine Server-Route mit
--       vorgelagerter Rollenpruefung und createAdminClient() -- und liefern je
--       Rolle unterschiedlich viel aus. Dieselbe Falle wie bei
--       affiliate_partners/-billing_profiles/-conditions (B1) und
--       affiliate_clicks/-referrals (B3).
--   (2) Gebucht wird AUSSCHLIESSLICH ueber book_affiliate_commissions(jsonb)
--       (Abschnitt 4). Ein direkter Insert aus TypeScript waere kein Fehler
--       der Rechte, sondern der Atomaritaet: eine Bestellung erzeugt bis zu
--       drei Zeilen (sale, reserve, tier2), und eine halb gebuchte Bestellung
--       ist ein Geldfehler, den niemand mehr sieht. Die RPC schreibt alle
--       Zeilen in EINER Transaktion oder keine.
--   (3) Der Freigabelauf ist approve_due_affiliate_commissions(int)
--       (Abschnitt 5) und gehoert als Schritt 2 in den Verarbeiter
--       (Plan 6.5). Er gibt die freigegebenen Zeilen zurueck, damit der
--       Verarbeiter die Benachrichtigungen daraus baut.
--   (4) `affiliate_events.last_error` ist eine DAUERHAFT gespeicherte
--       Fehlerzeichenkette. Sie muss durch redactAffiliateError() laufen,
--       bevor sie hier landet (Plan 11.11, CLAUDE.md §2.11) -- sonst stehen
--       Referral-Token, Stripe-IDs oder E-Mail-Adressen im Klartext in einer
--       Tabelle, die kein Loeschkonzept hat. Die Datenbank kann das nicht
--       pruefen; es ist eine Pflicht des Aufrufers.
--   (5) `affiliate_events.payload` enthaelt ausschliesslich die fuer die
--       Rechnung noetigen Felder (Plan 3.10 zaehlt sie auf), NIE das volle
--       Stripe-Objekt -- sonst liegen Kundenname, Anschrift und Steuer-ID
--       dauerhaft in einer zweiten Tabelle ohne eigenen Loeschgrund. Auch das
--       kann die Datenbank nicht pruefen.
--   (6) Der Abo-Zaehler wird NIE gelesen-und-dann-geschrieben. Das bedingte
--       Statement aus Plan 3.9 ist die einzige erlaubte Form; der Guard
--       erzwingt zusaetzlich, dass periods_booked nur steigen kann.
--
-- =================================================================
-- DIESE MIGRATION IST NICHT ANGEWENDET
-- =================================================================
-- Sie wurde in dieser Umgebung auch nicht probeweise gefahren -- es gibt kein
-- lokales Postgres, keinen Docker und keine supabase/config.toml (Plan 12.7).
-- Das Anwenden bleibt Josip vorbehalten (CLAUDE.md §4.6); der Dateiname traegt
-- bis dahin einen Platzhalter-Zeitstempel, weil `apply_migration` die Version
-- nach Ausfuehrungszeitpunkt vergibt. Reihenfolge: 20260910120000, dann
-- 20260910120100, dann 20260910120200, dann 20260911120000, dann DIESE.
-- Danach `get_advisors(security)` UND `get_advisors(performance)` laufen
-- lassen.
-- ERWARTUNG FUER DIESEN LAUF, damit niemand sie fuer eine Regression haelt:
--   * KEIN neuer Treffer der Klassen
--     `anon_security_definer_function_executable` und
--     `authenticated_security_definer_function_executable`: diese Datei legt
--     KEINE einzige SECURITY-DEFINER-Funktion an.
--   * KEIN neuer `rls_enabled_no_policy`: affiliate_commissions und
--     affiliate_subscription_bindings bekommen eine echte SELECT-Policy,
--     affiliate_events die ausdrueckliche Deny-Policy.
--   * Der Performance-Advisor kann `unused_index` fuer die neuen Indizes
--     melden, solange keine Buchung existiert. Das ist direkt nach dem
--     Anwenden erwartbar und kein Grund, einen FK-Index zu streichen -- er
--     traegt die Kaskade, nicht eine Abfrage.
--   * MOEGLICH ist ein Hinweis auf die aufschiebbaren Fremdschluessel (A1).
--     Er ist beabsichtigt und oben begruendet.
--
-- WIEDERHOLBARKEIT: wie in B1 und B3 bewusst NICHT nachgeruestet. `create
-- table if not exists` wuerde eine bestehende, inhaltlich abweichende Tabelle
-- stillschweigend durchwinken -- ein sauberer Abbruch mit 42P07 ist die
-- ehrlichere Auskunft. Vor jedem `create trigger` steht trotzdem ein
-- `drop trigger if exists`, weil die Trigger an `create or replace`-Funktionen
-- haengen.


-- =================================================================
-- 1. affiliate_events (Plan 3.10) -- die Outbox
-- =================================================================
-- Aufnahmepuffer fuer jedes Stripe-Ereignis mit Affiliate-Relevanz. Der
-- Webhook tut fuer Affiliate genau eine Sache: er schreibt hier eine Zeile
-- (G1). Die gesamte Provisionslogik laeuft danach im Cron-Verarbeiter. Damit
-- kann ein Fehler in der Affiliate-Logik die Kauferfuellung strukturell nicht
-- brechen, ein fehlgeschlagenes Geldereignis bleibt mit attempts/last_error
-- SICHTBAR liegen statt still zu verschwinden, und "warten" wird ein gueltiger
-- Zustand fuer Ereignisse, die Stripe ausser der Reihe zustellt
-- (`invoice.paid` vor `checkout.session.completed`).

create table public.affiliate_events (
  id                     uuid primary key default gen_random_uuid(),

  -- Die einzige Idempotenzquelle der AUFNAHME. Stripe stellt "at least once"
  -- zu; ein Retry laeuft hier in 23505, und genau diesen einen Fehlercode
  -- schluckt recordAffiliateEvent() (G2). Jeder andere Fehler wirft, der
  -- Webhook antwortet 500, Stripe stellt erneut zu -- der Kaeufer hat seinen
  -- Zugriff zu diesem Zeitpunkt bereits, weil die Aufnahme NACH
  -- enrollFromProduct() laeuft.
  stripe_event_id        text not null unique,
  event_type             text not null,

  -- AUSDRUECKLICH NULLABLE. Fuer charge.refunded und die drei
  -- Dispute-Ereignisse ist der Mandant zum Aufnahmezeitpunkt nicht bekannt:
  -- ein Stripe.Charge traegt keine Session-Metadata. Die Aufloesung
  -- (charge.payment_intent -> orders.stripe_payment_intent, bzw.
  -- charge.invoice -> affiliate_commissions.stripe_invoice_id) ist Aufgabe des
  -- Verarbeiters -- genau die Arbeit, die die Outbox aus dem Webhook
  -- heraushalten soll. Ein `not null` liesse die Aufnahme genau der
  -- Ereignisse scheitern, fuer die die Outbox gebaut wurde.
  tenant_id              uuid references public.tenants(id) on delete cascade,

  -- BEWUSST OHNE Fremdschluessel auf orders: die Bestellung kann zum
  -- Aufnahmezeitpunkt noch fehlen (Reihenfolge), und ein Fremdschluessel
  -- machte die Aufnahme von der Aufloesung abhaengig -- wieder genau das,
  -- was die Outbox vermeidet.
  order_id               uuid,
  stripe_invoice_id      text,
  stripe_subscription_id text,
  stripe_charge_id       text,
  stripe_payment_intent  text,

  -- Momentaufnahme aus der Stripe-Metadata. Opak und ohne DB-Zugriff wertlos,
  -- aber ein Inhaber-Geheimnis (Plan 11.13): diese Tabelle ist deshalb fuer
  -- anon und authenticated vollstaendig gesperrt.
  referral_token         text,

  -- NUR die fuer die Rechnung noetigen Felder (Plan 3.10), nie das volle
  -- Stripe-Objekt. Die Datenbank kann das nicht erzwingen -- siehe "Folgen
  -- fuer den Anwendungscode" (5).
  payload                jsonb not null default '{}'::jsonb,

  -- STRIPE-Zeit, nicht Verarbeitungszeit: bei einem Retry nach drei Tagen darf
  -- sich die Sperrfrist nicht verschieben, und der Satz wird zu
  -- `occurred_at` aufgeloest, nicht zu now() (Plan 5.2).
  occurred_at            timestamptz not null,

  status                 text not null default 'pending'
                           check (status in ('pending','done','skipped','error')),
  attempts               int  not null default 0 check (attempts >= 0),

  -- Redigiert, siehe Plan 11.11 und "Folgen fuer den Anwendungscode" (4).
  last_error             text,
  created_at             timestamptz not null default now(),
  processed_at           timestamptz
);

-- Die Warteschlange des Verarbeiters: aelteste zuerst, nur offene Zeilen.
create index affiliate_events_queue_idx on public.affiliate_events (status, created_at)
  where status in ('pending','error');
-- Traegt zugleich den Fremdschluessel auf tenants (Kaskade) und die
-- Admin-Ansicht "Nicht verarbeitete Zahlungsereignisse".
create index affiliate_events_tenant_idx on public.affiliate_events (tenant_id, created_at desc);
-- Die Bruecke von einer Erstattung zur Bestellung laeuft ueber den Charge.
create index affiliate_events_charge_idx on public.affiliate_events (stripe_charge_id)
  where stripe_charge_id is not null;

-- Leichter Guard. Die Tabelle ist eine Warteschlange und kein Buch: status,
-- attempts, last_error, processed_at und die nachgetragenen Kennungen sind
-- Arbeitsstand und bleiben frei. Festgenagelt wird nur, was das Ereignis
-- AUSMACHT -- sonst liesse sich nachtraeglich behaupten, Stripe habe etwas
-- anderes geschickt.
-- OHNE `security definer`: der Guard braucht `current_user`. Unter
-- `security definer` waere das immer der Eigentuemer und die Erlaubnisliste
-- damit wirkungslos (empirisch belegt in 20260909183548:70-75).
create or replace function public.affiliate_events_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- INSERT GANZ VORN: beim INSERT ist OLD nicht zugewiesen, jeder `old.`-
  -- Zugriff waere ein Laufzeitfehler. (Lehre aus 20260910120000, B12.)
  if tg_op = 'INSERT' then
    -- Zeitstempel der Aufnahme gehoert der Datenbank, nicht dem Aufrufer.
    new.created_at := now();
    -- Eine Zeile wird nie als "schon verarbeitet" geboren.
    new.attempts     := 0;
    new.processed_at := null;
    if new.status <> 'pending' then
      raise exception 'affiliate_event_insert_must_be_pending';
    end if;
    return new;
  end if;

  -- UPDATE. Erlaubnisliste (keine Sperrliste) plus die HERKUNFT der
  -- Anweisung; eine kuenftige, hier unbekannte Rolle faellt in den
  -- geschuetzten Zweig statt still durchzurutschen.
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- Das Ereignis selbst ist unveraenderlich.
  new.id              := old.id;
  new.stripe_event_id := old.stripe_event_id;
  new.event_type      := old.event_type;
  new.payload         := old.payload;
  new.occurred_at     := old.occurred_at;
  new.created_at      := old.created_at;

  -- tenant_id darf EINMAL nachgetragen werden (das ist die Aufgabe des
  -- Verarbeiters, Plan 6.5 Schritt 1b), danach nicht mehr umgehaengt werden.
  -- Ohne diese Richtung koennte ein Ereignis nachtraeglich einem anderen
  -- Mandanten zugeschlagen werden.
  if old.tenant_id is not null then
    new.tenant_id := old.tenant_id;
  end if;

  return new;
end;
$$;

drop trigger if exists affiliate_events_guard_trg on public.affiliate_events;
create trigger affiliate_events_guard_trg before insert or update on public.affiliate_events
  for each row execute function public.affiliate_events_guard();

alter table public.affiliate_events enable row level security;
revoke all on public.affiliate_events from anon, authenticated;

-- REINE DENY-TABELLE (Plan 11.1 nennt sie ausdruecklich als Ausnahme von
-- "jede Tabelle bekommt eine echte SELECT-Policy"). Zugriff ausschliesslich
-- ueber `service_role`; die Admin-Ansicht "Nicht verarbeitete
-- Zahlungsereignisse (n)" laeuft ueber eine Server-Route mit
-- requireAdminTenant() und createAdminClient(). Grund: die Zeile traegt
-- `referral_token` (Inhaber-Geheimnis), `payload` (Stripe-Rohfelder) und
-- `last_error` -- nichts davon gehoert in einen Browser, auch nicht in den
-- eines Mandanten-Admins. Vorbild 20260803100200_marketplace_ledger.sql:8-15.
-- Die Policy ist die auditierbare Absichtserklaerung fuer den Linter; der
-- tatsaechliche Schutz ist das `revoke all` darueber.
create policy affiliate_events_deny_all on public.affiliate_events
  for all to anon, authenticated using (false) with check (false);


-- =================================================================
-- 2. affiliate_commissions (Plan 3.11) -- das Provisionsbuch
-- =================================================================
-- Jede Geldbewegung des Moduls als unveraenderliche, chronologische Zeile; der
-- Saldo ist immer eine Summe, nie ein Abgleich.

-- --- 2.1 Tabelle -------------------------------------------------
create table public.affiliate_commissions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  program_id    uuid not null,
  partner_id    uuid not null,

  -- G5: der Sicherheitseinbehalt ist eine eigene physische Zeile
  -- ('reserve'/'recurring_reserve'), kein Attribut. Mit einem
  -- reserve_cents-Attribut wiche der angezeigte Saldo zwangslaeufig vom
  -- Auszahlungslauf ab -- der Lauf sammelt eine Zeile entweder ganz oder gar
  -- nicht ein, waehrend die Saldoformel einen Teilbetrag auswiese.
  kind text not null check (kind in
    ('sale','reserve','recurring','recurring_reserve','tier2','reversal','recredit','manual')),

  -- Herkunft
  order_id               uuid,
  stripe_invoice_id      text,
  stripe_subscription_id text,
  stripe_charge_id       text,
  product_id             uuid,
  campaign               text check (campaign is null or campaign ~ '^[A-Za-z0-9_.-]{1,64}$'),
  referral_id            uuid,
  parent_id              uuid,            -- tier2/reserve -> die sale-Zeile
  reverses_id            uuid,            -- reversal -> die stornierte Zeile,
                                          -- recredit -> die reversal-Zeile

  -- Eingefrorener Rechenweg. Diese Spalten sind der Beleg: aus ihnen muss der
  -- Betrag zehn Jahre spaeter nachrechenbar sein, ohne dass irgendeine
  -- Konfigurationszeile von heute dafuer gebraucht wird.
  base_cents        int  not null,
  basis_kind        text not null check (basis_kind in ('net','gross')),
  rate_kind         text not null check (rate_kind in ('percent','fixed')),
  rate_bp           int  not null default 0 check (rate_bp between 0 and 10000),
  fixed_cents       int  not null default 0,
  -- VORZEICHENBEHAFTET: reversal ist negativ, recredit positiv.
  amount_cents      int  not null,
  currency          text not null default 'eur'
                      check (currency ~ '^[a-z]{3}$'),
  condition_id      uuid,
  condition_snapshot jsonb not null default '{}'::jsonb,

  status text not null default 'pending'
           check (status in ('pending','on_hold','approved','paid','cancelled')),
  cancel_reason text check (cancel_reason in
    ('self_referral','test_order','zero_amount','fraud_suspicion','manual','reassigned')),
  hold_until timestamptz not null,
  booked_at  date not null default current_date,   -- Abrechnungsperiode (G14)
  -- KEIN Fremdschluessel: affiliate_payouts entsteht erst mit Block B8. Er
  -- wird dort nachgetragen; bis dahin traegt der Guard die Regel (G8).
  payout_id  uuid,
  paid_at    timestamptz,
  flagged    boolean not null default false,
  flag_reason text,
  -- Plan 4.5: existiert von Anfang an, weil sich verfaelschte Kennzahlen
  -- nachtraeglich nicht mehr sauber bereinigen lassen. In allen Salden,
  -- Auszahlungslaeufen und Aggregaten per `where is_test = false`
  -- ausgeschlossen -- und zusaetzlich schon hier wertlos gestellt, siehe
  -- CHECK unten.
  is_test    boolean not null default false,
  note       text,
  -- G3: die EINZIGE Idempotenzachse des Moduls. Ein einziger Textschluessel
  -- statt partieller Unique-Indizes, weil partielle Indizes auf
  -- (order_id, partner_id, kind) Gegenbuchungen, Wiedergutschriften und
  -- Handbuchungen ungeschuetzt liessen -- genau die Zeilen, bei denen eine
  -- Doppelbuchung Geld kostet.
  dedup_key  text not null check (dedup_key <> '' and length(dedup_key) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, dedup_key),
  unique (id, tenant_id),

  check (kind <> 'manual'   or note is not null),
  check (kind <> 'reversal' or (reverses_id is not null and amount_cents < 0 and note is not null)),
  check (kind <> 'recredit' or (reverses_id is not null and amount_cents > 0)),
  check (kind not in ('tier2','reserve','recurring_reserve') or parent_id is not null),
  -- A4: ein negativer Betrag ist eine Gegenbuchung oder eine Handkorrektur.
  -- Eine 'sale'-Zeile mit negativem Betrag waere ein Rechenfehler, der sich
  -- als Guthaben tarnt.
  check (amount_cents >= 0 or kind in ('reversal','manual')),
  -- A4 / Plan 4.5: eine Testbuchung ENTSTEHT (der Partner soll sehen, dass die
  -- Zuordnung funktioniert), ist aber nie werthaltig.
  check (is_test = false or status = 'cancelled'),
  check (cancel_reason is null or status = 'cancelled'),
  -- A4 / G8: ein Auszahlungsstempel existiert nur an einer freigegebenen oder
  -- bereits ueberwiesenen Zeile.
  check (payout_id is null or status in ('approved','paid')),
  check ((status = 'paid') = (paid_at is not null)),
  check (status <> 'paid' or payout_id is not null),

  -- A1: `no action deferrable initially deferred` statt `restrict`. Inhaltlich
  -- dieselbe Sperre, aber am COMMIT statt am Anweisungsende geprueft -- sonst
  -- bricht die Mandantenloeschung je nach Reihenfolge der RI-Trigger ab.
  -- Begruendung ausfuehrlich im Kopf.
  constraint affiliate_commissions_program_fk
    foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id)
    on delete no action deferrable initially deferred,
  constraint affiliate_commissions_partner_fk
    foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id)
    on delete no action deferrable initially deferred,
  -- `order_id` ist bewusst NICHT `set null`: verloere eine Geldzeile ihren
  -- Bezug, waehrend ihr dedup_key die alte order_id weiter im Klartext traegt,
  -- kollidierte eine spaetere Neubuchung derselben Bestellung mit einem
  -- Schluessel, dessen Zeile nicht mehr auffindbar ist. Fuer die
  -- DSGVO-Loeschung gibt es Anonymisierung (Plan 7.8), nicht
  -- Kaskadenloeschung.
  constraint affiliate_commissions_order_fk
    foreign key (order_id, tenant_id) references public.orders (id, tenant_id)
    on delete no action deferrable initially deferred,
  constraint affiliate_commissions_parent_fk
    foreign key (parent_id, tenant_id) references public.affiliate_commissions (id, tenant_id)
    on delete no action deferrable initially deferred,
  constraint affiliate_commissions_reverses_fk
    foreign key (reverses_id, tenant_id) references public.affiliate_commissions (id, tenant_id)
    on delete no action deferrable initially deferred,
  -- A2: MIT Spaltenliste. Ohne sie nullt Postgres beim zusammengesetzten
  -- SET NULL auch `tenant_id` (not null) und das Loeschen eines Produkts bzw.
  -- der Referral-Loeschlauf braeche mit 23502 ab.
  constraint affiliate_commissions_product_fk
    foreign key (product_id, tenant_id) references public.products (id, tenant_id)
    on delete set null (product_id),
  constraint affiliate_commissions_referral_fk
    foreign key (referral_id, tenant_id) references public.affiliate_referrals (id, tenant_id)
    on delete set null (referral_id)
);

-- --- 2.2 Indizes -------------------------------------------------
-- Die Saldenabfrage je (partner_id, currency) und Status (Plan 5.10) sowie der
-- Fremdschluessel auf affiliate_partners.
create index affiliate_commissions_partner_idx
  on public.affiliate_commissions (partner_id, tenant_id, status, currency, hold_until);
-- Der Freigabelauf (6.4). A5: `is_test = false` gehoert ins Praedikat, weil
-- der Lauf genau danach filtert -- sonst liest er Testzeilen mit, die er nie
-- freigibt.
create index affiliate_commissions_due_idx on public.affiliate_commissions (hold_until)
  where status = 'pending' and flagged = false and is_test = false;
create index affiliate_commissions_payout_idx   on public.affiliate_commissions (payout_id, tenant_id);
create index affiliate_commissions_order_idx    on public.affiliate_commissions (order_id, tenant_id);
create index affiliate_commissions_parent_idx   on public.affiliate_commissions (parent_id, tenant_id);
create index affiliate_commissions_reverses_idx on public.affiliate_commissions (reverses_id, tenant_id);
create index affiliate_commissions_product_idx  on public.affiliate_commissions (product_id, tenant_id);
create index affiliate_commissions_referral_idx on public.affiliate_commissions (referral_id, tenant_id);
-- A5: fehlt im Plan, traegt aber den Fremdschluessel auf affiliate_programs
-- (Advisor `unindexed_foreign_keys`).
create index affiliate_commissions_program_idx  on public.affiliate_commissions (program_id, tenant_id);
-- Die beiden Bruecken des Verarbeiters: von einer Rechnung bzw. einem Abo
-- zurueck ins Buch.
create index affiliate_commissions_sub_idx on public.affiliate_commissions
  (tenant_id, stripe_subscription_id) where stripe_subscription_id is not null;
create index affiliate_commissions_invoice_idx on public.affiliate_commissions
  (tenant_id, stripe_invoice_id) where stripe_invoice_id is not null;
-- Traegt zugleich den Fremdschluessel auf tenants (Kaskade).
create index affiliate_commissions_tenant_created_idx
  on public.affiliate_commissions (tenant_id, created_at desc);

-- --- 2.3 Der Unveraenderlichkeits-Guard (G4, G8, G15, A6, A9) -----
-- OHNE `security definer` -- der Guard braucht `current_user` nicht fuer eine
-- Erlaubnisliste (es gibt bewusst keine, G4), aber `security definer` wuerde
-- die Funktion als Eigentuemer laufen lassen und damit jede spaetere,
-- versehentlich eingebaute Rollenpruefung aushebeln. Die Festnagelung gilt
-- fuer JEDE Rolle, auch fuer `service_role`: das ist der Unterschied zwischen
-- einem Berechtigungs-Guard und einem Buchhaltungs-Guard. Der Beleg, der aus
-- diesen Zeilen entsteht, ist zehn Jahre aufbewahrungspflichtig und muss aus
-- den Daten reproduzierbar bleiben.
create or replace function public.affiliate_commissions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_books_closed_until date;
  v_target_booked_at   date;
  v_self_partner_id    uuid;
begin
  -- ---------------- INSERT --------------------------------------------------
  -- GANZ VORN, weil OLD beim INSERT nicht zugewiesen ist und jeder `old.`-
  -- Zugriff hier ein Laufzeitfehler waere (Lehre aus 20260910120000, B12).
  if tg_op = 'INSERT' then
    -- Zeitstempel gehoeren der Datenbank. Ohne diese zwei Zeilen koennte ein
    -- Aufrufer eine Buchung rueckdatieren und damit an einer bereits
    -- abgerechneten Periode vorbei schreiben.
    new.created_at := now();
    new.updated_at := now();

    -- Eine Zeile wird NIE als "ausgezahlt" geboren. Andernfalls waere der
    -- gesamte Auszahlungsweg (Entwurf -> Bankabgleich -> paid, G8)
    -- ueberspringbar: ein einziger Insert erzeugte eine Zeile, die im Buch als
    -- geflossenes Geld steht, ohne dass je eine Auszahlung existierte.
    if new.status = 'paid' or new.paid_at is not null or new.payout_id is not null then
      raise exception 'affiliate_commission_insert_not_payable';
    end if;

    -- Eine stornierte Zeile ohne Grund waere im Streitfall nicht erklaerbar.
    if new.status = 'cancelled' and new.cancel_reason is null then
      raise exception 'affiliate_commission_cancel_reason_required';
    end if;

    -- G14 / A6: ein abgeschlossener Abrechnungszeitraum ist gesperrt. Hier und
    -- nicht in der Buchungs-RPC, weil es mehr als eine Schreibstelle gibt
    -- (Buchung B4, Storno B5, Handbuchung B6) -- eine Regel, die nur in einem
    -- von drei Pfaden greift, ist keine Regel.
    -- Die Zeile wird NICHT abgewiesen, sondern in die laufende Periode
    -- gebucht und im `note` vermerkt: eine spaet verarbeitete Outbox-Zeile
    -- darf nicht verloren gehen, nur weil fuer ihren Zeitraum bereits eine
    -- Gutschrift existiert.
    select p.books_closed_until into v_books_closed_until
      from public.affiliate_programs p
     where p.id = new.program_id and p.tenant_id = new.tenant_id;
    if not found then
      -- Der zusammengesetzte Fremdschluessel faenge das ebenfalls, aber erst
      -- am COMMIT (A1). Hier gibt es dafuer eine stabile Kennung, die der
      -- Verarbeiter in `last_error` schreiben kann.
      raise exception 'affiliate_commission_program_tenant_mismatch';
    end if;

    if v_books_closed_until is not null and new.booked_at <= v_books_closed_until then
      -- `greatest(...)` statt schlicht current_date: waere der Zeitraum bis in
      -- die Zukunft geschlossen, landete die Zeile sonst erneut in einer
      -- gesperrten Periode.
      v_target_booked_at := greatest(current_date, v_books_closed_until + 1);
      new.note := coalesce(new.note || ' | ', '')
        || format('Nachbuchung: Abrechnungszeitraum bis %s war bereits abgeschlossen; gebucht zum %s.',
                  to_char(v_books_closed_until, 'DD.MM.YYYY'),
                  to_char(v_target_booked_at, 'DD.MM.YYYY'));
      new.booked_at := v_target_booked_at;
    end if;

    return new;
  end if;

  -- ---------------- UPDATE --------------------------------------------------
  -- KASKADEN-AUSWEG, eng gefasst und VOR jeder anderen Pruefung. Zwei fremde
  -- Loeschungen schlagen als UPDATE hier auf:
  --   * `products`-Loeschung            -> product_id  per SET NULL auf null;
  --   * der Referral-Loeschlauf (B3)    -> referral_id per SET NULL auf null.
  -- Ohne diesen Zweig wuerde die Festnagelung darunter den Wert stillschweigend
  -- auf `old` zuruecksetzen -- das UPDATE liefe durch, die Referenz bliebe
  -- stehen, und die Tabelle zeigte auf eine geloeschte Zeile. Bei SET NULL
  -- gibt es keine Nachpruefung durch Postgres, der Bruch faellt also NICHT
  -- auf. Erlaubt ist ausschliesslich das NULLEN genau dieser beiden Spalten
  -- aus einem Trigger heraus (`pg_trigger_depth() > 1` = Herkunft der
  -- Anweisung, nicht Rolle); jede andere Aenderung faellt weiter in die
  -- Festnagelung. Der Vergleich laeuft ueber
  -- `to_jsonb(...) - 'product_id' - 'referral_id'`, damit kein Feld unbemerkt
  -- mitreist. Gleiche Bauart wie affiliate_referrals_guard (20260911120000).
  if pg_trigger_depth() > 1
     and ((old.product_id  is not null and new.product_id  is null)
       or (old.referral_id is not null and new.referral_id is null))
     and (new.product_id  is null or new.product_id  = old.product_id)
     and (new.referral_id is null or new.referral_id = old.referral_id)
     and to_jsonb(new) - 'product_id' - 'referral_id'
       = to_jsonb(old) - 'product_id' - 'referral_id' then
    return new;
  end if;

  -- G4: Festnagelung OHNE Rollen-Erlaubnisliste. Auch `service_role` und auch
  -- `postgres` schreiben eine gebuchte Zeile nicht um. Wer eine Datenkorrektur
  -- per Migration braucht, schaltet den Trigger bewusst ab -- das ist die
  -- verlangte Huerde, keine Luecke.
  new.id                     := old.id;
  new.tenant_id              := old.tenant_id;
  new.program_id             := old.program_id;
  new.partner_id             := old.partner_id;
  new.kind                   := old.kind;
  new.order_id               := old.order_id;
  new.stripe_invoice_id      := old.stripe_invoice_id;
  new.stripe_subscription_id := old.stripe_subscription_id;
  new.stripe_charge_id       := old.stripe_charge_id;
  new.product_id             := old.product_id;
  new.campaign               := old.campaign;
  new.referral_id            := old.referral_id;
  new.parent_id              := old.parent_id;
  new.reverses_id            := old.reverses_id;
  new.base_cents             := old.base_cents;
  new.basis_kind             := old.basis_kind;
  new.rate_kind              := old.rate_kind;
  new.rate_bp                := old.rate_bp;
  new.fixed_cents            := old.fixed_cents;
  new.amount_cents           := old.amount_cents;
  new.currency               := old.currency;
  new.condition_id           := old.condition_id;
  new.condition_snapshot     := old.condition_snapshot;
  new.booked_at              := old.booked_at;
  new.is_test                := old.is_test;
  new.dedup_key              := old.dedup_key;
  new.created_at             := old.created_at;

  -- `hold_until` nur nach VORNE verschiebbar (Pruefung anhaengen), nie nach
  -- hinten: eine Frist zu verkuerzen waere eine vorgezogene Auszahlung ohne
  -- Beleg.
  if new.hold_until < old.hold_until then
    new.hold_until := old.hold_until;
  end if;

  -- G15: kein Eigengeschaeft. Wer selbst Partner dieses Mandanten ist, ruehrt
  -- den Lebenslauf SEINER EIGENEN Zeilen nicht an -- weder Status noch Flag
  -- noch Auszahlung noch Notiz. `affiliate_self_partner_id()` fragt nach der
  -- PERSON und filtert bewusst NICHT auf `status = 'active'` (20260910120000,
  -- Abschnitt 8): die Frage "geht es um mein eigenes Geld?" haengt nicht am
  -- Freigabestatus der eigenen Partnerzeile. Fuer `service_role` ist
  -- auth.uid() null, die Funktion liefert null, der Zweig greift nicht -- und
  -- das ist richtig: der Freigabelauf ist kein Mensch mit Interessenkonflikt.
  v_self_partner_id := public.affiliate_self_partner_id(old.tenant_id);
  if v_self_partner_id is not null and v_self_partner_id = old.partner_id then
    if new.status        is distinct from old.status
       or new.cancel_reason is distinct from old.cancel_reason
       or new.payout_id  is distinct from old.payout_id
       or new.paid_at    is distinct from old.paid_at
       or new.flagged    is distinct from old.flagged
       or new.flag_reason is distinct from old.flag_reason
       or new.note       is distinct from old.note then
      raise exception 'affiliate_self_dealing_forbidden';
    end if;
  end if;

  -- A9: die Uebergangstabelle aus Plan 6.3, als Eigenschaft statt als
  -- Absichtserklaerung. 'paid' und 'cancelled' sind Endzustaende -- fuer sie
  -- gibt es unten keine Kante, und damit keinen Rueckweg. Geld, das den
  -- Mandanten verlassen hat, wird nicht durch einen Statuswechsel
  -- zurueckgeholt, sondern durch eine negative Zeile (G6).
  if new.status is distinct from old.status then
    if not (
         (old.status = 'pending'  and new.status in ('on_hold','approved','cancelled'))
      or (old.status = 'on_hold'  and new.status in ('approved','cancelled'))
      or (old.status = 'approved' and new.status = 'paid')
    ) then
      raise exception 'affiliate_commission_status_transition_forbidden';
    end if;
  end if;

  -- Eine Stornierung ohne Grund waere im Streitfall nicht erklaerbar; einmal
  -- gesetzt, bleibt der Grund stehen (Festnagelung wie oben, nicht Abbruch --
  -- der Grund gehoert zum Beleg).
  if new.status = 'cancelled' and new.cancel_reason is null then
    raise exception 'affiliate_commission_cancel_reason_required';
  end if;
  if old.cancel_reason is not null then
    new.cancel_reason := old.cancel_reason;
  end if;

  -- G8, erste Haelfte: `payout_id` darf ausschliesslich an einer Zeile
  -- wandern, die vor UND nach dem Update 'approved' ist. Damit ist das
  -- Stempeln vom Statuswechsel getrennt (kein Update kann beides zugleich),
  -- ein verworfener Entwurf kann zurueckgesetzt werden (value -> null), und
  -- nach 'paid' ist die Zuordnung eingefroren.
  if new.payout_id is distinct from old.payout_id then
    if old.status <> 'approved' or new.status <> 'approved' then
      raise exception 'affiliate_commission_payout_stamp_forbidden';
    end if;
  end if;

  -- G8, zweite Haelfte: der Zeitpunkt der Ueberweisung kommt aus der
  -- Datenbank, nicht aus dem Aufrufer -- und er wird nie wieder angefasst.
  if new.status = 'paid' and old.status <> 'paid' then
    new.paid_at := now();
  end if;
  if old.paid_at is not null then
    new.paid_at := old.paid_at;
  end if;

  -- Aenderbar bleiben damit genau: status (entlang der Kanten oben),
  -- cancel_reason (einmalig), payout_id (nur auf 'approved'), paid_at (von der
  -- Datenbank gesetzt), flagged, flag_reason, note und updated_at (vom
  -- Touch-Trigger). Begruendung im Kopf dieser Datei.
  return new;
end;
$$;

drop trigger if exists affiliate_commissions_guard_trg on public.affiliate_commissions;
-- BEFORE-Trigger derselben Tabelle laufen alphabetisch, `g < t` -- der Guard
-- muss vor dem Touch laufen (20260807171725:198-203).
create trigger affiliate_commissions_guard_trg before insert or update on public.affiliate_commissions
  for each row execute function public.affiliate_commissions_guard();

drop trigger if exists affiliate_commissions_touch on public.affiliate_commissions;
create trigger affiliate_commissions_touch before update on public.affiliate_commissions
  for each row execute function public.set_updated_at();

-- --- 2.4 RLS -----------------------------------------------------
alter table public.affiliate_commissions enable row level security;
revoke all on public.affiliate_commissions from anon, authenticated;

-- --- 2.5 Spaltenrecht (A3) ---------------------------------------
-- ZWEITE EBENE NEBEN RLS, weil RLS keine SPALTEN trennt. Der Plan (3.11)
-- begruendet die Kaeuferdatengrenze allein damit, dass ein Partner `orders`
-- nicht lesen darf. Das stimmt fuer die Bestellzeile -- aber die
-- IDENTIFIKATOREN stehen in DIESER Tabelle, und `dedup_key` traegt sie im
-- Klartext ('sale:<order_id>', 'recurring:<stripe_invoice_id>'). Ein Partner
-- haette damit eine exportierbare Liste der Bestell- und Rechnungskennungen
-- seiner Kaeufer, mit Zeitstempel und Betrag. Deshalb bleiben draussen:
--   order_id, stripe_invoice_id, stripe_subscription_id, stripe_charge_id,
--   dedup_key  -- Kaeuferbezug (Plan 11.15);
--   note, flag_reason -- Managertexte ("Verdacht auf Eigenbestellungen"),
--   Vorbild payout_hold_reason an affiliate_partners (B1).
-- WICHTIG: Spaltenrechte sind NICHT rollenabhaengig. Diese Liste ist damit die
-- SCHNITTMENGE aus dem, was Partner UND Manager ueber PostgREST sehen duerfen.
-- Der Manager bekommt die fehlenden Spalten ueber eine Server-Route mit
-- requireAdminTenant() und createAdminClient(); der Partner bekommt `note`
-- ueber die Partner-Route, die sie fuer seine eigenen Zeilen ausliefert.
-- Folge fuer den Anwendungscode: `select('*')` bricht hier mit 42501 ab.
grant select (id, tenant_id, program_id, partner_id, kind,
              product_id, campaign, referral_id, parent_id, reverses_id,
              base_cents, basis_kind, rate_kind, rate_bp, fixed_cents,
              amount_cents, currency, condition_id, condition_snapshot,
              status, cancel_reason, hold_until, booked_at,
              payout_id, paid_at, flagged, is_test, created_at, updated_at)
  on public.affiliate_commissions to authenticated;
-- KEIN `grant insert/update/delete`: geschrieben wird ausschliesslich ueber
-- book_affiliate_commissions(jsonb) und approve_due_affiliate_commissions(int)
-- unter `service_role`, dazu die Server Actions aus B6/B8 ueber
-- createAdminClient(). Ein Client schreibt nie.

-- --- 2.6 Policies (genau eine SELECT-Policy, G17) -----------------
-- `(select auth.uid())` waere hier ueberfluessig -- die beiden
-- Security-Definer-Helfer sind `stable` und werden ohnehin einmal je Abfrage
-- ausgewertet (Advisor auth_rls_initplan, 20260712233000:4-10).
-- BEIDE Zweige haengen an der tenant_id DER ZEILE. Ein ungebundener Zweig
-- (z. B. `affiliate_partner_id(irgendetwas)`) hoebe den anderen auf, weil
-- permissive Policies ver-ODER-t werden.
create policy affiliate_commissions_select on public.affiliate_commissions for select using (
  public.affiliate_is_manager(tenant_id)
  or partner_id = public.affiliate_partner_id(tenant_id)
);
-- Auditierbare Absichtserklaerung fuer den Linter; der tatsaechliche Schutz
-- ist das `revoke all` oben plus das Fehlen jeder Schreib-Policy.
create policy affiliate_commissions_deny_write on public.affiliate_commissions
  for all to anon, authenticated using (false) with check (false);


-- =================================================================
-- 3. affiliate_subscription_bindings (Plan 3.9)
-- =================================================================
-- Die Zuordnung eines Stripe-Abonnements zu einem Partner samt KOPIERTER
-- Abo-Regel und einem DB-seitigen Zaehler. Ohne sie ist eine Folgerate nicht
-- zuordenbar, weil `invoice.paid` keine Session-Metadata traegt
-- (src/app/api/stripe/webhook/route.ts:386).
--
-- recurring_mode, max_periods und currency werden beim Anlegen aus dem
-- Programm KOPIERT: eine spaetere Programmaenderung darf laufende Abos nicht
-- rueckwirkend umdefinieren -- dieselbe Begruendung wie beim kopierten Satz in
-- 20260803100200_marketplace_ledger.sql:20-24 und beim condition_snapshot
-- oben.

create table public.affiliate_subscription_bindings (
  -- Stripe-IDs sind global eindeutig; ein eigenes `id` braucht die Tabelle
  -- nicht, und niemand referenziert sie ueber ein (id, tenant_id)-Paar (A8).
  stripe_subscription_id text primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  program_id     uuid not null,
  partner_id     uuid not null,
  referral_id    uuid,
  -- Die sale-Zeile der ersten Rate. Aus ihrem condition_snapshot liest der
  -- Verarbeiter den Satz jeder Folgerate (Plan 5.7) -- der Satz wird NICHT
  -- neu aufgeloest, sonst koennte ein Haendler laufende Abos rueckwirkend
  -- billiger machen.
  origin_commission_id uuid,

  recurring_mode text not null check (recurring_mode in ('first_only','n_periods','all')),
  max_periods    int  not null default 0 check (max_periods >= 0),
  periods_booked int  not null default 0 check (periods_booked >= 0),
  currency       text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  ended_at       timestamptz,
  created_at     timestamptz not null default now(),

  -- Zweite Verteidigungslinie hinter dem bedingten Zaehler-Update. Der Plan
  -- prueft nur 'n_periods'; 'first_only' hat laut Plan 5.7 ebenfalls
  -- max_periods = 1 und darf denselben Deckel bekommen. Nur 'all' ist
  -- unbegrenzt.
  check (recurring_mode = 'all' or periods_booked <= max_periods),

  -- A7: der Plan deklariert nur den Partner-Fremdschluessel. Ohne die drei
  -- anderen ist eine mandantenuebergreifende Bindung einfuegbar.
  -- A1: `no action deferrable initially deferred` statt `restrict`.
  constraint affiliate_subscription_bindings_partner_fk
    foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id)
    on delete no action deferrable initially deferred,
  constraint affiliate_subscription_bindings_program_fk
    foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id)
    on delete no action deferrable initially deferred,
  constraint affiliate_subscription_bindings_origin_fk
    foreign key (origin_commission_id, tenant_id) references public.affiliate_commissions (id, tenant_id)
    on delete no action deferrable initially deferred,
  -- A2: mit Spaltenliste. Der Referral-Loeschlauf aus B3 raeumt abgelaufene
  -- Zuordnungen weg; die Bindung ueberlebt das, sie verliert nur den Verweis.
  constraint affiliate_subscription_bindings_referral_fk
    foreign key (referral_id, tenant_id) references public.affiliate_referrals (id, tenant_id)
    on delete set null (referral_id)
);

-- "Alle Abos dieses Partners" und zugleich der Fremdschluessel.
create index affiliate_subscription_bindings_partner_idx
  on public.affiliate_subscription_bindings (partner_id, tenant_id);
-- A5/A7: je ein Index auf jeden weiteren Fremdschluessel.
create index affiliate_subscription_bindings_program_idx
  on public.affiliate_subscription_bindings (program_id, tenant_id);
create index affiliate_subscription_bindings_referral_idx
  on public.affiliate_subscription_bindings (referral_id, tenant_id);
create index affiliate_subscription_bindings_origin_idx
  on public.affiliate_subscription_bindings (origin_commission_id, tenant_id);
-- Traegt den Fremdschluessel auf tenants (Kaskade) und die Admin-Liste.
create index affiliate_subscription_bindings_tenant_idx
  on public.affiliate_subscription_bindings (tenant_id, created_at desc);

-- Guard. Alles, was die Bindung AUSMACHT, ist ein Schnappschuss und
-- unveraenderlich; aenderbar sind nur der Zaehler (aufwaerts) und das Ende.
-- OHNE `security definer`, gleiche Begruendung wie oben.
create or replace function public.affiliate_subscription_bindings_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- INSERT GANZ VORN (OLD ist beim INSERT nicht zugewiesen).
  if tg_op = 'INSERT' then
    new.created_at := now();
    -- Eine Bindung entsteht mit der ersten Rate, also mit periods_booked = 1
    -- (Plan 5.7) oder 0; sie entsteht NIE bereits beendet.
    if new.ended_at is not null then
      raise exception 'affiliate_subscription_binding_insert_must_be_open';
    end if;
    return new;
  end if;

  -- DELETE. Erlaubt sind Migration und Dashboard -- und die Kaskade ueber die
  -- HERKUNFT der Anweisung (`pg_trigger_depth() > 1`), nicht ueber eine Rolle.
  -- Ohne diesen Zweig blockierte der Guard die Mandantenloeschung; 'service_role'
  -- steht bewusst NICHT in der Liste, weil die Bindung der Beleg dafuer ist,
  -- warum eine Folgerate diesem Partner zugeschlagen wurde.
  if tg_op = 'DELETE' then
    if current_user in ('postgres', 'supabase_admin')
       or pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'affiliate_subscription_binding_immutable';
  end if;

  -- UPDATE.
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- KASKADEN-AUSWEG: der Referral-Loeschlauf nullt `referral_id`. Ohne diesen
  -- Zweig setzte die Festnagelung darunter den Wert stillschweigend zurueck,
  -- und die Bindung zeigte auf eine geloeschte Zuordnung.
  if pg_trigger_depth() > 1
     and old.referral_id is not null and new.referral_id is null
     and to_jsonb(new) - 'referral_id' = to_jsonb(old) - 'referral_id' then
    return new;
  end if;

  -- SCHNAPPSCHUSS. Wer partner_id oder recurring_mode aendern koennte, haengte
  -- ein laufendes Abo nachtraeglich um oder definierte seine Regel neu -- und
  -- zwar fuer alle kuenftigen Raten auf einmal.
  new.stripe_subscription_id := old.stripe_subscription_id;
  new.tenant_id              := old.tenant_id;
  new.program_id             := old.program_id;
  new.partner_id             := old.partner_id;
  new.referral_id            := old.referral_id;
  new.origin_commission_id   := old.origin_commission_id;
  new.recurring_mode         := old.recurring_mode;
  new.max_periods            := old.max_periods;
  new.currency               := old.currency;
  new.created_at             := old.created_at;

  -- Der Zaehler kennt nur eine Richtung. Ihn zu senken waere eine zweite
  -- Buchung derselben Rate -- der `unique (tenant_id, dedup_key)` faenge das
  -- fuer dieselbe Rechnung, nicht aber fuer eine spaetere.
  if new.periods_booked < old.periods_booked then
    raise exception 'affiliate_subscription_binding_counter_not_reversible';
  end if;

  -- `customer.subscription.deleted` ist endgueltig. Ein wiederbelebbares Ende
  -- waere ein Weg, nach der Kuendigung weiter zu buchen.
  if old.ended_at is not null then
    new.ended_at := old.ended_at;
  end if;

  return new;
end;
$$;

drop trigger if exists affiliate_subscription_bindings_guard_trg on public.affiliate_subscription_bindings;
create trigger affiliate_subscription_bindings_guard_trg
  before insert or update or delete on public.affiliate_subscription_bindings
  for each row execute function public.affiliate_subscription_bindings_guard();

alter table public.affiliate_subscription_bindings enable row level security;
revoke all on public.affiliate_subscription_bindings from anon, authenticated;

-- HIER BEWUSST EIN TABELLENRECHT und kein Spaltenrecht: die einzige lesende
-- Rolle ist der Manager (Policy unten), und er darf jede Spalte dieser Zeile
-- sehen -- sie enthaelt keine Kaeuferdaten ausser der Abo-Kennung, und
-- `orders` mit Name und Konto liest er ohnehin. Ein Spaltenrecht waere hier
-- nur eine weitere `select('*')`-Falle ohne Schutzgewinn.
grant select on public.affiliate_subscription_bindings to authenticated;

-- Der PARTNER liest diese Tabelle NICHT. Eine Zeilenliste waere fuer ihn eine
-- Liste laufender Abonnements seiner Kaeufer -- also ein Kundenbestand des
-- Mandanten, nicht seiner (Plan 11.15). Was er wissen muss ("aus diesem Abo
-- kommt jeden Monat eine Rate"), steht als eigene Provisionszeile im Buch.
create policy affiliate_subscription_bindings_select
  on public.affiliate_subscription_bindings for select using (
    public.affiliate_is_manager(tenant_id)
  );
create policy affiliate_subscription_bindings_deny_write
  on public.affiliate_subscription_bindings
  for all to anon, authenticated using (false) with check (false);


-- =================================================================
-- 4. RPC book_affiliate_commissions(jsonb) -- Plan 10/B4
-- =================================================================
-- ALLE Zeilen einer Bestellung ATOMAR. Das ist der Kern dieses Blocks: eine
-- halb gebuchte Bestellung -- sale geschrieben, reserve nicht -- waere ein
-- Geldfehler, den niemand mehr sieht, weil der Saldo trotzdem eine plausible
-- Zahl ergibt. Eine plpgsql-Funktion laeuft in EINER Transaktion: entweder
-- alle Zeilen stehen, oder keine.
--
-- IDEMPOTENZ. Die einzige Achse ist `unique (tenant_id, dedup_key)` (G3).
-- Jeder Insert laeuft mit `on conflict (tenant_id, dedup_key) do nothing`;
-- liefert er nichts zurueck, wird die BESTEHENDE Zeile gelesen und ihre id
-- weiterverwendet. Ein Wiederholungsaufruf -- Stripes zweite Zustellung, ein
-- Reprocess nach einem Fehler, der Nachhol-Lauf -- schreibt damit KEINE neue
-- Zeile, sondern liefert dieselben ids zurueck wie beim ersten Mal. Der
-- Aufrufer kann am Rueckgabefeld `inserted` ablesen, was tatsaechlich
-- entstanden ist; `book_affiliate_commissions` ist damit gefahrlos
-- wiederholbar, und genau darauf beruht der Reprocess-Endpunkt (Plan 6.6).
--
-- DIE SPERRE. `pg_advisory_xact_lock` auf (Klasse, Mandant+Sperrschluessel)
-- serialisiert zwei gleichzeitige Verarbeitungen DESSELBEN Vorgangs. Der
-- Unique-Index allein genuegt nicht: ohne Sperre laufen beide Transaktionen
-- bis zum ersten Konflikt weiter, eine von beiden blockiert dann im Index,
-- und nach dem Commit der ersten liest die zweite ueber `do nothing` einen
-- Zwischenstand, der im ungluecklichen Fall noch nicht alle Geschwisterzeilen
-- enthaelt -- ihre eigenen Inserts kollidierten dann teils, teils nicht. Mit
-- der Sperre ist der ganze Stapel entweder vorher oder nachher, nie
-- verschraenkt. Die Sperre wird beim Transaktionsende automatisch
-- freigegeben (Muster 20260907091500_quiz_attempt_limit_rpc.sql:70-73).
--
-- VERWEISE INNERHALB DES STAPELS. `reserve` und `tier2` brauchen die id der
-- `sale`-Zeile, die es beim Aufruf noch nicht gibt. Der Aufrufer vergibt
-- deshalb je Zeile ein `ref` (frei waehlbare Kennung innerhalb des Stapels)
-- und verweist mit `parent_ref`/`reverses_ref` darauf; die Funktion loest das
-- in der Reihenfolge des Arrays auf. Ein Verweis auf ein noch unbekanntes
-- `ref` ist ein Fehler -- damit ist die Reihenfolge (Elternteil zuerst)
-- erzwungen und nicht nur empfohlen. Auf BESTEHENDE Zeilen (der Storno-Fall
-- aus B5) verweist der Aufrufer stattdessen mit `parent_id`/`reverses_id`.
--
-- OHNE `security definer` und ausschliesslich fuer `service_role`
-- ausfuehrbar (Plan 11.10: "Buchungs-RPC (nur service_role)"). `service_role`
-- traegt bereits `rolbypassrls`; `security definer` waere eine
-- Rechteverstaerkung ohne Gewinn. Muster: affiliate_record_click() aus B3.
--
-- ERWARTETE NUTZLAST:
--   {
--     "tenant_id":  "<uuid>",
--     "program_id": "<uuid>",
--     "lock_key":   "order:<uuid>" | "invoice:<id>" | "charge:<id>" | ...,
--     "rows": [
--       { "ref": "sale", "kind": "sale", "partner_id": "<uuid>",
--         "order_id": "<uuid>", "product_id": "<uuid>", "campaign": "sommer",
--         "referral_id": "<uuid>", "base_cents": 37739, "basis_kind": "net",
--         "rate_kind": "percent", "rate_bp": 3500, "fixed_cents": 0,
--         "amount_cents": 11888, "currency": "eur",
--         "condition_id": "<uuid>", "condition_snapshot": { ... },
--         "status": "pending", "hold_until": "2026-10-11T12:00:00Z",
--         "booked_at": "2026-09-11", "is_test": false,
--         "dedup_key": "sale:<order_id>" },
--       { "ref": "reserve", "kind": "reserve", "parent_ref": "sale", ... },
--       { "ref": "tier2",   "kind": "tier2",   "parent_ref": "sale", ... }
--     ]
--   }
-- RUECKGABE:
--   { "tenant_id": ..., "lock_key": ..., "inserted": 3, "existing": 0,
--     "rows": [ { "ref": "sale", "id": "<uuid>", "dedup_key": "...",
--                 "inserted": true }, ... ] }
create or replace function public.book_affiliate_commissions(p_payload jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_tenant_id  uuid;
  v_program_id uuid;
  v_lock_key   text;
  v_rows       jsonb;
  v_row        jsonb;
  -- ref -> id (als Text), damit Verweise innerhalb des Stapels aufloesbar sind.
  v_refs       jsonb := '{}'::jsonb;
  v_result     jsonb := '[]'::jsonb;
  v_inserted   int   := 0;
  v_existing   int   := 0;
  v_ref        text;
  v_dedup_key  text;
  v_partner_id uuid;
  v_order_id   uuid;
  v_parent_id  uuid;
  v_reverses_id uuid;
  v_hold_until timestamptz;
  v_snapshot   jsonb;
  v_id         uuid;
  v_was_new    boolean;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'affiliate_book_payload_invalid';
  end if;

  v_tenant_id  := nullif(p_payload->>'tenant_id', '')::uuid;
  v_program_id := nullif(p_payload->>'program_id', '')::uuid;
  v_lock_key   := nullif(p_payload->>'lock_key', '');
  v_rows       := p_payload->'rows';

  if v_tenant_id is null or v_program_id is null or v_lock_key is null then
    raise exception 'affiliate_book_payload_incomplete';
  end if;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 then
    raise exception 'affiliate_book_rows_empty';
  end if;
  -- Deckel gegen eine versehentlich riesige Nutzlast. Der groesste bekannte
  -- Stapel ist ein Vollstorno mit Zweitstufe ueber mehrere Abo-Raten; 50
  -- Zeilen sind dafuer reichlich und begrenzen zugleich die Dauer der Sperre.
  if jsonb_array_length(v_rows) > 50 then
    raise exception 'affiliate_book_rows_too_many';
  end if;

  -- Plan 11.15: die Mandantenbindung JEDER client-gelieferten ID wird
  -- serverseitig nachgeprueft -- genau die Fehlerklasse, die beim Marketplace
  -- zu vier Nachbesserungs-Migrationen gefuehrt hat (20260803100400:52-83).
  -- Die zusammengesetzten Fremdschluessel faengen dasselbe, aber erst am
  -- COMMIT (A1) und mit einer Meldung, die niemand einem Ereignis zuordnen
  -- kann. Hier gibt es stattdessen stabile Kennungen fuer `last_error`.
  perform 1 from public.affiliate_programs p
   where p.id = v_program_id and p.tenant_id = v_tenant_id;
  if not found then
    raise exception 'affiliate_book_program_tenant_mismatch';
  end if;

  -- Siehe "DIE SPERRE" oben. Die Klassenkennung verhindert eine Kollision mit
  -- anderen advisory locks des Projekts (z. B. submit_quiz_attempt).
  perform pg_advisory_xact_lock(
    hashtext('affiliate_commissions'),
    hashtext(v_tenant_id::text || '|' || v_lock_key)
  );

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    v_ref       := nullif(v_row->>'ref', '');
    v_dedup_key := nullif(v_row->>'dedup_key', '');
    if v_ref is null or v_dedup_key is null then
      raise exception 'affiliate_book_row_incomplete';
    end if;
    if v_refs ? v_ref then
      raise exception 'affiliate_book_duplicate_ref';
    end if;

    v_partner_id := nullif(v_row->>'partner_id', '')::uuid;
    if v_partner_id is null then
      raise exception 'affiliate_book_partner_missing';
    end if;
    perform 1 from public.affiliate_partners ap
     where ap.id = v_partner_id and ap.tenant_id = v_tenant_id;
    if not found then
      raise exception 'affiliate_book_partner_tenant_mismatch';
    end if;

    v_order_id := nullif(v_row->>'order_id', '')::uuid;
    if v_order_id is not null then
      perform 1 from public.orders o
       where o.id = v_order_id and o.tenant_id = v_tenant_id;
      if not found then
        raise exception 'affiliate_book_order_tenant_mismatch';
      end if;
    end if;

    -- Elternteil: entweder ein Verweis innerhalb des Stapels oder eine
    -- bestehende Zeile desselben Mandanten.
    if nullif(v_row->>'parent_ref', '') is not null then
      if not (v_refs ? (v_row->>'parent_ref')) then
        raise exception 'affiliate_book_parent_ref_unknown';
      end if;
      v_parent_id := (v_refs->>(v_row->>'parent_ref'))::uuid;
    else
      v_parent_id := nullif(v_row->>'parent_id', '')::uuid;
      if v_parent_id is not null then
        perform 1 from public.affiliate_commissions c
         where c.id = v_parent_id and c.tenant_id = v_tenant_id;
        if not found then
          raise exception 'affiliate_book_parent_tenant_mismatch';
        end if;
      end if;
    end if;

    -- Stornierte Zeile: dieselbe Unterscheidung. Der Storno-Pfad aus B5
    -- verweist praktisch immer auf eine bestehende Zeile.
    if nullif(v_row->>'reverses_ref', '') is not null then
      if not (v_refs ? (v_row->>'reverses_ref')) then
        raise exception 'affiliate_book_reverses_ref_unknown';
      end if;
      v_reverses_id := (v_refs->>(v_row->>'reverses_ref'))::uuid;
    else
      v_reverses_id := nullif(v_row->>'reverses_id', '')::uuid;
      if v_reverses_id is not null then
        perform 1 from public.affiliate_commissions c
         where c.id = v_reverses_id and c.tenant_id = v_tenant_id;
        if not found then
          raise exception 'affiliate_book_reverses_tenant_mismatch';
        end if;
      end if;
    end if;

    -- `hold_until` ist `not null` und traegt die Sperrfrist; sie wird aus
    -- `occurred_at` gerechnet, nicht aus now() -- deshalb kommt sie vom
    -- Aufrufer und bekommt hier eine eigene, sprechende Fehlerkennung.
    v_hold_until := nullif(v_row->>'hold_until', '')::timestamptz;
    if v_hold_until is null then
      raise exception 'affiliate_book_hold_until_missing';
    end if;

    -- `->` liefert fuer ein JSON-null nicht SQL-NULL, sondern 'null'::jsonb --
    -- coalesce() greift dort nicht. Deshalb die Typpruefung.
    if jsonb_typeof(v_row->'condition_snapshot') = 'object' then
      v_snapshot := v_row->'condition_snapshot';
    else
      v_snapshot := '{}'::jsonb;
    end if;

    insert into public.affiliate_commissions (
      tenant_id, program_id, partner_id, kind,
      order_id, stripe_invoice_id, stripe_subscription_id, stripe_charge_id,
      product_id, campaign, referral_id, parent_id, reverses_id,
      base_cents, basis_kind, rate_kind, rate_bp, fixed_cents, amount_cents,
      currency, condition_id, condition_snapshot,
      status, cancel_reason, hold_until, booked_at,
      flagged, flag_reason, is_test, note, dedup_key
    ) values (
      v_tenant_id,
      v_program_id,
      v_partner_id,
      v_row->>'kind',
      v_order_id,
      nullif(v_row->>'stripe_invoice_id', ''),
      nullif(v_row->>'stripe_subscription_id', ''),
      nullif(v_row->>'stripe_charge_id', ''),
      nullif(v_row->>'product_id', '')::uuid,
      nullif(v_row->>'campaign', ''),
      nullif(v_row->>'referral_id', '')::uuid,
      v_parent_id,
      v_reverses_id,
      (v_row->>'base_cents')::int,
      v_row->>'basis_kind',
      v_row->>'rate_kind',
      coalesce((v_row->>'rate_bp')::int, 0),
      coalesce((v_row->>'fixed_cents')::int, 0),
      (v_row->>'amount_cents')::int,
      coalesce(nullif(v_row->>'currency', ''), 'eur'),
      nullif(v_row->>'condition_id', '')::uuid,
      v_snapshot,
      coalesce(nullif(v_row->>'status', ''), 'pending'),
      nullif(v_row->>'cancel_reason', ''),
      v_hold_until,
      coalesce(nullif(v_row->>'booked_at', '')::date, current_date),
      coalesce((v_row->>'flagged')::boolean, false),
      nullif(v_row->>'flag_reason', ''),
      coalesce((v_row->>'is_test')::boolean, false),
      nullif(v_row->>'note', ''),
      v_dedup_key
    )
    -- AUSDRUECKLICHES Konfliktziel: nur die Idempotenzachse wird geschluckt.
    -- Ein Konflikt auf `unique (id, tenant_id)` oder ein CHECK-Verstoss wirft
    -- weiterhin und rollt den ganzen Stapel zurueck -- genau das ist gewollt.
    on conflict (tenant_id, dedup_key) do nothing
    returning id into v_id;

    if v_id is null then
      -- Die Zeile gab es schon (Wiederholungsaufruf). Ihre id wird
      -- weiterverwendet, damit Geschwisterzeilen auf das ORIGINAL zeigen und
      -- nicht ins Leere.
      select c.id into v_id
        from public.affiliate_commissions c
       where c.tenant_id = v_tenant_id and c.dedup_key = v_dedup_key;
      if v_id is null then
        -- Kann nur eintreten, wenn ein anderer Constraint den Konflikt
        -- ausgeloest hat. Lieber lautstark abbrechen als eine Zeile still
        -- verschlucken.
        raise exception 'affiliate_book_conflict_unresolved';
      end if;
      v_was_new  := false;
      v_existing := v_existing + 1;
    else
      v_was_new  := true;
      v_inserted := v_inserted + 1;
    end if;

    v_refs := v_refs || jsonb_build_object(v_ref, v_id::text);
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'ref', v_ref,
      'id', v_id,
      'dedup_key', v_dedup_key,
      'inserted', v_was_new
    ));
  end loop;

  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'lock_key', v_lock_key,
    'inserted', v_inserted,
    'existing', v_existing,
    'rows', v_result
  );
end;
$$;


-- =================================================================
-- 5. RPC approve_due_affiliate_commissions(int) -- Plan 6.4
-- =================================================================
-- Der Freigabelauf: EIN einziges bedingtes UPDATE, damit zwei gleichzeitige
-- Cron-Ticks nicht doppelt freigeben. Zusaetzlich `for update skip locked` --
-- ein zweiter Tick wartet damit nicht auf den ersten, sondern laesst dessen
-- Zeilen liegen und nimmt die naechsten (Muster affiliate_clicks_purge() aus
-- B3). Der Deckel folgt derselben Begruendung, aus der die KI-Generierung als
-- Zustandsmaschine laeuft: die CPU-Zeit des Workers ist begrenzt.
--
-- Vier Bedingungen, und jede hat einen Grund:
--   status = 'pending'   -- nur was noch in der Sperrfrist steht;
--   flagged = false      -- ein Verdachtsfall wird von einem Menschen
--                           entschieden, nicht von der Uhr;
--   is_test = false      -- Testzeilen sind 'cancelled' und werden vom
--                           Statusfilter ohnehin nicht erfasst; die Bedingung
--                           steht trotzdem hier, weil sie im Index steht und
--                           die Absicht sichtbar macht (Plan 4.5);
--   hold_until <= now()  -- die Frist ist abgelaufen;
--   p.status = 'active'  -- ein pausiertes Programm gibt nichts frei. Das ist
--                           der Schalter, mit dem ein Mandant einen
--                           Betrugsverdacht anhalten kann, ohne einzelne
--                           Zeilen anzufassen.
--
-- Die Rueckgabe traegt die freigegebenen Zeilen, damit der Verarbeiter daraus
-- die Benachrichtigungen baut. Bewusst `jsonb` statt `returns table`: eine
-- Ergebnisspalte namens `id` oder `tenant_id` waere in plpgsql ein Name, der
-- mit den Spalten der Abfrage konkurriert -- jsonb hat dieses Problem nicht
-- und passt zur Rueckgabe von book_affiliate_commissions().
create or replace function public.approve_due_affiliate_commissions(p_limit int default 500)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_rows  jsonb;
begin
  with due as (
    select c2.id
      from public.affiliate_commissions c2
      join public.affiliate_programs p
        on p.id = c2.program_id and p.tenant_id = c2.tenant_id
     where c2.status = 'pending'
       and c2.flagged = false
       and c2.is_test = false
       and c2.hold_until <= now()
       and p.status = 'active'
     order by c2.hold_until
     limit v_limit
     for update of c2 skip locked
  ),
  upd as (
    update public.affiliate_commissions c
       set status = 'approved'
     where c.id in (select due.id from due)
    returning c.id, c.tenant_id, c.partner_id, c.amount_cents, c.currency, c.kind
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', upd.id,
           'tenant_id', upd.tenant_id,
           'partner_id', upd.partner_id,
           'amount_cents', upd.amount_cents,
           'currency', upd.currency,
           'kind', upd.kind
         )), '[]'::jsonb)
    into v_rows
    from upd;

  return jsonb_build_object(
    'approved', jsonb_array_length(v_rows),
    'limit', v_limit,
    'rows', v_rows
  );
end;
$$;


-- =================================================================
-- 6. Ausfuehrungsrechte
-- =================================================================
-- Beim Feuern eines Triggers prueft Postgres kein EXECUTE-Recht (das geschieht
-- beim `create trigger`); der `grant` an authenticated ist also die sichere
-- Seite. Entscheidend ist, dass `anon` AUSDRUECKLICH entfernt wird -- `revoke
-- from public` allein liesse den eigenen anon-Grant stehen, den Supabase ueber
-- `alter default privileges` vergibt (nachgewiesener Fund vom 07.09.2026,
-- 20260907093000_revoke_new_rpcs_from_anon.sql:1-19). Nach JEDEM kuenftigen
-- `create or replace` dieser Funktionen erneut setzen.
revoke execute on function public.affiliate_events_guard()                from public;
revoke execute on function public.affiliate_events_guard()                from anon;
grant  execute on function public.affiliate_events_guard()                to authenticated, service_role;

revoke execute on function public.affiliate_commissions_guard()           from public;
revoke execute on function public.affiliate_commissions_guard()           from anon;
grant  execute on function public.affiliate_commissions_guard()           to authenticated, service_role;

revoke execute on function public.affiliate_subscription_bindings_guard() from public;
revoke execute on function public.affiliate_subscription_bindings_guard() from anon;
grant  execute on function public.affiliate_subscription_bindings_guard() to authenticated, service_role;

-- Die beiden RPCs schreiben Geld. `authenticated` wird hier ZUSAETZLICH
-- entzogen -- anders als bei den Guards, die als Trigger laufen muessen.
-- Einziger Aufrufer ist der Verarbeiter unter `service_role`
-- (Plan 11.10), erreichbar nur ueber den Cron-Endpunkt mit `x-cron-secret`.
revoke execute on function public.book_affiliate_commissions(jsonb) from public;
revoke execute on function public.book_affiliate_commissions(jsonb) from anon;
revoke execute on function public.book_affiliate_commissions(jsonb) from authenticated;
grant  execute on function public.book_affiliate_commissions(jsonb) to service_role;

revoke execute on function public.approve_due_affiliate_commissions(int) from public;
revoke execute on function public.approve_due_affiliate_commissions(int) from anon;
revoke execute on function public.approve_due_affiliate_commissions(int) from authenticated;
grant  execute on function public.approve_due_affiliate_commissions(int) to service_role;
