# SPEC — Calltalent-Akademie (v1.0, 10.07.2026)

## 1. Produktziel

Mandantenfähige Premium-Lernplattform, die ein Betreiber (Calltalent) für sich und seine Kunden betreibt. Jeder Mandant erhält eine eigene Akademie unter eigener Domain mit eigenem Branding. Differenzierung gegen LearningSuite (500 €/Monat): Geschwindigkeit, KI-Kursgenerator, KI-Tutor, echtes Reporting, transparente Preise (149 €/Monat), Self-Service.

## 2. Rollen

| Rolle | Ebene | Rechte |
|---|---|---|
| Betreiber (Calltalent) | Plattform | Mandanten anlegen/sperren, Kontingente, Domains, Abrechnung |
| owner / admin | Mandant | alles im Mandanten: Kurse, Nutzer, Branding, Zahlungen, Reporting |
| trainer | Mandant | Kurse erstellen/bearbeiten, Abgaben bewerten, Reporting lesen |
| member (Lernender) | Mandant | zugewiesene Kurse lernen, Quiz, Abgaben, Tutor-Chat |
| guest (Marketplace-Käufer) | Mandant, eingeschränkt | nur der über den Marketplace gekaufte/erworbene Kurs (Fortschritt, Quiz, Abgaben, Tutor-Chat, Zertifikat); kein Zugriff auf den übrigen Kursbestand, keine Nutzerliste, keine Produkte (siehe Abschnitt 10) |

**Nachtrag 05.08.2026:** Die Kunden Area (Abschnitt 11) führt erstmals eine Sichtbarkeits-Differenzierung *innerhalb* einer Rolle ein — bisher sah jedes Mitglied einer Rolle dieselben mandantenweiten Daten wie jedes andere. Ein `member` sieht dort nur Inhalte, die für alle freigegeben sind, für seine eigene(n) Gruppe(n) oder direkt für ihn — umgesetzt über mandanteneigene, frei definierbare Gruppen (`customer_area_groups`), nicht über zusätzliche Rollen.

**Nachtrag 07.08.2026:** Der Schichtplan (Abschnitt 12) führt eine zweite, von der Kursrolle unabhängige Personendimension ein. Ein Nutzer bleibt für den Kurszugriff `member`/`trainer`/etc. und bekommt zusätzlich optional eine Arbeiterzeile (`calendar_workers`, `worker_type` `employee`/`freelancer`) — bewusst kein neuer `memberships.role`-Wert, um die Kurszugriffssemantik nicht mit der Personalsemantik zu vermischen (Begründung siehe Abschnitt 12).

## 3. MoSCoW

**Must (Phase 1–2):** Auth (Magic Link + Passwort), Mandanten-Auflösung (Subdomain + Custom Domain), Branding (Logo, Farben, Schrift, Radius), Kurs → Modul → Lektion mit Block-Editor (Text, Bild, Video, Audio, Datei, Quiz, Abgabe, Hinweisbox, Einbettung), Bunny-Video-Upload + Player (Autoplay, Tempo, Kapitel), Fortschritt + Abschlusslogik, Quiz/Prüfungen mit Versuchen und Bestehensgrenze, Abgaben mit Bewertungs-Inbox, Nutzerverwaltung + CSV-Import + Einladungen, Zertifikate (PDF), Stripe (Einmalkauf + Abo, je Mandant abschaltbar), E-Mail-Benachrichtigungen, Reporting v1 (Fortschritt je Nutzer/Kurs, Abschlussquoten, CSV-Export), DSGVO-Basis (EU-Hosting, Datenexport, Löschkonzept).

**Should (Phase 3–4):** KI-Kursgenerator, KI-Tutor mit RAG + Eskalation an Trainer, Auto-Transkript/Kapitel/Zusammenfassung, semantische Suche, REST-API v1 + Webhooks + Zapier/Make-Doku, PWA (installierbar, Push), Betreiber-Portal, Migrations-Importer, Drip-Content (zeitgesteuerte Freischaltung).

**Could (nach v1):** Kommentare je Lektion (Community-Light), Badges/Gamification, SSO (SAML/OIDC) für Enterprise, Lernpfade über Kurse hinweg, mehrsprachige Kursinhalte.

**Won't (bewusst nicht in v1):** native App-Store-App, SCORM/xAPI, Live-Webinare, Forum/Social-Feed. Begründung: Einfachheit ist das Produkt; PWA deckt Mobile ab.

**Nachtrag 04.08.2026:** Marktplatz war hier ursprünglich mitgelistet, ist aber nachträglich (nach v1.0) doch umgesetzt worden — siehe Abschnitt 10. Diese Zeile bleibt als Beleg der ursprünglichen Entscheidung stehen, gilt aber nicht mehr.

## 4. Screens und Routen

### 4.1 Lernende (Mandanten-Domain, z. B. akademie.kunde.de)

