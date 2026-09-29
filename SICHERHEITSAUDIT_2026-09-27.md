# Sicherheitsaudit Calltalent-Akademie, Stand 27.09.2026

**Auftrag (Josip):** Das komplette Projekt auf Sicherheitsfehler prüfen, aus Sicht eines Entwicklers mit über 20 Jahren Erfahrung.

**Grundlage:** Branch `main` (2718664, 09.09.2026), die Live-Datenbank `vklqksdiyiijzoirntyt` (nur lesend: Security-Advisor, `pg_policies`, Grants, Funktionsrümpfe, Buckets) und der nicht gemergte Branch `claude/affiliate-system-kurse-wrohy0`, dessen Schema bereits live ist. Neun lesende Prüf-Agenten je Fachbereich; jeden Fund der Stufe HOCH habe ich selbst am Code oder an der Live-Datenbank nachvollzogen. Geändert wurde nichts außer diesem Bericht und `PHASENSTATUS.md`.

**Bezug zur Projektanalyse vom 08.09.2026:** IDs wie H2 oder M9 verweisen dorthin. „NEU" heißt: dort nicht enthalten.

---

## 1. Kernbefund

1. Das Fundament ist solide. RLS auf allen 68 Live-Tabellen, `getUser()` statt `getSession()` überall, Webhook-Signaturen vor jeder Verarbeitung, zeitkonstante Secret-Vergleiche, keine Secrets in Repo oder Git-Historie, 0 Meldungen bei `npm audit --omit=dev`. Die Fixes K1, K2, H3, H30, H35, H36 und die Header-Spoofing-, Callback- und Logout-Fixes greifen nachweislich.

2. Die schwerste Lücke ist neu und liegt in einem Fix vom 07.09.: Die RPC `submit_quiz_attempt` nimmt Punktzahl und „bestanden" vom Aufrufer entgegen. Jeder Lernende besteht jede Prüfung mit einem einzigen HTTP-Aufruf. Die alte Insert-Policy `attempts_own_insert` existiert live parallel weiter.

3. Zweite neue Lücke: Über Einladung oder CSV-Import stuft ein Admin den Owner auf `member` herab. Der Upsert läuft mit `service_role` und umgeht damit die Owner-Schutz-Policy vom 01.08.

4. Die Produktionsdatenbank enthält 8 Migrationen (15 Tabellen, Affiliate-System und `tracking_consents`), die in `main` fehlen. Ihr Schema ist sicherheitlich sauber gebaut, aber nicht versioniert, wo es hingehört.

5. Drei Geld-Lücken aus dem 08.09. sind unverändert offen: Freischaltung ohne bezahlte Zahlung (H5), keine Verarbeitung von Erstattungen und Chargebacks (H11), kein Wiederholungslauf für Webhooks (H6).

---

## 2. Befunde nach Schwere

Schwere-Maßstab wie in CLAUDE.md: KRITISCH = Mandantengrenze oder Geld direkt betroffen und leicht ausnutzbar; HOCH = Integrität einer Kernfunktion oder Rechte-Eskalation; MITTEL = eingeschränkte Wirkung oder Verstoß gegen §2; NIEDRIG = Härtung.

Einen KRITISCH-Fund gibt es in dieser Runde nicht.

### 2.1 HOCH

**S1. Lernende setzen Prüfungsergebnis und Abgaben-Bewertung selbst. NEU (RPC) und H2 (Policies).**

1. `supabase/migrations/20260909183521_quiz_attempt_allow_guests.sql`, Zeile 25 bis 66: `submit_quiz_attempt(p_quiz_id, p_answers, p_score_pct, p_passed)` ist `security definer`, für `authenticated` ausführbar und schreibt `p_score_pct` und `p_passed` ungeprüft. Angriff: `POST /rest/v1/rpc/submit_quiz_attempt` mit `{"p_quiz_id":"…","p_answers":{},"p_score_pct":100,"p_passed":true}`.
2. Live-Policy `attempts_own_insert` prüft nur `user_id = auth.uid() AND can_participate(tenant_id)`. Ein direktes `POST /rest/v1/attempts` mit `passed: true` umgeht zusätzlich das Versuchslimit.
3. Live-Policy `submissions_insert` hat keine Spaltenbeschränkung. Ein Lernender legt seine Abgabe gleich mit `status: 'approved'`, `grade`, `feedback` und `reviewed_by` an (Spalten live bestätigt).
4. Wirkung: gefälschte Prüfungs- und Abgabenergebnisse in Reporting, Admin-Ansicht und Export. Zertifikate hängen nicht an Quizzen (geprüft in `src/lib/certificates/issue.ts`, Zeile 107 ff.), daher HOCH statt KRITISCH.
5. Behebung: RPC nur noch für `service_role` freigeben und um `p_user_id` ergänzen; `src/lib/quiz/actions.ts`, Zeile 416, ruft sie nach der serverseitigen Bewertung über den Admin-Client auf. `attempts_own_insert` streichen. Für `submissions` ein `before insert`-Trigger, der `status`, `grade`, `feedback`, `reviewed_by`, `reviewed_at` für Nicht-Staff auf Standard setzt (Muster: `tenants_operator_settings_guard`).

