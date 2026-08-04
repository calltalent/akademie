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
| `/admin/einstellungen` | Domain, Sprachen, Tutor an/aus, Webhooks, API-Keys |

### 4.3 Betreiber-Portal (portal.calltalent.ai)

Mandanten anlegen (Name, Subdomain, Paket) in unter 5 Minuten, Status/Kontingente, Domain-Verknüpfung, Nutzungsübersicht (KI-Kosten je Mandant).

### 4.4 Nicht-funktionale Anforderungen

LCP < 1 s (Edge-Cache für Lerninhalte), Lighthouse mobil ≥ 90, WCAG 2.1 AA, deutsche UI (i18n-fähig), 99,5 % Verfügbarkeit (Cloudflare + Supabase), tägliche Backups (Supabase PITR ab Pro-Plan).

### 4.5 Design-Leitplanken (eigenständig, keine LearningSuite-Anmutung)

Ruhiges, helles Interface; eine Akzentfarbe je Mandant; Inter als Standardschrift (Mandant kann eigene wählen); großzügige Schriftgrößen (Basis 16–18 px, skalierbar); klare Fokuszustände; keine dekorativen Verläufe. Referenz-Anmutung: moderne Dokumentationsseiten, nicht Social Media.

## 5. Datenmodell

Vollständig in `supabase/migrations/0001_init.sql`. Kernprinzip: jede Tabelle trägt `tenant_id`, RLS erzwingt Mandantengrenzen; Rollenprüfung über `public.member_role(tenant_id)` (security definer). Personenbezogene Zeilen (progress, attempts, submissions, tutor_messages) zusätzlich auf `user_id = auth.uid()` beschränkt; Staff (owner/admin/trainer) liest mandantenweit.

Tabellenübersicht: tenants, profiles, memberships, courses, modules, lessons, enrollments, progress, quizzes, questions, attempts, submissions, certificates, products, orders, subscriptions, ai_jobs, embeddings, tutor_conversations, tutor_messages, webhooks, webhook_deliveries, api_keys, usage_counters, audit_log. Marketplace (04.08.2026, Abschnitt 10): marketplace_listings, marketplace_ledger, platform_settings (platform_admins existierte bereits seit Phase 4).

Storage-Buckets (Phase 1 anzulegen): `branding` (öffentlich lesbar), `course-assets` (öffentlich lesbar via signierte URLs optional), `submissions` (privat), `certificates` (privat). Pfadkonvention: `{tenant_id}/...`; Policies analog RLS.

## 6. KI-Funktionen (Produkt)

| Funktion | Modell | Ablauf | Kosten/Vorgang (ca.) |
|---|---|---|---|
| Kurs-Generator | claude-sonnet | Upload (PDF/DOCX/PPTX/Transkript) → Extraktion → Strukturvorschlag (Module/Lektionen/Lernziele) → Lektionstexte + Quiz je Modul → Review-Ansicht → Übernahme als Entwurf | 0,50–1,00 € |
| Tutor-Chat | claude-haiku | Frage → pgvector-Suche über Kurs-Chunks (Top 6) → Antwort mit Quellen-Lektion → optional „An Trainer weiterleiten" | 0,004 € |
| Transkript + Kapitel + Zusammenfassung | Whisper-kompatible STT via Bunny/extern, Zusammenfassung claude-haiku | nach Video-Upload automatisch als Job | 0,05–0,15 €/Video |
| Quiz-Generator | claude-sonnet | aus Lektionsinhalt 5–10 Fragen mit Distraktoren | 0,05 € |
| Semantische Suche | Embeddings + pgvector | Chunking je Lektion (500–800 Tokens), HNSW-Index | < 0,001 €/Anfrage |

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
