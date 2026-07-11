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

**Erledigt (lokal durch Josip, 10.07.2026 spätabends):**
1. Git init lokal erfolgreich: `main`-Branch, erster Commit `dcd1faa "chore: Phase 0 + Block 1 Grundgerüst"`.
2. `npm install` erfolgreich (515 Pakete). 7 npm-audit-Hinweise (5 moderate, 1 high, 1 critical) — bewusst noch NICHT mit `--force` gefixt (Breaking-Change-Risiko); vor Phasenabschluss gezielt prüfen.
3. `npm run dev` erfolgreich, Next.js 16.2.10.
4. Next.js-16-Fix: `src/middleware.ts` → `src/proxy.ts` umbenannt (Next 16 verlangt neue Namenskonvention, Funktionsname `middleware` → `proxy`, Runtime jetzt Node.js statt Edge). Alte Datei gelöscht.
5. Hydration-Fix: `suppressHydrationWarning` auf `<html>` in layout.tsx (Ursache: Browser-Erweiterung LanguageTool schreibt `data-lt-installed` vor React-Hydration ins DOM — kein App-Bug).
6. `next-intl` von `^3` auf `latest` gesetzt (Next 16.2.10 war zu neu für next-intl@3-Peer-Dependency).
7. **E2E bestätigt:** Registrierung mit office@calltalent.ai → E-Mail-Bestätigung → Login → Session aktiv → Abmelden-Button sichtbar. profiles-Zeile wird bei Erstanmeldung automatisch angelegt (RLS `profiles_own` greift).

**Block 1 damit fertig und verifiziert.** Offen für Phasenabschluss (nicht blockierend für Block 2): npm-audit-Vulnerabilities gezielt prüfen, Vitest/Playwright-Suite tatsächlich laufen lassen (env.test.ts, auth.spec.ts wurden nur geschrieben, noch nicht ausgeführt).

**Wichtige Erkenntnis:** Cowork-Sandbox eignet sich für Datei-Erstellung/-Bearbeitung, aber NICHT für npm install, Dev-Server oder Testausführung (Prozesse enden zwischen Aufrufen). Ausführung/Verifikation läuft lokal bei Josip (PowerShell), Dateiänderungen weiterhin über Cowork.