**S2. Admin stuft Owner und andere Admins per Einladung herab. NEU.**

1. `src/lib/users/import.ts`, Zeile 309 bis 317: `memberships.upsert({ role: "member", status: "active" }, { ignoreDuplicates: false })` über den Admin-Client. Gilt für CSV-Import und `inviteSingleUser()`.
2. Angriff: Ein Admin lädt die E-Mail des Owners ein. Die bestehende Zeile wird mit `role = 'member'` überschrieben. Die Policy aus `20260801150000_memberships_owner_escalation_fix.sql` greift nicht, weil `service_role` RLS umgeht. Nebenwirkung: gesperrte Mitglieder werden wieder `active`.
3. Zusätzlich überschreibt derselbe Pfad in Zeile 283 bis 291 `profiles.full_name` eines Nutzers, der schon in einem fremden Mandanten existiert. Ein Admin von Mandant A benennt damit Personen mandantenübergreifend um.
4. Behebung: Bei bestehender Mitgliedschaft `role` und `status` nicht anfassen (`ignoreDuplicates: true` oder vorher lesen); `full_name` nur bei `status === "created"` schreiben.

**S3. Stripe schaltet frei, bevor Geld da ist, und nimmt Erstattungen nicht zurück. H5, H11, offen.**

1. `src/app/api/stripe/webhook/route.ts`, `handleCheckoutCompleted()`: keine Prüfung von `session.payment_status`. Bei SEPA oder Klarna feuert das Ereignis mit `unpaid`; Mitgliedschaft, Einschreibung und Zahlungsmail entstehen trotzdem.
2. `charge.refunded` und `charge.dispute.*` werden nicht verarbeitet. Nach Erstattung bleibt der Zugriff bestehen, der Marketplace-Ledger unverändert.
3. Behebung: nur bei `payment_status === 'paid'` erfüllen, `checkout.session.async_payment_succeeded/failed` ergänzen; Erstattung setzt `orders.status = 'refunded'` und `enrollments.expires_at = now()`. Kurzfristige Alternative: im Stripe-Dashboard nur Kartenzahlung aktivieren und das dokumentieren.

**S4. Live-Schema ohne Code in `main`. NEU (Prozess).**

1. `supabase_migrations.schema_migrations` enthält 20260910120000 bis 20260918120000 (affiliate_core, tracking_consents, affiliate_enabled_guard, affiliate_tracking, affiliate_commissions, affiliate_reversals, affiliate_payouts, affiliate_fk_indexes). Die Dateien liegen nur auf `claude/affiliate-system-kurse-wrohy0`.
2. Folgen: Jede Prüfung gegen `main` übersieht 15 Live-Tabellen und 5 `security definer`-Funktionen; eine Wiederherstellung aus `main` verliert sie; `supabase db push` aus `main` läuft gegen eine Historie mit unbekannten Versionen.
3. Das Schema selbst ist sauber (Abschnitt 4). Behebung: Branch mergen oder die 8 Migrationsdateien sofort nach `main` übernehmen; Regel in CLAUDE.md: keine Live-Migration ohne Merge.

### 2.2 MITTEL

