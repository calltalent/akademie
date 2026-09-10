# Umsetzungsplan: Affiliate-System der Calltalent-Akademie

Verbindlicher Bauplan, erstellt am 10.09.2026. Grundlage sind drei Entwürfe und drei Jurygutachten;
dieser Plan ersetzt sie vollständig. Wo ein Entwurf verworfen wurde, steht die Begründung dabei.

Referenzen: `CLAUDE.md` (Bau-Verfassung), `SPEC.md`, `supabase/migrations/0001_init.sql`,
`PHASENSTATUS.md` (offene Punkte), `PROJEKTANALYSE_2026-09-08.md`.

---

## 1. Ziel und Abgrenzung

### 1.1 Was das System kann

Ein mandantenfähiges Partnerprogramm nach Digistore24-Vorbild, das neben dem bestehenden
Marketplace-/Stripe-Code als eigene Tabellenfamilie `affiliate_*` läuft. Ein Mandant, für den der
Betreiber `tenants.settings.affiliate_enabled` gesetzt hat, kann genau ein Partnerprogramm betreiben:
Partner bewerben sich öffentlich oder werden eingeladen, erhalten nach Freigabe einen eigenen
Bereich unter `/partner` auf der Mandanten-Domain, erzeugen dort Promolinks mit Kampagnenschlüssel,
und jeder Kauf, der auf einen ihrer Klicks zurückgeht, erzeugt eine unveränderliche Buchung im
Provisionsbuch `affiliate_commissions`.

Die Zuordnung eines Kaufs zu einem Partner läuft über ein serverseitig gespeichertes,
undurchsichtiges 32-Byte-Token (`affiliate_referrals.token`), das als First-Party-Cookie `ct_aff`
und zusätzlich als URL-Parameter `?aff=` durch den Funnel reist und beim Erzeugen der
Stripe-Checkout-Session als Momentaufnahme in die Session-Metadata geschrieben wird. Der Webhook
liest ausschließlich diese Momentaufnahme und löst die Zuordnung nicht erneut auf; damit kann ein
Klick, der nach dem Checkout-Start passiert, eine bereits laufende Bestellung nicht mehr umhängen.

Provisionssätze werden über eine einzige Tabelle `affiliate_conditions` aufgelöst, deren
Vorrangkette als generierte Spalte `specificity` in der Datenbank steht (Partner+Produkt 30,
Partner 20, Gruppe+Produkt 15, Gruppe 10, Produkt 5, sonst Programmstandard); eine zeitlich
befristete Aktionskondition ist dieselbe Zeile mit `valid_from`/`valid_to`. Der gewählte Satz und
alle Programmparameter, die in die Rechnung eingingen, werden als `condition_snapshot` jsonb in die
Buchungszeile eingefroren, sodass jede Zeile ohne jede andere Tabelle nachrechenbar ist.

Abgedeckt sind: Einmalkauf, Abonnement mit den drei Modi „nur erste Rate", „erste n Raten", „alle
Raten", Ratenzahlung (bei Stripe ein Abo mit fester Anzahl, fällt unter „erste n Raten"), Upsell
(jede weitere Checkout-Session durchläuft dieselbe Zuordnungskette und erzeugt eine eigene Zeile),
zweistufige Provision (Werber-Werber, genau eine Stufe), Sicherheitseinbehalt als eigene
Buchungszeile, anteiliger Storno bei Teilerstattung, Rückbuchung bei Chargeback samt Wiedergutschrift
bei gewonnenem Dispute, Handbuchung mit Pflichtbegründung, Auszahlung per SEPA-XML und PayPal-CSV mit
Gutschrift-PDF nach § 14 Abs. 2 UStG und automatisch bestimmtem Steuermodus.

Für den Mandanten gibt es sieben Admin-Seiten unter `/admin/affiliate/*`, für den Partner acht
Seiten unter `/partner/*` auf der Mandanten-Domain mit dessen Branding, für den Betreiber einen
Feature-Schalter und eine Nur-Lese-Aufsicht unter `/portal/affiliate`.

### 1.2 Was bewusst nicht gebaut wird

Kurzfassung; die vollständige Begründung je Punkt steht in Abschnitt 13. Nicht gebaut werden:
Umsatz- und Verkaufsstaffelung, mehr als zwei Vergütungsstufen, Provision auf Klicks (CPC) und auf
Leads (CPL, Leads werden nur gezählt), Stripe Connect, Währungsumrechnung, echter Partner-Rabattcode
mit Preiseingriff (der Code funktioniert als Tracking-Träger, ohne Rabatt), KYC, automatische Sperre
bei Schwellenwerten, Cookie-Stuffing-Heuristik über Klickmuster, Doppelkonten-Erkennung,
mandantenübergreifender Programm-Marktplatz, Partner-Stufen mit Auf- und Abstieg, DATEV-Export,
Postback an Partnersysteme, mehrere Programme je Mandant, Partner-Import per CSV, Sub-Accounts,
Landingpage-Rotation, QR-Codes, Statistik je einzelnem Werbemittel.

### 1.3 Drei Grenzen, die keine Softwareentscheidung sind

Erstens: die Plattform ist heute Merchant of Record für alle Mandanten. Es gibt genau einen globalen
`STRIPE_SECRET_KEY` (`src/lib/stripe/client.ts:27`), kein Stripe Connect, kein `stripe_account`, kein
`on_behalf_of`. Das Geld eines Mandantenverkaufs landet also nie beim Mandanten, sondern beim
Betreiber. Eine Affiliate-Provision, die „der Mandant zahlt", ist damit betriebswirtschaftlich eine
Verbindlichkeit des Betreibers gegenüber dem Partner, die der Betreiber gegenüber dem Mandanten
verrechnen muss. Dieser Verrechnungsweg ist Teil dieses Plans (Abschnitt 7.7), aber die
kaufmännische Entscheidung dahinter gehört Josip (Abschnitt 12.1).

Zweitens: `automatic_tax` ist in keinem der beiden Checkout-Pfade gesetzt
(`src/lib/stripe/checkout.ts:122-141`, `src/lib/marketplace/checkout.ts:115-131`). Damit ist
`session.total_details.amount_tax` heute für jede Bestellung 0 und die Nettobasis identisch mit dem
Bruttobetrag. Ein Partnervertrag, der „20 % vom Nettoumsatz" zusagt, wäre ab dem ersten Tag um 19 %
falsch. Entweder wird `automatic_tax` aktiviert oder die Basis heißt im Vertrag ehrlich
„Bruttopreis" (Abschnitt 12.2).

Drittens: es gibt keinerlei Einwilligungs-Infrastruktur im Repo — kein Banner, keine Komponente,
keine Tabelle — und `messages/de.json:1983` behauptet wörtlich „Kein Tracking, keine Werbe-Cookies".
Ein Attributions-Cookie ist nach § 25 TDDDG einwilligungspflichtig. Block B2 dieses Plans baut das
Minimum; ohne ihn darf B3 nicht scharfgeschaltet werden.

---

## 2. Grundsatzentscheidungen

**G1 — Outbox statt Direktbuchung im Webhook.** Der Stripe-Webhook tut für Affiliate genau eine
Sache: er schreibt eine Zeile in `affiliate_events` (`unique(stripe_event_id)`). Die gesamte
Provisionslogik läuft danach im Cron-Verarbeiter. Grund: dieses Repo hat die Gegenprobe schon zweimal
bezahlt — der `marketplace_ledger`-Upsert loggt bei Fehler nur (`src/lib/marketplace/fulfil.ts:229-231`,
Zeile dauerhaft verloren), und der K1-Fund war „bezahlt, kein Zugriff". Mit der Outbox kann ein Fehler
in der Affiliate-Logik die Kauferfüllung strukturell nicht brechen, ein fehlgeschlagenes Ereignis
bleibt mit `attempts`/`last_error` sichtbar liegen statt still zu verschwinden, und „Warten" wird ein
gültiger Zustand für Ereignisse, die Stripe außer der Reihe zustellt (`invoice.paid` vor
`checkout.session.completed`).

**G2 — Die Aufnahme in die Outbox wirft trotzdem, nach der Zugriffsgewähr.** Ein reines fail-soft
`console.error` beim Insert wäre exakt der Fehler, den G1 vermeiden will, nur eine Ebene früher.
Deshalb: `recordAffiliateEvent()` wird im Webhook NACH `enrollFromProduct()` (also nach der
Zugriffsgewähr) aufgerufen und wirft bei jedem Fehler außer `23505` (Unique-Verletzung = normaler
Stripe-Retry). Der Webhook antwortet dann 500, Stripe stellt erneut zu, der Käufer hat seinen Zugriff
bereits. Zusätzlich gibt es einen Nachhol-Lauf über `stripe.events.list`, der Ereignisse einsammelt,
die während eines Ausfalls durch das Stripe-Retry-Fenster gefallen sind (Abschnitt 6.6).

**G3 — Idempotenz ausschließlich über eine einzige Textachse `unique (tenant_id, dedup_key)`.**
`isNewOrder` (`src/app/api/stripe/webhook/route.ts:132`) wird nirgends benutzt: wirft ein späterer
Schritt, antwortet der Webhook 500, beim Retry existiert die Order bereits, `isNewOrder` ist `false`,
und alles daran Gehängte feuert nie. Ein einziger Textschlüssel statt partieller Unique-Indizes,
weil partielle Indizes auf `(order_id, partner_id, kind)` Gegenbuchungen, Wiedergutschriften und
Handbuchungen ungeschützt lassen — genau die Zeilen, bei denen eine Doppelbuchung Geld kostet.

**G4 — Provisionszeilen sind unveränderlich; Korrektur läuft ausschließlich über eine neue Zeile.**
Ein `before update`-Guard setzt jede Spalte außer `status`, `payout_id`, `paid_at`, `flagged`,
`flag_reason`, `note` und `updated_at` auf `old` zurück — ohne Rollen-Erlaubnisliste, also auch für
`service_role`. Das ist der Unterschied zwischen einem Berechtigungs-Guard und einem
Buchhaltungs-Guard: der Beleg, der aus diesen Zeilen entsteht, ist zehn Jahre aufbewahrungspflichtig
und muss aus den Daten reproduzierbar bleiben. `hold_until` darf nur nach vorn verschoben werden
(Prüfung anhängen), nie nach hinten.

**G5 — Der Sicherheitseinbehalt ist eine eigene physische Zeile, kein Attribut.** Aus einer
Bestellung entstehen zwei Zeilen: `kind='sale'` mit `hold_until = now + hold_days` und
`kind='reserve'` mit `hold_until = now + reserve_days`. Grund: mit einem `reserve_cents`-Attribut auf
einer Zeile weicht der angezeigte Saldo zwangsläufig vom Auszahlungslauf ab — der Lauf sammelt eine
Zeile entweder ganz oder gar nicht ein, während die Saldoformel einen Teilbetrag ausweist. Mit zwei
Zeilen ist „in Reserve" eine Summe und keine Zwischenrechnung, und beide Zahlen können nicht
auseinanderlaufen.

**G6 — Der Status einer bereits gebuchten Zeile wird beim Storno NIE geändert.** Eine Erstattung
erzeugt eine neue Zeile `kind='reversal'` mit negativem Betrag und `reverses_id` auf die Ursprungszeile.
Würde man zusätzlich die Ursprungszeile auf `reversed` setzen, fiele sie aus dem Saldo, und die
negative Zeile zöge denselben Betrag ein zweites Mal ab. Die Gegenbuchung erbt den Status-Eimer ihres
Elternteils: ist das Elternteil `pending`/`on_hold`, bekommt die Gegenbuchung denselben Status und
dasselbe `hold_until` und netzt dort aus; ist es `approved`/`paid`, ist die Gegenbuchung sofort
`approved` mit `hold_until = now()`, damit eine Schuld die nächste Auszahlung sofort mindert und nicht
erst in 30 Tagen.

**G7 — Erstattungsbeträge von Stripe sind kumulativ, also wird ein Zielwert berechnet und daraus
das Delta gebucht.** `charge.amount_refunded` ist laut Typdefinition
(`node_modules/stripe/types/Charges.d.ts:35`) der GESAMTE bisher erstattete Betrag. Die Regel lautet
deshalb: `ziel = floor(zeile.amount_cents * kumulativ_erstattet / charge_betrag)`, gebucht wird
`ziel - bereits_storniert`. Ein Deckel auf 100 % ist kein Ersatz dafür: zwei Teilerstattungen von je
20 % ergäben mit Deckel 60 % Storno. Der Zielwert-Ansatz hat zusätzlich den Nebeneffekt, dass bei
vollständiger Erstattung `kumulativ = charge_betrag` gilt und der Zielwert exakt dem Ursprungsbetrag
entspricht — es bleibt kein Rundungsrest im Buch stehen.

**G8 — `payout_id` wird beim Entwurf gestempelt, `status='paid'` erst nach der Überweisung.** Der
Entwurf reserviert die Zeilen per Compare-and-Swap im `update` selbst (Muster `markPayoutPaid()`,
`src/lib/platform/marketplace.ts:561`) und friert damit den Betrag ein, lässt sie aber auf
`approved`. Zwischen Entwurf und Bankabgleich als „ausgezahlt" zu führen wäre eine Falschdarstellung:
eine Erstattung in diesem Fenster würde gegen angeblich schon geflossenes Geld buchen.

**G9 — Partner sind keine `memberships`-Rolle.** Eine Rolle `affiliate` in `memberships` wäre exakt
der Gast-Fund vom 03.08.2026: `member_role()` würde sie zurückgeben und damit rund dreißig Policies
öffnen, die auf `member_role(tenant_id) is not null` prüfen — der Partner läse den kompletten
veröffentlichten Kursbestand. Partner werden ausschließlich über die Security-Definer-Funktion
`affiliate_partner_id(tenant)` erkannt.

**G10 — Geld- und Personaldaten prüfen `member_role(t) in ('owner','admin')`, nie `is_staff()`.**
`is_staff()` schließt `trainer` ein (`0001_init.sql:63-69`). Dieselbe Begründung wie beim
Schichtkalender (`20260807142619_shift_calendar.sql:30-34`). Eine zusätzliche Tabelle
`affiliate_managers` für Nicht-Mitglieder wird bewusst NICHT gebaut: sie wäre ohne eigene RLS ein
vollständiger Cross-Tenant-Bruch, und selbst mit RLS erreichte ein Manager ohne Mitgliedschaft die
Oberfläche nie, weil `src/app/(admin)/admin/layout.tsx:18` `checkStaffAccess()` verlangt.

**G11 — Der Klick-Endpunkt leitet ausschließlich relativ um.** Das Ziel ist nie eine URL aus dem
Query-String, sondern ein Schlüssel gegen ein festes Muster, aus dem ein Pfad gebaut wird; die
Antwort ist `NextResponse.redirect(new URL(pfad, request.url), 302)`. Damit bleibt der Redirect auf
demselben Host, auf dem das host-only Cookie gesetzt wird. Ein Ziel über `buildTenantUrl()` wäre ein
Fehler: kommt die Anfrage auf `{slug}.calltalent.ai` an, während der Mandant eine Custom Domain hat,
setzte der Endpunkt sein Cookie auf dem Anfrage-Host und leitete auf einen anderen Origin um — das
Cookie wäre wirkungslos, und die naheliegende „Reparatur" (`domain`-Attribut) wäre eine
mandantenübergreifende Zuordnung.

**G12 — Alle Beträge in Ganzzahl-Cent, alle Sätze in Basispunkten, `Math.floor` überall außer beim
Steuerbetrag.** Kein `numeric`, kein Float. Genau ein Rundungsschritt je Buchungszeile, nie je
Position. Der Steuerbetrag auf der Gutschrift ist die einzige Stelle mit kaufmännischer Rundung, weil
er eine Endsumme ist und keine zu verteilende Größe; das steht als Kommentar in der Funktion.

**G13 — Der Provisionsbetrag wird aus tatsächlich vereinnahmtem Geld gerechnet.** Basis einer
Abo-Rate ist `invoice.amount_paid`, nicht `invoice.total`. Wird ein Kundenguthaben (Proration,
Kulanz) auf eine Rechnung angerechnet, ist `total > amount_paid` — der Händler zahlte sonst Provision
auf Geld, das nie geflossen ist. Für `checkout.session.completed` ist `session.amount_total` der
vereinnahmte Betrag.

**G14 — Ein abgeschlossener Abrechnungszeitraum ist gesperrt.** `affiliate_programs.books_closed_until`
(date, nullable) wird beim Erzeugen einer Gutschrift auf `period_to` gesetzt. Die Buchungs-RPC weist
jede Zeile ab, deren `booked_at` in einen abgeschlossenen Zeitraum fiele, und bucht sie stattdessen
mit dem heutigen Datum in die laufende Periode, vermerkt in `note`. Ohne diese Sperre kann eine spät
verarbeitete Outbox-Zeile in einen Zeitraum datieren, für den bereits ein Beleg existiert.

**G15 — Ein Programm-Manager darf keine Vorgänge freigeben, in denen er selbst Partner ist.** Weder
die eigene Bewerbung, noch die eigene Sonderkondition, noch eine Auszahlung an sich selbst, noch das
Lösen eines `flagged` an einer eigenen Zeile. Durchgesetzt im Guard-Trigger und zusätzlich in der
Server Action; jeder Versuch erzeugt einen Audit-Eintrag. Ohne diese Regel ist die
Selbst-Empfehlungssperre wirkungslos, weil derselbe Mensch über den Verdachtsfall entscheidet.

**G16 — Keine neue npm-Abhängigkeit.** Das Worker-Größenlimit ist 3 MiB gzip im Free Plan, belegt in
`src/lib/email/client.ts:19-28` (das `resend`-Paket musste deshalb weichen). SEPA-XML wird per
String-Templating gebaut, das Gutschrift-PDF über das bereits gebündelte `pdf-lib` samt der
eingebetteten Montserrat aus `src/lib/certificates/pdf.ts`, Diagramme als handgeschriebenes SVG.

**G17 — Genau eine SELECT-Policy je Tabelle, getrennte Schreib-Policies.** Eine zweite permissive
Policy kann einer bestehenden nichts wegnehmen (sie werden ver-ODER-t) und kostet Auswertungszeit pro
Zeile. Eine einschränkend gemeinte Bedingung muss IN die konsolidierte SELECT-Policy hinein. Die
`for all ... using(false)`-Deny-Policy wird trotzdem gesetzt, aber ausschließlich als auditierbare
Absichtserklärung für den Linter — der tatsächliche Schutz ist `revoke all` plus das Fehlen von
Schreib-Policies. Dieser Satz gehört wörtlich in jeden Migrationskopf, sonst liest ein späterer
Reviewer die Zeile als Grenze, die sie nicht ist.

**G18 — Der Klick-Endpunkt geht ohne Cloudflare-WAF-Regel nicht live.** Der Postgres-Rate-Limiter
(`src/lib/security/rate-limit.ts:29-34`) ist ein HTTP-Rundlauf mit schreibendem Statement, dessen
`on conflict (key) do update` alle gleichzeitigen Anfragen auf dieselbe Zeile serialisiert, ohne
Aufräumen und fail-open. Er läuft als Grundschutz mit, aber der eigentliche Schutz ist eine
Rate-Limiting-Regel auf der Route in der Cloudflare-Zone. Zusätzlich begrenzt eine Prüfung gegen
`affiliate_daily_stats.clicks` die Zahl geschriebener Klickzeilen je Partner und Tag hart auf 50 000.

---

## 3. Datenmodell

Konventionen wie im Bestand: `snake_case`, Englisch, Präfix `affiliate_`, Beträge `int` in Cent mit
Suffix `_cents`, Sätze `int` in Basispunkten mit Suffix `_bp`, Status als
`text not null default … check (… in (…))` ohne Enum-Typen, `timestamptz`. Reihenfolge je Tabelle:
`create table` → `create index` → Guard-Trigger → `_touch`-Trigger → `enable row level security` →
`revoke` → Policies. Guard-Trigger heißen `<tabelle>_guard_trg`, Touch-Trigger `<tabelle>_touch`;
BEFORE-Trigger derselben Tabelle laufen alphabetisch, `g < t`, der Guard muss zuerst laufen
(`20260807171725:198-203`).

Cross-Tenant-Schutz: jede Kindtabelle trägt `unique (id, tenant_id)` und referenziert Eltern über
`(fremd_id, tenant_id)` (verbindlich seit `20260807142619_shift_calendar.sql:46-49`). Jeder
zusammengesetzte Fremdschlüssel bekommt einen Index auf BEIDE Spalten
(`20260807142948_shift_calendar_fk_indexes.sql:8-15`).

### 3.0 Änderungen an Bestandstabellen (Migration A0)

```sql
-- (a) Voraussetzung fuer die zusammengesetzten Fremdschluessel unten.
--     Beide Tabellen haben heute KEIN unique(id, tenant_id) (0001_init.sql:233-261).
alter table public.products add constraint products_id_tenant_uniq unique (id, tenant_id);
alter table public.orders   add constraint orders_id_tenant_uniq   unique (id, tenant_id);

-- (b) orders kennt heute nur 'refunded' als Ganz-oder-gar-nicht (0001_init.sql:258).
--     Eine TEILerstattung ist damit nicht abbildbar: 'paid' waere falsch (Geld ist
--     teilweise zurueck), 'refunded' ebenfalls (der Zugriff bleibt bestehen).
alter table public.orders add column refunded_cents int not null default 0
  check (refunded_cents >= 0);
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','paid','partially_refunded','refunded','failed'));

-- (c) charge.refunded traegt weder tenant_id noch order_id. Die einzige Bruecke ist
--     charge.payment_intent -> orders.stripe_payment_intent; die Spalte hat heute
--     weder Index noch Eindeutigkeit (0001_init.sql:255).
create unique index orders_stripe_payment_intent_uniq
  on public.orders (stripe_payment_intent)
  where stripe_payment_intent is not null;

-- (d) Ohne diese Erweiterung kann jeder Mandanten-Admin sein Affiliate-Modul selbst
--     freischalten: tenants_operator_settings_guard() schuetzt heute exakt sechs
--     Schluessel (20260909183548_tenants_column_guard.sql:91-98). Die Funktion bleibt
--     bewusst OHNE security definer - sie muss current_user sehen (:70-75).
create or replace function public.tenants_operator_settings_guard() ...
  betreiber_schluessel constant text[] := array[
    'payments_enabled','tutor_enabled','course_generator_enabled',
    'marketplace_enabled','shift_calendar_enabled','marketplace_commission_bp',
    'affiliate_enabled'                                              -- NEU
  ];
-- Rumpf unveraendert uebernehmen, Trigger neu binden (drop trigger if exists + create).
```

### 3.1 Hilfsfunktionen (Migration A0, vor allen Tabellen)

```sql
-- Partner-Identitaet des eingeloggten Nutzers. Ein Partner hat in der Regel KEINE
-- memberships-Zeile (G9) - member_role() liefert fuer ihn null.
create or replace function public.affiliate_partner_id(t uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from public.affiliate_partners p
  where p.tenant_id = t and p.user_id = auth.uid() and p.status = 'active'
  limit 1;
$$;

-- Geld- und Personaldaten: owner/admin, NICHT is_staff (schliesst trainer ein, G10).
create or replace function public.affiliate_is_manager(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(t) in ('owner','admin'), false);
$$;

-- Tier-2-Sicht: liefert die IDs der vom aufrufenden Partner geworbenen Partner.
-- BEWUSST eine Funktion statt eines "or referred_by = affiliate_partner_id(...)"-
-- Zweigs in der SELECT-Policy: RLS trennt keine Spalten, ein solcher Zweig gaebe dem
-- Werber per PostgREST die VOLLEN Zeilen seiner Geworbenen (application-jsonb,
-- internal_note, terms_accepted_ip_hash). Die Partner-Ansicht laedt diese Daten ueber
-- eine Server-Route mit expliziter Spaltenliste.
create or replace function public.affiliate_downline_ids(t uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.affiliate_partners p
  where p.tenant_id = t and p.referred_by = public.affiliate_partner_id(t);
$$;

revoke execute on function public.affiliate_partner_id(uuid)   from public;
revoke execute on function public.affiliate_partner_id(uuid)   from anon;
grant  execute on function public.affiliate_partner_id(uuid)   to authenticated, service_role;
-- identisch fuer affiliate_is_manager(uuid) und affiliate_downline_ids(uuid).
```

Der doppelte `revoke` ist Pflicht: Supabase vergibt `EXECUTE` an `anon` per
`alter default privileges` als eigenen Grant, `revoke from public` entfernt ihn nicht
(`20260907093000_revoke_new_rpcs_from_anon.sql:1-19`; aktuell 17–19 offene Advisor-WARNs dieser
Klasse). Nach jedem `create or replace` erneut setzen.

### 3.2 `affiliate_programs`

Die Konfigurationszeile des Programms: alles, was je Mandant genau einmal entschieden wird —
Standardkondition, Attributionsmodell, Sperrfristen, Abo-Modus, Zweitstufe, Partnerbedingungen.

