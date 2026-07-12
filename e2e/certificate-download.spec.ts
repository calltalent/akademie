import fs from "node:fs";
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
 * Phase 4, Block 6 — certificate-download.spec.ts. Setup legt EINEN
 * einlektionigen Kurs an (kürzester Weg zu "vollständig", siehe
 * architect-Plan). Zertifikats-Ausstellung läuft synchron innerhalb von
 * `completeLesson()` (`src/lib/progress/actions.ts` — `await
 * issueCertificateIfEligible(...)` VOR dem Rückgabewert, kein Polling
 * nötig), Download läuft über eine signierte URL (10 Min. gültig).
 */
let admin: SupabaseClient;
let courseSlug: string;
let lessonId: string;

test.beforeAll(async () => {
  admin = createE2eAdminClient();
  const tenantId = await getDemoTenantId(admin);
  const course = await createPublishedCourse(admin, tenantId, "Zertifikat Download");
  const moduleId = await createTestModule(admin, tenantId, course.id);
  lessonId = await createTestLesson(admin, tenantId, moduleId, {
    title: "Einzige Lektion",
    blocks: [textBlock("<p>E2E-Testinhalt für den Zertifikats-Test.</p>")],
  });
  courseSlug = course.slug;
});

test.use({ storageState: "e2e/.auth/student.json" });

test("Student schließt einlektionigen Kurs ab und lädt das Zertifikat herunter", async ({ page }) => {
  await page.goto(tenantUrl(`/kurs/${courseSlug}/l/${lessonId}`));
  await page.getByRole("button", { name: "Lektion abschließen" }).click();
  await expect(page.getByText("✓ Abgeschlossen")).toBeVisible({ timeout: 10000 });

  await page.goto(tenantUrl(`/kurs/${courseSlug}`));
  await expect(page.getByText("Zertifikat ausgestellt 🎓")).toBeVisible({ timeout: 20000 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Zertifikat herunterladen (PDF)" }).click();
  const download = await downloadPromise;

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const stats = fs.statSync(downloadPath!);
  expect(stats.size).toBeGreaterThan(0);
});