| Nr. | Befund und Fundstelle | Status | Behebung |
|---|---|---|---|
| S5 | Kurs-Blöcke `image`, `audio`, `file`, `embed` akzeptieren jedes URL-Schema: `src/lib/courses/schema.ts`, Zeile 30 (`z.string().url()`), gerendert in `block-renderer.tsx`, Zeile 182 (`<a href>`) und 222 (`<iframe>` ohne `sandbox`). `javascript:` blockt React 19 beim Rendern; `data:text/html` im iframe und beliebige Fremdseiten bleiben für Phishing nutzbar. Die Agenten stuften das als Stored XSS HOCH ein; die React-Sperre senkt es auf MITTEL. | M23 erweitert | `.refine(v => v === "" \|\| /^https:\/\//i.test(v))`, für `embed` Allowlist (YouTube, Vimeo, Bunny, Loom) und `sandbox` |
| S6 | Öffentliche Buckets `course-assets` (50 MB, u. a. PDF, ZIP, Office), `branding`, `avatars` live `public = true`. Dateien unveröffentlichter oder kostenpflichtiger Kurse sind mit bekannter URL ohne Login abrufbar; die SELECT-Policy verhindert nur das Auflisten. | M8 offen | `course-assets` privat, signierte URLs nach Zugriffsprüfung |
| S7 | Storage-Policy `submissions_own_all` prüft nur den Nutzer-Ordner `[2]`, nicht den Mandanten `[1]` (`20260710214020_0002_storage.sql`, Zeile 72 bis 79). Jeder Angemeldete schreibt, überschreibt und löscht unter `{fremder_mandant}/{eigene_id}/`. | M9 offen | `and public.can_participate(((storage.foldername(name))[1])::uuid)` |
| S8 | `progress_own_insert/update` ohne Mandanten- und Lektionsbindung (live bestätigt). Fortschrittszeilen in fremden Mandanten verfälschen deren Reporting. `completeLesson()` prüft `lessonId` nicht gegen Mandant und Status. | H2/M20 offen | `with check` um `can_participate(tenant_id)` und Lektion im selben Mandanten |
| S9 | Zeiterfassung: Selbst-Insert prüft nur `started_at` ±5 Minuten, nicht `ended_at` (`20260807142619_shift_calendar.sql`, Zeile 708 bis 717). Ein Freelancer legt in einem Aufruf 500 abgeschlossene Stunden an. Der Guard-Trigger läuft nur bei UPDATE. HOCH, sobald Ist-Zeiten in die Abrechnung gehen. | H17 erweitert | im Selbst-Zweig `ended_at is null` erzwingen, Höchstdauer beim Ausstempeln |
| S10 | Open Redirect per Backslash: `src/lib/marketplace/redirect.ts`, Zeile 19 bis 22, lässt `/\evil.example` durch; genutzt in `auth/callback/page.tsx`, Zeile 108, und `marketplace/login/page.tsx`, Zeile 58. Nutzer landet direkt nach dem Login auf einer Fremdseite. | M1 offen | `\` und Steuerzeichen ablehnen, Testfall |
| S11 | Magic-Link und Passwort-Reset nur IP-limitiert (`src/lib/auth/actions.ts`, Zeile 252 und 352): E-Mail-Bombing gegen beliebige Adressen über wechselnde IPs, auf Kosten der Resend-Reputation. Registrierung, Reset, Magic-Link ohne Turnstile, obwohl die Komponente produktiv im Kontaktformular läuft (§2.7). | NEU / M2 offen | zweites Limit je `sha256(email)`, Turnstile auf Registrierung und Reset |
| S12 | Keine Content-Security-Policy und kein COOP (`next.config.ts`, Zeile 12 bis 33). Die übrigen Header sind korrekt gesetzt. | bekannt, offen | CSP im Report-Only-Modus starten, danach scharf |
| S13 | Session-Ablauf nicht konfiguriert (§2.8); Supabase-Advisor meldet zusätzlich „Leaked Password Protection" aus. | H9 offen | im Dashboard Time-box und Inactivity-Timeout setzen, HaveIBeenPwned-Prüfung einschalten |
| S14 | Service Worker cacht `/` (`public/sw.js`, Zeile 16); `/` leitet auf das personalisierte Dashboard weiter. Auf einem geteilten Gerät sieht Nutzer B offline das Dashboard von Nutzer A. | M67 offen | `/` aus `APP_SHELL` entfernen |
| S15 | E-Mail-Adresse und Betreff im Klartext in Fehler-Logs (`src/lib/email/client.ts`, Zeile 56 bis 110); `observability.enabled` speichert sie in Cloudflare. | NEU | Adresse hashen oder kürzen |
| S16 | `refreshLessonTranscript()` ohne Rate-Limit (`src/lib/video/actions.ts`, Zeile 36 bis 76), mit `force: true`: jeder Klick eines Trainers kostet Bunny-Transkription und einen Haiku-Aufruf. Dazu H18 (Neustart laufender Jobs nach 3 Minuten ohne Versuchszähler, `src/lib/generator/process.ts`, Zeile 30) und H19 (kein Kostendeckel für Transkription). | NEU / H18, H19 offen | `checkRateLimit` 5/h je Mandant, `attempts`-Zähler, Minutenkontingent |
| S17 | API-Keys gesperrter Mandanten funktionieren weiter: `resolveApiKeyTenant()` in `src/lib/api/auth.ts` prüft `tenants.status` nicht. | H21 Teilaspekt | Status in der Key-Auflösung prüfen |
| S18 | Mandanten-Export gibt `webhooks.secret` im Klartext und `api_keys.key_hash` aus (`src/app/portal/mandanten/[id]/export/route.ts`, Zeile 100 bis 115). | M16 offen | beide Spalten ausschließen |
| S19 | Einladung verknüpft ein bestehendes Konto aus fremdem Mandanten still, ohne Mail an die Person (`src/lib/users/import.ts`, Zeile 257 bis 275). DSGVO-relevant. | NEU | Bestätigungsmail bei `status === "linked"` |
| S20 | Stripe-Webhook prüft `event.livemode` nicht; `/api/admin/webhooks/retry` hängt an keinem Cron (`custom-worker.ts`, Zeile 70). | M26, H6 offen | Abgleich mit Umgebung; zweiter `SELF.fetch` im `scheduled`-Handler |
| S21 | E2E-Suite gegen die Datenbank aus `.env` mit Standardpasswort `E2E_TEST_PASSWORD` im Code (`e2e/global-setup.ts`, Zeile 28); `vitest.config.ts`, Zeile 28, lädt die gesamte `.env` samt Service-Role-Key. | H25, M64 offen | eigenes Test-Projekt, Passwort verpflichtend, nur benötigte Variablen laden |

### 2.3 NIEDRIG

1. **17 `security definer`-Funktionen für `anon` ausführbar** (Supabase-Advisor, u. a. `calendar_open_slots`, `calendar_planner_worker_names`, `can_participate`, `has_enrollment`). Ich habe die Rümpfe live gelesen: Alle binden an `auth.uid()` und liefern für `anon` nichts. Trotzdem `revoke execute … from anon` nachziehen.
2. **Webhook-Zustellung folgt Redirects** (`src/lib/webhooks/deliver-attempt.ts`, Zeile 58, kein `redirect: "manual"`), damit ist `assertSafeWebhookUrl()` per 3xx umgehbar. Auf Cloudflare Workers gibt es kein erreichbares internes Netz, daher NIEDRIG statt der vom Agenten gemeldeten HOCH. Fix: `redirect: "manual"`.
3. **Push-Endpoint ohne Allowlist** (`src/lib/push/actions.ts`, Zeile 22): Nutzer tragen beliebige URLs ein, der Server sendet dorthin signierte POSTs. Blind und nur ins öffentliche Netz, daher NIEDRIG. Fix: Hostnamen der Push-Dienste erlauben.
4. `url-safety.ts`, Zeile 76: `localhost.` mit Schlusspunkt umgeht die Hostnamen-Sperre (DNS-Zweig scheitert derzeit fail-closed).
5. Turnstile-Prüfung wertet `hostname` und `action` nicht aus (`src/lib/security/turnstile.ts`, Zeile 89 bis 95).
6. `changeEmail()` reicht `error.message` roh durch (`src/lib/account/actions.ts`, Zeile 98): Konto-Enumeration, M6.
7. Mandantenname ohne Zeilenumbruch-Sperre als Absendername (`src/lib/email/client.ts`, Zeile 72).
8. `profiles_own_update` ohne Spaltenliste: Nutzer ändern `profiles.email` abweichend von `auth.users.email`; wird nur für Mail-Anreden gelesen.
9. GitHub Actions per Tag statt Commit-SHA gepinnt (`ci.yml`, `deploy.yml`).
10. Fremdschlüssel ohne Mandantenbindung bei `modules`, `lessons`, `quizzes`, `sections`, `customer_area_item_audience` (M10): nur Datenmüll im eigenen Mandanten, kein Lesezugriff.

---

## 3. Verworfene oder herabgestufte Agenten-Funde

1. „`ai_jobs`-Direktinsert umgeht das KI-Kontingent": verworfen. `src/lib/generator/process.ts`, Zeile 80 und 104, ruft `enforceQuota()` auch im Cron-Pfad auf.
2. „Stored XSS über `javascript:`-URLs, HOCH": auf MITTEL gesenkt (S5), weil React 19.2 `javascript:`-URLs in `href` und `src` blockiert.
3. „SSRF über Webhook-Redirect und Push-Endpoint, HOCH": auf NIEDRIG gesenkt, weil der Worker auf Cloudflare kein internes Netz erreicht.
4. „Gefälschtes Quiz führt zum Zertifikat": falsch. Zertifikate entstehen aus `progress`, nicht aus `attempts`. S1 bleibt trotzdem HOCH.

---

## 4. Geprüft und sauber

1. Mandanten-Auflösung: `x-tenant-*` wird in `src/middleware.ts`, Zeile 64, vor jeder Verzweigung entfernt; Host-Filter validiert (H36).
2. Autorisierung: `requireStaffTenant()`/`requireAdminTenant()` prüfen die Rolle im aktuellen Mandanten; Betreiber-Actions prüfen `platform_admins` in jeder Action einzeln.
3. K2-Fix: Spaltenrechte plus Guard-Trigger mit `current_user`-Erlaubnisliste, nicht per JWT fälschbar.
4. `questions.answer` ist nur für Staff lesbar; `src/lib/quiz/load.ts` selektiert die Spalte nie.
5. RAG und Suche: `match_embeddings` nur `service_role`, Filter auf Mandant, Kurs und Veröffentlichungsstatus; kein Tool-Calling mit Schreibwirkung; Schichtplan-KI sieht nur Pseudonyme.
6. Webhooks eingehend: Stripe `constructEvent` und Bunny HMAC mit `timingSafeEqual` vor jeder Verarbeitung; Cron-Secret fail-closed.
7. API v1: jede Client-ID gegen `tenant_id` geprüft, einheitliche 404, Pagination und Rate-Limit.
8. Uploads: MIME- und Größen-Whitelist doppelt (zod und `storage.buckets`), kein SVG oder HTML in öffentlichen Buckets, Pfade mit `{tenant_id}/`.
9. CSV-Exporte neutralisieren `=`, `+`, `-`, `@`; E-Mail-Vorlagen escapen durchgängig; Branding-Farben per Regex.
10. Secrets: keine Treffer in Repo und voller Git-Historie; keine `"use client"`-Datei importiert Server-Secrets; `admin.ts` mit `server-only`; `workers_dev: false`.
11. Affiliate-Schema (live): RLS auf allen 15 Tabellen, IBAN nur durch den Partner selbst änderbar, Geld-RPCs nur `service_role`, Selbstfreigabe und Selbstreferral gesperrt. Nicht vertieft geprüft: `payout.ts`, `reversal.ts`, `intake.ts`, `process.ts` des Branches; das gehört vor den Merge.

---

## 5. Reihenfolge der Behebung

1. **Heute, je unter einer Stunde:** S1 (RPC und zwei Policies, eine Migration), S2 (ein Upsert), S10 (eine Zeile plus Test), S13 (zwei Schalter im Supabase-Dashboard).
2. **Diese Woche:** S4 (Affiliate-Migrationen nach `main`), S3 (Stripe `payment_status` oder Dashboard auf Karte beschränken), S7, S8, S9 als eine gemeinsame RLS-Migration, S5, S16.
3. **In 30 Tagen:** S6 (private Buckets mit signierten URLs), S11, S12 (CSP), S14, S15, S17 bis S21, die NIEDRIG-Liste.

Alle Datenbankänderungen brauchen Josips Freigabe zum Anwenden (CLAUDE.md §4.6). Stand 28.09.2026: S1, S2 und S10 sind umgesetzt und live (Migration `20260927215834`, Deploy vom 28.09., siehe `PHASENSTATUS.md`). S13 liegt bei Josip im Supabase-Dashboard.

Stand 29.09.2026: Position 2 (S3, S4, S5, S7, S8, S9, S16) ist auf dem Branch umgesetzt und getestet, Live-Schaltung ausstehend (siehe `PHASENSTATUS.md`).
