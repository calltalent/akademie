import { test, expect } from "@playwright/test";
import { tenantUrl } from "./helpers/test-data";

/**
 * Phase 4, Block 6 — csv-import.spec.ts. Staff importiert eine kleine
 * In-Memory-CSV (2 Zeilen, `@example.test`-Adressen, siehe CLAUDE.md §2.6
 * "keine echten E-Mail-Adressen in Tests/Fixtures") über `/admin/nutzer`
 * (`POST /api/admin/users/import`) — Format `email,full_name,course_slug`
 * (Kopfzeile Pflicht, `course_slug` hier leer/optional).
 */
test.use({ storageState: "e2e/.auth/staff.json" });

test("CSV-Import legt neue Nutzer an und zeigt sie in der Mitgliederliste", async ({ page }) => {
  const ts = Date.now();
  const email1 = `e2e-import-${ts}-1@example.test`;
  const email2 = `e2e-import-${ts}-2@example.test`;
  const csv = `email,full_name,course_slug\n${email1},E2E Import Eins,\n${email2},E2E Import Zwei,\n`;

  await page.goto(tenantUrl("/admin/teilnehmer"));
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });
  await page.getByRole("button", { name: "Import starten" }).click();

  await expect(page.getByText(/2 Zeilen verarbeitet/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/2 Konten neu angelegt/)).toBeVisible();

  await expect(page.getByText(email1)).toBeVisible();
  await expect(page.getByText(email2)).toBeVisible();
});
