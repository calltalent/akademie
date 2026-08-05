import { test, expect } from "@playwright/test";
import { tenantUrl } from "./helpers/test-data";

/**
 * Phase 4, Block 6 — course-completion.spec.ts. Deckt SPEC.md §8 DoD 1
 * direkt ab: "Kurs mit Video anlegen und als Lernender abschließen
 * funktioniert E2E" (hier ohne Video — Bunny ist in der lokalen
 * Testumgebung nicht zwingend konfiguriert, ein Text-Block genügt für den
 * Abschluss-Workflow). Staff legt Kurs+Lektion vollständig über die echte
 * Admin-UI an (kein test-data.ts-Kurzweg — dieser Spec IST der UI-Editor-
 * Nachweis), Student schließt sie ab.
 *
 * VOLLSTÄNDIG NEU GESCHRIEBEN (05.08.2026, gefunden beim ersten E2E-Lauf
 * gegen den wiederhergestellten demo-blau-Mandanten — der Kurs-Editor wurde
 * am 25.07.2026 komplett auf einen 4-Schritte-Assistenten umgebaut
 * (new-course-button.tsx/course-editor-steps.tsx), seither nie wieder
 * gegen die E2E-Suite verifiziert:
 * - "Neuer Kurs" öffnet kein Titel/Slug-Modal mehr, sondern legt SOFORT
 *   einen Entwurf an (`createDraftCourse()`) und navigiert direkt zu
 *   Schritt 1 (Grunddaten). Titel wird dort inline editiert (Label
 *   "Kurstitel", onBlur speichert), der Slug wird SERVERSEITIG aus dem
 *   Titel abgeleitet — kein eigenes Slug-Feld mehr.
 * - Neue Zwischenebene Modul -> Sektion -> Lektion (20260718150000_
 *   sections.sql) — eine Lektion braucht jetzt zusätzlich eine Sektion.
 * - Kurs-Status wird nicht mehr über einen Button in der Kursliste gesetzt,
 *   sondern über ein <select> in Schritt 4 (Veröffentlichung) desselben
 *   Editors.
 * - Lektion abschließen navigiert bei der letzten offenen Lektion eines
 *   Kurses automatisch weiter zu `/kurs/[slug]/m/[moduleId]/abgeschlossen`
 *   (Kurs-Abschluss-Seite mit Zertifikat) statt eines Inline-Häkchens auf
 *   derselben Seite.
 * Live per Browser nachvollzogen (nicht nur Code gelesen) — jeder Schritt
 * unten entspricht einem tatsächlich beobachteten Klick/Ergebnis.
 */
test.use({ storageState: "e2e/.auth/staff.json" });

test("Staff legt Kurs+Lektion an, veröffentlicht beides, Student schließt die Lektion ab", async ({
  page,
  browser,
}) => {
  const courseTitle = `E2E Kursabschluss ${Date.now()}`;
  const lessonTitle = "Lektion 1";

  // --- Staff: Kurs anlegen (sofort als Entwurf, navigiert zu Schritt 1) ---
  await page.goto(tenantUrl("/admin/kurse"));
  await page.getByRole("button", { name: "Neuer Kurs" }).click();
  await expect(page).toHaveURL(/\/admin\/kurse\/[0-9a-f-]+$/, { timeout: 15000 });
  await page.waitForTimeout(1000); // Hydration-Race, siehe Kopfkommentar.

  await page.getByLabel("Kurstitel").fill(courseTitle);
  await page.getByLabel("Kurstitel").blur();
  await expect(page.getByText(/^Lern-URL:/)).toBeVisible({ timeout: 10000 });

  // --- Staff: direkt zu Schritt 3 (Inhalt & Struktur) ---
  await page.getByRole("button", { name: /Weiter zu Informationen/ }).click();
  await page.getByRole("button", { name: /Weiter zu Inhalt & Struktur/ }).click();

  const moduleForm = page.locator("form").filter({ has: page.getByPlaceholder("Neues Modul …") });
  await moduleForm.getByPlaceholder("Neues Modul …").fill("Modul 1");
  await moduleForm.locator('button[type="submit"]').click();
  await expect(page.getByText("Modul 1")).toBeVisible({ timeout: 15000 });

  // --- Staff: Sektion anlegen (neue Zwischenebene seit 18.07.2026) ---
  const sectionForm = page.locator("form").filter({ has: page.getByPlaceholder("Neue Sektion …") });
  await sectionForm.getByPlaceholder("Neue Sektion …").fill("Sektion 1");
  await sectionForm.locator('button[type="submit"]').click();
  await expect(page.getByText("Sektion 1")).toBeVisible({ timeout: 15000 });

  // --- Staff: Lektion anlegen ---
  await page.waitForTimeout(500);
  const lessonForm = page.locator("form").filter({ has: page.getByPlaceholder("Neue Lektion …") });
  await lessonForm.getByPlaceholder("Neue Lektion …").fill(lessonTitle);
  await lessonForm.locator('button[type="submit"]').click();
  const lessonLink = page.getByRole("link", { name: lessonTitle });
  await expect(lessonLink).toBeVisible({ timeout: 15000 });

  // --- Staff: Lektion öffnen + veröffentlichen ---
  await lessonLink.click();
  await expect(page).toHaveURL(/\?lesson=/);
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Veröffentlichen" }).click();
  await expect(page.getByRole("button", { name: "Auf Entwurf setzen" })).toBeVisible({ timeout: 20000 });

  // --- Staff: Kurs veröffentlichen (Schritt 4, <select> statt Button) ---
  await page.getByRole("button", { name: /Weiter zu Veröffentlichung/ }).click();
  await page.getByLabel("Status").selectOption({ label: "Live" });
  await expect(page.getByLabel("Status")).toHaveValue("published");

  // --- Student: Kurs finden, Lektion abschließen ---
  const studentContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const studentPage = await studentContext.newPage();
  try {
    await studentPage.goto(tenantUrl("/"));
    await studentPage.getByRole("link", { name: courseTitle }).click();
    await expect(studentPage).toHaveURL(/\/kurs\/[^/]+$/);

    // Karte zeigt den Einstieg als "Starten" (kein "Kurs starten"/"Weiterlernen"
    // mehr, siehe Kopfkommentar).
    await studentPage.getByRole("link", { name: /Starten/ }).click();
    await expect(studentPage).toHaveURL(/\/kurs\/[^/]+\/l\//);

    await studentPage.waitForTimeout(1000);
    await studentPage.getByRole("button", { name: "Lektion abschließen" }).click();

    // Letzte offene Lektion des Kurses -> automatische Weiterleitung zur
    // Kurs-Abschluss-Seite (inkl. Zertifikat), kein Inline-Häkchen mehr.
    await expect(studentPage).toHaveURL(/\/kurs\/[^/]+\/m\/[^/]+\/abgeschlossen$/, { timeout: 20000 });
    await expect(studentPage.getByText("Kurs abgeschlossen")).toBeVisible();
    await expect(studentPage.getByRole("heading", { name: "Herzlichen Glückwunsch!" })).toBeVisible();
  } finally {
    await studentContext.close();
  }
});
