# PHASENSTATUS — Calltalent-Akademie

## Phase 0 — Fundament (10.07.2026) ✅

**Erledigt:**

1. Projektordner SOFTWARE/calltalent-akademie/ mit README, CLAUDE.md, SPEC.md
2. Datenbankschema komplett: supabase/migrations/0001_init.sql (Multi-Tenant, RLS auf allen Tabellen, pgvector)
3. Subagenten definiert: .claude/agents/ (architect, builder, security-reviewer, tester)
4. Git: Init über Cowork-Sandbox nicht möglich (Netz-Mount blockiert Lock-Dateien). Erledigen in Phase 1 lokal: defekten Ordner .git löschen, dann git init -b main && git add -A && git commit

**Erledigt am 10.07.2026 abends:**

5. Supabase-Projekt LIVE: „calltalent-akademie", ref vklqksdiyiijzoirntyt, Region eu-central-1 (Frankfurt), Free Tier (0 €). URL: https://vklqksdiyiijzoirntyt.supabase.co
6. Migration 0001_init angewendet und damit validiert: 25 Tabellen, RLS überall aktiv (list_tables geprüft)
7. Security-Härtung (Migrationen hardening + hardening2): search_path der Trigger-Funktion gepinnt, vector-Extension nach extensions verschoben, EXECUTE auf member_role/is_staff nur noch für authenticated + service_role. Verbleibende 2 Advisor-Hinweise (authenticated darf Definer-Funktionen aufrufen) sind beabsichtigt — Funktionen liefern nur die eigene Rolle des Aufrufers; RLS-Policies benötigen den Aufruf.
8. .env im Projektordner angelegt (gitignored): Supabase-URL + Publishable Key + Anthropic-API-Key eingetragen; .env.example als Vorlage. SUPABASE_SERVICE_ROLE_KEY muss Josip aus dem Dashboard nachtragen (Project Settings → API Keys).

9. Bunny Stream LIVE (10.07.): Library 701877 (EU), CDN vz-654f1bcf-ba9.b-cdn.net, API-Key in .env; Premium-Encoding und Transcribing bewusst AUS (Standard-Encoding reicht; STT kommt in Phase 3 eigener, ~15x guenstiger)

10. SUPABASE_SERVICE_ROLE_KEY von Josip in .env eingetragen (10.07.) — .env damit KOMPLETT (Supabase, Anthropic, Bunny). Phase 0 vollständig abgeschlossen.

**Offen (in Phase 1 zu erledigen):**

1. Defekten .git-Ordner löschen (Überbleibsel Sandbox-Versuch), dann lokal: git init -b main && git add -A && git commit
2. Stripe- und Resend-Keys in .env (erst Phase 2 nötig)
3. Entscheidung Produktions-Domain (z. B. akademie.calltalent.ai) — nicht dringend

**Risiken/Entscheidungen:**

1. Schema ist bewusst vollständig (auch Phase-2/3-Tabellen), damit RLS von Anfang an konsistent ist. Spätere Anpassungen als neue Migrationen, nie 0001 editieren.
2. Bunny statt Cloudflare Stream: ~5–10× günstiger bei Speicher; LearningSuite nutzt dieselbe CDN (Qualitätsbeleg).
3. Kontingent-Logik (500 Tutor-Antworten/Monat im Komplett-Paket) über usage_counters, hart durchgesetzt serverseitig.

## Phase 1 — Kern 🔶 (begonnen 10.07.2026 abends, Cowork)

**architect-Plan (Opus) erstellt:** 6 Blöcke — 1) App-Gerüst+Auth, 2) Mandanten-Auflösung+Branding, 3) Kurs-/Modul-/Lektions-Editor, 4) Bunny-Upload+Player, 5) Lernansicht+Fortschritt, 6) Nutzerverwaltung+CSV-Import.

**Entscheidungen (mit Josip abgestimmt):**
1. Dev-Domainschema Mandanten: `{slug}.localhost:3000`.
2. Bunny-Encoding-Webhook: verschoben auf Phase 3 (nur `video_bunny_id` speichern).
3. Git-Cleanup freigegeben (siehe unten, Block 0 noch offen — muss lokal laufen).

**Block 1 — App-Gerüst + Supabase-Clients + Auth: Dateien erstellt (Cowork-Sandbox, ungetestet — kein npm install/dev in Sandbox möglich):**
1. Next.js-Scaffold: package.json (Next 16.2.10, React 19.2.4, TS strict, Tailwind v4), next.config.ts (next-intl-Plugin), tsconfig.json, eslint.config.mjs, postcss.config.mjs
2. src/lib/env.ts — zod-validierte Env, publicEnv vs. getServerEnv() strikt getrennt
3. src/lib/supabase/client.ts, server.ts, admin.ts — drei getrennte Clients (Browser/Server-anon/Admin-service_role), admin.ts mit `server-only`
4. src/middleware.ts — Session-Refresh (Tenant-Auflösung folgt Block 2)
5. src/lib/auth/schema.ts + actions.ts — Magic Link, Passwort-Login, Registrierung, Signout, legt profiles-Zeile bei Erstanmeldung an
6. src/app/auth/callback/route.ts, src/app/auth/signout/route.ts
7. src/app/(auth)/login/page.tsx, src/app/(auth)/registrieren/page.tsx
8. src/i18n/request.ts, messages/de.json — next-intl-Basis (Locale „de")
9. src/app/layout.tsx, src/app/page.tsx — Root-Layout mit NextIntlClientProvider, Platzhalter-Startseite
10. vitest.config.ts, src/test/setup.ts, src/lib/env.test.ts, playwright.config.ts, e2e/auth.spec.ts

**Offen — zwingend vor Weiterarbeit (nächste lokale Sitzung mit Claude Code, Modell Sonnet):**
1. **Git:** defekten `.git`-Ordner (falls vorhanden) löschen, dann `git init -b main && git add -A && git commit -m "chore: Phase 0 + Block 1 Grundgerüst"`. Cowork-Sandbox kann das wegen Netz-Mount-Sperre nicht selbst ausführen (bestätigt getestet).
2. `npm install` lokal ausführen (Sandbox hält keine dauerhaften Hintergrundprozesse — jeder Bash-Aufruf ist isoliert, npm install bricht ab).
3. `npm run dev` lokal starten, Block 1 prüfen (Login, Registrierung, Magic Link E2E) — tester-Agent einsetzen.
4. Vor erstem Commit: Secret-Scan .env vs. .gitignore (service_role/Anthropic/Bunny-Keys dürfen nicht ins Repo).
5. Danach Block 2 (Mandanten-Auflösung + Branding) mit builder-Agent starten.

**Wichtige Erkenntnis:** Cowork-Sandbox eignet sich für Datei-Erstellung/-Bearbeitung, aber NICHT für npm install, Dev-Server oder Testausführung (Prozesse enden zwischen Aufrufen). Ab jetzt produktiv weiterarbeiten: lokal mit Claude Code im Ordner `SOFTWARE/calltalent-akademie/`.

## Phase 2 — Geschäft ⬜

## Phase 3 — KI ⬜

## Phase 4 — Skalierung ⬜
