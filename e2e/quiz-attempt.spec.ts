import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createE2eAdminClient,
  getDemoTenantId,
  createPublishedCourse,
  createTestModule,
  createTestLesson,
  createTestQuiz,
  createMultiChoiceQuestion,
  quizBlock,
  tenantUrl,
} from "./helpers/test-data";

/**
 * Phase 4, Block 6 — quiz-attempt.spec.ts. Setup legt Kurs+Modul+Quiz+
 * Lektion direkt per Service-Role-Client an (schneller/robuster als der
 * komplette Admin-Editor-Flow, siehe PHASENSTATUS.md Block 6) — EIN
 * `multi`-Fragetyp reicht laut architect-Plan. Die eigentliche Prüfhandlung
 * (QuizRunner: intro → running → result) läuft echt über die
 * Lernenden-UI.
 */
let admin: SupabaseClient;
let courseSlug: string;
let lessonId: string;

test.beforeAll(async () => {
  admin = createE2eAdminClient();
  const tenantId = await getDemoTenantId(admin);
  const course = await createPublishedCourse(admin, tenantId, "Quiz Versuch");
  const moduleId = await createTestModule(admin, tenantId, course.id);
  const quizId = await createTestQuiz(admin, tenantId, course.id, "E2E Quiz");
  await createMultiChoiceQuestion(admin, tenantId, quizId, {
    prompt: "Welche Option ist richtig?",
    correctText: "Richtige Option",
    wrongText: "Falsche Option",
  });
  lessonId = await createTestLesson(admin, tenantId, moduleId, {
    title: "Quiz-Lektion",
    blocks: [quizBlock(quizId, "E2E Quiz")],
  });
  courseSlug = course.slug;
});

test.use({ storageState: "e2e/.auth/student.json" });

test("Student besteht das Quiz mit der richtigen Antwort", async ({ page }) => {
  await page.goto(tenantUrl(`/kurs/${courseSlug}/l/${lessonId}`));

  await page.getByRole("button", { name: "Quiz starten" }).click();
  await page.getByLabel("Richtige Option").check();
  await page.getByRole("button", { name: "Antworten abschicken" }).click();

  // Ergebnistext-Muster laut architect-Plan: "{Bestanden|Nicht bestanden} —
  // {scorePct}%" in role="status"/aria-live="polite" — Großschreibung
  // "Bestanden" (im Gegensatz zu "Nicht bestanden") reicht als eindeutige
  // Unterscheidung.
  await expect(page.getByText(/Bestanden — \d+%/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/^Nicht bestanden/)).not.toBeVisible();
});
