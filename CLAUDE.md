# CLAUDE.md — Calltalent-Akademie (Bau-Verfassung)

Du baust die Calltalent-Akademie: eine KI-native, mandantenfähige White-Label-Lernplattform. Referenzen: `SPEC.md` (Produkt), `supabase/migrations/0001_init.sql` (Datenmodell), Analyse in `../../VORBEREITUNG/Analyse_LearningSuite_Klon-Strategie_2026-07-10.md`.

Sprache: Deutsch (Antworten, Commits, UI-Texte). Code, Bezeichner und Kommentare: Englisch.

## 1. Stack (fix — Abweichung nur mit hartem technischen Grund)

1. Next.js 15 (App Router) + TypeScript strict + Tailwind + shadcn/ui
2. Supabase: Postgres + RLS, Auth (Magic Link + Passwort), Storage; Region EU-Frankfurt
3. Video: Bunny Stream (EU-Library); niemals Videodateien in Supabase Storage
4. Zahlungen: Stripe (Checkout + Billing + Webhooks)
5. E-Mail: Resend (Transaktionsmails, deutsche Vorlagen)
6. Produkt-KI: Claude API — claude-sonnet für Generierung, claude-haiku für Tutor-Chat; Embeddings + pgvector für Suche/RAG
7. Deployment: Cloudflare Workers via OpenNext; Custom Domains je Mandant (Cloudflare for SaaS)
8. Tests: Vitest (Unit) + Playwright (E2E)

## 2. Nicht verhandelbare Sicherheitsregeln

1. Jede neue Tabelle: `tenant_id` + RLS aktiviert + Policies im selben Migrationsschritt. Keine Ausnahme.
2. `service_role`-Key und API-Keys (Anthropic, Bunny, Stripe, Resend) existieren nur serverseitig (Workers-Env / Route Handlers). Niemals im Client-Bundle, niemals im getrackten Repo (Git-Commit) — diese zwei Verbote bleiben absolut, auch mit Freigabe.
   **Ausnahme (Josip, 12.07.2026, erweitert):** Josip darf mir einen Live-Schlüssel direkt im Chat geben, wenn er das im Einzelfall ausdrücklich erlaubt. Damit darf ich ihn: (a) für den genannten Zweck verwenden (z. B. Secret in Cloudflare/Supabase/Stripe eintragen), und (b) wenn Josip das zusätzlich ausdrücklich erlaubt, auch persistent speichern — aber ausschließlich in einer git-ignorierten lokalen Datei (`.env`/`.env.local`, siehe `.gitignore`), nie in `.env.example`, nie in PHASENSTATUS.md, nie in Memory, nie in einer getrackten Datei. Nie im Klartext zurück in den Chat echoen. Ohne diese zusätzliche Speicher-Freigabe gilt weiterhin: nach der einmaligen Aktion nicht behalten. Ohne Tool-Zugriff auf den jeweiligen Cloud-Secret-Store (aktuell: kein `wrangler secret put`-Äquivalent per MCP) bleibt das Eintragen dort praktisch entweder bei Josip selbst oder läuft über Chrome-Steuerung auf dem jeweiligen Dashboard.
3. Alle Eingaben mit zod validieren (API-Routen und Server Actions).
4. Stripe- und Bunny-Webhooks: Signatur prüfen, bevor irgendetwas verarbeitet wird.
5. Datei-Uploads: Typ- und Größen-Whitelist; Storage-Pfade beginnen mit `{tenant_id}/`.
6. Keine Secrets, echten E-Mail-Adressen oder Kundendaten in Tests/Fixtures.

## 3. Produktregeln

