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

Die Nummern H1 bis H36 folgen der Reihenfolge der Darstellung, nicht der Schwere. Maßgeblich für die Einstufung ist Anhang A mit dem Urteil des jeweiligen Gegenprüfers. Drei Funde stehen hier, obwohl der Gegenprüfer sie einzeln auf mittel setzt; die Begründung steht jeweils dabei.

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

**H25. E2E-Suite läuft gegen die Produktionsdatenbank, mit einem Owner-Konto samt Standardpasswort im Repo.** `e2e/helpers/test-data.ts`, Zeile 21, und `e2e/global-setup.ts`, Zeile 28: Die Playwright-Suite verbindet sich mit `service_role` auf die Live-Datenbank, legt im Live-Mandanten `demo-blau` das Owner-Konto `e2e-staff@example.test` an und nutzt dafür den in `.env.example` beschriebenen Standardwert, falls `E2E_TEST_PASSWORD` nicht gesetzt ist. Wer das Repo lesen kann, kann sich damit als Owner eines Live-Mandanten anmelden. Zum Zustand der Suite widersprachen sich zwei Prüfer; die Auflösung: Der letzte dokumentierte volle Lauf am 05.08. ergab 8 grüne und 11 rote Specs, die zehn alten Fehler wurden noch am selben Tag einzeln behoben (PHASENSTATUS, Zeile 3385), ein vollständiger grüner Lauf ist seither aber nirgends dokumentiert. Das Phase-4-Kriterium „Playwright-Suite grün" ist damit unbelegt. Status: neu.

Behebung: `E2E_TEST_PASSWORD` verpflichtend machen (Abbruch ohne Wert), das Konto in `demo-blau` sofort löschen oder das Passwort rotieren, E2E gegen ein eigenes Supabase-Projekt oder einen Supabase-Branch fahren, `seed.sql` ins Repo.

**H26. `supabase db push` würde beim ersten Statement scheitern.** 37 von 58 Migrationsdateien im Repo tragen Versionsnummern, die in der Live-Historie nicht existieren, `0001_init.sql` eingeschlossen; die Migrationen wurden per MCP `apply_migration` mit eigenen Zeitstempeln angewendet. Der in CLAUDE.md §5 dokumentierte Weg `npx supabase db push` würde versuchen, `0001_init` erneut anzuwenden, und abbrechen. Es gibt keine `supabase/config.toml`, keine lokale Datenbank, keinen Restore-Test und keine generierten Datenbanktypen (53 handgeschriebene Row-Typen). Der Prüf-Agent hat 2.298 Spaltenreferenzen im Code gegen das Live-Schema geprüft, ohne Abweichung; die Struktur stimmt, der Prozess nicht. Status: neu (M11 präzisiert).

Behebung: einmalig `supabase migration repair` gegen die Live-Historie, Dateien umbenennen, danach nur noch per CLI anwenden; `supabase gen types` in die CI.

**H27. Nutzerlöschung ist technisch blockiert.** Elf Fremdschlüssel auf `profiles` (`created_by`, `reviewed_by`, `decided_by` und ähnliche) haben keine `ON DELETE`-Regel (0001_init.sql, Zeile 94 ff.). Sobald jemand einen Kurs angelegt oder eine Abgabe bewertet hat, scheitert das Löschen seines Kontos mit einem FK-Fehler. Zusammen mit H22 (kein Löschpfad im Produkt) ist Art. 17 DSGVO derzeit nicht erfüllbar. Status: neu.

Behebung: `ON DELETE SET NULL` für Autor- und Bearbeiter-Spalten, `CASCADE` für personenbezogene Zeilen, Anonymisierung für `orders` und `audit_log`; dann der Lösch-Job aus H22.

**H28. `products.course_ids` ohne referenzielle Integrität, live bereits verwaist.** `products.course_ids` ist ein `uuid[]` ohne Fremdschlüssel (0001_init.sql, Zeile 238). Das einzige Live-Produkt zeigt auf einen Kurs, den es nicht mehr gibt; ein Kauf würde `enrollFromProduct()` still ins Leere laufen lassen und trotzdem die Mail „Zahlung erhalten" senden (Nachtrag des API-Gegenprüfers: `sendOrderPaidMail` läuft auch, wenn die Einschreibung abgebrochen hat). Status: neu.

Behebung: Verknüpfungstabelle `product_courses (product_id, course_id, tenant_id)` mit FKs, Migration der Arrays, Kaufabbruch bei leerer Kursliste.

**H29. Kein Backup, und ein Datenverlust ist bereits einmal unbemerkt eingetreten.** Der Datenmodell-Prüfer fand in `PHASENSTATUS.md` einen unerklärten Verlust der Kursdaten von `demo-blau`; ein Restore war mangels Backup nicht möglich. Der Free-Plan sichert nicht, SPEC §4.4 verlangt tägliche Backups. Der Worker liegt außerdem gemessen bei 4,5 MB gzip und damit über dem 3-MiB-Limit des Free-Plans von Cloudflare; dass der Deploy heute funktioniert, ist nur durch den Paid-Plan erklärbar oder ein Zufall der Messung. Status: neu (verschärft 4.2).

Behebung: Sofort-Position „Backup heute" in Abschnitt 5.2, danach die Plan-Entscheidung aus Abschnitt 6.