```sql
create table public.affiliate_programs (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  status                text not null default 'draft' check (status in ('draft','active','paused')),
  visibility            text not null default 'private' check (visibility in ('private','link','public')),
  approval_mode         text not null default 'manual' check (approval_mode in ('manual','auto')),

  -- Standardkondition (unterste Stufe der Vorrangkette)
  rate_kind             text not null default 'percent' check (rate_kind in ('percent','fixed')),
  rate_bp               int  not null default 2000 check (rate_bp between 0 and 10000),
  fixed_cents           int  not null default 0 check (fixed_cents >= 0),
  min_commission_cents  int  check (min_commission_cents is null or min_commission_cents >= 0),
  max_commission_cents  int  check (max_commission_cents is null or max_commission_cents >= 0),

  -- Provisionsbasis
  basis_kind            text not null default 'net' check (basis_kind in ('net','gross')),
  fee_deduction_bp      int  not null default 0 check (fee_deduction_bp between 0 and 10000),
  currency              text not null default 'eur',

  -- Attribution
  attribution_model     text not null default 'last' check (attribution_model in ('last','first')),
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
  books_closed_until    date,                    -- G14, gesetzt beim Erzeugen einer Gutschrift

  -- Texte
  description_md        text not null default '',
  terms_text            text not null default '',
  terms_version         int  not null default 1 check (terms_version >= 1),
  application_note      text not null default '',
  application_fields    jsonb not null default '[]'::jsonb,

  test_mode             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id),                            -- v1: genau ein Programm je Mandant
  unique (id, tenant_id),
  check (max_commission_cents is null or min_commission_cents is null
         or max_commission_cents >= min_commission_cents),
  check (reserve_days >= hold_days)              -- die Reserve laeuft nie vor der Sperrfrist ab
);
create index affiliate_programs_tenant_idx on public.affiliate_programs (tenant_id, status);
create trigger affiliate_programs_touch before update on public.affiliate_programs
  for each row execute function public.set_updated_at();

alter table public.affiliate_programs enable row level security;
revoke all on public.affiliate_programs from anon, authenticated;
grant select, insert, update on public.affiliate_programs to authenticated;

create policy affiliate_programs_select on public.affiliate_programs for select using (
  public.affiliate_is_manager(tenant_id)
  or public.affiliate_partner_id(tenant_id) is not null
);
create policy affiliate_programs_manager_insert on public.affiliate_programs for insert
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_programs_manager_update on public.affiliate_programs for update
  using (public.affiliate_is_manager(tenant_id))
  with check (public.affiliate_is_manager(tenant_id));
-- Kein DELETE: ein Programm mit Buchungshistorie darf nicht verschwinden.
```

Die öffentliche Programmseite liest NICHT über eine `anon`-Policy, sondern über
`createAdminClient()` mit ausdrücklicher Spaltenliste — exakt das Muster von
`src/lib/marketplace/catalog.ts`, dessen Test (`catalog.test.ts:145`) festhält, dass nie interne
Spalten herausfallen. `terms_text` und `books_closed_until` gehören nicht in diese Liste.

Ein `before update`-Guard `affiliate_programs_guard()` pinnt `id`, `tenant_id`, `created_at` und
`books_closed_until` (letzteres nur per `service_role` änderbar) auf `old` und verhindert damit, dass
ein Admin einen abgeschlossenen Zeitraum wieder öffnet.

### 3.3 `affiliate_partners`

Ein Partner des Programms mit Status, Code, Werber-Beziehung und Zustimmungsnachweis. `user_id` ist
nullable, weil eine öffentliche Bewerbung kein Konto voraussetzen darf — dasselbe Muster wie
`memberships.invited_email` (`0001_init.sql:44-47`); bei Freigabe geht eine Einladung mit
`buildSetPasswordLink()` (`src/lib/users/import.ts:196`) raus.

```sql
create table public.affiliate_partners (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  program_id    uuid not null,
  user_id       uuid references public.profiles(id) on delete set null,
  applicant_email text not null,           -- normalisiert: lower(trim(...)), +suffix entfernt
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
  terms_accepted_ip_hash text,             -- HMAC mit STATISCHEM Salz (siehe 11.6)

  notify_sale     boolean not null default true,
  notify_reversal boolean not null default true,
  notify_payout   boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),                -- je Mandant, NICHT global
  unique (tenant_id, program_id, applicant_email),
  unique (id, tenant_id),
  check (referred_by is null or referred_by <> id),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (group_id,   tenant_id) references public.affiliate_groups   (id, tenant_id) on delete set null,
  foreign key (referred_by, tenant_id) references public.affiliate_partners (id, tenant_id) on delete set null
);
create unique index affiliate_partners_user_uniq
  on public.affiliate_partners (tenant_id, user_id) where user_id is not null;
create index affiliate_partners_program_idx  on public.affiliate_partners (program_id, tenant_id, status);
create index affiliate_partners_group_idx    on public.affiliate_partners (group_id, tenant_id);
create index affiliate_partners_referred_idx on public.affiliate_partners (referred_by, tenant_id);
create index affiliate_partners_user_idx     on public.affiliate_partners (user_id) where user_id is not null;
```

`unique (tenant_id, code)` und nicht global: der Auflösungspfad im Klick-Endpunkt ist immer
`where tenant_id = <aus Host> and code = <aus Link>`. Ein globaler Namensraum wäre gleichzeitig ein
Datenleck (Codes eines Mandanten in einem anderen auflösbar) und ein Attributionsfehler.

Guard-Trigger, Spaltendelta (eine `with check`-Bedingung sieht nur die neue Zeile und kann kein
Delta ausdrücken, `20260807142619:518-521`):

```sql
create or replace function public.affiliate_partners_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- IMMER old.tenant_id pruefen, nie new.tenant_id: die new-Pruefung war der echte
  -- Cross-Tenant-Weg in 20260807173156:1-31 (wer in Mandant B Admin ist, schickte
  -- tenant_id=B mit und der Spaltenschutz entfiel komplett).
  if public.affiliate_is_manager(old.tenant_id) then
    -- G15: der Manager darf die Zeile, in der er selbst Partner ist, nicht freigeben
    -- oder entsperren.
    if old.user_id = auth.uid() and new.status is distinct from old.status then
      raise exception 'affiliate_self_approval_forbidden';
    end if;
    new.id := old.id; new.tenant_id := old.tenant_id; new.program_id := old.program_id;
    new.user_id := old.user_id; new.created_at := old.created_at;
    new.applicant_email := old.applicant_email;
    -- Der Code ist Teil der Attributionshistorie und nach der ersten Buchung fix.
    if exists (select 1 from public.affiliate_commissions c
               where c.tenant_id = old.tenant_id and c.partner_id = old.id) then
      new.code := old.code;
    end if;
    return new;
  end if;

  -- Selbstpflege durch den Partner: NEW bleibt nur fuer display_name, company,
  -- die drei notify_*-Schalter und die Zustimmungsfelder.
  new.id := old.id; new.tenant_id := old.tenant_id; new.program_id := old.program_id;
  new.user_id := old.user_id; new.applicant_email := old.applicant_email;
  new.code := old.code; new.status := old.status; new.status_reason := old.status_reason;
  new.group_id := old.group_id; new.referred_by := old.referred_by;
  new.payout_hold := old.payout_hold; new.payout_hold_reason := old.payout_hold_reason;
  new.internal_note := old.internal_note; new.application := old.application;
  new.created_at := old.created_at;
  -- Zustimmung ist einseitig: setzbar, nie zuruecksetzbar.
  if old.terms_accepted_at is not null
     and coalesce(new.terms_version_accepted, 0) < coalesce(old.terms_version_accepted, 0) then
    new.terms_version_accepted := old.terms_version_accepted;
    new.terms_accepted_at      := old.terms_accepted_at;
    new.terms_accepted_ip_hash := old.terms_accepted_ip_hash;
  end if;
  return new;
end; $$;
create trigger affiliate_partners_guard_trg before update on public.affiliate_partners
  for each row execute function public.affiliate_partners_guard();
create trigger affiliate_partners_touch     before update on public.affiliate_partners
  for each row execute function public.set_updated_at();
```

Zweite Ebene sind Spaltenrechte, weil RLS keine Spalten trennt (Muster
`20260909183548_tenants_column_guard.sql:31-46`). `code`, `user_id`, `tenant_id`, `program_id` und
`applicant_email` sind für `authenticated` gar nicht schreibbar; die Rollentrennung innerhalb der
erlaubten Spalten leistet der Guard oben:

```sql
revoke update on public.affiliate_partners from anon, authenticated;
grant update (display_name, company, notify_sale, notify_reversal, notify_payout,
              terms_version_accepted, terms_accepted_at, terms_accepted_ip_hash,
              status, status_reason, group_id, referred_by,
              payout_hold, payout_hold_reason, internal_note)
  on public.affiliate_partners to authenticated;
```

RLS. Der Werber-Zweig steht bewusst NICHT in der Policy (siehe `affiliate_downline_ids()` in 3.1);
Spalten wie `internal_note`, `status_reason` und `application` sind zusätzlich per Spaltenrecht vom
Partner selbst ferngehalten:

```sql
alter table public.affiliate_partners enable row level security;
revoke select on public.affiliate_partners from anon, authenticated;
grant select (id, tenant_id, program_id, user_id, display_name, company, code, status,
              group_id, referred_by, payout_hold, payout_hold_reason,
              terms_version_accepted, terms_accepted_at,
              notify_sale, notify_reversal, notify_payout, created_at, updated_at)
  on public.affiliate_partners to authenticated;

create policy affiliate_partners_select on public.affiliate_partners for select using (
  public.affiliate_is_manager(tenant_id) or user_id = (select auth.uid())
);
create policy affiliate_partners_manager_insert on public.affiliate_partners for insert
  with check (public.affiliate_is_manager(tenant_id));
create policy affiliate_partners_update on public.affiliate_partners for update
  using (public.affiliate_is_manager(tenant_id) or user_id = (select auth.uid()))
  with check (public.affiliate_is_manager(tenant_id) or user_id = (select auth.uid()));
create policy affiliate_partners_manager_delete on public.affiliate_partners for delete
  using (public.affiliate_is_manager(tenant_id) and status in ('pending','rejected'));
```

`(select auth.uid())` gekapselt (Advisor `auth_rls_initplan`, `20260712233000:4-10`); die
Security-Definer-Helfer bewusst nicht — sie sind `stable`. Das DELETE nur aus unkritischen Status ist
Vorbild `ml_staff_delete` (`20260804090000:27-31`): ein Partner mit Buchungshistorie darf nie
gelöscht werden, sonst reißt der Prüfpfad; für DSGVO gibt es Anonymisierung (Abschnitt 7.8).

Vollständige Manager-Spalten (`internal_note`, `application`, `status_reason`,
`terms_accepted_ip_hash`) liest die Admin-Oberfläche über eine Server-Route mit
`requireAdminTenant()` und `createAdminClient()`.

### 3.4 `affiliate_groups`

Partnergruppen als Träger einer gemeinsamen Kondition, damit eine Sonderkondition für zwanzig
Partner nicht zwanzigmal gepflegt werden muss.

```sql
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
create index affiliate_groups_program_idx on public.affiliate_groups (program_id, tenant_id);
-- RLS: SELECT fuer affiliate_is_manager ODER affiliate_partner_id(tenant_id) is not null
--      (der Partner darf den Namen seiner Gruppe sehen), Schreiben nur Manager.
```

Die Gruppe trägt selbst keinen Satz — der steht als `affiliate_conditions`-Zeile mit
`scope_group_id`. Damit gibt es genau einen Ort, an dem Sätze stehen, und die Vorrangkette bleibt
eine einzige Sortierung.

### 3.5 `affiliate_conditions`

Die vollständige Vorrangkette der Provisionssätze als eine Tabelle; die Rangfolge ist eine generierte
Spalte und damit nicht durch einen Tippfehler kippbar.

```sql
create table public.affiliate_conditions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  program_id  uuid not null,
  partner_id  uuid,                        -- null = alle Partner
  group_id    uuid,                        -- null = alle Gruppen
  product_id  uuid,                        -- null = alle Produkte
  rate_kind   text not null default 'percent' check (rate_kind in ('percent','fixed')),
  rate_bp     int  not null default 0 check (rate_bp between 0 and 10000),
  fixed_cents int  not null default 0 check (fixed_cents >= 0),
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  specificity int generated always as (
      (case when partner_id is not null then 20 else 0 end)
    + (case when group_id   is not null then 10 else 0 end)
    + (case when product_id is not null then  5 else 0 end)
  ) stored,
  check (valid_to is null or valid_to > valid_from),
  check (num_nonnulls(partner_id, group_id) <= 1),
  check (num_nonnulls(partner_id, group_id, product_id) >= 1),
  unique (id, tenant_id),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade,
  foreign key (group_id,   tenant_id) references public.affiliate_groups   (id, tenant_id) on delete cascade,
  foreign key (product_id, tenant_id) references public.products           (id, tenant_id) on delete cascade
);
create index affiliate_conditions_lookup_idx
  on public.affiliate_conditions (tenant_id, program_id, specificity desc, valid_from desc);
create index affiliate_conditions_partner_idx on public.affiliate_conditions (partner_id, tenant_id);
create index affiliate_conditions_group_idx   on public.affiliate_conditions (group_id, tenant_id);
create index affiliate_conditions_product_idx on public.affiliate_conditions (product_id, tenant_id);

-- Ueberschneidungsfreiheit je Geltungsbereich. btree_gist ist bereits installiert
-- (20260807142619:63) und wird NICHT verschoben - sie hat Abhaengige.
alter table public.affiliate_conditions add constraint affiliate_conditions_no_overlap
  exclude using gist (
    tenant_id  with =, program_id with =,
    coalesce(partner_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    coalesce(group_id,   '00000000-0000-0000-0000-000000000000'::uuid) with =,
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    tstzrange(valid_from, valid_to) with &&
  );
```

Eine Kategorie-Stufe ist bewusst NICHT vorgesehen: `course_categories` hängt an `courses`
(`20260722180000:47`), ein Produkt trägt `course_ids[]` (`0001_init.sql:238`), es gibt also keine
eine Kategorie je Bestellung. Ein solcher Spezifitätsrang wäre eine Spalte, die nie gefüllt wird.

RLS: SELECT für Manager sowie für den betroffenen Partner (`partner_id = affiliate_partner_id(tenant_id)`
oder `partner_id is null` — er darf sehen, welcher Satz für ihn gilt), Schreiben nur Manager. G15:
der Guard weist ein `insert`/`update` ab, dessen `partner_id` auf die eigene Partnerzeile des
Aufrufers zeigt.

### 3.6 `affiliate_clicks`

Die Rohaufzeichnung jedes Klicks auf einen Partnerlink — Prüfpfad und Betrugsbasis, nicht
Statistikquelle. Die schnellstwachsende Tabelle des Moduls, deshalb schlank, indexarm, mit
90-Tage-Löschfrist.

```sql
create table public.affiliate_clicks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  program_id    uuid not null,
  partner_id    uuid not null,
  campaign      text,
  landing_path  text,                      -- validierter INTERNER Pfad, nie eine fremde URL
  referrer_host text,                      -- nur Host, nie die volle Referrer-URL
  ua_family     text,                      -- grobe Klasse, nie der volle User-Agent
  country       text check (country is null or country ~ '^[A-Z]{2}$'),
  ip_hash       text,                      -- HMAC(Tagessalz, IP), nie die IP
  is_bot        boolean not null default false,
  consent_at    timestamptz,               -- gesetzt, wenn ein Cookie gesetzt werden durfte
  dedup_key     text not null,             -- sha256(partner|ip_hash|ua_family|YYYYMMDDHH)
  created_at    timestamptz not null default now(),
  unique (tenant_id, dedup_key),
  unique (id, tenant_id),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade
);
create index affiliate_clicks_partner_idx on public.affiliate_clicks (partner_id, tenant_id, created_at desc);
create index affiliate_clicks_cleanup_idx on public.affiliate_clicks (created_at);
```

Kein `updated_at` und kein `_touch`-Trigger: Klickzeilen werden nie geändert, und ein `updated_at`
ohne Trigger veraltet dauerhaft (`20260803100100:53-60`).

Die Deduplizierung ist damit ein Constraint statt einer Abfrage: `insert … on conflict
(tenant_id, dedup_key) do nothing`, ein Statement, kein Vorab-SELECT, Fenster eine Stunde. `ip_hash`
ist HMAC-SHA-256 mit einem täglich rotierenden Salz aus `SUPABASE_SERVICE_ROLE_KEY` plus Datum,
domänenpräfixiert wie in `src/lib/contact/form-token.ts:59-64` — reicht für Dedup und Tagesheuristik,
macht die Zeile nach Rotation faktisch nicht mehr rückführbar.

Spaltenrechte als zweite Ebene, weil RLS keine Spalten trennt: `ip_hash` und `ua_family` erreichen
damit niemals einen Browser, auch nicht den eines Mandanten-Admins.

```sql
alter table public.affiliate_clicks enable row level security;
revoke all on public.affiliate_clicks from anon, authenticated;
grant select (id, tenant_id, program_id, partner_id, campaign, landing_path,
              referrer_host, country, is_bot, created_at)
  on public.affiliate_clicks to authenticated;
create policy affiliate_clicks_select on public.affiliate_clicks for select
  using (public.affiliate_is_manager(tenant_id));
-- Absichtserklaerung fuer den Linter, KEIN Schutz (G17): der Schutz ist das
-- 'revoke all' oben plus das Fehlen jeder INSERT/UPDATE/DELETE-Policy.
create policy affiliate_clicks_deny_write on public.affiliate_clicks
  for all to anon, authenticated using (false) with check (false);
```

Partner sehen Klicks ausschließlich aggregiert über `affiliate_daily_stats`. Geschrieben wird
ausschließlich vom Klick-Endpunkt über `service_role`. Partitionierung ist aufgeschoben; die
Tagesaggregate plus der Löschlauf kaufen die Laufzeit, und eine spätere Partitionierung nach Monat
ändert keine Abfrage, weil die Statistik nie aus dieser Tabelle kommt.

### 3.7 `affiliate_referrals`

Der serverseitige Zuordnungszustand: eine unveränderliche Zeile je Klick mit einem undurchsichtigen
Token, die Cookie und Gerät überdauert und als Momentaufnahme in die Stripe-Metadata wandert.

```sql
create table public.affiliate_referrals (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  program_id  uuid not null,
  partner_id  uuid not null,
  click_id    uuid,
  token       text not null,               -- 32 Zufallsbytes hex, undurchsichtig
  campaign    text,
  user_id     uuid references public.profiles(id) on delete set null,
  bound_at    timestamptz,
  status      text not null default 'active' check (status in ('active','superseded','revoked')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, token),
  unique (id, tenant_id),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade,
  foreign key (click_id,   tenant_id) references public.affiliate_clicks   (id, tenant_id) on delete set null
);
create index affiliate_referrals_user_idx on public.affiliate_referrals
  (tenant_id, user_id, created_at desc) where user_id is not null;
create index affiliate_referrals_live_idx on public.affiliate_referrals
  (tenant_id, program_id, expires_at) where status = 'active';
create index affiliate_referrals_partner_idx on public.affiliate_referrals (partner_id, tenant_id);
```

Die Zeile wird nicht verbraucht: sie kann viele Bestellungen tragen (Upsell, Ratenzahlung, Abo). Ein
Nachfolgerklick setzt die Vorgängerzeile auf `superseded` und legt eine neue an — er überschreibt sie
nie. Genau daran hängt G-Entscheidung „Schnappschuss": weil die Zeile unveränderlich ist, bedeutet
das Token in der Stripe-Metadata dauerhaft denselben Partner. Ein Upsert auf `(tenant_id, user_id)`
wäre das Gegenteil und würde exakt das Umhängen erlauben, das der Schnappschuss verhindern soll.