1. Kein Code, Design, Text oder Asset von learningsuite.io oder anderen Anbietern übernehmen. Eigenständiges Design (siehe SPEC 4.5).
2. Jeder Kern-Workflow in maximal 3 Klicks; sinnvolle Standardwerte statt Pflicht-Konfiguration.
3. Performance-Budget: LCP < 1 s (Edge-Cache), Lighthouse mobil ≥ 90, Player-Start < 500 ms.
4. Barrierefreiheit WCAG 2.1 AA: Tastaturbedienung, Fokus-Ringe, Kontrast ≥ 4,5:1, Schriftgröße skalierbar, Screenreader-Labels. (Der Auftraggeber ist sehbehindert — Barrierefreiheit ist Produktanforderung, nicht Kür.)
5. UI-Standardsprache Deutsch, i18n-Struktur von Anfang an (next-intl), Texte in `messages/de.json`.
6. KI-Transparenz: Tutor-Antworten sind sichtbar als „KI-Assistent" gekennzeichnet (Art. 50 KI-VO).
7. KI-Verbrauch: jeder Claude-Aufruf schreibt `ai_jobs`/`tutor_messages` mit Tokens und Kosten; Monats-Kontingente über `usage_counters` durchsetzen.

## 4. Arbeitsweise

1. Vor jeder Phase: Plan Mode, `architect`-Agent erstellt Umsetzungsplan (Dateien, Reihenfolge, Risiken). Erst nach Plan bauen.
2. Kleine Commits mit deutschem Imperativ-Präfix: `feat: … / fix: … / test: … / chore: …`.
3. Nach jedem Feature: `tester`-Agent (Vitest + Playwright). Nach jeder Phase: `security-reviewer`-Agent (RLS-Audit, OWASP-Checkliste, Secret-Scan).
4. `PHASENSTATUS.md` nach jedem Arbeitsblock aktualisieren: Erledigt / Offen / Risiken.
5. Bei Unklarheit: SPEC.md befolgen; wenn SPEC schweigt, einfachste Lösung wählen und Entscheidung in PHASENSTATUS.md notieren.
6. Nichts löschen oder deployen ohne ausdrückliche Freigabe von Josip.

## 5. Befehle (ab Phase 1 gültig)

```bash
npm run dev          # Entwicklung (localhost:3000)
npm run test         # Vitest
npm run e2e          # Playwright
npm run lint         # ESLint + TypeScript-Check
npx supabase db push # Migrationen anwenden (lokal verlinktes Projekt)
npm run deploy       # OpenNext-Build + Cloudflare Workers Deploy (nur nach Freigabe)
```

## 6. Phasenplan (Definition of Done je Phase in SPEC 8)

1. **Phase 1 — Kern:** App-Gerüst (create-next-app, shadcn, next-intl), Supabase-Anbindung + Migration 0001, Auth-Flows, Mandanten-Auflösung (Subdomain/Domain → tenant), Branding-Theming, Kurs-/Modul-/Lektions-Editor mit Blöcken, Bunny-Upload (TUS) + Player, Lernansicht mit Fortschritt, Nutzerverwaltung + CSV-Import.
2. **Phase 2 — Geschäft:** Quiz/Prüfungen + Versuche, Abgaben-Inbox mit Bewertung, Zertifikate (PDF), Stripe-Produkte/Checkout/Portal, E-Mail-Benachrichtigungen, Reporting v1 (Fortschritt, Abschlüsse, CSV-Export).
3. **Phase 3 — KI:** Kurs-Generator (Upload → Entwurf → Review → Übernahme), Tutor-Chat mit RAG + Eskalation, Auto-Transkript/Kapitel/Zusammenfassung, semantische Suche, REST-API v1 + Webhooks.
4. **Phase 4 — Skalierung:** Betreiber-Portal (Mandant anlegen in 5 Minuten), PWA, vollständige E2E-Suite, Security-Audit, DSGVO-Paket (AVV-Muster, TOMs, Datenexport je Mandant), Migrations-Importer (CSV + Video-Reupload).

## 7. Subagenten

| Agent | Modell | Auftrag |
|---|---|---|
| architect | opus | plant, entwirft, ändert keinen Code |
| builder | sonnet | implementiert nach Plan |
| security-reviewer | sonnet | prüft RLS/OWASP/Secrets, nur lesend |
| tester | sonnet | schreibt und fährt Tests |

Modellpolitik Entwicklung: Sonnet ist Standard; Opus nur über den architect-Agenten.