**H30. Videoaufnahme im Kurs-Editor ist seit dem 08.08.2026 gesperrt.** `next.config.ts`, Zeile 25, setzt für alle Pfade `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Eine leere Klammer ist eine leere Erlaubnisliste und schließt die eigene Seite ein; erlaubt wäre `camera=(self)`. `src/components/editor/video-recorder.tsx` ruft an Zeile 369 `getUserMedia({video, audio})` für die Webcam-Aufnahme und an Zeile 402 `getUserMedia({audio})` für den Mikrofonton der Bildschirmaufnahme. Beide Aufrufe scheitern seither mit `NotAllowedError`. Die Funktion war in drei Stufen im Juli gebaut worden; der Header kam am 08.08. aus dem Sicherheitsaudit dazu, ohne Test der Aufnahme. Der Fund stammt vom Vollständigkeits-Kritiker, ich habe Header und Aufrufstellen selbst geprüft. Status: neu.

Behebung: `camera=(self), microphone=(self), geolocation=()`. Danach eine Aufnahme im Browser tatsächlich starten, denn ein Test dafür existiert nicht.

**H31. Keine Fehlerseiten, keine Fehlerspuren.** In `src/app` gibt es keine einzige `error.tsx`, `global-error.tsx`, `not-found.tsx` oder `loading.tsx` (selbst geprüft, 0 Treffer). Eine Ausnahme in einer Server Component zeigt damit die nackte Next.js-Standardseite, ein unbekannter Pfad liefert einen weichen 404 mit Status 200. Dazu verschluckt `src/lib/errors/generic.ts`, Zeile 15 bis 22, in Produktion die Originalmeldung: geloggt wird nur mit `console.debug` und nur außerhalb von Produktion. `src/lib/errors/db.ts`, Zeile 39 bis 44, verwirft an 193 Aufrufstellen `error.code` und `error.message` vollständig und protokolliert an keiner Stelle. Auch das Wurzel-Layout fängt nichts ab: `src/app/layout.tsx`, Zeile 40 bis 44, wartet ohne Absicherung auf `getMessages`, `getTenant` und `getLocale`, ein Fehler dort ergibt ein leeres Dokument. Zusammen mit dem fehlenden Error-Tracking (Abschnitt 4.2) heißt das: Wenn beim Kunden etwas schiefgeht, existiert davon nirgends eine Spur. Status: neu.

Behebung: `error.tsx` und `not-found.tsx` je Routengruppe mit Marken-Layout, `global-error.tsx` im Root, in `genericErrorMessage` immer `console.error` mit Kontext, danach Sentry (Roadmap-Position Monitoring).

**H32. 23 Seiten greifen ohne Prüfung auf den Mandanten zu.** `grep -rn "tenant!\." src/app` liefert 23 Treffer, darunter Reporting, Abgaben, Suche und die Kursseite (selbst geprüft). Das Ausrufezeichen unterdrückt die TypeScript-Prüfung; ist der Mandant nicht aufgelöst, etwa auf einem unbekannten Host oder während einer Störung der Auflösung, wirft die Seite. 19 andere Seiten lösen genau das defensiv mit `if (!tenant)`. Zusammen mit H31 heißt das: Der Nutzer sieht die englische Next.js-Standardseite. Der Gegenprüfer setzt den Fund allein auf mittel, weil eine nicht aufgelöste Mandanten-Sitzung selten ist; hier steht er höher, weil er mit H31 zusammenfällt und dann keine Spur hinterlässt. Status: neu.

Behebung: `tenant!` durch die vorhandene Wächterfunktion ersetzen, ESLint-Regel `no-non-null-assertion` für `src/app` einschalten.

**H33. 96 Datenbankabfragen in Seiten werten den Fehler nicht aus.** Der Prüfer der Fehlerzustände zählt 96 Stellen, an denen `data` verwendet und `error` verworfen wird. Schlägt eine Abfrage fehl, rendert die Seite den Leerzustand: „Noch keine Kurse", „Keine Teilnehmer". Der Betreiber sieht keinen Unterschied zwischen leer und kaputt. Verstärkt wird das dadurch, dass 80 von 88 `genericErrorMessage()`-Aufrufen und 153 von 154 `translateDbError()`-Aufrufen nichts protokollieren (siehe H31). Nicht im Einzelnen nachgezählt, das Muster habe ich an drei Stellen bestätigt. Der Gegenprüfer bestätigt den Fund als mittel; hier steht er höher, weil er der Grund ist, warum ein Ausfall dem Betreiber wie ein leerer Kurs aussieht. Status: neu.

Behebung: In den Ladefunktionen `error` prüfen und werfen, damit `error.tsx` aus H31 greift; Leerzustand nur bei tatsächlich leerem Ergebnis.

**H34. Der Video-Schnitt kann den Fehler wiederholen, der im Juli die Produktion traf.** Drei Befunde des Medienpipeline-Prüfers: Der Knopf „Ohne Zuschnitt hochladen" im Trimmer (`video-trimmer.tsx`, Zeile 791) umgeht den `remuxFix`-Durchlauf und lädt genau das rohe WebM hoch, das im Juli bei Bunny im Zustand „Processing" hängen blieb. Ein laufender TUS-Upload lässt sich nirgends abbrechen, und `reset()` gibt den Schutz gegen Mehrfachstart frei (`use-bunny-upload.ts`, Zeile 137), womit parallele Uploads und mehrere kostenpflichtige Bunny-Videos entstehen. Der Knopf „Verwenden" schickt jede Aufnahme ohne Größenprüfung durch ffmpeg.wasm, dessen Heap hart bei 2048 MB endet; diesen dritten Punkt konnte der Gegenprüfer nicht abschließend belegen und setzt ihn auf niedrig. Den Reparaturlauf gibt es im Normalweg zwar (`video-recorder.tsx`, Zeile 575), sein `catch` daneben lädt bei jedem Fehler wieder genau die Rohaufnahme hoch, also derselbe Ausgang wie beim Direktpfad (selbst gelesen). Für keinen dieser Wege existiert ein Test; der echte Browser-Durchlauf steht seit dem 17.07. offen. Der Gegenprüfer bestätigt die ersten beiden Punkte und stuft sie einzeln auf mittel; zusammen tragen sie den Fund, weil beide denselben Produktionsfehler vom Juli zurückholen. Status: neu.

Behebung: `remuxFix` auch im Direktpfad, Abbruch-Knopf mit `upload.abort()`, Größenprüfung vor dem Schnitt, ein E2E-Fall über Aufnahme, Schnitt und Übergabe.

**H35. Ein ungültiges Datum in der Adresszeile erzeugt eine Fehlerseite.** `src/app/(portal)/schichtplan/page.tsx`, Zeile 74, prüft den Parameter `week` nur gegen das Muster `\d{4}-\d{2}-\d{2}` (selbst geprüft). `?week=2026-13-45` besteht die Prüfung, ergibt ein ungültiges Datum und führt in der Wochenberechnung zu einem `RangeError`. Dieselbe Stelle gibt es in der Admin-Schichtplanung. Der Gegenprüfer setzt den Fund auf mittel, weil eine Adresszeile mit ungültigem Datum selten von allein entsteht; die Behebung kostet zwei Zeilen, deshalb steht er in der Sofort-Liste. Status: neu.

Behebung: Nach dem Muster zusätzlich auf ein gültiges Datum prüfen und sonst auf die aktuelle Woche zurückfallen.

**H36. Der Mandanten-Filter wird aus dem Host-Kopf zusammengesetzt.** `src/lib/tenant/resolve.ts`, Zeile 138, baut den PostgREST-Filter per Zeichenkette: `query.or(\`slug.eq.${slug},custom_domain.eq.${hostname}\`)`. Beide Werte stammen aus dem `Host`-Kopf der Anfrage, `extractTenantSlugFromHost` in Zeile 80 bis 98 prüft kein einziges Zeichen. Komma und Punkt sind in der `or`-Syntax Trennzeichen, ein eingeschleuster Ausdruck erweitert also den Filter. Die Abfrage läuft über `createAdminClient()` und damit an RLS vorbei; `maybeSingle()` begrenzt den Schaden auf genau eine Zeile, aber die kann der falsche Mandant sein. CLAUDE.md §2.12 verbietet genau diese Konstruktion. In Produktion schirmt Cloudflare ab, weil dort nur eingetragene Hostnamen ankommen; lokal und bei jedem selbst betriebenen Vorschaltserver fällt der Schutz weg. Der Fund stammt vom Gegenprüfer der Fehlerzustände, ich habe die Stelle selbst gelesen. Status: neu.

Behebung: Slug und Hostname gegen `^[a-z0-9-]+$` beziehungsweise `^[a-z0-9.-]+$` prüfen, bevor sie in den Filter gehen, und die beiden Bedingungen als zwei getrennte Abfragen statt als eine `or`-Zeichenkette stellen.

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
| M26 | Zahlungen | Der Webhook prüft `event.livemode` nicht (selbst geprüft, kein Treffer im Code); Test- und Live-Ereignisse wären damit nicht unterscheidbar. Die weitergehende Annahme, das Live-Produkt trage Testmodus-IDs, hat der Gegenprüfer widerlegt: laut PHASENSTATUS (Zeile 1756 ff.) ist es im Live-Modus angelegt und ein echter Ein-Euro-Kauf lief durch. | `livemode` gegen die Umgebung prüfen und fremde Ereignisse verwerfen |
| M27 | Zahlungen | Der reguläre Webhook-Pfad antwortet bei internen Fehlern mit 200 (`webhook/route.ts`, Zeile 153); Stripe wiederholt dann nicht, der Kunde hat gezahlt und bleibt ohne Zugriff. `success_url` `/?checkout=success` wird nirgends ausgewertet, es gibt keine Bestätigungsseite. | 500 bei Fehlern zurückgeben, Bestätigungsseite mit Status „wird freigeschaltet" |
| M28 | Zahlungen | Provisions-Ledger ohne Mandantensicht und ohne Storno; `/admin/zahlungen` zeigt Marketplace-Bestellungen als vollen Umsatz (`src/lib/platform/marketplace.ts`, Zeile 556). | Ledger-Auszug im Mandanten-Admin, Storno-Buchung bei Erstattung (H11) |
| M29 | Quiz | Quiz-Zeitlimit wird nur als Countdown angezeigt, serverseitig nicht durchgesetzt (`src/lib/quiz/actions.ts`, Zeile 262). | `started_at` serverseitig setzen, Abgabe nach Ablauf plus Toleranz ablehnen |
| M30 | Quiz | Freitext-Fragen (`kind = 'open'`) werden gespeichert, aber nie angezeigt oder bewertet (`src/lib/quiz/grade.ts`, Zeile 266). Dass `kind = 'exam'` weder Lektionsabschluss noch Zertifikat gated, ist laut PHASENSTATUS (Phase-2-Entscheidung 4) bewusst so; für Kunden, die Prüfungen verkaufen, ist die Entscheidung zu überdenken. | Freitext im Runner anzeigen und in die Abgaben-Inbox leiten; Prüfungs-Gate als Kurs-Option |
| M31 | Quiz | Kein Ergebnis-Feedback je Frage, kein persistiertes Ergebnis für den Lernenden; Antwortoptionen werden nicht gemischt; Bestehensgrenze 0 % erlaubt. | Ergebnisseite mit richtig/falsch je Frage, Mindestgrenze 1 % |
| M32 | Abgaben | „Überarbeitung nötig" ist eine Sackgasse (kein Wiedereinreichen, `src/components/learn/submission-form.tsx`, Zeile 82); keine Benachrichtigung an Trainer bei neuer Abgabe (`src/lib/submissions/actions.ts`, Zeile 88). | Wiedereinreichen erlauben, Mail an Trainer und Admin |
| M33 | Zertifikate | PDF nur auf Deutsch trotz Mandantensprache bs/en (`src/lib/certificates/pdf.ts`, Zeile 288), keine Verifikations-URL. Die Anzeige im Profil ist vorhanden (`/profil` leitet auf `/einstellungen`, dort werden Zertifikate gelistet); der ursprüngliche Fund „fehlen im Profil" wurde vom Gegenprüfer widerlegt. | PDF aus `messages/*` übersetzen, `/zertifikat/[id]` als öffentliche Prüfseite |
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
| M52 | Performance | Lern-Seiten machen 8 bis 12 sequenzielle Supabase-Rundläufe, `getUser()` bis zu viermal je Request, weil der Cache aus dem Fix vom 19.07. nur in 4 von rund 25 Seiten angekommen ist (`src/lib/platform/auth.ts`, Zeile 30). Kein Streaming (0 `loading.tsx`), 0 cachebare Routen, kein Incremental Cache, Smart Placement nicht konfiguriert. Die Vorgabe LCP < 1 s ist auf datentragenden Seiten so nicht erreichbar. | `getAuthUser()` überall, `Promise.all`, `loading.tsx` je Bereich, Smart Placement in `wrangler.jsonc`, dann Lighthouse messen |
| M53 | Performance | 92 KB Übersetzungen in jeder HTML-Antwort (86 % der Login-Seite), Bilder ohne `width`/`height` und ohne Lazy-Loading (25 `<img>`), Cover bis 8 MB in Vollgröße für 56-px-Kacheln; `sanitize-html` (175 KB) und der Supabase-Browser-Client (168 KB) landen im Client-Bundle der Lektionsseite. | Messages je Namensraum laden, `next/image` mit Bunny- oder Supabase-Transformation, schwere Importe serverseitig halten |
| M54 | Datenmodell | Keine Aufräumjobs: `rate_limits`, `ai_jobs`, `tutor_messages`, `webhook_deliveries` wachsen unbegrenzt; keine `unique (parent, position)`-Constraints auf Modulen, Sektionen, Lektionen, Fragen; Stripe-Abo-Status wird verlustbehaftet auf drei Werte gepresst, `orders.status` kennt `refunded` und `failed`, die nie gesetzt werden (`webhook/route.ts`, Zeile 367). | Cron-Aufräumjob mit Fristen, Constraints nachziehen, Statuswerte vollständig abbilden |
| M55 | Toolchain | `npm run lint` führt entgegen CLAUDE.md §5 keinen TypeScript-Check aus; keine Node-Version festgelegt (`engines`, `.nvmrc`); Test- und Live-Trennung bei Stripe und Bunny nur per Konvention; E2E testet nur `next dev`, nie den OpenNext-Worker-Build; Dependabot fehlt. | `typecheck`-Skript und `lint` verketten, `engines.node >= 22`, `livemode`-Prüfung (M26), Dependabot aktivieren |
| M56 | Auth | Nachtrag des Gegenprüfers: Das kontobezogene Login-Limit (5 Versuche je E-Mail-Hash in 300 s, unabhängig von der IP, `src/lib/auth/actions.ts`, Zeile 79 bis 87) erlaubt es, ein beliebiges Zielkonto dauerhaft auszusperren. `@supabase/ssr` setzt außerdem kein `Secure`-Attribut auf Cookies. | Konto-Limit nur zusätzlich zur IP werten oder Backoff statt Sperre; `Secure` über die Cookie-Optionen setzen |
| M57 | API | Nachträge des Gegenprüfers: `webhook_deliveries`-Zeile entsteht erst nach dem Zustellversuch, bei Abbruch gibt es keine Spur; der Retry-Endpunkt zählt drei Versuche gesamt statt drei Wiederholungen; `POST /api/v1/enrollments` feuert `enrollment.created` bei jedem wiederholten Aufruf desselben Paars. | Zeile vor dem Versuch anlegen, `MAX_ATTEMPTS` auf 4, Existenzprüfung vor dem Ereignis |
| M58 | Kurse | Nachtrag des Gegenprüfers: `modules_select` und `sections_member_select` prüfen nur die Mitgliedschaft, nicht den Kursstatus; Module und Sektionen unveröffentlichter Kurse sind per PostgREST lesbar. Die rechte Spalte der Lektionsseite listet Lektionen ohne Sektionsüberschrift. | Kursstatus in beide Policies, Sektionen in der Navigation anzeigen |
| M59 | Quiz | Nachträge des Gegenprüfers: Die KPI „Teilnehmer" zählt nur `member`, Marketplace-Gäste fehlen; die Texte „Ihre Antwort (wird nicht automatisch bewertet)" versprechen eine manuelle Bewertung, die es nicht gibt (M30). | Gäste mitzählen, Text anpassen oder Freitext in die Abgaben-Inbox leiten |
| M60 | KI | Nachträge der Gegenprüfung: KI-Schichtplanung und Feiertagsrecherche ziehen vom Kontingent `course_gen` ab (Komplett 5 im Monat), das eigentlich für Kursentwürfe gedacht ist; `translateBatchWithRetry` wiederholt jeden Fehler sofort ohne Wartezeit, auch 429 und 5xx; die Tokens fehlgeschlagener erster Versuche werden nicht protokolliert, die Kostenzahlen sind also zu niedrig. | eigenes Kontingent für Kalender-KI, exponentielles Warten, alle Versuche buchen |
| M61 | Zahlungen | Nachträge der Gegenprüfung: Ein fehlgeschlagener Ledger-Eintrag wird nur geloggt, während Bestellung und Zugriff bestehen bleiben (`fulfil.ts`, Zeile 217); Katalog und Checkout prüfen nur `payments_enabled` des Verkäufers, nie dessen `marketplace_enabled`; die Stripe-Zustände `incomplete`, `paused` und `trialing` werden alle auf `active` abgebildet. | Ledger-Fehler werfen, Marketplace-Flag prüfen, Statusabbildung vollständig |
| M62 | Portal | Nachträge der Gegenprüfung: `updateProfile()` wertet den Datenbankfehler nicht aus und meldet immer Erfolg (`account/actions.ts`, Zeile 37); die Kontaktadresse `office@calltalent.ai` steht als Rückfall hart im Code, für Mandanten ohne Support-Adresse landen deren Anfragen beim Betreiber; ein Löschantrag löst keine Mail aus, niemand erfährt davon. | Fehler auswerten, Support-Adresse beim Anlegen setzen, Mail an Betreiber und Antragsteller |
| M63 | Schichtplan | Nachträge der Gegenprüfung: Der `week`-Parameter wird nur per Muster geprüft, `?week=2026-13-45` ergibt ein ungültiges Datum; die JSDoc zu `deleteCalendarWorker()` behauptet, geplante Schichten blieben stehen, die Migration kaskadiert sie aber; `calendar_absences` hat weder Unique- noch Ausschluss-Constraint, Abwesenheiten lassen sich doppelt anlegen. | Datum echt validieren, Doku korrigieren, Constraint ergänzen |
| M64 | Toolchain | Nachtrag der Gegenprüfung: `vitest.config.ts`, Zeile 28, lädt bei jedem `npm run test` die komplette lokale `.env` inklusive Service-Role-, Stripe- und Anthropic-Schlüssel in `process.env`; ein Test oder eine Abhängigkeit mit Neugier liest sie mit. | nur die benötigten Variablen laden, Testwerte statt echter Schlüssel |
| M65 | i18n | Nachträge der Gegenprüfung: Die Meldung bei Ratenbegrenzung ist ein hartkodierter deutscher Satz an rund 80 Stellen; die mobilen Ausklappmenüs haben weder Escape noch Fokusverwaltung, sie greifen ab 1024 Pixel und damit auch bei 200 Prozent Zoom; die Grundschriftgröße steht in `globals.css` als `18px` statt `1.125rem`. | Meldung übersetzen, Menüs wie Dialoge behandeln, `rem` verwenden |
| M66 | Fehlerzustände | Soft-404: Nicht gefundene Kurse, Lektionen, Teilnehmer und Listings antworten mit HTTP 200 statt 404; Suchmaschinen und Überwachung sehen eine gesunde Seite. Kein Health-Endpunkt, keine Alarmierung. | `notFound()` statt Leerzustand, `/api/health` mit Datenbank-Ping |
| M67 | Fehlerzustände | Der Service Worker legt `"/"` in den App-Shell-Cache (`public/sw.js`, Zeile 16, selbst geprüft), obwohl der Kommentar darüber zusichert, personalisierte Seiten würden nie gecacht. Auf einer Mandanten-Domain ist `/` die personalisierte Startseite. | `"/"` aus `APP_SHELL` entfernen oder eine neutrale Offline-Seite cachen |
| M68 | Fehlerzustände | Prüfungsabgabe und Lektions-Autosave fangen abgebrochene Server-Action-Aufrufe nicht ab (`quiz-runner.tsx`, Zeile 87): Bei Verbindungsabbruch verschwindet die Arbeit ohne Meldung. Fehlertexte umgehen die Mehrsprachigkeit, 31 deutsche Meldungen stehen fest im Code. | `try/catch` mit Wiederholung und sichtbarer Meldung, Texte nach `messages/` |
| M69 | Medienpipeline | MP4-Aufnahmen aus Safari und iOS laufen in eine fest auf WebM verdrahtete Kette (`recorder.ts`, Zeile 65): Der Schnitt scheitert immer, die Datei bekommt die falsche Endung. Bis zu 20 Minuten Aufnahme liegen nur im Arbeitsspeicher, ohne Warnung beim Verlassen der Seite. | Containerformat aus dem Aufnahme-Typ ableiten, `beforeunload` und Zwischenspeicherung |
| M70 | Medienpipeline | Die öffentliche Route `/api/ffmpeg/[file]` liefert 31 MB ohne Ratenbegrenzung aus und stellt je Abruf eine Supabase-Abfrage (`route.ts`, Zeile 78). `VideoProcessingStatus` fragt ohne Obergrenze und ohne Wartezeit bei Bunny nach, ein verwaistes Video hält jeden offenen Tab dauerhaft am Abfragen. | Rate-Limit und lange Cache-Zeit, Abbruch nach zwanzig Versuchen mit wachsendem Abstand |
| M71 | Fehlerzustände | Der einzige Offline-Rückfall im Service Worker ist `caches.match("/")` (`public/sw.js`, Zeile 70, selbst geprüft). Für `/dashboard`, `/schichtplan` und jede andere Navigation reicht der Worker durch und der Browser zeigt seine eigene Fehlerseite; eine Offline-Seite existiert im Projekt nicht. | `src/app/offline/page.tsx` anlegen, vorab cachen und als Rückfall für alle Navigationen setzen |
| M72 | Fehlerzustände | Die Wochen-Parselogik steht zweimal wortgleich im Code (`(portal)/schichtplan/page.tsx`, Zeile 74 und `(planung)/admin/schichtplanung/page.tsx`, Zeile 130, selbst geprüft). `src/lib/calendar/date.test.ts` enthält keinen einzigen Fall für ein ungültiges Datum, obwohl `startOfIsoWeek` dabei wirft. | Parselogik in `src/lib/calendar/date.ts` ziehen, Tests für `2026-13-45` und leere Eingabe ergänzen |
| M73 | Medienpipeline | `src/lib/video/ffmpeg-client.ts`, Zeile 54: `instance` ist ein Prozess-Singleton, `terminate()` steht an keiner Stelle im Projekt (0 Treffer, selbst geprüft). Worker und der einmal gewachsene wasm-Heap bleiben bis zum Neuladen des Tabs belegt. | `terminate()` beim Verlassen des Editors, Singleton danach zurücksetzen |
| M74 | Medienpipeline | `src/lib/bunny/use-bunny-upload.ts`, Zeile 130: `findPreviousUploads()` sucht nach einem abgebrochenen Upload, obwohl neun Zeilen davor bereits eine neue `videoId` samt Signatur angelegt wurde (selbst geprüft). Die Wiederaufnahme kann nie greifen und kostet je Versuch ein bezahltes Bunny-Video. | Signatur erst nach der Prüfung auf einen fortsetzbaren Upload anfordern |
| M75 | Medienpipeline | `remuxFix` bekommt in `video-recorder.tsx`, Zeile 575, keinen Fortschritts-Rückruf; die Oberfläche zeigt währenddessen nur den festen Satz „Aufnahme wird für den Upload vorbereitet". Bei einer 20-Minuten-Aufnahme läuft ffmpeg minutenlang ohne sichtbaren Fortschritt. | `onProgress` durchreichen und als Balken mit Prozentwert anzeigen |

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

### 5.1 Rangfolge des Strategie-Panels

Drei Strategen haben unabhängig voneinander dieselbe Faktenlage bewertet, jeder aus einem eigenen Blickwinkel: erster zahlender Kunde in 30 Tagen, Betriebssicherheit für einen Alleinbetreiber, Produkt-Differenzierung. Ein vierter Agent hat die drei Vorschläge gegeneinander bewertet, acht Widersprüche entschieden und eine gemeinsame Rangfolge gebildet. Bewertung nach Konkretheit, Wirkung und Realismus: Erster Kunde 9/9/8, Betriebssicherheit 9/7/7, Differenzierung 8/8/8.

Die Rangfolge steht vor den Zeitfenstern 5.2 bis 5.4, weil sie die Frage beantwortet, was zuerst kommt, wenn die Zeit für alles nicht reicht.

| Rang | Maßnahme | Blickwinkel | Zeitfenster |
|---|---|---|---|
| 1 | Live-Stand einfrieren: beide Branches mergen, `v0.2.0` taggen, Qualitätstor ins Deploy-Skript | Betriebssicherheit | sofort |
| 2 | `Permissions-Policy` korrigieren und den ersten echten Kurs produzieren, Generatorlauf zuerst | Erster Kunde und Differenzierung, deckungsgleich | sofort |
| 3 | Kaufweg schließen: Mitgliedschaft beim Kauf anlegen, `courses.access` einführen | alle drei | sofort und 30 Tage |
| 4 | Zahlungslebenszyklus: `payment_status`, `charge.refunded`, Dispute, Abo-Ende an `expires_at`, echte Erfolgsseite | Erster Kunde | 30 Tage |
| 5 | Sichtbarkeit: unbedingtes `console.error`, `/api/health`, externer Uptime-Check mit Push aufs Handy | Betriebssicherheit und Erster Kunde | 30 Tage |
| 6 | Backup mit nachgewiesenem Restore, Supabase Pro, Betriebskosten als feste Position | Betriebssicherheit | sofort und 30 Tage |
| 7 | Rechtliche Verkaufsfähigkeit: Stripe Tax, Rechnung, Kündigungsschaltfläche, Widerrufsverzicht, Impressum als Pflichtfeld | Erster Kunde | 30 Tage |
| 8 | Trial mit echtem Ablauf und Mandanten-Abrechnung über Stripe | Erster Kunde und Differenzierung | 30 Tage |
| 9 | Schichtplan und Zeiterfassung einfrieren, Fremdschlüssel auf `on delete restrict`, Add-on-Preis festschreiben | Differenzierung | sofort |
| 10 | Geführter Erststart im Admin mit Live-Status aus einer Abfrage | Erster Kunde und Differenzierung | 30 Tage |
| 11 | Vertriebspaket: Preisseite, Demo-Mandant mit Gast-Login, Gesprächsleitfaden, 20 Zielkunden aus dem Calltalent-Bestand | Erster Kunde | 30 Tage |
| 12 | Migrationshistorie mit der Live-Datenbank versöhnen, generierte Typen als Drift-Wächter | Betriebssicherheit | 30 Tage |
| 13 | Staging-Projekt mit `seed.sql`, E2E-Passwort aus dem Repo, 104 Testkonten räumen | Betriebssicherheit | 30 Tage |
| 14 | CI-Minimum bei jedem Push, Branch-Schutz auf `main`, Node auf 22 festgenagelt | Betriebssicherheit | 30 Tage |
| 15 | Kontrast- und Fokus-Tokens, `focus-visible`, Skip-Link, `rem` statt `px`, axe-core in drei E2E-Tests | Erster Kunde und Differenzierung | sofort und 90 Tage |

Vier Entscheidungen hat das Panel selbst getroffen, weil die Strategen sich widersprachen. Erstens: Der erste echte Kurs entsteht in der Produktion im Mandanten `demo-blau`, nicht erst nach dem Staging-Aufbau. Staging läuft parallel und nur für die automatisierte Testsuite, sonst wird es zur Vorbedingung und der Zustand null Kurse bleibt. Zweitens: Der Kurs entsteht zuerst über den Generator, mit protokollierten Tokens, Kosten und Dauer aus `ai_jobs`; bricht der Lauf ab, wird der Kurs am selben Tag von Hand fertig. Null `course_gen`-Aufträge nach zwei Monaten ist die Zahl, die im Verkaufsgespräch am meisten kostet.

Drittens: In den ersten 30 Tagen nur die Prozessarbeit, die Datenverlust oder einen unbemerkten Ausfall verhindert, also die Ränge 1, 5, 6 und 12. RLS-Negativtests, Coverage-Schwellen, `audit_log` und Aufbewahrungsfristen kommen in Woche 5 bis 8. Viertens: Beim Einfrieren der Zeiterfassung werden die zwei bereits erfassten Ist-Zeiten vorher als CSV außerhalb der Datenbank abgelegt, weil für sie die zweijährige Aufbewahrungspflicht gilt und das Einfrieren sonst selbst der Weg ist, auf dem sie verschwinden.

Zwei weitere Widersprüche bleiben Josips Entscheidung und stehen in Abschnitt 6: die Höhe der Einrichtungsgebühr und der Umgang mit dem Marketplace.

### 5.2 Sofort, diese Woche

1. **Branches zusammenführen und von `main` deployen.** `claude/ruflo-swarm-hierarchical-0trzqy` und `claude/contact-request-security-check-78qawq` nach `main` mergen, Konflikte in `PHASENSTATUS.md`, `messages/*.json` und `.env.example` auflösen, danach `npm run deploy` aus `main`. Den Marketing-Skills-Branch nur mergen, wenn die 483 Dateien unter `.claude/tools` gewollt sind; sonst schließen. Messbar: `git log origin/main` enthält e4352b5, Worker-Deploy-Zeitpunkt nach dem Merge.
2. **H3 beheben.** Migration `submit_quiz_attempt`: `member_role` durch `can_participate` ersetzen. Eine Zeile, vor dem nächsten Marketplace-Verkauf zwingend.
3. **K2 beheben.** Migration mit Spaltenrechten auf `tenants` und Guard-Trigger für die Betreiber-Schlüssel. Danach im Portal einmal prüfen, dass der Betreiber weiterhin alles setzen kann.
4. **K1 beheben.** Mitgliedschaft im Stripe-Webhook und bei der Selbstregistrierung anlegen. E2E-Fall dazu.
5. **H6 und H7 beheben.** Cron ruft zusätzlich `/api/admin/webhooks/retry`; alle `dispatchWebhookEvent`- und Push-Aufrufe in `after()`.
6. **H21 beheben.** `trial` in den vier Auflösungen wie `active` behandeln, `suspended` auf eine Sperrseite leiten. Eine Stunde Aufwand, verhindert, dass ein Klick im Portal einen Kunden offline nimmt.
7. **Live-Datenbank aufräumen und E2E-Konto sichern** (H25). Die 100 `testN@example.com`-Konten und die vier weiteren Testkonten ohne Mitgliedschaft löschen (`auth.admin.deleteUser`, Kaskade räumt `profiles` mit), vorher Liste exportieren. Das Passwort des Owner-Kontos `e2e-staff@example.test` in `demo-blau` rotieren oder das Konto löschen; `E2E_TEST_PASSWORD` verpflichtend machen.
8. **Backup heute** (H29). Bis zur Entscheidung über Supabase Pro einmalig `pg_dump` der Live-Datenbank in einen R2-Bucket mit `jurisdiction: eu`, danach täglich per Cron. Ein Datenverlust ist schon einmal eingetreten.
9. **Supabase-Dashboard.** Leaked-Password-Protection einschalten (seit 11.07. offen), Session-Timeouts setzen, Redirect-URLs für `*.calltalent.ai` und `salestalent.app` prüfen. Sammelmigration für die 17 `anon`-EXECUTE-Rechte (Ruflo Punkt 6.1).
10. **H30 beheben.** `Permissions-Policy` auf `camera=(self), microphone=(self)` ändern und eine Aufnahme im Browser testen. Eine Zeile; ohne sie ist die im Juli gebaute Videoaufnahme unbenutzbar.
11. **H35 beheben.** Den `week`-Parameter im Schichtplan und in der Schichtplanung auf ein gültiges Datum prüfen. Zwei Zeilen, verhindert eine Fehlerseite über die Adresszeile.
12. **H36 beheben.** Slug und Hostname in `resolveTenantByHost` gegen ein Zeichenmuster prüfen und die `or`-Zeichenkette durch zwei getrennte Abfragen ersetzen. Eine halbe Stunde, schließt den einzigen Verstoß gegen CLAUDE.md §2.12 im Code.
13. **KI-Modell und Kostensätze** (H10): `claude-sonnet-5`, `claude-haiku-4-5`, Preise aktualisieren, einen Generator-Lauf am echten PDF gegenprüfen. Dazu H18: Stale-Fenster auf 15 Minuten und Versuchszähler, damit kein Job endlos Kosten erzeugt.
14. **Barrierefreiheit für den täglichen Betrieb** (H20): Abmelden-Knopf auf `onClick`, Token `muted-400` und `muted-300` anheben, Skip-Link und `<main>` in beiden Shells, `prefers-reduced-motion`. Ein bis zwei Tage, spürbar bei jedem Login.

### 5.3 In 30 Tagen

15. **CI mit GitHub Actions.** Ein Workflow `ci.yml`: `npm ci`, `tsc --noEmit`, `eslint`, `vitest run` mit Platzhalter-Env; Branch-Schutz auf `main` (Pull Request und grüner Check Pflicht). Zweiter Workflow `deploy.yml`: bei Push auf `main` `opennextjs-cloudflare build && deploy` mit `CLOUDFLARE_API_TOKEN` als Repo-Secret. Damit ist `main` per Definition der deployte Stand. Messbar: jeder Commit auf `main` hat einen grünen Check, letzter Deploy-Commit = HEAD.
16. **Fehlerseiten und Fehlerspuren** (H31, H32, H33): `error.tsx` und `not-found.tsx` je Routengruppe, `global-error.tsx` im Root, `console.error` in `genericErrorMessage`, die 23 `tenant!`-Stellen absichern, Abfragefehler nicht mehr als Leerzustand rendern. Voraussetzung dafür, dass Monitoring überhaupt etwas sieht.
17. **Monitoring.** Cloudflare Workers Logs mit Alarm auf 5xx-Rate, Sentry (kostenlos bis 5.000 Ereignisse/Monat) über `@sentry/nextjs` für Server Actions und Route-Handler, ein Uptime-Check auf `https://academy.calltalent.ai/login` und `/api/stripe/webhook` (HEAD). Messbar: ein absichtlich erzeugter Fehler landet innerhalb von 5 Minuten als Nachricht bei Josip.
18. **Backups.** Entweder Supabase Pro (25 USD/Monat, tägliche Backups, 7 Tage) oder ein Cron-Job mit `pg_dump` in einen R2-Bucket mit `jurisdiction: eu`. Einmal Restore in eine Branch-DB üben. Messbar: ein datierter Dump liegt vor und wurde einmal eingespielt.
19. **H1 umsetzen** (Einschreibungs-Gating plus Abo-Entzug). Das ist die Voraussetzung, um überhaupt kostenpflichtige Kurse zu verkaufen. Reporting und Dashboard auf dieselbe Definition (H15).
20. **Stripe-Lebenszyklus schließen**: Rückerstattungen und Disputes (H11), Kundenportal mit Kündigungsknopf (H12), `payment_status` (H5), `livemode`-Prüfung und Produkte für den Live-Modus (M26), Fehler mit 500 statt 200 quittieren (M27), Widerrufsverzicht im Checkout (H14, vorher anwaltlich bestätigen lassen), `product_courses` mit Fremdschlüsseln statt `uuid[]` (H28), Retry-Zählung und Zustellprotokoll (M57). Zusammen drei bis vier Tage.
21. **H2, H4, H8** und aus 3.3 die Punkte M1, M4, M5, M8, M15, M16, M20, M23, M29, M30, M38 (jeweils Stunden bis ein Tag).
22. **Zeiterfassung vor dem ersten Lohnlauf** (H16, H17): `on delete restrict` plus Archivstatus, Zeiten-Ansicht mit Korrektur und CSV-Export, Auto-Close nach 14 Stunden. Ohne das darf kein Mandant den Schichtplan für echte Beschäftigte nutzen.
23. **KI-Kostendeckel** (H19): Minutenkontingent für Transkription je Plan, Kontingent nur bei Erfolg buchen (M38), Betreiber-Alarm.
24. **RLS-Negativtests** (M12) als Vitest-Suite gegen eine Supabase-Branch-Datenbank, in der CI laufend. Vorher die Migrationshistorie reparieren (H26): `supabase migration repair`, Dateien umbenennen, `supabase gen types` in die CI, E2E auf ein eigenes Projekt oder einen Branch umstellen (H25).
25. **Der erste echte Kurs.** Josip baut auf `academy.calltalent.ai` einen vollständigen Calltalent-Kurs (fünf Lektionen mit Video, ein Quiz, ein Zertifikat) und lässt drei echte Personen ihn durchlaufen, inklusive eines Testkaufs im Stripe-Testmodus. Jeder Stolperstein wird ein Ticket. Messbar: drei ausgestellte Zertifikate in `certificates`, eine `orders`-Zeile mit `paid`.
26. **Self-Service für den ersten Kunden** (H24, H23, H22): Rollenwahl bei Einladung und in der Teilnehmerliste, Kurs zuweisen und entziehen auf der Teilnehmer-Detailseite, Rechtsträger-Felder im Portal und im Admin, Löschantrag-Inbox mit Löschpfad. Messbar: Josip legt einen Pilotmandanten mit Branding, Impressum, einem Kurs, fünf Lernenden und Zuweisungen in unter 30 Minuten ohne SQL an.
27. **Onboarding-Checkliste im Admin-Dashboard**: fünf Schritte mit Haken (Logo, Farben, erster Kurs, erste Einladung, Rechtsträger), sichtbar bis alle erledigt sind. Dazu „Kurs anlegen" mit automatisch angelegtem Modul und Sektion (M25), und die Attrappen aus M45 entfernen.
28. **Wissensarchiv ordnen.** `PHASENSTATUS.md` einfrieren (Archiv), eine neue `STATUS.md` mit zwei Seiten: Was läuft, was ist offen, wie deployt man, wo liegen welche Schlüssel (ohne Werte). `README.md` auf den Ist-Zustand bringen.

### 5.4 In 90 Tagen

29. **Drei Pilotkunden.** Ein Mandant pro Monat mit echtem Vertrag, echten Inhalten und echter Rechnung. Vorher Trial-Ablauf (`tenants.trial_ends_at`, Erinnerungsmail, Sperre) und eine Preisseite. Die Abrechnung der Mandantenpakete zunächst manuell über Stripe Invoicing, erst bei zehn Mandanten automatisieren.
30. **Barrierefreiheit belegen.** axe-core in der Playwright-Suite für Login, Dashboard, Lernansicht, Kurs-Editor; die Befunde mit Josip als Betroffenem priorisieren. Das Barrierefreiheitsstärkungsgesetz gilt seit 28.06.2025 für B2C-Dienste; die Lernansicht auf `salestalent.app` fällt darunter, sobald Endkunden dort kaufen.
31. **Performance messen statt annehmen.** Lighthouse auf Login, Kurskatalog und Lektionsseite; Mandanten-Auflösung cachen (M7); Lektionsseite schlank laden (M24). Ziel laut CLAUDE.md §3.3: mobil ≥ 90.
32. **Kurs-Generator für DOCX und PPTX**, weil das die Inhalte der Zielgruppe sind. Ein Workers-tauglicher OOXML-Parser (`jszip` plus XML-Textextraktion) reicht für Text; Bilder später.
33. **Player vervollständigen** (M21): Wiederaufnahme, Kapitel, Tempo. Das ist der Teil, den Lernende täglich sehen.
34. **Mandanten-Selbstverwaltung im Portal**: Domain-Verknüpfung mit Cloudflare for SaaS per API statt Hand, Nutzungsübersicht (KI-Kosten je Mandant aus `ai_jobs`), Rechnungsliste.
35. **DSGVO-Paket zu Ende bauen** (H22, H23, H27, M13, M47, M48): `ON DELETE`-Regeln für die elf Fremdschlüssel auf `profiles`, vollständige Exporte über alle Tabellen mit `tenant_id`, Audit-Log-Schreiber in allen Admin- und Portal-Aktionen, Aufbewahrungsfristen (`rate_limits` 30 Tage, `webhook_deliveries` 90 Tage, Zeiterfassung 2 Jahre gesperrt), MFA und Papierkorb im Portal, Datenschutzerklärung nachziehen. Messbar: ein Löschantrag wird automatisiert innerhalb der Frist erfüllt.
36. **Benachrichtigungen, die Nutzung auslösen** (M46): Mails bei Kurs-Zuweisung, neuer Abgabe, Bewertung, Zertifikat, Kontingent 80 %, Planänderung; Bounce-Webhook; Reply-To je Mandant. Erst danach Glocke und Push aus derselben Ereignisquelle.

### 5.5 Einfrieren oder streichen

1. **Marketplace einfrieren**, bis der erste Mandant eigene kostenpflichtige Kurse verkauft. 0 Listings, offene Steuerfrage (Merchant of Record, SPEC §9.4), Käufer-Selbstregistrierung ungeklärt. Der Code bleibt, der Schalter bleibt aus.
2. **Schichtplan als getrenntes Produkt betrachten.** Er teilt mit dem LMS nur Auth und Mandanten. Entweder er bekommt eigene Vertriebsziele und eine eigene Roadmap, oder er wird nach Block S6 eingefroren. Beides ist vertretbar; parallel weiterzubauen, während der LMS-Kern ungenutzt ist, ist es nicht.
3. **Dritte und vierte Sprache** nicht vor dem ersten Kunden erweitern. Die Parität de/en/bs ist vollständig; jede weitere Funktion kostet drei Übersetzungen.
4. **Kunden-Area, Web-Push und PWA-Ausbau einfrieren.** Kein Prüfbereich hat die Kunden-Area als nötig für den ersten Kunden identifiziert; Push hat 0 Abonnements und ist auf Workers nie verifiziert. Ereignisse zuerst per Mail.
5. **Marketing-Skills-Branch nicht ins Produkt-Repo mergen.** 483 Dateien unter `.claude/tools` gehören in ein eigenes Repo, nicht in den Deploy-Pfad der Plattform.
6. **Kein weiterer Funktionsbereich** (Kommentare, Gamification, Lernpfade, SSO), bevor Position 25 erreicht ist.

---

## 6. Entscheidungen, die nur Josip treffen kann

1. **Zielkunde der nächsten 30 Tage.** Entweder ein B2B-Mandant mit eigenen Mitarbeitenden (interne Akademie, CSV-Import, „alle Kurse für alle") oder ein Kursverkäufer mit Endkunden (Einschreibungs-Gating, Stripe, Widerruf, Rechnung). Die Antwort bestimmt, ob Position 19 (Einschreibungs-Gating) oder Position 26 (Self-Service) zuerst kommt.
2. **Standardverhalten Kurszugriff.** „Alle veröffentlichten Kurse für alle Mitglieder" (heute) als Mandanten-Schalter behalten, oder Einschreibung als Standard; betrifft alle bestehenden Mandanten.
3. **Höhe der Einrichtungsgebühr.** Die README nennt 2.990 Euro Einrichtung plus 149 Euro im Monat. Der Produkt-Stratege will die Gebühr streichen, weil sie bei null Referenzen die größte Verkaufsbremse ist; der Markt-Stratege will genau diese Pakete aktiv verkaufen. Vorschlag des Panels: 490 Euro Einrichtung, ausgewiesen als Starterkurs, Branding und Datenmigration, dazu 14 Tage Trial ohne Karte. Null Euro macht die Migrationsarbeit unbezahlbar, 2.990 Euro verlangt Vertrauen, das ohne eine einzige Referenz nicht zu holen ist. Überprüft wird die Zahl beim ersten unterschriebenen Angebot, nicht vorher.
4. **Laufende Kosten.** Supabase Pro (25 USD/Monat: Backups, Session-Timeouts, keine Pausierung) und Cloudflare Workers Paid (5 USD/Monat: Build-Größe, Logs) freigeben, oder Backups per eigenem Cron lösen.
5. **Sprachen, die verkauft werden.** Nur Deutsch, Deutsch und Englisch, oder auch Bosnisch; bei Bosnisch sind eine inhaltliche Prüfung von `messages/bs.json` und die Lokalisierung von Admin, Editor und Zertifikat fällig.
6. Marketing-Skills-Branch mergen oder schließen (483 Dateien im Repo).
7. Stripe: nur Kartenzahlung zulassen oder asynchrone Zahlarten korrekt behandeln (H5).
8. Schichtplan: eigenes Produkt oder Einfrieren nach S6.
9. **Marketplace.** Einfrieren bis zur steuerlichen Klärung des Merchant-of-Record-Modells (SPEC §9.4). Der Produkt-Stratege hält dagegen, der Marketplace sei der einzige technisch vollständige Kaufweg und ein echter Ein-Euro-Verkauf dort der schnellste Beweis. Vorschlag des Panels: Direktweg im Stripe-Testmodus, Marketplace bleibt eingefroren und nur für Calltalent selbst freigeschaltet, bis der Steuerberater bestätigt hat. Ein echter Verkauf über ein steuerlich ungeklärtes Modell schafft eine Tatsache, die sich nachträglich nicht sauber korrigieren lässt. Die zwei Geldfehler im Marketplace (Preisänderung schlägt nicht nach Stripe durch, K2 erlaubt das Selbstsetzen der eigenen Provision) werden davon unabhängig sofort geschlossen.
10. Vertreter in der Union nach Art. 27 DSGVO benennen (offen seit 24.08.).
11. Anwaltliche Prüfung der AGB, Datenschutz und AVV vor dem ersten echten Kauf.
12. Trainer-Rolle: SPEC §2 durchsetzen (H8) oder SPEC an das heutige, weitere Rechtebild anpassen.
13. `login_copyright` für SalesTalent, Selbstregistrierung für Marketplace-Käufer (beides seit August offen).

---

## 7. Vorgehen und Grenzen dieser Analyse

1. **Ablauf.** Am 08.09.2026 ab 16:12 UTC: Repo geklont, Abhängigkeiten installiert, Baseline gefahren (tsc, ESLint, Vitest), Live-Datenbank und Cloudflare per MCP gelesen, die drei ungemergten Branches ausgewertet. Danach ein Agenten-Lauf über zunächst 14 Fachbereiche, jeder mit einem lesenden Prüfer und einem Gegenprüfer, dann ein Vollständigkeits-Kritiker, eine Nachrunde über zwei von ihm benannte Lücken und zuletzt ein Strategie-Panel aus drei Strategen und einem Juror.

2. **Was gelaufen ist.** Der Lauf wurde mehrfach vom Nutzungslimit unterbrochen und nach jedem Reset fortgesetzt, auf Josips Auftrag vom 09.09. („Wiederhole den Agentenlauf"). Alle 16 Bereichs-Prüfer sind durchgelaufen, zusammen 295 Funde nach Gegenprüfung. Jeder Bereich wurde von einem zweiten Agenten gegengeprüft, in zwei Schritten: technische Widerlegung am Code, danach die Frage nach „bereits erledigt oder bewusste Entscheidung". Ergebnis: 295 Funde geprüft, 290 bestätigt, 5 widerlegt (Anhang B). Schwere und Status im Anhang sind die vom Gegenprüfer korrigierten Werte. Der Vollständigkeits-Kritiker fand selbst zwei Befunde (H30 und H31) und benannte zwei ungeprüfte Bereiche: die Browser-Medienpipeline des Editors und die Fehler- und Ausnahmezustände. Für beide lief eine Nachrunde aus Prüfer und Gegenprüfer; daraus stammen H32 bis H36 und M66 bis M75. Zum Schluss bewerteten drei Strategen dieselbe Faktenlage aus getrennten Blickwinkeln (erster zahlender Kunde, Betriebssicherheit, Produkt-Differenzierung); ein Juror bewertete die drei Vorschläge nach Konkretheit, Wirkung und Realismus, entschied acht Widersprüche und bildete die Rangfolge in Abschnitt 5.1.

3. **Eigene Prüfung.** Unabhängig von den Agenten habe ich alle kritischen und hohen Befunde aus RLS, Auth, API und Kursen selbst am Code nachvollzogen, ebenso H11, H12, H16, H18, H20, H21, H22, H25, H29 bis H36, M26, M49, M67 und M71 bis M75 sowie die Kontrastwerte der Marken-Tokens.

4. **Widersprüche zwischen Agenten** habe ich aufgelöst, nicht gemittelt; die Widersprüche zwischen den drei Strategen hat der Juror entschieden, seine Begründungen stehen in Abschnitt 5.1 und Abschnitt 6. Beispiel: Zum Zustand der Playwright-Suite behauptete ein Prüfer „seit 05.08. rot", ein anderer verwies auf den Eintrag, dass alle zehn Fehler an genau diesem Tag behoben wurden. Die belegbare Fassung steht in H25: behoben ja, ein vollständiger grüner Lauf seither nirgends dokumentiert.

5. **Nicht geprüft.** Playwright-Suite (keine `.env`, kein Dev-Server in dieser Umgebung), Lighthouse und LCP, ein echter Stripe-Testkauf, Bunny-Upload und Transkription, der Deploy-Ablauf, die Word-Dokumente (AVV, TOM), der Website-Branch im Repo `calltalent-website`, die Inhalte von `messages/bs.json` über Stichproben hinaus.

6. **Live-Zugriff.** Nur lesend: Advisor, Migrationsliste, Zeilenzahlen, Mandantenliste, Muster der Auth-Konten. In Supabase, Cloudflare und im Zweig `main` wurde nichts verändert.

7. **Vorarbeit.** Der Ruflo-Bericht vom 07.09. (Branch `claude/ruflo-swarm-hierarchical-0trzqy`, PHASENSTATUS-Abschnitt „Projektrevision 07.09.2026") war Ausgangspunkt. Seine 18 offenen Code-Punkte und 15 Punkte für Josip gelten weiter und sind hier nicht wiederholt, außer wo sich Schwere oder Lösung geändert hat.

---

## Anhang A: Alle Funde der Bereichs-Prüfer

295 Funde aus 16 Bereichen nach Gegenprüfung, sortiert nach Schwere: kritisch 3, hoch 47, mittel 151, niedrig 94. Gegengeprüft wurden 295 Funde (290 bestätigt, der Rest unklar); Bereiche mit Gegenprüfung: API, Auth, Datenmodell, Fehlerzustände, KI, Kurse, Medienpipeline, Performance, Portal, Produkt, Quiz, RLS, Schichtplan, Toolchain, Zahlungen, i18n/A11y. Spalte Prüfung: bestätigt = Gegenprüfer hat den Effekt selbst nachvollzogen; unklar = nicht abschließend; nicht geprüft = Gegenprüfer ausgefallen. Status: neu = in diesem Lauf erstmals belegt; bekannt = stand im Ruflo-Bericht vom 07.09.; Branch = auf einem ungemergten Branch behoben. Schwere und Status sind die vom Gegenprüfer korrigierten Werte.

| Bereich | Schwere | Art | Status | Prüfung | Fundstelle | Titel |
|---|---|---|---|---|---|---|
| RLS | kritisch | bug | neu | bestätigt | `src/app/api/stripe/webhook/route.ts:175` | Stripe-Kauf im Mandanten-Storefront ohne bestehende Mitgliedschaft: Käufer zahlt, bekommt aber keinen Zugriff |
| RLS | kritisch | bug | neu | bestätigt | `supabase/migrations/0001_init.sql:442` | `tenants_admin_update` ohne Spaltenbeschränkung: Mandanten-Admin kann plan/status/custom_domain/slug und Betreiber-Schalter (inkl. eigener Provision) selbst setzen, fremde Subdomains lahmlegen |
| Zahlungen | kritisch | bug | neu | bestätigt | `src/app/api/stripe/webhook/route.ts:229` | Käufer ohne Mitgliedschaft (Selbstregistrierung über /kaufen) erhält nach Zahlung keinen Kurszugriff |
| API | hoch | bug | neu | bestätigt | `src/app/api/stripe/webhook/route.ts:64` | Stripe: checkout.session.completed wird ohne payment_status-Prüfung erfüllt; Async-Zahlungen (SEPA, Klarna, Überweisung) nicht behandelt |
| Auth | hoch | risk | neu | bestätigt | `src/app/auth/callback/page.tsx:141` | Session-Cookies sind nicht httpOnly und 400 Tage gültig: CLAUDE.md §2.13 beschreibt ein Verhalten, das @supabase/ssr nicht hat |
| Auth | hoch | gap | bekannt | bestätigt | `src/middleware.ts:206` | Session-Ablauf (§2.8) weiterhin unkonfiguriert: Cookie 400 Tage, Refresh-Token ohne Ablauf, keine Code-Kompensation |
| Auth | hoch | risk | Branch | bestätigt | `src/middleware.ts:51` | Drei Auth-Sicherheitsfixes liegen nur auf dem ungemergten ruflo-Branch (Header-Spoofing, Logout-CSRF, Einladungs-Rate-Limit) |
| Datenmodell | hoch | risk | neu | bestätigt | `supabase/migrations/0001_init.sql:1` | Migrationshistorie Repo vs. Live ist auseinandergelaufen: `supabase db push` würde 0001_init erneut anwenden und abbrechen |
| Datenmodell | hoch | risk | neu | bestätigt | `SPEC.md:69` | Kein Backup, kein Restore-Test, keine Down-Migrationen – ein Datenverlust ist bereits einmal unbemerkt eingetreten |
| Datenmodell | hoch | risk | neu | bestätigt | `.env.example:2` | Entwicklung, Tests und Playwright laufen gegen die Produktionsdatenbank – keine lokale/Staging-DB, kein seed.sql |
| Datenmodell | hoch | bug | neu | bestätigt | `supabase/migrations/0001_init.sql:94` | Nutzerlöschung ist technisch blockiert (11 FKs auf profiles ohne ON-DELETE-Regel) und im Produkt gar nicht vorhanden |
| Datenmodell | hoch | bug | neu | bestätigt | `supabase/migrations/0001_init.sql:238` | products.course_ids als uuid[] ohne referenzielle Integrität – live zeigt ein Produkt bereits auf einen nicht existenten Kurs |
| Fehlerzustände | hoch | bug | neu | bestätigt | `src/lib/errors/generic.ts:18` | Stille Fehlerverluste: 80 von 88 catch-Blöcken protokollieren in Produktion nichts |
| Fehlerzustände | hoch | bug | neu | bestätigt | `next.config.ts:25` | Permissions-Policy schaltet Kamera und Mikrofon ab: Video-Aufnahme ist in Produktion tot, die Fehlermeldung führt in eine Sackgasse |
| Fehlerzustände | hoch | bug | neu | bestätigt | `src/components/learn/quiz-runner.tsx:87` | Prüfungsabgabe und Lektions-Autosave fangen abgebrochene Server-Action-Aufrufe nicht ab: Arbeitsverlust ohne Fehlermeldung |
| KI | hoch | bug | Branch | bestätigt | `src/lib/generator/apply.ts:193` | Doppelklick auf 'Entwurf übernehmen' legt den Kurs zweimal an (appliedCourseId-Marker wird nie geschrieben) |
| Kurse | hoch | bug | neu | bestätigt | `src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx:88` | Lektionsreihenfolge in der Lernansicht falsch bei mehreren Sektionen pro Modul (Positionen sektionsweit, Sortierung modulweit) |
| Kurse | hoch | gap | neu | bestätigt | `supabase/migrations/0001_init.sql:465` | Kein Einschreibungs-Gating: jedes aktive Mitglied sieht und absolviert jeden veröffentlichten Kurs des Mandanten |
| Medienpipeline | hoch | bug | neu | bestätigt | `next.config.ts:25` | Eigener Security-Header sperrt Kamera und Mikrofon der eigenen App aus: Aufnahme startet seit 08.08.2026 nicht mehr |
| Portal | hoch | bug | neu | bestätigt | `src/lib/tenant/resolve.ts:137` | Portal-Status „Trial“ schaltet die Akademie ab; „Gesperrt“ zeigt Dev-Hinweis statt Sperrseite; API-Keys gesperrter Mandanten laufen weiter |
| Portal | hoch | gap | neu | bestätigt | `src/app/profil/actions.ts:63` | Art. 17: Löschanträge werden nie bearbeitet: es existiert im gesamten Code kein Pfad, der ein Nutzerkonto löscht |
| Portal | hoch | gap | neu | bestätigt | `supabase/migrations/0001_init.sql:19` | Keine Abrechnung der Mandanten: kein Trial-Ablauf, keine Rechnungsdaten, kein Abo je Mandant (149/249 €) |
| Portal | hoch | gap | neu | bestätigt | `src/app/portal/mandanten/[id]/export/route.ts:102` | Beide DSGVO-Exporte unvollständig: Mandanten-Export ohne 22 tenant_id-Tabellen (u. a. alle calendar_*), Selbst-Export ohne Lesezeichen/Push/Löschanträge |
| Portal | hoch | risk | neu | bestätigt | `src/app/(legal)/layout.tsx:38` | Neue Mandanten haben kein Impressum/Datenschutz (404): tenants.legal.entity ist weder im Portal noch im Admin pflegbar |
| Produkt | hoch | improvement | neu | bestätigt | `src/app/(admin)/admin/page.tsx:273` | Kein geführter Erststart: Kurs-Generator (USP) nie produktiv gelaufen, kein Onboarding, keine Demo-Inhalte, keine Vorlagen |
| Quiz | hoch | bug | neu | bestätigt | `supabase/migrations/20260907091500_quiz_attempt_limit_rpc.sql:65` | Ruflo-Branch: RPC submit_quiz_attempt sperrt Marketplace-Gäste vom Quiz aus (Regression) |
| Quiz | hoch | bug | neu | bestätigt | `src/lib/reporting/queries.ts:299` | Reporting zählt nur Einschreibungen, Lernzugang ist aber nicht einschreibungsgebunden – Lernende fehlen im Bericht |
| RLS | hoch | gap | neu | bestätigt | `supabase/migrations/0001_init.sql:465` | Einschreibungen steuern für reguläre Mitglieder keinen Zugriff: jedes Mitglied sieht alle veröffentlichten Kurse, Abo-Kündigung entzieht nichts |
| RLS | hoch | bug | neu | bestätigt | `supabase/migrations/20260907091500_quiz_attempt_limit_rpc.sql:65` | Regression auf dem Ruflo-Branch (live angewendet): `submit_quiz_attempt` sperrt Marketplace-Gäste vom Quiz aus |
| RLS | hoch | bug | neu | bestätigt | `supabase/migrations/0001_init.sql:511` | Lernende können Prüfungsergebnis (`attempts.passed/score_pct`) und Abgabe-Bewertung (`submissions.status/grade/reviewed_by`) per RLS selbst schreiben |
| RLS | hoch | gap | neu | bestätigt | `supabase/migrations/20260712234600_rls_consolidate_part_b.sql:51` | Trainer-Rechte weit über SPEC §2 hinaus: Produkte/Preise anlegen, Bestellungen lesen, Einschreibungen verwalten, Kurse löschen, Marketplace-Listings einreichen |
| RLS | hoch | gap | bekannt | bestätigt | `supabase/migrations/20260712234600_rls_consolidate_part_b.sql:127` | `progress_own_insert/update` ohne Mandanten-, Lektions- und Einschreibungsbindung: Basis für Selbst-Zertifizierung und Cross-Tenant-Reporting-Verschmutzung |
| Schichtplan | hoch | risk | neu | bestätigt | `supabase/migrations/20260807142619_shift_calendar.sql:348` | Arbeiter/Mitgliedschaft löschen vernichtet Zeiterfassung per FK-Cascade (§ 16 Abs. 2 ArbZG, 2 Jahre Aufbewahrung) |
| Schichtplan | hoch | gap | neu | bestätigt | `src/lib/calendar/queries.ts:128` | Keine Admin-Ansicht, Korrektur, Genehmigung oder Export der Zeiterfassung: Ist-Zeiten sind für niemanden sichtbar |
| Toolchain | hoch | gap | neu | bestätigt | `package.json:14` | Keine CI-Pipeline, kein Branch-Schutz, Deploy-Skript ohne Qualitätstor |
| Toolchain | hoch | risk | neu | bestätigt | `-:-` | main ist nicht der deployte Stand; drei ungemergte Branches; Live-Migrationen aus ungemergtem Branch |
| Toolchain | hoch | risk | neu | bestätigt | `e2e/helpers/test-data.ts:21` | E2E-Suite läuft gegen die Produktionsdatenbank mit service_role: kein Staging |
| Toolchain | hoch | risk | neu | bestätigt | `e2e/global-setup.ts:28` | Owner-Konto `e2e-staff@example.test` mit im Repo hinterlegtem Standardpasswort im Live-Mandanten demo-blau |
| Toolchain | hoch | risk | Branch | bestätigt | `package.json:27` | `next` 16.2.10 mit kritischen Schwachstellen (Proxy-Bypass, DoS, SSRF) auf main |
| Zahlungen | hoch | bug | neu | bestätigt | `src/app/api/stripe/webhook/route.ts:146` | Webhook ignoriert payment_status: Zugriff und orders.status='paid' vor Zahlungseingang bei verzögerten Zahlarten |
| Zahlungen | hoch | bug | neu | bestätigt | `src/app/api/stripe/webhook/route.ts:64` | Keine Verarbeitung von Rückerstattungen und Disputes: Status, Ledger und Zugriff bleiben unverändert |
| Zahlungen | hoch | bug | neu | bestätigt | `src/lib/marketplace/actions.ts:275` | Marketplace: Preisänderung eines Listings nach Stripe-Produktanlage wird nicht synchronisiert – Anzeigepreis ≠ Abbuchung |
| Zahlungen | hoch | gap | bekannt | bestätigt | `src/lib/stripe/checkout.ts:122` | Keine Rechnungsstellung und keine Steuerberechnung im Checkout trotz Merchant-of-Record-Modell |
| Zahlungen | hoch | gap | neu | bestätigt | `src/lib/stripe/portal.ts:231` | Stripe-Kundenportal ist nirgends erreichbar – Abo-Kunden können nicht kündigen (kein Kündigungsbutton §312k BGB) |
| Zahlungen | hoch | risk | neu | bestätigt | `src/app/api/stripe/webhook/route.ts:389` | Abo-Ende oder Zahlungsausfall entzieht keinen Kurszugriff – Ein-Monats-Zahlung ergibt dauerhaften Zugang |
| Zahlungen | hoch | gap | neu | bestätigt | `supabase/migrations/0001_init.sql:465` | Bezahlte Produkte gewähren Mitgliedern nichts Exklusives: RLS erlaubt jedem aktiven Mitglied alle veröffentlichten Kurse ohne Einschreibung |
| Zahlungen | hoch | risk | neu | bestätigt | `src/lib/stripe/checkout.ts:122` | Widerrufsverzicht nach §356 Abs. 5 BGB wird nicht eingeholt; Marketplace-AGB behaupten, der Kauf sei noch nicht freigeschaltet |
| Zahlungen | hoch | gap | bekannt | bestätigt | `src/app/marketplace/kurs/[slug]/page.tsx:119` | Marketplace-Selbstregistrierung fehlt – 'erwerbbar für jeden' ist nicht einlösbar, Kaufbutton endet in einer Mail an office@ |
| i18n/A11y | hoch | bug | neu | bestätigt | `src/app/globals.css:1` | Fokusring 1,78:1 statt 3:1, `focus:outline-none` ohne Ersatz im Kontrastmodus, `focus:` statt `focus-visible:` |
| i18n/A11y | hoch | bug | neu | bestätigt | `src/app/globals.css:55` | Kontrast der Marken-Tokens für Sekundärtext, Sidebar-Gruppentitel und Eingabefeld-Rahmen unter WCAG AA: sitesweit, Marketplace |
| API | mittel | gap | neu | bestätigt | `custom-worker.ts:70` | Webhook-Wiederholungen finden nie statt: Cron ruft nur /api/admin/ki/process, nie /api/admin/webhooks/retry |
| API | mittel | risk | neu | unklar | `src/lib/progress/actions.ts:46` | Fire-and-forget ohne after()/waitUntil: ausgehende Webhooks und Push können auf Cloudflare Workers nach dem Response abgebrochen werden |
| API | mittel | bug | neu | bestätigt | `src/app/api/v1/users/route.ts:121` | POST /api/v1/users legt Nutzer ohne Willkommens-/Zugangsmail an; per Zapier angelegte Personen können sich nicht anmelden |
| API | mittel | risk | neu | bestätigt | `src/app/api/bunny/webhook/route.ts:92` | Bunny-Webhook Status 3 startet kostenpflichtige Transkription für jedes Video ohne Lektions-/Mandantenbezug, Sprache fest auf 'de' |
| API | mittel | gap | neu | bestätigt | `-:-` | Keine API-/Webhook-Dokumentation (Zapier/Make-Doku laut SPEC §3 Should fehlt vollständig) |
| API | mittel | gap | neu | bestätigt | `src/components/admin/webhooks-panel.tsx:6` | Kein Zustellprotokoll und kein Test-Ereignis für Webhooks im Admin |
| API | mittel | bug | bekannt | bestätigt | `src/app/api/stripe/webhook/route.ts:195` | Stripe: sendOrderPaidMail nicht idempotent, isNewOrder-Prüfung mit Race bei paralleler Zustellung |
| API | mittel | improvement | neu | bestätigt | `src/app/api/stripe/webhook/route.ts:389` | Abo-Kündigung und past_due entziehen keinen Zugriff; enrollments.expires_at wird nie gesetzt und in der Lernansicht nicht geprüft |
| API | mittel | gap | neu | bestätigt | `src/app/api/stripe/webhook/route.ts:31` | Keine automatisierten Tests für Route-Handler, Stripe-/Bunny-Webhooks und API-Key-Auth |
| Auth | mittel | bug | neu | bestätigt | `src/lib/auth/actions.ts:182` | Selbstregistrierung legt keine Mitgliedschaft an: Nutzer landen in leerem Dashboard, Admin sieht sie nie |
| Auth | mittel | gap | neu | bestätigt | `src/lib/auth/actions.ts:94` | Login und Lernbereich prüfen keine Mitgliedschaft/Status im aktuellen Mandanten |
| Auth | mittel | bug | neu | bestätigt | `src/lib/marketplace/redirect.ts:21` | Open-Redirect-Prüfung resolveSafeNextParam ist mit Backslash umgehbar: betrifft Marketplace-Login (main) und den ruflo-Callback-Fix |
| Auth | mittel | gap | neu | bestätigt | `src/lib/auth/actions.ts:252` | Bot-Schutz §2.7: Registrierung, Magic-Link und Passwort-Reset nur mit IP-Rate-Limit, kein CAPTCHA/Honeypot: Turnstile liegt fertig auf dem Contact-Branch |
| Auth | mittel | risk | neu | bestätigt | `src/lib/auth/actions.ts:429` | Neues Passwort ohne Re-Authentifizierung: /passwort-setzen akzeptiert jede angemeldete Session, keine Info-Mail, keine Abmeldung anderer Geräte |
| Auth | mittel | risk | neu | bestätigt | `src/lib/tenant/routing.ts:122` | Wartungsmodus sperrt Impressum, Datenschutz, AGB, Kontakt und Rechtsseiten mit 503 |
| Auth | mittel | bug | bekannt | bestätigt | `src/lib/auth/actions.ts:272` | Magic-Link und Passwort-Reset auf Portal-/Marketplace-Host springen auf die Site-URL: NEXT_PUBLIC_SITE_URL ist unvalidiert und im Prod-Setup unbekannt |
| Auth | mittel | improvement | neu | bestätigt | `src/app/auth/callback/page.tsx:126` | E-Mail-Links auf token_hash + serverseitiges verifyOtp umstellen: löst Redirect-Allowlist, Portal-Magic-Link, Fragment-Tokens und httpOnly auf einmal |
| Auth | mittel | gap | neu | bestätigt | `src/lib/auth/actions.ts:1` | Keine automatisierten Tests für Auth-Actions, Account-Actions und Security-Helfer; E2E-Auth-Suite besteht aus einem Render-Test |
| Auth | mittel | risk | neu | bestätigt | `src/lib/auth/actions.ts:191` | Registrierung verrät bestehende Konten („existiert bereits"): Verstoß gegen §2.15 Enumeration |
| Auth | mittel | gap | neu | bestätigt | `src/lib/account/actions.ts:88` | lib/account/actions.ts ohne zod-Validierung (§2.3), changeEmail reicht rohes error.message an die Oberfläche |
| Datenmodell | mittel | improvement | neu | bestätigt | `src/lib/supabase/server.ts:14` | Keine generierten DB-Typen: 53 handgeschriebene Row-Typen, Schema-Abweichungen fallen erst zur Laufzeit auf |
| Datenmodell | mittel | gap | neu | bestätigt | `supabase/migrations/20260710235500_rate_limits.sql:6` | Keine Aufräum-/Retention-Jobs: rate_limits, ai_jobs, tutor_messages und webhook_deliveries wachsen unbegrenzt |
| Datenmodell | mittel | gap | neu | bestätigt | `supabase/migrations/0001_init.sql:384` | audit_log existiert seit 0001, wird aber nirgends geschrieben |
| Datenmodell | mittel | bug | neu | bestätigt | `src/app/api/stripe/webhook/route.ts:367` | Stripe-Abo-Status wird verlustbehaftet auf die 3-Werte-CHECK gepresst; orders-Status refunded/failed werden nie gesetzt |
| Fehlerzustände | mittel | gap | neu | bestätigt | `src/app:-` | Keine error.tsx / global-error.tsx / not-found.tsx im gesamten Projekt |
| Fehlerzustände | mittel | bug | neu | bestätigt | `src/app/(portal)/schichtplan/page.tsx:74` | ?week=2026-13-45 wirft einen RangeError und erzeugt eine 500-Seite (Schichtplan und Schichtplanung) |
| Fehlerzustände | mittel | bug | neu | bestätigt | `src/app/(admin)/admin/reporting/page.tsx:62` | 23 Seiten greifen mit tenant!.id auf einen möglicherweise nicht aufgelösten Mandanten zu, obwohl fünf Schwesterseiten das ausdrücklich defensiv lösen |
| Fehlerzustände | mittel | gap | neu | bestätigt | `src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx:55` | Kein einziger Ladezustand: 13 sequenzielle Server-Rundläufe je Lektionsseite ohne loading.tsx oder Suspense |
| Fehlerzustände | mittel | bug | neu | bestätigt | `public/sw.js:15` | Service Worker cacht personalisiertes HTML unter dem Schlüssel "/" und liefert dadurch nie einen Offline-Zustand |
| Fehlerzustände | mittel | risk | neu | bestätigt | `src/app/page.tsx:23` | Die interne Dev-Root-Seite mit localhost-Beispielen ist der Ausfallzustand der Produktionsdomain |
| Fehlerzustände | mittel | bug | neu | bestätigt | `src/app/(learn)/kurs/[slug]/page.tsx:106` | 96 Datenbankabfragen in Seiten werten den error-Rückgabewert nicht aus: ein Abfragefehler wird als „leer" gerendert |
| Fehlerzustände | mittel | improvement | neu | bestätigt | `src/app:-` | Kein Health-Endpunkt und keine Benachrichtigung: ein Ausfall bleibt unbemerkt, bis ein Kunde anruft |
| KI | mittel | risk | neu | bestätigt | `src/lib/generator/process.ts:30` | Stale-Running-Fenster (3 Min) kürzer als maximale Schrittdauer und kein Versuchszähler: Doppelverarbeitung und potenziell endlose kostenpflichtige Wiederholung |
| KI | mittel | risk | neu | bestätigt | `src/lib/video/transcript.ts:118` | Kein Kostendeckel für nicht-kontingentierte KI-Posten (Bunny-Transkription 0,10 $/Min, Haiku-Übersetzung, Zusammenfassung, Embeddings) |
| KI | mittel | bug | neu | bestätigt | `src/lib/tutor/actions.ts:182` | Kontingent wird auch bei fehlgeschlagenem KI-Aufruf verbraucht (Voyage-/Anthropic-Ausfall, Parse-Fehler) |
| KI | mittel | bug | neu | bestätigt | `src/lib/tutor/actions.ts:212` | Tutor sendet keinen Gesprächsverlauf an Claude; Datenschutzerklärung behauptet das Gegenteil; Verlauf geht bei Reload verloren |
| KI | mittel | risk | neu | bestätigt | `supabase/migrations/20260711164838_match_embeddings.sql:61` | Kein Ähnlichkeits-Schwellenwert im RAG: Off-Topic-Erkennung hängt allein am Prompt, Quellen werden auch bei 'Das steht nicht im Kurs' angezeigt |
| KI | mittel | improvement | neu | bestätigt | `src/lib/ai/config.ts:10` | Modell-IDs zwei Generationen alt, Preis-Konstante laut eigenem Kommentar seit 31.08.2026 abgelaufen, SDK veraltet |
| KI | mittel | gap | neu | bestätigt | `src/lib/ai/actions.ts:10` | Embeddings entstehen nur per manuellem Knopf, nie beim Veröffentlichen; Video-Transkripte werden nie eingebettet (Tutor/Suche blind für Videokurse) |
| KI | mittel | gap | neu | bestätigt | `src/app/(learn)/suche/page.tsx:21` | Semantische Suche /suche ist in keiner Navigation verlinkt |
| KI | mittel | gap | neu | bestätigt | `src/lib/ai/usage.ts:154` | Eigenständiger Quiz-Generator (SPEC §6, ai_jobs.kind='quiz_gen') fehlt vollständig |
| KI | mittel | gap | neu | bestätigt | `src/app/api/admin/ki/generate/route.ts:61` | Kurs-Generator akzeptiert nur eine Datei je Auftrag und kürzt still auf 60.000 Zeichen (Hinweis geht verloren) |
| KI | mittel | improvement | neu | bestätigt | `src/lib/ai/config.ts:63` | Zusatzkontingent (SPEC: 29 €/1.000) und Vorwarnung bei Erschöpfung fehlen: Tutor schaltet hart ab, kein Upsell-Pfad |
| KI | mittel | bug | Branch | bestätigt | `src/lib/generator/process.ts:59` | CAS-Sperre der drei Job-Prozessoren wirkungslos: überlappende Cron-Aufrufe starten denselben Claude-Schritt doppelt |
| Kurse | mittel | gap | neu | bestätigt | `src/components/admin/module-lesson-tree.tsx:389` | Lektionen lassen sich nicht umsortieren oder in eine andere Sektion verschieben; kein Drag & Drop (SPEC 4.2) |
| Kurse | mittel | gap | neu | bestätigt | `src/lib/progress/actions.ts:33` | Fortschritt ist reine Selbstauskunft: keine Video-Mindestansicht, keine Reihenfolge-Erzwingung, kein Drip-Content |
| Kurse | mittel | gap | neu | bestätigt | `src/components/player/bunny-player.tsx:82` | Player ohne Wiederaufnahme-Position, ohne klickbare Kapitel, ohne Autoplay-/Tempo-Steuerung; progress 'started' wird nie geschrieben |
| Kurse | mittel | risk | bekannt | bestätigt | `src/lib/progress/actions.ts:33` | completeLesson übernimmt lessonId/courseSlug ungeprüft (kein Mandanten-, Kurs- oder Status-Check) |
| Kurse | mittel | risk | bekannt | bestätigt | `src/lib/courses/actions.ts:843` | Bunny-Videos werden beim Löschen von Lektion/Modul/Kurs/Block und beim Video-Austausch nie gelöscht |
| Kurse | mittel | bug | neu | bestätigt | `src/components/editor/block-editor.tsx:96` | Autosave verliert Änderungen bei Navigation innerhalb des 1-s-Debounce; keine Serialisierung paralleler Speicherungen, kein Konfliktschutz |
| Kurse | mittel | risk | neu | bestätigt | `src/components/learn/block-renderer.tsx:222` | Einbettungs-Block rendert beliebige iframe-URLs ohne sandbox/Allowlist; Bild/Audio/Datei/Embed erlauben http:-URLs |
| Kurse | mittel | improvement | neu | bestätigt | `src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx:84` | Lektionsseite lädt bei jedem Aufruf alle Lektionen des Kurses inklusive blocks, transcript und summary |
| Kurse | mittel | improvement | neu | bestätigt | `src/lib/courses/actions.ts:799` | Pflicht-Hierarchie Kurs -> Modul -> Sektion -> Lektion verletzt die 3-Klick-Regel; keine sinnvollen Standardwerte |
| Kurse | mittel | gap | neu | bestätigt | `src/components/admin/course-editor-steps.tsx:96` | Keine Vorschau im Kurs-Editor; Entwurfs-Lektionen sind für Staff nirgends als Lernender ansehbar (SPEC 4.2) |
| Kurse | mittel | improvement | neu | bestätigt | `src/lib/courses/actions.ts:51` | Kein Kurs-Duplizieren, keine Kursvorlagen, kein Kurs-Export (nur Import) |
| Kurse | mittel | gap | neu | bestätigt | `src/lib/courses/schema.ts:69` | Alt-Text ist im Editor als Pflicht beschriftet, wird aber nicht erzwungen (WCAG 1.1.1) |
| Medienpipeline | mittel | bug | neu | bestätigt | `src/components/editor/video-trimmer.tsx:791` | „Ohne Zuschnitt hochladen" im Trimmer umgeht remuxFix: der Juli-Produktionsfehler „Video hängt bei Bunny im Processing" ist auf diesem Weg weiterhin erreichbar |
| Medienpipeline | mittel | bug | neu | bestätigt | `src/lib/bunny/use-bunny-upload.ts:137` | Laufender TUS-Upload ist nicht abbrechbar, reset() gibt den Reentrancy-Schutz frei zu parallele Uploads und mehrere kostenpflichtige Bunny-Videos |
| Medienpipeline | mittel | bug | bekannt | bestätigt | `src/lib/video/recorder.ts:65` | MP4-Aufnahmen (Safari/iOS) laufen in eine hart auf WebM verdrahtete Pipeline: Schnitt scheitert immer, Datei bekommt die falsche Endung |
| Medienpipeline | mittel | gap | bekannt | bestätigt | `e2e/:1` | Keinerlei E2E- oder Komponententests der Kette Aufnahme zu Schnitt zu Übergabe; die getesteten Teile sind genau die, die nie ausfallen |
| Medienpipeline | mittel | risk | neu | bestätigt | `src/app/api/ffmpeg/[file]/route.ts:78` | /api/ffmpeg/[file]: öffentliche 31-MB-Route ohne Rate-Limit; Cache-Control wirkt nicht am Edge, jeder Abruf kostet zusätzlich eine Supabase-Abfrage |
| Medienpipeline | mittel | gap | neu | bestätigt | `src/components/editor/video-recorder.tsx:608` | Bis zu 20 Minuten Aufnahme leben ausschließlich im RAM: kein beforeunload, keine Zwischenspeicherung, kein Download |
| Medienpipeline | mittel | gap | neu | bestätigt | `src/components/editor/video-trimmer.tsx:996` | Keine hörbare Rückmeldung während des Schnitts; Tastatur-/Screenreader-Durchlauf des Aufnahme-Editors ist seit 17.07.2026 nie erfolgt |
| Medienpipeline | mittel | bug | neu | bestätigt | `src/components/learn/video-processing-status.tsx:51` | VideoProcessingStatus pollt ohne Obergrenze und ohne Backoff: ein verwaistes Video hält jeden offenen Lernenden-Tab dauerhaft am Bunny-API |
| Performance | mittel | bug | neu | bestätigt | `src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx:81` | Lektionsseite lädt alle Lektionen des Kurses inklusive blocks, transcript, summary und chapters, nur um Navigation und Fortschritt zu bauen |
| Performance | mittel | bug | neu | bestätigt | `src/lib/platform/auth.ts:30` | getUser()-Netzwerk-Rundlauf bis zu vier Mal pro Lern-Seite: Performance-Fix vom 19.07. nur in 4 Seiten umgesetzt |
| Performance | mittel | gap | neu | bestätigt | `src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx:67` | Kein Streaming, keine Parallelisierung: 8–12 sequenzielle Datenbank-Rundläufe pro Lern-Seite blockieren den ersten Byte |
| Performance | mittel | gap | neu | bestätigt | `open-next.config.ts:8` | Edge-Cache für Lerninhalte (SPEC §Nicht-funktional, CLAUDE.md §3.3) existiert nicht einmal als Mechanismus: 0 statische/cachebare Routen, kein Incremental Cache |
| Performance | mittel | risk | neu | bestätigt | `SPEC.md:69` | Supabase Free Tier trägt die SPEC-Zusagen (99,5 % Verfügbarkeit, tägliche Backups/PITR) nicht: keine Plan-Entscheidung dokumentiert |
| Performance | mittel | improvement | neu | bestätigt | `src/middleware.ts:72` | Middleware macht pro Request zwei serielle Netzwerkaufrufe (Tenant-Lookup + getUser) ohne jeden Cache |
| Performance | mittel | improvement | neu | bestätigt | `wrangler.jsonc:13` | Smart Placement nicht konfiguriert: Worker läuft beim Nutzer, die Datenbank in Frankfurt, dazwischen 8–12 serielle Rundläufe |
| Performance | mittel | gap | neu | bestätigt | `src/components/learn/block-renderer.tsx:101` | Bilder: 25 <img> ohne width/height, ohne lazy-loading, ohne Skalierung: Cover bis 8 MB und Bunny-Thumbnails in Vollgröße für 56×38-px-Kacheln |
| Performance | mittel | improvement | bekannt | bestätigt | `src/lib/certificates/pdf.ts:5` | Worker-Größe erstmals vermessen: 19,5 MiB unkomprimiert / 4,5 MiB gzip: Paid-Plan-Entscheidung wegen Größenlimit ist seit 04.09.2026 hinfällig, 1,2 MB davon sind doppelt gebündelte Base64-Schrift |
| Portal | mittel | bug | neu | bestätigt | `src/lib/users/import.ts:105` | CSV-Import: Willkommensmails aller Zeilen gleichzeitig: scheitert am Resend-Limit, unsichtbar in der UI; DoD-Messung 100 < 30 s veraltet |
| Portal | mittel | bug | neu | bestätigt | `src/lib/account/actions.ts:105` | Benachrichtigungs-Einstellungen sind Attrappen: notification_prefs wird von keinem Mailpfad gelesen, fünf der sechs Toggles beschreiben Mails, die es nicht gibt |
| Portal | mittel | gap | neu | bestätigt | `src/lib/submissions/actions.ts:214` | Fehlende Ereignis-Mails gegenüber SPEC „E-Mail-Benachrichtigungen“: keine Mail bei neuer Abgabe an Trainer, bei Kurs-Zuweisung, Löschantrag, Kontingent-Ende, Trial-Ablauf |
| Portal | mittel | risk | neu | bestätigt | `src/lib/email/client.ts:73` | Kein Bounce-/Complaint-Handling: harte Bounces werden unbegrenzt weiter angeschrieben, Domain-Reputation von calltalent.ai für alle Mandanten gefährdet |
| Portal | mittel | improvement | neu | bestätigt | `src/lib/email/client.ts:31` | Absender fest noreply@calltalent.ai, kein Reply-To: Antworten auf Kontaktanfragen und Systemmails laufen ins Leere; kein White-Label-Versand |
| Portal | mittel | gap | neu | bestätigt | `src/app/(admin)/admin/teilnehmer/[id]/page.tsx:108` | Nutzerverwaltung unter SPEC §4.2: kein Rollenwechsel, keine Kurs-Zuweisung für bestehende Nutzer, kein Fortschritts-Popup, keine Gruppen in der Liste |
| Portal | mittel | gap | neu | bestätigt | `supabase/migrations/0001_init.sql:384` | audit_log wird nirgends geschrieben: sicherheitsrelevante Aktionen hinterlassen keine Spur |
| Portal | mittel | risk | neu | bestätigt | `src/app/(legal)/privacy/page.tsx:22` | Datenschutzerklärung deckt reale Verarbeitung nicht ab: Schichtplan/Zeiterfassung (Art. 9), Web-Push, Bunny-Transkription, KI-Planung/Generator-Uploads fehlen; kein Art.-27-Vertreter-Abschnitt |
| Portal | mittel | bug | neu | bestätigt | `src/lib/account/actions.ts:98` | changeEmail() ohne zod/Rate-Limit und mit rohem Supabase-Fehlertext (Enumeration); updateProfile() ohne Längenlimits |
| Portal | mittel | risk | neu | bestätigt | `src/lib/platform/auth.ts:35` | Betreiber-Portal ohne MFA, ohne Admin-Verwaltung und ohne Papierkorb: ein kompromittiertes Platform-Admin-Konto löscht alle Mandanten endgültig |
| Portal | mittel | gap | neu | bestätigt | `src/app/portal/mandanten/[id]/mandant-edit-form.tsx:130` | „Mandant in 5 Minuten“ ist nur die Datenbankzeile: Custom Domain/SSL, Supabase-Redirect-URLs und Rechtsträger bleiben Handarbeit; keine Onboarding-Checkliste |
| Produkt | mittel | gap | neu | bestätigt | `src/app/profil/actions.ts:63` | Löschkonzept (SPEC §3 Must, DSGVO-Basis) endet beim Antrag: kein Löschpfad, keine Bearbeitungsansicht |
| Produkt | mittel | gap | neu | bestätigt | `wrangler.jsonc:65` | DoD Phase 4 'Neuer Mandant inkl. Domain in < 5 Min. produktiv' ist strukturell nicht erreichbar: SQL, wrangler.jsonc, Deploy, zwei Dashboards |
| Produkt | mittel | gap | neu | bestätigt | `supabase/migrations/0001_init.sql:93` | Drip-Content (SPEC §3 Should, CLAUDE.md-Phase 4 nicht enthalten) fehlt vollständig – nur ein Kommentar im Schema |
| Produkt | mittel | gap | neu | bestätigt | `src/components/layout/Sidebar.tsx:305` | /suche (SPEC §4.1) ist gebaut, aber von keiner Stelle der Oberfläche erreichbar; der Sidebar-Knopf 'Suchen …' klappt nur das Menü ein |
| Produkt | mittel | gap | neu | bestätigt | `src/components/layout/AdminSidebar.tsx:106` | Admin-Navigation, Admin-Dashboard und TopBar sind nicht internationalisiert (CLAUDE.md §3.5) – entgegen 'i18n Block C4 VOLLSTÄNDIG ABGESCHLOSSEN' |
| Produkt | mittel | gap | neu | bestätigt | `messages/de.json:1121` | Zapier/Make-Dokumentation und API-Referenz (SPEC §3 Should, §7) fehlen – nur ein Halbsatz im Einstellungen-Text |
| Produkt | mittel | improvement | neu | bestätigt | `src/lib/import/course-import.ts:26` | Migrations-Importer existiert (Korrektur zur Vor-Analyse), ist aber ohne Schema-Doku, Beispieldatei und CSV-Weg für Kunden nicht nutzbar |
| Produkt | mittel | gap | bekannt | bestätigt | `PHASENSTATUS.md:760` | DoD Phase 3 (Tutor: 10 Testfragen korrekt mit Quelle, 2 Off-Topic verweigert) nie gemessen – nur 1+1 Fragen auf Zufallstext |
| Produkt | mittel | gap | bekannt | bestätigt | `PHASENSTATUS.md:1561` | Lighthouse (DoD 4, CLAUDE.md §3.3): einzige Messung vom 12.07. auf localhost liegt vor allen Design-, i18n- und Font-Änderungen; PHASENSTATUS widerspricht sich |
| Produkt | mittel | improvement | neu | bestätigt | `src/lib/stripe/checkout.ts:122` | Keine Gutscheine, Aktionscodes oder Bundles im Kaufweg (Mandanten-Checkout und Marketplace) |
| Produkt | mittel | improvement | neu | bestätigt | `src/lib/ai/config.ts:67` | Trial-Plan ohne Ablaufdatum, Erinnerung oder Umstellungspfad – kein automatisierbarer Test-Funnel |
| Quiz | mittel | bug | neu | bestätigt | `src/app/(admin)/admin/page.tsx:62` | Admin-Dashboard lädt progress/enrollments/memberships ohne Paginierung – KPIs ab 1000 Zeilen falsch |
| Quiz | mittel | gap | neu | bestätigt | `src/app/(admin)/admin/page.tsx:187` | Dashboard-KPIs weichen von SPEC §4.2 ab: keine „aktive Lernende 30 T.“, Abschlussquote anders definiert als im Reporting |
| Quiz | mittel | gap | neu | bestätigt | `src/app/(admin)/admin/page.tsx:156` | Admin-Dashboard ohne i18n – alle Texte hartkodiert Deutsch (Verstoß CLAUDE.md §3.5) |
| Quiz | mittel | gap | neu | bestätigt | `src/lib/quiz/actions.ts:262` | Quiz-Zeitlimit wird serverseitig nicht durchgesetzt (nur Countdown-Anzeige) |
| Quiz | mittel | gap | neu | bestätigt | `src/lib/quiz/grade.ts:266` | Freitext-Fragen (kind='open') werden gespeichert, aber nie angezeigt oder bewertet |
| Quiz | mittel | gap | neu | bestätigt | `src/lib/quiz/actions.ts:404` | Kein Ergebnis-Feedback je Frage und kein persistiertes Ergebnis für den Lernenden |
| Quiz | mittel | gap | neu | bestätigt | `src/components/learn/submission-form.tsx:82` | Abgaben: Status „Überarbeitung nötig“ ist eine Sackgasse – kein Wiedereinreichen möglich |
| Quiz | mittel | gap | neu | bestätigt | `src/lib/submissions/actions.ts:88` | Keine Benachrichtigung an Trainer/Admin bei neuer Abgabe |
| Quiz | mittel | improvement | neu | bestätigt | `src/lib/certificates/pdf.ts:361` | Zertifikat ohne Verifikations-URL/QR-Code – Echtheit nicht prüfbar |
| Quiz | mittel | gap | neu | bestätigt | `src/lib/certificates/pdf.ts:288` | Zertifikats-PDF ausschließlich Deutsch, obwohl Mandanten default_locale bs/en setzen können |
| Quiz | mittel | gap | neu | bestätigt | `src/lib/generator/pipeline.ts:173` | Kein eigenständiger KI-Quiz-Generator (SPEC §6) – nur 3–6 Einfachauswahl-Fragen innerhalb der Kursgenerierung |
| Quiz | mittel | gap | neu | bestätigt | `src/app/(admin)/admin/teilnehmer/[id]/page.tsx:328` | Teilnehmer-Detailseite ohne Fortschritt, Quiz-Ergebnisse, Abgaben, Zertifikate und ohne Kurs-Zuweisung |
| RLS | mittel | bug | neu | bestätigt | `supabase/migrations/20260710214020_0002_storage.sql:72` | Storage-Schreibpolicies `submissions_own_all`/`avatars_own_*` ohne Mandanten-/Mitgliedschaftsbindung und ohne Mengenbegrenzung |
| RLS | mittel | risk | neu | bestätigt | `supabase/migrations/20260710233735_security_hardening_storage_listing_and_products.sql:18` | `course-assets` ist ein öffentlicher Bucket, und jedes Mitglied darf den gesamten Mandantenordner listen: Dateien unveröffentlichter/kostenpflichtiger Kurse sind ohne Login abrufbar |
| RLS | mittel | gap | neu | bestätigt | `supabase/migrations/0001_init.sql:475` | Kern-Inhaltstabellen ohne Mandantenbindung ihrer Fremdschlüssel (modules/lessons/sections/quizzes/enrollments/attempts/submissions/bookmarks/tutor_conversations) |
| RLS | mittel | risk | neu | bestätigt | `supabase/migrations/20260712234600_rls_consolidate_part_b.sql:1` | Migrationshistorie im Repo weicht von der Live-Datenbank ab: `supabase db push` ist nicht verlässlich, RLS-Stand aus dem Repo nicht beweisbar |
| RLS | mittel | gap | neu | bestätigt | `e2e/global-setup.ts:1` | Keine automatisierten RLS-/Negativtests trotz 14 nachträglichen RLS-Sicherheitsfixes |
| RLS | mittel | gap | neu | bestätigt | `supabase/migrations/0001_init.sql:384` | `audit_log` existiert seit 0001, wird aber nirgends geschrieben: keine Nachvollziehbarkeit von Admin-/Betreiber-Aktionen |
| Schichtplan | mittel | risk | neu | bestätigt | `src/components/learn/time-clock-widget.tsx:61` | Vergessene Ausstempelung: kein Auto-Close, keine Maximaldauer, Widget zeigt nur Uhrzeit ohne Datum |
| Schichtplan | mittel | risk | neu | bestätigt | `src/lib/calendar/schema.ts:581` | Arbeitszeitgesetz nur im KI-Prompt: Höchstarbeitszeit, 11 h Ruhezeit und Pausen werden serverseitig nirgends geprüft |
| Schichtplan | mittel | bug | neu | bestätigt | `supabase/migrations/20260807142619_shift_calendar.sql:718` | Arbeiter kann `ended_at` per Direktclient beliebig (auch in die Zukunft) setzen: Zeitbetrug über die API möglich |
| Schichtplan | mittel | bug | neu | bestätigt | `src/lib/calendar/actions.ts:432` | Deaktivierter Arbeiter (status='inactive') kann weiterhin ein- und ausstempeln |
| Schichtplan | mittel | gap | neu | bestätigt | `src/lib/calendar/actions.ts:599` | Keine Benachrichtigung bei Planänderungen durch Admin/KI (neue, verschobene, stornierte Schicht) |
| Schichtplan | mittel | gap | neu | bestätigt | `src/app/(portal)/schichtplan/page.tsx:82` | „Mein Schichtplan“ zeigt weder Ist-Zeiten noch Abwesenheiten/Feiertage: beide Queries existieren, werden aber nicht aufgerufen |
| Schichtplan | mittel | gap | neu | bestätigt | `src/components/learn/time-clock-widget.tsx:27` | Kein Stundenkonto/Soll-Ist, keine Pausen und Nachtstunden bei Zeiteinträgen, Stempel nie mit Schicht verknüpft |
| Schichtplan | mittel | gap | neu | bestätigt | `supabase/migrations/20260807142619_shift_calendar.sql:669` | Kein Urlaubs-/Krankmeldungs-Workflow für Arbeiter: Status `requested` existiert im Schema, ist aber unerreichbar |
| Schichtplan | mittel | gap | neu | bestätigt | `src/lib/calendar/actions.ts:599` | Admin-Schichtanlage und Freelancer-Selbstbuchung ignorieren Abwesenheiten und Feiertage |
| Schichtplan | mittel | gap | neu | bestätigt | `src/components/learn/shift-calendar-view.tsx:486` | Teil-Zeitraum-Buchung eines Zeitfensters nur per Maus/Touch: Tastatur und Screenreader können nur den ganzen Slot buchen |
| Toolchain | mittel | bug | neu | bestätigt | `e2e/global-setup.ts:114` | E2E-Suite seit 05.08. rot, Phase-4-DoD „Playwright-Suite grün" nicht erfüllt, kein Seed für demo-blau im Repo |
| Toolchain | mittel | gap | neu | bestätigt | `SPEC.md:69` | Keine Datensicherung: Free Tier ohne Backups, SPEC verlangt tägliche; Pausierungsschutz nur zufällig über den Cron |
| Toolchain | mittel | risk | neu | bestätigt | `package.json:36` | 19 weitere npm-audit-Funde (tar/unpdf kritisch, jsdom, vitest, wrangler) – teils auch auf Branch 1 offen; kein Dependabot |
| Toolchain | mittel | risk | neu | bestätigt | `custom-worker.ts:80` | Kein Error-Tracking, kein Alerting, kein Health-Endpunkt, kein Uptime-Check |
| Toolchain | mittel | risk | neu | bestätigt | `wrangler.jsonc:67` | Secrets ausschließlich im Cloudflare-Dashboard (`keep_vars`), keine Inventur, kein Rotationsplan; Env-Doku hinkt Branches hinterher |
| Toolchain | mittel | gap | neu | bestätigt | `vitest.config.ts:21` | Keine Komponententests: 206 .tsx-Dateien, 0 .test.tsx; @testing-library/react installiert, aber ungenutzt |
| Toolchain | mittel | gap | bekannt | bestätigt | `.claude/agents/tester.md:3` | Barrierefreiheit ohne automatisierte Prüfung (axe-core), obwohl tester.md sie vorschreibt |
| Toolchain | mittel | gap | neu | bestätigt | `src/lib/security/rate-limit.ts:1` | Coverage nicht messbar (kein Provider); 12 von 34 src/lib-Bereichen ohne einen einzigen Test, darunter security, auth, gdpr, api |
| Toolchain | mittel | risk | bekannt | bestätigt | `supabase/migrations:1` | Migrations-Prozess: Repo 58 ≠ Live 59, Anwendung per MCP statt CLI, kein supabase/config.toml, Namensdrift |
| Toolchain | mittel | risk | neu | bestätigt | `src/lib/env.ts:54` | Test-/Live-Trennung bei Stripe und Bunny nur per Konvention, nicht technisch erzwungen |
| Toolchain | mittel | gap | neu | bestätigt | `playwright.config.ts:66` | E2E testet nur den `next dev`-Server, nie den OpenNext-Worker-Build |
| Toolchain | mittel | gap | neu | bestätigt | `.claude/agents/tester.md:2` | Kein E2E-Test der Mandanten-Isolation, obwohl tester.md ihn ausdrücklich fordert |
| Toolchain | mittel | gap | neu | bestätigt | `README.md:5` | Übergabe-Dokumentation: README veraltet (Phase 0, Calltalent Ltd., fremde Pfade), PHASENSTATUS 845 KB als einziges Wissensarchiv, Bus-Faktor 1 |
| Zahlungen | mittel | bug | bekannt | bestätigt | `src/app/api/stripe/webhook/route.ts:195` | sendOrderPaidMail() im regulären Webhook-Pfad ist nicht idempotent (Stripe-Retry zu doppelte Bestätigungsmail) |
| Zahlungen | mittel | bug | neu | bestätigt | `src/lib/stripe/checkout.ts:140` | Nach der Zahlung keine Bestätigung im Produkt: success_url '/?checkout=success' wird nirgends ausgewertet; Marketplace-Dankeseite behauptet Freischaltung vor Webhook |
| Zahlungen | mittel | bug | neu | bestätigt | `src/app/api/stripe/webhook/route.ts:153` | Regulärer Webhook-Pfad kehrt bei Fehlern still mit 200 zurück – bezahlter Kunde ohne Zugriff, kein Stripe-Retry |
| Zahlungen | mittel | gap | neu | bestätigt | `src/lib/platform/marketplace.ts:556` | Provisions-Ledger ohne Mandantensicht und ohne Storno; /admin/zahlungen zeigt Marketplace-Bestellungen als vollen Umsatz |
| Zahlungen | mittel | improvement | neu | bestätigt | `src/lib/stripe/checkout.ts:124` | Keine Rabattcodes, keine Kurs-Bundles, keine Team-/Firmenlizenzen |
| Zahlungen | mittel | improvement | neu | bestätigt | `src/app/(admin)/admin/marketplace/page.tsx:48` | Nutzung blockiert durch Vorbedingungs-Kette ohne Onboarding-Hinweise: 0 Kurse, Produkt mit Test-IDs, 0 Listings, Opt-in-Flags |
| i18n/A11y | mittel | bug | neu | bestätigt | `src/components/layout/topbar-menus.tsx:289` | Abmelden in der Lernansicht nur per Zeiger, nicht per Tastatur/Screenreader |
| i18n/A11y | mittel | gap | neu | bestätigt | `src/components/admin/admin-shell.tsx:62` | Kein Skip-Link, Admin-Bereich ohne <main>-Landmark, zwei h1 je Admin-Seite |
| i18n/A11y | mittel | bug | neu | bestätigt | `src/components/layout/AdminSidebar.tsx:112` | Admin-Navigation, Admin-Dashboard, Editor-Werkzeuge und Player-Titel hartkodiert deutsch |
| i18n/A11y | mittel | gap | neu | bestätigt | `src/app/portal/mandanten/[id]/tenant-branding-form.tsx:65` | Keine Kontrastprüfung bei der Mandanten-Akzentfarbe: helle Akzente erzeugen unlesbare weiße Beschriftung |
| i18n/A11y | mittel | bug | neu | bestätigt | `src/components/layout/topbar-menus.tsx:110` | Benachrichtigungs-/Profilmenü: `role="menu"` ohne `menuitem`, kein Escape, kein Schließen bei Fokusverlust |
| i18n/A11y | mittel | gap | neu | bestätigt | `src/components/admin/course-list-table.tsx:80` | Div-basierte Admin-Listen ohne Tabellensemantik; 12 <th> ohne scope |
| i18n/A11y | mittel | gap | neu | bestätigt | `src/components/layout/LearnMobileNav.tsx:91` | Typografie durchgehend in px (186× 13 px, bis 9 px): Browser-Schriftgrößeneinstellung wirkungslos |
| i18n/A11y | mittel | gap | neu | bestätigt | `src/app/globals.css:18` | Kein Dark Mode, kein High-Contrast-, kein prefers-reduced-motion-Support |
| i18n/A11y | mittel | gap | bekannt | bestätigt | `e2e/dashboard-shell.spec.ts:1` | Keine Tastatur- und keine axe-Tests in der Playwright-Suite |
| API | niedrig | risk | neu | bestätigt | `src/app/portal/mandanten/[id]/export/route.ts:123` | Portal-Mandantenexport gibt Webhook-Secrets im Klartext und API-Key-Hashes aus |
| API | niedrig | improvement | neu | bestätigt | `src/lib/webhooks/deliver-attempt.ts:48` | Webhook-Envelope ohne Zustell-ID und ohne Zeitstempel im Signaturschema; Empfänger können Wiederholungen nicht deduplizieren und Replays nicht erkennen |
| API | niedrig | improvement | neu | bestätigt | `src/lib/api/auth.ts:36` | API-Keys ohne Ablauf, Rotation und Scopes; kein Rate-Limit vor dem Key-Lookup |
| API | niedrig | improvement | neu | bestätigt | `src/lib/email/client.ts:31` | E-Mail-Absender fest noreply@calltalent.ai, kein Reply-To, kein Mail-Protokoll trotz fail-soft |
| API | niedrig | improvement | neu | bestätigt | `src/lib/push/send.ts:85` | Push-Benachrichtigungen nur für 'Kurs abgeschlossen', produktiv nie genutzt, web-push auf Workers unverifiziert |
| API | niedrig | risk | neu | bestätigt | `src/lib/users/import.ts:323` | webhook_deliveries speichern E-Mail und Namen unbegrenzt; kein Aufbewahrungs- oder Löschkonzept |
| API | niedrig | bug | neu | bestätigt | `src/app/api/admin/reporting/csv/route.ts:133` | HTTP-Status wird per Substring-Vergleich deutscher Fehlertexte bestimmt |
| API | niedrig | gap | neu | bestätigt | `src/lib/marketplace/fulfil.ts:68` | user.created feuert nicht bei Marketplace-Gastanlage; Ereignisabdeckung unvollständig |
| Auth | niedrig | improvement | neu | unklar | `src/middleware.ts:72` | Middleware macht pro Request 1-3 service_role-Queries plus Auth-Roundtrip: auch für Webhooks, Cron, /api/v1 und unbekannte Hosts, ohne Cache |
| Auth | niedrig | risk | neu | bestätigt | `src/lib/tenant/resolve.ts:333` | PostgREST-Filter aus dem Host-Header per String gebaut (§2.12): im Dev-Schema nachweislich injizierbar |
| Auth | niedrig | improvement | neu | bestätigt | `src/app/page.tsx:23` | Unbekannter Host liefert in Produktion die „Dev-Root"-Seite mit localhost-Beispielen (Status 200) und einen nutzbaren Login |
| Auth | niedrig | improvement | neu | bestätigt | `src/app/auth/signout/route.ts:205` | „Abmelden" beendet alle Sitzungen auf allen Geräten (scope global); ungenutzte signOut()-Server-Action |
| Auth | niedrig | risk | neu | bestätigt | `src/app/auth/callback/page.tsx:136` | Access-/Refresh-Token verbleiben nach dem Callback als URL-Fragment in der Browser-History |
| Auth | niedrig | gap | neu | bestätigt | `src/app/(auth)/registrieren/page.tsx:511` | /registrieren: ohne Datenschutzhinweis/Rechtslinks, off-brand gestaltet und auch bei deaktivierter Selbstregistrierung erreichbar |
| Auth | niedrig | improvement | neu | bestätigt | `src/lib/auth/schema.ts:565` | Passwortregeln minimal: nur min. 8 Zeichen, keine Obergrenze, Leaked-Password-Schutz aus |
| Datenmodell | niedrig | risk | neu | bestätigt | `supabase/migrations/20260711224500_platform_admins.sql:10` | Live-Policies auf platform_admins außerhalb jeder Migration („Admin read own row“, „Deny all“) |
| Datenmodell | niedrig | improvement | neu | bestätigt | `supabase/migrations/0001_init.sql:106` | Positionsreihenfolge ohne DB-Constraint: unique (parent, position) fehlt auf modules/sections/lessons/questions/courses |
| Datenmodell | niedrig | improvement | bekannt | bestätigt | `supabase/migrations/20260807142948_shift_calendar_perf_fix.sql:1` | Indizes: zwei FKs ohne Index über OFFEN_RUFLO hinaus, fünf redundante Kalender-Indizes, 56 Mehrfach-Policies |
| Datenmodell | niedrig | improvement | neu | bestätigt | `supabase/migrations/20260807142619_shift_calendar.sql:63` | btree_gist liegt mit ~170 gbt_*-Funktionen im public-Schema (vector wurde bewusst nach extensions verschoben) |
| Datenmodell | niedrig | gap | neu | bestätigt | `package.json:14` | Kein Schema-Versions-Gate beim Deploy: `npm run deploy` prüft nicht, ob die Live-DB die vom Code erwarteten RPCs/Spalten hat |
| Datenmodell | niedrig | improvement | neu | bestätigt | `supabase/migrations/0001_init.sql:42` | Tote Spalte memberships.invited_email samt CHECK; keine DB-seitige E-Mail-Normalisierung |
| Datenmodell | niedrig | gap | neu | bestätigt | `src/lib/ai/usage.ts:154` | ai_jobs.kind 'quiz_gen' ist im Schema und in Typen vorbereitet, aber kein Code erzeugt Quiz-Generator-Jobs (SPEC §6) |
| Datenmodell | niedrig | bug | neu | bestätigt | `e2e/helpers/test-data.ts:267` | Verwaiste Testkonten in der Produktions-Auth: cleanupE2eUsers räumt nur `e2e-`-Präfix, 100 `test<N>@example.com` bleiben seit 10.07. |
| Fehlerzustände | niedrig | bug | neu | bestätigt | `src/app/(learn)/kurs/[slug]/page.tsx:92` | Soft-404: nicht gefundene Kurse, Lektionen, Teilnehmer, Mandanten und Listings antworten mit HTTP 200 |
| Fehlerzustände | niedrig | gap | neu | bestätigt | `src/lib/errors/generic.ts:13` | Fehlertexte umgehen die Mehrsprachigkeit vollständig: 31 hartkodierte deutsche Meldungen plus alle Fallbacks |
| Fehlerzustände | niedrig | gap | neu | bestätigt | `src/app/manifest.ts:43` | PWA-Installierbarkeit nur nominell: ein SVG-Icon, start_url zeigt auf eine reine Weiterleitung |
| KI | niedrig | improvement | neu | bestätigt | `src/lib/generator/process.ts:46` | Cron verarbeitet mandantenübergreifend nur EINEN Job-Schritt je 2 Minuten: Kursentwurf braucht mindestens 6 Min., bei Parallelbetrieb Stunden |
| KI | niedrig | gap | bekannt | bestätigt | `src/lib/generator/extract.ts:28` | DOCX/PPTX-Upload im Kurs-Generator fehlt (bekannt); Aufwand ist geringer als in OFFEN_RUFLO angenommen |
| KI | niedrig | bug | neu | bestätigt | `src/lib/video/transcript.ts:214` | Video-Zusammenfassung berücksichtigt nur die ersten 12.000 Zeichen des Transkripts |
| KI | niedrig | improvement | neu | bestätigt | `src/lib/generator/parse.ts:23` | JSON-Antworten per Regex aus Freitext extrahiert statt Structured Outputs; Retry verdoppelt Kosten |
| KI | niedrig | improvement | neu | bestätigt | `src/lib/generator/pipeline.ts:124` | Kein Prompt-Caching für den wiederholt gesendeten Quelltext und keine Streaming-Antwort im Tutor |
| KI | niedrig | gap | neu | bestätigt | `e2e/tutor-chat.spec.ts:56` | Tutor-E2E deckt die DoD Phase 3 (10 Fachfragen, 2 Off-Topic) nur mit je einer Frage ab; keine Halluzinations-Eval |
| KI | niedrig | risk | neu | bestätigt | `src/lib/ai/voyage.ts:33` | Voyage AI als harte Einzelabhängigkeit: festes Modell 'voyage-3', Token-Zahl nur geschätzt, kein Modellname an den Embeddings |
| KI | niedrig | gap | neu | bestätigt | `src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx:303` | KI-generierte Lektions-Zusammenfassung ohne KI-Kennzeichnung (§3.6 gilt nur für den Tutor) |
| Kurse | niedrig | risk | neu | bestätigt | `src/lib/courses/actions.ts:606` | Server Actions übernehmen Eltern-IDs und Enum-Parameter ohne Besitz- bzw. zod-Prüfung (CLAUDE.md §2.3/§2.15) |
| Kurse | niedrig | gap | neu | bestätigt | `src/components/editor/block-editor.tsx:149` | Editor-Komponenten unter src/components/editor sind nicht internationalisiert (hartkodiertes Deutsch) |
| Kurse | niedrig | improvement | neu | bestätigt | `src/components/editor/block-form.tsx:283` | Text-Block: veraltetes execCommand-WYSIWYG ohne Listen, Überschriften, Links; Schema erlaubt mehr als der Editor erzeugen kann |
| Kurse | niedrig | risk | neu | bestätigt | `src/app/api/bunny/webhook/route.ts:93` | Bunny-Webhook startet kostenpflichtige Transkription für jedes Video der Library mit fest 'de' als Sprache |
| Kurse | niedrig | improvement | neu | bestätigt | `src/lib/bookmarks/actions.ts:19` | Keine Lernnotizen je Lektion; Lesezeichen sind nur ein Toggle ohne Text oder Zeitmarke |
| Medienpipeline | niedrig | risk | neu | unklar | `src/components/editor/video-recorder.tsx:567` | „Verwenden" schickt jede Aufnahme ohne Größen-Gate durch ffmpeg.wasm: Heap ist hart auf 2048 MB begrenzt |
| Medienpipeline | niedrig | bug | neu | unklar | `src/components/editor/video-trimmer.tsx:716` | Trimmer-Navigation baut vollständig auf Zeitsprünge, die das eigene Modul als unzuverlässig dokumentiert |
| Medienpipeline | niedrig | gap | neu | unklar | `src/lib/video/recorder.ts:72` | Aufnahme- und Schnitt-Oberfläche ist vollständig unübersetzbar: kein einziger Schlüssel in messages/ |
| Medienpipeline | niedrig | bug | neu | bestätigt | `src/lib/bunny/use-bunny-upload.ts:76` | TUS-Fortsetzung ist toter Code: der File-Wrapper erzeugt bei jedem Versuch einen neuen Fingerprint |
| Medienpipeline | niedrig | improvement | neu | bestätigt | `SPEC.md:1` | Der aufwendigste Baustein des Editors ist weder in SPEC.md verankert noch je produktiv genutzt: Entscheidung überfällig |
| Performance | niedrig | gap | neu | bestätigt | `supabase/migrations/20260803100000_marketplace_guest_role.sql:124` | 56 doppelte permissive SELECT-Policies auf den heißesten Tabellen (courses, lessons, modules, quizzes, sections, tenants …) durch guest_select-Nachrüstung und FOR-ALL-Schreibpolicies |
| Performance | niedrig | gap | bekannt | bestätigt | `supabase/migrations/20260724130000_course_information.sql:43` | Fünf FKs ohne Index: OFFEN_RUFLO 6.2 nennt nur die drei Marketplace-FKs, courses.author_id und courses.category_id fehlen dort |
| Performance | niedrig | improvement | neu | bestätigt | `src/lib/courses/schema.ts:-` | sanitize-html (175-KB-Chunk) landet über lib/courses/schema.ts im Client-Bundle des Kurseditors |
| Performance | niedrig | improvement | neu | bestätigt | `src/components/learn/submission-form.tsx:-` | Lektionsseite lädt supabase-js-Browser-Client (168 KB) für die Abgabe-Komponente, auch ohne Abgabe-Block |
| Performance | niedrig | improvement | neu | bestätigt | `src/components/player/bunny-player.tsx:90` | Bunny-Player ohne preconnect-Hinweise; Budget „Player-Start < 500 ms“ (CLAUDE.md §3.3) nie gemessen |
| Performance | niedrig | improvement | bekannt | bestätigt | `src/app/layout.tsx:56` | 86 % jeder HTML-Antwort sind i18n-Messages: 92 KB von 107 KB auf /login, alle 14 Namespaces inklusive 39 KB admin |
| Performance | niedrig | improvement | neu | bestätigt | `PHASENSTATUS.md:1561` | Keine Performance-Messung im Betrieb: kein Web-Vitals-Reporting, kein Lighthouse-CI, letzte Messung 12.07. auf localhost-Startseite ohne Kursdaten |
| Portal | niedrig | gap | neu | bestätigt | `src/lib/import/actions.ts:43` | Migrations-Importer nur für hausinternes JSON: kein CSV, kein Fremdformat, keine Nutzer im selben Lauf |
| Portal | niedrig | gap | neu | bestätigt | `src/app/portal/mandanten/[id]/mandant-detail-tabs.tsx:12` | Kontingente nur planweit: keine Überschreibung je Mandant, kein Zusatzpaket (29 €/1.000), Portal zeigt Verbrauch ohne Limit, unbekannte ai_jobs-Arten roh |
| Portal | niedrig | improvement | Branch | bestätigt | `src/lib/contact/actions.ts:32` | Kontaktformular auf main nur mit IP-Rate-Limit: Honeypot/Form-Token/Turnstile/Spam-Muster liegen fertig auf Branch 2 |
| Portal | niedrig | improvement | Branch | bestätigt | `src/lib/users/actions.ts:22` | Einzel-Einladung und erneuter Einladungslink ohne Rate-Limit (Mailversand an fremde Adressen): auf Branch 1 behoben |
| Portal | niedrig | bug | neu | bestätigt | `src/lib/platform/actions.ts:633` | removeTenantDomain() ignoriert Datenbankfehler still: Domain bleibt scheinbar entfernt |
| Produkt | niedrig | gap | neu | bestätigt | `src/app/(admin)/admin/page.tsx:91` | /admin-Dashboard: Kachel 'aktive Lernende 30 T.' aus SPEC §4.2 fehlt, 'Teilnehmer' zählt alle aktiven Mitgliedschaften |
| Produkt | niedrig | gap | neu | bestätigt | `src/lib/tenant/actions.ts:16` | SPEC §4.2 vs. Code: /admin/design existiert nicht; 'Tutor an/aus' und 'Domain' liegen nicht beim Mandanten-Admin und nur im Betreiber-Portal |
| Produkt | niedrig | risk | neu | bestätigt | `SPEC.md:111` | SPEC §9 und README veraltet; vier in SPEC/PHASENSTATUS referenzierte Grundlagendokumente liegen außerhalb des Repos |
| Produkt | niedrig | improvement | neu | bestätigt | `-:-` | Engagement-Funktionen (Kommentare je Lektion, Lernpfade, Badges, Bewertungen, Benachrichtigungszentrale) fehlen vollständig – SPEC 'Could', für Bindung zahlender Lernender aber der nächste Hebel |
| Produkt | niedrig | improvement | neu | bestätigt | `supabase/migrations/0001_init.sql:204` | Kein B2B-Modell: keine Team-Lizenzen/Seats, kein Manager-Dashboard, Gruppen nur für die Kunden-Area |
| Quiz | niedrig | bug | neu | bestätigt | `src/app/(admin)/admin/page.tsx:124` | Dashboard-Wochenbalken lassen jeden siebten Tag aus (Bucket-Spanne 6 Tage, Lücke von 24 h) |
| Quiz | niedrig | bug | neu | bestätigt | `src/app/(admin)/admin/page.tsx:140` | „Letzte Aktivität“ nimmt drei zufällige Mitgliedschaften statt der neuesten |
| Quiz | niedrig | improvement | neu | bestätigt | `src/app/(admin)/admin/abgaben/page.tsx:56` | Abgaben-Inbox, Teilnehmerliste und Reporting ohne Pagination; Inbox lädt vollen Text aller Abgaben |
| Quiz | niedrig | gap | neu | bestätigt | `src/lib/reporting/queries.ts:80` | Quiz-Auswertung ohne Aggregat je Quiz (Bestehensquote/Durchschnitt) – tote i18n-Schlüssel belegen die Lücke |
| Quiz | niedrig | risk | neu | bestätigt | `src/lib/quiz/grade.ts:249` | Lückentext-Regex ungeankert und ohne Komplexitätsgrenze |
| Quiz | niedrig | improvement | neu | bestätigt | `src/components/learn/quiz-runner.tsx:53` | Nur Fragen werden gemischt, Antwortoptionen nicht; kein Zuordnungs-/Reihenfolge-Fragetyp; Bestehensgrenze 0 % erlaubt |
| RLS | niedrig | risk | bekannt | bestätigt | `supabase/migrations/20260803100000_marketplace_guest_role.sql:108` | 17 SECURITY-DEFINER-Funktionen für `anon` ausführbar: vier davon per explizitem Grant, per Default-Privilege |
| RLS | niedrig | improvement | neu | bestätigt | `supabase/migrations/20260710235500_rate_limits.sql:30` | `rate_limits` wächst unbegrenzt: eine Zeile je IP/E-Mail-Hash und Namespace, nie gelöscht |
| RLS | niedrig | risk | neu | bestätigt | `supabase/migrations/20260801150000_memberships_owner_escalation_fix.sql:15` | `memberships_admin_insert` akzeptiert beliebige `user_id` (Cross-Tenant-Profillesen), `profiles.email` durch Nutzer änderbar |
| Schichtplan | niedrig | risk | neu | bestätigt | `supabase/migrations/20260807142619_shift_calendar.sql:227` | Mehrmandantenfähigkeit eines Arbeiters: Überlappungs- und Stempelschutz gelten nur je Mandant, nicht je Person |
| Schichtplan | niedrig | risk | neu | bestätigt | `supabase/migrations/20260807142619_shift_calendar.sql:702` | Projektleiter-Rechte auf Zeiteinträge und Krankmeldungen sind arbeiter- statt projektbezogen (dieselbe Schwäche, die S3 für Änderungsanfragen behoben hat) |
| Schichtplan | niedrig | improvement | neu | bestätigt | `src/components/learn/shift-calendar-view.tsx:388` | Keine Monatsansicht, kein Druck/PDF, kein Kalender-Export (ICS) |
| Schichtplan | niedrig | bug | neu | bestätigt | `src/lib/calendar/actions.ts:1285` | Änderungsanfrage-Entscheidung nicht atomar: Schicht wird umgeschrieben, bevor die Anfrage geschlossen ist |
| Schichtplan | niedrig | gap | neu | bestätigt | `supabase/migrations/20260807142619_shift_calendar.sql:213` | Schichtbestätigung durch den Arbeiter fehlt: Status `confirmed` ist im Schema, aber unerreichbar |
| Schichtplan | niedrig | bug | Branch | bestätigt | `src/app/(planung)/admin/schichtplanung/page.tsx:175` | Feiertage fehlen in der Jahreswechsel-Woche des Admin-Rasters (`weekStart.getUTCFullYear()`) |
| Schichtplan | niedrig | bug | Branch | bestätigt | `src/lib/calendar/actions.ts:914` | Nachtschicht-Selbstbuchung am Zeitumstellungstag um eine Stunde falsch (+24h in Millisekunden) |
| Schichtplan | niedrig | bug | Branch | bestätigt | `src/lib/calendar/ai/process.ts:80` | CAS-Sperre der KI-Schichtplan-/Feiertagsjobs prüft die betroffene Zeilenzahl nicht: Doppelverarbeitung und doppelte Claude-Kosten bei überlappenden Cron-Ticks |
| Schichtplan | niedrig | gap | bekannt | bestätigt | `src/lib/calendar/access.ts:41` | `shift_calendar_enabled` wird für owner/admin nicht geprüft: Admin kann Arbeiter anlegen, die „Mein Schichtplan“ nie sehen |
| Schichtplan | niedrig | improvement | neu | bestätigt | `src/lib/calendar/date.ts:103` | Zeitzone und Mail-Zeitlabels fest auf Europe/Berlin und de-DE: keine Mandanteneinstellung, obwohl Feiertagsregionen bis Bosnien/Serbien reichen |
| Toolchain | niedrig | risk | bekannt | bestätigt | `open-next.config.ts:7` | Worker-Bundle gemessen 3,9 MB gzip: über dem 3-MiB-Free-Limit, kein Größenwächter im Build |
| Toolchain | niedrig | bug | neu | bestätigt | `e2e/helpers/test-data.ts:267` | Rückstände in Produktion: 100 `testN@example.com` aus dem CSV-DoD-Test vom 10.07.; global-teardown löscht nur `e2e-`-Präfix |
| Toolchain | niedrig | gap | neu | bestätigt | `package.json:9` | `npm run lint` führt entgegen CLAUDE.md §5 keinen TypeScript-Check aus; kein typecheck-Script |
| Toolchain | niedrig | risk | neu | bestätigt | `package.json:45` | Node-Version nicht festgelegt: kein engines/.nvmrc; wrangler verlangt ≥22, @types/node ist ^20 |
| Toolchain | niedrig | improvement | neu | bestätigt | `package.json:3` | Kein Release-Prozess: Version 0.1.0 seit Start, 0 Git-Tags, kein CHANGELOG |
| Toolchain | niedrig | risk | neu | bestätigt | `src/middleware.ts:11` | Abgekündigte `middleware.ts`-Konvention (Next 16: „deprecated, use proxy") als Träger der Mandanten-Auflösung |
| Zahlungen | niedrig | gap | neu | bestätigt | `e2e/stripe-checkout.spec.ts:96` | E2E-Abdeckung des Kaufwegs prüft nur den glücklichen Pfad eines bereits importierten Mitglieds |
| Zahlungen | niedrig | improvement | neu | bestätigt | `src/lib/stripe/schema.ts:425` | Währung nur nominell konfigurierbar, Checkout ohne locale, KPI summiert fest in EUR |
| i18n/A11y | niedrig | bug | neu | bestätigt | `src/components/learn/customer-area-view.tsx:229` | Hartkodierte `de-DE`-Datums-/Zahlenformate in Lernansicht, Schichtplan und Zertifikat |
| i18n/A11y | niedrig | risk | neu | bestätigt | `src/app/(legal)/layout.tsx:1` | Keine Erklärung zur Barrierefreiheit, keine Konformitätsnachweise: BFSG-Risiko für B2C-verkaufende Mandanten, ungenutztes Verkaufsargument |
| i18n/A11y | niedrig | bug | neu | bestätigt | `src/components/layout/Sidebar.tsx:329` | Lern-Sidebar schneidet Navigation bei Zoom/vielen Zusatzlinks ab (`overflow-hidden`) |
| i18n/A11y | niedrig | gap | bekannt | bestätigt | `messages/de.json:1` | 20 tote i18n-Schlüssel (18 über die bekannten zwei hinaus), teils Hinweise auf nie verdrahtete Fehlermeldungen |
| i18n/A11y | niedrig | gap | neu | bestätigt | `src/app/(auth)/login/login-form.tsx:328` | Formularfehler nicht mit Feldern verknüpft (kein aria-invalid, kaum aria-describedby) |
| i18n/A11y | niedrig | improvement | neu | bestätigt | `src/app/(portal)/einstellungen/einstellungen-tabs.tsx:334` | Sprachumschalter nur tief in den Lern-Einstellungen; Betreiber-Portal mit eigener Palette und komplett deutsch |

## Anhang B: Von der Gegenprüfung verworfene Funde

5 Funde hat der Gegenprüfer widerlegt; sie stehen hier, damit sie nicht erneut gemeldet werden.

| Bereich | Titel | Begründung |
|---|---|---|
| Quiz | kind='exam' hat keine Wirkung: Quiz-Ergebnis gated weder Lektionsabschluss noch Zertifikat | Technisch stimmt der Beleg (issue.ts:26-29, grep exam nur in schema.ts/quiz-runner-Label, progress/actions.ts ohne quiz/attempt), aber PHASENSTATUS.md:524 dokumentiert es ausdrücklich als „Entscheidung 4 aus der Phase-2-Planung … Zertifikats-Gate: alle Lektion |
| Quiz | Zertifikate fehlen im Profil (SPEC §4.1) – nur auf der Kursseite sichtbar | Prämisse falsch: src/app/profil/page.tsx ist nur noch eine Weiterleitung nach /einstellungen (Zeile 16 `redirect(... "/einstellungen")`, Kommentar Zeile 4-8). Dort werden Zertifikate geladen und angezeigt: (portal)/einstellungen/page.tsx:148-160 („Zertifikate  |
| Zahlungen | Test- und Live-Modus nicht getrennt: Produkte tragen Testmodus-Preis-IDs, Webhook prüft event.livemode nicht | Prämisse falsch: PHASENSTATUS.md:1756 dokumentiert, dass das eine Produkt 'technik-test' im LIVE-Modus angelegt wurde (prod_Us9kZ04Q3EH0Ru / price_1TsPRN…), PHASENSTATUS.md:1762-1770 einen echten 1-€-Live-Kauf mit registriertem Live-Webhook (portal.calltalent. |
| Produkt | DoD Phase 4 'Playwright-Suite grün' seit 05.08. verletzt: letzter Volllauf 8 grün / 11 rot, danach nur Schichtplan-Specs | Der Beleg ist selektiv zitiert: unmittelbar unter PHASENSTATUS.md:3383 steht der Nachtrag :3385 'alle 10 vorbestehenden E2E-Failures behoben' mit Einzeldiagnose je Spec (dashboard-shell, csv-import, course-completion, certificate-download, submission-review, m |
| Portal | E-Mail-Sprache folgt der Mandanten-Standardsprache, nicht der gewählten Sprache des Empfängers | Beleg stimmt technisch (import.ts:150-152, users/actions.ts:125-127, submissions/actions.ts:197, certificates/issue.ts:208 nutzen `resolveTenantEmailLocale(tenant.settings.default_locale)`), aber email/templates.ts:16-17 dokumentiert es ausdrücklich als „laut  |
