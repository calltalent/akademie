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

**Nächste Schritte vor Phasenabschluss:**
1. Git-Commit „feat: Block 6 - Nutzerverwaltung und CSV-Import (inkl. Rate-Limit-Fix und Retry)".
2. Tester-Agent: Vitest- und Playwright-Suiten tatsächlich ausführen (bisher nur geschrieben, nie gelaufen: env.test.ts, schema.test.ts, compute.test.ts, csv.test.ts, auth.spec.ts).
3. npm-audit-Vulnerabilities gezielt prüfen (5 moderate, 1 high, 1 critical seit Block 1 offen).
4. security-reviewer-Agent: RLS-Audit über alle Phase-1-Tabellen/Storage-Policies, OWASP-Checkliste, Secret-Scan.

## Phase 2 — Geschäft ⬜

## Phase 3 — KI ⬜

## Phase 4 — Skalierung ⬜
