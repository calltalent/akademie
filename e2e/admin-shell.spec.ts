import { test, expect } from "@playwright/test";
import { tenantUrl } from "./helpers/test-data";

/**
 * Design-Block (12.07.2026, Folgeauftrag "durch das ganze Projekt ziehen"):
 * deckt ab, dass die neue AdminShell-Sidebar (src/components/admin/
 * admin-shell.tsx) für einen Staff-Account rendert — ersetzt die alte
 * 9-Link-Kopfzeile. `staff.json` gehört der Rolle `owner` (global-setup.ts),
 * hat also Zugriff auf jede Admin-Unterseite.
 */
test.use({ storageState: "e2e/.auth/staff.json" });

test("Admin-Bereich zeigt die neue gruppierte Sidebar-Navigation", async ({ page }) => {
  await page.goto(tenantUrl("/admin"));

  const nav = page.getByRole("navigation", { name: "Verwaltungs-Navigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Kurse" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "KI-Generator" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Abgaben" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Reporting" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Zahlungen" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Teilnehmer" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Import" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Einstellungen" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Zur Lernansicht" })).toBeVisible();

  // Dashboard ist die aktuelle Seite -> aria-current="page".
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
});

test("Von der Akademie-Startseite ist der Admin-Bereich für Staff erreichbar", async ({ page }) => {
  await page.goto(tenantUrl("/"));
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await nav.getByRole("link", { name: "Admin-Bereich" }).click();
  await expect(page).toHaveURL(/\/admin$/);
});
