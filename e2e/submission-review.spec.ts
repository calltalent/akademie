import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createE2eAdminClient,
  getDemoTenantId,
  createPublishedCourse,
  createTestModule,
  createTestLesson,
  submissionBlock,
  tenantUrl,
} from "./helpers/test-data";

/**
 * Phase 4, Block 6 — submission-review.spec.ts. Setup legt Kurs mit einem
 * Submission-Block direkt an. Student reicht Text über `submission-form.tsx`
 * ein, Staff bewertet in `/admin/abgaben` (`grade-form.tsx`), die
 * Statusänderung wird beim Studenten nach Neuladen sichtbar. Braucht beide
 * Rollen gleichzeitig — dafür zwei eigene Browser-Kontexte statt
 * `test.use({storageState})`.
 */
const LESSON_TITLE = "Abgabe-Lektion";

let admin: SupabaseClient;
let courseTitle: string;
let courseSlug: string;
let lessonId: string;

test.beforeAll(async () => {
  admin = createE2eAdminClient();
  const tenantId = await getDemoTenantId(admin);
  const course = await createPublishedCourse(admin, tenantId, "Abgabe Bewertung");
  courseTitle = course.title;
  courseSlug = course.slug;
  const moduleId = await createTestModule(admin, tenantId, course.id);
  lessonId = await createTestLesson(admin, tenantId, moduleId, {
    title: LESSON_TITLE,
    blocks: [submissionBlock("Bitte reiche einen kurzen Text zur Lektion ein.")],
  });
});

