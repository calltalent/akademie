-- Stufe 3 „Untertitel DE + EN" (Plan calm-watching-dewdrop.md, Blocker B1).
-- ai_jobs.kind hat laut 0001_init.sql (Zeile 281) eine CHECK-Constraint, die
-- keinen Übersetzungs-Job-Typ kennt. recordAiJob({kind:"translation"}) für
-- die EN-Untertitel-Übersetzung (ensureEnglishCaption(),
-- src/lib/video/translate-captions.ts) würde ohne diese Erweiterung an der
-- Constraint scheitern — und recordAiJob() ist fail-soft (nur
-- console.error, siehe src/lib/ai/usage.ts): die Kostenzeile würde also
-- lautlos verschwinden (Verstoß gegen CLAUDE.md §3.7, "jeder Claude-Aufruf
-- schreibt ai_jobs ... mit Tokens und Kosten").
--
-- 0001_init.sql wird NICHT editiert (CLAUDE.md §3/§4) — Constraint hier per
-- ALTER erweitert, gleiches Muster wie
-- supabase/migrations/20260711223000_enrollments_source_add_api.sql
-- (drop+add statt Inline-Check anzufassen). `drop constraint IF EXISTS`
-- zusätzlich für Idempotenz beim erneuten Anwenden (Konvention aus
-- supabase/migrations/20260712173920_tenant_domains.sql) — ein zweiter Lauf
-- dieser Datei ist dadurch ein No-Op mit identischem Endzustand statt eines
-- Fehlers.
--
-- Keine Daten betroffen (reine Constraint-Erweiterung, keine bestehende
-- Zeile verletzt sie), keine RLS-Änderung nötig (R11: kein neuer
-- Schreibpfad/keine neue Tabelle).
--
-- NICHT AUSGEFÜHRT (Auftrag): nur die Datei anlegen, `npx supabase db push`
-- bleibt Josip vorbehalten.

alter table public.ai_jobs drop constraint if exists ai_jobs_kind_check;

alter table public.ai_jobs
  add constraint ai_jobs_kind_check
  check (kind in ('course_gen', 'quiz_gen', 'transcript', 'summary', 'embed', 'translation'));