Eine Referral-Zeile mit gesetztem `user_id` und ohne zugehörige Bestellung ist zugleich der Lead
(Rechercheliste Gruppe 9, „Leads/Registrierungen") — dafür braucht es keine eigene Tabelle.

RLS: SELECT nur `affiliate_is_manager`; kein Client-Schreibzugriff, `revoke all`, Deny-Policy als
Absichtserklärung. Der Partner sieht Leads nur aggregiert.

### 3.8 `affiliate_customer_bindings`

Die Lifetime-Bindung eines Kunden an genau einen Partner, getrennt von `affiliate_referrals`, weil
sie eine andere Lebensdauer (dauerhaft statt `cookie_ttl_days`) und eine andere Eindeutigkeit hat
(genau ein Partner je Kunde und Programm).

```sql
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
create index affiliate_customer_bindings_partner_idx
  on public.affiliate_customer_bindings (partner_id, tenant_id);
```

Die Bindung hängt an der Kunden-ID, nicht an der E-Mail: E-Mail-Bindung ist über Adresswechsel,
Groß-/Kleinschreibung und Plus-Adressen angreifbar. Geschrieben wird mit `on conflict do nothing` —
die erste Bindung gewinnt, eine Änderung läuft ausschließlich über die Umbuchung mit Prüfpfad.

### 3.9 `affiliate_subscription_bindings`

Die Zuordnung eines Stripe-Abonnements zu einem Partner samt kopierter Abo-Regel und einem
DB-seitigen Zähler; ohne sie ist eine Folgerate nicht zuordenbar, weil `invoice.paid` keine
Session-Metadata trägt (`src/app/api/stripe/webhook/route.ts:386`).

```sql
create table public.affiliate_subscription_bindings (
  stripe_subscription_id text primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  program_id     uuid not null,
  partner_id     uuid not null,
  referral_id    uuid,
  origin_commission_id uuid,               -- die sale-Zeile der ersten Rate (Satz-Snapshot)
  recurring_mode text not null check (recurring_mode in ('first_only','n_periods','all')),
  max_periods    int  not null default 0 check (max_periods >= 0),
  periods_booked int  not null default 0 check (periods_booked >= 0),
  currency       text not null default 'eur',
  ended_at       timestamptz,
  created_at     timestamptz not null default now(),
  check (recurring_mode <> 'n_periods' or periods_booked <= max_periods),
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete restrict
);
create index affiliate_subscription_bindings_partner_idx
  on public.affiliate_subscription_bindings (partner_id, tenant_id);
```

`recurring_mode`, `max_periods` und `currency` werden beim Anlegen aus dem Programm KOPIERT: eine
spätere Programmänderung darf laufende Abos nicht rückwirkend umdefinieren — dieselbe Begründung wie
beim kopierten Satz in `20260803100200_marketplace_ledger.sql:20-24`.

Der Zähler wird nie in TypeScript gelesen und dann geschrieben. Der Verarbeiter erhöht ihn in genau
einem bedingten Statement und bucht nur, wenn dieses Statement eine Zeile zurückgibt:

```sql
update public.affiliate_subscription_bindings
   set periods_booked = periods_booked + 1
 where stripe_subscription_id = $1
   and ended_at is null
   and (recurring_mode = 'all' or periods_booked < max_periods)
returning partner_id, program_id, origin_commission_id, currency;
```

Der `check (… periods_booked <= max_periods)` ist die zweite Verteidigungslinie. Ein Lesen des
Zählers vorab mit anschließendem Insert wäre bei zwei gleichzeitig zugestellten `invoice.paid` um
eine Rate zu großzügig; der advisory lock auf dem `dedup_key` hilft dort nicht, weil der je Rechnung
verschieden ist.

### 3.10 `affiliate_events` — die Outbox

Aufnahmepuffer für jedes Stripe-Ereignis mit Affiliate-Relevanz; sie macht „Warten" zu einem gültigen
Zustand und hält fehlgeschlagene Geldereignisse sichtbar statt sie zu verlieren.

```sql
create table public.affiliate_events (
  id                     uuid primary key default gen_random_uuid(),
  stripe_event_id        text not null unique,        -- einzige Idempotenzquelle der Aufnahme
  event_type             text not null,
  tenant_id              uuid references public.tenants(id) on delete cascade,  -- NULLABLE
  order_id               uuid,
  stripe_invoice_id      text,
  stripe_subscription_id text,
  stripe_charge_id       text,
  stripe_payment_intent  text,
  referral_token         text,                        -- Momentaufnahme aus der Metadata
  payload                jsonb not null default '{}'::jsonb,
  occurred_at            timestamptz not null,        -- Stripe-Zeit, NICHT Verarbeitungszeit
  status                 text not null default 'pending'
                           check (status in ('pending','done','skipped','error')),
  attempts               int  not null default 0 check (attempts >= 0),
  last_error             text,                        -- redigiert, siehe 11.11
  created_at             timestamptz not null default now(),
  processed_at           timestamptz
);
create index affiliate_events_queue_idx on public.affiliate_events (status, created_at)
  where status in ('pending','error');
create index affiliate_events_tenant_idx on public.affiliate_events (tenant_id, created_at desc);
create index affiliate_events_charge_idx on public.affiliate_events (stripe_charge_id)
  where stripe_charge_id is not null;

alter table public.affiliate_events enable row level security;
revoke all on public.affiliate_events from anon, authenticated;
create policy affiliate_events_deny_all on public.affiliate_events
  for all to anon, authenticated using (false) with check (false);
```

`tenant_id` ist ausdrücklich NULLABLE. Für `charge.refunded` und die drei Dispute-Ereignisse ist der
Mandant zum Aufnahmezeitpunkt nicht bekannt: ein `Stripe.Charge` trägt keine Session-Metadata. Die
Auflösung (`charge.payment_intent` → `orders.stripe_payment_intent`, bzw. `charge.invoice` →
`affiliate_commissions.stripe_invoice_id`) ist Aufgabe des Verarbeiters — genau die Arbeit, die die
Outbox aus dem Webhook heraushalten soll. Ein `not null` an dieser Stelle würde die Aufnahme genau
der Ereignisse scheitern lassen, für die die Outbox gebaut wurde.

`payload` enthält ausschließlich die für die Rechnung nötigen Felder (`amount_total`, `amount_paid`,
`amount_tax`, `amount_shipping`, `currency`, `billing_reason`, `amount_refunded`, `charge_amount`,
`dispute_amount`, `dispute_status`), nicht das volle Stripe-Objekt — sonst landen Kundenname,
Anschrift und Steuer-ID dauerhaft in einer zweiten Tabelle ohne eigenen Löschgrund.

`occurred_at` ist die Stripe-Zeit (`session.created` bzw. `invoice.status_transitions.paid_at`); bei
einem Retry nach drei Tagen darf sich die Sperrfrist nicht verschieben.

### 3.11 `affiliate_commissions` — das Provisionsbuch

Jede Geldbewegung des Moduls als unveränderliche, chronologische Zeile; der Saldo ist immer eine
Summe, nie ein Abgleich.

```sql
create table public.affiliate_commissions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  program_id    uuid not null,
  partner_id    uuid not null,

  kind text not null check (kind in
    ('sale','reserve','recurring','recurring_reserve','tier2','reversal','recredit','manual')),

  -- Herkunft
  order_id               uuid,
  stripe_invoice_id      text,
  stripe_subscription_id text,
  stripe_charge_id       text,
  product_id             uuid,
  campaign               text,
  referral_id            uuid,
  parent_id              uuid,            -- tier2/reserve -> die sale-Zeile
  reverses_id            uuid,            -- reversal -> die stornierte Zeile
                                          -- recredit  -> die reversal-Zeile

  -- Eingefrorener Rechenweg
  base_cents        int  not null,
  basis_kind        text not null check (basis_kind in ('net','gross')),
  rate_kind         text not null check (rate_kind in ('percent','fixed')),
  rate_bp           int  not null default 0 check (rate_bp between 0 and 10000),
  fixed_cents       int  not null default 0,
  amount_cents      int  not null,        -- VORZEICHENBEHAFTET: reversal ist negativ
  currency          text not null default 'eur',
  condition_id      uuid,
  condition_snapshot jsonb not null default '{}'::jsonb,

  status text not null default 'pending'
           check (status in ('pending','on_hold','approved','paid','cancelled')),
  cancel_reason text check (cancel_reason in
    ('self_referral','test_order','zero_amount','fraud_suspicion','manual','reassigned')),
  hold_until timestamptz not null,
  booked_at  date not null default current_date,   -- Abrechnungsperiode (G14)
  payout_id  uuid,
  paid_at    timestamptz,
  flagged    boolean not null default false,
  flag_reason text,
  is_test    boolean not null default false,
  note       text,
  dedup_key  text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, dedup_key),
  unique (id, tenant_id),
  check (kind <> 'manual'   or note is not null),
  check (kind <> 'reversal' or (reverses_id is not null and amount_cents < 0 and note is not null)),
  check (kind <> 'recredit' or (reverses_id is not null and amount_cents > 0)),
  check (kind not in ('tier2','reserve','recurring_reserve') or parent_id is not null),
  foreign key (program_id, tenant_id) references public.affiliate_programs  (id, tenant_id) on delete restrict,
  foreign key (partner_id, tenant_id) references public.affiliate_partners  (id, tenant_id) on delete restrict,
  foreign key (order_id,   tenant_id) references public.orders              (id, tenant_id) on delete restrict,
  foreign key (product_id, tenant_id) references public.products            (id, tenant_id) on delete set null,
  foreign key (referral_id, tenant_id) references public.affiliate_referrals(id, tenant_id) on delete set null,
  foreign key (parent_id,   tenant_id) references public.affiliate_commissions (id, tenant_id) on delete restrict,
  foreign key (reverses_id, tenant_id) references public.affiliate_commissions (id, tenant_id) on delete restrict
);
create index affiliate_commissions_partner_idx
  on public.affiliate_commissions (partner_id, tenant_id, status, currency, hold_until);
create index affiliate_commissions_due_idx on public.affiliate_commissions (hold_until)
  where status = 'pending' and flagged = false;
create index affiliate_commissions_payout_idx  on public.affiliate_commissions (payout_id, tenant_id);
create index affiliate_commissions_order_idx   on public.affiliate_commissions (order_id, tenant_id);
create index affiliate_commissions_parent_idx  on public.affiliate_commissions (parent_id, tenant_id);
create index affiliate_commissions_reverses_idx on public.affiliate_commissions (reverses_id, tenant_id);
create index affiliate_commissions_product_idx on public.affiliate_commissions (product_id, tenant_id);
create index affiliate_commissions_referral_idx on public.affiliate_commissions (referral_id, tenant_id);
create index affiliate_commissions_sub_idx on public.affiliate_commissions
  (tenant_id, stripe_subscription_id) where stripe_subscription_id is not null;
create index affiliate_commissions_invoice_idx on public.affiliate_commissions
  (tenant_id, stripe_invoice_id) where stripe_invoice_id is not null;
create index affiliate_commissions_tenant_created_idx
  on public.affiliate_commissions (tenant_id, created_at desc);
```

`order_id` ist `on delete restrict` und nicht `set null`: verlöre eine Geldzeile ihren Bezug, während
ihr `dedup_key` die alte `order_id` weiter im Klartext trägt, kollidierte eine spätere Neubuchung
derselben Bestellung mit einem Schlüssel, dessen Zeile nicht mehr auffindbar ist. Für die
DSGVO-Löschung gibt es Anonymisierung, nicht Kaskadenlöschung.

Die `dedup_key`-Schlüssel, vollständig:

| kind | dedup_key |
|---|---|
| `sale` | `sale:<order_id>` |
| `reserve` | `reserve:<order_id>` |
| `recurring` | `recurring:<stripe_invoice_id>` |
| `recurring_reserve` | `recurring_reserve:<stripe_invoice_id>` |
| `tier2` | `tier2:<parent_id>` |
| `reversal` | `reversal:<reverses_id>:<charge_id oder invoice_id>:<kumulativ_erstattet>` |
| `recredit` | `recredit:<reverses_id>:<dispute_id>` |
| `manual` | `manual:<gen_random_uuid()>` |

Der Unveränderlichkeits-Guard hat bewusst KEINE Rollen-Erlaubnisliste — auch `service_role` darf eine
gebuchte Zeile nicht umschreiben:

```sql
create or replace function public.affiliate_commissions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := old.id; new.tenant_id := old.tenant_id; new.program_id := old.program_id;
  new.partner_id := old.partner_id; new.kind := old.kind;
  new.order_id := old.order_id; new.stripe_invoice_id := old.stripe_invoice_id;
  new.stripe_subscription_id := old.stripe_subscription_id;
  new.stripe_charge_id := old.stripe_charge_id; new.product_id := old.product_id;
  new.campaign := old.campaign; new.referral_id := old.referral_id;
  new.parent_id := old.parent_id; new.reverses_id := old.reverses_id;
  new.base_cents := old.base_cents; new.basis_kind := old.basis_kind;
  new.rate_kind := old.rate_kind; new.rate_bp := old.rate_bp;
  new.fixed_cents := old.fixed_cents; new.amount_cents := old.amount_cents;
  new.currency := old.currency; new.condition_id := old.condition_id;
  new.condition_snapshot := old.condition_snapshot;
  new.booked_at := old.booked_at; new.is_test := old.is_test;
  new.dedup_key := old.dedup_key; new.created_at := old.created_at;
  -- hold_until nur nach VORNE verschiebbar (Pruefung anhaengen), nie nach hinten.
  if new.hold_until < old.hold_until then new.hold_until := old.hold_until; end if;
  -- Aenderbar bleiben: status, cancel_reason, payout_id, paid_at, flagged,
  -- flag_reason, note, updated_at.
  return new;
end; $$;
create trigger affiliate_commissions_guard_trg before update on public.affiliate_commissions
  for each row execute function public.affiliate_commissions_guard();
create trigger affiliate_commissions_touch     before update on public.affiliate_commissions
  for each row execute function public.set_updated_at();
```

Es gibt bewusst weder eine `create rule … do instead nothing` noch einen `before delete`-Trigger, der
wirft. Eine Regel würde beim Kaskadenlöschen eines Mandanten still greifen und verwaiste Geldzeilen
mit einer `tenant_id` auf einen gelöschten Mandanten hinterlassen; ein werfender Trigger würde die
Mandantenlöschung ganz blockieren. Der Schutz ist stattdessen `revoke all` plus das Fehlen jeder
DELETE-Policy — `service_role` und die Kaskade kommen durch, ein Client nie.

```sql
alter table public.affiliate_commissions enable row level security;
revoke all on public.affiliate_commissions from anon, authenticated;
grant select on public.affiliate_commissions to authenticated;
create policy affiliate_commissions_select on public.affiliate_commissions for select using (
  public.affiliate_is_manager(tenant_id)
  or partner_id = public.affiliate_partner_id(tenant_id)
);
create policy affiliate_commissions_deny_write on public.affiliate_commissions
  for all to anon, authenticated using (false) with check (false);
```

Die Tabelle trägt keine Käuferspalte. Der Bezug zum Käufer läuft über `order_id`, und `orders` liest
ein Partner nicht: die konsolidierte Policy dort erlaubt `user_id = auth.uid() or is_staff(tenant_id)`
(`20260712234500:28-29`) — beides trifft auf einen Partner nicht zu. Damit ist die Datenschutzgrenze
„ein Partner sieht nie Käuferdaten" strukturell und nicht nur durch eine Spaltenauswahl gesichert.

### 3.12 `affiliate_payouts` und `affiliate_document_counters`

Eine Auszahlung an einen Partner für einen Zeitraum samt Steuermodus und Gutschriftbeleg; der Zähler
vergibt die lückenlose Belegnummer je Mandant und Jahr.

```sql
create table public.affiliate_payouts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  program_id     uuid not null,
  partner_id     uuid not null,
  period_from    date not null,
  period_to      date not null check (period_to >= period_from),
  currency       text not null default 'eur',
  gross_cents    int  not null,            -- Summe der positiven Zeilen
  reversal_cents int  not null,            -- Summe der negativen Zeilen (<= 0)
  subtotal_cents int  not null,            -- gross + reversal, das Netto-Honorar
  tax_mode       text not null check (tax_mode in
                   ('regular','small_business','reverse_charge','non_eu')),
  tax_rate_bp    int  not null default 0 check (tax_rate_bp between 0 and 10000),
  tax_cents      int  not null default 0,
  total_cents    int  not null,            -- subtotal + tax
  status         text not null default 'draft'
                   check (status in ('draft','approved','exported','paid','failed','cancelled')),
  method         text check (method in ('sepa','paypal','manual')),
  document_no    text,
  document_path  text,                     -- {tenant_id}/affiliate/payouts/{id}.pdf
  document_issued_at timestamptz,
  reference      text,
  approved_at    timestamptz,
  paid_at        timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, document_no),
  unique (id, tenant_id),
  check (subtotal_cents = gross_cents + reversal_cents),
  check (total_cents = subtotal_cents + tax_cents),
  check (reversal_cents <= 0),
  check (status = 'draft' or document_no is not null),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete restrict,
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete restrict
);
create index affiliate_payouts_partner_idx on public.affiliate_payouts (partner_id, tenant_id, created_at desc);
create index affiliate_payouts_status_idx  on public.affiliate_payouts (tenant_id, status);

alter table public.affiliate_commissions
  add constraint affiliate_commissions_payout_fk
  foreign key (payout_id, tenant_id)
  references public.affiliate_payouts (id, tenant_id) on delete set null;

create table public.affiliate_document_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  year      int  not null check (year between 2020 and 2100),
  next_no   int  not null default 1 check (next_no >= 1),
  primary key (tenant_id, year)
);
alter table public.affiliate_document_counters enable row level security;
revoke all on public.affiliate_document_counters from anon, authenticated;
create policy affiliate_document_counters_deny_all on public.affiliate_document_counters
  for all to anon, authenticated using (false) with check (false);
```

Ein Guard friert `gross_cents`, `reversal_cents`, `subtotal_cents`, `tax_*`, `total_cents`,
`period_*`, `currency`, `document_no` und `document_issued_at` ein, sobald `document_no` gesetzt ist
(GoBD: nachträgliches Neuerzeugen aus geänderten Daten ist unzulässig). `document_path` bleibt
schreibbar, damit ein Reparaturlauf ein fehlendes PDF aus den eingefrorenen Zahlen deterministisch
neu erzeugen kann — die Zahlen sind der Beleg, die Datei ist nur ihre Darstellung.

`on delete restrict` beim Partner-FK: ein Beleg darf nicht verschwinden, weil jemand einen Partner
löscht. RLS: SELECT für Manager und den eigenen Partner (`partner_id = affiliate_partner_id(tenant_id)`),
kein Client-Schreibzugriff.

### 3.13 `affiliate_billing_profiles`

Anschrift, Steuerstatus und Zahlungsverbindung des Partners — getrennt von den Stammdaten, damit
keine Partnerliste und kein Export sie versehentlich mitselektiert.

```sql
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
  unique (partner_id, tenant_id),
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade
);
create index affiliate_billing_profiles_tenant_idx on public.affiliate_billing_profiles (tenant_id);
```

RLS enger als bei den Stammdaten: `affiliate_is_manager` (owner/admin) darf LESEN, ändern darf
ausschließlich der Partner selbst. Bankdaten durch den Händler ändern zu lassen wäre der klassische
Weg, Auszahlungen umzuleiten, sobald ein Händler-Konto übernommen wurde.

```sql
create policy affiliate_billing_select on public.affiliate_billing_profiles for select using (
  public.affiliate_is_manager(tenant_id)
  or partner_id = public.affiliate_partner_id(tenant_id)
);
create policy affiliate_billing_self_insert on public.affiliate_billing_profiles for insert
  with check (partner_id = public.affiliate_partner_id(tenant_id));
create policy affiliate_billing_self_update on public.affiliate_billing_profiles for update
  using (partner_id = public.affiliate_partner_id(tenant_id))
  with check (partner_id = public.affiliate_partner_id(tenant_id));
```

Die drei `vat_check_*`-Felder brauchen einen Guard-Trigger, KEINEN Spalten-Grant: Spaltenrechte sind
nicht rollenabhängig, und da der Partner auf derselben Tabelle UPDATE braucht, könnte er sonst seinen
eigenen USt-IdNr.-Prüfstatus auf `valid` setzen und damit Reverse Charge und die Auszahlungsfreigabe
selbst erzeugen — ein direkter Steuer- und Geldfluss-Bypass.

```sql
create or replace function public.affiliate_billing_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.partner_id := old.partner_id; new.tenant_id := old.tenant_id;
  new.created_at := old.created_at;
  if current_user not in ('postgres','supabase_admin','service_role') then
    new.vat_checked_at   := old.vat_checked_at;
    new.vat_check_result := old.vat_check_result;
    new.vat_check_log    := old.vat_check_log;
  end if;
  -- Jede Aenderung an IBAN/PayPal/USt-IdNr. setzt den Pruefstatus zurueck und
  -- erzeugt einen Audit-Eintrag (geschrieben von der Server Action).
  if new.vat_id is distinct from old.vat_id then
    new.vat_check_result := 'unchecked'; new.vat_checked_at := null;
  end if;
  return new;
end; $$;
```

### 3.14 `affiliate_daily_stats`

Vorberechnete Tageswerte je Partner und Kampagne — die einzige Statistikquelle für Partner und
Admin-Diagramme, damit Rohklicks serverseitig bleiben und die Auswertung nicht mit der Klicktabelle
mitwächst.

```sql
create table public.affiliate_daily_stats (
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  program_id       uuid not null,
  partner_id       uuid not null,
  day              date not null,
  campaign         text not null default '',
  clicks           int not null default 0 check (clicks >= 0),
  unique_clicks    int not null default 0 check (unique_clicks >= 0),
  bot_clicks       int not null default 0 check (bot_clicks >= 0),
  leads            int not null default 0 check (leads >= 0),
  orders_count     int not null default 0 check (orders_count >= 0),
  revenue_cents    int not null default 0,
  commission_cents int not null default 0,
  reversal_cents   int not null default 0,
  rebuilt_at       timestamptz not null default now(),
  primary key (tenant_id, partner_id, day, campaign),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade,
  foreign key (partner_id, tenant_id) references public.affiliate_partners (id, tenant_id) on delete cascade
);
```

Diese Tabelle ist ausdrücklich ein CACHE, keine zweite Wahrheit. `commission_cents` und
`reversal_cents` werden nicht fortgeschrieben, sondern je Lauf aus `affiliate_commissions` für den
betroffenen Tag NEU BERECHNET und per Upsert überschrieben; der Aggregationslauf ist damit idempotent
und selbstheilend. Ein Abgleichsbericht (Abschnitt 7.6) vergleicht die Summe der Aggregate gegen die
Summe des Buchs und meldet jede Abweichung.

RLS: SELECT für Manager und für den eigenen Partner, kein Client-Schreibzugriff.

### 3.15 `affiliate_creatives`

Werbemittel des Programms (Banner, E-Mail-Vorlage, Textbaustein, Datei) mit Aktiv-Schalter und
Sortierung.

```sql
create table public.affiliate_creatives (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  program_id uuid not null,
  kind       text not null check (kind in ('banner','email','text','file')),
  title      text not null,
  body_md    text,
  asset_path text,                          -- {tenant_id}/affiliate/creatives/...
  width      int, height int,
  active     boolean not null default true,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (program_id, tenant_id) references public.affiliate_programs (id, tenant_id) on delete cascade
);
create index affiliate_creatives_program_idx on public.affiliate_creatives (program_id, tenant_id, position);
-- RLS: SELECT fuer Manager sowie fuer aktive Partner (active = true), Schreiben nur Manager.
```

### 3.16 `affiliate_audit_log`

Unveränderliches Protokoll jeder Änderung an Programm, Partner, Kondition, Buchung, Auszahlung und
Zuordnung — ein Prüfpfad, der änderbar ist, ist keiner, und er ist nicht nachrüstbar.

```sql
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
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);
create index affiliate_audit_log_entity_idx
  on public.affiliate_audit_log (tenant_id, entity, entity_id, created_at desc);

alter table public.affiliate_audit_log enable row level security;
revoke all on public.affiliate_audit_log from anon, authenticated;
grant select on public.affiliate_audit_log to authenticated;
create policy affiliate_audit_log_select on public.affiliate_audit_log for select using (
  public.affiliate_is_manager(tenant_id)
  or entity_id = public.affiliate_partner_id(tenant_id)
);
-- Kein UPDATE, kein DELETE fuer Clients; Insert nur ueber service_role.
```

`before`/`after` werden vor dem Schreiben redigiert: IBAN, `paypal_email`, `tax_number`, `vat_id` und
`terms_accepted_ip_hash` erscheinen nur als `"***"` mit einem Änderungsmarker, nie im Klartext.

### 3.17 `tracking_consents` (Consent-Baustein, Block B2)

Nachweis der Einwilligung nach Art. 7 Abs. 1 DSGVO für die eine zusätzliche Cookie-Kategorie
„Partner-Empfehlung"; ohne diese Tabelle darf kein Attributions-Cookie gesetzt werden.

```sql
create table public.tracking_consents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('anon','user')),
  subject_key  text not null,               -- opake Consent-ID bzw. profiles.id
  category     text not null check (category in ('affiliate')),
  decision     text not null check (decision in ('granted','denied','withdrawn')),
  policy_version text not null,             -- entspricht LEGAL_LAST_UPDATED
  ip_hash      text,
  created_at   timestamptz not null default now()
);
create index tracking_consents_subject_idx
  on public.tracking_consents (tenant_id, subject_kind, subject_key, created_at desc);
-- Append-only: RLS an, revoke all, Deny-Policy; geschrieben nur ueber service_role.
```

Ein Widerruf ist eine neue Zeile mit `decision='withdrawn'`, keine Änderung der alten — dieselbe
Logik wie im Provisionsbuch. Der aktuelle Zustand ist die jüngste Zeile je Subjekt und Kategorie.

---

## 4. Attributionsregeln

### 4.1 Trägermedien

| Träger | Lebensdauer | Zweck | einwilligungspflichtig |
|---|---|---|---|
| `affiliate_referrals.token` (Serverzeile) | `cookie_ttl_days` | die eigentliche Wahrheit | nein (Serverprotokoll) |
| Cookie `ct_aff` (httpOnly, host-only, lax) | `cookie_ttl_days` | Wiedererkennung über Seitenaufrufe | ja, § 25 TDDDG |
| URL-Parameter `?aff=<token>` | eine Sitzung | Fallback ohne Einwilligung, Funnel-Durchreichung | nein |
| `affiliate_customer_bindings` | unbegrenzt | Lifetime-Bindung, Gerätewechsel | nein (Vertragsdurchführung) |
| `affiliate_subscription_bindings` | Abo-Laufzeit | Folgeraten | nein (Vertragsdurchführung) |
| Partner-Code als Gutscheincode | je Einlösung | Podcast, Print, Offline | nein |

### 4.2 Klickzeitpunkt — `GET /api/aff/k?c=<code>&z=<ziel>&cam=<kampagne>`

Der Endpunkt liegt unter `/api/`, weil `isApiPath()` (`src/lib/tenant/routing.ts:95-97`) ihn auf
Portal- und Marketplace-Host vom Prefix-Rewrite freihält, `isMaintenanceBypassPath()`
(`routing.ts:150`) ihn im Wartungsmodus erreichbar hält, und der Mandant auf einem Mandanten-Host für
`/api/...` trotzdem aufgelöst wird — der Endpunkt bekommt `x-tenant-data` frei Haus. Ein Pfad wie
`/r/<code>` würde auf dem Portal-Host zu `/portal/r/...` (404) und bei Wartung mit 503 geblockt.

Ablauf in dieser Reihenfolge; jeder Abbruch führt zum Redirect ohne Zuordnung, nie zu einer
Fehlerseite:

```
1.  zod auf alle drei Parameter.
      c   ^[a-z0-9][a-z0-9-]{2,31}$
      z   ^(kurs|kaufen)/[a-z0-9][a-z0-9-]{1,60}$   oder leer
      cam ^[A-Za-z0-9_.-]{1,64}$                    oder leer
    Ungueltig -> Ziel "/", weiter mit Schritt 8.
2.  ziel = "/" + z  (bzw. "/"). Antwort steht damit fest:
      NextResponse.redirect(new URL(ziel, request.url), 302)
      Cache-Control: no-store, private
    302 statt 301: ein 301 wird dauerhaft gecacht und macht jede spaetere
    Zuordnungsaenderung wirkungslos. Relativ statt buildTenantUrl() -> G11.
3.  tenant = getTenant()  (Middleware-Header, kein DB-Rundlauf)
    program = affiliate_programs where tenant_id = tenant.id and status = 'active'
    partner = affiliate_partners where tenant_id = tenant.id and code = c
              and status = 'active'
    Kein Treffer -> Schritt 8 OHNE jeden Schreibvorgang. Identische Antwort fuer
    "Code existiert nicht" und "Partner gesperrt" (CLAUDE.md 2.15).
4.  Bot-/Einbettungsfilter, drei Pruefungen:
      a) User-Agent gegen  bot|crawl|spider|preview|monitor|headless|curl|wget|
         python-requests|facebookexternalhit|slackbot
      b) Accept-Header enthaelt NICHT "text/html"
      c) Sec-Fetch-Dest ist gesetzt und ungleich "document",
         oder Sec-Fetch-Mode ist gesetzt und ungleich "navigate"
    (b) und (c) fangen Cookie-Stuffing per <img src="...">: ein solcher Request
    kommt mit echtem Browser-UA, aber niemals als Dokument-Navigation.
    Treffer -> is_bot = true, Klickzeile wird geschrieben, aber KEINE Referral-Zeile
    und KEIN Cookie.
5.  Referrer-Blocklist: hostnameOf(referer) gegen program.referrer_blocklist.
    Treffer -> wie Bot.
6.  Tagesobergrenze: affiliate_daily_stats.clicks fuer (partner, heute) >= 50000
    -> gar nichts schreiben, nur Redirect (G18).
    affiliate_clicks INSERT ... on conflict (tenant_id, dedup_key) do nothing
    ip_hash = HMAC(SERVICE_KEY || 'affiliate-ip' || YYYYMMDD, ip)
7.  Nur wenn weder Bot noch Blocklist:
    a) Traegt der Request bereits ein gueltiges ct_aff-Token fuer DIESES Programm
       und ist program.overwrite_policy = 'deny' -> KEINE neue Referral-Zeile,
       Cookie bleibt unveraendert. Der Klick aus Schritt 6 ist trotzdem gezaehlt.
    b) sonst: token = 32 Zufallsbytes hex
       INSERT affiliate_referrals (..., expires_at = now() + cookie_ttl_days)
       vorheriges aktives Referral desselben Programms -> status = 'superseded'
8.  Antwort ausliefern.
    Einwilligung liegt vor (tracking_consents, juengste Zeile = 'granted'):
       res.cookies.set("ct_aff", token, { httpOnly: true, sameSite: "lax",
         secure: NODE_ENV === "production", path: "/", maxAge: ttl*86400 })
       -- KEIN domain-Attribut (host-only), Begruendung wie NEXT_LOCALE
       -- in src/lib/account/actions.ts:139-141.
    Immer zusaetzlich: ?aff=<token> an das Ziel anhaengen.
```

Der Schreibvorgang liegt VOR der Antwort, nicht danach. `ctx.waitUntil()` wird im gesamten Repo
nirgends benutzt — `custom-worker.ts:59` entfernt den `ctx`-Parameter sogar ausdrücklich. Eine nach
dem Response gestartete Promise kann Cloudflare abbrechen; ein verlorener Klick ist verlorenes Geld.
Der Preis ist ein Datenbank-Rundlauf Latenz, bewusst bezahlt.

Kein Eingriff in `src/middleware.ts`. Der Endpunkt setzt sein Cookie selbst auf seiner eigenen
`NextResponse`; die `pendingCookies`-Mechanik (`src/middleware.ts:166-176`) existiert nur, damit der
Supabase-Session-Refresh mehrere `buildResponse()`-Aufrufe im Wartungsmodus-Zweig überlebt. Ein
zweiter Mechanismus dort wäre reines Regressionsrisiko an der empfindlichsten Datei des Projekts.

### 4.3 Durchreichung im Funnel und Bindung an das Konto

`ct_aff` übersteht Seitenwechsel von selbst. Für den einwilligungsfreien Fall liest
`src/app/(learn)/kaufen/[productSlug]/page.tsx` den Parameter aus `searchParams` (in Next 16 ein
Promise: `const { aff } = await searchParams;`) und reicht ihn an `BuyButton` durch, der ihn als
zweiten Parameter an die Server Action gibt. Es gibt bewusst KEINE Layout-Komponente, die den
Parameter global anhängt: Layouts bekommen in Next.js kein `searchParams`, eine solche Komponente
wäre nicht baubar.

`bindReferral(token)` läuft an drei Stellen — nach Registrierung, nach Login und beim Rendern von
`/kaufen/[productSlug]`:

```
referral = affiliate_referrals where tenant_id = T and token = <token>
           and status = 'active' and expires_at > now()
kein Treffer                    -> stillschweigend nichts tun
referral.user_id is null        -> user_id = auth.uid(), bound_at = now()
referral.user_id <> auth.uid()  -> NICHTS tun (geteiltes Geraet, kein Diebstahl)
program.lifetime_binding        -> insert affiliate_customer_bindings
                                   on conflict (tenant_id, program_id, user_id) do nothing
```

### 4.4 Bestellzeitpunkt — `resolveAttribution()`

Ausgewertet EINMAL beim Erzeugen der Checkout-Session, nicht im Webhook. Der Käufer ist dort immer
angemeldet (`src/lib/stripe/checkout.ts:88-94`, `src/lib/marketplace/checkout.ts:61-67`). Das
Ergebnis wandert als `affiliate_ref_token` in die Session-Metadata. Erste zutreffende Regel gewinnt:

| # | Bedingung | Ergebnis | `meta.reason` |
|---|---|---|---|
| R0 | `program.status <> 'active'` oder `tenant.settings.affiliate_enabled <> true` | keine Zuordnung, keine Metadata | — |
| R1 | Käufer ist selbst der Partner (Konto-ID oder normalisierte E-Mail) und `self_referral='block'` | keine Zuordnung; Verkauf zählt in `affiliate_daily_stats.orders_count`, `commission_cents = 0`; Audit-Eintrag | `self_referral` |
| R2 | dasselbe, aber `self_referral='allow_flagged'` | Zuordnung, Buchung entsteht mit `flagged=true`, `flag_reason='self_referral'` und bleibt `pending` | `self_referral_flagged` |
| R3 | Gutscheincode des Partners eingelöst, Partner `active` | dieser Partner, Lifetime-Bindung wird gesetzt | `coupon` |
| R4 | Lifetime-Bindung vorhanden UND `program.lifetime_binding` UND kein gültiges frisches Token | gebundener Partner | `lifetime` |
| R5 | `?aff=`-Token gültig (gleicher Mandant, `status='active'`, `expires_at > now()`, `is_bot=false`, Partner+Programm aktiv) | dessen Partner | `url_token` |
| R6 | `ct_aff`-Cookie-Token gültig (gleiche Prüfungen) | dessen Partner | `cookie_token` |
| R7 | Referral-Zeilen mit `user_id = käufer`, `expires_at > now()`, `status <> 'revoked'`; sortiert nach `attribution_model`: `last` → `created_at desc`, `first` → `created_at asc` | erster Treffer | `server_state` |
| R8 | Lifetime-Bindung vorhanden (auch wenn ein Token existierte, das an R5–R7 scheiterte) | gebundener Partner | `lifetime_fallback` |
| R9 | sonst | keine Zuordnung, Hausverkauf, gar keine Provisionszeile | — |

Zwei Rangfolge-Entscheidungen mit Begründung, die wörtlich in `program.terms_text` gehören, weil ein
Attributionsstreit ohne veröffentlichte Regel unentscheidbar ist:

R3 steht oben, weil der Gutscheincode eine bewusste, sichtbare Handlung des Käufers ist und der
einzige Träger für Podcast, Print und Influencer ohne klickbaren Link. Der bekannte Missbrauch —
Gutscheinseiten schöpfen am Ende des Funnels die Provision desjenigen ab, der den Kauf ausgelöst hat
— ist hier gedämpft, weil Block B10 (echter Rabatt) nicht gebaut wird: ein Code ohne Preisvorteil
wird auf Gutscheinseiten nicht verbreitet. Wird B10 je gebaut, muss R3 unter R5 rutschen.

R4 steht über dem Token, R8 darunter. Das ist kein Widerspruch, sondern die Auflösung des klassischen
Konflikts: eine bestehende Lifetime-Bindung schlägt einen frischen Klick nur dann, wenn beide
Regeln denselben Kunden meinen — sie ist eine dauerhafte Zusage an den ersten Partner. R4 greift
deshalb nur, wenn gar kein gültiges frisches Token vorliegt; existiert eines, entscheidet R5/R6, und
R8 fängt nur den Fall ab, dass das Token ungültig geworden ist. Jede Abweichung von der Bindung wird
im Audit-Log als `overridden_by_click` festgehalten.

Selbst-Empfehlung wird nie über die IP erkannt: gemeinsame Netze erzeugen Fehlalarme, und die
Umgehung ist trivial. Der Abgleich ist `partner.user_id = order.user_id` oder
`normalize(partner.applicant_email) = normalize(käufer_email)` mit
`normalize(e) = lower(trim(e))`, im lokalen Teil alles ab `+` abgeschnitten und bei `gmail.com`
zusätzlich Punkte entfernt.

### 4.5 Testbestellungen

Eine Zuordnung ist ein Test, wenn `program.test_mode = true` oder `event.livemode === false`. Die
Buchung entsteht trotzdem — der Partner soll sehen, dass die Zuordnung funktioniert —, aber mit
`is_test = true` und `status='cancelled'`, `cancel_reason='test_order'`. Test-Zeilen sind in allen
Salden, Auszahlungsläufen und Aggregaten per `where is_test = false` ausgeschlossen, in der
Admin-Transaktionsliste sichtbar und als „Test" gekennzeichnet. Das Feld existiert von Anfang an,
weil sich verfälschte Kennzahlen nachträglich nicht mehr sauber bereinigen lassen.

### 4.6 Umbuchung

`reassignOrder(orderId, newPartnerId | null, reason)`, nur `owner`/`admin`, `reason` Pflicht:
alle bestehenden Zeilen zur Bestellung werden nach der Regel aus Abschnitt 6 storniert
(`pending`/`on_hold` → `cancelled` mit `cancel_reason='reassigned'`; `approved`/`paid` →
Gegenbuchung über den vollen Rest), danach entsteht bei gesetztem `newPartnerId` eine neue Zeile mit
`dedup_key = 'sale:' || order_id || ':r' || <lfd>` und `note` mit der Begründung. Audit-Eintrag mit
`before`/`after`. Das ist der einzige Grund, warum diese Funktion existiert: jeder Attributionsstreit
soll ohne Datenbankeingriff lösbar sein.

### 4.7 Marketplace

Der Marketplace-Host löst per Definition keinen Mandanten auf und kann keine Registrierung
(`src/app/marketplace/kurs/[slug]/page.tsx:19-30`). Ein host-only Cookie vom Mandanten-Host reist
dorthin nicht mit. Der Promolink-Generator bietet Marketplace-Ziele deshalb gar nicht erst an, und
`src/lib/marketplace/checkout.ts` bekommt KEINEN Metadata-Zusatz — er wäre toter Code, und die
naheliegende „Reparatur" über ein `domain`-Attribut wäre eine mandantenübergreifende Zuordnung. Das
gehört als Satz in die Programmbeschreibung, sonst wundert sich der erste Partner.

---

## 5. Provisionsberechnung

Alle Werte Ganzzahl-Cent, alle Sätze Basispunkte. Die Kernfunktionen liegen in
`src/lib/affiliate/compute.ts`, sind I/O-frei und ohne Supabase-Mock testbar. Der Prozentkern ist
`computeCommission()` aus `src/lib/marketplace/fulfil.ts:37-43` — unverändert importiert, nicht
kopiert.

### 5.1 Schritt 1 — Bemessungsgrundlage

```
Einmalkauf (checkout.session.completed):
  brutto   = session.amount_total
  steuer   = session.total_details.amount_tax      ?? 0
  versand  = session.total_details.amount_shipping ?? 0

Abo-Rate (invoice.paid):
  brutto   = invoice.amount_paid                            -- G13, NICHT invoice.total
  steuer_r = summe(invoice.total_taxes[].amount)   ?? 0     -- stripe ^18: total_taxes ist
                                                            -- ein Array, es gibt kein invoice.tax
  steuer   = floor(steuer_r * brutto / max(invoice.total, 1))  -- anteilig, falls ein
                                                            -- Kundenguthaben angerechnet wurde
  versand  = 0

danach in beiden Faellen:
  base0 = basis_kind = 'gross' ? brutto : max(0, brutto - steuer - versand)
  base  = base0 - floor(base0 * program.fee_deduction_bp / 10000)
```

`basis_kind` hat bewusst nur zwei Werte. Ein dritter Wert „netto nach Zahlungsgebühr" wäre eine
erfundene Zahl: die echte Stripe-Gebühr steht auf dem Balance-Transaction-Objekt, das ein zweiter
API-Aufruf wäre und bei manchen Zahlarten erst Tage später final ist. Stattdessen gibt es
`fee_deduction_bp` — ein sichtbarer, verhandelbarer Prozentsatz, der im Partnervertrag steht.

Ist `base <= 0`, entsteht eine Zeile mit `amount_cents = 0`, `status='cancelled'`,
`cancel_reason='zero_amount'` — sichtbar, aber wertlos. Das deckt Trial-Start und
100-%-Gutschein ab, ohne Sonderlogik.

### 5.2 Schritt 2 — Satz auflösen

```sql
select id, rate_kind, rate_bp, fixed_cents
from public.affiliate_conditions
where tenant_id = :t and program_id = :p
  and (partner_id = :partner or partner_id is null)
  and (group_id   = :group   or group_id   is null)
  and (product_id = :product or product_id is null)
  and valid_from <= :at
  and (valid_to is null or valid_to > :at)
order by specificity desc, valid_from desc, id
limit 1;
```

`:at` ist `event.occurred_at`, nicht `now()` — bei einem Stripe-Retry können Tage dazwischenliegen.
Kein Treffer bedeutet Programmstandard. `valid_from desc` sorgt dafür, dass eine befristete
Aktionskondition eine dauerhafte Regel gleicher Spezifität schlägt.

Danach wird geklammert, auch wenn CHECK-Constraints greifen — dieselbe Verteidigungslinie wie
`fulfil.ts:212`:

```ts
const rateBp = Math.min(Math.max(rawRateBp, 0), 10000);
```

### 5.3 Schritt 3 — Provisionsbetrag

```
rate_kind = 'percent':  roh = floor(base * rate_bp / 10000)
rate_kind = 'fixed':    roh = min(fixed_cents, base)

betrag = roh
if program.min_commission_cents != null: betrag = max(betrag, min(min_commission_cents, base))
if program.max_commission_cents != null: betrag = min(betrag, max_commission_cents)
```

`Math.floor`, nie kaufmännisch, immer zugunsten des Händlers, immer in dieselbe Richtung. Eine
gemischte Rundungsregel summiert sich über tausende Buchungen zu unerklärbaren Differenzen. Gerundet
wird je Bestellung, nicht je Position: die ganze Checkout-Session ist eine Basis, ein Rundungsschritt.
Positionsweise Rundung erzeugt Cent-Drift ohne jeden Nutzen.

### 5.4 Schritt 4 — Aufteilung in `sale` und `reserve`

```
reserve = floor(betrag * program.reserve_bp / 10000)
sale    = betrag - reserve
```

Es entstehen zwei Zeilen mit demselben `base_cents` und demselben `condition_snapshot`, aber
getrennten Fristen: `sale` mit `hold_until = occurred_at + hold_days`, `reserve` mit
`hold_until = occurred_at + reserve_days`. Bei `reserve_bp = 0` entsteht nur die `sale`-Zeile. Die
Subtraktion statt einer zweiten Floor-Rechnung stellt sicher, dass kein Cent verloren geht.

### 5.5 Schritt 5 — Zweite Stufe

Nur wenn `program.tier2_enabled`, `partner.referred_by is not null` und der Werber `status='active'`:

```
tier2_basis = 'commission':  t2 = floor(betrag * tier2_rate_bp / 10000)
tier2_basis = 'revenue':     t2 = floor(base   * tier2_rate_bp / 10000)
```

Eigene Zeile, `kind='tier2'`, `partner_id = werber`, `parent_id` = die `sale`-Zeile, `hold_until` wie
die `sale`-Zeile, keine eigene Reserve (sie folgt dem Schicksal des Elternteils). Drei Festlegungen:
Der Händler trägt die zweite Stufe zusätzlich, sie kürzt die erste nicht — alles andere wäre eine
verdeckte Kürzung, die kein Partner akzeptiert. Es gibt genau eine Stufe: die Funktion liest
`referred_by` des Verkäufers und nie den `referred_by` des Werbers; die Begrenzung ist eine
Codeeigenschaft und kein Konfigurationsschalter, der versehentlich umgelegt werden könnte. Und
`tier2` wird nur für `kind in ('sale','recurring')` erzeugt, nie für eine `tier2`-Zeile.

### 5.6 Schritt 6 — Gesamtdeckel

Vor dem Schreiben gilt: `betrag + t2 <= base`. Ist die Summe größer, wird `t2` gekürzt; ist schon
`betrag > base`, wird auf `base` gedeckelt und die Zeile mit `flagged=true`,
`flag_reason='rate_exceeds_base'` geschrieben. Ohne diesen Deckel addieren sich Affiliate-Satz,
Zweitstufe und die Marketplace-Provision des Betreibers (Default 2000 bp) ungeprüft, und der Mandant
zahlt bei jedem Verkauf drauf. Die Einstellungsoberfläche warnt zusätzlich sichtbar bei
`rate_bp > 5000` und bei `rate_bp + tier2_rate_bp > 6000`.

### 5.7 Schritt 7 — Abo-Raten

| `recurring_mode` | `checkout.session.completed` | `invoice.paid`, `billing_reason='subscription_cycle'` |
|---|---|---|
| `first_only` | `sale` + `reserve`, Bindung mit `max_periods=1`, `periods_booked=1` | nichts |
| `n_periods` | `sale` + `reserve`, `periods_booked=1` | `recurring` + `recurring_reserve`, solange der bedingte Zähler-Update eine Zeile liefert |
| `all` | `sale` + `reserve`, `periods_booked=1` | immer |

`billing_reason='subscription_create'` wird im `invoice.paid`-Zweig übersprungen — die hat der
Checkout bereits gebucht. Der Satz wird für Folgeraten NICHT neu aufgelöst, sondern aus
`origin_commission_id.condition_snapshot` gelesen: die Bedingungen bei Vertragsschluss regieren die
ganze Abo-Laufzeit. Andernfalls könnte ein Händler laufende Abos rückwirkend billiger machen, und der
Partner hätte nie eine kalkulierbare Grundlage.

Zahlungsausfall, Pause und Kündigung erzeugen schlicht keine neue `invoice.paid` und damit keine
Provision; bereits gebuchte Raten bleiben, solange sie nicht erstattet werden.
`customer.subscription.deleted` setzt `affiliate_subscription_bindings.ended_at`.

### 5.8 Schritt 8 — Storno und Wiedergutschrift

Zielwert-Verfahren nach G7, angewandt auf JEDE betroffene Zeile einzeln (`sale`, `reserve`,
`recurring`, `recurring_reserve`, `tier2`):

```
verhaeltnis   = kumulativ_erstattet / charge_betrag          -- beide brutto
ziel          = floor(zeile.amount_cents * kumulativ_erstattet / charge_betrag)
bereits       = -1 * summe(amount_cents der reversal-Zeilen mit reverses_id = zeile.id)
delta         = ziel - bereits
if delta <= 0: nichts buchen
sonst: neue Zeile kind='reversal', amount_cents = -delta, reverses_id = zeile.id
```

Weil Basis und Erstattung beide Bruttogrößen desselben Charge sind, ist das Verhältnis automatisch
korrekt, auch wenn die Erstattung anteilig Umsatzsteuer enthält. Erstattet der Händler ausschließlich
Versandkosten, wird das Verhältnis dennoch auf die volle Basis angewandt — das ist bewusst so und
konservativ zugunsten des Händlers; ein Aufteilen nach Erstattungsposition ist bei Stripe ohne
Line-Item-Refunds nicht zuverlässig rekonstruierbar und steht in Abschnitt 13.

Der Status der Gegenbuchung folgt G6: `pending`/`on_hold` beim Elternteil → gleicher Status, gleiches
`hold_until`; `approved`/`paid` → `approved` mit `hold_until = now()`, damit die Schuld die nächste
Auszahlung sofort mindert.

`charge.dispute.created` wird wie eine Vollerstattung über `dispute.amount` behandelt (der Betrag
kann laut Typdefinition ein Teilbetrag sein) und setzt zusätzlich `flagged=true` auf allen Zeilen des
Partners der letzten 30 Tage — ein Chargeback ist auch ein Betrugssignal.
`charge.dispute.closed` mit `status='won'` erzeugt eine Wiedergutschrift: `kind='recredit'`,
positiver Betrag in Höhe der Summe der zu diesem Dispute gebuchten Gegenbuchungen, `reverses_id` auf
die Gegenbuchung, `dedup_key = 'recredit:<reversal_id>:<dispute_id>'`. Ohne diesen Pfad hat der
Händler nach einer gewonnenen Rückbuchung sein Geld und der Partner dauerhaft die Gegenbuchung.

Zusätzlich setzt der Verarbeiter `orders.refunded_cents = kumulativ_erstattet` und
`orders.status = 'refunded'` bei Vollerstattung bzw. `'partially_refunded'` sonst — der Wert steht
seit `0001_init.sql:258` im CHECK und wird von `src/components/admin/orders-table.tsx:20` bereits
gerendert, aber von keiner Codestelle je geschrieben.

### 5.9 Durchgerechnete Beispiele

Programm für alle vier Beispiele: `basis_kind='net'`, `fee_deduction_bp=0`, `reserve_bp=1000`,
`hold_days=30`, `reserve_days=60`, `tier2_enabled=true`, `tier2_basis='commission'`,
`tier2_rate_bp=2000`.

**Beispiel A — einfacher Verkauf mit Zweitstufe.** Kurs 499,00 € brutto, 19 % USt, Rabattcode 10 %.
Partner A hat eine Sonderkondition 3500 bp (Spezifität 20), Werber ist Partner B.

```
session.amount_total            = 44910
session.total_details.amount_tax=  7171     (44910 * 19/119 = 7171,26 -> 7171)
amount_shipping                 =     0

base   = 44910 - 7171 - 0                     = 37739
betrag = floor(37739 * 3500 / 10000)          = floor(13208,65) = 13208
reserve= floor(13208 * 1000 / 10000)          = floor( 1320,80) =  1320
sale   = 13208 - 1320                          =                   11888
t2     = floor(13208 * 2000 / 10000)          = floor( 2641,60) =  2641
Deckel: 13208 + 2641 = 15849 <= 37739  -> ok

Zeilen:
  sale     Partner A  +11888  hold_until = occurred_at + 30 Tage
  reserve  Partner A   +1320  hold_until = occurred_at + 60 Tage
  tier2    Partner B   +2641  hold_until = occurred_at + 30 Tage, parent = sale
Kosten des Haendlers: 15849 Cent (158,49 EUR)
```

**Beispiel B — Abo mit drei Raten, dritte Rate mit Kundenguthaben.** Abo 49,00 €/Monat brutto, 19 %
USt, `recurring_mode='n_periods'`, `recurring_max_periods=12`, Programmstandard 2000 bp, kein Werber.

```
Rate 1 (checkout.session.completed):
  amount_total 4900, amount_tax 782  (4900*19/119 = 782,35 -> 782)
  base    = 4118
  betrag  = floor(4118 * 2000 / 10000) = 823
  reserve = floor( 823 * 1000 / 10000) =  82
  sale    = 741
  -> sale +741, reserve +82; periods_booked = 1

Rate 2 (invoice.paid, subscription_cycle, voll bezahlt):
  invoice.total 4900, invoice.amount_paid 4900, total_taxes-Summe 782
  steuer  = floor(782 * 4900 / 4900) = 782
  base    = 4118
  Satz aus origin.condition_snapshot = 2000 bp  (NICHT neu aufgeloest)
  -> recurring +741, recurring_reserve +82; periods_booked = 2

Rate 3 (invoice.paid, 10,00 EUR Kundenguthaben angerechnet):
  invoice.total 4900, invoice.amount_paid 3900, total_taxes-Summe 782
  steuer  = floor(782 * 3900 / 4900) = floor(622,41) = 622
  base    = 3900 - 622                = 3278
  betrag  = floor(3278 * 2000 / 10000)= floor(655,60) = 655
  reserve = floor( 655 * 1000 / 10000)= 65
  recurring = 590
  -> recurring +590, recurring_reserve +65; periods_booked = 3

Summe Provision ueber drei Raten: 823 + 823 + 655 = 2301 Cent (23,01 EUR)
Ohne G13 (Basis aus invoice.total) waeren es 2469 gewesen - 168 Cent Provision
auf Geld, das nie geflossen ist.
```

**Beispiel C — zwei aufeinanderfolgende Teilerstattungen auf Beispiel A.** `charge_betrag = 44910`.

```
Erste Teilerstattung 100,00 EUR -> charge.amount_refunded = 10000 (kumulativ)
  ziel(sale)    = floor(11888 * 10000 / 44910) = floor(2647,29) = 2647; bereits 0 -> -2647
  ziel(reserve) = floor( 1320 * 10000 / 44910) = floor( 293,92) =  293; bereits 0 ->  -293
  ziel(tier2)   = floor( 2641 * 10000 / 44910) = floor( 588,07) =  588; bereits 0 ->  -588

Zweite Teilerstattung, weitere 100,00 EUR -> charge.amount_refunded = 20000 (kumulativ!)
  ziel(sale)    = floor(11888 * 20000 / 44910) = floor(5294,59) = 5294; bereits 2647 -> -2647
  ziel(reserve) = floor( 1320 * 20000 / 44910) = floor( 587,84) =  587; bereits  293 ->  -294
  ziel(tier2)   = floor( 2641 * 20000 / 44910) = floor(1176,15) = 1176; bereits  588 ->  -588

Waere amount_refunded als Delta missverstanden und nur auf 100 % gedeckelt worden,
haette der zweite Schritt nochmals 5294/587/1176 gebucht - 60 % Storno bei 44,5 %
Erstattung. Das ist der Fehler, den G7 ausschliesst.

Dritter Schritt: Resterstattung auf voll -> charge.amount_refunded = 44910
  ziel(sale)    = floor(11888 * 44910 / 44910) = 11888; bereits 5294 -> -6594
  ziel(reserve) =                                1320; bereits  587 ->  -733
  ziel(tier2)   =                                2641; bereits 1176 -> -1465
Summe der Gegenbuchungen: exakt -11888 / -1320 / -2641. Kein Rundungsrest.
```

**Beispiel D — Storno vor der Freigabe, mit Zweitstufe.** Gleiche Ausgangslage, aber die Erstattung
trifft am achten Tag ein, `hold_days=30`. Alle drei Zeilen stehen noch auf `pending`.

```
sale    (pending, hold_until +30d) -> Gegenbuchung -2647, status='pending',
                                      hold_until = 30d des Elternteils
reserve (pending, hold_until +60d) -> Gegenbuchung  -293, status='pending',
                                      hold_until = 60d des Elternteils
tier2   (pending, hold_until +30d) -> Gegenbuchung  -588, status='pending', +30d

Der Saldo "offen" des Partners sinkt sofort von 11888 auf 9241, die Reserve von
1320 auf 1027; ausgezahlt wird am Tag 30 bzw. 60 nur der Rest. Es wird KEIN Status
der Ursprungszeile geaendert (G6) - sonst wuerde derselbe Betrag zweimal abgezogen.
```

### 5.10 Salden

Vier Zahlen je `(partner_id, currency)`, nie eine Summe. Alle mit `is_test = false`:

```
offen       = sum(amount_cents) where status = 'pending'
              and kind in ('sale','recurring','tier2','manual','reversal','recredit')
              and (parent_kind ist keine Reserve)          -- praktisch: kind not like '%reserve'
in_reserve  = sum(amount_cents) where status = 'pending'
              and kind in ('reserve','recurring_reserve')
              (Gegenbuchungen zu Reserve-Zeilen zaehlen hier mit)
in_pruefung = sum(amount_cents) where status = 'on_hold'
verfuegbar  = sum(amount_cents) where status = 'approved' and payout_id is null
ausgezahlt  = sum(amount_cents) where status = 'paid'
```

Die Zuordnung einer `reversal`-Zeile zum richtigen Eimer erfolgt über `reverses_id` → `kind` des
Elternteils; die reine Funktion `computeBalances(rows)` löst das in TypeScript auf und ist der Ort,
an dem das getestet wird. Ist `verfuegbar < 0`, entsteht kein Auszahlungssatz; die negativen Zeilen
bleiben `approved` mit `payout_id is null` und werden damit automatisch mit künftigen Provisionen
verrechnet — es braucht keine eigene Schuldenmechanik.

### 5.11 Währung

`currency` wird aus der Bestellung in jede Zeile kopiert. Salden, Auszahlungsentwürfe und der
Compare-and-Swap des Auszahlungslaufs gruppieren IMMER nach `(partner_id, currency)`; es gibt kein
einziges Summenfeld über Währungen hinweg. Ein Partner mit Buchungen in zwei Währungen bekommt zwei
Auszahlungen. Eine Umrechnung findet nirgends statt. Wird die Währung eines laufenden Abos in Stripe
geändert, weicht sie von der in `affiliate_subscription_bindings.currency` eingefrorenen ab: der
Verarbeiter bucht dann nicht, setzt `status='error'` mit `last_error='currency_mismatch'` und macht
den Fall in der Admin-Oberfläche sichtbar.

---

## 6. Zustandsdiagramm einer Provisionszeile

### 6.1 Zustände

| Status | Bedeutung | Saldo-Eimer |
|---|---|---|
| `pending` | gebucht, Sperrfrist läuft | „offen" bzw. „in Reserve" |
| `on_hold` | Verdachtsfall, ein Mensch muss entscheiden | „in Prüfung" |
| `approved` | Sperrfrist abgelaufen, auszahlbar | „verfügbar" |
| `paid` | einer Auszahlung zugeordnet UND überwiesen | „ausgezahlt" |
| `cancelled` | nie werthaltig gewesen (Test, Selbst-Empfehlung, 0 €, Umbuchung, Storno vor Freigabe) | zählt nirgends |

Es gibt bewusst keinen Status `reversed`. Eine Rücknahme ist immer eine zweite Zeile (G6).

### 6.2 Diagramm

```
                       Cron-Verarbeiter liest affiliate_events
                                     |
                                     v
                         [Buchung entsteht]
                          /          |          \
                         /           |           \
        Test / 0 Euro /              |            \  Selbst-Empfehlung
        Selbst-Sperre/               |             \ mit allow_flagged
                    v                v              v
             +-----------+      +---------+    +---------+
             | cancelled |      | pending |    | pending |
             +-----------+      +---------+    | flagged |
              (Endzustand)           |         +---------+
                                     |              |
      Storno vor Freigabe            |              | Betrugsflag oder
      (Refund/Dispute/Umbuchung):    |              | Manager setzt on_hold
      Gegenbuchung im SELBEN         |              v
      Eimer, Status bleibt pending   |         +----------+
      (die Summe geht gegen 0)       |         | on_hold  |
                                     |         +----------+
                                     |            |     |
      Cron-Freigabelauf:             |   Manager  |     | Manager
      hold_until <= now()            |   gibt frei|     | verwirft
      AND flagged = false            |            |     v
      AND Programm 'active'          |            |  +-----------+
                                     v            |  | cancelled |
                              +----------+ <------+  +-----------+
                              | approved |
                              +----------+
                                  |    ^
      Auszahlungsentwurf:         |    | Entwurf verworfen oder
      payout_id stempeln,         |    | Ueberweisung fehlgeschlagen:
      Status BLEIBT approved      |    | payout_id = null
      (G8)                        |    |
                                  v    |
                       +--------------------------+
                       | approved + payout_id set |
                       +--------------------------+
                                  |
      Auszahlung als ueberwiesen  |
      markiert (CAS auf           |
      status='approved')          v
                              +--------+
                              |  paid  |
                              +--------+
                             (Endzustand)

      Refund/Dispute auf approved oder paid:
        -> NEUE Zeile kind='reversal', amount_cents < 0,
           status='approved', hold_until = now(), payout_id = null
        -> mindert die naechste Auszahlung sofort, oder bleibt als
           Negativsaldo stehen und wird vorgetragen

      Gewonnener Dispute (dispute.closed, status='won'):
        -> NEUE Zeile kind='recredit', amount_cents > 0,
           reverses_id = die Gegenbuchung, status='approved'
```

### 6.3 Übergänge und ihre Auslöser

| von | nach | Auslöser | Ort |
|---|---|---|---|
| — | `pending` | Verarbeiter, gültige Zuordnung | `processAffiliateQueue()` |
| — | `cancelled` | Test, 0 €, Selbst-Empfehlung mit `block` | `processAffiliateQueue()` |
| `pending` | `on_hold` | Chargeback-Flag, Stornoquote-Report, Manager | Cron / Server Action |
| `pending` | `approved` | Freigabelauf: `hold_until <= now()`, `flagged=false`, Programm `active` | Cron |
| `on_hold` | `approved` oder `cancelled` | Manager, Pflichtbegründung, Audit-Eintrag | Server Action |
| `pending`/`on_hold` | `cancelled` | Umbuchung auf anderen Partner | Server Action |
| `approved` | `approved` + `payout_id` | Auszahlungsentwurf, Compare-and-Swap | Server Action |
| `approved` + `payout_id` | `approved`, `payout_id = null` | Entwurf verworfen, Überweisung fehlgeschlagen | Server Action |
| `approved` + `payout_id` | `paid` | Auszahlung als überwiesen markiert | Server Action |
| beliebig | (neue Zeile) | Refund, Dispute, gewonnener Dispute, Handbuchung | `processAffiliateQueue()` / Server Action |

Es gibt keinen Rückweg von `paid`. Geld, das den Mandanten verlassen hat, wird nicht durch einen
Statuswechsel zurückgeholt, sondern durch eine negative Zeile, die mit künftigen Provisionen
verrechnet wird.

### 6.4 Der Freigabelauf

```sql
update public.affiliate_commissions c
   set status = 'approved'
 where c.id in (
   select c2.id from public.affiliate_commissions c2
     join public.affiliate_programs p
       on p.id = c2.program_id and p.tenant_id = c2.tenant_id
    where c2.status = 'pending'
      and c2.flagged = false
      and c2.is_test = false
      and c2.hold_until <= now()
      and p.status = 'active'                       -- pausiertes Programm gibt nichts frei
    order by c2.hold_until
    limit 500                                       -- CPU-Zeit-Grenze des Workers
 )
returning c.id, c.tenant_id, c.partner_id, c.amount_cents, c.currency;
```

Ein einziges bedingtes UPDATE, damit zwei gleichzeitige Cron-Ticks nicht doppelt freigeben. Die
Deckelung auf 500 Zeilen folgt derselben Begründung, aus der die KI-Generierung als Zustandsmaschine
läuft (PHASENSTATUS.md:776).

### 6.5 Der Verarbeiter

`processAffiliateQueue()` läuft als vierte Warteschlange im bestehenden `Promise.all` von
`src/app/api/admin/ki/process/route.ts:48-56`, alle zwei Minuten (`wrangler.jsonc:96` →
`custom-worker.ts:70`). Ein zweiter Cron-Trigger wird nicht angelegt — er holte die dort
dokumentierte 522-Fehlerklasse zurück. Der Lauf hat fünf Schritte mit je eigenem Deckel:

```
1. Ereignisse verarbeiten (max. 20 Zeilen, status in ('pending','error'), attempts < 5,
   aelteste zuerst):
   a) attempts += 1 SOFORT hochsetzen, VOR der Arbeit. Eine Zeile, die den
      Verarbeiter zum Absturz bringt, darf ihn nicht in jedem Lauf erneut
      zum Absturz bringen (Giftzeilen-Schutz).
   b) tenant_id aufloesen, falls null:
      - charge.payment_intent -> orders.stripe_payment_intent (unique, seit 3.0c)
      - charge.invoice        -> affiliate_commissions.stripe_invoice_id
      - kein Treffer          -> status='skipped' (kein Affiliate-Bezug), fertig
   c) Programm laden; status <> 'active' -> Zeile bleibt 'pending', attempts
      wieder um 1 senken (Pause staut, verliert nicht, zaehlt nicht hoch)
   d) rechnen, book_affiliate_commissions(jsonb) rufen (EIN Aufruf, alle Zeilen
      atomar), status='done', processed_at=now()
   Fehler -> status='error', last_error = kurze, stabile Kennung (redigiert)
2. Freigabelauf (6.4), max. 500 Zeilen
3. Tagesaggregation: fuer jeden Mandanten mit Aktivitaet seit dem letzten Lauf
   werden Vortag und laufender Tag NEU berechnet und per Upsert ueberschrieben
4. Auszahlungsentwuerfe, wenn der Programmrhythmus faellig ist (7.1)
5. Datenlaeufe: affiliate_clicks aelter als 90 Tage loeschen (max. 5000 je Lauf),
   abgelaufene affiliate_referrals ohne user_id aelter als cookie_ttl_days + 30
   loeschen (max. 5000 je Lauf)
```

Jeder Schritt ist einzeln idempotent und gedeckelt; ein Lauf, der abbricht, wird zwei Minuten später
fortgesetzt. Das Ergebnis jedes Schritts wird als JSON zurückgegeben und landet im Cloudflare-Cron-Log.

### 6.6 Reihenfolge, Reparatur und Nachhol-Lauf

Stripe liefert Ereignisse mehrfach und nicht in Reihenfolge. Der Verarbeiter ist dagegen immun, weil
er nicht auf Reihenfolge, sondern auf Vorhandensein prüft: fehlt für ein `invoice.paid` die
`affiliate_subscription_bindings`-Zeile, bleibt das Ereignis auf `pending` mit
`last_error='binding_missing'` und wird im nächsten Tick erneut versucht; nach fünf Versuchen wechselt
es auf `error` und erscheint in der Admin-Oberfläche als „Nicht verarbeitete Zahlungsereignisse (n)".
Warten ist ein gültiger Zustand — das ist der eigentliche Gewinn der Outbox gegenüber einem 500 gegen
Stripe.

`POST /api/admin/affiliate/reprocess` (geteiltes Geheimnis `x-cron-secret`, zeitkonstanter Vergleich
nach dem Muster `src/app/api/admin/ki/process/route.ts:24-41`) setzt `error`-Zeilen auf `pending` mit
`attempts = 0` zurück. Das ist gefahrlos, weil jede Buchung über `unique (tenant_id, dedup_key)`
idempotent ist — auch Gegenbuchungen und Wiedergutschriften, deren Schlüssel den kumulativen
Erstattungsstand bzw. die Dispute-ID enthält.

`POST /api/admin/affiliate/backfill` (dasselbe Geheimnis, manuell angestoßen) ruft
`stripe.events.list({ created: { gte } , types: [...] })` und legt fehlende `affiliate_events`-Zeilen
an. Das ist der Ausweg für den Fall, dass die Aufnahme im Webhook über einen längeren Ausfall hinweg
gescheitert ist und das Stripe-Retry-Fenster von rund drei Tagen verstrichen war. Ohne diesen
Endpunkt gäbe es für so einen Ausfall keinen Weg zurück.

---

## 7. Auszahlungsablauf

### 7.1 Entwurf (Cron, Schritt 4)

Fällig laut `program.payout_schedule` — `weekly` montags, `semi_monthly` am 1. und 16., `monthly` am
1. Je `(partner_id, currency)` entsteht ein Entwurf, wenn alle Bedingungen gelten:

- `verfuegbar >= program.min_payout_cents` (Default 2500 = 25 €). Darunter wird nichts erzeugt, der
  Betrag bleibt stehen und wird vorgetragen; sonst kosten die Überweisungsgebühren mehr als die
  Provision.
- `partner.status = 'active'` und `partner.payout_hold = false`.
- Das Abrechnungsprofil ist vollständig: `entity_kind`, Anschrift, `country`, `payout_method` samt
  IBAN bzw. PayPal-Adresse.
- Der Steuermodus ist bestimmbar (7.4).
- `tenants.legal.entity` ist gesetzt. Fehlt es, ist die Auszahlung gesperrt — dieselbe Logik wie das
  404-Gate im Rechtsbereich (`src/app/(legal)/layout.tsx:39-41`): auf einer White-Label-Domain darf
  nie das Impressum des Betreibers auf einem fremden Beleg landen. Aufgelöst über
  `resolveLegalEntity()` (`src/lib/legal/company.ts:69-73`).

Fehlt etwas, entsteht kein Entwurf; der Partner sieht in seinem Bereich eine `role="alert"`-Meldung
mit genau der fehlenden Angabe und einem Link auf das richtige Feld, und der Admin sieht den Fall im
Abschnitt „Nicht auszahlbar" mit dem konkreten Grund.

Der Entwurf reserviert die Zeilen per Compare-and-Swap im `update` selbst — keine vorgelagerte
Prüfung, Muster `markPayoutPaid()` (`src/lib/platform/marketplace.ts:561`):

```ts
const { data: claimed } = await admin
  .from("affiliate_commissions")
  .update({ payout_id: payout.id })
  .eq("tenant_id", tenant.id)
  .eq("partner_id", partnerId)
  .eq("currency", currency)          // ZWINGEND - ohne diesen Filter landen EUR und
  .eq("status", "approved")          // CHF in einem Satz mit genau einem currency-Feld
  .is("payout_id", null)
  .lte("hold_until", periodToIso)
  .eq("is_test", false)
  .select("id, amount_cents, kind");
```

Die Summen des Entwurfs werden aus den TATSÄCHLICH reservierten Zeilen gebildet, nie aus der Vorschau
— sonst weicht der Beleg von seinem Inhalt ab. Zwei gleichzeitige Läufe greifen nie dieselbe Zeile.

### 7.2 Prüfung und Freigabe (Mensch, `owner`/`admin`)

`/admin/affiliate/auszahlungen` zeigt alle Entwürfe mit Partner, Zeitraum, Bruttosumme,
Gegenbuchungen, Auszahlbetrag, Steuermodus und Zahlweg. Freigabe je Zeile oder als Stapel; der
Bestätigungsdialog schreibt den Gesamtbetrag aus („Sie zahlen 1.247,80 € an 6 Partner aus.") statt nur
„Sind Sie sicher?".

G15 gilt hier hart: ein Manager kann eine Auszahlung an sich selbst nicht freigeben. Die Server
Action weist das ab, und ein Audit-Eintrag hält den Versuch fest.

Bei der Freigabe passiert das Unumkehrbare, in genau dieser Reihenfolge und in einer RPC:

```sql
-- approve_affiliate_payout(p_payout_id uuid) -- security definer, nur service_role
-- 1. Satz auf status='draft' pruefen (Compare-and-Swap)
-- 2. Belegnummer ziehen (7.3)
-- 3. status='approved', approved_at=now(), document_no, document_issued_at setzen
-- 4. affiliate_programs.books_closed_until = greatest(books_closed_until, period_to)
```

Das PDF wird DANACH erzeugt und abgelegt; `document_path` bleibt bis dahin null. Scheitert der
Storage-Schreibvorgang, ist der Beleg trotzdem gültig — die eingefrorenen Zahlen auf der Zeile SIND
der Beleg, die Datei ist nur ihre deterministische Darstellung, und ein Reparaturlauf erzeugt sie
nach. Damit gibt es keine Lücke in der Nummernfolge, auch wenn Storage ausfällt. Die umgekehrte
Reihenfolge (erst PDF, dann Nummer) hätte genau dieses Problem.

### 7.3 Belegnummer

Lückenlos je Mandant und Jahr, Format `GS-<TENANT_SLUG>-<JAHR>-<6-stellig>`, z. B.
`GS-DEMO-BLAU-2026-000173`.

```sql
create or replace function public.next_affiliate_document_no(p_tenant_id uuid, p_year int)
returns int language plpgsql security definer set search_path = public as $$
declare v_no int;
begin
  insert into public.affiliate_document_counters (tenant_id, year, next_no)
  values (p_tenant_id, p_year, 1)
  on conflict (tenant_id, year) do update
    set next_no = affiliate_document_counters.next_no + 1
  returning next_no into v_no;
  return v_no;
end; $$;
revoke execute on function public.next_affiliate_document_no(uuid,int) from public;
revoke execute on function public.next_affiliate_document_no(uuid,int) from anon, authenticated;
grant  execute on function public.next_affiliate_document_no(uuid,int) to service_role;
```

Ein einziges `insert … on conflict … do update … returning` — dasselbe Race-Absicherungsmuster wie
`increment_usage` (`20260711164826:47-59`). Kein Postgres-Sequence-Objekt, weil Sequenzen bei
Rollback Lücken erzeugen und je Mandant eines anzulegen unwartbar wäre. Die Funktion wird
ausschließlich innerhalb der Freigabe-RPC aufgerufen, also in derselben Transaktion wie der
Statuswechsel: schlägt der Statuswechsel fehl, wird der Zähler mit zurückgerollt.

### 7.4 Steuermodus

Abgeleitet aus `affiliate_billing_profiles`, nie frei wählbar, und auf dem Auszahlungssatz eingefroren:

| Bedingung | `tax_mode` | Satz | Hinweistext auf der Gutschrift |
|---|---|---|---|
| `country='DE'`, `entity_kind='business'`, `small_business=false` | `regular` | 1900 bp | „Gutschrift gemäß § 14 Abs. 2 UStG" |
| `country='DE'`, `entity_kind='business'`, `small_business=true` | `small_business` | 0 | „Kein Ausweis der Umsatzsteuer gemäß § 19 UStG." |
| EU ≠ DE, `entity_kind='business'`, `vat_check_result='valid'` und `vat_checked_at` jünger als 90 Tage | `reverse_charge` | 0 | „Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge), Art. 196 MwStSystRL." |
| Drittland, `entity_kind='business'` | `non_eu` | 0 | „Nicht im Inland steuerbare Leistung." |
| EU ≠ DE ohne gültige, aktuelle USt-IdNr. | — | — | **Auszahlung blockiert**, Partner wird zur Nachreichung aufgefordert |
| `entity_kind='private'` (jedes Land) | — | — | **Auszahlung blockiert**, Hinweis an Partner und Admin |

Die beiden blockierenden Fälle sind Absicht. Ein falscher Ausweis führt zur Steuerschuld nach
§ 14c UStG; das ist teurer als eine verzögerte Auszahlung. Der Privatpersonen-Fall ist ebenfalls
blockierend und nicht nur eine Warnung: eine Gutschrift nach § 14 Abs. 2 UStG setzt einen
Unternehmer als Leistenden voraus, an einen Nichtunternehmer ist sie keine Gutschrift im
umsatzsteuerlichen Sinn. Wie mit Privatpersonen umgegangen wird, ist eine kaufmännische Entscheidung
(Abschnitt 12.4).

```
tax_cents   = floor((subtotal_cents * tax_rate_bp + 5000) / 10000)
total_cents = subtotal_cents + tax_cents
```

Dies ist die EINZIGE Stelle im gesamten Modul mit kaufmännischer Rundung statt `Math.floor` — sie
rechnet auf eine Endsumme, nicht auf eine zu verteilende Größe. Der Unterschied steht als Kommentar
in der Funktion. Beispiel: `subtotal_cents = 15849`, `tax_rate_bp = 1900` →
`floor((15849*1900 + 5000)/10000) = floor(3016,31) = 3016` → 30,16 €, Gesamt 188,65 €.

Wichtig und leicht falsch zu machen: die Provision ist auf den Nettoumsatz des Händlers gerechnet und
damit das NETTO-Honorar des Partners. Die Umsatzsteuer kommt oben drauf, sie ist nicht darin
enthalten. Wer das umdreht, zahlt dauerhaft 19 % zu wenig oder weist eine Steuer aus, die nicht
abgeführt wurde.

### 7.5 USt-IdNr.-Prüfung (VIES)

Serverseitig gegen `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/{cc}/vat/{no}` mit
`AbortController` und 5 s Timeout (Muster `src/lib/webhooks/deliver-attempt.ts:17,56-57`).
Gespeichert werden `vat_check_result`, `vat_checked_at` und die rohe Antwort in `vat_check_log` — das
Prüfprotokoll ist der Nachweis bei einer Betriebsprüfung. Gültigkeit 90 Tage.

Fail-CLOSED, anders als beim Rate-Limiter: ist der Dienst nicht erreichbar, bleibt der Status
`unchecked`, und die Auszahlung wird blockiert. Ein Admin kann per Aktion mit Pflichtbegründung
manuell freigeben; das schreibt einen Audit-Eintrag und setzt `vat_check_log.manual_override`.

### 7.6 Kontrollabgleich

Vor jeder Freigabe und zusätzlich einmal je Cron-Lauf prüft `verifyAffiliateIntegrity(tenantId)` drei
Gleichungen und meldet jede Abweichung in `/portal/affiliate` und in der Mandanten-Übersicht:

1. Für jeden Auszahlungssatz: `sum(amount_cents) über affiliate_commissions where payout_id = X`
   muss `subtotal_cents` des Satzes entsprechen. Weicht es ab, wurde eine Zeile nachträglich
   entstempelt — der Satz wird auf `failed` gesetzt und nicht exportiert.
2. Für jeden Tag und Partner: `affiliate_daily_stats.commission_cents` muss der Summe der positiven
   Buchungszeilen dieses Tages entsprechen. Weicht es ab, wird das Aggregat neu berechnet.
3. Für jede Bestellung mit `refunded_cents > 0`: die Summe der Gegenbuchungen zu ihren Zeilen darf die
   Summe der Ursprungsbeträge nicht übersteigen.

Ohne diesen Abgleich bindet nichts den Belegkopf an seine Positionen; der `check (subtotal = gross +
reversal)` auf der Auszahlungszeile prüft nur die Zeile mit sich selbst.

### 7.7 Export, Überweisung und Verrechnung mit dem Mandanten

`method='sepa'` erzeugt eine SEPA-Sammelüberweisung als `pain.001.001.09`-XML, aus String-Templating
gebaut, ohne neue Abhängigkeit (G16): ein `<PmtInf>`-Block je Währung, eine `<CdtTrfTxInf>` je
Auszahlung, `<EndToEndId>` = Belegnummer. `method='paypal'` erzeugt eine CSV im
PayPal-Massenzahlungsformat, `method='manual'` eine CSV zum Abtippen — beide über das vorhandene
`toCsv()` (`src/lib/reporting/csv.ts:36`) samt dessen Formula-Injection-Schutz, was bei frei
eingegebenen Partnernamen unverzichtbar ist. Download über einen Route Handler mit
`requireAdminTenant()`, Origin-Prüfung, Rate-Limit 20/3600 s je Mandant und
`Content-Disposition: attachment`. Status `approved → exported`.

Nach dem Bankabgleich trägt der Manager eine Referenz ein (zod-validiert). `markAffiliatePayoutPaid()`
setzt `payouts.status='paid'`, `paid_at`, und flippt die zugeordneten Zeilen per Compare-and-Swap:

```ts
.update({ status: "paid", paid_at: nowIso })
.eq("payout_id", payoutId).eq("status", "approved")
```

Schlägt eine Überweisung fehl: `→ failed`, die Zeilen werden freigegeben (`payout_id = null`, Status
bleibt `approved`) und laufen in den nächsten Entwurf. Der Beleg bleibt bestehen und wird durch eine
Stornogutschrift mit eigener Belegnummer neutralisiert — ein einmal erzeugter Beleg wird nie
gelöscht.

Verrechnung mit dem Mandanten: weil der Betreiber Merchant of Record ist (Abschnitt 1.3), zahlt er
die Provision aus und muss sie dem Mandanten belasten. Der Plan sieht dafür einen Report vor —
`/portal/affiliate` weist je Mandant, Monat und Währung die Summe der auf `paid` gesetzten Zeilen aus,
inklusive einer CSV für die Betreiber-Buchhaltung. Ein automatischer Abzug von einer Mandanten-Auszahlung
wird NICHT gebaut, weil es außerhalb des Marketplace gar keinen Betreiber-an-Mandant-Zahlungsstrom
gibt. Das ist die offene Entscheidung 12.1.

### 7.8 DSGVO gegen Aufbewahrungspflicht

Ein Löschantrag darf Gutschriften nicht vernichten (§ 147 AO, § 257 HGB: zehn Jahre). Umsetzung ist
Anonymisierung statt Löschung, ausgeführt von `anonymizeAffiliatePartner(partnerId, reason)`:

- `affiliate_partners`: `display_name` → „Gelöschter Partner", `company` → null, `user_id` → null,
  `applicant_email` → `deleted+<partner_id>@invalid`, `application` → `{}`, `internal_note` → null,
  `terms_accepted_ip_hash` → null.
- `affiliate_billing_profiles`: Zeile gelöscht, NACHDEM alle Belege erzeugt sind (die Anschrift steht
  dann in der PDF, wo sie hingehört).
- `affiliate_clicks` und `affiliate_referrals` des Partners: gelöscht, kein Aufbewahrungsgrund.
- `affiliate_commissions` und `affiliate_payouts`: unverändert — sie sind Buchungsbelege.
- Audit-Eintrag mit Grund.

Für den KÄUFER, nicht den Partner: `affiliate_referrals.user_id` und
`affiliate_customer_bindings` tragen ebenfalls Personenbezug und haben keinen Aufbewahrungsgrund. Der
bestehende Löschprozess (`deletion_requests`, `20260711222020_deletion_requests.sql`) bekommt einen
Schritt, der beide auf `null` setzt bzw. die Bindungszeile löscht. `affiliate_commissions` behält den
`order_id`-Bezug; der Personenbezug dort läuft über `orders`, das bereits Teil des bestehenden
Prozesses ist.

Der Export (`src/lib/gdpr/export.ts:74-83`) wird um vier direkte Abfragen (`affiliate_partners`,
`affiliate_referrals`, `affiliate_customer_bindings` je über `user_id`) und drei zweistufige über die
so gefundene `partner_id` (`affiliate_commissions`, `affiliate_payouts`,
`affiliate_billing_profiles`) erweitert — dasselbe Zwei-Schritt-Muster wie `tutor_messages` (`:89-96`)
und `calendar_workers` (`:105-116`). Ein Nutzer kann gleichzeitig Partner und geworbener Kunde sein;
der Export liefert dann beide Sichten unter getrennten Schlüsseln. Dasselbe im Mandanten-Export
(`src/app/portal/mandanten/[id]/export/route.ts:129`).

---

## 8. Oberflächen je Rolle

Alle Seiten sind Server Components, laden Daten über `createClient()` + `getTenant()` mit
`Promise.all` und tragen ZUSÄTZLICH zu RLS auf jeder Abfrage `.eq("tenant_id", tenant.id)` — Defense
in Depth, wörtlich so kommentiert in `src/app/(admin)/admin/marketplace/page.tsx:10-12`. Keine
`<table>`-Elemente, sondern `rgrid-header`/`rgrid-row` mit `--rgrid-cols` (`src/app/globals.css:110-146`);
unter 1024 px stapelt jede Zeile zur Karte, und jede sonst mehrdeutige Zelle trägt ein
`<span className="rgrid-label">`.

### 8.1 Mandant (Händler) — `/admin/affiliate/*`

Gate dreistufig: Layout-Gate `checkStaffAccess()` (`src/app/(admin)/admin/layout.tsx:18`) erbt jede
Seite; zusätzlich `checkAdminAccess()` je Seite (owner/admin, nicht trainer — es geht um Geld und
Personendaten, Muster `src/app/(admin)/admin/teilnehmer/page.tsx:20-33`); zusätzlich
`requireAffiliateProgram()`, das `tenant.settings.affiliate_enabled === true` SERVERSEITIG prüft und
sonst einen erklärenden Hinweis statt 404 rendert.

| Route | Zweck | Wichtigste Elemente |
|---|---|---|
| `/admin/affiliate` | in fünf Sekunden sehen, ob das Programm gesund ist | Vier Kennzahlen als Text (Klicks 30 T, Verkäufe, verfügbare Provision, Stornoquote); Warnbanner „n Zahlungsereignisse nicht verarbeitet" mit Link; Warnbanner „n geflaggte Buchungen"; Kasten „Offene Bewerbungen (n)"; Top-10-Partner als `rgrid`; letzte 10 Buchungen; Zeitraumwähler; CSV-Export |
| `/admin/affiliate/partner` | Arbeitsansicht des Programm-Managers | `<input type="search" aria-label>` mit clientseitigem Filter über Name und E-Mail (Muster `teilnehmer-liste.tsx:45-52`); Statusreiter über `searchParams`, Wert gegen eine `as const`-Liste geweißt (`abgaben/page.tsx:40-41`); Spalten Name, Code, Gruppe, Status-Chip, Klicks 30 T, Verkäufe, verfügbare Provision; rechts sticky ein Einladungsformular, das einen Link mit Vorab-Freigabe erzeugt; `fetchAllRows()` (`src/lib/reporting/queries.ts:81-97`), weil PostgREST sonst still bei 1000 Zeilen kappt |
| `/admin/affiliate/partner/[id]` | Einzelfall klären, ohne dass eine Rückfrage in einem Datenbankeingriff endet | Vier Karten: Stammdaten und Bewerbungsangaben; Kondition mit Anzeige des TATSÄCHLICH wirksamen Satzes samt Herkunft („aus Gruppe ‚Top-Partner': 40 %"); Kontoauszug (letzte 50 Buchungen); Aktionen (freigeben, ablehnen mit Begründung, sperren, Auszahlungssperre, Handbuchung, interne Notiz). Darunter das Änderungsprotokoll. Bankdaten stehen hier NICHT — nur als Vollständigkeitsampel mit Text, nie mit Werten |
| `/admin/affiliate/konditionen` | die Vorrangkette sichtbar und prüfbar machen | Programmstandard oben; darunter die Regelliste sortiert nach `specificity desc` mit einer Spalte „Rang", also in exakt der Reihenfolge, in der sie greifen; rechts das Formular (Geltungsbereich, Produkt, Art, Satz, Zeitraum); unten ein Rechner: Partner + Produkt wählen → „Es gilt Regel #3: 35 %, das sind bei 499 € brutto 132,08 €." Der Rechner ruft dieselben reinen Funktionen wie der Verarbeiter, keine zweite Rechenlogik |
| `/admin/affiliate/provisionen` | jede Rückfrage zu einem einzelnen Betrag endet hier | Filter (Status, Partner, Produkt, Zeitraum, geflaggt, Test); Spalten Datum, Partner, Produkt/Rechnung, Kampagne, Basis, Satz, Betrag, Status; aufklappbare Zeile zeigt `condition_snapshot` und den Zuordnungsgrund im Klartext („Zuordnung über Klick-Token vom 03.09., Kampagne ‚newsletter-kw36'"); Aktionen Stornieren, Umbuchen, Flag setzen/lösen, Einzelzeile erneut verarbeiten; Handbuchungsformular; CSV-Export |
| `/admin/affiliate/auszahlungen` | Geld bewegen, ohne etwas zu übersehen | Reiter Entwürfe / Freigegeben / Exportiert / Bezahlt / Historie; je Entwurf Partner, Zeitraum, Brutto, Gegenbuchungen, Auszahlbetrag, Steuermodus, Zahlweg, Vollständigkeitsampel als TEXT (nicht nur farbig); Stapelfreigabe mit Bestätigungsdialog, der den Gesamtbetrag ausschreibt; SEPA-XML- und CSV-Knopf; „Als gezahlt markieren" mit Referenzfeld; eigener Abschnitt „Nicht auszahlbar" mit konkretem Grund je Partner |
| `/admin/affiliate/werbemittel` | Material bereitstellen | Liste je Art; Formular mit Upload (Typ- und Größen-Whitelist, Pfad `{tenant_id}/affiliate/creatives/`); Vorschau; Aktiv-Schalter; Platzhalter-Hinweis (`{{link}}`, `{{name}}`) bei E-Mail-Vorlagen |
| `/admin/affiliate/einstellungen` | das Programm konfigurieren, ohne sich selbst zu schaden | Sechs Abschnitte: Grunddaten und Sichtbarkeit; Standardkondition und Provisionsbasis; Attribution; Abo-Verhalten; Geld (Sperrfrist, Reserve, Mindestbetrag, Rhythmus); Texte (Beschreibung, Partnerbedingungen mit Version, Bewerbungsfelder). Zusätzlich Zweitstufe und Testmodus |

Vier sichtbare Warnungen auf `/admin/affiliate/einstellungen`, keine davon blockierend, alle
dokumentiert: bei `hold_days < 14` („kürzer als die gesetzliche Widerrufsfrist"), bei `rate_bp > 5000`,
bei `rate_bp + tier2_rate_bp > 6000`, und beim Ändern von `basis_kind` oder `rate_bp` („gilt nur für
künftige Buchungen; bestehende Buchungen und laufende Abos bleiben unverändert"). Zusätzlich bei
`recurring_mode='all'` der Hinweis, dass das eine unbefristete Verbindlichkeit ist.

### 8.2 Partner — `/partner/*` auf der Mandanten-Domain

Eigene Route-Gruppe `(partner)` mit eigenem Layout-Gate `requireAffiliatePartner()` →
`affiliate_partner_id(tenant.id)`. Partner haben keine `memberships`-Zeile (G9) und sehen weder
Lernbereich noch Admin. Eigene, schlanke Navigation statt der Lern-Sidebar; Branding des Mandanten
über die bestehende `theme-style.tsx`-Injektion — der Partnerbereich ist White-Label, anders als der
Admin-Bereich. Produkt- und Kurstitel liest der Bereich über `createAdminClient()` mit ausdrücklicher
Spaltenliste NACH dem Gate, nicht über RLS.

| Route | Zweck | Wichtigste Elemente |
|---|---|---|
| `/partner` | „Was habe ich verdient?" | Fünf getrennte Salden — offen, in Reserve, in Prüfung, verfügbar, ausgezahlt — nie eine einzige Summe, jeweils mit Erklärungssatz und dem Datum, ab dem der Betrag frei wird; „Nächste Auszahlung am … — es fehlen noch x € zum Mindestbetrag"; Kennzahlen Klicks, eindeutige Klicks, Leads, Verkäufe, Conversion, EPC; Hinweisbanner bei blockierter Auszahlung mit dem konkret fehlenden Feld |
| `/partner/links` | Link in drei Klicks | Natives `<select>` Produkt, `<select>` oder Freitext Zielseite, Feld Kampagne, Ausgabefeld mit fertigem Link und Kopierknopf, dessen Erfolg über `role="status" aria-live="polite"` bestätigt wird; darunter der eigene Code und der Hinweis, wie lange die Zuordnung hält. Marketplace-Ziele werden nicht angeboten (4.7) |
| `/partner/statistik` | eigene Kanäle bewerten | Zeitraumfilter; Aufschlüsselung nach Tag, Produkt und Kampagne; Klicks, eindeutige Klicks, Leads, Verkäufe, Conversion, EPC, Provision, Stornoquote; CSV-Export. Quelle ist ausschließlich `affiliate_daily_stats` |
| `/partner/kontoauszug` | jeden Cent nachvollziehen | Chronologische Liste aller Buchungen mit laufendem Saldo, Statuschip und aufklappbarer Rechnung (Basis, Satz, Regel, Reserve); Auszahlungen mit PDF-Download |
| `/partner/auszahlungen` | Historie und Belege | Datum, Zeitraum, Betrag, Steuermodus, Referenz, Beleg-Download über eine Route mit Besitzprüfung |
| `/partner/team` | nur bei `tier2_enabled` | Eigener Werbe-Link für Partner; Liste der geworbenen Partner mit Name, Beitrittsdatum, Umsatz, erzeugter Zweitstufen-Provision — geladen über eine Server-Route mit `affiliate_downline_ids()` und expliziter Spaltenliste, nie per PostgREST |
| `/partner/stammdaten` | Selbstpflege | Anschrift; abgesetzter Abschnitt Steuerdaten (Rechtsform, USt-IdNr. mit Prüfstatus im Klartext, § 19-Kennzeichen) und Zahlungsverbindung mit klarem Hinweis, wofür sie gebraucht werden; Benachrichtigungsschalter; Datenexport (JSON); Löschantrag |
| `/partner/bedingungen` | Sperren durchsetzbar machen | Programmregeln im Volltext, zugestimmte Version und Zeitstempel; bei erhöhter `terms_version` blockiert ein Dialog alle anderen Partnerseiten bis zur Neuzustimmung |

Datenschutzgrenze, hart: ein Partner sieht nie Käuferdaten — keine E-Mail, keinen Namen, keine
Bestell-ID. Der Kontoauszug zeigt Datum, Produkt, Betrag, Provision, Kampagne, Status.

### 8.3 Öffentlich — `/partnerprogramm`

Programmseite mit Beschreibung, sichtbarem Provisionssatz und erwartetem Verdienst je Verkauf,
Regelwerk und Bewerbungsformular. Sichtbar je nach `program.visibility`: `public` (gelistet, aber nur
je Mandant — es gibt keinen mandantenübergreifenden Marktplatz), `link` (nur über Direktlink, kein
Index), `private` (404). Gelesen über `createAdminClient()` mit ausdrücklicher Spaltenliste, nie über
eine `anon`-Policy.

Das Formular ist exponiert und bekommt alle sechs Schichten des Kontaktformular-Musters
(`src/lib/contact/actions.ts:33-57`), billig zuerst:

1. Honeypot (`CONTACT_HONEYPOT_FIELD`) → still als Erfolg quittieren
2. Zeitfalle (`verifyContactFormToken`, < 3 s = maschinell) → still als Erfolg quittieren
3. Rate-Limits auf drei Ebenen: IP 5/300 s, sha256-gehashte Bewerber-E-Mail 3/3600 s, Mandant 30/3600 s
4. Turnstile (`verifyTurnstile`, fail-open bei Ausfall)
5. zod, inklusive Link- und Markup-Sperre für Namensfelder (`containsLink()`, `containsMarkup()`)
6. Inhaltsbewertung

Schicht 1 und 2 melden bewusst denselben Erfolgstext wie ein Mensch — eine sichtbare Ablehnung wäre
Rückmeldung an den Bot-Betreiber. Das Honeypot-Feld liegt off-screen (`left:-9999px`), NICHT
`display:none`, mit `aria-hidden="true"` und `tabIndex={-1}`: die Falle darf sehende wie blinde
Nutzer nie treffen. Die Seite muss dynamisch sein (über `getTenant()` → `headers()`), damit jeder
Aufruf ein frisches Formular-Token bekommt.

### 8.4 Betreiber — `/portal/*`

`/portal/mandanten/[id]` bekommt eine Checkbox „Partnerprogramm" in der bestehenden Feature-Karte,
neben `marketplaceEnabled` und `shiftCalendarEnabled`. Das ist der einzige Weg, das Modul
einzuschalten; der Mandant hat keinen eigenen Schalter, und der Guard aus 3.0(d) setzt das durch.

`/portal/affiliate` ist eine Nur-Lese-Aufsicht mit `requirePlatformAdmin()`: welche Mandanten ein
aktives Programm betreiben, Zahl aktiver Partner, ausgeschüttete Provision je Mandant, Monat und
Währung (mit CSV für die Betreiber-Buchhaltung, 7.7), Auffälligkeiten (Stornoquote über 20 %,
Negativsalden älter als 90 Tage, unverarbeitete Ereignisse älter als 24 h, Abweichungen aus dem
Kontrollabgleich 7.6). Der Betreiber sieht keine Partner-Bankdaten und keine Käuferdaten — bewusst
enger als die Marketplace-Auszahlungsansicht, weil er beim Partnerprogramm nicht Vertragspartei ist.

### 8.5 Barrierefreiheit

Der Auftraggeber ist sehbehindert, und der Partnerbereich ist die Stelle, an der Barrierefreiheit am
häufigsten scheitert, weil dort Datentabellen und Diagramme dominieren. Verbindlich:

- Jede Kennzahl steht als Text, bevor sie als Grafik erscheint. Kein Wert existiert ausschließlich in
  einem Chart. Jede Zeitreihe wird ZUSÄTZLICH als semantische Tabelle mit Zahlenwerten gerendert;
  jede Grafik trägt `role="img"` und ein `aria-label`, das die tatsächlichen Zahlen nennt (Muster
  `reporting/page.tsx:120-126`).
- Jede `rgrid`-Zelle mit einer bloßen Zahl oder einem Datum bekommt ein `rgrid-label`.
- Kontrast: `#66679B` auf Weiß (rund 5,3:1) für Sekundärtext, Spaltenüberschriften, Leerzustände und
  Zahlen. `#A9AAC4` (rund 2,3:1) fällt durch AA und wird nur für rein dekorative Wiederholungen
  verwendet. In der dunklen Sidebar `#B9BBDA` statt `#8688B8`.
- Schriftgröße: Fließtext im Partnerbereich mindestens 15 px, öffentliche Seiten 18 px bei
  Zeilenhöhe 1,6; 13 px nur für Label und Chips.
- Status nie nur über Farbe: jeder Chip trägt seinen Text (`t(\`status.${row.status}\`)`), Icons sind
  `aria-hidden="true"`.
- Native Elemente: `<select>` für jeden Filter, `<input type="search">` für die Suche (Begründung
  `src/components/settings/locale-switcher.tsx:9-25`).
- Formulare: immer `htmlFor` + `id` mit Datensatz-Präfix (`const idPrefix = partner?.id ?? "new"`),
  nie umschließende Labels — sonst fällt `getByLabel()` in Playwright herein
  (`e2e/marketplace-listing.spec.ts:45-50`). Fehler `role="alert"`, Erfolg
  `role="status" aria-live="polite"`. Nie `outline-none` ohne Ersatzring.
- Klickziele mindestens 40 × 40 px.
- Fokusführung nach einer Server Action: `revalidatePath()` rendert neu und wirft den Fokus an den
  Dokumentanfang. Jede Listenaktion (freigeben, ablehnen, flaggen, auszahlen) setzt den Fokus danach
  ausdrücklich zurück auf das auslösende Element bzw. auf die `role="status"`-Meldung; ohne das
  verliert ein sehbehinderter Betreiber nach jeder Aktion seine Position in einer langen Liste. Jede
  Affiliate-Seite bekommt zusätzlich einen Skip-Link zum Hauptinhalt.

### 8.6 i18n

Neue Namensräume: `admin.affiliate.*` (Händler-UI), `affiliate.*` (Partnerbereich und öffentliche
Programmseite, aufgebaut wie `marketplace.*` mit `shell`/`dashboard`/`links`/`statement`/`terms`/
`apply`), `email.affiliate*` (Mails), `consent.*` (Einwilligungsdialog). Statuswerte als
verschachteltes Objekt, im Code per Template gelesen.

Jeder Schlüssel muss in `de.json`, `en.json` UND `bs.json` — `src/i18n/messages.test.ts:41-57`
vergleicht sortierte Pfadlisten mit `toEqual` und prüft zusätzlich, dass die ICU-Platzhalter
übereinstimmen. Ein fehlender Schlüssel bricht `npm run test`. Deshalb legt Block B1 die
Namensräume als leeres Gerüst in allen drei Dateien an. Die hartkodierten deutschen Labels in
`AdminSidebar.tsx` sind Altlast, kein Vorbild: alle neuen Seiteninhalte laufen über `t()`.

---

## 9. Einhängepunkte im Bestandscode

Alle Zeilennummern gegen den Stand vom 10.09.2026 geprüft. Neun Berührungspunkte, alle additiv; kein
bestehender Zweig wird umgeschrieben.

### 9.1 `src/lib/stripe/checkout.ts:125-129` — Checkout-Metadata

```ts
      metadata: {
        tenant_id: tenant.id,
        product_id: product.id,
        user_id: user.id,
        ...(await affiliateCheckoutMetadata(tenant, user, product.id)),   // NEU
      },
```

`affiliateCheckoutMetadata()` ruft `resolveAttribution()` (Abschnitt 4.4) in einem eigenen
`try/catch` mit Rückgabe `{}` bei Fehler — ein Affiliate-Fehler darf keinen Kauf verhindern — und
liefert `{ affiliate_ref_token?: string }`. Der Aufruf sitzt nach dem `payments_enabled`-Gate
(`:110-112`). Risikofrei, weil beide bestehenden zod-Schemata gewöhnliche `z.object` ohne `.strict()`
sind: unbekannte Schlüssel werden stillschweigend gestrippt, nicht abgelehnt.

`src/lib/marketplace/checkout.ts:118-124` bekommt bewusst KEINEN Zusatz (4.7).

### 9.2 `src/lib/stripe/schema.ts` — neues, eigenständiges Schema am Dateiende

```ts
/** NEU: eigenstaendig, NICHT via .extend() an checkoutMetadataSchema. */
export const affiliateMetadataSchema = z.object({
  affiliate_ref_token: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
```

`marketplaceCheckoutMetadataSchema` ist per `.extend()` eine echte Obermenge von
`checkoutMetadataSchema` (`schema.ts:138-141`), und `handleCheckoutCompleted()` verlässt sich auf
genau diese Beziehung, indem es zuerst das strengere Schema probiert (`route.ts:99`). Wer
Affiliate-Felder in das Basis-Schema hineinerweitert, kippt die Beziehung — Marketplace-Zahlungen
könnten dann in den Direktkauf-Pfad laufen (kein Ledger, falsche Erfüllung). Das eigene `safeParse`
läuft auf `session.metadata` ROH, nie auf `parsedMeta.data` (`route.ts:117`), das die Zusatzschlüssel
bereits verloren hat.

### 9.3 `src/app/api/stripe/webhook/route.ts:64-79` — Event-Switch

Drei neue `case`-Zweige VOR dem `default` (`:75-78`); bestehende Zweige unangetastet:

```ts
      case "charge.refunded":
        await recordAffiliateChargeEvent(event);
        break;
      case "charge.dispute.created":
      case "charge.dispute.closed":
        await recordAffiliateDisputeEvent(event);
        break;
```

Diese Ereignisse werden heute nirgends verarbeitet. Sie müssen zusätzlich im Stripe-Dashboard am
Webhook-Endpunkt ABONNIERT werden, sonst passiert nach dem Deploy still gar nichts (Abschnitt 12.6).

### 9.4 `src/app/api/stripe/webhook/route.ts:200-202` — Direktkauf-Aufnahme

```ts
  await enrollFromProduct(admin, tenantId, userId, productId);

  // NEU. Wirft bewusst -> 500 -> Stripe-Retry (G2). Steht NACH der
  // Zugriffsgewaehr, damit ein Affiliate-Fehler den Kauf nie blockiert.
  // Idempotenz aus unique(stripe_event_id), NICHT aus isNewOrder (:132) -
  // wirft ein frueherer Schritt, ist die Order beim Retry schon da und
  // isNewOrder waere false, die Aufnahme fiele dauerhaft aus.
  await recordAffiliateEvent(admin, event, { tenantId, orderId: order.id, session });

  await sendOrderPaidMail(admin, tenantId, userId, productId);
```

`order.id` liegt ab `:151` vor. Der Aufruf braucht das `event`-Objekt, das `handleCheckoutCompleted()`
heute nicht bekommt — die Funktion erhält deshalb einen zweiten Parameter `event: Stripe.Event`, und
der Aufruf in `:66` wird entsprechend erweitert. Das ist die einzige Signaturänderung an einer
bestehenden Funktion in diesem Plan. Der bekannte offene Fehler daneben (`sendOrderPaidMail()` ist
nicht per `isNewOrder` gegatet, PHASENSTATUS.md, offener Punkt 16) wird NICHT kopiert und hier auch
nicht behoben; er wird beim Testen von B4 sichtbar und darf nicht als Affiliate-Regression
fehlgedeutet werden.

### 9.5 `src/app/api/stripe/webhook/route.ts:386-413` — Abo-Folgeraten

Am Ende von `handleInvoicePaid()`, nach dem bestehenden `subscriptions`-Update:
`await recordAffiliateEvent(admin, event, { stripeInvoiceId: invoice.id, stripeSubscriptionId: subId })`.
Der einzige Ort, an dem wiederkehrende Provisionen entstehen können.
`orders.stripe_checkout_id` darf dafür nicht zweckentfremdet werden.

### 9.6 `src/lib/marketplace/fulfil.ts:216-231` — Marketplace-Erfüllung

Direkt neben dem `marketplace_ledger`-Upsert, wo `order.id`, `grossCents`, `rateBp`,
`commissionCents`, `netCents` und `currency` bereits berechnet vorliegen (`:200-214`). Nötig, weil
`handleCheckoutCompleted()` für Marketplace-Käufe vorzeitig abzweigt (`route.ts:100-104`) — wer den
Hook nur an den Direktkauf hängt, erwischt diese Käufe nie. Da der Promolink-Generator keine
Marketplace-Ziele anbietet (4.7), entsteht hier praktisch nur dann eine Zuordnung, wenn ein Kunde
über einen Mandanten-Link kam und dann ein Marketplace-Listing kaufte.

Wichtig als Kommentar an der Einfügestelle: `marketplace_ledger.net_cents` ist als Verkäufer-Anteil
definiert; die Affiliate-Provision kommt aus dem Brutto und mindert diesen Anteil wirtschaftlich,
ohne die Ledger-Semantik zu ändern. Dass diese Zahl damit nicht mehr der Betrag ist, den der
Verkäufer tatsächlich behält, ist eine bekannte Folge und steht in 12.5.

`src/lib/marketplace/fulfil.ts:37-43` — `computeCommission()` wird unverändert importiert.
`src/lib/marketplace/acquire.ts:66` (Gratis-Erwerb) bekommt bewusst KEINEN Hook: ohne `orders`-Zeile
gibt es keinen Anker für eine Provision, und eine Provision auf einen 0-Euro-Erwerb hat keine Basis.
Der Klick wird trotzdem gezählt und erscheint als Lead.

### 9.7 `src/app/api/admin/ki/process/route.ts:48-56` — Cron

```ts
const [courseGenResult, shiftPlanResult, holidayResearchResult, affiliateResult] =
  await Promise.all([
    processNextCourseGenJob(),
    processNextShiftPlanJob(),
    processNextHolidayResearchJob(),
    processAffiliateQueue(),          // NEU
  ]);
```

Kein neuer Cron-Trigger — `wrangler.jsonc:96` hat genau einen (`*/2 * * * *`), der über das Service
Binding `SELF` läuft (`custom-worker.ts:70`); ein zweiter holte die dort dokumentierte
522-Fehlerklasse zurück. `processAffiliateQueue()` ist wie die drei bestehenden Warteschlangen über
eine eigene Tabelle isoliert und teilt mit ihnen nie eine Zeile. Der Lauf hat ein eigenes
Zeitbudget von 8 Sekunden; wird es überschritten, bricht er zwischen zwei Schritten sauber ab und gibt
`{ truncated: true }` zurück, damit die drei KI-Warteschlangen nicht mitleiden.

### 9.8 Feature-Schalter — fünf Dateien

| Datei:Zeile | Änderung |
|---|---|
| `src/lib/tenant/types.ts` (bei `:115`/`:140`) | `affiliate_enabled?: boolean` mit Kommentar zur Opt-in-Polarität (fehlend = AUS) |
| `src/lib/platform/schema.ts` | `affiliateEnabled` im Feature-Schema |
| `src/lib/platform/actions.ts:552-559` | `affiliate_enabled: formData.get("affiliateEnabled") === "on"` in `mergedSettings` |
| `src/app/portal/mandanten/[id]/{page.tsx,mandant-detail-tabs.tsx,tenant-features-form.tsx}` | Checkbox durchreichen, exakt neben `shiftCalendarEnabled` |
| neue Migration | `tenants_operator_settings_guard()` per `create or replace` um `'affiliate_enabled'` erweitern (3.0d) |

Ohne den letzten Punkt kann jeder Mandanten-Admin sein Modul selbst einschalten — Entitlement-Bypass
derselben Klasse wie der K2-Fund. Und: `marketplace_enabled` wird heute NUR in der UI geprüft, nicht
in `createMarketplaceCheckout()`. Diese Lücke darf `affiliate_enabled` nicht erben; deshalb ruft
jede Server Action und jeder Route Handler `requireAffiliateProgram()` als erste Zeile, und das
prüft das Flag serverseitig.

### 9.9 Navigation — `src/components/layout/AdminSidebar.tsx`

Fünf Stellen in derselben Datei (einzige Nav-Datenquelle; `AdminMobileNav.tsx:97-104` rendert
dieselbe Komponente): `AdminSidebarItemId` (`:68-81`) um `"affiliate"`; `AdminNavItem` (`:83-103`)
um `affiliateOnly?: boolean`; `GROUPS` (`:105-145`) um den Eintrag in der Gruppe „Auswertung" neben
`payments`, mit `icon: Handshake` und `affiliateOnly: true`; `activeFromPath()` (`:148-163`) um
`if (pathname.startsWith("/admin/affiliate")) return "affiliate";`; die Filterzeile (`:309-312`) um
`(!i.affiliateOnly || affiliateEnabled) &&`.

Durchreichkette: `src/app/(admin)/admin/layout.tsx:55-56` → `src/components/admin/admin-shell.tsx`
(Prop ZWEIMAL: Mobile-Nav `:58-59`, Desktop-Sidebar `:69-70`, sonst driften beide auseinander) →
`AdminSidebar`. Jeder neue Nav-Link mit `prefetch={false}` (`src/components/shell/nav-link.tsx:19-32`:
Viewport-Prefetch löste 5–10 zusätzliche `getUser()`-Rundläufe pro Seite aus).

### 9.10 Weitere Anbindungen

`src/lib/webhooks/events.ts:19-27` — vier neue Namen `affiliate.application`, `affiliate.approved`,
`affiliate.commission`, `affiliate.reversal`. `WEBHOOK_EVENTS` ist die einzige Quelle; Admin-UI und
zod-Schema (`:29`) ziehen daraus, und `webhooks.events` ist ein freies `text[]` ohne DB-Constraint
(`0001_init.sql:364`), Bestandszeilen brechen also nicht. Die Datei darf weiterhin kein Node-Builtin
importieren (`events.ts:3-18`). Bekannte Erblast: `/api/admin/webhooks/retry` hängt an keinem Cron,
ausgehende Affiliate-Webhooks erben diese Retry-Lücke.

`src/lib/gdpr/export.ts:74-83` und `src/app/portal/mandanten/[id]/export/route.ts:129` — die sieben
Abfragen aus 7.8.

`messages/de.json:1983` (`legal.privacy.cookiesText`) — der Satz „Kein Tracking, keine
Werbe-Cookies" wird durch dieses Modul falsch. Neuer Abschnitt zu Zweck, Rechtsgrundlage,
Speicherdauer und Empfängern; dieselben Schlüssel in `en.json` und `bs.json`.
`src/lib/legal/updated.ts:14` (`LEGAL_LAST_UPDATED = "2026-08-25"`) hochsetzen — Pflicht laut dortigem
Kommentar. `PROCESSOR_KEYS` (`src/app/(legal)/privacy/page.tsx:32-40`) bleibt unverändert, weil kein
externes Affiliate-Netz beteiligt ist.

### 9.11 Wiederverwendung ohne Neubau

`src/lib/reporting/csv.ts:36` `toCsv()` (UTF-8-BOM, CRLF, Formula-Injection-Schutz);
`src/lib/reporting/queries.ts:81-97` `fetchAllRows()`; `src/lib/marketplace/redirect.ts:19-22`
`resolveSafeNextParam()`; `src/lib/security/rate-limit.ts:16-43`;
`src/lib/security/turnstile.ts:62-103`; `src/lib/contact/form-token.ts:67-72`;
`src/lib/contact/patterns.ts:14-23`; `src/lib/errors/db.ts:39` `translateDbError()`;
`src/lib/errors/generic.ts:15` `genericErrorMessage()`; `src/lib/certificates/pdf.ts` (Montserrat,
`sanitizeForFont()`, `safeAccentColor()`, A4-Grundgerüst); `src/lib/users/import.ts:196`
`buildSetPasswordLink()`; `src/lib/legal/company.ts:69-73` `resolveLegalEntity()`;
`src/lib/security/origin.ts` für die CSRF-Prüfung state-ändernder Route Handler.

### 9.12 Testoberfläche, die brechen kann

`src/lib/marketplace/fulfil.test.ts` mockt den Admin-Client tabellenweise inklusive
`onConflict`-Auswertung (`:81`). `affiliate_events` muss dort mitgeführt werden, sonst laufen
bestehende Tests still ins Leere. Hinweis: `fulfil.test.ts` und `env.test.ts` scheitern in Umgebungen
ohne `.env` bereits vor jeder Änderung — kein Regressionsindiz.

---

## 10. Umsetzungsblöcke

Für jeden Block gilt dieselbe Reihenfolge: Migration schreiben → von Josip anwenden lassen → lokale
Datei auf die tatsächlich vergebene Live-Version umbenennen → `get_advisors(security)` UND
`get_advisors(performance)` laufen lassen → erst danach den App-Code verdrahten. Der umgekehrte Weg
hat schon einmal jeden Prüfungsabschluss lahmgelegt (`submitAttempt()` rief seine RPC vor dem
Anwenden, PHASENSTATUS.md:3979). `apply_migration` per MCP vergibt die Version nach
Ausführungszeitpunkt, nicht nach Dateinamen (H26-Drift, 37 von 58 Dateien betroffen), deshalb tragen
Migrationsdateien zunächst einen Platzhalter-Zeitstempel. Es gibt keine `supabase/config.toml`, kein
lokales Postgres und keinen Docker-Daemon — die Migrationen können in dieser Umgebung nicht
probeweise gefahren werden und brauchen entsprechend sorgfältiges Korrekturlesen. Nach jedem Feature
der `tester`-Agent, nach jedem Block der `security-reviewer` (CLAUDE.md §4.3), danach
`PHASENSTATUS.md` aktualisieren.

### B1 — Fundament (vollständig inert, nichts sichtbar)

Dateien in dieser Reihenfolge:

```
supabase/migrations/<ts>_affiliate_core.sql
    3.0 (a)-(d), 3.1, 3.2, 3.3, 3.4, 3.5, 3.13, 3.16
src/lib/tenant/types.ts                         affiliate_enabled?: boolean + Polaritaetskommentar
src/lib/platform/schema.ts                      affiliateEnabled im Feature-Schema
src/lib/platform/actions.ts (:552-559)          Schalter in mergedSettings
src/app/portal/mandanten/[id]/tenant-features-form.tsx   Checkbox
src/app/portal/mandanten/[id]/{page.tsx,mandant-detail-tabs.tsx}   durchreichen
messages/{de,en,bs}.json                        leeres Geruest admin.affiliate.*, affiliate.*,
                                                email.affiliate*, consent.*
src/lib/affiliate/types.ts
src/lib/affiliate/schema.ts                     alle zod-Schemata
src/lib/affiliate/state.ts                      Action-State-Typen (eigene Datei, weil
                                                "use server" nur async Fn exportieren darf)
src/lib/affiliate/access.ts                     requireAffiliateProgram(), requireAffiliateManager(),
                                                requireAffiliatePartner()
src/lib/affiliate/compute.ts                    REIN: computeBaseCents, resolveCondition,
                                                computeCommissionParts, computeTier2Cents,
                                                computeReversalDelta, computeBalances, buildDedupKey
src/lib/affiliate/compute.test.ts
src/lib/affiliate/audit.ts                      writeAuditEntry mit Redaktion (3.16)
```

Tests: `compute.test.ts` deckt alle vier Beispiele aus 5.9 zahlengenau ab, dazu die Vorrangkette über
alle sechs Spezifitätsstufen, das Zeitfenster `valid_from`/`valid_to`, `base <= 0`, die Klammerung
von `rate_bp`, den Gesamtdeckel aus 5.6, und explizit den Fall „zwei aufeinanderfolgende
Teilerstattungen" gegen die falsche Deckel-Logik. Zusätzlich ein Test, dass `messages.test.ts` grün
bleibt.

Abnahme: `npm run test` und `npm run lint` grün; der Schalter im Betreiber-Portal lässt sich umlegen;
ein Mandanten-Admin kann `affiliate_enabled` per direktem PostgREST-Update NICHT setzen (manuell
gegen die Live-DB geprüft); `get_advisors` meldet keinen neuen Befund; keine Route und kein Menüpunkt
sind sichtbar.

### B2 — Einwilligung (Voraussetzung für B3, nicht verhandelbar)

```
supabase/migrations/<ts>_tracking_consents.sql   3.17
src/lib/consent/schema.ts
src/lib/consent/read.ts                          readTrackingConsent aus cookies()
src/lib/consent/read.test.ts
src/lib/consent/actions.ts                       "use server": setTrackingConsent, Cookie ct_consent
                                                 (httpOnly, host-only, 6 Monate, Muster setLocale())
src/components/consent/consent-banner.tsx        role="dialog" aria-modal, Fokusfalle,
                                                 gleichwertiges Ablehnen, Tastaturbedienung
src/app/(portal)/einstellungen/...               Widerruf
src/app/(legal)/privacy/page.tsx                 neuer Abschnitt
src/lib/legal/updated.ts (:14)                   Datum hochsetzen
messages/{de,en,bs}.json                         cookiesText korrigiert, consent.*
```

Tests: `read.test.ts` für die Zustandsauflösung (jüngste Zeile gewinnt, Widerruf schlägt Zustimmung);
ein Playwright-Test, dass der Dialog per Tastatur vollständig bedienbar ist und „Ablehnen" gleich
prominent ist wie „Annehmen".

Abnahme: ohne Einwilligung wird kein `ct_aff`-Cookie gesetzt (in B3 nachgeprüft); `messages.test.ts`
grün; Lighthouse mobil auf `/` weiterhin ≥ 90 und LCP < 1 s gemessen — der Dialog rendert auf jeder
öffentlichen Seite und ist der einzige Baustein dieses Plans, der das Performance-Budget messbar
verletzen kann.

### B3 — Klick und Attribution

```
supabase/migrations/<ts>_affiliate_tracking.sql
    3.6, 3.7, 3.8, 3.14
src/lib/affiliate/click-target.ts        Zielschluessel -> interner Pfad; REIN
src/lib/affiliate/click-target.test.ts   //, javascript:, absolute URLs, .., Unicode
src/lib/affiliate/bot.ts                 UA-Muster + Accept + Sec-Fetch-Dest; REIN
src/lib/affiliate/bot.test.ts
src/lib/affiliate/hash.ts                HMAC-IP mit Tagessalz
src/lib/affiliate/cookie.ts              Cookie-Optionen zentral
src/lib/affiliate/track.ts               Klickzeile schreiben, Dedup, Tagesobergrenze
src/app/api/aff/k/route.ts               oeffentlicher Redirect-Endpunkt
src/lib/affiliate/attribution.ts         resolveAttribution(), REIN ueber geladene Kandidaten
src/lib/affiliate/attribution.test.ts    R0-R9 einzeln, First/Last, Ablauf, Ueberschreibregel,
                                         Selbst-Empfehlung, E-Mail-Normalisierung, fremder Mandant
src/lib/affiliate/bind.ts                bindReferral()
src/lib/affiliate/checkout-meta.ts       affiliateCheckoutMetadata()
src/lib/stripe/checkout.ts (:125-129)    Metadata additiv
src/lib/stripe/schema.ts                 affiliateMetadataSchema am Dateiende
src/app/(learn)/kaufen/[productSlug]/page.tsx   ?aff aus searchParams (Promise!)
src/components/learn/buy-button.tsx (:37)       zweiter, optionaler Parameter
src/lib/auth/actions.ts                  bindReferral() nach Login und Registrierung
e2e/affiliate-klick.spec.ts
```

Tests: Unit für alle reinen Funktionen; E2E prüft, dass ein Klick ohne Einwilligung kein Cookie
setzt und trotzdem `?aff=` anhängt, dass ein Klick mit Einwilligung das Cookie setzt, dass ein
absolutes oder protokollrelatives Ziel verworfen wird, dass ein unbekannter Code dieselbe Antwort
liefert wie ein gesperrter Partner, und dass ein Request mit `Sec-Fetch-Dest: image` eine
`is_bot`-Zeile erzeugt, aber keine Referral-Zeile.

Abnahme: Cloudflare-Rate-Limiting-Regel auf `/api/aff/k` in der Zone eingerichtet und dokumentiert
(G18) — ohne sie geht der Block nicht live; die Antwortzeit des Endpunkts liegt unter 200 ms
Serverzeit; es entsteht keine einzige Buchung, weil B4 noch fehlt.

### B4 — Buchung

```
supabase/migrations/<ts>_affiliate_commissions.sql
    3.9, 3.10, 3.11 samt Guard
    + RPC book_affiliate_commissions(jsonb)      -- alle Zeilen einer Bestellung atomar
    + RPC approve_due_affiliate_commissions()
src/lib/affiliate/intake.ts              recordAffiliateEvent() - wirft (G2)
src/lib/affiliate/intake.test.ts         23505 wird geschluckt, alles andere wirft
src/lib/affiliate/process.ts             processAffiliateQueue(), fuenf Schritte (6.5)
src/lib/affiliate/process.test.ts        Reihenfolge vertauscht, doppelte Zustellung, Giftzeile,
                                         pausiertes Programm, Abo-Zaehler unter Nebenlaeufigkeit,
                                         currency_mismatch, tenant-Aufloesung ueber payment_intent
src/app/api/stripe/webhook/route.ts      (:66 Signatur, :200-202, :386-413)
src/lib/marketplace/fulfil.ts (:216-231) Aufnahme neben dem Ledger
src/lib/marketplace/fulfil.test.ts       Mock um affiliate_events erweitern
src/app/api/admin/ki/process/route.ts (:48-56)   vierte Warteschlange
src/app/api/admin/affiliate/reprocess/route.ts   x-cron-secret, zeitkonstanter Vergleich
src/app/api/admin/affiliate/backfill/route.ts    stripe.events.list (6.6)
```

Tests: `process.test.ts` mit dem etablierten In-Memory-Query-Builder aus
`src/lib/marketplace/fulfil.test.ts:43-115`, inklusive `onConflict`-Auswertung und Fehler-Injektion.
Ein Test bucht dieselbe `stripe_event_id` zweimal und erwartet genau eine Zeilengruppe. Ein Test
liefert `invoice.paid` vor `checkout.session.completed` und erwartet, dass das Ereignis auf `pending`
bleibt und beim zweiten Lauf verarbeitet wird.

Abnahme: ein manueller Stripe-Testmodus-Durchlauf des DIREKTKAUFS OHNE Affiliate ist vorher grün
(PHASENSTATUS.md, offener Punkt 8 — sonst debuggt man zwei Fehler gleichzeitig); danach erzeugt ein
Testkauf mit Partnerlink genau zwei Zeilen (`sale` + `reserve`) mit korrektem Snapshot; ein zweiter
Zustellversuch desselben Events erzeugt keine weitere Zeile; `affiliate_events` enthält keine Zeile
mit `status='error'`. B4 wird NICHT ohne B5 freigeschaltet, oder `hold_days` steht bis zum
B5-Deploy auf mindestens 60, damit bis dahin nichts freigegeben wird.

### B5 — Storno, Dispute, Wiedergutschrift

```
supabase/migrations/<ts>_affiliate_reversals.sql   nur RPC-Ergaenzungen, keine neue Tabelle
src/lib/affiliate/reversal.ts            reverseForRefund, reverseForDispute, recreditForWonDispute
src/lib/affiliate/reversal.test.ts       Voll, Teil, Mehrfach-Teil mit KUMULATIVEM Betrag,
                                         Ueberstornierung unmoeglich, tier2 folgt, Status-Eimer (G6),
                                         gewonnener Dispute, Restcent bei Vollstorno = 0
src/app/api/stripe/webhook/route.ts (:64-79)   drei neue case-Zweige
src/lib/affiliate/orders.ts              orders.refunded_cents + status setzen
src/lib/email/templates.ts               affiliateReversal
messages/{de,en,bs}.json                 email.affiliateReversal*
```

Abnahme: die drei Ereignisse sind im Stripe-Dashboard abonniert (12.6); eine Teilerstattung im
Testmodus erzeugt exakt die in 5.9 Beispiel C berechneten Beträge; eine zweite Teilerstattung erzeugt
das Delta und nicht den Zielwert; `orders.status` steht danach auf `partially_refunded`.

### B6 — Mandanten-Oberfläche

```
src/lib/affiliate/queries.ts             alle Leseabfragen, fetchAllRows() wo noetig
src/lib/affiliate/actions.ts             "use server": Programm, Partner, Bewerbung, Kondition,
                                         Gruppe, Handbuchung, Umbuchung, Flags, Notiz
src/lib/affiliate/actions.test.ts        Rollen-Gate, Mandantenpruefung client-gelieferter IDs,
                                         Statuswechsel, G15 (Selbstfreigabe abgewiesen)
src/components/layout/AdminSidebar.tsx   fuenf Stellen (9.9)
src/components/admin/admin-shell.tsx     Prop zweimal
src/app/(admin)/admin/layout.tsx (:55)   Prop
src/app/(admin)/admin/affiliate/{page,partner/page,partner/[id]/page,konditionen/page,
    provisionen/page,werbemittel/page,einstellungen/page}.tsx  + "use client"-Teile
src/app/api/admin/affiliate/csv/route.ts  Export, toCsv + Rate-Limit + Origin-Pruefung
messages/{de,en,bs}.json                  admin.affiliate.* fuellen
e2e/affiliate-admin.spec.ts
```

Tests: E2E legt eine Kondition an, prüft, dass der Rechner denselben Betrag ausgibt wie die spätere
Buchung, gibt eine Bewerbung frei und prüft, dass der Fokus danach auf der Zeile steht. Unit prüft,
dass jede Server Action eine fremde `partner_id` mit „nicht gefunden" abweist.

Abnahme: alle sieben Seiten unter 1024 px als Karten lesbar; jede Kennzahl als Text vorhanden;
Kontrastprüfung aller neuen Textfarben gegen AA bestanden; `npm run lint` grün.

### B7 — Partnerbereich und öffentliche Bewerbung

```
src/app/(partner)/layout.tsx             Gate, Branding, Neuzustimmungs-Dialog
src/components/affiliate/partner-shell.tsx
src/components/affiliate/saldo-karten.tsx        fuenf getrennte Salden
src/components/affiliate/zeitreihe.tsx           Tabelle + SVG, nie nur SVG
src/lib/affiliate/statement.ts           Kontoauszug mit laufendem Saldo; REIN
src/lib/affiliate/statement.test.ts
src/lib/affiliate/partner-actions.ts     Selbstpflege, Benachrichtigungen, Zustimmung
src/app/(partner)/partner/{page,links/page,statistik/page,kontoauszug/page,
    auszahlungen/page,team/page,stammdaten/page,bedingungen/page}.tsx
src/app/api/affiliate/csv/route.ts       Export fuer den Partner, eigener Rate-Limit
src/app/partnerprogramm/{page.tsx,bewerbung-form.tsx}
src/lib/affiliate/apply.ts               die sechs Schutzschichten
src/lib/affiliate/apply.test.ts          Honeypot, Zeitfalle, drei Rate-Limit-Ebenen
messages/{de,en,bs}.json                 affiliate.*
e2e/affiliate-partner.spec.ts, e2e/affiliate-bewerbung.spec.ts
```

Eine E2E-Vorbedingung, die es heute nicht gibt: `e2e/global-setup.ts` und die Helfer kennen nur
Staff- und Mitglieder-Fixtures. Ein Partner OHNE `memberships`-Zeile ist ein neuer Fall. B7 legt
deshalb `e2e/helpers/test-data.ts` um `createE2ePartner()` und einen Login-Zustand
`e2e/.auth/partner.json` an. Bei `workers: 1` und geteiltem Mandantenzustand ist das kein
Nebenaufwand und gehört in die Blockplanung.

Abnahme: ein Partner ohne Mitgliedschaft kommt an `/partner` und wird von `/dashboard` sauber
dorthin weitergeleitet statt eine leere Seite zu sehen; das Bewerbungsformular quittiert Honeypot und
Zeitfalle mit demselben Erfolgstext wie ein Mensch; der Kontoauszug enthält keine Käuferdaten
(automatisch geprüft, indem der Test die Antwort auf E-Mail-Muster durchsucht).

### B8 — Auszahlung, Beleg, Steuer

```
supabase/migrations/<ts>_affiliate_payouts.sql
    3.12 samt Guard + next_affiliate_document_no + approve_affiliate_payout
    + Storage-Bucket affiliate-documents (privat, Typ-/Groessen-Whitelist,
      Policies nach Muster 20260710214020_0002_storage.sql)
src/lib/affiliate/tax.ts                 Steuermodus ableiten, tax_cents; REIN
src/lib/affiliate/tax.test.ts            alle sechs Faelle inkl. der zwei Blockaden
src/lib/affiliate/vies.ts                Pruefung, Timeout, Protokoll, fail-closed
src/lib/affiliate/payout.ts              Kandidaten, Entwurf mit CAS, Freigabe, gezahlt, fehlgeschlagen
src/lib/affiliate/payout.test.ts         Mindestbetrag, Negativsaldo, blockiertes Profil,
                                         Waehrungstrennung, zwei gleichzeitige Laeufe, G15
src/lib/affiliate/integrity.ts           verifyAffiliateIntegrity (7.6)
src/lib/affiliate/integrity.test.ts
src/lib/affiliate/credit-note.ts         Gutschrift-PDF mit pdf-lib
src/lib/affiliate/sepa.ts                pain.001.001.09 per String-Templating
src/lib/affiliate/sepa.test.ts           Schema-Rumpf, Sonderzeichen, Betraege, mehrere Waehrungen
src/app/(admin)/admin/affiliate/auszahlungen/{page.tsx,lauf-form.tsx}
src/app/api/admin/affiliate/payout-export/route.ts
src/app/api/affiliate/beleg/[id]/route.ts    Besitzpruefung, dann Signed URL (kurzlebig)
```

Abnahme: die Bundlegröße wird vor dem Deploy gemessen und liegt unter 3 MiB gzip; ein Entwurf über
zwei Währungen erzeugt zwei Sätze; ein Partner ohne `entity_kind` erscheint unter „Nicht auszahlbar"
mit genau diesem Grund; die Belegnummern zweier gleichzeitig freigegebener Auszahlungen sind
lückenlos aufeinanderfolgend; `verifyAffiliateIntegrity()` meldet nach einem vollständigen
Testdurchlauf keine Abweichung.

### B9 — Benachrichtigungen, DSGVO, Aufsicht, API

```
src/lib/email/templates.ts               affiliateApplicationReceived, affiliateApproved,
                                         affiliateRejected, affiliateSale, affiliatePayout
src/lib/email/templates.test.ts          erweitern (ein fehlender Message-Key wirft dort)
src/lib/webhooks/events.ts (:19-27)      vier Ereignisnamen
src/lib/gdpr/export.ts (:74-83)          sieben Abfragen (7.8)
src/app/portal/mandanten/[id]/export/route.ts (:129)   dieselben
src/lib/affiliate/anonymize.ts           anonymizeAffiliatePartner (7.8)
src/lib/affiliate/anonymize.test.ts
src/app/portal/affiliate/page.tsx        Betreiber-Aufsicht + CSV (7.7)
src/app/api/v1/affiliates/route.ts
src/app/api/v1/affiliates/[id]/stats/route.ts
src/app/api/v1/affiliate-commissions/route.ts
PHASENSTATUS.md                          Erledigt / Offen / Risiken, Migrationsstatus
```

Die v1-API liefert ausschließlich AGGREGIERTE Daten, niemals Klick-Rohzeilen: `public.api_keys`
(`0001_init.sql:349-358`) hat kein Scope-Feld, jeder gültige Schlüssel kann alles. Klickzeilen sind
personenbezogen; sie über eine API auszuliefern, die keine Rechtetrennung kennt, wäre ein Datenleck
mit Ansage. Ein schreibender Klick-Endpunkt gehört nicht nach `/api/v1` — der ist öffentlich und
unauthentifiziert, während `/api/v1` per Definition Bearer-Auth verlangt.

Abnahme: `templates.test.ts` grün gegen alle drei Sprachdateien; ein Datenexport eines Nutzers, der
gleichzeitig Partner und Käufer ist, enthält beide Sichten unter getrennten Schlüsseln; die
Anonymisierung lässt `affiliate_commissions` und `affiliate_payouts` unverändert.

### B10 — Ausbau, jederzeit streichbar

```
supabase/migrations/<ts>_affiliate_coupons.sql   affiliate_coupons als Tracking-Traeger
src/lib/affiliate/coupon.ts
```

Ohne B10 funktioniert der Partner-Code weiterhin als Tracking-Träger — er setzt die Zuordnung, nur
ohne Rabatt. Der Preiseingriff über Stripe Promotion Codes ist die einzige Stelle im Modul, an der
ein Fehler still den Preis ändert; heute setzt keiner der beiden Checkout-Pfade
`allow_promotion_codes`, Preise entstehen fest über `stripe.prices.create()`. Wird B10 gebaut, muss
die Attributionsregel R3 unter R5 rutschen (4.4) und `program.discount_reduces_base` als vierte
Basis-Einstellung dazukommen.

### 10.1 Warum diese Reihenfolge

Die reinen Funktionen (B1) stehen vor allem, was sie benutzt — sie sind ohne Datenbank-Mock testbar
und legen die Rechenregeln fest, bevor irgendein Aufrufer sie verdrahten kann. Die Einwilligung (B2)
steht vor dem Klick, weil ohne sie kein Cookie gesetzt werden darf. Der Klick (B3) steht vor der
Buchung (B4), weil eine Buchung ohne Zuordnung sinnlos ist. Der Storno (B5) folgt unmittelbar auf die
Buchung, damit es zu keinem Zeitpunkt Provisionen gibt, die man nicht zurücknehmen kann. Die
Auszahlung (B8) kommt nach den Oberflächen, weil sie den größten fachlichen Klärungsbedarf hat und
bis dahin echte Daten zum Prüfen vorliegen. B1 bis B5 sind ohne den Feature-Schalter vollständig
inert: keine Route sichtbar, kein Menüpunkt, keine Buchung. Sichtbar wird das Modul erst ab B6.

---

## 11. Sicherheitsanforderungen als Prüfliste

Die Nummerierung folgt CLAUDE.md Abschnitt 2. Jeder Punkt ist vom `security-reviewer` je Block
abzuhaken.

**11.1 (§2.1 tenant_id + RLS + Policies im selben Migrationsschritt).** Alle sechzehn neuen Tabellen
tragen `tenant_id` mit `on delete cascade` und werden im selben Schritt mit RLS und Policies
angelegt. Ausnahme mit Begründung im Migrationskopf: `affiliate_events` und
`affiliate_document_counters` haben zwar `tenant_id` (bei `affiliate_events` nullable, 3.10), aber
bewusst nur eine Deny-All-Policy — Zugriff ausschließlich über `service_role`, Vorbild
`platform_settings`/`marketplace_ledger` (`20260803100200:8-15`). Jede Kindtabelle trägt
`unique (id, tenant_id)` und referenziert Eltern über den zusammengesetzten Schlüssel; jeder
zusammengesetzte FK hat einen Index auf beide Spalten.

**11.2 (§2.2 Secrets nur serverseitig).** Kein neuer Secret-Wert. `SUPABASE_SERVICE_ROLE_KEY` wird
ausschließlich als HMAC-Schlüsselmaterial für `ip_hash` und den Zustimmungsnachweis verwendet, immer
domänenpräfixiert abgeleitet, nie ausgegeben. Alle Affiliate-Module mit DB-Zugriff tragen
`import "server-only"`; die reinen Rechenmodule bewusst nicht, damit sie testbar bleiben.

**11.3 (§2.3 zod an jeder Eingabegrenze).** Klickparameter (`c`, `z`, `cam`), Bewerbungsformular,
alle Server Actions, das Stripe-Metadata-Feld (`affiliateMetadataSchema` auf `session.metadata` roh),
alle v1-Query-Parameter, die Auszahlungsreferenz und der `x-cron-secret`-Body. Fehlerausgabe immer
`parsed.error.issues[0]?.message ?? "Ungültige Eingabe."`.

**11.4 (§2.4 Webhook-Signatur vor jeder Verarbeitung).** Unverändert: der bestehende Aufbau in
`src/app/api/stripe/webhook/route.ts:31-60` prüft die Signatur, bevor der Event-Switch läuft. Die
drei neuen `case`-Zweige liegen hinter dieser Prüfung. `recordAffiliateEvent()` wird nie von
außerhalb des signaturgeprüften Pfades aufgerufen.

**11.5 (§2.5 Datei-Uploads).** Werbemittel: Typ-Whitelist (`image/png`, `image/jpeg`, `image/webp`,
`application/pdf`), Größenlimit 5 MB, Pfad `{tenant_id}/affiliate/creatives/`. Gutschriften:
`{tenant_id}/affiliate/payouts/`, Bucket privat, Auslieferung nur über eine Route mit Besitzprüfung
und anschließend erzeugter, kurzlebiger Signed URL. Die Auszahlungsmail enthält einen Link auf DIESE
Route, nie eine signierte URL direkt — eine signierte URL ist ein unauthentifiziertes Inhaber-Token,
und ein Beleg mit Name, Anschrift und Steuernummer gehört nicht tagelang als Inhaber-Token in ein
Postfach.

**11.6 (§2.6 keine Secrets oder echten Daten in Tests).** Alle Fixtures mit `e2e-`-Präfix und
generiertem Suffix, E-Mail-Domain `@example.invalid`, IBAN aus dem offiziellen Testbereich, keine
echten USt-IdNr. Der Zustimmungsnachweis `terms_accepted_ip_hash` verwendet ein STATISCHES,
domänenpräfixiertes Salz und nicht das tagesrotierende der Klicktabelle — sonst wäre der Nachweis
nach einem Tag nicht mehr verifizierbar. Er wird mit der Partnerzeile anonymisiert (7.8).

**11.7 (§2.7 Bot-Schutz für öffentliche Formulare).** Das Bewerbungsformular hat alle sechs Schichten
(8.3). Der Klick-Endpunkt ist zwar öffentlich, aber ein GET ohne Nutzereingabe: dort greifen
stattdessen Bot-Filter mit `Accept`- und `Sec-Fetch-Dest`-Prüfung, Dedup-Constraint,
Tagesobergrenze je Partner, der Postgres-Rate-Limiter als Grundschutz und die
Cloudflare-WAF-Regel als eigentlicher Schutz (G18).

**11.8 (§2.8 Sitzungen laufen ab).** Unverändert; der Partnerbereich nutzt dieselbe
Supabase-Auth-Session wie der Rest der App. Das Attributions-Cookie ist keine Sitzung und trägt
`maxAge = cookie_ttl_days * 86400` mit einem harten Obergrenzen-Check von 365 Tagen im Schema.

**11.9 (§2.9 CSRF).** Server Actions sind durch den Origin-Check von Next.js abgedeckt. Die
state-ändernden Route Handler dieses Moduls — `/api/admin/affiliate/csv`,
`/api/admin/affiliate/payout-export`, `/api/admin/affiliate/reprocess`,
`/api/admin/affiliate/backfill`, `/api/affiliate/csv`, `/api/affiliate/beleg/[id]` — bekommen
zusätzlich `verifySameOrigin()` (`src/lib/security/origin.ts:17-26`). Der Klick-Endpunkt bekommt sie
ausdrücklich NICHT: er kommt per Definition von einer fremden Domain, hat oft gar keinen
Origin-Header, und die Funktion ist fail-closed — sie würde jeden Affiliate-Klick abweisen.

**11.10 (§2.10 nur `anon`-Key im Client, `createAdminClient()` nur nach Autorisierung).** Jede
Verwendung des Admin-Clients in diesem Modul ist einzeln aufgeführt und hat eine vorgelagerte
Prüfung: Klick-Endpunkt (öffentlich, aber nur schreibend in `affiliate_clicks`/`affiliate_referrals`,
mit Mandantenbindung aus dem Middleware-Header), Verarbeiter (`x-cron-secret`), Buchungs-RPC (nur
`service_role`), Admin-Server-Routen (`requireAdminTenant()`), Partner-Routen
(`requireAffiliatePartner()`), öffentliche Programmseite (ausdrückliche Spaltenliste), v1-API
(`resolveApiKeyTenant()` plus zwingend `.eq("tenant_id", tenantId)` auf jeder Abfrage).

**11.11 (§2.11 keine Klartext-Secrets in Logs).** Vor jedem `console.error` in diesem Modul läuft
`redactAffiliateError()`: es entfernt Referral-Token (64 Hex), Stripe-IDs, IBAN, USt-IdNr. und
E-Mail-Adressen aus der Zeichenkette und ersetzt sie durch Typmarker. Dasselbe gilt für
`affiliate_events.last_error`, das eine dauerhaft gespeicherte Fehlerzeichenkette ist, und für
`affiliate_audit_log.before/after` (3.16). `error.message` erreicht nie die UI — dort immer
`translateDbError()` bzw. `genericErrorMessage()`.

**11.12 (§2.12 keine String-Konkatenation in SQL).** Ausschließlich Supabase-Query-Builder und
parametrisierte RPCs. Die dynamischen Filter in `/admin/affiliate/provisionen` werden über eine
`as const`-Whitelist auf Spaltennamen abgebildet, nie aus der Nutzereingabe gebaut. Kein dynamisches
SQL in einer plpgsql-Funktion.

**11.13 (§2.13 Tokens nur in httpOnly-Cookies).** `ct_aff` und `ct_consent` sind `httpOnly`,
`secure` in Produktion, `sameSite: "lax"`, host-only ohne `domain`-Attribut, `path: "/"`. Nichts
davon landet in `localStorage` oder `sessionStorage`. Der `?aff=`-Parameter trägt zwar dasselbe
Token in der URL und damit in Browser-Historie und Edge-Logs — das ist der Preis des
einwilligungsfreien Pfads und im Datenschutztext benannt; das Token ist opak und ohne DB-Zugriff
wertlos, und ein Angreifer kann damit höchstens ein bestehendes, nicht erratbares Token benennen, nie
einen Partner erfinden oder einen Satz setzen.

**11.14 (§2.14 Security-Header).** Unverändert aus `next.config.ts:14-42`; keine Route dieses Moduls
setzt sie herunter. Der Klick-Endpunkt setzt zusätzlich `Cache-Control: no-store, private`.

**11.15 (§2.15 nur berechtigte Daten, keine Enumeration).** Jede client-gelieferte ID wird gegen
`tenant_id` geprüft, bevor damit geschrieben wird; die Buchungs-RPC prüft die Mandantenbindung der
`order_id` und der `partner_id` serverseitig nach — genau die Fehlerklasse, die beim Marketplace zu
vier Nachbesserungs-Migrationen geführt hat (`20260803100400:52-83`). Der Klick-Endpunkt liefert für
„Code existiert nicht" und „Partner gesperrt" dieselbe Antwort. Das Bewerbungsformular quittiert eine
bereits vorhandene Bewerbung mit demselben Text wie eine neue. Ein Partner sieht nie Käuferdaten
(3.11) und nie die vollen Zeilen anderer Partner (3.1, `affiliate_downline_ids()`).

**11.16 (zusätzlich, nicht in CLAUDE.md: Interessenkonflikt).** G15 ist im Guard-Trigger, in der
Server Action und im Auszahlungslauf umgesetzt und wird je Block eigens geprüft.

**11.17 (zusätzlich: Geldabfluss-Obergrenze).** Der Gesamtdeckel aus 5.6 ist DB-nah geprüft; eine
Handbuchung über 500 € erfordert eine zweite Bestätigung mit ausgeschriebenem Betrag und erzeugt
einen Betreiber-Hinweis in `/portal/affiliate`. Ohne diese Grenze könnte ein übernommenes
Händler-Konto in einer Sitzung beliebig hohe Provisionen buchen und auszahlungsreif machen.

**11.18 (Advisor-Hygiene).** Nach jedem angewendeten Block laufen `get_advisors(security)` und
`get_advisors(performance)`. Jede neue Funktion bekommt die drei Rechte-Zeilen (`revoke from public`,
`revoke from anon`, gezielter `grant`) und nach jedem `create or replace` erneut. Jede Deny-Tabelle
bekommt gleich die explizite Deny-Policy, damit kein neuer `rls_enabled_no_policy`-Dauerbefund
entsteht. Jede Policy verwendet `(select auth.uid())` statt nacktem `auth.uid()`; die
Security-Definer-Helfer bleiben ungekapselt. Genau eine SELECT-Policy je Tabelle (G17).

---

## 12. Risiken und offene Entscheidungen für Josip

### 12.1 Wer zahlt die Provision, und wie wird sie dem Mandanten belastet? (Entscheidung nötig vor B8)

Die Plattform ist Merchant of Record (1.3). Das Geld eines Mandantenverkaufs landet beim Betreiber,
nicht beim Mandanten. Wenn der Mandant einem Partner 158,49 € zusagt, überweist faktisch der
Betreiber. Für Marketplace-Käufe gibt es mit `marketplace_ledger` einen Betreiber-an-Mandant-Strom,
aus dem sich das verrechnen ließe; für Direktverkäufe gibt es überhaupt kein Hauptbuch. Drei mögliche
Antworten, alle kaufmännisch, keine technisch:

(a) Der Betreiber zahlt aus und stellt dem Mandanten monatlich eine Rechnung über die Summe. Der Plan
unterstützt das ab Werk über den Report in `/portal/affiliate` samt CSV (7.7).
(b) Es entsteht ein allgemeines Mandantenkonto (nicht nur Marketplace), von dem alle
Betreiberforderungen abgezogen werden. Das ist eine eigene Ausbaustufe.
(c) Der Mandant zahlt seine Partner selbst außerhalb der Plattform; das System erzeugt nur die
Abrechnung. Dann entfällt der gesamte SEPA-Export aus B8, und `affiliate_payouts` wird ein reines
Belegdokument.

Bis zur Entscheidung wird (a) gebaut, weil es der kleinste Eingriff ist und (b) und (c) daraus
ableitbar bleiben.

### 12.2 Wird `automatic_tax` aktiviert? (Entscheidung nötig vor B4)

Ohne `automatic_tax` ist `amount_tax` immer 0, `basis_kind='net'` ist wirkungslos, und die Basis ist
faktisch der Bruttopreis. Entweder `automatic_tax: { enabled: true }` in beiden Checkout-Pfaden
ergänzen — dann ändern sich die ausgewiesenen Beträge für alle Käufer, nicht nur für Affiliate — oder
in den Partnerbedingungen ehrlich „Bruttopreis" schreiben und `basis_kind` auf `gross` vorbelegen.
Beide Wege sind vertretbar, die Mischung ist es nicht.

### 12.3 Rechtliche Prüfung des Einwilligungsdialogs (vor dem Live-Gang von B3)

Ein selbstgebauter Dialog für genau eine Kategorie ist kein Ersatz für eine geprüfte
Consent-Lösung. Zusätzlich ungeklärt: die gemeinsame Verantwortlichkeit nach Art. 26 DSGVO zwischen
Händler und Partner braucht eine Vereinbarung. Ich kann eine Textvorlage liefern, keine
rechtsverbindliche Prüfung.

### 12.4 Steuerliche Prüfung vor dem ersten Beleg (vor B8)

Gutschriftverfahren nach § 14 Abs. 2 UStG, der Steuermodus je Partnerstatus, Reverse Charge,
Kleinunternehmerregelung und die Frage, ob DAC7 den Betreiber trifft. Ein falscher Ausweis führt zur
Steuerschuld nach § 14c UStG. Die Belegvorlage sollte ein Steuerberater gegenlesen. Konkret offen:
wie mit Partnern umgegangen wird, die Privatpersonen sind — der Plan blockiert die Auszahlung
(7.4), was fachlich richtig, aber geschäftlich unbequem ist.

### 12.5 `marketplace_ledger.net_cents` wird ungenau

Bei einem Marketplace-Kauf mit Affiliate-Zuordnung laufen zwei Provisionsrechnungen auf dasselbe
Brutto, beide mit `Math.floor`. `net_cents` ist dort als Verkäufer-Anteil definiert und ist danach
nicht mehr der Betrag, den der Verkäufer tatsächlich behält. Der Plan ändert die Ledger-Semantik
bewusst nicht und dokumentiert die Folge an der Einfügestelle (9.6). Wenn das stört, braucht der
Ledger eine zusätzliche Spalte `affiliate_cents` — eine additive Migration, keine Umarbeitung.

### 12.6 Betriebliche Voraussetzungen, die nicht im Code stehen

`charge.refunded`, `charge.dispute.created` und `charge.dispute.closed` müssen im Stripe-Dashboard am
Webhook-Endpunkt abonniert werden, sonst passiert nach dem Deploy still gar nichts. `STRIPE_WEBHOOK_SECRET`
muss gesetzt sein — laut Kommentar in `src/lib/stripe/client.ts` fehlt es noch; ohne es verarbeitet
der Endpunkt überhaupt kein Event. Die Cloudflare-Rate-Limiting-Regel auf `/api/aff/k` muss
eingerichtet sein (G18). `main` ist nicht der ausgelieferte Worker-Stand (PHASENSTATUS.md, offener
Punkt 2); der Affiliate-Hook baut auf dem K1-Webhook-Fix auf und läuft live erst nach dem nächsten
Deploy korrekt.

### 12.7 Migrationen sind lokal nicht probeweise fahrbar

Kein lokales Postgres, keine `supabase/config.toml`, kein Docker-Daemon (PHASENSTATUS.md:4363-4366).
`npx supabase db push` bricht beim ersten Statement ab. Fünf Migrationsdateien mit generierten
Spalten, Exclusion-Constraints, zusammengesetzten Fremdschlüsseln und vier Guard-Triggern gehen
ungeprüft live. Gegenmaßnahme: getrennte Dateien je Block statt einer großen, damit ein Fehlschlag
lokalisierbar bleibt und die erfolgreichen Teile stehen; jede Datei mit deutschem Kopfkommentar
(Anlass, Befund, Lösung, Vorbild, Anwendungsstatus); nach dem Anwenden umbenennen und beide
Advisor-Läufe. Anwenden bleibt Josip vorbehalten (CLAUDE.md §4.6).

### 12.8 Weitere Risiken, benannt und beherrscht

Die Klicktabelle wächst schneller als alles andere; fällt der Löschlauf oder der Cron dauerhaft aus,
wird die Statistik nach Monaten unbenutzbar langsam — deshalb gibt der Prozess-Endpunkt je Schritt
eine Zählung zurück, die im Cron-Log sichtbar ist. Der Rate-Limiter ist fail-open und taugt nicht
zur Betrugsabwehr; der Klickbetrugs-Schutz stützt sich auf Dedup-Constraint, Header-Prüfungen,
Tagesobergrenze und die nachgelagerte Auffälligkeitsprüfung. `btree_gist` liegt im `public`-Schema
und steht dauerhaft im Advisor; der Exclusion-Constraint auf `affiliate_conditions` nutzt sie, die
Extension wird nicht verschoben. Der offene Nebenbefund `courses_member_select` (permissiv
ver-ODER-t) betrifft dieses Modul nicht, weil keine Affiliate-Policy einschränkend neben eine
bestehende gestellt wird. Ausgehende Affiliate-Webhooks erben die Retry-Lücke von
`/api/admin/webhooks/retry`, das an keinem Cron hängt.

---

## 13. Was bewusst nicht gebaut wird

Jede Auslassung ist eine Ergänzung NEBEN der gebauten Maschine, keine spätere Umarbeitung. Das ist
die Prüffrage, und sie lässt sich an drei Stellen nachweisen: das Provisionsbuch kennt acht
`kind`-Werte und fünf Status, jede aufgeschobene Vergütungsform ist ein neuer `kind`-Wert oder eine
`manual`-Zeile; die Konditionsauflösung ist eine Sortierung über eine generierte Spalte, eine
Staffelung wäre eine zusätzliche Kandidatenquelle vor demselben `limit 1`; die Auszahlung kennt drei
`method`- und vier `tax_mode`-Werte, Connect ist ein vierter Methodenwert, FX sind zwei Spalten.

**Umsatz- und Verkaufsstaffelung.** Rückwirkende Staffelung erzeugt Nachbuchungen auf bereits
gebuchte, womöglich schon ausgezahlte Zeilen — das widerspricht dem unveränderlichen Provisionsbuch
frontal und bräuchte ein eigenes Nachbuchungskonzept mit eigener Belegwirkung. Marginale Staffelung
bräuchte zusätzlich eine Periodendefinition (Kalendermonat? rollierend? welche Zeitzone?), die
niemand vorgegeben hat. Ersatz bis dahin: `manual`-Buchungen mit Begründung plus zeitlich befristete
Aktionskonditionen, die es bereits gibt. Später: eine Tabelle `affiliate_condition_tiers`, gelesen
von derselben `resolveCondition()`.

**Mehr als zwei Vergütungsstufen.** Rechtlich heikel (Nähe zu Schneeballstrukturen) und praktisch
kaum nachgefragt. Die Begrenzung ist eine Codeeigenschaft — die Funktion liest nie den `referred_by`
des Werbers — und kein Konfigurationsschalter, der versehentlich umgelegt werden könnte.

**Provision auf Klicks (CPC) und auf Leads (CPL).** Beide öffnen eine eigene Betrugsfläche, die im
Kursmarkt keinen Gegenwert hat: bei CPC zahlt der Händler für Traffic, den ein Partner selbst
erzeugen kann, bei CPL für Registrierungen, die nichts kosten. Beides bräuchte eine eigene
Betrugserkennung, bevor es überhaupt sicher wäre. Leads werden trotzdem gezählt (ein Referral mit
gesetztem `user_id` ohne Bestellung), damit der Trichter zwischen Klick und Kauf nicht blind ist —
nur vergütet werden sie nicht.

**Stripe Connect für automatische Auszahlungen.** Braucht eine Entscheidung über den Kontotyp
(Express oder Custom), ein eigenes Onboarding je Partner, KYC-Verantwortung, und verschiebt die
Geldflussrichtung: bei Connect zahlt Stripe direkt an den Partner, wodurch die Gutschrift eine andere
Bedeutung bekommt. Das ist eine kaufmännische und haftungsrechtliche Entscheidung, keine technische,
und sie hängt an 12.1. Bis zwanzig Partner ist ein SEPA-Export schneller gebaut und leichter zu
prüfen. Der Auszahlungslauf ist so entworfen, dass ein Connect-Auslöser später genau eine Stelle
ersetzt: `markAffiliatePayoutPaid()`.

**Währungsumrechnung und Mehrwährungs-Auszahlung.** Die Währung wird erfasst und in jede Zeile
kopiert, Salden und Auszahlungen gruppieren nach `(partner, currency)`, ein Partner mit zwei
Währungen bekommt zwei Auszahlungen. Was fehlt, ist die Umrechnung in die Partnerwährung. Dafür
bräuchte es eine Kursquelle, einen fixierten Kurszeitpunkt und dessen Dokumentation auf dem Beleg —
drei Entscheidungen für einen Fall, den es bei einem deutschsprachigen Kursangebot heute nicht gibt.
Später: zwei Spalten auf `affiliate_payouts`.

**Echter Partner-Rabattcode mit Preiseingriff (B10).** Der Code funktioniert vollständig als
Tracking-Träger und deckt damit Podcast, Print und Influencer ab. Der Preiseingriff ist die einzige
Stelle im Modul, an der ein Fehler still den Preis ändert. Er ist außerdem der Grund, warum die
Gutschein-Regel R3 heute oben stehen darf: ein Code ohne Preisvorteil wird auf Gutscheinseiten nicht
verbreitet, die klassische Abschöpfung fällt also weg. Wer B10 baut, muss R3 verschieben.

**KYC und Doppelkonten-Erkennung.** Beides wird erst ab Programmgröße relevant und braucht
Kalibrierung an echten Daten. Eine Doppelkonten-Warnung über IBAN- oder Steuernummern-Gleichheit wäre
in einer Stunde gebaut, produziert ohne Erfahrungswerte aber vor allem Fehlalarme über legitime
Familienkonstellationen; mandantenübergreifend darf sie ohnehin nicht vergleichen. Innerhalb eines
Mandanten verhindert `unique (tenant_id, user_id)` das offensichtliche Doppelkonto bereits.

**Cookie-Stuffing-Heuristik über Klickmuster und automatische Sperre bei Schwellenwerten.**
Fehlalarme sind hier teuer: eine automatische Sperre wegen einer Stornoquote über x % trifft im
Zweifel den besten Partner in einem schlechten Monat. Gebaut ist die Vorstufe — Verdachtsflag,
`on_hold` als manueller Zwischenzustand, Bot- und Header-Filter, Klick-Dedup, Referrer-Blocklist,
Selbst-Empfehlungserkennung und der Auffälligkeitsbericht im Aggregationslauf. Die Entscheidung
bleibt beim Menschen.

**Aufteilung einer Erstattung nach Position (Versand, Steuer, Einzelposten).** Der Storno rechnet
proportional auf die gesamte Basis (5.8). Erstattet ein Händler ausschließlich Versandkosten, wird
dennoch anteilig storniert, obwohl auf Versand keine Provision entstand. Stripe liefert ohne
Line-Item-Refunds keine zuverlässige Zuordnung eines Erstattungsbetrags zu einer Position; eine
Rekonstruktion wäre geraten, nicht berechnet. Der Fall ist bei digitalen Kursen ohne Versand
praktisch nicht vorhanden, und die Regel ist konservativ zugunsten des Händlers.

**Mandantenübergreifender Marktplatz für Partnerprogramme.** Widerspricht dem White-Label-Versprechen:
ein Verzeichnis, das Mandanten nebeneinander listet, macht die Plattform sichtbar, die unsichtbar
bleiben soll. Gebaut ist die Programmseite je Mandant mit drei Sichtbarkeitsstufen, was die
eigentliche Funktion — Partnergewinnung — vollständig abdeckt. Was fehlt, sind Suche, Filter,
Ranking und Kennzahlen im Listing; die brauchen ohnehin erst belastbare Datenmengen.

**Mehrere Programme je Mandant.** In v1 genau eines (`unique (tenant_id)`). Die `program_id`-Spalte
ist überall vorhanden, der Constraint fällt später weg. Ein echter zweiter Programm-Slot bräuchte
allerdings eine Datenmigration an genau einer Stelle: `affiliate_customer_bindings` ist heute
`unique (tenant_id, program_id, user_id)` — das trägt schon; `affiliate_partners` ist
`unique (tenant_id, user_id)` und müsste auf `(tenant_id, program_id, user_id)` wechseln. Diese eine
Stelle ist hier bewusst benannt, damit später niemand behauptet, es sei migrationsfrei.

**Partner-Stufen mit automatischem Auf- und Abstieg, Sales-Contests, Bestenlisten.**
Motivationsmechanik. Ein automatischer Aufstieg braucht dieselbe Perioden- und Nachberechnungslogik
wie die Staffelung. Gruppen plus manuelle Sonderkonditionen leisten dasselbe, solange die
Partnerzahl zweistellig ist. Eine öffentliche Bestenliste hätte zusätzlich eine eigene
datenschutzrechtliche Prüfung nötig, weil sie Umsatzdaten identifizierbarer Personen veröffentlicht.

**Verfall von Kleinstbeträgen und ruhenden Konten.** Verfallklauseln in AGB sind angreifbar, und der
Fall ist frühestens nach Jahren relevant. Restbeträge unterhalb `min_payout_cents` werden schlicht
vorgetragen.

**DATEV-Export.** Der CSV-Export mit Belegnummer, Datum, Partner, Netto, Steuer und Gesamtbetrag
reicht jedem Steuerberater für den Anfang. Ein echtes DATEV-Format braucht Kontenrahmen und
Buchungsschlüssel, also eine fachliche Abstimmung, die zum ersten Wurf nichts beiträgt.

**Postback und Pixel an Partnersysteme, mehrere SubIDs, Kurzlinks mit eigener Domain, QR-Codes,
Landingpage-Rotation, Statistik je Werbemittel, geplante Report-Mails, In-App-Benachrichtigungen,
Partner-Import per CSV, Single Sign-on, Sub-Accounts für Agenturen, Länder- und Regionssperre,
Bestandskunden-Ausschluss, eigenes Attributionsfenster für Abos, regelbasierte automatische
Freigabe.** Jeder dieser Punkte ist ein Formularfeld, eine Spalte oder eine Seite, keiner ein Umbau.
Ein Kampagnenschlüssel deckt die Auswertung ab, für die Partner den Parameter überhaupt nutzen; die
vier ereignisbezogenen Mails (Verkauf, Storno, Auszahlung, Freigabe/Ablehnung) tragen den Betrieb;
generische ausgehende Webhooks decken den Automatisierungsbedarf über die bereits vorhandene
HMAC-Signatur- und Zustellinfrastruktur ab.

**Klick-Rohdaten über die REST-API v1.** `public.api_keys` hat kein Scope-Feld
(`0001_init.sql:349-358`) — jeder gültige Schlüssel kann alles, was v1 anbietet. Klickzeilen sind
personenbezogen (Zeitstempel, gehashte IP, Land). Erst Scopes, dann diese Endpunkte.

**Partitionierung der Klicktabelle.** Aufgeschoben zugunsten von Tagesaggregaten und der
90-Tage-Löschfrist. Eine spätere Partitionierung nach Monat ändert keine einzige Abfrage, weil die
Statistik ausschließlich aus `affiliate_daily_stats` kommt und die Rohtabelle nur der Prüfpfad ist.

### Was jeweils fehlt, fehlt sichtbar

Es gibt in diesem Entwurf kein Formularfeld ohne Wirkung, keinen Status ohne Übergang und keine
Spalte, die niemand schreibt. Die einzige Ausnahme ist `program.fee_deduction_bp`, das als Näherung
für die Zahlungsdienstgebühr ausdrücklich so gemeint und in der Oberfläche so beschriftet ist. Alle
`kind`-Werte des Provisionsbuchs werden geschrieben, alle fünf Status erreicht, alle vier
`tax_mode`-Werte kommen vor, und die beiden blockierenden Steuerfälle haben eine Oberfläche, die sie
erklärt.
