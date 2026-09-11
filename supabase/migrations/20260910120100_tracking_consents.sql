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
-- nachtraeglich umschreiben. Die Erlaubnisliste laesst nur Migrationen und
-- Dashboard-Eingriffe durch ('postgres'/'supabase_admin'), damit die Loeschung
-- bzw. Anonymisierung nach Art. 17 DSGVO als bewusster, protokollierter
-- Eingriff moeglich bleibt; 'service_role', also der normale Serverbetrieb,
-- steht hier bewusst NICHT.
--
-- Nebenwirkung, bewusst in Kauf genommen: der `on delete cascade` von
-- `tenants` greift nur, wenn die Mandantenloeschung unter
-- 'postgres'/'supabase_admin' laeuft. Genau dieselbe Eigenschaft hat
-- affiliate_audit_log (20260910120000_affiliate_core.sql:829-846); eine
-- Mandantenloeschung ist in diesem Projekt ohnehin kein Vorgang des laufenden
-- Betriebs.
create or replace function public.tracking_consents_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'tracking_consents_immutable';
end;
$$;

create trigger tracking_consents_guard_trg before update or delete on public.tracking_consents
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
