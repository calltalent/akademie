import { test, expect } from "@playwright/test";
import { tenantUrl, e2eSlug } from "./helpers/test-data";

/**
 * Phase 4, Block 6 — course-completion.spec.ts. Deckt SPEC.md §8 DoD 1
 * direkt ab: "Kurs mit Video anlegen und als Lernender abschließen
 * funktioniert E2E" (hier ohne Video — Bunny ist in der lokalen
 * Testumgebung nicht zwingend konfiguriert, ein Text-Block genügt für den
 * Abschluss-Workflow). Staff legt Kurs+Lektion vollständig über die echte
 * Admin-UI an (kein test-data.ts-Kurzweg — dieser Spec IST der UI-Editor-
 * Nachweis), Student schließt sie ab.
 */
test.use({ storageState: "e2e/.auth/staff.json" });

test("Staff legt Kurs+Lektion an, veröffentlicht beides, Student schließt die Lektion ab", async ({
  page,
  browser,
}) => {
  const slug = e2eSlug("kursabschluss");
  const courseTitle = `E2E Kursabschluss ${Date.now()}`;
  const lessonTitle = "Lektion 1";

  // --- Staff: Kurs anlegen ---
  await page.goto(tenantUrl("/admin/kurse"));
  await page.getByLabel("Titel").fill(courseTitle);
  await page.getByLabel(/Slug/).fill(slug);
  await page.getByRole("button", { name: "Kurs anlegen" }).click();

  const courseLink = page.getByRole("link", { name: courseTitle });
  await expect(courseLink).toBeVisible({ timeout: 10000 });
  await courseLink.click();
  await expect(page).toHaveURL(/\/admin\/kurse\//);

  // FIX (Josips Testlauf, 12.07.2026, 2. Runde): der reine Timeout-Puffer
  // (10s -> 30s) reichte NICHT — Call-Log zeigte weiterhin "waiting for
  // navigation to finish" bei vollen 30s. Root Cause: NewModuleForm/
  // NewLessonForm sind React-19-Server-Action-Formulare (`<form
  // action={action}>`, module-lesson-tree.tsx). `.press("Enter")" direkt
  // nach der Navigation kann eine Hydration-Race auslösen — falls React den
  // Action-Listener noch nicht angehängt hat, übernimmt der Browser die
  // native Formular-Einreichung (echter Seiten-Reload statt Client-Aktion),
  // exakt das Navigation-Warten im Fehler-Log. `networkidle` ist hier KEIN
  // zuverlässiger Fix (Turbopack hält eine dauerhafte HMR-WebSocket-
  // Verbindung offen, `networkidle` würde nie erfüllt). Stattdessen: kurz
  // auf abgeschlossene Hydration warten + über den echten Submit-Button
  // (nicht Enter) einreichen, auf das jeweilige Formular gescoped (auf der
  // frischen Kursseite eindeutig).
  await page.waitForTimeout(1000);

  const moduleForm = page.locator("form").filter({ has: page.getByPlaceholder("Neues Modul …") });
  await moduleForm.getByPlaceholder("Neues Modul …").fill("Modul 1");
  await moduleForm.getByRole("button", { name: "+" }).click();
  await expect(page.getByText("Modul 1")).toBeVisible({ timeout: 30000 });

  // --- Staff: Lektion anlegen ---
  await page.waitForTimeout(500);
  const lessonForm = page.locator("form").filter({ has: page.getByPlaceholder("Neue Lektion …") });
  await lessonForm.getByPlaceholder("Neue Lektion …").fill(lessonTitle);
  await lessonForm.getByRole("button", { name: "+" }).click();
  const lessonLink = page.getByRole("link", { name: lessonTitle });
  await expect(lessonLink).toBeVisible({ timeout: 30000 });

  // --- Staff: Lektion öffnen + veröffentlichen ---
  // FIX (Josips Testlauf, 12.07.2026, 3. Runde): CoursePublishToggle/
  // LessonPublishToggle (publish-toggle.tsx) sind KEINE <form>-Elemente,
  // sondern reine `type="button"` mit `onClick` + `useTransition()` — ein
  // Klick VOR abgeschlossener Hydration des frisch (via `?lesson=`-Query,
  // Lektionsliste ist ein natives `<a href>`) nachgeladenen Bereichs tut
  // dann schlicht NICHTS (kein natives Fallback wie bei <form>, daher hier
  // "element(s) not found" statt der vorherigen "waiting for navigation").
  // Gleicher Fix wie bei der Modul-/Lektion-Anlage: kurz auf Hydration
  // warten, bevor geklickt wird.
  await lessonLink.click();
  await expect(page).toHaveURL(/\?lesson=/);
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Veröffentlichen" }).click();
  await expect(page.getByRole("button", { name: "Auf Entwurf setzen" })).toBeVisible({ timeout: 20000 });

  // --- Staff: Kurs veröffentlichen (Kursliste) ---
  await page.goto(tenantUrl("/admin/kurse"));
  await page.waitForTimeout(1000);
  const courseRow = page.locator("li").filter({ hasText: courseTitle });
  await courseRow.getByRole("button", { name: "Veröffentlichen" }).click();
  await expect(courseRow.getByRole("button", { name: "Auf Entwurf setzen" })).toBeVisible({ timeout: 20000 });

  // --- Student: Kurs finden, Lektion abschließen ---
  const studentContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const studentPage = await studentContext.newPage();
  try {
    await studentPage.goto(tenantUrl("/"));
    await studentPage.getByRole("link", { name: courseTitle }).click();
    await expect(studentPage).toHaveURL(new RegExp(`/kurs/${slug}$`));

    await studentPage.getByRole("link", { name: /Kurs starten|Weiterlernen/ }).click();
    await expect(studentPage).toHaveURL(new RegExp(`/kurs/${slug}/l/`));

    // FIX (Josips Testlauf, 12.07.2026, 4. Runde): gleiche Hydration-Race
    // wie bei den Publish-Buttons — `complete-lesson-button.tsx` ist
    // ebenfalls ein reiner `type="button"` mit `onClick`+`useTransition()`,
    // hier auf einer zuvor noch nie besuchten `/kurs/[slug]/l/[lessonId]`-
    // Instanz.
    await studentPage.waitForTimeout(1000);
    await studentPage.getByRole("button", { name: "Lektion abschließen" }).click();
    await expect(studentPage.getByText("✓ Abgeschlossen")).toBeVisible({ timeout: 20000 });

    await studentPage.goto(tenantUrl(`/kurs/${slug}`));
    await expect(studentPage.getByText(/abgeschlossen/)).toBeVisible();
  } finally {
    await studentContext.close();
  }
});