**Block 2 — Mandanten-Auflösung + Branding: erstellt (Cowork, DB-Teil live gegen Supabase, Code-Teil lokal zu prüfen):**
1. Migration `0002_storage` LIVE angewendet (Supabase MCP): Storage-Buckets `branding`, `course-assets` (öffentlich lesbar), `submissions`, `certificates` (privat), Policies nach `{tenant_id}/...`-Pfadkonvention, Staff-Schreibrechte über `member_role`/`is_staff`.
2. Zwei Demo-Mandanten LIVE angelegt (synthetische Daten): `demo-blau` (Akzent #1d4ed8, radius 0.5rem) und `demo-gruen` (Akzent #15803d, radius 1rem). Josip als `owner` in `demo-blau` eingetragen (office@calltalent.ai).
3. src/lib/tenant/types.ts — PublicTenant (strikt sichere Teilmenge von tenants), DEFAULT_BRANDING-Fallback.
4. src/lib/tenant/resolve.ts — resolveTenantBySlug/-ByCustomDomain/-ById/-ByHost, ALLE über Admin-Client (service_role), weil RLS `tenants_member_select` Mitgliedschaft verlangt und anonyme Besucher noch keine sind. Strikte Spaltenliste, kein `select *`.
5. src/proxy.ts erweitert: Host → resolveTenantByHost → `x-tenant-id`/`x-tenant-slug` als REQUEST-Header (nicht nur Response — wichtig für next/headers() in Server Components).
6. src/lib/tenant/context.ts — getTenant() mit React cache(), liest Header, lädt vollen Tenant nach.
7. src/components/branding/theme-style.tsx — injiziert CSS-Variablen (--color-primary, --color-background, --radius) im `<head>`; einfache Whitelist-Validierung gegen CSS-Injection über Branding-Felder.
8. src/app/layout.tsx, src/app/page.tsx angepasst: Branding wird angewendet, Mandantenname als Titel/Überschrift; Root-Domain ohne Subdomain zeigt Dev-Hinweis mit den zwei Demo-URLs statt Absturz.

**Block 2 vollständig verifiziert (Josip, 10.07.2026 spätnachts):** demo-blau (blau) und demo-gruen (grün) zeigen unterschiedliches Branding parallel; Root-Domain zeigt Dev-Hinweis statt Fehler; Login auf demo-blau funktioniert mit bestehender Mitgliedschaft. Ein Bug unterwegs behoben: env.ts akzeptierte leere `.env`-Strings (`VAR=`) nicht als "nicht gesetzt" — jetzt `optionalString`-Preprocessing in src/lib/env.ts.

**Block 3 — Kurs-/Modul-/Lektions-Editor mit Blöcken: erstellt (Cowork, lokal zu prüfen):**
1. src/lib/courses/schema.ts — 9 Block-Typen als zod discriminatedUnion (text, image, video, audio, file, quiz, submission, callout, embed), createEmptyBlock()-Factory, courseSchema mit Slug-Regex-Validierung.
2. src/lib/courses/schema.test.ts — Vitest für Block- und Slug-Validierung.
3. src/lib/auth/staff.ts — checkStaffAccess() (für Layouts, wirft nie) + requireStaffTenant() (für Server Actions, wirft) — beide rufen `is_staff(tenant_id)` per RPC als zweite Verteidigungslinie neben RLS.
4. src/lib/courses/actions.ts — Server Actions: createCourse, updateCourseStatus, deleteCourse, createModule, deleteModule, moveModule (Auf/Ab), createLesson, deleteLesson, updateLessonStatus, saveLessonBlocks (zod-validiertes Autosave), updateLessonTitle.
5. src/app/(admin)/admin/layout.tsx — Staff-Guard mit klaren Meldungen (kein Mandant / nicht angemeldet / kein Zugriff).
6. src/app/(admin)/admin/kurse/page.tsx + src/components/admin/create-course-form.tsx — Kursliste + Anlage-Formular.
7. src/app/(admin)/admin/kurse/[id]/page.tsx — Editor: Strukturbaum (Module/Lektionen) links, Block-Editor rechts, per `?lesson=`-Query-Param.
8. src/components/admin/module-lesson-tree.tsx — Modul-/Lektionsbaum mit Anlegen/Löschen/Verschieben.
9. src/components/editor/block-editor.tsx, block-form.tsx — Block-Liste mit Hinzufügen/Entfernen/Auf-Ab-Verschieben, Autosave 1s-Debounce, Speicherstatus-Anzeige.

**Bewusste Vereinfachung gegenüber architect-Plan:** kein Drag & Drop (Reihenfolge per Pfeiltasten-Buttons) — spart eine Dependency, funktional gleichwertig für Phase 1. Rich-Text ist eine einfache Textarea, kein WYSIWYG. Beides bei Bedarf später nachrüstbar, kein Rearchitecture nötig.

**Bug unterwegs behoben:** `src/lib/courses/actions.ts` (eine "use server"-Datei) exportierte `initialCourseActionState` als Objekt — Next.js 16 erlaubt in "use server"-Dateien nur async-Funktions-Exporte. Fix: Konstante + Typ nach `src/lib/courses/state.ts` ausgelagert, drei Komponenten entsprechend umgestellt.

**Block 3 vollständig verifiziert (Josip, 10.07.2026 spätnachts):** Kurs „Test-Kurs" mit zwei Modulen und zwei Lektionen angelegt, Text-Block hinzugefügt und beschrieben, Autosave bestätigt (Reload-Test: Inhalt blieb erhalten → wirklich in DB, nicht nur Browser-State).

**Entscheidung:** Block 5 vor Block 4 (Lernansicht zuerst testbar ohne Video-Infrastruktur).

**Block 5 — Lernansicht + Fortschritt + Abschlusslogik: erstellt (Cowork, lokal zu prüfen):**
1. src/lib/progress/compute.ts — reine Funktionen: computeCourseProgress (Zähler/Prozent/isComplete), flattenLessonIds + findAdjacentLessonIds (Vor/Zurück-Navigation modulübergreifend).
2. src/lib/progress/compute.test.ts — Vitest, deckt Randfälle ab (leerer Kurs, erste/letzte Lektion).
3. src/lib/progress/actions.ts — completeLesson(): Upsert auf `progress` (unique user_id+lesson_id), RLS `progress_own` erzwingt Eigentümerschaft ohne Enrollment-Prüfung.
4. src/components/learn/block-renderer.tsx — read-only Darstellung aller 9 Blocktypen (Video/Quiz/Abgabe als Platzhalter mit Verweis auf späteren Block/Phase 2).
5. src/components/learn/complete-lesson-button.tsx — Abschließen-Button, springt danach automatisch zur nächsten Lektion.
6. src/app/(learn)/kurs/[slug]/page.tsx — Kursübersicht: Fortschrittsbalken, Modul-/Lektionsliste mit Häkchen, „Kurs starten"/„Weiterlernen".
7. src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx — Lernansicht: Blöcke, Vor/Zurück, Abschließen.
8. src/app/page.tsx umgebaut zu „Meine Kurse": Liste veröffentlichter Kurse mit Fortschrittsbalken je Kurs; Link zu /admin/kurse falls Staff.
9. src/components/admin/publish-toggle.tsx + Einbau in admin/kurse (Kursliste) und admin/kurse/[id] (Lektion) — Veröffentlichen/Entwurf-Umschalter, ohne den gab es keinen Weg, Kern-DoD zu testen (Lernende sehen nur `status='published'`).

**Bewusste Vereinfachung:** keine Enrollment-Zeilen für Sichtbarkeit — RLS `courses_member_select` zeigt jedem Mandanten-Mitglied alle veröffentlichten Kurse (nicht nur zugewiesene). Formale Kurs-Zuweisung/Enrollment kommt mit Block 6 (Nutzerverwaltung) bzw. Stripe-Kauf in Phase 2. `progress`-Tracking funktioniert unabhängig davon schon jetzt korrekt (RLS `progress_own`).

**Block 5 vollständig verifiziert (Josip, 10.07.2026 nachts):** „Test-Kurs" veröffentlicht, beide Lektionen veröffentlicht und abgeschlossen, Startseite zeigt „2/2 Lektionen — abgeschlossen 🎉" mit vollem Fortschrittsbalken. Kompletter Lernpfad (Meine Kurse → Kursübersicht → Lernansicht → Abschließen → zurück) funktioniert E2E. Kern-DoD Satz „Kurs anlegen und als Lernender abschließen" damit erfüllt — nur noch ohne Video (Block 4 fehlt).

**Block 4 — Bunny-Upload (TUS) + Player: erstellt (Cowork, lokal zu prüfen):**
1. src/lib/bunny/client.ts — server-only: createBunnyVideo() (Create-Video-API), generateTusCredentials() (SHA256-Signatur aus libraryId+apiKey+expirationTime+videoId, 24h Gültigkeit), deleteBunnyVideo(), getPlayerConfig() (liefert nur libraryId, keine geheime Information — steckt ohnehin in jeder Embed-URL).
2. src/app/api/bunny/create-video/route.ts — POST-Route: requireStaffTenant()-Gate, zod-Body-Validierung, legt Bunny-Video an, gibt signierte TUS-Credentials zurück. Datei selbst läuft NIE durch unseren Server.
3. src/components/editor/video-upload.tsx — Client-Komponente: Typ-Whitelist (MP4/MOV/WebM/MKV) + Größen-Whitelist (max. 2 GB), tus-js-client lädt direkt zu Bunny hoch (video.bunnycdn.com/tusupload), Fortschrittsanzeige, Resume bei Abbruch (TUS-Standard).
4. src/components/editor/block-form.tsx — Video-Block nutzt jetzt VideoUpload statt Platzhaltertext.
5. src/components/player/bunny-player.tsx — iframe-Player (iframe.mediadelivery.net/embed/{libraryId}/{videoId}), Server Component.
6. src/components/learn/block-renderer.tsx — Video-Block rendert jetzt BunnyPlayer statt Platzhalter (Fallback-Text falls Bunny nicht konfiguriert).

**Bewusst nicht in Block 4 (laut Entscheidung 10.07.2026):** Encoding-Webhook (Status „fertig kodiert") — verschoben auf Phase 3 zusammen mit der STT-Entscheidung. Aktuell wird direkt nach Upload-Ende der Player eingebettet; Bunny kodiert im Hintergrund weiter, das ist normales Bunny-Verhalten und nicht in unserer Kontrolle.

**Block 4 vollständig verifiziert (Josip, 11.07.2026):** Video-Upload, Bunny-Dashboard-Eintrag und Player in der Lernansicht funktionieren wie erwartet.

**Block 6 — Nutzerverwaltung + CSV-Import: erstellt (Cowork, lokal zu prüfen):**
1. src/lib/auth/staff.ts erweitert: `checkAdminAccess()`/`requireAdminTenant()` — strenger als der bestehende Staff-Check, da RLS `memberships_admin_write` Schreiben auf `memberships` NUR owner/admin erlaubt (trainer zählt hier bewusst NICHT, anders als bei `is_staff`).
2. src/lib/users/csv.ts — einfacher CSV-Parser (Kopfzeile `email,full_name,course_slug`, `full_name`/`course_slug` optional), zod-Validierung pro Zeile, Duplikat-Erkennung innerhalb der Datei, Zeilennummern in Fehlermeldungen.
3. src/lib/users/csv.test.ts — Vitest: gültige Zeilen, fehlende Spalten, ungültige E-Mail, Duplikate, leere Datei.
4. src/lib/users/import.ts — server-only Bulk-Import über Admin-Client (service_role, umgeht RLS bewusst): `inviteUserByEmail()` pro Zeile, bei „bereits registriert" Fallback auf Suche per E-Mail (`listUsers`) statt Fehler; Upsert `profiles` (inkl. Pflichtfeld `email`) + `memberships` (Rolle `member`, Status `active`) + optional `enrollments` (`source: 'import'`) bei gesetztem `course_slug`. Verarbeitung in 10er-Batches parallel für die 30-Sekunden-DoD bei 100 Zeilen.
5. src/app/api/admin/users/import/route.ts — POST-Route, `requireAdminTenant()`-Gate, zod-Body-Validierung, Zeilenlimit 500, gibt Zusammenfassung inkl. Dauer zurück.
6. src/lib/users/actions.ts — Server Actions: `inviteSingleUser` (Einzeleinladung, nutzt dieselbe Import-Logik), `disableMembership`/`enableMembership` (Soft-Delete statt Hard-Delete, damit Fortschritts-/Enrollment-Historie erhalten bleibt).
7. src/components/admin/invite-user-form.tsx, csv-import-form.tsx, membership-row-actions.tsx — Formulare/Upload/Statusumschalter.
8. src/app/(admin)/admin/nutzer/page.tsx — eigenes Admin-Gate (`checkAdminAccess`, strenger als das Layout-weite Staff-Gate), Mitgliederliste mit Rolle/Status, Einzel-Einladung + CSV-Import nebeneinander.
9. src/app/(admin)/admin/layout.tsx — Navigation „Kurse"/„Nutzer" im Header ergänzt.

**Bewusste Vereinfachung:** kein Massen-Rollenwechsel (nur Aktivieren/Deaktivieren) — Rollenänderung ist in Phase 1 seltener Einzelfall, direkt in Supabase möglich, kein UI-Aufwand gerechtfertigt. `findUserByEmail` liest bis zu 1000 Nutzer auf einer Seite (Supabase Admin API kennt keine direkte E-Mail-Suche) — für Phase-1-Mandantengrößen ausreichend, bei Bedarf später auf Pagination umstellen.

**Bugfix (Josip, 11.07.2026, beim ersten Test gefunden):** CSV-Import mit 2 Testzeilen schlug komplett fehl mit „email rate limit exceeded". Ursache: `inviteUserByEmail()` verschickt pro Zeile eine echte Auth-E-Mail über Supabase' Standard-SMTP, das ein sehr niedriges eingebautes Rate-Limit hat (greift schon bei 2-3 Mails) — hätte die 30-Sekunden/100-Nutzer-DoD unabhängig von unserer Batch-Parallelisierung unmöglich gemacht. Fix in `src/lib/users/import.ts`: Konto-Anlage von E-Mail-Versand entkoppelt, `createUser()` (kein Mail-Versand, kein Rate-Limit) statt `inviteUserByEmail()`. Status-Feld dadurch umbenannt: `invited` → `created` (in `ImportRowResult`/`ImportSummary`, sowie in `csv-import-form.tsx` und `invite-user-form.tsx` entsprechend anpasst). Die eigentliche Einladungs-/Willkommens-Mail ist jetzt bewusst auf Phase 2 verschoben (Resend, siehe CLAUDE.md-Stack) — neue Konten sind aber sofort aktiv, Login z. B. über „Passwort vergessen"/Magic Link möglich.

**Block 6 mit Bugfix verifiziert (Josip, 11.07.2026):** CSV-Import mit 2 Testzeilen erfolgreich („2 Konten neu angelegt, 0 Fehler", 0,6 s), Mitgliederliste zeigt Test Eins/Test Zwei korrekt mit Deaktivieren-Button.

**Kern-DoD „CSV-Import 100 Nutzer < 30 s" ERFÜLLT (Josip, 11.07.2026):** 100-Zeilen-Import in 19,4 s — 97 Konten neu angelegt, 2 bestehenden Nutzern zugeordnet (die 2 aus dem vorherigen Test), 1 transienter Fehler (`fetch failed` unter paralleler Last). Testdatei fehlte zunächst die Kopfzeile (`email,full_name,course_slug`) — dabei zwei echte Bugs gefunden und behoben:
1. `csv-import-form.tsx` zeigte bei Server-Fehlern nur eine generische Meldung („Keine gültigen Zeilen gefunden") und verschluckte die eigentlichen `parseErrors` (z. B. „Fehlende Spalten") — jetzt werden Zeilendetails auch im Fehlerfall angezeigt.
2. `import.ts`: 1 von 100 Zeilen schlug mit transientem `fetch failed` fehl. Fix: `importOneUserWithRetry()` — ein automatischer Retry mit 300 ms Verzögerung, sicher wiederholbar, weil alle Schreibvorgänge (createUser fällt bei „existiert bereits" auf den linked-Pfad zurück, memberships/enrollments sind Upserts) idempotent sind.
Die von mir erzeugte `test100.csv` wurde nach dem Test wieder gelöscht (kein Teil des Projekts).

**Git-Commit erledigt (Josip, 11.07.2026):** „feat: Block 6 - Nutzerverwaltung und CSV-Import (inkl. Rate-Limit-Fix und Retry)". Damit ist der gesamte Phase-1-Code (alle 6 Blöcke) versioniert.

**Testsuiten ausgeführt und alle grün (Josip, 11.07.2026):**
1. Vitest: 15/15 bestanden. Bug gefunden+behoben: `vitest.config.ts` lud `.env` nicht in `process.env` (anders als `next dev`), dadurch schlug `env.test.ts` mit „Ungültige öffentliche Umgebungsvariablen" fehl. Fix: `test.env: loadEnv("", process.cwd(), "")` aus `vite` (nicht `vitest/config` — dort nicht exportiert) ergänzt.
2. Playwright: 1/1 bestanden. Bug gefunden+behoben: `e2e/auth.spec.ts` nutzte `getByLabel("E-Mail")`/`getByLabel("Passwort")` ohne `exact: true` — matcht auf der Login-Seite per Teilstring sowohl das Passwort- als auch das Magic-Link-E-Mail-Feld (bzw. das `aria-label` des umgebenden Formulars „Mit Passwort anmelden"). Fix: `exact: true` gesetzt, zusätzliche Prüfung für das Magic-Link-Feld ergänzt.

**npm-audit geprüft (Josip, 11.07.2026):** `npm audit --omit=dev` (nur Produktions-Abhängigkeiten) zeigt ausschließlich 2 moderate Funde (postcss/next-Kette, „XSS via Unescaped `</style>` in CSS Stringify Output") — kein high, kein critical im produktiven Code. Die ursprünglich gemeldeten 1 high + 1 critical (und 3 der 5 moderate) stecken vollständig in der Vitest/Vite/esbuild-Kette, also reinem Test-Tooling (devDependencies), das nie mit ausgeliefert wird.
- postcss/next: `npm audit fix --force` würde Next.js auf 9.3.3 downgraden (absurder Breaking Change) — bewusst NICHT angewendet, Risiko vernachlässigbar (kein Verarbeiten von nutzergeneriertem CSS).
- esbuild-Kette: betrifft nur den lokalen Dev-/Test-Server (CORS-Schwäche), nie den produktiven Server. Fix würde Vitest v2→v4 heben (Breaking Change, gefährdet die gerade grün gewordene Suite) — bewusst zurückgestellt, kein Blocker für Phase-1-Abschluss. Als Folge-Task vorgemerkt: Vitest-4-Upgrade vor Phase 2.

**security-reviewer-Agent-Durchgang abgeschlossen (11.07.2026):** vollständiges RLS-/OWASP-/Secret-Audit gegen CLAUDE.md-Checkliste, inkl. Live-Supabase-Advisor-Abgleich. Ergebnis: 0 KRITISCH, 1 HOCH (phasenblockierend laut CLAUDE.md-Regel), 5 MITTEL, 3 NIEDRIG.

**HOCH-Fund SOFORT behoben (blockierte die Phase):** Stored XSS im Text-Block. `src/components/learn/block-renderer.tsx` rendert `block.html` ungefiltert über `dangerouslySetInnerHTML`; jedes Staff-Mitglied inkl. Trainer (RLS `lessons_staff_write` erlaubt das schon der niedrigsten Staff-Rolle) hätte beliebiges Script einschleusen können — ausgeführt im Browser jedes Members UND jedes Owners/Admins beim Ansehen der Lektion (Rechte-Eskalation innerhalb des Mandanten). Fix in `src/lib/courses/schema.ts`: `sanitize-html`-Whitelist-Sanitizing direkt im zod-Schema (`textBlockSchema.html` via `.transform()`) — greift bei JEDEM Schreibpfad (`saveLessonBlocks`), unabhängig vom Editor-Frontend. Erlaubte Tags: Absätze, Formatierung, Listen, Überschriften H2-H4, Links (mit `rel="noopener noreferrer"`), Zitat, Code. `package.json`: `sanitize-html` + `@types/sanitize-html` ergänzt (Josip muss `npm install` erneut laufen lassen). Zwei neue Vitest-Fälle in `schema.test.ts` (Script/Event-Handler werden entfernt, erlaubte Tags bleiben erhalten).

## MITTEL-Funde: alle bis auf einen behoben (11.07.2026, direkt im Anschluss)

Josip entschied: erst alle MITTEL-Funde aus dem security-reviewer-Audit schließen, dann Phase 2 starten.

1. **Bunny-Video-Mandantenbindung — behoben.** Neue Tabelle `bunny_videos(tenant_id, video_id)` (Migration `20260710233815_bunny_videos_tenant_binding.sql`, RLS `bunny_videos_staff_all`). `src/app/api/bunny/create-video/route.ts` befüllt sie beim Anlegen (Rollback + Fehler, falls Zuordnung fehlschlägt). `src/lib/courses/actions.ts` (`saveLessonBlocks`) prüft jede referenzierte `bunnyVideoId` gegen diese Tabelle — RLS filtert automatisch auf den eigenen Mandanten, ein fremdes Video taucht im Lookup gar nicht erst auf.
2. **Rate Limiting — behoben.** Leichtgewichtiger Postgres-Limiter statt neuem externen Dienst (kein Redis/Upstash im Stack): Tabelle `rate_limits` + `security definer`-RPC `check_rate_limit(key, max, windowSeconds)` (Migration `20260710235500_rate_limits.sql`). Neue Datei `src/lib/security/rate-limit.ts` (`checkRateLimit()`, fail-open bei technischem Fehler — ein Ausfall des Limiters darf nie legitime Nutzer aussperren). Eingebaut in: Login (10/60s, IP-basiert), Registrierung (5/300s), Magic Link (5/300s), CSV-Import (5/300s pro Mandant), Bunny-Video-Anlage (30/3600s pro Mandant, da kostenpflichtig).
3. **Storage-Listing-Leak — behoben.** `branding_public_read`/`course_assets_public_read` ersetzt durch `branding_staff_select`/`course_assets_staff_select` (nur Staff des jeweiligen Tenant-Ordners darf die Objektliste abfragen). Öffentliche Bild-Auslieferung bleibt unverändert funktionsfähig, da Supabase öffentliche Buckets (`public=true`, bestätigt für beide) über eine separate Route ausliefert, die RLS umgeht. Migration `20260710233735_security_hardening_storage_listing_and_products.sql`. Supabase-Advisor bestätigt: WARN ist aus der Liste verschwunden.
4. **`products_public_select`-RLS — behoben.** Ersetzt durch `products_member_select` (nur eigene Mandanten-Mitglieder sehen aktive Produkte). Echtes öffentliches Storefront-Browsing (vor Login) braucht in Phase 2 eine tenant-scoped Server-Route (Admin-Client + expliziter Filter, analog `resolve.ts`) statt direktem anon-REST-Zugriff — das kann RLS strukturell nicht sicher abbilden, da anon keine Tenant-Zugehörigkeit hat. Selbe Migration wie Punkt 3.
5. **Supabase „Leaked Password Protection" — offen, braucht Josip.** Reine Auth-Konfiguration (kein DB-Objekt, nicht per SQL setzbar): Dashboard → Authentication → Policies → aktivieren.

**Defense-in-Depth zusätzlich ergänzt (NIEDRIG-Fund #7 aus dem Audit, gleich miterledigt):** alle Mutationen in `src/lib/courses/actions.ts` (`updateCourseStatus`, `deleteCourse`, `deleteModule`, `moveModule`, `deleteLesson`, `updateLessonStatus`, `saveLessonBlocks`, `updateLessonTitle`) filtern jetzt zusätzlich zu `.eq("id", …)` auch nach `.eq("tenant_id", tenant.id)` — bisher kam der Schutz ausschließlich aus RLS, jetzt gibt es ein zweites Sicherheitsnetz auf Code-Ebene.

**Neu entdeckte Prozess-Lücke (nicht sicherheitskritisch, vorgemerkt als Task):** `supabase/migrations/` enthielt lokal nur `0001_init.sql` — `hardening`, `hardening2` und `0002_storage` wurden in Phase 0/Block 2 nur live über Supabase-MCP angewendet, nie als lokale `.sql`-Datei geschrieben. Die beiden heutigen neuen Migrationen wurden korrekt lokal nachgezogen; die drei älteren fehlen weiterhin und sollten vor dem ersten `supabase db push`/Deploy nachgeholt werden.

**Noch zu tun:** `npm install` (kein neues Paket nötig für diesen Block, aber falls seit dem letzten Mal nicht gelaufen), `npm run test`, Leaked-Password-Protection im Dashboard aktivieren, dann `git add -A && git commit -m "fix: MITTEL-Funde aus security-review (Bunny-Mandantenbindung, Rate Limiting, Storage-Listing, products-RLS, tenant_id-Defense-in-Depth)"`.

**NIEDRIG-Funde:** fehlende `tenant_id`-Filter als Defense-in-Depth in `courses/actions.ts`-Queries (RLS greift bereits korrekt, aber kein zweites Sicherheitsnetz auf Code-Ebene); kein DSGVO-Hard-Delete-Pfad (nur Soft-Delete via `disableMembership`, Phase-4-Thema); `findUserByEmail` paginiert nicht über 1000 Nutzer hinaus.

**Positivbefunde (verifiziert):** alle 25 Tabellen mit aktiver RLS; Mandantentrennung für member/trainer/admin/owner/anon durchgehend korrekt; `memberships_admin_write` vs. `is_staff` korrekt unterschiedlich streng, im Code (`requireAdminTenant`/`requireStaffTenant`) korrekt gespiegelt; CSV-Import-`tenantId` kommt ausschließlich aus dem serverseitig geprüften Kontext, nie aus Client-/CSV-Daten; `admin.ts` (service_role) korrekt mit `server-only` geschützt, kein Import in Client-Komponenten; keine Secrets im Repo; Quiz-Antworten (`questions`-Tabelle) haben ausschließlich `questions_staff_all`, keine Member-Select-Policy — kein Lösungs-Leak trotz bereits existierendem Datenmodell; Bunny-Upload-Whitelist und private Storage-Buckets korrekt umgesetzt.

**Phase 1 damit inhaltlich abgeschlossen** — der einzige phasenblockierende Fund ist behoben. `npm install` + `npm run test` + Leaked-Password-Protection + Commit von Josip bestätigt (11.07.2026).

## Aufräumen nach Phase-1-Abschluss (11.07.2026, auf Wunsch von Josip)

**Lokale Migrationsdateien nachgeholt:** `20260710205101_hardening.sql`, `20260710205205_hardening2.sql`, `20260710214020_0002_storage.sql` — aus dem Live-Zustand der DB rekonstruiert (Funktionsdefinitionen, Grants, Bucket-/Policy-Definitionen per `execute_sql` ausgelesen), mit denselben Zeitstempeln/Namen wie in der Supabase-Migrationshistorie (`list_migrations`), damit `supabase db push`/`db pull` künftig konsistent bleiben. `0002_storage.sql` bildet bewusst den historischen Anlage-Zustand nach (inkl. der später ersetzten `_public_read`-Policies) — die Chronologie mit der Security-Fix-Migration bleibt dadurch nachvollziehbar. Repo bildet den DB-Zustand jetzt vollständig ab.

**Vitest v2 → v4 Upgrade verifiziert (Josip, 11.07.2026):** `package.json` auf `"vitest": "^4"` gesetzt, `npm install` erfolgreich (Vitest 4.1.10), alle 17 Tests weiterhin grün, keine Breaking Changes in `vitest.config.ts` nötig. `npm audit`: 7 → 4 Schwachstellen (3 moderate, 1 high). `npm audit --omit=dev` bestätigt: unverändert nur die bereits bekannten 2 moderate (postcss/next-Kette) in Produktions-Abhängigkeiten — kein neues Produktionsrisiko durch das Upgrade. Die restlichen 2 (inkl. der 1 high) stecken vollständig in devDependencies.

**Nachtrag Demo-Mandanten (11.07.2026 nachts):** `demo-gruen` hatte seit Phase 0 keine einzige `memberships`-Zeile (Josip war nur in `demo-blau` als `owner` eingetragen) — dadurch weder Admin-Nav noch Kursliste sichtbar (RLS griff korrekt, aber ohne Mitgliedschaft bleibt alles leer). Per SQL nachgetragen: Josip (`office@calltalent.ai`) jetzt auch `owner` in `demo-gruen`. Kein Code-Bug, reine Testdaten-Lücke.

## Phase 2 — Geschäft 🔶 (Planung 11.07.2026, Cowork)

**architect-Plan (Opus) erstellt:** 6 Blöcke in dieser Reihenfolge — 1) E-Mail-Fundament (Resend) inkl. nachgeholter Willkommensmail aus P1-Block-6, 2) Quiz/Prüfungen + Versuche (Auswertung + Lösungen ausschließlich serverseitig, `questions.answer` verlässt nie den Client), 3) Abgaben-Inbox + Bewertung, 4) Zertifikate (PDF via `pdf-lib`, Workers-kompatibel, Trigger in `completeLesson()`), 5) Stripe (Produkte/Checkout/Webhook→automatische Einschreibung/Portal/öffentliche Kaufseite), 6) Reporting v1 + CSV-Export. Kernbefund: alle Phase-2-Tabellen (quizzes, questions, attempts, submissions, certificates, products, orders, subscriptions) existieren bereits mit RLS in `0001_init.sql` — Phase 2 baut fast nur Code, kaum neue Migrationen (einziger möglicher Kandidat: Unique-Constraint `certificates(tenant_id,course_id,user_id)` für Idempotenz, Block 4).

**Entscheidungen (mit Josip abgestimmt, 11.07.2026):**
1. Stripe-Testmodus-Keys: Josip besorgt sie zuerst — Block 5 (Stripe) startet erst nach Freigabe, Blöcke 1–4 und 6 unabhängig davon umsetzbar.
2. Stripe-Produktanlage: automatisch per API bei Produktanlage im Calltalent-Admin (kein manuelles Dashboard-Pflegen der IDs).
3. Resend-Absender: einheitlich `noreply@<Betreiber-Domain>`, Anzeigename wechselt je Mandant (kein separates Domain-Setup je Kunde in Phase 2).
4. Zertifikats-Gate: „alle Lektionen abgeschlossen" genügt (kein zusätzliches Quiz-/Abgaben-Gating in v1), steuerbar über `courses.settings.certificate_enabled`.

**Sicherheitshinweis (11.07.2026 abends):** Josip hat im Chat einen Stripe-**Live**-Publishable-Key (`pk_live_…`) geteilt — bewusst (bestätigt: Calltalent nutzt für die Akademie dasselbe Live-Stripe-Konto wie für den bestehenden Voice-Vorgang, siehe Memory „Voice-Vorgangsmodell"). Nicht in Code/Migrationen übernommen, nicht in Memory gespeichert (Publishable Key ist unkritisch, Secret Key erst recht nicht). Geklärt: Live- und Testmodus sind zwei Schlüsselpaare desselben Kontos, kein separates Setup nötig.

**Entscheidung 1 präzisiert (11.07.2026 abends):** Block 5 wird mit **Testmodus-Keys** (`sk_test_…`/`whsec_test_…`) gebaut und getestet — erfüllt SPEC.md-DoD „E2E mit Stripe-Testmodus" (Abschnitt 8) ohne echte Buchungen während der Entwicklung. Umschaltung auf die bereits vorhandenen Live-Keys (`pk_live_…` + zugehöriger `sk_live_…`) ausschließlich beim Produktions-Deploy, nach ausdrücklicher Freigabe von Josip (CLAUDE.md §4.6: „Nichts deployen ohne Freigabe").

**STRIPE_SECRET_KEY (Testmodus) eingetragen (11.07.2026 abends):** Josip hat den Test-Secret-Key im Chat geteilt — nicht in Memory gespeichert, direkt in `.env` geschrieben (Python Read-Modify-Write statt Edit-Tool, siehe unten). Dabei einen bereits bestehenden Bug in `.env` gefunden und behoben: die Datei war am Ende abgeschnitten (`...STRIPE_SECRET_KEY=\nSTRIPE_W` statt vollständigem Inhalt — bekanntes Edit-Tool-Problem, siehe Vault-Memory „Vault-Dateibearbeitung"). Jetzt vollständig: `STRIPE_WEBHOOK_SECRET=` und `RESEND_API_KEY=` als leere Zeilen ergänzt.

**Noch offen vor Block-5-Test:** STRIPE_WEBHOOK_SECRET (erst möglich, sobald der Webhook-Endpoint angelegt ist — Dashboard oder `stripe listen` lokal) und RESEND_API_KEY (für Block 1). Live-Publishable-Key (`pk_live_…`) wird laut Plan gar nicht in `.env` benötigt (Hosted Checkout ohne Client-Key) — Live-Secret-Key kommt erst beim Produktions-Deploy in die Workers-Umgebung, nicht in die lokale `.env`. Secret Keys niemals im Chat teilen, direkt in `.env` eintragen.

**Block 1 — E-Mail-Fundament (Resend) + nachgeholte Einladungsmail: erstellt (Cowork, lokal zu prüfen):**
1. `src/lib/email/client.ts` — Resend-SDK-Wrapper (`import "server-only"` an erster Stelle), zentrale Funktion `sendEmail({ to, subject, html, tenant })`. Absender `noreply@calltalent.ai`, Anzeigename `"${tenant.name} <noreply@calltalent.ai>"` falls `tenant` übergeben, sonst `"Calltalent-Akademie <noreply@calltalent.ai>"`. FAIL-SOFT wie gefordert: `RESEND_API_KEY` fehlt oder Resend-API-Fehler → NIE eine Exception, stattdessen `console.error` mit Kontext + `{ success: false, error }`; bei Erfolg `{ success: true, id }`. Auch ein Fehler beim Lesen von `getServerEnv()` selbst wird abgefangen (fail-soft bis ganz nach unten).
2. `src/lib/email/templates.ts` — reine Funktionen (kein I/O): `welcomeInvite`, `submissionGraded`, `certificateIssued`, `orderPaid`, alle über einen gemeinsamen internen `renderLayout()`-Helper (Kopf mit Mandantenname, Akzentfarbe als Rahmen/Überschriftfarbe, Fuß „Diese E-Mail wurde automatisch von {tenantName} versendet"). `accentColor` kommt vom Aufrufer aus `tenant.branding.color_primary` (tatsächlicher Feldname in `src/lib/tenant/types.ts` — nicht `accent_color`), Fallback auf `DEFAULT_BRANDING.color_primary` bzw. bei ungültigem Hex-Wert auf `#171717` (Schutz gegen CSS-Injection über Branding-Felder, gleiches Muster wie `theme-style.tsx` aus Block 2). Eigene `escapeHtml()`-Hilfsfunktion (keine neue Dependency) — jede eingefügte Nutzereingabe (Namen, Kurstitel, Feedback) wird escaped.
3. `src/lib/email/templates.test.ts` — Vitest (Stil wie `schema.test.ts`): jede Vorlage enthält Mandantenname + Pflichtbausteine (Login-Link, Kurs-/Lektionstitel, Status, Produktname); je ein Fall pro Vorlage mit `<script>`/`<img onerror>`-Payload in Name/Feedback/Titel, der escaped statt ausführbar im Output landet; ein Fall für ungültige Akzentfarbe (`javascript:alert(1)`) → Fallback auf Neutralfarbe.

**Geänderte Dateien:**
4. `src/lib/users/import.ts` — `importUsers()`-Signatur geändert von `(tenantId: string, rows)` auf `(tenant: ImportTenant, rows)` (`ImportTenant` = `Pick<PublicTenant, "id" | "name" | "slug" | "branding">`) — beide Aufrufer (`route.ts`, `actions.ts`) hatten den vollen `PublicTenant` aus `requireAdminTenant()` ohnehin schon zur Hand, kein Mehraufwand für sie. Nach dem bestehenden Batch-Loop (Konto-Anlage, unverändert kritischer 30-Sekunden-Pfad) läuft ein zweiter, getrennter `Promise.allSettled()`-Durchlauf NUR für Zeilen mit `status === "created"`, der `welcomeInvite()` befüllt und über `sendEmail()` verschickt — parallel statt seriell, fail-soft (siehe `client.ts`), daher kann ein einzelner langsamer/fehlschlagender Mailversand weder den Import zum Scheitern bringen noch einzelne Zeilen blockieren. Für `status === "linked"` (Nutzer existierte schon) wird bewusst KEINE Mail verschickt. `ImportRowResult` um `emailSent: boolean` ergänzt (alle bestehenden Felder unverändert). Login-URL folgt dem in `src/lib/tenant/resolve.ts` dokumentierten Schema (`{slug}.localhost:3000` dev / `{slug}.akademie.calltalent.ai` prod, unterschieden über `NODE_ENV`).
5. `src/app/api/admin/users/import/route.ts`, `src/lib/users/actions.ts` — Aufrufe auf `importUsers(tenant, …)` statt `importUsers(tenant.id, …)` angepasst (Signaturänderung aus Punkt 4).
6. `src/components/admin/csv-import-form.tsx`, `src/components/admin/invite-user-form.tsx` — Hinweistexte aktualisiert (waren durch den P1-Bugfix veraltet: „noch keine Einladungs-Mail … folgt in Phase 2" → jetzt korrekt beschrieben, dass Willkommensmails verschickt werden).
7. `package.json` — Dependency `"resend": "^4"` ergänzt (gleiches Versionsmuster wie `"tus-js-client": "^4"`, `"sanitize-html": "^2"`). KEIN `npm install` ausgeführt (Sandbox-Einschränkung).

**Bewusste Vereinfachungen:**
- E-Mail-Versand läuft nach dem Konto-Anlage-Batch, nicht parallel dazu vermischt — fügt bei vielen Zeilen einen zusätzlichen (aber parallelen, nicht pro-Zeile-seriellen) Wartezyklus hinzu. Bei typischen Resend-Latenzen (deutlich unter 1 s) sollte das die 30-Sekunden-DoD nicht gefährden; falls doch, wäre der nächste Schritt ein echtes Fire-and-forget ohne Warten auf `emailSent` (dann müsste `emailSent` nachträglich z. B. per Webhook/Log statt direkt in der Response gesetzt werden).
- Absender-Anzeigename wird nicht auf Header-Injection-taugliche Zeichen geprüft (Mandantenname ist Admin-/Betreiber-kontrollierte Eingabe, kein Nutzer-Freitext) — bei Bedarf später härten.
- Keine Warteschlange/Retry für fehlgeschlagene Mails (z. B. bei Resend-Ausfall) — `emailSent: false` ist sichtbar in `ImportSummary`, aber es gibt noch keinen manuellen „Mail erneut senden"-Weg. Für Phase 2 als ausreichend bewertet, da Login weiterhin über „Passwort vergessen"/Magic Link funktioniert, auch ohne Willkommensmail.

**Block 1 lokal verifiziert (Josip, 11.07.2026 abends):**
1. `npm install` erfolgreich — 13 neue Pakete (`resend` + Abhängigkeiten), Schwachstellen unverändert bei 4 (3 moderate, 1 high) — keine neuen Vulnerabilities durch `resend`.
2. `npm run test`: 27/27 Tests grün (5 Testdateien), darunter `src/lib/email/templates.test.ts` mit allen 10 neuen Fällen.

**Noch offen:**
3. `RESEND_API_KEY` in `.env` eintragen, bevor ein echter Mailversand getestet werden kann (Feld existiert bereits leer, siehe frühere Phase-2-Einträge oben).
4. Manueller Test: Einzel-Einladung und CSV-Import gegen einen Demo-Mandanten (`demo-blau`/`demo-gruen`) auslösen, prüfen ob Willkommensmail ankommt und Login-Link funktioniert (Domainschema `{slug}.localhost:3000` in Dev) — erst nach Punkt 3 sinnvoll möglich.
5. Git-Commit von Block 1 (`feat: Block 1 - E-Mail-Fundament (Resend) und nachgeholte Einladungsmail`).
6. Übergabe an `tester`-Agent für Playwright-Lauf gemäß CLAUDE.md §4.3 (Vitest bereits grün, s. o.).

**Wichtiger Cowork-Sandbox-Befund (unabhängig vom eigentlichen Block, 11.07.2026):** Beim Versuch, diese Änderung wie vorgeschrieben per Python-Read-Modify-Write über Bash zu machen, zeigte sich, dass der Bash-Mount für `PHASENSTATUS.md` UND `package.json` einen veralteten, abgeschnittenen Stand liefert (`wc -l` meldete 192 statt der tatsächlichen 211 Zeilen, Abbruch mitten im Satz) — und zwar unabhängig von den Änderungen dieses Blocks: Der Bash-Mount zeigte diesen falschen Stand bereits bei der allerersten Orientierungs-Leseoperation dieses Auftrags. Das native Read/Edit/Write-Werkzeug (reale Windows-Dateisystem-Ebene) las in jedem Fall vollständigen, korrekten Inhalt. Deutet darauf hin, dass das bisher dokumentierte „Edit-Tool schneidet Dateienden ab"-Phänomen (siehe Vault-Memory) zumindest teilweise eine Bash-Mount-Cache-Verzerrung sein könnte, nicht zwingend eine echte Dateikorruption. Empfehlung: Verifikation künftig zusätzlich lokal (PowerShell) statt sich allein auf den Cowork-Bash-Mount zu verlassen, wenn eine Datei dort verdächtig kurz erscheint.

**Block 2 — Quiz/Prüfungen + Versuche: erstellt (Cowork, lokal zu prüfen):**

**Vorabprüfung `0001_init.sql` (wie vorgeschrieben zuerst gelesen):** Spaltennamen entsprechen dem architect-Plan fast wörtlich, keine neue Migration nötig. `quizzes(id, tenant_id, course_id, lesson_id, title, kind, pass_pct, settings)` — `pass_pct` existiert als eigene Spalte (nicht in `settings`), `attempts_allowed`/`time_limit_s`/`shuffle` liegen laut Spaltenkommentar in `settings jsonb`. `questions(id, tenant_id, quiz_id, position, kind, prompt, options, answer, points)`. `attempts(id, tenant_id, quiz_id, user_id, started_at, submitted_at, answers, score_pct, passed)` — **keine** `UPDATE`-RLS-Policy auf `attempts` (weder eigene noch Staff), nur `attempts_own_select`, `attempts_own_insert` (`user_id = auth.uid() and member_role(tenant_id) is not null`), `attempts_staff_select`. `questions` hat ausschließlich `questions_staff_all` — Lernende dürfen über RLS nichts direkt lesen (bestätigt, kein Fund nötig). Daraus folgt Design-Entscheidung siehe unten (Punkt „startAttempt schreibt nichts").

1. `src/lib/quiz/schema.ts` — zod-Schemas: `quizFormSchema` (Metadaten-Formular inkl. leer=unbegrenzt-Handling für Versuche/Zeitlimit), `questionInputSchema` (discriminatedUnion `single|multi|gap|open` + `superRefine` für Cross-Feld-Prüfung „richtige Antwort muss eine Option sein"), `questionRecordSchema` (dieselbe Union + `id`, für DB-Zeilen inkl. Lösung — nur serverseitig verwendet), `attemptAnswersSchema`, `createEmptyQuestionDraft()`.
2. `src/lib/quiz/grade.ts` — reine Funktion `gradeAttempt(questions, answers, passPct)`. `passPct` als drittes Argument ergänzt (im Plan-Signatur-Text fehlte es, aber `passed = scorePct >= passPct` ist ohne diesen Wert nicht berechenbar — Bestehensgrenze liegt auf `quizzes.pass_pct`, nicht auf einzelnen Fragen).
3. `src/lib/quiz/grade.test.ts` — 13 Vitest-Fälle: alles richtig/falsch, `multi` Alles-oder-nichts (dokumentierte Entscheidung, keine Teilpunkte), `gap` exakt (Groß-/Klein + Leerzeichen-tolerant) und Regex, `open` ausgeschlossen aus Zähler/Nenner, keine Fragen, exakt auf der Bestehensgrenze, fehlende Antwort.
4. `src/lib/quiz/actions.ts` (`"use server"`) — Staff: `createQuiz`, `updateQuiz`, `deleteQuiz`, `upsertQuestion`, `deleteQuestion`, `moveQuestion` (alle mit `requireStaffTenant()` + `.eq("tenant_id", …)`-Defense-in-Depth). Lernende: `startAttempt` (reine Prüfung, siehe unten), `submitAttempt` (sicherheitskritisch, siehe unten).
5. `src/lib/quiz/load.ts` (`import "server-only"`) — `loadQuizForLearner(quizId)`: Mitgliedschaft/Quiz-Metadaten über Nutzer-Client (RLS `quizzes_member_select`), Fragen über Admin-Client mit strikter Spaltenliste (`id, kind, prompt, options, points` — **`answer` wird nie selektiert**, nicht nur im Rückgabewert weggelassen). Gibt bei fehlender Mitgliedschaft und bei Nichtexistenz absichtlich dieselbe Fehlermeldung zurück (kein Existenz-Leak).
6. `src/app/(admin)/admin/kurse/[id]/quiz/[quizId]/page.tsx` — Quiz-Editor-Seite, erbt Staff-Gate aus `admin/layout.tsx`; liest Fragen inkl. Lösung ganz normal über den Nutzer-Client (RLS `questions_staff_all` erlaubt Staff vollen Zugriff, kein Admin-Client nötig).
7. `src/components/admin/quiz-editor.tsx` — Metadaten-Formular (`useActionState` + `updateQuiz`) + Fragenliste mit Anlegen/Bearbeiten/Löschen/Auf-Ab (kein Drag & Drop, Konsistenz mit Phase 1). Fragenliste bewusst nicht in lokalem State dupliziert — `router.refresh()` nach jeder Mutation holt die aktualisierte Prop von der Server Component.
8. `src/components/admin/question-form.tsx` — dynamisches Formular je Fragetyp (analog `block-form.tsx`), JSON-Objekt statt FormData (Optionen/Antwortstruktur zu verschieden pro Typ).
9. `src/components/learn/quiz-runner.tsx` — Client-Komponente, Phasen `intro → running → result`. Barrierefreiheit: echte `<label htmlFor>`-Zuordnungen bei allen Radio-/Checkbox-/Text-Feldern, `<fieldset>/<legend>` je Frage, Ergebnis-Region mit `role="status" aria-live="polite"`. Zeigt bewusst KEINE Pro-Frage-Korrektheit (nur Gesamt-Score/bestanden) — verhindert, dass Lernende über mehrere Versuche hinweg Lösungen erraten/rekonstruieren können.

**Geänderte Dateien:**
10. `src/lib/courses/schema.ts` — **keine Änderung nötig.** Der `quizBlockSchema` hatte bereits `quizId: z.string().uuid().nullable()` + `title` (aus Block 3/Phase 1, dort schon als Platzhalter-Feld angelegt) — Punkt 9 des Plans war damit schon erfüllt.
11. `src/components/editor/block-form.tsx` — Quiz-Block-Fall ersetzt: `<select>` mit den Quizzen des Kurses (Prop `courseQuizzes`, von der Editor-Seite geladen) + „Neues Quiz anlegen"-Button (ruft `createQuiz()` direkt, setzt `block.quizId`) + Link „Fragen bearbeiten →" zur neuen Editor-Seite, sobald ein Quiz verknüpft ist.
12. `src/components/editor/block-editor.tsx`, `src/app/(admin)/admin/kurse/[id]/page.tsx` — reichen `courseQuizzes` (neue Query: `quizzes` gefiltert auf `course_id`) bis zu `BlockForm` durch.
13. `src/components/learn/block-renderer.tsx` — `BlockView` ist jetzt eine **async Server Component**; `quiz`-Fall lädt bei gesetzter `quizId` über `loadQuizForLearner()` und rendert `<QuizRunner quiz={…} />` mit den bereits serverseitig geladenen, whitelisted Daten als Props (statt nur `quizId` durchzureichen — folgt damit dem im Projekt etablierten „Server lädt, Client rendert"-Muster noch konsequenter). Ohne `quizId`: „Kein Quiz verknüpft."; bei Ladefehler: „Quiz aktuell nicht verfügbar."
14. `messages/de.json` — neuer `quiz`-Namensraum mit Labels/Buttons/Meldungen ergänzt (erfüllt den Plan-Punkt wörtlich). **Bewusste, dokumentierte Abweichung:** wie im gesamten übrigen Code (keine einzige bestehende Komponente in Block 1–6/Phase-2-Block-1 nutzt `useTranslations`/`getTranslations`, trotz next-intl-Setup) werden die neuen Quiz-Komponenten NICHT auf next-intl umgestellt, sondern nutzen weiterhin inline-Deutsch wie `csv-import-form.tsx`, `invite-user-form.tsx` etc. — Konsistenz mit dem tatsächlichen Codebase-Zustand hatte Vorrang vor CLAUDE.md §3.5 als Erstumsetzer dieses Musters. `de.json` dient als vorbereitete Textquelle für eine spätere echte i18n-Umstellung (Phase 4?).

**Sicherheitskritischer Datenfluss (submitAttempt) exakt wie gefordert umgesetzt:** Mandant/Mitgliedschaft nur aus Server-Kontext, Versuchslimit serverseitig neu gezählt (nicht dem `startAttempt`-Ergebnis vertraut), Rate Limiting (`checkRateLimit`, 15/60s `submitAttempt`, 20/60s `startAttempt`, je Nutzer-ID), Fragen inkl. Lösung ausschließlich über einen NICHT exportierten Lade-Pfad innerhalb von `submitAttempt` selbst (Admin-Client), `gradeAttempt()` rein serverseitig, EINE vollständige `attempts`-Zeile über den Admin-Client geschrieben.

**Bewusste Vereinfachungen/Abweichungen (wie mit Josip/architect abgestimmt):**
- **SPEC-Abweichung:** Fragetyp `open` wird in Phase 2 NICHT automatisch bewertet — fließt weder in Zähler noch Nenner von `scorePct` ein. Begründung: freie Textbewertung überschneidet sich mit dem kommenden Abgaben-Flow (Block 3), bei Bedarf später über dessen Bewertungspfad nachrüstbar.
- **Kein serverseitiges Zeitlimit-Enforcement in v1** — `settings.time_limit_s` wird im `QuizRunner` nur als Countdown angezeigt (informativ, `aria-live`), Abschicken bleibt nach Ablauf möglich. Bewusste Vereinfachung, kein Blocker.
- **`startAttempt` schreibt keine DB-Zeile** (nur Zähl-Prüfung) — dadurch entsteht laut Plan „EINE vollständige attempts-Zeile" ausschließlich beim Abschluss in `submitAttempt`. Alternative (Zeile schon bei Start anlegen, bei Submit per UPDATE vervollständigen) hätte eine neue Migration für eine `attempts`-UPDATE-RLS-Policy erfordert — laut eigener Rolle „Ausnahme, nicht Regel", daher vermieden; `started_at`/`submitted_at` werden beide beim Submit auf denselben Zeitstempel gesetzt (keine echte Bearbeitungsdauer-Messung in v1).
- `multi`-Fragen: Alles-oder-nichts-Bewertung (keine Teilpunkte) — einfachste eindeutige Regel, in `grade.ts`/Tests dokumentiert.
- Fragenreihenfolge-Mischen (`settings.shuffle`) ist rein clientseitig/kosmetisch (einmal pro `QuizRunner`-Lauf gewürfelt) — ändert nichts an der serverseitigen Bewertung, die über `questionId` läuft, nicht über Position.
- Löschen eines Quiz, das noch von einem Lektionsblock referenziert wird, räumt den Block nicht automatisch auf (`blocks`-jsonb wird nicht durchsucht) — der Block zeigt danach graceful „Quiz aktuell nicht verfügbar." Staff müsste die Verknüpfung im Editor manuell entfernen. Nicht sicherheitsrelevant, nur UX-Schönheitsfehler.

**Block 2 lokal verifiziert (Josip, 11.07.2026 abends):** `npm run test`: 40/40 Tests grün (6 Testdateien), darunter `src/lib/quiz/grade.test.ts` mit allen 13 neuen Fällen.

**Manueller E2E-Test erfolgreich (Josip, 11.07.2026 nachts):** Build-Fehler in `block-form.tsx` (Zeile 188, fehlerhafte Anführungszeichen-Mischung ASCII/typografisch in JSX-Attribut, siehe Bugfix unten) behoben, danach Quiz-Block in „Lektion 2" von Test-Kurs angelegt, Metadaten gesetzt (Bestehensgrenze 70%, 3 Versuche, Zeitlimit 61 s, Mischen an), eine `multi`-Frage angelegt. Als Lernender (eigener `owner`-Login, kein separater Testaccount nötig) absolviert: Ergebnis „Bestanden — 100%", Versuchszählung korrekt („2 von 3 verbleibend" nach 1 Versuch). Kernmechanik E2E bestätigt; Randfälle (exakte Bestehensgrenze, `open`-Ausschluss, Versuchslimit-Erschöpfung) bereits über die 13 `grade.test.ts`-Fälle automatisiert abgedeckt.

**Bugfix (Josip/Claude, 11.07.2026 nachts, vor dem obigen Test gefunden):** `src/components/editor/block-form.tsx` Zeile 188 — Platzhaltertext mischte eine typografische deutsche Anführung „ (U+201E, korrekt) mit einer geraden ASCII-Anführung (") statt der schließenden typografischen " (U+201C) — dadurch endete die JSX-Attribut-String-Literal vorzeitig, Next.js-Build-Fehler „Expected '</', got ')'" in `block-form.tsx`, `block-editor.tsx`, `admin/kurse/[id]/page.tsx` (Import-Kette). Fix: schließende Anführung auf U+201C korrigiert. Betraf nur diesen einen Platzhaltertext, keine weiteren Vorkommen gefunden.

**Git-Commit erledigt (Josip, 11.07.2026 nachts):** `2d11938 "feat: Block 2 - Quiz/Pruefungen und Versuche"` — 26 Dateien, 2780 Zeilen (+), 37 (−). Enthält auch die bis dahin ungetrackten Block-1-Dateien (E-Mail-Fundament), da Block 1 zuvor noch nicht separat committet worden war — keine inhaltliche Vermischung, nur ein gemeinsamer Commit statt zwei.

**Noch offen:** Übergabe an `tester`-Agent für Playwright-E2E (Quiz anlegen → Lernender absolviert → Ergebnis) — optional, da manueller Test bereits erfolgreich war.

**Block 3 — Abgaben-Inbox + Bewertung: erstellt (Cowork, lokal zu prüfen):**

**Vorabprüfung `0001_init.sql` + Storage-Migrationen (wie vorgeschrieben zuerst gelesen):** `submissions(id, tenant_id, lesson_id, user_id, kind, content, file_path, status, grade, feedback, reviewed_by, reviewed_at, created_at)` — `kind` per Check-Constraint `'text'|'file'|'video'|'audio'` (vier Werte, nicht nur zwei wie im Plan-Wortlaut angedeutet), `status` per Check-Constraint exakt `'submitted'|'approved'|'revision'|'rejected'`, `grade` ist **`text`, nicht numerisch** (Plan-Wortlaut sagte „numerisch falls vorhanden" — Abweichung dokumentiert, Formular nutzt Freitext). RLS (Zeilen 516–522): `submissions_own_select` (`user_id = auth.uid()`), `submissions_own_insert` (`user_id = auth.uid() and member_role(tenant_id) is not null` — **kein** `submissions_own_update`, Lernende können eigene Abgaben also nicht nachträglich ändern), `submissions_staff_all` (`is_staff(tenant_id)`, deckt Lesen+Bewerten). Storage (Migration `20260710233735_...`): Bucket `submissions` bereits privat angelegt, Policies `submissions_own_all` (Pfad `{tenant_id}/{user_id}/...`, volle Rechte für `(storage.foldername(name))[2] = auth.uid()::text`) und `submissions_staff_read` (`is_staff` auf `(storage.foldername(name))[1]`, NUR select — kein Staff-Schreibzugriff, war so beabsichtigt). **Ergebnis: keine neue Migration nötig** — alle benötigten Spalten/Policies existierten bereits exakt passend zum Plan (die einzige Ausnahme im architect-Plan trat nicht ein).

1. `src/lib/submissions/schema.ts` — zod-Schemas: `createSubmissionSchema` (discriminatedUnion `text|file`, nimmt bewusst nur `lessonId` entgegen, siehe Abweichung unten), `gradeSubmissionSchema` (`status: approved|revision|rejected`, `grade`/`feedback` optional Freitext mit Preprocessing „leer → undefined"), `uploadUrlRequestSchema` + `ALLOWED_SUBMISSION_MIME_TYPES` (PDF, DOCX, DOC, PNG, JPEG, ZIP, MP4, MP3/M4A) + `MAX_SUBMISSION_FILE_SIZE_BYTES` (50 MB) — von Route und Client-Komponente gemeinsam genutzt.
2. `src/lib/submissions/state.ts` — `GradeSubmissionActionState`/`initialGradeSubmissionActionState` (analog `quiz/state.ts`: `"use server"`-Dateien dürfen in Next 16 nur async Funktionen exportieren).
3. `src/lib/submissions/actions.ts` (`"use server"`) — `createSubmission(input: unknown)`: Nutzer-Client, `auth.getUser()`, Rate-Limit (`submission-create`, 20/h/Nutzer), zod-Validierung, `tenant_id` NICHT vom Client übernommen sondern über die per RLS gefilterte `lessons`-Zeile nachgeschlagen (gleiches Muster wie `quizRow.tenant_id` in `submitAttempt`), zusätzliche Pfad-Prüfung (`file_path` muss unter `{tenant_id}/{user_id}/` liegen) vor dem Insert. `gradeSubmission(submissionId, prevState, formData)`: **FormData-basierte Signatur statt `input: unknown`** (Abweichung vom Plan-Wortlaut, siehe unten) für `requireStaffTenant()` + `.eq("tenant_id", …)`-Defense-in-Depth, Update inkl. `reviewed_by: user.id`, `reviewed_at`, lädt danach Lernenden-Profil + Kurs-/Lektionstitel (drei einfache Folgeabfragen `lessons → modules → courses`, da `submissions` keine `course_id` hat) und ruft die bestehende `submissionGraded()`-Vorlage über `sendEmail()` auf — FAIL-SOFT (Mailfehler nur geloggt, siehe `email/client.ts`-Vertrag, nicht neu erfunden). `getSubmissionDownloadUrl(submissionId)`: Staff, `createSignedUrl()` (5 Min. TTL) über den Nutzer-Client (RLS `submissions_staff_read` reicht, kein Admin-Client nötig).
4. `src/app/api/submissions/upload-url/route.ts` — POST: `getTenant()` (Host-Auflösung) + Nutzer-Client + `auth.getUser()`-Gate (kein Staff-Gate — jedes Mandantenmitglied darf hochladen), Rate-Limit (`submission-upload-url`, 20/h/Nutzer), Mitgliedschaftsprüfung über die bestehende RPC `member_role` (wie in `staff.ts`, nur ohne Rollen-Einschränkung), zod-Body, Typ-/Größen-Whitelist, Pfad `{tenant_id}/{user_id}/{uuid}-{sanitizedFileName}` ausschließlich aus Server-Kontext, `createSignedUploadUrl()` gegen den privaten Bucket `submissions`.
5. `src/app/(admin)/admin/abgaben/page.tsx` — Server Component, erbt Staff-Gate aus `admin/layout.tsx`, lädt `submissions` gefiltert auf `tenant_id` (+ optional `?status=`) mit PostgREST-Nested-Select auf `lessons(title, module_id)` und `profiles(email, full_name)`; Kurstitel separat über `modules`/`courses` nachgeladen (keine `course_id` auf `submissions`, siehe oben).
6. `src/components/admin/submission-inbox.tsx` — Liste mit Status-Filter-Leiste (`?status=`, `aria-current="page"`) und Klick-zum-Öffnen (`aria-expanded`) je Zeile, öffnet `GradeForm` inline.
7. `src/components/admin/grade-form.tsx` — `useActionState` + `gradeSubmission.bind(null, submissionId)` (exaktes Muster wie `quiz-editor.tsx`/`updateQuiz`), Status-Radiobuttons (nur die drei bewertbaren Zustände), Note-/Feedback-Freitextfelder, bei `kind === "file"` ein Button, der `getSubmissionDownloadUrl()` aufruft und die zurückgegebene 5-Minuten-URL in einem neuen Tab öffnet (kein direkter Link auf den privaten Bucket).
8. `src/components/learn/submission-form.tsx` — Client-Komponente: Text/Datei-Umschalter (`role="group"`, `aria-pressed`), Text-Modus mit Zeichenzähler (`aria-describedby`) und `maxLength`, Datei-Modus mit clientseitiger Typ-/Größen-Prüfung vor dem Upload; ruft `/api/submissions/upload-url`, lädt danach direkt über `supabase.storage.from("submissions").uploadToSignedUrl(path, token, file)` hoch (Methode existiert bereits in `@supabase/supabase-js`, kein TUS/zusätzliches SDK nötig — dafür ein neuer, bewusst schlanker Browser-Client `src/lib/supabase/browser.ts` ohne Cookie-/Session-Anbindung, da die signierte URL selbst die Berechtigung trägt), ruft anschließend `createSubmission()`. Zeigt danach den Status der letzten eigenen Abgabe (`role="status" aria-live="polite"`) statt erneut das Formular.
9. `src/lib/supabase/browser.ts` (neu, nicht im Plan explizit benannt) — reiner Browser-Client (`@supabase/supabase-js`, Anon-Key) NUR für `uploadToSignedUrl`, kein `import "server-only"` (muss im Client-Bundle landen dürfen).

**Geänderte Dateien:**
10. `src/components/learn/block-renderer.tsx` — Submission-Fall ersetzt den bisherigen „Upload-Funktion folgt in Phase 2"-Platzhalter: lädt als async Server Component die letzte eigene Abgabe zu `lessonId` (`.eq("lesson_id", …).eq("user_id", …).order("created_at", desc).limit(1)`) und rendert `<SubmissionForm>` mit den geladenen Daten als Props (gleiches „Server lädt, Client rendert"-Muster wie beim Quiz-Fall aus Block 2). `BlockRenderer`/`BlockView`-Signatur um `lessonId: string` erweitert (Breaking Change für den einzigen Aufrufer, siehe Punkt 11).
11. `src/app/(learn)/kurs/[slug]/l/[lessonId]/page.tsx` — `<BlockRenderer blocks={blocks} lessonId={lessonId} />` (Prop ergänzt, Punkt 10).
12. `src/app/(admin)/admin/layout.tsx` — Nav-Eintrag „Abgaben" zwischen „Kurse" und „Nutzer" ergänzt (Link zu `/admin/abgaben`).
13. `messages/de.json` — neuer `submissions`-Namensraum ergänzt (gleiche dokumentierte Abweichung wie beim `quiz`-Namensraum aus Block 2: Code nutzt weiterhin inline-Deutsch statt `useTranslations`, `de.json` dient als vorbereitete Textquelle für eine spätere i18n-Umstellung).

**Abweichungen vom Plan-Wortlaut (dokumentiert wie in Regel 1 gefordert):**
- **`gradeSubmission`-Signatur:** Plan-Text sagte `gradeSubmission(submissionId: string, input: unknown)`, umgesetzt wurde `gradeSubmission(submissionId, prevState, formData)` — der Plan verlangte im selben Absatz explizit „`useActionState` + `gradeSubmission`, Muster wie `quiz-editor.tsx`", und `quiz-editor.tsx`s `updateQuiz` nutzt genau diese `(…, prevState, formData)`-Form für `useActionState`. Beide Vorgaben waren nicht gleichzeitig wörtlich erfüllbar; das explizit genannte `quiz-editor.tsx`-Formular-Muster (native `<form>`, Barrierefreiheit, Konsistenz mit bestehendem Code) hatte Vorrang vor der literalen Parameterliste.
- **`grade`-Feld:** DB-Spalte ist `text`, nicht numerisch (siehe Vorabprüfung oben) — Formular bietet ein kurzes Freitextfeld (max. 50 Zeichen) statt einer Zahleneingabe.
- **`createSubmissionSchema` ohne `blockId`:** `submissions` hat keine `block_id`-Spalte, nur `lesson_id` — mehrere Abgabe-Blöcke in derselben Lektion teilen sich dadurch dieselbe Abgaben-Historie/den „letzte eigene Abgabe"-Status in `block-renderer.tsx`. In der Praxis unkritisch (eine Lektion hat i. d. R. höchstens einen Abgabe-Block), aber nicht technisch verhindert.
- **`kind`-Werte:** DB erlaubt `text|file|video|audio`, die Lernenden-UI (`submission-form.tsx`) bietet bewusst nur `text|file` an — Video-/Audio-Abgaben laufen wie normale Datei-Uploads über den `file`-Pfad (kein Bunny-Weg, keine Streaming-Wiedergabe für Lernenden-Abgaben in v1), wie im Auftrag als „bewusste Vereinfachung" vorgegeben.
- **Kein Wiedereinreichen nach `revision`/`rejected`:** `SubmissionForm` zeigt nach der ersten Abgabe dauerhaft nur noch den Status an (kein Zurück-zum-Formular-Button), unabhängig vom Bewertungsstatus — SPEC/Plan spezifizieren anders als beim Quiz (`attemptsAllowed`) keinen Mehrfach-Versuch-Flow für Abgaben. Einfachste Lösung gewählt (CLAUDE.md §4.5); bei Bedarf später nachrüstbar (RLS erlaubt ohnehin nur `INSERT`, kein `UPDATE` eigener Zeilen — eine neue Abgabe wäre eine zusätzliche `submissions`-Zeile, `block-renderer.tsx` müsste dann nur `limit(1)` durch eine Historie ersetzen).

**Rate Limiting (wie gefordert) auf allen drei genannten Pfaden plus einem zusätzlichen:** `submission-create` (20/h/Nutzer), `submission-upload-url` (20/h/Nutzer), `submission-grade` (60/h/Mandant), zusätzlich `submission-download` (60/h/Mandant, nicht explizit im Plan verlangt, aber konsistent mit dem generellen Rate-Limiting-Prinzip für serverseitig teure/sensible Operationen).

**Block 3 lokal verifiziert (Josip, 11.07.2026 nachts):** `npm run test`: 40/40 Tests weiterhin grün (6 Testdateien, keine Regression durch Block 3 — Block 3 selbst brachte bewusst keine neue Testdatei, da `submissions/schema.ts`/`actions.ts` primär zod-Schemas und Server Actions ohne komplexe reine Bewertungslogik sind, anders als `grade.ts`).

**Manueller E2E-Test erfolgreich (Josip, 11.07.2026 nachts):** Text-/Datei-Abgabe als Lernender eingereicht, als Staff in `/admin/abgaben` bewertet, Mandantentrennung zwischen `demo-blau`/`demo-gruen` bestätigt (nach Nachtrag der fehlenden `demo-gruen`-Mitgliedschaft, siehe oben). Alles wie erwartet funktionsfähig.

**Noch offen:**
1. Git-Commit von Block 3.
2. Übergabe an `tester`-Agent (Vitest/Playwright) gemäß CLAUDE.md §4.3.

## Phase 3 — KI ⬜

## Phase 4 — Skalierung ⬜