| Route | Inhalt |
|---|---|
| `/` | Akademie-Start: Kurskacheln „Meine Kurse", Fortschrittsbalken, Weiterlernen-Knopf |
| `/kurs/[slug]` | Kursübersicht: Module/Lektionen, Fortschritt, Zertifikatsstatus |
| `/kurs/[slug]/l/[lessonId]` | Lernansicht: Blöcke, Player, „Abschließen", Tutor-Panel (falls aktiv), Vor/Zurück |
| `/kunden-area` | Kunden Area (05.08.2026, Nachtrag, Abschnitt 11): mandantengepflegte Links, Ansprechpartner, Ankündigungen; Sichtbarkeit je Nutzer oder Gruppe; Menüpunkt nur sichtbar, wenn mindestens ein für den Nutzer sichtbarer Eintrag existiert |
| `/schichtplan` | Schichtplan (07.08.2026, Nachtrag, Abschnitt 12): „Mein Schichtplan" — eigene Wochenansicht (Schichten, Projektzugehörigkeit), Ein-/Ausstempeln. Nur sichtbar, wenn der Mandant das Add-on gebucht hat UND der Nutzer eine eigene Arbeiterzeile hat |
| `/suche` | semantische Suche über freigeschaltete Inhalte |
| `/profil` | Name, Passwort, Datenexport, Zertifikate |
| `/login`, `/registrieren`, `/kaufen/[productSlug]` | Auth + Stripe-Checkout |

### 4.2 Admin (gleiche Domain, `/admin`)

| Route | Inhalt |
|---|---|
| `/admin` | Dashboard: aktive Lernende 30 T., Abschlussquote, offene Abgaben, KI-Kontingent |
| `/admin/kurse` + `/admin/kurse/[id]` | Kursliste; Editor: Strukturbaum links, Blöcke rechts, Drag & Drop, Autosave, Vorschau |
| `/admin/ki` | Generator: Dateien hochladen → Kursentwurf → Review → „Als Kurs übernehmen" |
| `/admin/nutzer` | Liste, Einladung, CSV-Import, Kurs-Zuweisung, Fortschritts-Popup |
| `/admin/abgaben` | Inbox: offen/bewertet, Bewertung mit Feedback |
| `/admin/reporting` | Kurs-/Nutzerberichte, Quiz-Auswertung, CSV-Export |
| `/admin/zahlungen` | Stripe-Anbindung, Produkte/Preise, Bestellungen |
| `/admin/design` | Branding: Logo, Farben, Schrift, Radius, Impressum/Datenschutz-Links |
| `/admin/einstellungen` | Domain, Sprachen, Tutor an/aus, Webhooks, API-Keys, Feiertagsregionen (nur bei aktivem Schichtplan) |
| `/admin/schichtplanung` | Schichtplan (07.08.2026, Nachtrag, Abschnitt 12): Arbeiter (Mitarbeiter/Freelancer) zuweisen und Parameter setzen, Projekte anlegen und Arbeiter zuweisen. Nur sichtbar, wenn der Betreiber das Add-on für diesen Mandanten freigeschaltet hat |

### 4.3 Betreiber-Portal (portal.calltalent.ai)

Mandanten anlegen (Name, Subdomain, Paket) in unter 5 Minuten, Status/Kontingente, Domain-Verknüpfung, Nutzungsübersicht (KI-Kosten je Mandant).

### 4.4 Nicht-funktionale Anforderungen

LCP < 1 s (Edge-Cache für Lerninhalte), Lighthouse mobil ≥ 90, WCAG 2.1 AA, deutsche UI (i18n-fähig), 99,5 % Verfügbarkeit (Cloudflare + Supabase), tägliche Backups (Supabase PITR ab Pro-Plan).

### 4.5 Design-Leitplanken (eigenständig, keine LearningSuite-Anmutung)

Ruhiges, helles Interface; eine Akzentfarbe je Mandant; Inter als Standardschrift (Mandant kann eigene wählen); großzügige Schriftgrößen (Basis 16–18 px, skalierbar); klare Fokuszustände; keine dekorativen Verläufe. Referenz-Anmutung: moderne Dokumentationsseiten, nicht Social Media.

## 5. Datenmodell

Vollständig in `supabase/migrations/0001_init.sql`. Kernprinzip: jede Tabelle trägt `tenant_id`, RLS erzwingt Mandantengrenzen; Rollenprüfung über `public.member_role(tenant_id)` (security definer). Personenbezogene Zeilen (progress, attempts, submissions, tutor_messages) zusätzlich auf `user_id = auth.uid()` beschränkt; Staff (owner/admin/trainer) liest mandantenweit.

