# Projektanalyse Calltalent-Akademie, Stand 08.09.2026

**Frage des Auftraggebers:** Was funktioniert nicht, was fehlt im Projekt, und was wäre für den Erfolg zu verbessern?

**Grundlage:** Repo `calltalent/akademie`, Branch `main` (b2f2712, 24.08.2026), die drei ungemergten Branches, die Live-Datenbank (Supabase `vklqksdiyiijzoirntyt`) und der deployte Cloudflare Worker. Geprüft haben lesende Agenten je Fachbereich mit anschließender Gegenprüfung durch einen zweiten Agenten; die schwersten Befunde habe ich zusätzlich selbst am Code nachvollzogen. Abschnitt 7 nennt, was in dieser Umgebung nicht geprüft werden konnte.

---

## 1. Kernbefund

1. Die Plattform ist technisch breit und in weiten Teilen sauber gebaut: 70.705 Zeilen TypeScript, 58 Migrationen mit RLS auf jeder Tabelle, 694 grüne Unit-Tests, 0 Typ- und 0 Lint-Fehler. Produktiv ist sie nach zwei Monaten Bauzeit unbenutzt: 0 Kurse, 0 Lektionen, 0 Einschreibungen, 0 Tutor-Nachrichten bei 3 Mandanten. Von 110 Auth-Konten ist genau eines in den letzten 30 Tagen eingeloggt gewesen.

2. `main` ist nicht der Stand, der läuft. Der Worker wurde am 08.09. um 08:19 UTC deployt, vermutlich aus dem Branch `claude/ruflo-swarm-hierarchical-0trzqy` (07./08.09., 51 Dateien, Sicherheits- und Bugfixes, Next 16.3.4, drei Migrationen). Diese Migrationen sind live angewendet, fehlen aber im Repo auf `main`. Zwei weitere Branches (Kontaktformular-Bot-Schutz vom 25./26.08., DACH-Rechtsebene vom 26.08.) sind ebenfalls nicht gemergt.

3. Zwei Lücken treffen das Geschäftsmodell direkt. Erstens: Ein Käufer ohne bestehende Mitgliedschaft zahlt über Stripe und sieht danach keinen Kurs, weil der Webhook eine Einschreibung, aber keine Mitgliedschaft anlegt. Zweitens: Die RLS-Policy `tenants_admin_update` erlaubt jedem Mandanten-Admin, per PostgREST seinen eigenen `plan`, `status` und alle Betreiber-Schalter inklusive der Marketplace-Provision zu setzen.

4. Es gibt keine CI, kein Monitoring, kein Backup-Konzept und keinen Deploy-Weg außer dem Rechner des Auftraggebers. Für einen Einzelbetreiber ist das der größte Betriebsrisikofaktor.

5. Die Kette „Mandant anlegen, ersten Kurs bauen, Lernende einladen, Kurs zuweisen oder verkaufen, Zugriff, Zertifikat" ist an mindestens vier Stellen unterbrochen: Käufer ohne Zugriff, Einschreibung ohne Wirkung, kein Self-Service für Rollen und Zuweisung, `main` ungleich Produktion. Das erklärt die leere Datenbank besser als jeder Einzelfehler.

6. Empfehlung in einem Satz: zwei Wochen Konsolidierung (mergen, deployen, die Kernlücken schließen, CI aufsetzen), danach den ersten echten Kurs mit echten Lernenden auf `academy.calltalent.ai` betreiben, bevor weitere Funktionsbereiche entstehen. Vorher ist eine Entscheidung fällig, ob der erste Kunde eine interne Akademie oder ein Kursverkäufer ist (Abschnitt 6).

---

## 2. Ist-Zustand in Zahlen

| Kennzahl | Wert |
|---|---|
| Quellcode `src/` (TypeScript/TSX) | 70.705 Zeilen in 435 Dateien |
| Seiten (`page.tsx`) / Route-Handler (`route.ts`) | 63 / 22 |
| Server-Action-Dateien / Client-Komponenten | 48 / 130 |
| Unit-Tests (Vitest) | 43 Dateien, 694 Tests, alle grün |
| E2E-Tests (Playwright) | 21 Specs, brauchen Live-Schlüssel und Live-Datenbank |
| Migrationen im Repo / live in Supabase | 58 / 59 |
| Übersetzungsschlüssel je Sprache (de, en, bs) | 1.690, vollständig paritätisch |
| `PHASENSTATUS.md` | 843 KB, rund 3.900 Zeilen |
| Commits auf `main` | 52, alle zwischen 01.08. und 24.08.2026; die Juli-Historie liegt nicht im Repo |
| Ungemergte Branches | 3 |
| Cloudflare Worker `calltalent-akademie` | zuletzt deployt 08.09.2026, 08:19 UTC |
| `npm audit` auf `main` | 17 Schwachstellen (1 kritisch, 14 hoch, 2 mittel); auf dem Ruflo-Branch noch 5 |
| CI-Pipeline (`.github/`) | keine |
| Error-Tracking / Monitoring im Code | keines |

### 2.1 Live-Datenbank

| Tabelle | Zeilen |
|---|---|
| tenants | 3 (calltalent enterprise, salestalent enterprise, demo-blau komplett) |
| memberships | 5 |
| courses / lessons / enrollments / progress | 0 / 0 / 0 / 0 |
| attempts / submissions / certificates | 0 / 0 / 0 |
| products / orders / subscriptions | 1 / 2 / 0 |
| ai_jobs (alle `done`) | 39, letzter Lauf 05.08.2026, Gesamtkosten 0,11 USD |
| tutor_messages / embeddings | 0 / 0 |
| webhooks / api_keys / audit_log | 0 / 0 / 0 |
| marketplace_listings / marketplace_ledger | 0 / 0 |
| calendar_workers / calendar_shifts / calendar_time_entries | 1 / 9 / 2 |
| auth.users | 110 |

Von den 110 Auth-Konten haben 106 keine Mitgliedschaft. 100 davon heißen `test1@example.com` bis `test100@example.com`, angelegt am 10.07.2026, offenbar der manuelle Lasttest für das Phase-1-Kriterium „CSV-Import 100 Nutzer < 30 s". Sie wurden nie gelöscht und zählen bei Supabase als Nutzer.

### 2.2 Ungemergte Branches

| Branch | Stand | Inhalt |
|---|---|---|
| `claude/ruflo-swarm-hierarchical-0trzqy` | 07./08.09., 11 Commits, +4.466/-672 Zeilen | Projektrevision mit Sicherheitsaudit; Fixes für Header-Spoofing, Open Redirect, Logout-CSRF, Einladungs-Rate-Limit, vier stille RLS-Schreibfehler, Reporting-Paginierung, Zertifikatsdatum, Positions-Duplikate, Versuchslimit-Race, Kalender-Zeitzonen; Next von 16.2.10 auf 16.3.4; Migrationen `reorder_swap_positions`, `quiz_attempt_limit_rpc`, `revoke_new_rpcs_from_anon` (live angewendet) |
| `claude/contact-request-security-check-78qawq` | 25./26.08., 3 Commits | Honeypot, Form-Token, Spam-Muster und Cloudflare Turnstile für das Kontaktformular; Datenschutz-Abschnitt |
| `claude/install-marketing-skills-nsdemx` | 26.08., 4 Commits | 483 Dateien Marketing-Skills unter `.claude/tools`, SPEC §13 Rechtspflichten DACH |

Solange der erste Branch nicht in `main` ist, gilt: Wer von `main` deployt, überschreibt die heute live geschalteten Fixes wieder, und jede neue Arbeit auf `main` baut auf einem Stand auf, der die Fixes nicht kennt.

---

## 3. Was nicht funktioniert

Schwere nach CLAUDE.md-Maßstab: kritisch = Geld oder Mandantengrenze betroffen; hoch = Kernfunktion kaputt oder Verstoß gegen §2; mittel = Funktion eingeschränkt oder Verstoß gegen §3. „Status" sagt, ob der Punkt neu ist, im Ruflo-Bericht vom 07.09. schon stand („bekannt") oder auf einem Branch bereits behoben ist.

### 3.1 Kritisch

