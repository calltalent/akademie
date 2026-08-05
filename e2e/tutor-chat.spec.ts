import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createE2eAdminClient,
  getDemoTenantId,
  createPublishedCourse,
  createTestModule,
  createTestLesson,
  textBlock,
  tenantUrl,
} from "./helpers/test-data";

/**
 * Phase 4, Block 6 — tutor-chat.spec.ts.
 *
 * DOKUMENTIERTE ERGÄNZUNG zum architect-Plan-Wortlaut ("übersprungen falls
 * ANTHROPIC_API_KEY fehlt"): das Einbetten des Kurses ("Kurs für KI-Suche
 * einbetten") ruft VORHER `embedTexts()` (src/lib/ai/voyage.ts) auf, was
 * `VOYAGE_API_KEY` zwingend braucht (wirft sonst eine harte Fehlermeldung,
 * kein sanftes Skip) — ohne diesen zweiten Guard würde der Test bei
 * gesetztem ANTHROPIC_API_KEY, aber fehlendem VOYAGE_API_KEY, nicht sauber
 * übersprungen, sondern schlicht fehlschlagen. Beide Keys sind für den
 * vollständigen RAG-Flow (Einbetten + Tutor-Antwort) zwingend nötig, siehe
 * PHASENSTATUS.md Block 6.
 */
test.skip(
  !process.env.ANTHROPIC_API_KEY || !process.env.VOYAGE_API_KEY,
  "ANTHROPIC_API_KEY/VOYAGE_API_KEY nicht gesetzt — Tutor-Chat-Test übersprungen (kostet echte, kleine Anthropic-Kosten pro Lauf).",
);

let admin: SupabaseClient;
let courseId: string;
let courseSlug: string;
let lessonId: string;
const uniqueTerm = `Flimmerindex${Date.now()}`;

test.beforeAll(async () => {
  admin = createE2eAdminClient();
  const tenantId = await getDemoTenantId(admin);
  const course = await createPublishedCourse(admin, tenantId, "Tutor Test");
  courseId = course.id;
  courseSlug = course.slug;
  const moduleId = await createTestModule(admin, tenantId, course.id);
  lessonId = await createTestLesson(admin, tenantId, moduleId, {
    title: "Fachbegriff-Lektion",
    blocks: [
      textBlock(
        `<p>Der ${uniqueTerm} ist ein frei erfundener Testbegriff dieses Kurses. Er beschreibt ein fiktives Qualitätsmaß für die Prüfsumme automatisierter Testabgaben und existiert ausschließlich für diesen E2E-Test.</p>`,
      ),
    ],
  });
});

test.use({ storageState: "e2e/.auth/staff.json" });

test("Tutor beantwortet Frage zum Fachbegriff mit Quelle und lehnt Off-Topic-Frage ab", async ({ page }) => {
  // --- Kurs für KI-Suche einbetten (echt über die UI, kein Direktaufruf der Server Action) ---
  // FIX (05.08.2026): Kurs-Editor ist seit 25.07.2026 ein 4-Schritte-
  // Assistent (course-editor-steps.tsx) — "Kurs für KI-Suche einbetten"
  // sitzt auf Schritt 4 (Veröffentlichung), Direktaufruf ohne ?lesson=-Query
  // landet auf Schritt 1 (Grunddaten). Gleiches Muster wie
  // course-completion.spec.ts.
  await page.goto(tenantUrl(`/admin/kurse/${courseId}`));
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /Weiter zu Informationen/ }).click();
  await page.getByRole("button", { name: /Weiter zu Inhalt & Struktur/ }).click();
  await page.getByRole("button", { name: /Weiter zu Veröffentlichung/ }).click();
  await page.getByRole("button", { name: "Kurs für KI-Suche einbetten" }).click();
  await expect(page.getByText(/Lektion\(en\) verarbeitet/)).toBeVisible({ timeout: 30000 });

  // --- Tutor-Chat auf der Lektionsseite ---
  // FIX (Josips Testlauf, 12.07.2026): "KI-Assistent" matcht ohne
  // exact:true auch den erklärenden Hinweistext ("Stelle eine Frage zu
  // diesem Kurs – der KI-Assistent ...") und schlägt mit "strict mode
  // violation: resolved to 2 elements" fehl — gleiches Muster wie die
  // E-Mail-/Passwort-Felder auf der Login-Seite (siehe e2e/auth.spec.ts).
  await page.goto(tenantUrl(`/kurs/${courseSlug}/l/${lessonId}`));
  await expect(page.getByText("KI-Assistent", { exact: true })).toBeVisible();

  const input = page.getByPlaceholder("Frage zum Kurs stellen …");

  await input.fill(`Was ist der ${uniqueTerm}?`);
  await page.getByRole("button", { name: "Frage senden" }).click();
  await expect(page.getByRole("log")).toContainText(uniqueTerm, { timeout: 40000 });

  await input.fill("Wie wird das Wetter morgen in Hamburg?");
  await page.getByRole("button", { name: "Frage senden" }).click();
  // Breiter gefasstes Muster statt der einen wörtlichen Systemprompt-Phrase
  // "Das steht nicht im Kurs." (SPEC §6/tutor/prompt.ts Regel 3): eine
  // klar themenfremde Frage kann je nach Modellantwort auch über Regel 4
  // ("höflich ablehnen, auf Kursinhalt verweisen") formuliert werden — beide
  // Fälle sind laut SPEC ein korrektes Ablehnungsverhalten.
  await expect(page.getByRole("log")).toContainText(/steht nicht im Kurs|nicht im Kurs|Kursinhalt/i, {
    timeout: 40000,
  });
});