Tabellenübersicht: tenants, profiles, memberships, courses, modules, lessons, enrollments, progress, quizzes, questions, attempts, submissions, certificates, products, orders, subscriptions, ai_jobs, embeddings, tutor_conversations, tutor_messages, webhooks, webhook_deliveries, api_keys, usage_counters, audit_log. Marketplace (04.08.2026, Abschnitt 10): marketplace_listings, marketplace_ledger, platform_settings (platform_admins existierte bereits seit Phase 4). Kunden Area (05.08.2026, Abschnitt 11): customer_area_groups, customer_area_group_members, customer_area_items, customer_area_item_audience; dazu `trainers.phone`/`trainers.email` ergänzt (trainers-Tabelle bestand bereits seit Phase 1 für Kurs-Autoren, siehe Abschnitt 11). Schichtplan (07.08.2026, Abschnitt 12): calendar_workers, calendar_projects, calendar_project_members, calendar_slots, calendar_shifts, calendar_absences, calendar_shift_change_requests, calendar_time_entries; dazu `btree_gist` als dritte Postgres-Extension neben `pgcrypto`/`vector` und die erste zusammengesetzte Eindeutigkeit `memberships(id, tenant_id)`.

Storage-Buckets (Phase 1 anzulegen): `branding` (öffentlich lesbar), `course-assets` (öffentlich lesbar via signierte URLs optional), `submissions` (privat), `certificates` (privat). Pfadkonvention: `{tenant_id}/...`; Policies analog RLS.

## 6. KI-Funktionen (Produkt)

