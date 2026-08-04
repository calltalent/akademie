import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createE2eAdminClient, getDemoTenantId, createPublishedCourse, tenantUrl } from "./helpers/test-data";

/**
 * Marketplace Block M2 — Smoke-Test für den Mandanten-Admin-Workflow
 * (Anlegen -> in der Liste sichtbar -> Einreichen -> Status "In Prüfung").
 * Setup legt einen veröffentlichten Testkurs direkt per Service-Role-Client
 * an (gleiches Muster wie quiz-attempt.spec.ts/submission-review.spec.ts) —
 * die eigentliche Prüfhandlung läuft echt über die Admin-UI
 * (`/admin/marketplace`).
 *
 * `/admin/marketplace` wird HIER bewusst über eine direkte URL aufgerufen,
 * NICHT über einen Sidebar-Klick: der Menüpunkt ist nur sichtbar, wenn
 * `tenant.settings.marketplace_enabled === true` ist (AdminSidebar.tsx,
 * bewusst umgekehrte Opt-in-Polarität, siehe PHASENSTATUS.md Block
 * "Marketplace M2"). `demo-blau` hat dieses Flag nicht gesetzt (M3, der
 * Betreiber-Freigabe-Workflow, der dieses Flag setzen würde, existiert noch
 * nicht) — die Seite selbst (`page.tsx`) prüft das Flag NICHT, nur die
 * Sidebar blendet den Link aus. Der direkte URL-Aufruf bleibt deshalb ein
 * gültiger, vollständiger Test des Workflows, ohne `global-setup.ts` um ein
 * weiteres Feature-Flag zu erweitern, das inhaltlich noch gar nicht zum
 * Mandanten-Workflow gehört (M3-Zuständigkeit).
 */
let admin: SupabaseClient;
let courseTitle: string;

test.beforeAll(async () => {
  admin = createE2eAdminClient();
  const tenantId = await getDemoTenantId(admin);
  const course = await createPublishedCourse(admin, tenantId, "Marketplace Listing");
  courseTitle = course.title;
});

test.use({ storageState: "e2e/.auth/staff.json" });

test("Staff legt ein Marketplace-Listing an, sieht es in der Liste und reicht es zur Prüfung ein", async ({
  page,
}) => {
  await page.goto(tenantUrl("/admin/marketplace"));

  // Neues Listing anlegen (rechte Spalte) — Preis-Feld hat bereits den
  // Standardwert "0" (Gratis-Fall), Headline/Beschreibung bleiben leer
  // (beide optional).
  await page.getByLabel("Kurs", { exact: true }).selectOption({ label: courseTitle });
  await page.getByRole("button", { name: "Listing anlegen" }).click();

  await expect(page.getByText("Gespeichert.")).toBeVisible({ timeout: 10000 });

  // Zeile in der Liste (links) — Bearbeiten-Button trägt den Kurstitel im
  // aria-label (headline ist leer, Anzeige fällt auf courseTitle zurück),
  // eindeutiger als ein Text-Locator (Kurstitel steht sonst doppelt in der
  // Zeile: Titel-Zeile UND Kurs-Unterzeile).
  const editButton = page.getByRole("button", { name: `Listing bearbeiten: ${courseTitle}` });
  await expect(editButton).toBeVisible();

  // Status vor dem Einreichen: "Nicht gelistet" (draft).
  await expect(page.getByText("Nicht gelistet")).toBeVisible();

  // Zeile aufklappen und einreichen.
  await editButton.click();
  await page.getByRole("button", { name: "Zur Prüfung einreichen" }).click();

  await expect(page.getByText("In Prüfung")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Nicht gelistet")).not.toBeVisible();
});