**K1. Stripe-Kauf ohne Mitgliedschaft: bezahlt, aber kein Zugriff.** `src/app/api/stripe/webhook/route.ts`, Zeilen 175 bis 236. `enrollFromProduct()` schreibt nach dem Checkout ausschließlich eine `enrollments`-Zeile. Eine `memberships`-Zeile legen im gesamten Code nur drei Stellen an: der CSV-Import, das Betreiber-Portal beim Anlegen des Owners und der Marketplace-Kauf (Rolle `guest`). Die Selbstregistrierung in `src/lib/auth/actions.ts` legt ebenfalls keine Mitgliedschaft an; es gibt auch keinen Datenbank-Trigger dafür. Die Policy `courses_member_select` (0001_init.sql, Zeile 465) verlangt aber `member_role(tenant_id) is not null`. Folge: Wer sich auf einer Mandanten-Domain registriert (Schalter „Selbstregistrierung erlauben" ist standardmäßig an), landet in einem leeren Dashboard, kann auf `/kaufen/...` bezahlen und sieht danach weiterhin nichts. Der Admin sieht diese Person in der Nutzerliste nie, weil die Liste über `memberships` läuft. Status: neu.

Behebung: In `handleCheckoutCompleted()` vor der Einschreibung eine Mitgliedschaft anlegen, Muster aus `src/lib/marketplace/fulfil.ts` Zeile 64 bis 78 (`memberships.upsert`, Rolle `member`, `status: 'active'`, `source: 'purchase'`; den CHECK-Constraint auf `memberships.source` aus Migration 20260803100300 um `purchase` erweitern). In `registerAction()` beim Registrieren auf einer Mandanten-Domain ebenso eine `member`-Mitgliedschaft anlegen, sofern `self_signup_enabled` gesetzt ist. Dazu ein E2E-Fall „Registrieren, kaufen, Kurs sichtbar".

**K2. `tenants_admin_update` ohne Spaltenbeschränkung.** `supabase/migrations/0001_init.sql`, Zeile 442: `create policy tenants_admin_update on public.tenants for update using (public.member_role(id) in ('owner','admin'))`. Kein `with check`, keine Spaltenliste, in keiner späteren Migration geändert. Supabase vergibt `UPDATE` auf `public`-Tabellen standardmäßig an `authenticated`. Die Betreiber-Schalter liegen in derselben JSON-Spalte `settings`, die der Mandanten-Admin selbst pflegt (`src/lib/tenant/actions.ts`, Zeile 117, über den RLS-Client): `payments_enabled`, `tutor_enabled`, `course_generator_enabled`, `marketplace_enabled`, `shift_calendar_enabled`, `marketplace_commission_bp` (gesetzt in `src/lib/platform/actions.ts`, Zeile 545 bis 562). Ein Admin eines Trial-Mandanten kann mit seiner eigenen Session per PostgREST-PATCH `plan = 'enterprise'` setzen (100-fache KI-Kontingente laut `src/lib/ai/config.ts`), `marketplace_commission_bp = 0` (Provision des Betreibers auf null), `status = 'active'` nach einer Sperrung, oder `custom_domain` auf den Hostnamen eines fremden Mandanten, womit dessen Auflösung in `resolveTenantByHost()` (`.or(...)` plus `maybeSingle()`) fehlschlägt. `slug` und `custom_domain` sind `unique`, das verhindert Duplikate, aber nicht das Setzen eines fremden Subdomain-Hostnamens als `custom_domain`. Status: neu.

Behebung: Migration mit `revoke update on public.tenants from authenticated; grant update (name, branding, legal, settings) on public.tenants to authenticated;` plus ein `before update`-Trigger, der für Nicht-`service_role` die sechs Betreiber-Schlüssel in `settings` auf den alten Wert zurücksetzt (Vorbild `calendar_workers_guard()` aus Migration 20260807173156). Alternativ eigene Spalte `operator_settings`, nur über `service_role` beschreibbar. Ein Negativtest mit `set role authenticated` gehört dazu.

### 3.2 Hoch

**H1. Einschreibungen steuern für Mitglieder keinen Zugriff.** `courses_member_select`, `lessons_member_select`, `modules_select`, `quizzes_select` prüfen nur `status = 'published'` und eine aktive Mitgliedschaft (0001_init.sql, Zeile 465 bis 482; 20260712234600, Zeile 38 bis 65). Die Marketplace-Migration 20260803100000 sagt es selbst in Zeile 6 bis 10: „es gibt KEINE Einschreibungspruefung". `src/app/(portal)/kurskatalog/page.tsx` lädt alle veröffentlichten Kurse des Mandanten; `enrollments` dienen nur dem Knopftext „Weiterlernen". Der Stripe-Webhook (Zeile 391 bis 393) entfernt bei Kündigung bewusst nichts. Folge: Ein Mandant kann keinen kostenpflichtigen Kurs neben kostenlosen anbieten; ein gekündigtes Abo läuft inhaltlich unbegrenzt weiter. Das war eine dokumentierte Vereinfachung aus Phase 2 und ist heute die größte fachliche Lücke gegenüber dem Kernversprechen aus SPEC §1. Status: neu (als Vereinfachung dokumentiert, als Lücke nicht).

Behebung: Kurs-Schalter `courses.settings.access = 'all_members' | 'enrolled'` (Standard `all_members`, damit sich für bestehende Mandanten nichts ändert), die Member-Policies um `has_enrollment(course_id)` für `enrolled`-Kurse ergänzen, `handleSubscriptionChanged()` setzt bei `canceled` `enrollments.expires_at`, `has_enrollment()` prüft `expires_at` für alle Rollen. Aufwand: mehrere Tage, weil die heißesten Tabellen betroffen sind.

**H2. Lernende können Prüfungsergebnis, Bewertung und Kursabschluss selbst schreiben.** `attempts_own_insert` (0001_init.sql, Zeile 511, angepasst in 20260803100000, Zeile 273) erlaubt jede Zeile mit `user_id = auth.uid()`, ohne Spaltenbeschränkung: `passed = true`, `score_pct = 100` per direktem PostgREST-Aufruf. `submissions_own_insert` ebenso. `progress_own_insert` ohne Mandanten- und Lektionsbindung stand schon im Ruflo-Bericht (Punkt 10). Da `src/lib/certificates/issue.ts` das Zertifikat aus `progress` ableitet, ist eine Selbst-Zertifizierung über die API möglich. Die Anwendung selbst schreibt korrekt über den Admin-Client nach serverseitiger Bewertung; die Lücke liegt im direkten Datenbankzugriff, den der `anon`-Key jedem angemeldeten Nutzer gibt. Status: teils bekannt.

Behebung: `attempts`-Insert für Lernende ganz entziehen (die neue RPC `submit_quiz_attempt` aus dem Ruflo-Branch übernimmt das Schreiben), `submissions_own_insert` per `with check` auf `status = 'submitted'` und leere Bewertungsspalten beschränken, `progress_own_insert` an `tenant_id` und eine gültige Lektion binden.

**H3. `submit_quiz_attempt` sperrt Marketplace-Gäste aus.** Branch `claude/ruflo-swarm-hierarchical-0trzqy`, `supabase/migrations/20260907091500_quiz_attempt_limit_rpc.sql`, Zeile 65: `if public.member_role(v_tenant_id) is null then raise exception 'not_a_member'`. `member_role()` liefert für die Rolle `guest` absichtlich `null` (20260803100000, Zeile 51 bis 60); genau deshalb wurde `attempts_own_insert` damals auf `can_participate()` umgestellt. Die Migration ist live angewendet, und `submitAttempt()` ruft die RPC bereits auf. Sobald der heute deployte Stand einen Marketplace-Käufer bedient, scheitert jeder Prüfungsabschluss mit „Speichern fehlgeschlagen". Live gibt es noch 0 Listings, der Schaden ist also noch theoretisch. Status: neu (Regression eines Fixes vom 07.09.).

Behebung: eine Zeile, `member_role` durch `can_participate` ersetzen, als neue Migration.

**H4. Lektionsreihenfolge bei mehreren Sektionen je Modul falsch.** `src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx`, Zeile 84 bis 90: Alle Lektionen des Kurses werden mit `.order("position")` geladen. `createLesson()` in `src/lib/courses/actions.ts`, Zeile 821 bis 831, vergibt `position` aber als Zähler je Sektion. Bei zwei Sektionen in einem Modul haben die jeweils ersten Lektionen dieselbe Position 0; „Nächste Lektion", das Weiter-Banner und die Modul-Abschlusserkennung sortieren dann quer durch die Sektionen. Der Prüf-Agent hat es per Vitest reproduziert. Status: neu.

Behebung: Sortierung `module.position, section.position, lesson.position` statt nur `lesson.position`, in der Lernansicht und überall, wo `nextLesson` berechnet wird. Ein Test mit zwei Sektionen gehört dazu.

**H5. Stripe erfüllt `checkout.session.completed` ohne `payment_status`-Prüfung.** `src/app/api/stripe/webhook/route.ts`, Zeile 64 bis 66. Bei asynchronen Zahlarten (SEPA-Lastschrift, Klarna, Überweisung) feuert dieses Ereignis mit `payment_status = 'unpaid'`; die Zahlung kommt Tage später oder gar nicht. Der Code schreibt trotzdem `orders`, `enrollments` und schickt die Mail „Zahlung erhalten". `createCheckoutSession()` in `src/lib/stripe/checkout.ts` setzt keine `payment_method_types`, also entscheidet das Stripe-Dashboard, welche Zahlarten aktiv sind. Status: neu.

Behebung: nur bei `payment_status === 'paid'` erfüllen, zusätzlich `checkout.session.async_payment_succeeded` und `async_payment_failed` behandeln; oder im Dashboard ausschließlich Karte aktivieren und das dokumentieren.

**H6. Webhook-Wiederholungen finden nie statt.** SPEC §7 verspricht drei Wiederholungen. Der Endpunkt `src/app/api/admin/webhooks/retry/route.ts` existiert, aber der einzige Cron-Aufruf in `custom-worker.ts` (Zeile 70) trifft `/api/admin/ki/process`. Der Kommentar in `src/lib/webhooks/dispatch.ts`, Zeile 39, stammt aus der Zeit vor dem Cloudflare-Cron („kein Cloudflare-Cron im Stack") und wurde nie nachgezogen. Ein Mandanten-Webhook, der beim ersten Versuch scheitert, bleibt für immer `failed`. Status: neu.

Behebung: zweiter `SELF.fetch` im `scheduled`-Handler auf `/api/admin/webhooks/retry`, gleiches Secret.

**H7. Ausgehende Webhooks und Push laufen als fire-and-forget ohne `waitUntil`.** `src/lib/progress/actions.ts`, Zeile 46, und weitere Stellen rufen `dispatchWebhookEvent(...).catch(() => {})` ohne `after()` aus `next/server`. Auf Cloudflare Workers endet die Ausführung mit der Antwort; der Aufruf kann abgebrochen werden, ohne dass eine Zustellung protokolliert wird. Status: neu.

Behebung: alle Nebenläufe in `after(() => ...)` kapseln (Next 15/16), damit OpenNext sie an `ctx.waitUntil` übergibt.

**H8. Trainer-Rechte weit über SPEC §2.** Migration 20260712234600, Zeile 51 ff.: `is_staff()` (owner, admin, trainer) darf Produkte und Preise anlegen, Bestellungen lesen, Einschreibungen verwalten, Kurse löschen, Marketplace-Listings einreichen. SPEC §2 sieht für `trainer` nur „Kurse erstellen/bearbeiten, Abgaben bewerten, Reporting lesen" vor. Status: neu.

Behebung: `is_staff()` in Policies für `products`, `orders`, `marketplace_listings`, `enrollments` durch `member_role(tenant_id) in ('owner','admin')` ersetzen; Kurslöschung an Admin binden.

**H9. Session-Ablauf und Cookie-Regel.** CLAUDE.md §2.8 verlangt einen konfigurierten und dokumentierten Session-Ablauf; es gibt keinen (bekannt, Ruflo Punkt 7.4). §2.13 verlangt `httpOnly`-Cookies; `@supabase/ssr` schreibt Session-Cookies aber grundsätzlich ohne `httpOnly` und mit 400 Tagen Laufzeit, weil der Browser-Client sie lesen muss. Die Regel beschreibt etwas, das der gewählte Stack nicht leistet. Status: teils bekannt.

Behebung: im Supabase-Dashboard „Time-box user sessions" und „Inactivity timeout" setzen (Pro-Plan nötig) und dokumentieren; §2.13 auf das tatsächliche `@supabase/ssr`-Verhalten umformulieren; mittelfristig E-Mail-Links auf `token_hash` mit serverseitigem `verifyOtp` umstellen, das löst zugleich Redirect-Allowlist, Portal-Magic-Link und Token im URL-Fragment.

**H10. KI-Kostensätze protokollieren seit 01.09.2026 zu niedrig.** `src/lib/ai/config.ts`, Zeile 26: `sonnet: { input: 2, output: 10 }` mit dem eigenen Kommentar „Einführungspreis bis 31.08.2026, danach 3/15, vor Produktivbetrieb prüfen". Das Datum ist vorbei, der Satz steht. Jeder Sonnet-Aufruf wird seither um ein Drittel zu billig in `ai_jobs.cost_usd` verbucht. Zugleich ist `claude-sonnet-4-5-20250929` ein Modell vom September 2025; das aktuelle `claude-sonnet-5` kostet 2/10 USD je Million Tokens und ist damit günstiger als der Nachfolgepreis von Sonnet 4.5. Die Aufrufe übergeben nur `max_tokens`, kein `temperature` und keinen Assistant-Prefill, der Wechsel ist also ohne Umbau möglich. Status: neu.

Behebung: `AI_MODELS.sonnet = "claude-sonnet-5"`, `haiku = "claude-haiku-4-5"` (Alias statt Datumsvariante), Kostensätze auf den Live-Preis stellen, einen Generator-Lauf am echten PDF prüfen.

**H11. Rückerstattungen und Disputes werden nicht verarbeitet.** `src/app/api/stripe/webhook/route.ts` behandelt `checkout.session.completed`, `invoice.paid` und zwei Abo-Ereignisse; `charge.refunded`, `charge.dispute.created` und `charge.dispute.closed` kommen nicht vor (selbst geprüft, kein Treffer für `refund` oder `dispute` in der Datei). Eine Erstattung in Stripe lässt `orders.status = 'paid'`, die Einschreibung und den Provisionseintrag im Marketplace-Ledger unverändert; der Mandant bekäme eine Provision auf einen erstatteten Kauf ausgezahlt. Status: neu.

Behebung: beide Ereignisse verarbeiten, `orders.status = 'refunded'`, `enrollments.expires_at = now()`, Ledger-Storno mit negativem Betrag.

**H12. Stripe-Kundenportal ist nirgends erreichbar.** `src/lib/stripe/portal.ts` existiert, wird aber von keiner Seite und keiner Action aufgerufen (selbst geprüft: einzige Treffer sind Kommentare). Abo-Kunden haben keinen Weg, zu kündigen oder ihre Zahlungsmethode zu ändern. Für Verbraucherverträge verlangt § 312k BGB seit 01.07.2022 einen Kündigungsbutton. Status: neu.

Behebung: Knopf „Abo verwalten" in `/profil` und in `/einstellungen`, der `createPortalSession()` aufruft; Portal-Konfiguration in Stripe mit Kündigungsoption.

**H13. Marketplace: Preisänderung wird nicht nach Stripe synchronisiert.** `src/lib/marketplace/actions.ts`, Zeile 275: Nach der ersten Stripe-Produktanlage bleibt die Preis-ID stehen, ein geänderter Listing-Preis wird nur angezeigt, abgebucht wird der alte. Nicht gegengeprüft. Status: neu.

Behebung: bei Preisänderung neuen Stripe-Preis anlegen, alten deaktivieren, ID in `marketplace_listings` aktualisieren.

**H14. Widerrufsverzicht wird nicht eingeholt.** Beim Checkout digitaler Inhalte muss der Verbraucher nach § 356 Abs. 5 BGB ausdrücklich zustimmen, dass die Ausführung vor Ablauf der Widerrufsfrist beginnt, und den Verlust des Widerrufsrechts bestätigen. `src/lib/stripe/checkout.ts`, Zeile 122 ff., enthält weder ein `consent_collection` noch einen eigenen Schritt; die Marketplace-AGB behaupten, der Kauf sei noch nicht freigeschaltet. Nicht gegengeprüft, rechtlich prüfen lassen. Status: neu.

Behebung: `consent_collection.terms_of_service = 'required'` plus `custom_text` mit dem Verzichtstext in der Checkout-Session, oder ein Häkchen vor dem Weiterleiten; Text in den AGB anpassen.

**H15. Reporting und Zugriff messen Verschiedenes.** `src/lib/reporting/queries.ts`, Zeile 299, zählt Lernende über `enrollments`; der Lernzugang läuft aber über Mitgliedschaft (H1). Wer ohne Einschreibung lernt (jedes importierte Mitglied), fehlt im Bericht, in der Abschlussquote und im CSV-Export. Das Admin-Dashboard (`src/app/(admin)/admin/page.tsx`, Zeile 62 und 187) rechnet mit einer dritten Definition, lädt ohne Paginierung und zeigt keine „aktiven Lernenden 30 Tage" wie SPEC §4.2 verlangt. Status: neu.

Behebung: Teil von H1 (Einschreibung als einzige Wahrheit für Zugriff und Reporting), Dashboard auf dieselben Abfragen umstellen.

**H16. Zeiterfassung wird beim Löschen eines Arbeiters vernichtet.** Migration 20260807142619, Zeile 347 bis 348: `calendar_time_entries_worker_fk ... on delete cascade` (selbst geprüft). Löscht ein Admin einen Arbeiter oder dessen Mitgliedschaft, verschwinden alle Ist-Zeiten. § 16 Abs. 2 ArbZG verlangt zwei Jahre Aufbewahrung der Aufzeichnungen über die werktägliche Arbeitszeit. Status: neu.

Behebung: `on delete restrict` plus Soft-Delete (`calendar_workers.status = 'archived'`), Löschung erst nach Ablauf der Frist per Aufräumjob.

**H17. Ist-Zeiten sind für niemanden sichtbar.** `src/lib/calendar/queries.ts`, Zeile 128, lädt Zeiteinträge, aber keine Admin- oder Arbeiter-Ansicht zeigt sie an; es gibt keine Korrektur, keine Genehmigung, keinen Export. `src/components/learn/time-clock-widget.tsx`, Zeile 61: kein Schutz gegen vergessenes Ausstempeln (keine Maximaldauer, kein Auto-Close); ein Arbeiter kann `ended_at` per Direktclient in die Zukunft setzen (Migration 20260807142619, Zeile 718). Ein deaktivierter Arbeiter kann weiter stempeln (`src/lib/calendar/actions.ts`, Zeile 432). Nicht gegengeprüft. Status: neu.

Behebung: Ansicht „Zeiten" je Arbeiter und Monat mit Korrektur und Freigabe, CSV-Export für die Lohnabrechnung, Auto-Close nach 14 Stunden mit Markierung „zu prüfen", `status = 'active'` beim Stempeln prüfen, `ended_at <= now()` als Constraint.

**H18. KI-Job-Pipeline kann Schritte doppelt und endlos ausführen.** `src/lib/generator/process.ts`, Zeile 30: `STALE_RUNNING_MS = 3 * 60 * 1000` (selbst geprüft). Ein Sonnet-Schritt mit 12.000 Ausgabe-Tokens dauert länger als drei Minuten; der nächste Cron-Tick hält den Job für hängen geblieben und startet ihn erneut. Es gibt keinen Versuchszähler, also keine Obergrenze für kostenpflichtige Wiederholungen. Der auf dem Ruflo-Branch behobene CAS-Lock-Fehler verschärfte das bisher zusätzlich. Status: neu.

Behebung: Stale-Fenster auf 15 Minuten, `ai_jobs.attempts` mit Abbruch nach drei Versuchen und Status `failed` mit Fehlertext.

**H19. Kein Kostendeckel für die nicht-kontingentierten KI-Posten.** Bunny-Transkription (0,10 USD je Minute), Haiku-Übersetzung, Zusammenfassung und Embeddings laufen außerhalb von `usage_counters` (`src/lib/video/transcript.ts`, Zeile 118). Ein Mandant, der 100 Stunden Video hochlädt, erzeugt rund 600 USD Transkriptionskosten beim Betreiber, ohne dass etwas bremst. Nicht gegengeprüft. Status: neu.

Behebung: Minutenkontingent je Plan in `usage_counters`, Abbruch mit Meldung im Kurs-Editor, Betreiber-Alarm ab einem Schwellwert.

**H20. Barrierefreiheit im Alltag des Betreibers.** Vier Punkte mit kleinem Aufwand und großer Wirkung für einen sehbehinderten Nutzer, selbst geprüft: (a) Der Abmelden-Knopf in der Lernansicht hängt an `onPointerDown` (`src/components/layout/topbar-menus.tsx`, Zeile 289) und reagiert weder auf Enter noch auf Leertaste. (b) Der Farb-Token `--color-muted-400` (#a9aac4) für Beschriftungen und Metatexte erreicht auf Weiß 2,27:1, `muted-300` 1,88:1; WCAG AA verlangt 4,5:1 (CLAUDE.md §3.4). `muted-500` (5,28:1) und `primary` (5,54:1) sind in Ordnung. (c) Kein Skip-Link, im Admin-Bereich keine `<main>`-Landmark und zwei `h1` je Seite (`src/components/admin/admin-shell.tsx`, Zeile 62). (d) Schriftgrößen durchgehend in `px` (186 Vorkommen von 13 px, bis hinunter zu 9 px); die Browser-Schriftgrößeneinstellung bleibt wirkungslos, es bleibt nur Zoom. Status: neu.

Behebung: `onClick` statt `onPointerDown`; `muted-400` auf mindestens #6b6d95, `muted-300` nur für dekorative Elemente; Skip-Link und `<main>` in beiden Shells; Schriftgrößen auf `rem` mit Basis 16 px. Das sind zusammen ein bis zwei Tage.

**H21. Portal-Status „Trial" schaltet die Akademie ab.** `tenants.status` erlaubt `active`, `trial`, `suspended` (0001_init.sql, Zeile 20); das Betreiber-Portal bietet alle drei an. `resolveTenantByHost()` und drei weitere Auflösungen in `src/lib/tenant/resolve.ts` (Zeilen 27, 42, 108, 137) filtern aber auf `status = 'active'` (selbst geprüft). Ein Mandant, den der Betreiber auf „Trial" stellt, ist für seine Nutzer sofort nicht mehr erreichbar; ein gesperrter Mandant zeigt statt einer Sperrseite die Entwickler-Startseite. API-Keys gesperrter Mandanten laufen weiter. Status: neu.

Behebung: `trial` wie `active` auflösen und stattdessen `tenants.trial_ends_at` prüfen; `suspended` auf eine Sperrseite mit Kontakt leiten; API-Key-Prüfung um den Mandantenstatus ergänzen.

**H22. Löschanträge werden nie ausgeführt.** `src/app/profil/actions.ts`, Zeile 63, schreibt einen Antrag in `deletion_requests`; im gesamten Code gibt es keinen Aufruf von `auth.admin.deleteUser` und keine Oberfläche, die Anträge anzeigt (selbst geprüft). Art. 17 DSGVO verlangt Löschung „unverzüglich", in der Praxis binnen eines Monats; AVV und TOM sagen die Löschung zu. Status: neu.

Behebung: Antrags-Inbox im Betreiber-Portal mit Fristanzeige, Lösch-Job (`auth.users` löschen, `orders` und `webhook_deliveries` anonymisieren), Bestätigungsmail.

**H23. DSGVO-Exporte unvollständig, neue Mandanten ohne Impressum.** Der Mandanten-Export (`src/app/portal/mandanten/[id]/export/route.ts`, Zeile 102) kennt die seit August hinzugekommenen Tabellen nicht (alle `calendar_*`, Kunden-Area, Lesezeichen, Push); der Selbst-Export ebenso. `tenants.legal.entity` ist weder im Portal noch im Admin pflegbar (`src/app/(legal)/layout.tsx`, Zeile 38); jeder neue Mandant antwortet auf `/legal-notice` mit 404, bis jemand SQL ausführt. Nicht gegengeprüft, deckt sich aber mit dem PHASENSTATUS-Eintrag vom 24.08. Status: neu.

Behebung: Export über eine Tabellenliste aus `information_schema` (alle Tabellen mit `tenant_id`), Rechtsträger-Felder im Portal-Formular und im Admin, Mandant ohne Rechtsträger nicht auf `active` setzen.

**H24. Keine Rollenverwaltung und keine Kurs-Zuweisung in der Oberfläche.** Einladung und CSV-Import erzeugen immer `member` (`src/lib/users/import.ts`, Zeile 313); es gibt keinen Weg, jemanden zum Trainer oder Admin zu machen, außer per SQL. Die Teilnehmer-Detailseite bietet keine Kurs-Zuweisung für bestehende Nutzer (SPEC §4.2 „Kurs-Zuweisung, Fortschritts-Popup"). Branding (Farbe, Radius, Schrift) ist im Admin dagegen vorhanden; Tutor-Schalter, Domain und Rechtsträger bleiben Betreiber-Sache. Ein Kunde kann also seine Akademie ohne Josip nicht einrichten. Status: neu.

Behebung: Rollenwahl in Einladung und Teilnehmerliste (owner darf admin/trainer vergeben), Kurs zuweisen und entziehen auf der Teilnehmer-Detailseite, beides mit Audit-Eintrag.

### 3.3 Mittel

| Nr. | Bereich | Befund und Fundstelle | Behebung |
|---|---|---|---|
| M1 | Auth | `resolveSafeNextParam()` in `src/lib/marketplace/redirect.ts`, Zeile 21, lässt `/\evil.example` durch; Browser normalisieren den Backslash zu `//evil.example`. Betrifft den Marketplace-Login auf `main` und den Callback-Fix auf dem Ruflo-Branch. | zusätzlich `\` und Steuerzeichen ausschließen, Test ergänzen |
| M2 | Auth | Registrierung, Magic-Link und Passwort-Reset haben nur ein IP-Rate-Limit, kein CAPTCHA und keinen Honeypot (§2.7). Turnstile liegt fertig auf dem Kontaktformular-Branch. | Turnstile-Komponente nach dem Merge auch in Registrierung und Reset einbauen |
| M3 | Auth | `/passwort-setzen` akzeptiert jede angemeldete Session ohne erneute Passworteingabe; keine Info-Mail, andere Geräte bleiben angemeldet (`src/lib/auth/actions.ts`, Zeile 429). | Re-Authentifizierung per `reauthenticate()` oder Reset-Token verlangen, Info-Mail senden |
| M4 | Auth | Wartungsmodus antwortet auch auf Impressum, Datenschutz, AGB und Kontakt mit 503 (`src/lib/tenant/routing.ts`, Zeile 122). Impressumspflicht gilt auch während Wartung. | Rechts- und Kontaktpfade in `isMaintenanceBypassPath()` aufnehmen |
| M5 | Auth | Registrierung meldet „existiert bereits" und verrät damit vorhandene Konten (§2.15), `src/lib/auth/actions.ts`, Zeile 191. | neutrale Antwort wie beim Passwort-Reset |
| M6 | Auth | `src/lib/account/actions.ts` validiert Eingaben ohne zod (§2.3) und reicht bei `changeEmail` das rohe `error.message` an die Oberfläche. | zod-Schemata wie in `auth/schema.ts`, Fehler übersetzen |
| M7 | Auth | Die Middleware macht pro Request ein bis drei `service_role`-Abfragen plus Auth-Roundtrip, auch für Webhooks, Cron, `/api/v1` und unbekannte Hosts, ohne Cache (`src/middleware.ts`, Zeile 72 ff.). | Mandanten-Auflösung für 60 s cachen (Workers Cache API oder KV), API- und Webhook-Pfade früh ausnehmen |
| M8 | RLS | `course-assets` ist ein öffentlicher Bucket, und jedes Mitglied darf den gesamten Mandantenordner listen (Migration 20260710233735, Zeile 18). Dateien unveröffentlichter oder kostenpflichtiger Kurse sind mit bekannter URL ohne Login abrufbar. | Bucket privat stellen und signierte URLs mit kurzer Laufzeit ausgeben, Listing auf Staff beschränken |
| M9 | RLS | `submissions_own_all` und `avatars_own_*` in `storage.objects` ohne Mandanten- und Mengenbindung (Migration 0002_storage, Zeile 72). | Pfadpräfix `{tenant_id}/{user_id}/` erzwingen, Größenlimit je Nutzer |
| M10 | RLS | Fremdschlüssel von `modules`, `lessons`, `sections`, `quizzes`, `enrollments`, `attempts`, `submissions`, `bookmarks`, `tutor_conversations` sind nicht an `tenant_id` gebunden; ein Insert mit fremder Eltern-ID im eigenen Mandanten ist möglich. Die Kalender-Tabellen machen es mit zusammengesetzten FKs richtig vor. | zusammengesetzte FKs `(parent_id, tenant_id)` nachziehen, wie in Migration 20260807142619 |
| M11 | RLS | Die Migrationshistorie im Repo weicht von der Live-Datenbank ab: drei Live-Migrationen fehlen auf `main`, mehrere Zeitstempel und Namen unterscheiden sich (z. B. `rate_limits` 20260710235500 im Repo, 20260710234334 live; `perf_advisors` live als zwei Migrationen). `supabase db push` ist damit nicht verlässlich. | einmalig `supabase db pull`/`migration repair` gegen die Live-Historie, danach nur noch Migrationen über das Repo anwenden |
| M12 | RLS | Keine automatisierten RLS-Negativtests trotz 14 nachträglicher RLS-Fixes; `e2e/global-setup.ts` legt nur Testdaten an. | Vitest-Suite mit `anon`-Client gegen eine Supabase-Branch-DB: je Tabelle „fremder Mandant liest nichts, Lernender schreibt keine Bewertung" |
| M13 | RLS | `audit_log` existiert seit Migration 0001, wird aber nirgends geschrieben; live 0 Zeilen. Admin- und Betreiber-Aktionen sind nicht nachvollziehbar. | `logAudit()`-Helfer in den zentralen Server Actions (Nutzer, Rollen, Produkte, Freigaben, Mandanten) |
| M14 | API | `POST /api/v1/users` legt Nutzer ohne Einladungs- oder Zugangsmail an (`src/app/api/v1/users/route.ts`, Zeile 121). Per Zapier angelegte Personen können sich nicht anmelden. | Einladungsmail wie beim CSV-Import versenden, optional per Parameter abschaltbar |
| M15 | API | Der Bunny-Webhook startet bei Status 3 für jedes Video der Library eine kostenpflichtige Transkription, fest mit Sprache `de`, ohne Lektions- oder Mandantenbezug (`src/app/api/bunny/webhook/route.ts`, Zeile 92). | nur Videos mit `bunny_videos`-Zeile und aktivem Mandanten transkribieren, Sprache aus Kurs oder Mandant |
| M16 | API | Der Portal-Mandantenexport gibt Webhook-Secrets im Klartext und API-Key-Hashes aus (`src/app/portal/mandanten/[id]/export/route.ts`, Zeile 123). | Secrets aus dem Export streichen oder maskieren |
| M17 | API | Keine API- und Webhook-Dokumentation; SPEC §3 nennt „Zapier/Make-Doku" als Should. Kein Zustellprotokoll und kein Test-Ereignis im Admin (`src/components/admin/webhooks-panel.tsx`). | eine Markdown-Seite `docs/api-v1.md` mit Beispielen, Zustellliste aus `webhook_deliveries` im Admin, Knopf „Test-Ereignis senden" |
| M18 | API | Abo-Kündigung und `past_due` entziehen keinen Zugriff; `enrollments.expires_at` wird nie gesetzt und in der Lernansicht nicht geprüft (`src/app/api/stripe/webhook/route.ts`, Zeile 389). | Teil von H1 |
| M19 | Kurse | Lektionen lassen sich nicht umsortieren und nicht in eine andere Sektion verschieben; kein Drag & Drop im Strukturbaum (`src/components/admin/module-lesson-tree.tsx`, Zeile 389). SPEC §4.2 verlangt beides. | `moveLesson()` analog `moveModule()`, später Drag & Drop mit Tastaturalternative |
| M20 | Kurse | Fortschritt ist Selbstauskunft per Knopf; keine Video-Mindestansicht, keine Reihenfolge, kein Drip-Content (`src/lib/progress/actions.ts`, Zeile 33). `completeLesson()` prüft `lessonId` nicht gegen Mandant und Kurs (bekannt). | Mandanten- und Kursprüfung sofort; Video-Mindestansicht und Drip als Kurs-Optionen |
| M21 | Kurse | Player ohne Wiederaufnahme-Position, ohne klickbare Kapitel, ohne Autoplay- und Tempo-Steuerung (`src/components/player/bunny-player.tsx`, Zeile 82); `progress.status = 'started'` wird nie geschrieben. SPEC §3 nennt Autoplay, Tempo, Kapitel als Must. | Position alle 10 s speichern, Kapitel aus `lessons.chapters` klickbar, Player-Parameter setzen |
| M22 | Kurse | Autosave mit 1-s-Debounce ohne Navigationsschutz: Wer innerhalb der Sekunde weiterklickt, verliert die Änderung; parallele Speicherungen laufen unserialisiert (`src/components/editor/block-editor.tsx`, Zeile 96). | `beforeunload`-Schutz, ausstehende Speicherung vor Navigation abwarten, `updated_at`-Vergleich gegen Überschreiben |
| M23 | Kurse | Einbettungs-Block rendert beliebige `iframe`-URLs ohne `sandbox` und ohne Allowlist; Bild-, Audio-, Datei- und Embed-Blöcke akzeptieren `http:`-URLs (`src/components/learn/block-renderer.tsx`, Zeile 222). | Allowlist (YouTube, Vimeo, Bunny, Loom), `sandbox="allow-scripts allow-same-origin"`, nur `https:` |
| M24 | Kurse | Die Lektionsseite lädt bei jedem Aufruf alle Lektionen des Kurses samt `blocks`, `transcript` und `summary` (`page.tsx`, Zeile 84). Bei 50 Lektionen mit Transkripten sind das Megabytes pro Klick. | für die Navigation nur `id, title, section_id, position` laden, Inhalt nur für die aktuelle Lektion |
| M25 | Kurse | Pflicht-Hierarchie Kurs, Modul, Sektion, Lektion: Für eine erste Lektion sind vier Anlagen nötig, das verletzt die 3-Klick-Regel (§3.2). Keine Vorschau als Lernender, kein Duplizieren, keine Vorlagen. | „Kurs anlegen" erzeugt Modul 1 und Sektion 1 mit; Vorschau-Link auf die Lernansicht im Entwurfsmodus; „Kurs duplizieren" |
| M26 | Zahlungen | Test- und Live-Modus nicht getrennt: das einzige Produkt trägt Testmodus-Preis-IDs, der Webhook prüft `event.livemode` nicht (selbst geprüft, kein Treffer). Nach dem Wechsel auf Live-Schlüssel scheitert der Checkout mit „No such price". | `livemode` gegen die Umgebung prüfen, Produkte beim Wechsel neu anlegen, Hinweis im Admin |
| M27 | Zahlungen | Der reguläre Webhook-Pfad antwortet bei internen Fehlern mit 200 (`webhook/route.ts`, Zeile 153); Stripe wiederholt dann nicht, der Kunde hat gezahlt und bleibt ohne Zugriff. `success_url` `/?checkout=success` wird nirgends ausgewertet, es gibt keine Bestätigungsseite. | 500 bei Fehlern zurückgeben, Bestätigungsseite mit Status „wird freigeschaltet" |
| M28 | Zahlungen | Provisions-Ledger ohne Mandantensicht und ohne Storno; `/admin/zahlungen` zeigt Marketplace-Bestellungen als vollen Umsatz (`src/lib/platform/marketplace.ts`, Zeile 556). | Ledger-Auszug im Mandanten-Admin, Storno-Buchung bei Erstattung (H11) |
| M29 | Quiz | Quiz-Zeitlimit wird nur als Countdown angezeigt, serverseitig nicht durchgesetzt (`src/lib/quiz/actions.ts`, Zeile 262). | `started_at` serverseitig setzen, Abgabe nach Ablauf plus Toleranz ablehnen |
| M30 | Quiz | Freitext-Fragen (`kind = 'open'`) werden gespeichert, aber nie angezeigt oder bewertet (`src/lib/quiz/grade.ts`, Zeile 266); `kind = 'exam'` hat keine Wirkung, weder auf Lektionsabschluss noch auf das Zertifikat (`src/lib/certificates/issue.ts`, Zeile 26). | Freitext im Runner anzeigen und in die Abgaben-Inbox leiten; bestandene Prüfung als Bedingung für das Zertifikat |
| M31 | Quiz | Kein Ergebnis-Feedback je Frage, kein persistiertes Ergebnis für den Lernenden; Antwortoptionen werden nicht gemischt; Bestehensgrenze 0 % erlaubt. | Ergebnisseite mit richtig/falsch je Frage, Mindestgrenze 1 % |
| M32 | Abgaben | „Überarbeitung nötig" ist eine Sackgasse (kein Wiedereinreichen, `src/components/learn/submission-form.tsx`, Zeile 82); keine Benachrichtigung an Trainer bei neuer Abgabe (`src/lib/submissions/actions.ts`, Zeile 88). | Wiedereinreichen erlauben, Mail an Trainer und Admin |
| M33 | Zertifikate | Zertifikate fehlen im Profil (SPEC §4.1), PDF nur auf Deutsch trotz Mandantensprache bs/en (`src/lib/certificates/pdf.ts`, Zeile 288), keine Verifikations-URL. | Profilseite ergänzen, PDF aus `messages/*` übersetzen, `/zertifikat/[id]` als öffentliche Prüfseite |
| M34 | Reporting | Teilnehmer-Detailseite ohne Fortschritt, Quiz-Ergebnisse, Abgaben, Zertifikate und ohne Kurs-Zuweisung (`src/app/(admin)/admin/teilnehmer/[id]/page.tsx`); Abgaben-Inbox und Teilnehmerliste ohne Pagination. | Detailseite aus den Reporting-Abfragen füllen, Kurs-Zuweisung als Kern des Admin-Alltags |
| M35 | Schichtplan | Arbeitszeitgesetz nur im KI-Prompt: Höchstarbeitszeit, 11 Stunden Ruhezeit und Pausen werden serverseitig nirgends geprüft (`src/lib/calendar/schema.ts`, Zeile 581). | reine Prüffunktion `checkArbZG()` vor Anlage und Buchung, Warnung statt harter Sperre |
| M36 | Schichtplan | Keine Benachrichtigung bei Planänderungen (neue, verschobene, gelöschte Schicht); „Mein Schichtplan" zeigt weder Ist-Zeiten noch Abwesenheiten, obwohl beide Abfragen existieren (`src/app/(portal)/schichtplan/page.tsx`, Zeile 82); kein Urlaubs- oder Krankmeldungs-Workflow, Status `requested` im Schema unerreichbar. | Mail bei Planänderung, beide Abfragen einbinden, Antragsformular für Abwesenheit |
| M37 | Schichtplan | Überlappungs- und Stempelschutz gelten je Mandant, nicht je Person; ein Freelancer in zwei Mandanten kann sich doppelt buchen (Migration 20260807142619, Zeile 227). | Produktentscheidung: je Person prüfen (mandantenübergreifende Abfrage über `service_role`) oder dokumentiert hinnehmen |
| M38 | KI | Kontingent wird auch bei fehlgeschlagenem Aufruf verbraucht (`src/lib/tutor/actions.ts`, Zeile 182); der Tutor sendet keinen Gesprächsverlauf an Claude, die Datenschutzerklärung behauptet das Gegenteil (Zeile 212); kein Ähnlichkeits-Schwellenwert im RAG, Quellen erscheinen auch bei „steht nicht im Kurs" (Migration 20260711164838, Zeile 61). | Kontingent erst nach Erfolg buchen, letzte sechs Nachrichten mitsenden, Schwellwert 0,75 mit Test |
| M39 | KI | Cron verarbeitet mandantenübergreifend einen Schritt je zwei Minuten (`src/lib/generator/process.ts`, Zeile 46): ein Kursentwurf braucht mindestens sechs Minuten, bei zwei Mandanten gleichzeitig Stunden. Embeddings entstehen nur per Handklick, nie beim Veröffentlichen, nie für Transkripte; `/suche` ist nirgends verlinkt. | bis zu fünf Schritte je Tick, Embedding-Job beim Veröffentlichen, Suche in die Navigation |
| M40 | KI | Generator akzeptiert eine Datei je Auftrag und kürzt still auf 60.000 Zeichen (`src/app/api/admin/ki/generate/route.ts`, Zeile 61); kein Zusatzkontingent und keine Vorwarnung bei Erschöpfung (SPEC: 29 €/1.000), der Tutor schaltet hart ab. | Mehrfach-Upload, sichtbarer Hinweis bei Kürzung, Warnmail bei 80 % |
| M41 | i18n | Admin-Navigation, Admin-Dashboard, Editor-Werkzeuge und Player-Titel hartkodiert deutsch (`src/components/layout/AdminSidebar.tsx`, Zeile 112); rund 20 feste `de-DE`-Formatierungen in Lernansicht, Schichtplan und Zertifikat. | in `messages/*` überführen, `Intl`-Formatierung mit der aktiven Locale |
| M42 | Barrierefreiheit | Keine Kontrastprüfung bei der Mandanten-Akzentfarbe (`tenant-branding-form.tsx`, Zeile 65): ein heller Akzent erzeugt unlesbare weiße Beschriftung. Menüs mit `role="menu"` ohne `menuitem`, ohne Escape (`topbar-menus.tsx`, Zeile 110). Div-Listen ohne Tabellensemantik, `<th>` ohne `scope`. Formularfehler ohne `aria-invalid`. | Kontrastwarnung im Formular, Menü-Semantik oder `role` entfernen, echte Tabellen, `aria-describedby` |
| M43 | Barrierefreiheit | Kein Dark Mode, kein High-Contrast-Modus, kein `prefers-reduced-motion` (`src/app/globals.css`); keine Erklärung zur Barrierefreiheit (BFSG). | `prefers-reduced-motion` sofort, Erklärung als Seite unter `(legal)`, Dark Mode nach dem ersten Kunden |
| M44 | Portal | CSV-Import verschickt alle Willkommensmails gleichzeitig (`src/lib/users/import.ts`, Zeile 105) und scheitert damit am Resend-Standardlimit; der Fehler bleibt in der Oberfläche unsichtbar. Der DoD-Wert „100 Nutzer < 30 s" ist damit nicht mehr belegt. | Versand in Stapeln von 10 je Sekunde, Fehlerliste im Import-Ergebnis |
| M45 | Portal | Attrappen: Die Benachrichtigungs-Einstellungen (`src/lib/account/actions.ts`, Zeile 105) werden von keinem Mailpfad gelesen, fünf von sechs Schaltern beschreiben Mails, die es nicht gibt; die Benachrichtigungsglocke (`src/components/learn/app-shell.tsx`, Zeile 166) ist immer leer. | Schalter ohne Wirkung entfernen, Glocke erst mit echter Ereignisquelle zeigen |
| M46 | Portal | Fehlende Ereignis-Mails gegenüber SPEC „E-Mail-Benachrichtigungen": neue Abgabe an Trainer, Kurs-Zuweisung, Löschantrag, Kontingent-Ende, Trial-Ablauf, Planänderung im Schichtplan. Kein Bounce- und Complaint-Handling (`src/lib/email/client.ts`, Zeile 73): harte Bounces werden weiter angeschrieben, die Domain-Reputation von `calltalent.ai` trägt alle Mandanten. Absender fest `noreply@calltalent.ai`, kein Reply-To. | Ereignis-Mails aus einer Quelle, Resend-Webhook für Bounces, Reply-To auf die Support-Adresse des Mandanten |
| M47 | Portal | Datenschutzerklärung deckt die reale Verarbeitung nicht ab: Zeiterfassung (Art. 9 bei Krankmeldungen), Web-Push, Bunny-Transkription, Generator-Uploads fehlen; kein Abschnitt zum Art.-27-Vertreter (`src/app/(legal)/privacy/page.tsx`, Zeile 22). | Abschnitte ergänzen, anwaltlich prüfen lassen |
| M48 | Portal | Betreiber-Portal ohne MFA, ohne zweiten Admin, ohne Papierkorb (`src/lib/platform/auth.ts`, Zeile 35): ein kompromittiertes Platform-Admin-Konto löscht Mandanten endgültig. | TOTP für `platform_admins`, Soft-Delete mit 30 Tagen Frist |
| M49 | Produkt | Semantische Suche für Lernende unerreichbar: der Sidebar-Knopf „Suchen" klappt nur die Sidebar ein (`src/components/layout/Sidebar.tsx`, Zeile 308, selbst geprüft); `/suche` ist in keiner Navigation verlinkt. | Knopf auf `/suche` verlinken |
| M50 | Produkt | Migrations-Importer akzeptiert nur ein hausinternes JSON ohne Format-Dokumentation (`src/lib/import/course-import.ts`, Zeile 29); CLAUDE.md §6.4 verlangt „CSV + Video-Reupload". Kein Kurs-Duplizieren, keine Vorlage, kein „Kurs in Kundenmandant kopieren", also kein Weg, Calltalent-Inhalte an Kunden zu verteilen. | Beispieldatei und Doku, „Kurs kopieren nach Mandant" im Portal |
| M51 | Produkt | PWA: Manifest-Sprache fest `de`, Offline-Shell praktisch leer, Installierbarkeit und Push nie live bestätigt (`src/app/manifest.ts`, Zeile 47); live 0 Push-Abonnements. | einfrieren, bis Ereignisse per Mail laufen |

### 3.4 Behoben, aber nicht in `main`

Die folgenden Punkte sind auf `claude/ruflo-swarm-hierarchical-0trzqy` behoben und heute vermutlich live, fehlen aber im Hauptzweig: Header-Spoofing über `x-tenant-*`, Open Redirect im Auth-Callback (mit der Backslash-Einschränkung aus M1), Logout ohne CSRF-Prüfung, Einladungen ohne Rate-Limit, vier stille Schreibfehler über den RLS-Client (Bericht zurücksetzen, Generator-Idempotenz, Entwurf löschen, Job-Sperre), Reporting über 1.000 Zeilen, Zertifikatsdatum in UTC, verwaiste PDFs, Positions-Duplikate, Versuchslimit per Doppelklick, Quiz-Mischung nach dem Absenden, Kalender-Zeitzonen, doppelte Kaufbestätigungen im Marketplace, Next.js-Sicherheitsupdates. Auf `claude/contact-request-security-check-78qawq` liegt der komplette Bot-Schutz des Kontaktformulars.

---

## 4. Was fehlt

### 4.1 Gegenüber SPEC.md und CLAUDE.md

1. Einschreibungs-gebundener Zugriff und Zugriffsentzug bei Abo-Ende (SPEC §1, §2 „zugewiesene Kurse"), siehe H1.
2. Player-Funktionen Autoplay, Tempo, Kapitel, Wiederaufnahme (SPEC §3 Must), siehe M21.
3. Editor: Drag & Drop, Vorschau, Lektionen sortieren (SPEC §4.2), siehe M19, M25.
4. Drip-Content, zeitgesteuerte Freischaltung (SPEC §3 Should). Nicht vorhanden.
5. Migrations-Importer mit Video-Reupload (CLAUDE.md §6, Phase 4). Vorhanden ist nur der Nutzer-CSV-Import.
6. Zapier/Make-Dokumentation (SPEC §3 Should), siehe M17.
7. Route `/admin/design` (SPEC §4.2). Branding liegt in `/admin/einstellungen`, die SPEC-Route existiert nicht; das ist eine Abweichung, kein Funktionsverlust.
8. Bot-Schutz auf Login, Registrierung und Reset (CLAUDE.md §2.7), siehe M2.
9. Session-Ablauf (§2.8), siehe H9.
10. Kurs-Generator: nur PDF, kein DOCX/PPTX (SPEC §6). Bekannt (Ruflo Punkt 15).
11. Definition of Done nie gemessen: Lighthouse mobil ≥ 90 und LCP < 1 s (Phase 4, §3.3), „Tutor beantwortet 10 Testfragen und verweigert 2 Off-Topic" (Phase 3), „Neuer Mandant in < 5 Minuten produktiv" (Phase 4). Für „CSV-Import 100 Nutzer < 30 s" existieren die 100 Testkonten vom 10.07. als Spur, aber kein dokumentiertes Ergebnis.
12. Tests: keine RLS-Negativtests (M12), keine Tests für Route-Handler, Stripe- und Bunny-Webhooks, Auth- und Account-Actions. 43 Testdateien decken `src/lib` ab, keine einzige Komponente hat einen Test.
13. `audit_log` (SPEC §5) wird nicht geschrieben, siehe M13.

### 4.2 Für den Betrieb

1. Keine CI. Kein `.github/`-Ordner, kein Branch-Schutz. Tests und Typprüfung laufen nur, wenn jemand sie lokal anstößt. Die Regression H3 ist genau so entstanden.
2. Deploy nur von Josips Rechner (`npm run deploy` mit `wrangler login`). Der Stand von `main` und der deployte Stand driften auseinander, weil nichts sie koppelt.
3. Kein Monitoring, kein Error-Tracking, keine Alarme. Ein 500er im Stripe-Webhook fällt erst auf, wenn ein Kunde sich meldet. Cloudflare `observability.enabled` liefert Logs, aber niemand liest sie automatisch.
4. Kein Backup-Konzept. Supabase Free-Plan: keine automatischen Backups, kein Point-in-Time-Recovery. Ein fehlerhaftes `delete` ohne `where` in einer Migration ist nicht rückholbar.
5. Secrets liegen nur im Cloudflare-Dashboard (`keep_vars: true`), ohne Inventur und ohne Rotationsplan; der Ruflo-Bericht nennt die Rotation als erledigt, ein Verzeichnis, welche Schlüssel wo liegen, gibt es nicht.
6. Datenhygiene: 100 Testkonten in der Produktionsdatenbank, E2E-Suite läuft gegen die Produktions-DB, `rate_limits` und `webhook_deliveries` wachsen ohne Aufräumjob.
7. Migrations-Drift (M11).
8. Wissensarchiv: `PHASENSTATUS.md` mit 843 KB ist chronologisch und nicht nach Themen auffindbar; `README.md` behauptet „Phase 0 abgeschlossen" und nennt die Calltalent Ltd. Wer das Projekt übernimmt, findet den Ist-Zustand nirgends auf einer Seite.
9. Bus-Faktor 1: Deploy-Rechte, Cloudflare-, Supabase-, Stripe-, Bunny-Zugänge und die `.env` liegen bei einer Person.

### 4.3 Für den Verkauf

1. Keine Abrechnung der Mandanten selbst. Das Preismodell (2.990 € Einrichtung, 149 oder 249 €/Monat) existiert nur in `README.md`. Das Betreiber-Portal setzt `plan` von Hand; Rechnung, Zahlung und Mahnung laufen außerhalb des Systems. Für drei Mandanten ist das tragbar, für zehn nicht.
2. Kein Onboarding. Ein neuer Mandanten-Admin sieht nach dem ersten Login ein leeres Dashboard ohne Erstkurs-Assistenten, ohne Beispielkurs, ohne Checkliste („Logo hochladen, ersten Kurs anlegen, erste Person einladen"). Er kann außerdem niemanden zum Trainer oder Admin machen und keinem bestehenden Nutzer einen Kurs zuweisen (H24); jede Einrichtung läuft über Josip.
3. Keine Demo-Inhalte. `demo-blau` hat 0 Kurse. Ein Interessent kann die Plattform nirgends als Lernender erleben.
4. Kaufweg unvollständig: K1 (Kauf ohne Mitgliedschaft), H1 (Einschreibung wirkungslos), H5 (asynchrone Zahlarten), keine Rechnungsstellung an Endkunden über Stripe Invoices, keine Steuerlogik (Stripe Tax), kein Gutschein, kein Bundle.
5. Breite statt Tiefe: LMS, Marketplace, Kunden-Area, Schichtplan, drei Sprachen und ein Betreiber-Portal sind gebaut, während der Kern (ein Kurs, ein Lernender, ein Zahlungseingang) noch nie unter Produktionsbedingungen durchlaufen wurde.
6. Kurs-Generator nimmt nur PDF an. Die Zielgruppe (Coaches, Vertriebstrainer) hat ihre Inhalte typischerweise in PowerPoint und Word.
7. Kein Vertriebsmaterial im Produkt: keine Preisseite, keine Demo-Buchung, kein Trial-Ablauf mit Erinnerung (`plan = 'trial'` existiert, ein Ablaufdatum nicht; der Status „Trial" schaltet die Akademie sogar ab, H21).
8. Attrappen, die Vertrauen kosten: Benachrichtigungsschalter ohne Mailpfad, leere Glocke, Push ohne Ereignisse, „Suchen"-Knopf ohne Suche (M45, M49, M51). Was nicht funktioniert, darf die Oberfläche nicht versprechen.

---

## 5. Was ich für den Erfolg verbessern würde

Reihenfolge nach Wirkung je Aufwand für einen Einzelbetreiber, der mit KI-Agenten baut. Jede Position nennt, woran der Erfolg messbar ist.

### 5.1 Sofort, diese Woche

1. **Branches zusammenführen und von `main` deployen.** `claude/ruflo-swarm-hierarchical-0trzqy` und `claude/contact-request-security-check-78qawq` nach `main` mergen, Konflikte in `PHASENSTATUS.md`, `messages/*.json` und `.env.example` auflösen, danach `npm run deploy` aus `main`. Den Marketing-Skills-Branch nur mergen, wenn die 483 Dateien unter `.claude/tools` gewollt sind; sonst schließen. Messbar: `git log origin/main` enthält e4352b5, Worker-Deploy-Zeitpunkt nach dem Merge.
2. **H3 beheben.** Migration `submit_quiz_attempt`: `member_role` durch `can_participate` ersetzen. Eine Zeile, vor dem nächsten Marketplace-Verkauf zwingend.
3. **K2 beheben.** Migration mit Spaltenrechten auf `tenants` und Guard-Trigger für die Betreiber-Schlüssel. Danach im Portal einmal prüfen, dass der Betreiber weiterhin alles setzen kann.
4. **K1 beheben.** Mitgliedschaft im Stripe-Webhook und bei der Selbstregistrierung anlegen. E2E-Fall dazu.
5. **H6 und H7 beheben.** Cron ruft zusätzlich `/api/admin/webhooks/retry`; alle `dispatchWebhookEvent`- und Push-Aufrufe in `after()`.
6. **H21 beheben.** `trial` in den vier Auflösungen wie `active` behandeln, `suspended` auf eine Sperrseite leiten. Eine Stunde Aufwand, verhindert, dass ein Klick im Portal einen Kunden offline nimmt.
7. **Live-Datenbank aufräumen.** Die 100 `testN@example.com`-Konten und die vier weiteren Testkonten ohne Mitgliedschaft löschen (`auth.admin.deleteUser`, Kaskade räumt `profiles` mit). Vorher Liste exportieren.
8. **Supabase-Dashboard.** Leaked-Password-Protection einschalten (seit 11.07. offen), Session-Timeouts setzen, Redirect-URLs für `*.calltalent.ai` und `salestalent.app` prüfen. Sammelmigration für die 17 `anon`-EXECUTE-Rechte (Ruflo Punkt 6.1).
9. **KI-Modell und Kostensätze** (H10): `claude-sonnet-5`, `claude-haiku-4-5`, Preise aktualisieren, einen Generator-Lauf am echten PDF gegenprüfen. Dazu H18: Stale-Fenster auf 15 Minuten und Versuchszähler, damit kein Job endlos Kosten erzeugt.
10. **Barrierefreiheit für den täglichen Betrieb** (H20): Abmelden-Knopf auf `onClick`, Token `muted-400` und `muted-300` anheben, Skip-Link und `<main>` in beiden Shells, `prefers-reduced-motion`. Ein bis zwei Tage, spürbar bei jedem Login.

### 5.2 In 30 Tagen

11. **CI mit GitHub Actions.** Ein Workflow `ci.yml`: `npm ci`, `tsc --noEmit`, `eslint`, `vitest run` mit Platzhalter-Env; Branch-Schutz auf `main` (Pull Request und grüner Check Pflicht). Zweiter Workflow `deploy.yml`: bei Push auf `main` `opennextjs-cloudflare build && deploy` mit `CLOUDFLARE_API_TOKEN` als Repo-Secret. Damit ist `main` per Definition der deployte Stand. Messbar: jeder Commit auf `main` hat einen grünen Check, letzter Deploy-Commit = HEAD.
12. **Monitoring.** Cloudflare Workers Logs mit Alarm auf 5xx-Rate, Sentry (kostenlos bis 5.000 Ereignisse/Monat) über `@sentry/nextjs` für Server Actions und Route-Handler, ein Uptime-Check auf `https://academy.calltalent.ai/login` und `/api/stripe/webhook` (HEAD). Messbar: ein absichtlich erzeugter Fehler landet innerhalb von 5 Minuten als Nachricht bei Josip.
13. **Backups.** Entweder Supabase Pro (25 USD/Monat, tägliche Backups, 7 Tage) oder ein Cron-Job mit `pg_dump` in einen R2-Bucket mit `jurisdiction: eu`. Einmal Restore in eine Branch-DB üben. Messbar: ein datierter Dump liegt vor und wurde einmal eingespielt.
14. **H1 umsetzen** (Einschreibungs-Gating plus Abo-Entzug). Das ist die Voraussetzung, um überhaupt kostenpflichtige Kurse zu verkaufen. Reporting und Dashboard auf dieselbe Definition (H15).
15. **Stripe-Lebenszyklus schließen**: Rückerstattungen und Disputes (H11), Kundenportal mit Kündigungsknopf (H12), `payment_status` (H5), `livemode`-Prüfung und Produkte für den Live-Modus (M26), Fehler mit 500 statt 200 quittieren (M27), Widerrufsverzicht im Checkout (H14, vorher anwaltlich bestätigen lassen). Zusammen zwei bis drei Tage.
16. **H2, H4, H8** und aus 3.3 die Punkte M1, M4, M5, M8, M15, M16, M20, M23, M29, M30, M38 (jeweils Stunden bis ein Tag).
17. **Zeiterfassung vor dem ersten Lohnlauf** (H16, H17): `on delete restrict` plus Archivstatus, Zeiten-Ansicht mit Korrektur und CSV-Export, Auto-Close nach 14 Stunden. Ohne das darf kein Mandant den Schichtplan für echte Beschäftigte nutzen.
18. **KI-Kostendeckel** (H19): Minutenkontingent für Transkription je Plan, Kontingent nur bei Erfolg buchen (M38), Betreiber-Alarm.
19. **RLS-Negativtests** (M12) als Vitest-Suite gegen eine Supabase-Branch-Datenbank, in der CI laufend.
20. **Der erste echte Kurs.** Josip baut auf `academy.calltalent.ai` einen vollständigen Calltalent-Kurs (fünf Lektionen mit Video, ein Quiz, ein Zertifikat) und lässt drei echte Personen ihn durchlaufen, inklusive eines Testkaufs im Stripe-Testmodus. Jeder Stolperstein wird ein Ticket. Messbar: drei ausgestellte Zertifikate in `certificates`, eine `orders`-Zeile mit `paid`.
21. **Self-Service für den ersten Kunden** (H24, H23, H22): Rollenwahl bei Einladung und in der Teilnehmerliste, Kurs zuweisen und entziehen auf der Teilnehmer-Detailseite, Rechtsträger-Felder im Portal und im Admin, Löschantrag-Inbox mit Löschpfad. Messbar: Josip legt einen Pilotmandanten mit Branding, Impressum, einem Kurs, fünf Lernenden und Zuweisungen in unter 30 Minuten ohne SQL an.
22. **Onboarding-Checkliste im Admin-Dashboard**: fünf Schritte mit Haken (Logo, Farben, erster Kurs, erste Einladung, Rechtsträger), sichtbar bis alle erledigt sind. Dazu „Kurs anlegen" mit automatisch angelegtem Modul und Sektion (M25), und die Attrappen aus M45 entfernen.
23. **Wissensarchiv ordnen.** `PHASENSTATUS.md` einfrieren (Archiv), eine neue `STATUS.md` mit zwei Seiten: Was läuft, was ist offen, wie deployt man, wo liegen welche Schlüssel (ohne Werte). `README.md` auf den Ist-Zustand bringen.

### 5.3 In 90 Tagen

24. **Drei Pilotkunden.** Ein Mandant pro Monat mit echtem Vertrag, echten Inhalten und echter Rechnung. Vorher Trial-Ablauf (`tenants.trial_ends_at`, Erinnerungsmail, Sperre) und eine Preisseite. Die Abrechnung der Mandantenpakete zunächst manuell über Stripe Invoicing, erst bei zehn Mandanten automatisieren.
25. **Barrierefreiheit belegen.** axe-core in der Playwright-Suite für Login, Dashboard, Lernansicht, Kurs-Editor; die Befunde mit Josip als Betroffenem priorisieren. Das Barrierefreiheitsstärkungsgesetz gilt seit 28.06.2025 für B2C-Dienste; die Lernansicht auf `salestalent.app` fällt darunter, sobald Endkunden dort kaufen.
26. **Performance messen statt annehmen.** Lighthouse auf Login, Kurskatalog und Lektionsseite; Mandanten-Auflösung cachen (M7); Lektionsseite schlank laden (M24). Ziel laut CLAUDE.md §3.3: mobil ≥ 90.
27. **Kurs-Generator für DOCX und PPTX**, weil das die Inhalte der Zielgruppe sind. Ein Workers-tauglicher OOXML-Parser (`jszip` plus XML-Textextraktion) reicht für Text; Bilder später.
28. **Player vervollständigen** (M21): Wiederaufnahme, Kapitel, Tempo. Das ist der Teil, den Lernende täglich sehen.
29. **Mandanten-Selbstverwaltung im Portal**: Domain-Verknüpfung mit Cloudflare for SaaS per API statt Hand, Nutzungsübersicht (KI-Kosten je Mandant aus `ai_jobs`), Rechnungsliste.
30. **DSGVO-Paket zu Ende bauen** (H22, H23, M13, M47, M48): vollständige Exporte über alle Tabellen mit `tenant_id`, Audit-Log-Schreiber in allen Admin- und Portal-Aktionen, Aufbewahrungsfristen (`rate_limits` 30 Tage, `webhook_deliveries` 90 Tage, Zeiterfassung 2 Jahre gesperrt), MFA und Papierkorb im Portal, Datenschutzerklärung nachziehen. Messbar: ein Löschantrag wird automatisiert innerhalb der Frist erfüllt.
31. **Benachrichtigungen, die Nutzung auslösen** (M46): Mails bei Kurs-Zuweisung, neuer Abgabe, Bewertung, Zertifikat, Kontingent 80 %, Planänderung; Bounce-Webhook; Reply-To je Mandant. Erst danach Glocke und Push aus derselben Ereignisquelle.

### 5.4 Einfrieren oder streichen

1. **Marketplace einfrieren**, bis der erste Mandant eigene kostenpflichtige Kurse verkauft. 0 Listings, offene Steuerfrage (Merchant of Record, SPEC §9.4), Käufer-Selbstregistrierung ungeklärt. Der Code bleibt, der Schalter bleibt aus.
2. **Schichtplan als getrenntes Produkt betrachten.** Er teilt mit dem LMS nur Auth und Mandanten. Entweder er bekommt eigene Vertriebsziele und eine eigene Roadmap, oder er wird nach Block S6 eingefroren. Beides ist vertretbar; parallel weiterzubauen, während der LMS-Kern ungenutzt ist, ist es nicht.
3. **Dritte und vierte Sprache** nicht vor dem ersten Kunden erweitern. Die Parität de/en/bs ist vollständig; jede weitere Funktion kostet drei Übersetzungen.
4. **Kunden-Area, Web-Push und PWA-Ausbau einfrieren.** Kein Prüfbereich hat die Kunden-Area als nötig für den ersten Kunden identifiziert; Push hat 0 Abonnements und ist auf Workers nie verifiziert. Ereignisse zuerst per Mail.
5. **Marketing-Skills-Branch nicht ins Produkt-Repo mergen.** 483 Dateien unter `.claude/tools` gehören in ein eigenes Repo, nicht in den Deploy-Pfad der Plattform.
6. **Kein weiterer Funktionsbereich** (Kommentare, Gamification, Lernpfade, SSO), bevor Position 20 erreicht ist.

---

## 6. Entscheidungen, die nur Josip treffen kann

1. **Zielkunde der nächsten 30 Tage.** Entweder ein B2B-Mandant mit eigenen Mitarbeitenden (interne Akademie, CSV-Import, „alle Kurse für alle") oder ein Kursverkäufer mit Endkunden (Einschreibungs-Gating, Stripe, Widerruf, Rechnung). Die Antwort bestimmt, ob Position 14 (Einschreibungs-Gating) oder Position 21 (Self-Service) zuerst kommt.
2. **Standardverhalten Kurszugriff.** „Alle veröffentlichten Kurse für alle Mitglieder" (heute) als Mandanten-Schalter behalten, oder Einschreibung als Standard; betrifft alle bestehenden Mandanten.
3. **Laufende Kosten.** Supabase Pro (25 USD/Monat: Backups, Session-Timeouts, keine Pausierung) und Cloudflare Workers Paid (5 USD/Monat: Build-Größe, Logs) freigeben, oder Backups per eigenem Cron lösen.
4. **Sprachen, die verkauft werden.** Nur Deutsch, Deutsch und Englisch, oder auch Bosnisch; bei Bosnisch sind eine inhaltliche Prüfung von `messages/bs.json` und die Lokalisierung von Admin, Editor und Zertifikat fällig.
5. Marketing-Skills-Branch mergen oder schließen (483 Dateien im Repo).
6. Supabase Pro (25 USD/Monat) für Backups und Session-Timeouts, oder eigener `pg_dump`-Cron.
7. Stripe: nur Kartenzahlung zulassen oder asynchrone Zahlarten korrekt behandeln (H5).
8. Schichtplan: eigenes Produkt oder Einfrieren nach S6.
9. Marketplace: Einfrieren bis zur steuerlichen Klärung des Merchant-of-Record-Modells.
10. Vertreter in der Union nach Art. 27 DSGVO benennen (offen seit 24.08.).
11. Anwaltliche Prüfung der AGB, Datenschutz und AVV vor dem ersten echten Kauf.
12. Trainer-Rolle: SPEC §2 durchsetzen (H8) oder SPEC an das heutige, weitere Rechtebild anpassen.
13. `login_copyright` für SalesTalent, Selbstregistrierung für Marketplace-Käufer (beides seit August offen).

---

## 7. Vorgehen und Grenzen dieser Analyse

1. **Ablauf.** Am 08.09.2026 ab 16:12 UTC: Repo geklont, Abhängigkeiten installiert, Baseline (tsc, ESLint, Vitest) gefahren, Live-Datenbank und Cloudflare per MCP abgefragt, die drei ungemergten Branches gelesen. Danach ein Agenten-Lauf mit 14 geplanten Fachbereichen, je einem lesenden Prüf-Agenten und einem Gegenprüfer, einem Vollständigkeits-Kritiker und einem Strategie-Panel.
2. **Was tatsächlich lief.** Der Lauf wurde dreimal vom Nutzungslimit der Sitzung unterbrochen (Reset 20:50 UTC und 01:50 UTC). Durchgelaufen sind 11 Bereichs-Prüfer mit zusammen 217 Funden sowie eine abschließende Synthese, deren Roadmap ich mit meiner eigenen abgeglichen und in die Abschnitte 5 und 6 eingearbeitet habe (übernommen: Portal-Status, Self-Service, DSGVO-Paket, Attrappen, Einfrier-Liste, Zielkunden-Entscheidung). Die drei Bereiche Toolchain/Betrieb, Performance und Datenmodell habe ich ohne Agenten selbst geprüft; ihre Befunde stehen in den Abschnitten 2, 4.2 und 3.3 (M11). Die automatische Gegenprüfung ist ausgefallen. Ersatzweise habe ich alle kritischen und hohen Befunde aus den Bereichen RLS, Auth, API und Kurse selbst am Code nachvollzogen, ebenso H11, H12, H16, H18, H20, H21, H22, M26, M49 und die Kontrastwerte. Befunde ohne diesen Vermerk stammen aus der Agenten-Prüfung mit Beleg (Datei und Zeile), sind aber nicht unabhängig bestätigt; Anhang A führt sie vollständig.
3. **Nicht geprüft.** Playwright-Suite (keine `.env`, kein Dev-Server), Lighthouse und LCP, ein echter Stripe-Testkauf, Bunny-Upload und Transkription, Deploy-Ablauf, die Word-Dokumente (AVV, TOM), der Website-Branch im Repo `calltalent-website`, die Inhalte von `messages/bs.json` über Stichproben hinaus.
4. **Live-Zugriff.** Nur lesend: Advisor, Migrationsliste, Zeilenzahlen, Mandantenliste, Muster der Auth-Konten. Es wurde nichts in Supabase, Cloudflare oder im Repo `main` verändert.
5. **Vorarbeit.** Der Ruflo-Bericht vom 07.09. (Branch `claude/ruflo-swarm-hierarchical-0trzqy`, PHASENSTATUS-Abschnitt „Projektrevision 07.09.2026") war Ausgangspunkt; seine 18 offenen Code-Punkte und 15 Punkte für Josip gelten weiter und sind hier nicht wiederholt, außer wo sich Schwere oder Lösung geändert hat.

---

## Anhang A: Alle Funde der Bereichs-Prüfer

217 Funde aus 11 Bereichen, sortiert nach Schwere: kritisch 3, hoch 44, mittel 107, niedrig 63. Status: neu = in diesem Lauf erstmals belegt; bekannt = stand im Ruflo-Bericht vom 07.09.; Branch = auf einem ungemergten Branch behoben. Die Funde der Bereiche Quiz, Zahlungen, Schichtplan, KI, Barrierefreiheit, Produkt und Portal sind nicht gegengeprüft, außer wo Abschnitt 3 ausdrücklich eine eigene Prüfung nennt.

| Bereich | Schwere | Art | Status | Fundstelle | Titel |
|---|---|---|---|---|---|
| RLS | kritisch | bug | neu | `src/app/api/stripe/webhook/route.ts:175` | Stripe-Kauf im Mandanten-Storefront ohne bestehende Mitgliedschaft: Käufer zahlt, bekommt aber keinen Zugriff |
| RLS | kritisch | bug | neu | `supabase/migrations/0001_init.sql:442` | `tenants_admin_update` ohne Spaltenbeschränkung: Mandanten-Admin kann plan/status/custom_domain/slug und Betreiber-Schalter (inkl. eigener Provision) selbst setzen, fremde Subdomains lahmlegen |
| Zahlungen | kritisch | bug | neu | `src/app/api/stripe/webhook/route.ts:229` | Käufer ohne Mitgliedschaft (Selbstregistrierung über /kaufen) erhält nach Zahlung keinen Kurszugriff |
| API | hoch | bug | neu | `src/app/api/stripe/webhook/route.ts:64` | Stripe: checkout.session.completed wird ohne payment_status-Prüfung erfüllt; Async-Zahlungen (SEPA, Klarna, Überweisung) nicht behandelt |
| API | hoch | gap | neu | `custom-worker.ts:70` | Webhook-Wiederholungen finden nie statt: Cron ruft nur /api/admin/ki/process, nie /api/admin/webhooks/retry |
| API | hoch | risk | neu | `src/lib/progress/actions.ts:46` | Fire-and-forget ohne after()/waitUntil: ausgehende Webhooks und Push können auf Cloudflare Workers nach dem Response abgebrochen werden |
| Auth | hoch | bug | neu | `src/lib/auth/actions.ts:182` | Selbstregistrierung legt keine Mitgliedschaft an: Nutzer landen in leerem Dashboard, Admin sieht sie nie |
| Auth | hoch | gap | neu | `src/lib/auth/actions.ts:94` | Login und Lernbereich prüfen keine Mitgliedschaft/Status im aktuellen Mandanten |
| Auth | hoch | risk | neu | `src/app/auth/callback/page.tsx:141` | Session-Cookies sind nicht httpOnly und 400 Tage gültig: CLAUDE.md §2.13 beschreibt ein Verhalten, das @supabase/ssr nicht hat |
| Auth | hoch | gap | bekannt | `src/middleware.ts:206` | Session-Ablauf (§2.8) weiterhin unkonfiguriert: Cookie 400 Tage, Refresh-Token ohne Ablauf, keine Code-Kompensation |
| Auth | hoch | risk | Branch | `src/middleware.ts:51` | Drei Auth-Sicherheitsfixes liegen nur auf dem ungemergten ruflo-Branch (Header-Spoofing, Logout-CSRF, Einladungs-Rate-Limit) |
| KI | hoch | bug | Branch | `src/lib/generator/apply.ts:193` | Doppelklick auf 'Entwurf übernehmen' legt den Kurs zweimal an (appliedCourseId-Marker wird nie geschrieben) |
| KI | hoch | risk | neu | `src/lib/generator/process.ts:30` | Stale-Running-Fenster (3 Min) kürzer als maximale Schrittdauer und kein Versuchszähler: Doppelverarbeitung und potenziell endlose kostenpflichtige Wiederholung |
| KI | hoch | risk | neu | `src/lib/video/transcript.ts:118` | Kein Kostendeckel für nicht-kontingentierte KI-Posten (Bunny-Transkription 0,10 $/Min, Haiku-Übersetzung, Zusammenfassung, Embeddings) |
| Kurse | hoch | bug | neu | `src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx:88` | Lektionsreihenfolge in der Lernansicht falsch bei mehreren Sektionen pro Modul (Positionen sektionsweit, Sortierung modulweit) |
| Kurse | hoch | gap | neu | `supabase/migrations/0001_init.sql:465` | Kein Einschreibungs-Gating: jedes aktive Mitglied sieht und absolviert jeden veröffentlichten Kurs des Mandanten |
| Portal | hoch | bug | neu | `src/lib/tenant/resolve.ts:137` | Portal-Status „Trial“ schaltet die Akademie ab; „Gesperrt“ zeigt Dev-Hinweis statt Sperrseite; API-Keys gesperrter Mandanten laufen weiter |
| Portal | hoch | gap | neu | `src/app/profil/actions.ts:63` | Art. 17: Löschanträge werden nie bearbeitet: es existiert im gesamten Code kein Pfad, der ein Nutzerkonto löscht |
| Portal | hoch | gap | neu | `supabase/migrations/0001_init.sql:19` | Keine Abrechnung der Mandanten: kein Trial-Ablauf, keine Rechnungsdaten, kein Abo je Mandant (149/249 €) |
| Portal | hoch | gap | neu | `src/app/portal/mandanten/[id]/export/route.ts:102` | Beide DSGVO-Exporte unvollständig: Mandanten-Export ohne 22 tenant_id-Tabellen (u. a. alle calendar_*), Selbst-Export ohne Lesezeichen/Push/Löschanträge |
| Portal | hoch | risk | neu | `src/app/(legal)/layout.tsx:38` | Neue Mandanten haben kein Impressum/Datenschutz (404): tenants.legal.entity ist weder im Portal noch im Admin pflegbar |
| Produkt | hoch | gap | neu | `src/app/(admin)/admin/einstellungen/page.tsx:23` | Kein Self-Service für Branding, Tutor-Schalter und Domain im Mandanten-Admin: `/admin/design` aus SPEC §4.2 existiert nicht |
| Produkt | hoch | gap | neu | `src/lib/users/import.ts:313` | Keine Rollenverwaltung in der Oberfläche: Einladung/Import erzeugen immer `member`, kein Weg zu admin/trainer |
| Produkt | hoch | improvement | neu | `src/app/(admin)/admin/page.tsx:273` | Kein geführter Erststart: leere Mandanten ohne Onboarding-Checkliste, Demo-Kurs oder CTA: nach zwei Monaten 0 Kurse in der Live-DB |
| Quiz | hoch | bug | neu | `supabase/migrations/20260907091500_quiz_attempt_limit_rpc.sql:65` | Ruflo-Branch: RPC submit_quiz_attempt sperrt Marketplace-Gäste vom Quiz aus (Regression) |
| Quiz | hoch | bug | neu | `src/lib/reporting/queries.ts:299` | Reporting zählt nur Einschreibungen, Lernzugang ist aber nicht einschreibungsgebunden – Lernende fehlen im Bericht |
| RLS | hoch | gap | neu | `supabase/migrations/0001_init.sql:465` | Einschreibungen steuern für reguläre Mitglieder keinen Zugriff: jedes Mitglied sieht alle veröffentlichten Kurse, Abo-Kündigung entzieht nichts |
| RLS | hoch | bug | neu | `supabase/migrations/20260907091500_quiz_attempt_limit_rpc.sql:65` | Regression auf dem Ruflo-Branch (live angewendet): `submit_quiz_attempt` sperrt Marketplace-Gäste vom Quiz aus |
| RLS | hoch | bug | neu | `supabase/migrations/0001_init.sql:511` | Lernende können Prüfungsergebnis (`attempts.passed/score_pct`) und Abgabe-Bewertung (`submissions.status/grade/reviewed_by`) per RLS selbst schreiben |
| RLS | hoch | gap | neu | `supabase/migrations/20260712234600_rls_consolidate_part_b.sql:51` | Trainer-Rechte weit über SPEC §2 hinaus: Produkte/Preise anlegen, Bestellungen lesen, Einschreibungen verwalten, Kurse löschen, Marketplace-Listings einreichen |
| RLS | hoch | gap | bekannt | `supabase/migrations/20260712234600_rls_consolidate_part_b.sql:127` | `progress_own_insert/update` ohne Mandanten-, Lektions- und Einschreibungsbindung: Basis für Selbst-Zertifizierung und Cross-Tenant-Reporting-Verschmutzung |
| Schichtplan | hoch | risk | neu | `supabase/migrations/20260807142619_shift_calendar.sql:348` | Arbeiter/Mitgliedschaft löschen vernichtet Zeiterfassung per FK-Cascade (§ 16 Abs. 2 ArbZG, 2 Jahre Aufbewahrung) |
| Schichtplan | hoch | gap | neu | `src/lib/calendar/queries.ts:128` | Keine Admin-Ansicht, Korrektur, Genehmigung oder Export der Zeiterfassung: Ist-Zeiten sind für niemanden sichtbar |
| Schichtplan | hoch | risk | neu | `src/components/learn/time-clock-widget.tsx:61` | Vergessene Ausstempelung: kein Auto-Close, keine Maximaldauer, Widget zeigt nur Uhrzeit ohne Datum |
| Zahlungen | hoch | bug | neu | `src/app/api/stripe/webhook/route.ts:146` | Webhook ignoriert payment_status: Zugriff und orders.status='paid' vor Zahlungseingang bei verzögerten Zahlarten |
| Zahlungen | hoch | bug | neu | `src/app/api/stripe/webhook/route.ts:64` | Keine Verarbeitung von Rückerstattungen und Disputes: Status, Ledger und Zugriff bleiben unverändert |
| Zahlungen | hoch | bug | neu | `src/lib/marketplace/actions.ts:275` | Marketplace: Preisänderung eines Listings nach Stripe-Produktanlage wird nicht synchronisiert – Anzeigepreis ≠ Abbuchung |
| Zahlungen | hoch | gap | bekannt | `src/lib/stripe/checkout.ts:122` | Keine Rechnungsstellung und keine Steuerberechnung im Checkout trotz Merchant-of-Record-Modell |
| Zahlungen | hoch | gap | neu | `src/lib/stripe/portal.ts:231` | Stripe-Kundenportal ist nirgends erreichbar – Abo-Kunden können nicht kündigen (kein Kündigungsbutton §312k BGB) |
| Zahlungen | hoch | risk | neu | `src/app/api/stripe/webhook/route.ts:389` | Abo-Ende oder Zahlungsausfall entzieht keinen Kurszugriff – Ein-Monats-Zahlung ergibt dauerhaften Zugang |
| Zahlungen | hoch | gap | neu | `supabase/migrations/0001_init.sql:465` | Bezahlte Produkte gewähren Mitgliedern nichts Exklusives: RLS erlaubt jedem aktiven Mitglied alle veröffentlichten Kurse ohne Einschreibung |
| Zahlungen | hoch | risk | neu | `src/lib/stripe/checkout.ts:122` | Widerrufsverzicht nach §356 Abs. 5 BGB wird nicht eingeholt; Marketplace-AGB behaupten, der Kauf sei noch nicht freigeschaltet |
| Zahlungen | hoch | gap | bekannt | `src/app/marketplace/kurs/[slug]/page.tsx:119` | Marketplace-Selbstregistrierung fehlt – 'erwerbbar für jeden' ist nicht einlösbar, Kaufbutton endet in einer Mail an office@ |
| i18n/A11y | hoch | bug | neu | `src/components/layout/topbar-menus.tsx:289` | Abmelden in der Lernansicht nur per Zeiger, nicht per Tastatur/Screenreader |
| i18n/A11y | hoch | gap | neu | `src/components/admin/admin-shell.tsx:62` | Kein Skip-Link, Admin-Bereich ohne <main>-Landmark, zwei h1 je Admin-Seite |
| i18n/A11y | hoch | bug | neu | `src/app/globals.css:1` | Fokusring 1,78:1 statt 3:1, `focus:outline-none` ohne Ersatz im Kontrastmodus, `focus:` statt `focus-visible:` |
| i18n/A11y | hoch | bug | bekannt | `src/app/globals.css:55` | Kontrast der Marken-Tokens für Sekundärtext, Sidebar-Gruppentitel und Eingabefeld-Rahmen unter WCAG AA: sitesweit, Marketplace |
| API | mittel | bug | neu | `src/app/api/v1/users/route.ts:121` | POST /api/v1/users legt Nutzer ohne Willkommens-/Zugangsmail an; per Zapier angelegte Personen können sich nicht anmelden |
| API | mittel | risk | neu | `src/app/api/bunny/webhook/route.ts:92` | Bunny-Webhook Status 3 startet kostenpflichtige Transkription für jedes Video ohne Lektions-/Mandantenbezug, Sprache fest auf 'de' |
| API | mittel | risk | neu | `src/app/portal/mandanten/[id]/export/route.ts:123` | Portal-Mandantenexport gibt Webhook-Secrets im Klartext und API-Key-Hashes aus |
| API | mittel | gap | neu | `-:-` | Keine API-/Webhook-Dokumentation (Zapier/Make-Doku laut SPEC §3 Should fehlt vollständig) |
| API | mittel | gap | neu | `src/components/admin/webhooks-panel.tsx:6` | Kein Zustellprotokoll und kein Test-Ereignis für Webhooks im Admin |
| API | mittel | bug | bekannt | `src/app/api/stripe/webhook/route.ts:195` | Stripe: sendOrderPaidMail nicht idempotent, isNewOrder-Prüfung mit Race bei paralleler Zustellung |
| API | mittel | improvement | neu | `src/app/api/stripe/webhook/route.ts:389` | Abo-Kündigung und past_due entziehen keinen Zugriff; enrollments.expires_at wird nie gesetzt und in der Lernansicht nicht geprüft |
| Auth | mittel | bug | neu | `src/lib/marketplace/redirect.ts:21` | Open-Redirect-Prüfung resolveSafeNextParam ist mit Backslash umgehbar: betrifft Marketplace-Login (main) und den ruflo-Callback-Fix |
| Auth | mittel | gap | neu | `src/lib/auth/actions.ts:252` | Bot-Schutz §2.7: Registrierung, Magic-Link und Passwort-Reset nur mit IP-Rate-Limit, kein CAPTCHA/Honeypot: Turnstile liegt fertig auf dem Contact-Branch |
| Auth | mittel | risk | neu | `src/lib/auth/actions.ts:429` | Neues Passwort ohne Re-Authentifizierung: /passwort-setzen akzeptiert jede angemeldete Session, keine Info-Mail, keine Abmeldung anderer Geräte |
| Auth | mittel | risk | neu | `src/lib/tenant/routing.ts:122` | Wartungsmodus sperrt Impressum, Datenschutz, AGB, Kontakt und Rechtsseiten mit 503 |
| Auth | mittel | bug | bekannt | `src/lib/auth/actions.ts:272` | Magic-Link und Passwort-Reset auf Portal-/Marketplace-Host springen auf die Site-URL: NEXT_PUBLIC_SITE_URL ist unvalidiert und im Prod-Setup unbekannt |
| Auth | mittel | improvement | neu | `src/app/auth/callback/page.tsx:126` | E-Mail-Links auf token_hash + serverseitiges verifyOtp umstellen: löst Redirect-Allowlist, Portal-Magic-Link, Fragment-Tokens und httpOnly auf einmal |
| Auth | mittel | gap | neu | `src/lib/auth/actions.ts:1` | Keine automatisierten Tests für Auth-Actions, Account-Actions und Security-Helfer; E2E-Auth-Suite besteht aus einem Render-Test |
| Auth | mittel | risk | neu | `src/lib/auth/actions.ts:191` | Registrierung verrät bestehende Konten („existiert bereits"): Verstoß gegen §2.15 Enumeration |
| Auth | mittel | gap | neu | `src/lib/account/actions.ts:88` | lib/account/actions.ts ohne zod-Validierung (§2.3), changeEmail reicht rohes error.message an die Oberfläche |
| Auth | mittel | improvement | neu | `src/middleware.ts:72` | Middleware macht pro Request 1-3 service_role-Queries plus Auth-Roundtrip: auch für Webhooks, Cron, /api/v1 und unbekannte Hosts, ohne Cache |
| KI | mittel | bug | neu | `src/lib/tutor/actions.ts:182` | Kontingent wird auch bei fehlgeschlagenem KI-Aufruf verbraucht (Voyage-/Anthropic-Ausfall, Parse-Fehler) |
| KI | mittel | bug | neu | `src/lib/tutor/actions.ts:212` | Tutor sendet keinen Gesprächsverlauf an Claude; Datenschutzerklärung behauptet das Gegenteil; Verlauf geht bei Reload verloren |
| KI | mittel | risk | neu | `supabase/migrations/20260711164838_match_embeddings.sql:61` | Kein Ähnlichkeits-Schwellenwert im RAG: Off-Topic-Erkennung hängt allein am Prompt, Quellen werden auch bei 'Das steht nicht im Kurs' angezeigt |
| KI | mittel | improvement | neu | `src/lib/ai/config.ts:10` | Modell-IDs zwei Generationen alt, Preis-Konstante laut eigenem Kommentar seit 31.08.2026 abgelaufen, SDK veraltet |
| KI | mittel | improvement | neu | `src/lib/generator/process.ts:46` | Cron verarbeitet mandantenübergreifend nur EINEN Job-Schritt je 2 Minuten: Kursentwurf braucht mindestens 6 Min., bei Parallelbetrieb Stunden |
| KI | mittel | gap | neu | `src/lib/ai/actions.ts:10` | Embeddings entstehen nur per manuellem Knopf, nie beim Veröffentlichen; Video-Transkripte werden nie eingebettet (Tutor/Suche blind für Videokurse) |
| KI | mittel | gap | neu | `src/app/(learn)/suche/page.tsx:21` | Semantische Suche /suche ist in keiner Navigation verlinkt |
| KI | mittel | gap | neu | `src/lib/ai/usage.ts:154` | Eigenständiger Quiz-Generator (SPEC §6, ai_jobs.kind='quiz_gen') fehlt vollständig |
| KI | mittel | gap | neu | `src/app/api/admin/ki/generate/route.ts:61` | Kurs-Generator akzeptiert nur eine Datei je Auftrag und kürzt still auf 60.000 Zeichen (Hinweis geht verloren) |
| KI | mittel | improvement | neu | `src/lib/ai/config.ts:63` | Zusatzkontingent (SPEC: 29 €/1.000) und Vorwarnung bei Erschöpfung fehlen: Tutor schaltet hart ab, kein Upsell-Pfad |
| KI | mittel | bug | Branch | `src/lib/generator/process.ts:59` | CAS-Sperre der drei Job-Prozessoren wirkungslos: überlappende Cron-Aufrufe starten denselben Claude-Schritt doppelt |
| Kurse | mittel | gap | neu | `src/components/admin/module-lesson-tree.tsx:389` | Lektionen lassen sich nicht umsortieren oder in eine andere Sektion verschieben; kein Drag & Drop (SPEC 4.2) |
| Kurse | mittel | gap | neu | `src/lib/progress/actions.ts:33` | Fortschritt ist reine Selbstauskunft: keine Video-Mindestansicht, keine Reihenfolge-Erzwingung, kein Drip-Content |
| Kurse | mittel | gap | neu | `src/components/player/bunny-player.tsx:82` | Player ohne Wiederaufnahme-Position, ohne klickbare Kapitel, ohne Autoplay-/Tempo-Steuerung; progress 'started' wird nie geschrieben |
| Kurse | mittel | risk | bekannt | `src/lib/progress/actions.ts:33` | completeLesson übernimmt lessonId/courseSlug ungeprüft (kein Mandanten-, Kurs- oder Status-Check) |
| Kurse | mittel | risk | bekannt | `src/lib/courses/actions.ts:843` | Bunny-Videos werden beim Löschen von Lektion/Modul/Kurs/Block und beim Video-Austausch nie gelöscht |
| Kurse | mittel | bug | neu | `src/components/editor/block-editor.tsx:96` | Autosave verliert Änderungen bei Navigation innerhalb des 1-s-Debounce; keine Serialisierung paralleler Speicherungen, kein Konfliktschutz |
| Kurse | mittel | risk | neu | `src/components/learn/block-renderer.tsx:222` | Einbettungs-Block rendert beliebige iframe-URLs ohne sandbox/Allowlist; Bild/Audio/Datei/Embed erlauben http:-URLs |
| Kurse | mittel | improvement | neu | `src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx:84` | Lektionsseite lädt bei jedem Aufruf alle Lektionen des Kurses inklusive blocks, transcript und summary |
| Kurse | mittel | improvement | neu | `src/lib/courses/actions.ts:799` | Pflicht-Hierarchie Kurs -> Modul -> Sektion -> Lektion verletzt die 3-Klick-Regel; keine sinnvollen Standardwerte |
| Kurse | mittel | gap | neu | `src/components/admin/course-editor-steps.tsx:96` | Keine Vorschau im Kurs-Editor; Entwurfs-Lektionen sind für Staff nirgends als Lernender ansehbar (SPEC 4.2) |
| Kurse | mittel | improvement | neu | `src/lib/courses/actions.ts:51` | Kein Kurs-Duplizieren, keine Kursvorlagen, kein Kurs-Export (nur Import) |
| Portal | mittel | bug | neu | `src/lib/users/import.ts:105` | CSV-Import: Willkommensmails aller Zeilen gleichzeitig: scheitert am Resend-Limit, unsichtbar in der UI; DoD-Messung 100 < 30 s veraltet |
| Portal | mittel | bug | neu | `src/lib/account/actions.ts:105` | Benachrichtigungs-Einstellungen sind Attrappen: notification_prefs wird von keinem Mailpfad gelesen, fünf der sechs Toggles beschreiben Mails, die es nicht gibt |
| Portal | mittel | gap | neu | `src/lib/submissions/actions.ts:214` | Fehlende Ereignis-Mails gegenüber SPEC „E-Mail-Benachrichtigungen“: keine Mail bei neuer Abgabe an Trainer, bei Kurs-Zuweisung, Löschantrag, Kontingent-Ende, Trial-Ablauf |
| Portal | mittel | risk | neu | `src/lib/email/client.ts:73` | Kein Bounce-/Complaint-Handling: harte Bounces werden unbegrenzt weiter angeschrieben, Domain-Reputation von calltalent.ai für alle Mandanten gefährdet |
| Portal | mittel | improvement | neu | `src/lib/email/client.ts:31` | Absender fest noreply@calltalent.ai, kein Reply-To: Antworten auf Kontaktanfragen und Systemmails laufen ins Leere; kein White-Label-Versand |
| Portal | mittel | gap | neu | `src/app/(admin)/admin/teilnehmer/[id]/page.tsx:108` | Nutzerverwaltung unter SPEC §4.2: kein Rollenwechsel, keine Kurs-Zuweisung für bestehende Nutzer, kein Fortschritts-Popup, keine Gruppen in der Liste |
| Portal | mittel | gap | neu | `supabase/migrations/0001_init.sql:384` | audit_log wird nirgends geschrieben: sicherheitsrelevante Aktionen hinterlassen keine Spur |
| Portal | mittel | risk | neu | `src/app/(legal)/privacy/page.tsx:22` | Datenschutzerklärung deckt reale Verarbeitung nicht ab: Schichtplan/Zeiterfassung (Art. 9), Web-Push, Bunny-Transkription, KI-Planung/Generator-Uploads fehlen; kein Art.-27-Vertreter-Abschnitt |
| Portal | mittel | bug | neu | `src/lib/account/actions.ts:98` | changeEmail() ohne zod/Rate-Limit und mit rohem Supabase-Fehlertext (Enumeration); updateProfile() ohne Längenlimits |
| Portal | mittel | risk | neu | `src/lib/platform/auth.ts:35` | Betreiber-Portal ohne MFA, ohne Admin-Verwaltung und ohne Papierkorb: ein kompromittiertes Platform-Admin-Konto löscht alle Mandanten endgültig |
| Portal | mittel | gap | neu | `src/app/portal/mandanten/[id]/mandant-edit-form.tsx:130` | „Mandant in 5 Minuten“ ist nur die Datenbankzeile: Custom Domain/SSL, Supabase-Redirect-URLs und Rechtsträger bleiben Handarbeit; keine Onboarding-Checkliste |
| Produkt | mittel | gap | neu | `supabase/migrations/0001_init.sql:93` | Drip-Content (zeitgesteuerte Freischaltung, SPEC §3 Should) ist nicht umgesetzt |
| Produkt | mittel | gap | neu | `supabase/migrations/0001_init.sql:465` | Keine Kurs-Zuweisung je Nutzer: jedes Mitglied sieht alle veröffentlichten Kurse, Einschreibung nur beim Einladen/Kauf/API |
| Produkt | mittel | gap | neu | `src/components/layout/Sidebar.tsx:308` | Semantische Suche ist für Lernende unerreichbar; der Sidebar-Button „Suchen …" klappt nur die Sidebar ein |
| Produkt | mittel | gap | neu | `src/components/learn/app-shell.tsx:166` | Benachrichtigungszentrale ist eine Attrappe (immer leer), Web-Push feuert nur bei einem Ereignis, live 0 Abos |
| Produkt | mittel | gap | neu | `src/lib/import/course-import.ts:29` | Migrations-Importer entspricht nicht CLAUDE.md §6.4 („CSV + Video-Reupload") und ist ohne Format-Doku/Beispieldatei für Kunden unbenutzbar |
| Produkt | mittel | gap | neu | `src/components/admin/api-keys-panel.tsx:1` | Zapier/Make-Dokumentation (SPEC §3 Should) und jede API-/Webhook-Doku fehlen: live 0 API-Keys, 0 Webhooks |
| Produkt | mittel | risk | bekannt | `PHASENSTATUS.md:760` | DoD-Kriterien aus SPEC §8 sind teils nie gemessen, teils veraltet belegt (Tutor 10+2, 3 PDFs < 10 Min, Domain < 5 Min, Lighthouse, Stripe-E2E) |
| Produkt | mittel | improvement | neu | `src/lib/ai/config.ts:69` | Kein Trial-/Abrechnungsmodell je Mandant, keine Self-Service-Anlage; Enterprise unterscheidet sich technisch nur im KI-Kontingent |
| Produkt | mittel | improvement | neu | `src/lib/courses/actions.ts:1` | Kurs duplizieren, Kursvorlagen und „Kurs in Kundenmandant kopieren" fehlen: kein Weg, Calltalent-Inhalte an Kunden zu verteilen |
| Produkt | mittel | gap | bekannt | `src/lib/marketplace/fulfil.ts:99` | Marketplace-Selbstregistrierung fehlt: der einzige öffentliche Akquise-Kanal endet für Neukunden bei einer E-Mail an office@ |
| Produkt | mittel | risk | neu | `playwright.config.ts:50` | E2E- und manuelle Testläufe schreiben in die Produktions-Datenbank; 104 synthetische Testkonten liegen live |
| Quiz | mittel | bug | neu | `src/app/(admin)/admin/page.tsx:62` | Admin-Dashboard lädt progress/enrollments/memberships ohne Paginierung – KPIs ab 1000 Zeilen falsch |
| Quiz | mittel | gap | neu | `src/app/(admin)/admin/page.tsx:187` | Dashboard-KPIs weichen von SPEC §4.2 ab: keine „aktive Lernende 30 T.“, Abschlussquote anders definiert als im Reporting |
| Quiz | mittel | gap | neu | `src/app/(admin)/admin/page.tsx:156` | Admin-Dashboard ohne i18n – alle Texte hartkodiert Deutsch (Verstoß CLAUDE.md §3.5) |
| Quiz | mittel | gap | neu | `src/lib/quiz/actions.ts:262` | Quiz-Zeitlimit wird serverseitig nicht durchgesetzt (nur Countdown-Anzeige) |
| Quiz | mittel | gap | neu | `src/lib/quiz/grade.ts:266` | Freitext-Fragen (kind='open') werden gespeichert, aber nie angezeigt oder bewertet |
| Quiz | mittel | gap | neu | `src/lib/quiz/actions.ts:404` | Kein Ergebnis-Feedback je Frage und kein persistiertes Ergebnis für den Lernenden |
| Quiz | mittel | gap | neu | `src/lib/certificates/issue.ts:26` | kind='exam' hat keine Wirkung: Quiz-Ergebnis gated weder Lektionsabschluss noch Zertifikat |
| Quiz | mittel | gap | neu | `src/components/learn/submission-form.tsx:82` | Abgaben: Status „Überarbeitung nötig“ ist eine Sackgasse – kein Wiedereinreichen möglich |
| Quiz | mittel | gap | neu | `src/lib/submissions/actions.ts:88` | Keine Benachrichtigung an Trainer/Admin bei neuer Abgabe |
| Quiz | mittel | gap | neu | `src/app/profil/page.tsx:1` | Zertifikate fehlen im Profil (SPEC §4.1) – nur auf der Kursseite sichtbar |
| Quiz | mittel | improvement | neu | `src/lib/certificates/pdf.ts:361` | Zertifikat ohne Verifikations-URL/QR-Code – Echtheit nicht prüfbar |
| Quiz | mittel | gap | neu | `src/lib/certificates/pdf.ts:288` | Zertifikats-PDF ausschließlich Deutsch, obwohl Mandanten default_locale bs/en setzen können |
| Quiz | mittel | gap | neu | `src/lib/generator/pipeline.ts:173` | Kein eigenständiger KI-Quiz-Generator (SPEC §6) – nur 3–6 Einfachauswahl-Fragen innerhalb der Kursgenerierung |
| Quiz | mittel | gap | neu | `src/app/(admin)/admin/teilnehmer/[id]/page.tsx:328` | Teilnehmer-Detailseite ohne Fortschritt, Quiz-Ergebnisse, Abgaben, Zertifikate und ohne Kurs-Zuweisung |
| RLS | mittel | risk | bekannt | `supabase/migrations/20260803100000_marketplace_guest_role.sql:108` | 17 SECURITY-DEFINER-Funktionen für `anon` ausführbar: vier davon per explizitem Grant, per Default-Privilege |
| RLS | mittel | bug | neu | `supabase/migrations/20260710214020_0002_storage.sql:72` | Storage-Schreibpolicies `submissions_own_all`/`avatars_own_*` ohne Mandanten-/Mitgliedschaftsbindung und ohne Mengenbegrenzung |
| RLS | mittel | risk | neu | `supabase/migrations/20260710233735_security_hardening_storage_listing_and_products.sql:18` | `course-assets` ist ein öffentlicher Bucket, und jedes Mitglied darf den gesamten Mandantenordner listen: Dateien unveröffentlichter/kostenpflichtiger Kurse sind ohne Login abrufbar |
| RLS | mittel | gap | neu | `supabase/migrations/0001_init.sql:475` | Kern-Inhaltstabellen ohne Mandantenbindung ihrer Fremdschlüssel (modules/lessons/sections/quizzes/enrollments/attempts/submissions/bookmarks/tutor_conversations) |
| RLS | mittel | risk | neu | `supabase/migrations/20260712234600_rls_consolidate_part_b.sql:1` | Migrationshistorie im Repo weicht von der Live-Datenbank ab: `supabase db push` ist nicht verlässlich, RLS-Stand aus dem Repo nicht beweisbar |
| RLS | mittel | gap | neu | `e2e/global-setup.ts:1` | Keine automatisierten RLS-/Negativtests trotz 14 nachträglichen RLS-Sicherheitsfixes |
| RLS | mittel | gap | neu | `supabase/migrations/0001_init.sql:384` | `audit_log` existiert seit 0001, wird aber nirgends geschrieben: keine Nachvollziehbarkeit von Admin-/Betreiber-Aktionen |
| Schichtplan | mittel | risk | neu | `src/lib/calendar/schema.ts:581` | Arbeitszeitgesetz nur im KI-Prompt: Höchstarbeitszeit, 11 h Ruhezeit und Pausen werden serverseitig nirgends geprüft |
| Schichtplan | mittel | bug | neu | `supabase/migrations/20260807142619_shift_calendar.sql:718` | Arbeiter kann `ended_at` per Direktclient beliebig (auch in die Zukunft) setzen: Zeitbetrug über die API möglich |
| Schichtplan | mittel | bug | neu | `src/lib/calendar/actions.ts:432` | Deaktivierter Arbeiter (status='inactive') kann weiterhin ein- und ausstempeln |
| Schichtplan | mittel | gap | neu | `src/lib/calendar/actions.ts:599` | Keine Benachrichtigung bei Planänderungen durch Admin/KI (neue, verschobene, stornierte Schicht) |
| Schichtplan | mittel | gap | neu | `src/app/(portal)/schichtplan/page.tsx:82` | „Mein Schichtplan“ zeigt weder Ist-Zeiten noch Abwesenheiten/Feiertage: beide Queries existieren, werden aber nicht aufgerufen |
| Schichtplan | mittel | gap | neu | `src/components/learn/time-clock-widget.tsx:27` | Kein Stundenkonto/Soll-Ist, keine Pausen und Nachtstunden bei Zeiteinträgen, Stempel nie mit Schicht verknüpft |
| Schichtplan | mittel | gap | neu | `supabase/migrations/20260807142619_shift_calendar.sql:669` | Kein Urlaubs-/Krankmeldungs-Workflow für Arbeiter: Status `requested` existiert im Schema, ist aber unerreichbar |
| Schichtplan | mittel | gap | neu | `src/lib/calendar/actions.ts:599` | Admin-Schichtanlage und Freelancer-Selbstbuchung ignorieren Abwesenheiten und Feiertage |
| Schichtplan | mittel | risk | neu | `supabase/migrations/20260807142619_shift_calendar.sql:227` | Mehrmandantenfähigkeit eines Arbeiters: Überlappungs- und Stempelschutz gelten nur je Mandant, nicht je Person |
| Zahlungen | mittel | risk | neu | `src/lib/stripe/client.ts:184` | Test- und Live-Modus nicht getrennt: Produkte tragen Testmodus-Preis-IDs, Webhook prüft event.livemode nicht |
| Zahlungen | mittel | bug | bekannt | `src/app/api/stripe/webhook/route.ts:195` | sendOrderPaidMail() im regulären Webhook-Pfad ist nicht idempotent (Stripe-Retry zu doppelte Bestätigungsmail) |
| Zahlungen | mittel | bug | neu | `src/lib/stripe/checkout.ts:140` | Nach der Zahlung keine Bestätigung im Produkt: success_url '/?checkout=success' wird nirgends ausgewertet; Marketplace-Dankeseite behauptet Freischaltung vor Webhook |
| Zahlungen | mittel | bug | neu | `src/app/api/stripe/webhook/route.ts:153` | Regulärer Webhook-Pfad kehrt bei Fehlern still mit 200 zurück – bezahlter Kunde ohne Zugriff, kein Stripe-Retry |
| Zahlungen | mittel | gap | neu | `src/lib/platform/marketplace.ts:556` | Provisions-Ledger ohne Mandantensicht und ohne Storno; /admin/zahlungen zeigt Marketplace-Bestellungen als vollen Umsatz |
| Zahlungen | mittel | improvement | neu | `src/lib/stripe/checkout.ts:124` | Keine Rabattcodes, keine Kurs-Bundles, keine Team-/Firmenlizenzen |
| Zahlungen | mittel | improvement | neu | `src/app/(admin)/admin/marketplace/page.tsx:48` | Nutzung blockiert durch Vorbedingungs-Kette ohne Onboarding-Hinweise: 0 Kurse, Produkt mit Test-IDs, 0 Listings, Opt-in-Flags |
| i18n/A11y | mittel | bug | neu | `src/components/layout/AdminSidebar.tsx:112` | Admin-Navigation, Admin-Dashboard, Editor-Werkzeuge und Player-Titel hartkodiert deutsch |
| i18n/A11y | mittel | bug | neu | `src/components/learn/customer-area-view.tsx:229` | Hartkodierte `de-DE`-Datums-/Zahlenformate in Lernansicht, Schichtplan und Zertifikat |
| i18n/A11y | mittel | gap | neu | `src/app/portal/mandanten/[id]/tenant-branding-form.tsx:65` | Keine Kontrastprüfung bei der Mandanten-Akzentfarbe: helle Akzente erzeugen unlesbare weiße Beschriftung |
| i18n/A11y | mittel | bug | neu | `src/components/layout/topbar-menus.tsx:110` | Benachrichtigungs-/Profilmenü: `role="menu"` ohne `menuitem`, kein Escape, kein Schließen bei Fokusverlust |
| i18n/A11y | mittel | gap | neu | `src/components/admin/course-list-table.tsx:80` | Div-basierte Admin-Listen ohne Tabellensemantik; 12 <th> ohne scope |
| i18n/A11y | mittel | gap | neu | `src/components/layout/LearnMobileNav.tsx:91` | Typografie durchgehend in px (186× 13 px, bis 9 px): Browser-Schriftgrößeneinstellung wirkungslos |
| i18n/A11y | mittel | gap | neu | `src/app/globals.css:18` | Kein Dark Mode, kein High-Contrast-, kein prefers-reduced-motion-Support |
| i18n/A11y | mittel | risk | neu | `src/app/(legal)/layout.tsx:1` | Keine Erklärung zur Barrierefreiheit, keine Konformitätsnachweise: BFSG-Risiko für B2C-verkaufende Mandanten, ungenutztes Verkaufsargument |
| i18n/A11y | mittel | gap | bekannt | `e2e/dashboard-shell.spec.ts:1` | Keine Tastatur- und keine axe-Tests in der Playwright-Suite |
| API | niedrig | improvement | neu | `src/lib/webhooks/deliver-attempt.ts:48` | Webhook-Envelope ohne Zustell-ID und ohne Zeitstempel im Signaturschema; Empfänger können Wiederholungen nicht deduplizieren und Replays nicht erkennen |
| API | niedrig | improvement | neu | `src/lib/api/auth.ts:36` | API-Keys ohne Ablauf, Rotation und Scopes; kein Rate-Limit vor dem Key-Lookup |
| API | niedrig | gap | neu | `src/app/api/stripe/webhook/route.ts:31` | Keine automatisierten Tests für Route-Handler, Stripe-/Bunny-Webhooks und API-Key-Auth |
| API | niedrig | improvement | neu | `src/lib/email/client.ts:31` | E-Mail-Absender fest noreply@calltalent.ai, kein Reply-To, kein Mail-Protokoll trotz fail-soft |
| API | niedrig | improvement | neu | `src/lib/push/send.ts:85` | Push-Benachrichtigungen nur für 'Kurs abgeschlossen', produktiv nie genutzt, web-push auf Workers unverifiziert |
| API | niedrig | risk | neu | `src/lib/users/import.ts:323` | webhook_deliveries speichern E-Mail und Namen unbegrenzt; kein Aufbewahrungs- oder Löschkonzept |
| API | niedrig | bug | neu | `src/app/api/admin/reporting/csv/route.ts:133` | HTTP-Status wird per Substring-Vergleich deutscher Fehlertexte bestimmt |
| API | niedrig | gap | neu | `src/lib/marketplace/fulfil.ts:68` | user.created feuert nicht bei Marketplace-Gastanlage; Ereignisabdeckung unvollständig |
| Auth | niedrig | risk | neu | `src/lib/tenant/resolve.ts:333` | PostgREST-Filter aus dem Host-Header per String gebaut (§2.12): im Dev-Schema nachweislich injizierbar |
| Auth | niedrig | improvement | neu | `src/app/page.tsx:23` | Unbekannter Host liefert in Produktion die „Dev-Root"-Seite mit localhost-Beispielen (Status 200) und einen nutzbaren Login |
| Auth | niedrig | improvement | neu | `src/app/auth/signout/route.ts:205` | „Abmelden" beendet alle Sitzungen auf allen Geräten (scope global); ungenutzte signOut()-Server-Action |
| Auth | niedrig | risk | neu | `src/app/auth/callback/page.tsx:136` | Access-/Refresh-Token verbleiben nach dem Callback als URL-Fragment in der Browser-History |
| Auth | niedrig | gap | neu | `src/app/(auth)/registrieren/page.tsx:511` | /registrieren: ohne Datenschutzhinweis/Rechtslinks, off-brand gestaltet und auch bei deaktivierter Selbstregistrierung erreichbar |
| Auth | niedrig | improvement | neu | `src/lib/auth/schema.ts:565` | Passwortregeln minimal: nur min. 8 Zeichen, keine Obergrenze, Leaked-Password-Schutz aus |
| KI | niedrig | gap | bekannt | `src/lib/generator/extract.ts:28` | DOCX/PPTX-Upload im Kurs-Generator fehlt (bekannt); Aufwand ist geringer als in OFFEN_RUFLO angenommen |
| KI | niedrig | bug | neu | `src/lib/video/transcript.ts:214` | Video-Zusammenfassung berücksichtigt nur die ersten 12.000 Zeichen des Transkripts |
| KI | niedrig | improvement | neu | `src/lib/generator/parse.ts:23` | JSON-Antworten per Regex aus Freitext extrahiert statt Structured Outputs; Retry verdoppelt Kosten |
| KI | niedrig | improvement | neu | `src/lib/generator/pipeline.ts:124` | Kein Prompt-Caching für den wiederholt gesendeten Quelltext und keine Streaming-Antwort im Tutor |
| KI | niedrig | gap | neu | `e2e/tutor-chat.spec.ts:56` | Tutor-E2E deckt die DoD Phase 3 (10 Fachfragen, 2 Off-Topic) nur mit je einer Frage ab; keine Halluzinations-Eval |
| KI | niedrig | risk | neu | `src/lib/ai/voyage.ts:33` | Voyage AI als harte Einzelabhängigkeit: festes Modell 'voyage-3', Token-Zahl nur geschätzt, kein Modellname an den Embeddings |
| KI | niedrig | gap | neu | `src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx:303` | KI-generierte Lektions-Zusammenfassung ohne KI-Kennzeichnung (§3.6 gilt nur für den Tutor) |
| Kurse | niedrig | risk | neu | `src/lib/courses/actions.ts:606` | Server Actions übernehmen Eltern-IDs und Enum-Parameter ohne Besitz- bzw. zod-Prüfung (CLAUDE.md §2.3/§2.15) |
| Kurse | niedrig | gap | neu | `src/lib/courses/schema.ts:69` | Alt-Text ist im Editor als Pflicht beschriftet, wird aber nicht erzwungen (WCAG 1.1.1) |
| Kurse | niedrig | gap | neu | `src/components/editor/block-editor.tsx:149` | Editor-Komponenten unter src/components/editor sind nicht internationalisiert (hartkodiertes Deutsch) |
| Kurse | niedrig | improvement | neu | `src/components/editor/block-form.tsx:283` | Text-Block: veraltetes execCommand-WYSIWYG ohne Listen, Überschriften, Links; Schema erlaubt mehr als der Editor erzeugen kann |
| Kurse | niedrig | risk | neu | `src/app/api/bunny/webhook/route.ts:93` | Bunny-Webhook startet kostenpflichtige Transkription für jedes Video der Library mit fest 'de' als Sprache |
| Kurse | niedrig | improvement | neu | `src/lib/bookmarks/actions.ts:19` | Keine Lernnotizen je Lektion; Lesezeichen sind nur ein Toggle ohne Text oder Zeitmarke |
| Portal | niedrig | gap | neu | `src/lib/import/actions.ts:43` | Migrations-Importer nur für hausinternes JSON: kein CSV, kein Fremdformat, keine Nutzer im selben Lauf |
| Portal | niedrig | gap | neu | `src/app/portal/mandanten/[id]/mandant-detail-tabs.tsx:12` | Kontingente nur planweit: keine Überschreibung je Mandant, kein Zusatzpaket (29 €/1.000), Portal zeigt Verbrauch ohne Limit, unbekannte ai_jobs-Arten roh |
| Portal | niedrig | improvement | Branch | `src/lib/contact/actions.ts:32` | Kontaktformular auf main nur mit IP-Rate-Limit: Honeypot/Form-Token/Turnstile/Spam-Muster liegen fertig auf Branch 2 |
| Portal | niedrig | improvement | Branch | `src/lib/users/actions.ts:22` | Einzel-Einladung und erneuter Einladungslink ohne Rate-Limit (Mailversand an fremde Adressen): auf Branch 1 behoben |
| Portal | niedrig | improvement | neu | `src/lib/users/import.ts:152` | E-Mail-Sprache folgt der Mandanten-Standardsprache, nicht der gewählten Sprache des Empfängers |
| Portal | niedrig | bug | neu | `src/lib/platform/actions.ts:633` | removeTenantDomain() ignoriert Datenbankfehler still: Domain bleibt scheinbar entfernt |
| Produkt | niedrig | gap | neu | `README.md:5` | SPEC.md und README.md sind in mehreren Punkten überholt (Routen, entschiedene Fragen, Rechtsträger, Projektstatus) |
| Produkt | niedrig | gap | neu | `src/components/layout/AdminSidebar.tsx:127` | Trainer sehen in der Admin-Navigation Sackgassen-Links (Teilnehmer, Einstellungen), die mit „Kein Zugriff" antworten |
| Produkt | niedrig | improvement | neu | `src/lib/stripe/checkout.ts:137` | Keine Gutschein-/Rabattcodes im Stripe-Checkout (`allow_promotion_codes` fehlt), keine Bundles |
| Produkt | niedrig | improvement | neu | `src/app/(learn)/kurs/[slug]/information/page.tsx:49` | Keine öffentliche Kurs-Landingpage auf der Mandanten-Domain: die Informationsseite erzwingt Login |
| Produkt | niedrig | gap | neu | `src/app/manifest.ts:47` | PWA: Manifest-Sprache fest „de", Offline-Shell praktisch leer, Installierbarkeit/Push nie live bestätigt |
| Produkt | niedrig | improvement | neu | `-:-` | Could-Features (Kommentare je Lektion, Lernpfade, Gamification, SSO) sämtlich nicht begonnen: Priorisierungsvorschlag |
| Quiz | niedrig | bug | neu | `src/app/(admin)/admin/page.tsx:124` | Dashboard-Wochenbalken lassen jeden siebten Tag aus (Bucket-Spanne 6 Tage, Lücke von 24 h) |
| Quiz | niedrig | bug | neu | `src/app/(admin)/admin/page.tsx:140` | „Letzte Aktivität“ nimmt drei zufällige Mitgliedschaften statt der neuesten |
| Quiz | niedrig | improvement | neu | `src/app/(admin)/admin/abgaben/page.tsx:56` | Abgaben-Inbox, Teilnehmerliste und Reporting ohne Pagination; Inbox lädt vollen Text aller Abgaben |
| Quiz | niedrig | gap | neu | `src/lib/reporting/queries.ts:80` | Quiz-Auswertung ohne Aggregat je Quiz (Bestehensquote/Durchschnitt) – tote i18n-Schlüssel belegen die Lücke |
| Quiz | niedrig | risk | neu | `src/lib/quiz/grade.ts:249` | Lückentext-Regex ungeankert und ohne Komplexitätsgrenze |
| Quiz | niedrig | improvement | neu | `src/components/learn/quiz-runner.tsx:53` | Nur Fragen werden gemischt, Antwortoptionen nicht; kein Zuordnungs-/Reihenfolge-Fragetyp; Bestehensgrenze 0 % erlaubt |
| RLS | niedrig | improvement | neu | `supabase/migrations/20260710235500_rate_limits.sql:30` | `rate_limits` wächst unbegrenzt: eine Zeile je IP/E-Mail-Hash und Namespace, nie gelöscht |
| RLS | niedrig | risk | neu | `supabase/migrations/20260801150000_memberships_owner_escalation_fix.sql:15` | `memberships_admin_insert` akzeptiert beliebige `user_id` (Cross-Tenant-Profillesen), `profiles.email` durch Nutzer änderbar |
| Schichtplan | niedrig | risk | neu | `supabase/migrations/20260807142619_shift_calendar.sql:702` | Projektleiter-Rechte auf Zeiteinträge und Krankmeldungen sind arbeiter- statt projektbezogen (dieselbe Schwäche, die S3 für Änderungsanfragen behoben hat) |
| Schichtplan | niedrig | improvement | neu | `src/components/learn/shift-calendar-view.tsx:388` | Keine Monatsansicht, kein Druck/PDF, kein Kalender-Export (ICS) |
| Schichtplan | niedrig | gap | neu | `src/components/learn/shift-calendar-view.tsx:486` | Teil-Zeitraum-Buchung eines Zeitfensters nur per Maus/Touch: Tastatur und Screenreader können nur den ganzen Slot buchen |
| Schichtplan | niedrig | bug | neu | `src/lib/calendar/actions.ts:1285` | Änderungsanfrage-Entscheidung nicht atomar: Schicht wird umgeschrieben, bevor die Anfrage geschlossen ist |
| Schichtplan | niedrig | gap | neu | `supabase/migrations/20260807142619_shift_calendar.sql:213` | Schichtbestätigung durch den Arbeiter fehlt: Status `confirmed` ist im Schema, aber unerreichbar |
| Schichtplan | niedrig | bug | Branch | `src/app/(planung)/admin/schichtplanung/page.tsx:175` | Feiertage fehlen in der Jahreswechsel-Woche des Admin-Rasters (`weekStart.getUTCFullYear()`) |
| Schichtplan | niedrig | bug | Branch | `src/lib/calendar/actions.ts:914` | Nachtschicht-Selbstbuchung am Zeitumstellungstag um eine Stunde falsch (+24h in Millisekunden) |
| Schichtplan | niedrig | bug | Branch | `src/lib/calendar/ai/process.ts:80` | CAS-Sperre der KI-Schichtplan-/Feiertagsjobs prüft die betroffene Zeilenzahl nicht: Doppelverarbeitung und doppelte Claude-Kosten bei überlappenden Cron-Ticks |
| Schichtplan | niedrig | gap | bekannt | `src/lib/calendar/access.ts:41` | `shift_calendar_enabled` wird für owner/admin nicht geprüft: Admin kann Arbeiter anlegen, die „Mein Schichtplan“ nie sehen |
| Schichtplan | niedrig | improvement | neu | `src/lib/calendar/date.ts:103` | Zeitzone und Mail-Zeitlabels fest auf Europe/Berlin und de-DE: keine Mandanteneinstellung, obwohl Feiertagsregionen bis Bosnien/Serbien reichen |
| Zahlungen | niedrig | gap | neu | `e2e/stripe-checkout.spec.ts:96` | E2E-Abdeckung des Kaufwegs prüft nur den glücklichen Pfad eines bereits importierten Mitglieds |
| Zahlungen | niedrig | improvement | neu | `src/lib/stripe/schema.ts:425` | Währung nur nominell konfigurierbar, Checkout ohne locale, KPI summiert fest in EUR |
| i18n/A11y | niedrig | bug | neu | `src/components/layout/Sidebar.tsx:329` | Lern-Sidebar schneidet Navigation bei Zoom/vielen Zusatzlinks ab (`overflow-hidden`) |
| i18n/A11y | niedrig | gap | bekannt | `messages/de.json:1` | 20 tote i18n-Schlüssel (18 über die bekannten zwei hinaus), teils Hinweise auf nie verdrahtete Fehlermeldungen |
| i18n/A11y | niedrig | gap | neu | `src/app/(auth)/login/login-form.tsx:328` | Formularfehler nicht mit Feldern verknüpft (kein aria-invalid, kaum aria-describedby) |
| i18n/A11y | niedrig | improvement | neu | `src/app/(portal)/einstellungen/einstellungen-tabs.tsx:334` | Sprachumschalter nur tief in den Lern-Einstellungen; Betreiber-Portal mit eigener Palette und komplett deutsch |