| Funktion | Modell | Ablauf | Kosten/Vorgang (ca.) |
|---|---|---|---|
| Kurs-Generator | claude-sonnet | Upload (PDF/DOCX/PPTX/Transkript) → Extraktion → Strukturvorschlag (Module/Lektionen/Lernziele) → Lektionstexte + Quiz je Modul → Review-Ansicht → Übernahme als Entwurf | 0,50–1,00 € |
| Tutor-Chat | claude-haiku | Frage → pgvector-Suche über Kurs-Chunks (Top 6) → Antwort mit Quellen-Lektion → optional „An Trainer weiterleiten" | 0,004 € |
| Transkript + Kapitel + Zusammenfassung | Whisper-kompatible STT via Bunny/extern, Zusammenfassung claude-haiku | nach Video-Upload automatisch als Job | 0,05–0,15 €/Video |
| Quiz-Generator | claude-sonnet | aus Lektionsinhalt 5–10 Fragen mit Distraktoren | 0,05 € |
| Semantische Suche | Embeddings + pgvector | Chunking je Lektion (500–800 Tokens), HNSW-Index | < 0,001 €/Anfrage |
| Feiertagsrecherche (Schichtplan) | claude-sonnet | Mandant wählt Regionen (Einstellungen) → Jahr auslösen → asynchroner Job → Claude-Recherche + Abgleich/Konflikterkennung → Pflicht-Review → Übernahme als Feiertage | 0,01–0,03 € (gemessen: 0,0122 USD für 3 Regionen, siehe PHASENSTATUS.md „Schichtplan — Block S5b") |

Regeln: Alle Aufrufe serverseitig; Verbrauch in `ai_jobs`/`tutor_messages` mit tokens_in/out und cost_usd protokolliert; Monatslimits je Mandant aus `tenants.plan` über `usage_counters` (Komplett: 500 Tutor-Antworten + 5 Generierungen; Enterprise: 2.000 + 20; Zusatz: 29 €/1.000). Tutor antwortet nur aus Kursinhalten; bei fehlender Grundlage: ehrliches „steht nicht im Kurs" + Eskalationsangebot. Jede Tutor-Oberfläche trägt Kennzeichnung „KI-Assistent".

## 7. API v1 + Webhooks (Phase 3)

REST unter `/api/v1`, Auth über mandantenbezogene API-Keys (Tabelle api_keys, Hash gespeichert). Endpunkte: `GET/POST users`, `GET/POST enrollments`, `GET courses`, `GET progress?course_id=`, `GET reports/course/:id.csv`. Webhook-Events: `user.created`, `enrollment.created`, `lesson.completed`, `course.completed`, `quiz.passed`, `submission.created`, `order.paid`. Zustellung mit HMAC-Signatur, 3 Wiederholungen, Protokoll in webhook_deliveries.

## 8. Definition of Done je Phase

| Phase | Fertig, wenn |
|---|---|
| 1 | Zwei Test-Mandanten mit unterschiedlichem Branding laufen parallel; Kurs mit Video anlegen und als Lernender abschließen funktioniert E2E; CSV-Import 100 Nutzer < 30 s; security-reviewer findet keine RLS-Lücke |
| 2 | Kauf → automatische Einschreibung → Zertifikat nach Abschluss läuft E2E mit Stripe-Testmodus; Reporting-Export stimmt gegen Testdaten |
| 3 | Aus 3 PDFs entsteht in < 10 Min. ein übernehmbarer Kursentwurf; Tutor beantwortet 10 Testfragen korrekt mit Quellenangabe und verweigert 2 Off-Topic-Fragen; Kontingent-Abschaltung greift |
| 4 | Neuer Mandant inkl. Domain in < 5 Min. produktiv; Playwright-Suite grün; Lighthouse ≥ 90; DSGVO-Paket (AVV, TOMs, Exportfunktion) vorhanden |

## 9. Offene Entscheidungen

1. Produktions-Domain des Betreiber-Portals (Vorschlag: portal.calltalent.ai; Mandanten-Standard: {slug}.akademie.calltalent.ai).
2. STT-Anbieter für Transkripte (Bunny liefert keine STT: Kandidaten Deepgram/AssemblyAI/whisper-API — Entscheidung in Phase 3 nach Preisprüfung).
3. Zertifikats-Design (ein Standard-Template in Phase 2, mandantenfähig via Branding-Farben).
4. Steuerliche Bestätigung des Merchant-of-Record-Modells (Abschnitt 10) vor dem ersten echten (Nicht-Test-)Marketplace-Verkauf — Rechnungsstellung, OSS-Meldepflicht, ggf. Stripe Tax.
5. Marketplace-Selbstregistrierung für Käufer ohne bestehendes Konto (aktuell: Verweis auf office@calltalent.ai, kein automatisierter Weg — bewusst zurückgestellt, da Selbstregistrierung ohne Mandantenbezug eine eigene, größere Änderung an einer plattformweiten Kernfunktion wäre).

## 10. Marketplace (nachträglich ergänzt, 04.08.2026)

Zentraler, mandantenübergreifender Marktplatz nach App-Store-Prinzip unter eigener Domain (`marketplace.calltalent.ai`, mandantenneutral, kein Bestandteil einer einzelnen Akademie). Mandanten können veröffentlichte Kurse zusätzlich zur eigenen Akademie dort listen — kostenlos oder kostenpflichtig, sichtbar und erwerbbar für jeden, auch für Nutzer ohne bestehende Mandantenzugehörigkeit.

**Freigabe-Workflow:** je Kurs ein Listing-Datensatz mit eigenem Status, getrennt von Mandanten-Sichtbarkeit (`enabled`) und Betreiber-Freigabe (`status`): `draft → submitted → approved` oder `rejected` (mit Pflicht-Begründung), `approved → suspended` durch den Betreiber, `rejected → submitted` nach Korrektur durch den Mandanten. Freigabe/Ablehnung/Sperrung ausschließlich durch Calltalent (Betreiber-Portal), niemals durch den Mandanten selbst — technisch über RLS erzwungen, nicht nur durch die Anwendungsoberfläche.

**Zugriffsmodell:** ein Marketplace-Käufer erhält beim Verkäufer-Mandanten eine neue, eingeschränkte Rolle `guest` (siehe Abschnitt 2) statt einer gewöhnlichen `member`-Mitgliedschaft — sonst hätte der Kauf eines einzelnen Kurses Zugriff auf den kompletten Kursbestand des Mandanten geöffnet. `guest` sieht ausschließlich den erworbenen Kurs.

**Erlösmodell:** Calltalent tritt als Wiederverkäufer auf (Merchant of Record) — Rechnungsstellung an den Endkunden durch Calltalent, nicht durch den Mandanten. Ein zentrales Stripe-Konto (kein Stripe Connect) nimmt Zahlungen entgegen. Provision je Verkauf: Standardsatz 20 % (global konfigurierbar), pro Mandant individuell überschreibbar. Der Provisionssatz wird bei jedem Verkauf in ein Ledger kopiert (nicht nachträglich neu berechnet), sodass eine spätere Satzänderung bereits abgerechnete Verkäufe nicht rückwirkend verändert. Auszahlung an Mandanten erfolgt manuell (Überweisung außerhalb des Systems) auf Basis einer Ledger-Ansicht mit CSV-Export im Betreiber-Portal — kein automatisierter Payout in v1.

**DSGVO:** Beim Kauf werden Name/E-Mail/Lernfortschritt an einen vom Käufer nicht als Vertragspartner gewählten Mandanten übermittelt (Art. 6 Abs. 1 lit. b DSGVO, Vertragserfüllung). Hinweis auf der Kurs-Detailseite und im Kaufabschluss mit Namensnennung des Verkäufers.

**Rechtlich:** `marketplace.calltalent.ai` ist ein eigenständiges Telemedienangebot mit eigenem Impressum/Datenschutz/AGB (Calltalent Ltd. als Betreiber), unabhängig von den Mandanten-Rechtsseiten.

**Routen:**

| Route | Inhalt |
|---|---|
| `marketplace.calltalent.ai/` | Katalog aller freigegebenen, sichtbaren Listings |
| `.../kurs/[slug]` | Kurs-Detailseite (öffentlich, mandantenübergreifend), Kauf-/Gratis-Erwerb-Button |
| `.../kurs/[slug]/danke` | Bestätigung nach Kauf/Gratis-Erwerb, Link zurück zur Verkäufer-Domain |
| `.../login` | eigenständiger Login (Marketplace-Host kennt keinen Mandanten, kein Registrieren) |
| `.../impressum`, `.../datenschutz`, `.../agb` | eigene Rechtsseiten |
| `/admin/marketplace` (Mandanten-Domain) | Listing anlegen/bearbeiten/einreichen/zurückziehen, Sichtbarkeits-Schalter |
| `/portal/marketplace` | Betreiber-Prüf-Warteschlange, Freigeben/Ablehnen/Sperren |
| `/portal/marketplace/auszahlungen` | Provisions-Ledger je Mandant/Zeitraum, CSV-Export, „als ausgezahlt markieren" |

Feature-Flag je Mandant: `tenants.settings.marketplace_enabled` (Default aus, Opt-in durch den Betreiber im Mandanten-Detail des Betreiber-Portals), optionaler mandantenspezifischer Provisionssatz `tenants.settings.marketplace_commission_bp`.

## 11. Kunden Area (nachträglich ergänzt, 05.08.2026)

Neue Unterseite in der Lernansicht (`/kunden-area`, Abschnitt 4.1): Der Mandanten-Admin (owner/admin) stellt seinen Nutzern individuelle Links (z. B. Google-Drive-Ordner, WhatsApp-/Facebook-Gruppen), Ansprechpartner und Ankündigungen/Angebote bereit, um Kommunikation und Informationsaustausch zu erleichtern — Vorbild war ein Kunden-Hub aus einer Wettbewerber-Anwendung, das Design ist eigenständig umgesetzt (keine Übernahme, siehe Abschnitt 4.5).

**Personalisierung:** frei pro Nutzer oder pro mandanteneigener, frei definierbarer Gruppe (`customer_area_groups`/`customer_area_group_members`) statt nur mandantenweit oder rollenbasiert — die erste Stelle im Produkt mit Sichtbarkeits-Differenzierung innerhalb einer Rolle (siehe Nachtrag Abschnitt 2). Ein Eintrag (`customer_area_items`, Diskriminator `kind` in `link`/`contact`/`announcement`) ist entweder für alle Mitglieder sichtbar (`visibility = 'all'`, Standard) oder auf ausgewählte Gruppen/Personen beschränkt (`restricted`, Zuordnung über `customer_area_item_audience`). Der Menüpunkt „Meine Kunden Area" erscheint nur, wenn für den angemeldeten Nutzer mindestens ein sichtbarer Eintrag existiert — kein Pflicht-Setup, kein Feature-Flag nötig.

**Ansprechpartner:** nutzt den bestehenden `trainers`-Datenpool (Kurs-Autoren-Profile seit Phase 1) weiter, erweitert um `phone`/`email`. Ein Trainer kann Kursautor, Kunden-Area-Kontakt, beides oder keines von beiden sein.

**RLS/Sichtbarkeit:** Gruppen und Zuordnungen sind ausschließlich für owner/admin lesbar (ein Mitglied soll nicht auslesen können, dass es z. B. eine Gruppe „Geschäftsführung" gibt); die Filterung für Lernende läuft vollständig serverseitig über eine `security definer`-Hilfsfunktion (`customer_area_can_see()`), analog zum bestehenden `member_role()`/`has_enrollment()`-Muster. **Bewusste Entscheidung (Variante A, siehe Entscheidungs-Log.md, 05.08.2026):** Telefonnummer/E-Mail eines Ansprechpartners bleiben über die bestehende `trainers`-Tabelle für alle Mandanten-Mitglieder lesbar — die Gruppen-Einschränkung der Kunden-Area wirkt hier nur auf Anzeige-Ebene, nicht als zusätzliche Datenbank-Schranke auf `trainers` selbst (Begründung: dienstliche Kontaktdaten, Vermeidung von Regressionsrisiko am Kurs-Editor/Marketplace-Gast-Pfad).

Migrationen: `supabase/migrations/20260805090000_customer_area.sql`, `20260805090100_customer_area_rls_perf_fix.sql` (RLS-Konsolidierung + fehlende FK-Indizes, unmittelbar nach Anwendung der Basis-Migration per Advisor-Befund nachgezogen).

## 12. Schichtplan (nachträglich ergänzt, 07.08.2026)

Kalender für Schichtplanung und Zeiterfassung für festangestellte Mitarbeiter und externe Freelancer, nutzbar auf `academy.calltalent.ai` und pro Mandant zubuchbar. Festangestellte werden von einem Admin/Projektleiter geplant; Freelancer buchen sich perspektivisch selbst in freigegebene Zeitfenster mit begrenzter Kapazität ein. Beide Arbeiter-Typen werden über den bestehenden Einladungsmechanismus zur Academy eingeladen und bekommen zusätzlich zu ihrer Kursrolle eine Arbeiterzeile.

**Rollenmodell:** bewusst kein neuer `memberships.role`-Wert (siehe Nachtrag Abschnitt 2) — `20260803100000_marketplace_guest_role.sql` hat `member_role()` bereits verengt, ein weiterer Rollenwert würde Kurszugriffsrechte aller bestehenden Policies mitverändern. Stattdessen eine eigenständige Tabelle `calendar_workers` (`worker_type` `employee`/`freelancer`, Planungsparameter: Sollstunden, Periode, bevorzugte Schicht, Wochentage). Verwaltungsrechte laufen über `member_role(tenant_id) in ('owner','admin')`, nicht über `is_staff()` (das würde `trainer` einschließen — Schicht-/Zeiterfassungsdaten sind Beschäftigtendaten, DSGVO Art. 5 Abs. 1 lit. c). Ein Projektleiter (`calendar_projects.lead_user_id`) sieht und plant ausschließlich Arbeiter seiner eigenen Projekte, projektbezogen statt mandantenweit.

**Projekte:** Admin/Projektleiter legt Projekte an und weist Arbeiter zu (`calendar_project_members`). Ein Arbeiter kann mehreren Projekten angehören, pro Stunde aber nur in einem gebucht sein — technisch erzwungen über einen Postgres-`EXCLUDE USING GIST`-Constraint auf `calendar_shifts` (kein Anwendungs-Check).

**Kapazitätssteuerung (Grundlage gelegt, UI folgt in Block S2):** `calendar_slots` definiert freigegebene Zeitfenster mit einer festen Platzzahl; ein `AFTER`-Trigger sperrt die Zeitfenster-Zeile (`FOR UPDATE`) und zählt aktive Buchungen unter dieser Sperre, um Überbuchung bei gleichzeitiger Selbstbuchung race-condition-sicher auszuschließen — kein denormalisierter Buchungszähler.

**Änderungsanfragen (Grundlage gelegt, UI folgt in Block S3):** Ein Arbeiter kann eine bereits gebuchte Zeit nicht direkt ändern — Arbeiter haben kein UPDATE/DELETE auf `calendar_shifts`. Der einzige Änderungsweg ist `calendar_shift_change_requests` (Anfrage mit vorgeschlagener neuer Zeit oder Storno), die Genehmigung durch Admin/Projektleiter erfordert. Die Regel liegt in der Datenbank, nicht in einer Server Action.

**Zeiterfassung:** echtes Stempeln über `calendar_time_entries` (mehrere Ein-/Ausstempel-Vorgänge je Tag möglich, nicht nur ein Ist-Beginn/-Ende je Schicht). Nur ein offener Stempel je Arbeiter gleichzeitig; ein `BEFORE UPDATE`-Spaltenschutz-Trigger verhindert, dass ein Arbeiter beim Ausstempeln rückwirkend andere Felder als `ended_at` verändert. Aufbewahrungspflicht zu beachten: Ist-Zeiten sind in Deutschland nach § 16 Abs. 2 ArbZG zwei Jahre aufzubewahren — der Löschpfad in `src/lib/gdpr/` muss `calendar_time_entries` beim Mandantenexport/Löschantrag berücksichtigen.

**KI-gestützte Schichtplanung (Block S4, 08.08.2026, umgesetzt und live):** Ein Claude-Sonnet-Aufruf (`ai_jobs.kind = 'shift_plan'`, einstufiger Job `queued`→`done`/`error`, geteilter Kontingent-Zähler mit dem Kurs-Generator) schlägt aus Arbeiter-Parametern, Abwesenheiten/Feiertagen und bestehenden Schichten einen Schichtplan-Entwurf für ein Projekt vor. Ablauf: Admin löst über `/admin/schichtplanung?tab=ki` einen Lauf aus (Projekt, Zeitraum, Arbeiterauswahl) → der Cron-Prozess-Endpunkt (`/api/admin/ki/process`) verarbeitet ihn asynchron → Admin prüft/korrigiert den Entwurf zeilenweise in einer Review-Ansicht → ausgewählte Zeilen werden einzeln (nicht als Kollektiv-Transaktion) als echte `calendar_shifts` übernommen, Konflikte pro Zeile gemeldet statt die gesamte Übernahme scheitern zu lassen. Datenminimierung strikt durchgesetzt: Claude sieht ausschließlich Pseudonyme ("A1", "A2", …), nie Klarnamen/E-Mails/Arbeiter-UUIDs (DSGVO Art. 5 Abs. 1 lit. c). `applyShiftPlan()` nimmt bewusst kein `workerId` vom Client entgegen — die Arbeiterzuordnung wird ausschließlich über die serverseitig gespeicherte Entwurfszeile aufgelöst. `ai_jobs`-RLS ist für `kind='shift_plan'` zusätzlich zu `is_staff()` auf `calendar_is_admin(tenant_id)` verengt (Projektleiter/Trainer kommen weder über die App noch per Direktzugriff an die KI-Planung heran, Sicherheitsfund HOCH aus dem S4-Review, siehe PHASENSTATUS.md).

**Mandantenfähigkeit:** `tenants.settings.shift_calendar_enabled`, ausschließlich vom Betreiber im Betreiber-Portal (`/portal/mandanten/[id]`) setzbar — gleiches Muster wie `marketplace_enabled` (Opt-in-Polarität, fehlender Wert bedeutet aus). Der Menüpunkt „Mein Schichtplan" erscheint für einen Nutzer nur, wenn zusätzlich zum gesetzten Mandanten-Flag eine eigene Arbeiterzeile existiert.

**Umsetzung in Blöcken:** S1 (07.08.2026, Grunddatenmodell, Feature-Flag, Arbeiter-/Projektverwaltung, lesende Wochenansicht, Ein-/Ausstempeln), S2 (08.08.2026, Schicht-CRUD durch Admin, Zeitfenster-Verwaltung mit Serienanlage, Freelancer-Selbstbuchung, Abwesenheiten/Feiertagsimport — dieser deterministische Import ist seit S5 durch die KI-Feiertagsrecherche abgelöst, siehe dortige Ergänzung —, Freelancer-Sollstunden-Selbstverwaltung), S3 (09.08.2026, Änderungsanfragen-Workflow, Genehmigungs-Inbox, Projektleiter-Zugang zum Admin-Bereich), S4 (08.08.2026, KI-gestützte Schichtplanung), S5 (08.08.2026, KI-gestützte Feiertagsrecherche) und S6 (09.08.2026, Freelancer-Drag-and-Drop im Wochenraster) umgesetzt und live. **Korrektur (08.08.2026):** die S1-Annahme „Schema und RLS für alle vier Blöcke liegen bereits vollständig in der S1-Migration" traf für S2 nur teilweise zu — die Selbstbuchungs-Policy auf `calendar_shifts` und der Spaltenschutz-Trigger für die Freelancer-Sollstunden-Selbstverwaltung fehlten und wurden in `supabase/migrations/20260807171725_shift_calendar_s2.sql` nachgezogen. Zusätzlich behob `supabase/migrations/20260807173156_shift_calendar_guard_tenant_fix.sql` einen bei diesem S2-Review gefundenen, systemischen Sicherheitsfund (Spaltenschutz-Trigger prüfte `new.tenant_id`/`new.worker_id` statt `old.*`, betraf auch das S1-Pendant `calendar_time_entries_guard()`).

**S3-Ergänzung (09.08.2026):** Ein Arbeiter kann aus einer eigenen Schicht heraus eine Zeitänderung oder Stornierung beantragen (`calendar_shift_change_requests`, Tabelle seit S1 angelegt); Admin und Projektleiter entscheiden über eine Inbox unter `/admin/schichtplanung?tab=requests`. Genehmigung schreibt die Ursprungsschicht um (überlappungssicher — ein Konflikt lässt die Anfrage `pending` statt sie zu verwerfen), Ablehnung erhält die Schicht unverändert; beide Wege verschicken eine Resend-Mail. Projektleiter erreichen `/admin/schichtplanung` jetzt über eine eigene Route-Gruppe `(planung)` mit eigenem Zugangsgate (`checkShiftPlannerAccess()`), sehen dort ausschließlich die Reiter „Schichten" (lesend) und „Änderungsanfragen" — der übrige Admin-Bereich (`(admin)/admin/layout.tsx`) bleibt für sie unverändert gesperrt. Sicherheitsfund HOCH aus dem S3-Review behoben: die Sichtbarkeit/Entscheidung von Änderungsanfragen war ursprünglich arbeiter- statt schichtprojektbezogen gegated (`calendar_leads_worker()`), wodurch ein Projektleiter Anfragen aus einem FREMDEN Projekt desselben Arbeiters hätte einsehen/ablehnen können — Fix über neue Hilfsfunktion `calendar_leads_change_request()` in `supabase/migrations/20260807222443_shift_calendar_s3_change_request_scope_fix.sql`.

**S4-Ergänzung (08.08.2026):** Der achte Reiter „KI-Planung" unter `/admin/schichtplanung?tab=ki` ist admin-exklusiv (nicht in der Projektleiter-Reiterliste). Ein Auslöse-Formular (Projekt, Zeitraum, Arbeiterauswahl je Projektmitgliedschaft) legt einen `ai_jobs`-Eintrag an; der bestehende Cron-Prozess-Endpunkt (`/api/admin/ki/process`, Abschnitt 6) verarbeitet ihn beim nächsten Tick zusätzlich zum Kurs-Generator. Der fertige Entwurf ist in einer Review-Tabelle zeilenweise editierbar (Datum/Zeit/Pause), bevor eine Auswahl übernommen wird — Konflikte (Überschneidung, Abwesenheit, außerhalb des Zeitraums, doppelt geplant) werden pro Zeile markiert, eine fehlgeschlagene Übernahme lässt konfliktfreie Zeilen trotzdem entstehen. Sicherheitsfund HOCH aus dem S4-Review behoben: `ai_jobs_staff_select`/`ai_jobs_staff_insert` (`0001_init.sql`) waren `kind`-unabhängig über `is_staff()` gegated, was die Rolle `trainer` einschließt — die Admin-Beschränkung für `kind='shift_plan'` existierte bislang ausschließlich in der Server-Action-Schicht, nicht per RLS. Fix über `supabase/migrations/20260808061159_shift_calendar_s4_ai_jobs_scope_fix.sql`, die beide Policies für `kind='shift_plan'` zusätzlich auf `calendar_is_admin(tenant_id)` verengt.

**S5-Ergänzung (08.08.2026):** Der bisherige deterministische Feiertagsimport (S2, nur DE/AT/CH über eine im Code berechnete Liste) ist durch eine KI-gestützte Feiertagsrecherche ersetzt, die acht Regionen abdeckt: Deutschland, Österreich, Schweiz, Kroatien, Serbien sowie die drei Entitäten Bosnien und Herzegowinas (Föderation BiH, Republika Srpska, Brčko-Distrikt — kollisionsfrei benannt `BA_FBIH`/`BA_RS`/`BA_BRCKO`, da `RS` bereits der ISO-Code für den Staat Serbien ist). Der Mandant wählt die für ihn relevanten Regionen als eigene Einstellung unter `/admin/einstellungen` (`tenants.settings.shift_calendar_holiday_regions`, Mehrfachauswahl, nur sichtbar bei aktivem Schichtplan). Ablauf im Abwesenheiten-Reiter (`/admin/schichtplanung?tab=absences`): Jahr auslösen (Regionen kommen serverseitig aus der Mandanten-Einstellung, nie vom Client) → asynchroner Job (`ai_jobs.kind='holiday_research'`, gleicher Cron-Prozess-Endpunkt wie S4) → EIN Claude-Sonnet-Aufruf → serverseitiger Abgleich gegen die weiterhin bestehende deterministische DE/AT/CH-Berechnung (Badge „bestätigt"/„nicht in der festen Liste" — für HR/RS/BA_* gibt es keine Referenzliste, das ist offen ausgewiesen) → Konflikterkennung (Datum bereits vorhanden, Datum doppelt über mehrere Regionen, außerhalb des Jahres) → **Pflicht-Review** vor jeder Übernahme (kein Direkt-Insert wie beim alten Import — ein Feiertag ist eine Rechtstatsache mit Entgeltfolge nach § 2 EFZG und wirkt über `detectConflicts()` direkt auf die KI-Schichtplanung). `applyHolidayResearch()` nimmt bewusst keine Region vom Client entgegen (Auflösung ausschließlich über die serverseitig gespeicherte Entwurfszeile, gleiches Prinzip wie `workerId` bei S4). `ai_jobs`-RLS ist für `kind='holiday_research'` ebenfalls auf `calendar_is_admin(tenant_id)` verengt (`supabase/migrations/20260808145112_calendar_holiday_research.sql`) — Begründung ausdrücklich Kostenkontrolle (Rate-Limit-/Kontingent-Umgehung durch einen `trainer`), nicht Geheimhaltung, da Feiertage öffentliche Rechtstatsachen sind. Realer Testlauf (3 Regionen, Jahr 2026): 0,0122 USD, alle 9 deutschen Feiertage korrekt gegen die bestehende Berechnung bestätigt, Republika Srpska sauber von Serbien unterschieden (orthodoxer Kalender, eigener Feiertag „Tag des Dayton-Abkommens").

**S6-Ergänzung (09.08.2026):** Ein Freelancer kann in „Mein Schichtplan" (`/schichtplan`) direkt im Stunden-Raster per Klick oder Ziehen agieren, zusätzlich zu den bestehenden Wegen (Liste „Offene Zeitfenster", Formular „Zeit ändern") — beide bleiben unverändert bestehen (Barrierefreiheit, Auftraggeber sehbehindert: Tastaturweg bleibt primär). Zwei Interaktionen: (1) ein offenes Zeitfenster lässt sich per Klick als Ganzes buchen (wie bisher der „Buchen"-Knopf) oder per Ziehen als Teil-Zeitraum innerhalb der Slot-Grenzen — beides über die um optionale `startTime`/`endTime` erweiterte `bookOwnShift()`, ohne neue Migration (der bestehende Trigger `calendar_slot_capacity_guard()` deckte Teil-Zeiträume schon vorher ab). (2) Ziehen an einer eigenen bestehenden Schicht (verschieben oder an den Rändern die Größe ändern) schreibt NICHTS direkt — es befüllt nur das bestehende „Zeit ändern"-Formular (S3) mit der neuen Zeit vor; der Freelancer muss noch senden, ein Admin weiterhin genehmigen. V1-Einschränkung: Ziehen wirkt nur vertikal (Zeitänderung), keine Tagesänderung per Ziehen über Spalten — dafür bleibt das Datumsfeld im Formular. Festangestellte sehen keine Verhaltensänderung (kein offenes Zeitfenster, kein Drag). `security-reviewer`: 0 KRITISCH/HOCH/MITTEL.