test("Student reicht Text ein, Staff bewertet, Status aktualisiert sich beim Studenten", async ({ browser }) => {
  const studentContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const studentPage = await studentContext.newPage();
  try {
    await studentPage.goto(tenantUrl(`/kurs/${courseSlug}/l/${lessonId}`));
    await expect(studentPage.getByRole("group", { name: "Art der Abgabe" })).toBeVisible();
    await studentPage.getByLabel("Dein Text").fill("Meine E2E-Testabgabe.");
    await studentPage.getByRole("button", { name: "Abgabe einreichen" }).click();
    // FIX (05.08.2026): submission-form.tsx rendert den Status als
    // role="status"-Badge mit dem reinen Label ("Eingereicht"), kein
    // "Status: "-Präfix mehr als Text. `getByRole("status", {name})` schlug
    // trotz sichtbarem Badge fehl (role="status" berechnet den Accessible
    // Name laut ARIA-accname-Spezifikation NICHT aus dem Text-Inhalt) —
    // reiner Text-Match statt Rollen-Name-Match. `exact: true` grenzt vom
    // benachbarten "Eingereicht am …"-Textknoten ab.
    await expect(studentPage.getByText("Eingereicht", { exact: true })).toBeVisible({ timeout: 10000 });
  } finally {
    await studentContext.close();
  }

  const staffContext = await browser.newContext({ storageState: "e2e/.auth/staff.json" });
  const staffPage = await staffContext.newPage();
  try {
    await staffPage.goto(tenantUrl("/admin/abgaben"));
    const rowButton = staffPage
      .getByRole("button")
      .filter({ hasText: courseTitle })
      .filter({ hasText: LESSON_TITLE });
    // FIX (Josips Testlauf, 12.07.2026, 4. Runde): dritter Fall derselben
    // Hydration-Race in dieser Suite (siehe publish-toggle.tsx,
    // complete-lesson-button.tsx). SubmissionInbox (submission-inbox.tsx)
    // ist eine "use client"-Komponente, der Zeilen-Button ist ein reiner
    // `type="button"` mit `onClick={() => setOpenId(...)}` — kein <form>,
    // kein natives Fallback. Ein Klick vor abgeschlossener Hydration ist ein
    // stiller No-Op: `openId` bleibt unverändert, GradeForm rendert nie, und
    // das anschließende `.check()` auf "Angenommen" (weiter unten) retry-t
    // dann OHNE eigenes actionTimeout (keins in playwright.config.ts
    // konfiguriert) bis zum vollen 180s-Test-Timeout — exakt das
    // beobachtete Hängen. Direkte SQL-Prüfung bestätigte zusätzlich: die
    // Abgabe selbst wurde vom Studenten erfolgreich angelegt (Student-Teil
    // dieses Tests schlägt nie fehl), das leere Abfrageergebnis war ein
    // Nebeneffekt des zwischenzeitlich bereits gelaufenen Teardowns, kein
    // Hinweis auf eine fehlende Abgabe. Fix: Hydration abwarten +
    // Zwischenschritt mit kurzem eigenem Timeout, damit ein erneutes
    // Scheitern schnell und klar sichtbar wird statt weitere 180s zu binden.
    //
    // FIX 2 (Josips Testlauf, 12.07.2026, 5. Runde): 10s reichten nicht
    // einmal für das erste "toBeVisible" — Fehler kam schon dort, nicht erst
    // beim Klick. `/admin/abgaben` (page.tsx) ist in diesem Testlauf die
    // erste Anfrage an diese Route (Turbopack-Kaltkompilierung, gleiche
    // Ursache wie das "Modul 1"-Timeout in course-completion.spec.ts, Lauf
    // 1) UND lädt zusätzlich über DREI sequenzielle Supabase-Anfragen
    // (submissions -> modules -> courses, nicht parallelisiert, siehe
    // page.tsx) — beides addiert sich zur Ladezeit. Timeout auf 30s
    // angehoben (gleicher Wert wie beim analogen Kaltkompilierungs-Fix).
    // FIX 3 (Josips Testlauf, 12.07.2026, 6. Runde): auch 30s reichten
    // NICHT (voller Timeout ausgeschöpft) — das spricht gegen die reine
    // Kaltkompilierungs-Theorie aus Fix 2 und für einen echten Render-/
    // Datenfehler. Diagnose-Zweig statt weiterem Raten: bei einem erneuten
    // Fehlschlag unterscheiden, ob (a) die Inbox leer ist ("Keine Abgaben
    // gefunden." sichtbar — Datenproblem, RLS oder tenant_id-Mismatch) oder
    // (b) eine Zeile existiert, aber mit falschem Text (courseTitle fällt in
    // page.tsx auf "Unbekannter Kurs" zurück, falls der lessons/modules/
    // courses-Verkettungs-Lookup ins Leere läuft — Join-Bug statt
    // Ladezeit-Problem). Ergebnis landet direkt im Playwright-Terminal-Log.
    try {
      await expect(rowButton).toBeVisible({ timeout: 30000 });
    } catch (e) {
      const emptyStateVisible = await staffPage
        .getByText("Keine Abgaben gefunden.")
        .isVisible()
        .catch(() => false);
      const allButtonTexts = await staffPage.getByRole("button").allTextContents();
      console.log("[DIAGNOSE submission-review] 'Keine Abgaben gefunden.' sichtbar:", emptyStateVisible);
      console.log("[DIAGNOSE submission-review] Alle Button-Texte auf /admin/abgaben:", JSON.stringify(allButtonTexts));
      console.log("[DIAGNOSE submission-review] Erwarteter Kurstitel:", courseTitle, "| Lektionstitel:", LESSON_TITLE);
      throw e;
    }
    await staffPage.waitForTimeout(1000);
    await rowButton.click();
    await expect(staffPage.getByLabel("Angenommen")).toBeVisible({ timeout: 20000 });

    await staffPage.getByLabel("Angenommen").check();
    await staffPage.getByLabel("Feedback für Lernende (optional)").fill("Gut gemacht (E2E-Test).");
    await staffPage.getByRole("button", { name: "Bewertung speichern" }).click();
    await expect(
      staffPage.getByText("Gespeichert — Lernende(r) wird per Mail benachrichtigt."),
    ).toBeVisible({ timeout: 10000 });
  } finally {
    await staffContext.close();
  }

  const verifyContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const verifyPage = await verifyContext.newPage();
  try {
    await verifyPage.goto(tenantUrl(`/kurs/${courseSlug}/l/${lessonId}`));
    await expect(verifyPage.getByText("Angenommen", { exact: true })).toBeVisible({ timeout: 10000 });
  } finally {
    await verifyContext.close();
  }
});
