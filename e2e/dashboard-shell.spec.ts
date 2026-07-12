import { test, expect } from "@playwright/test";
import { tenantUrl } from "./helpers/test-data";

/**
 * Design-Block (12.07.2026, DESIGN-MASTERPROMPT.md): deckt ab, dass die
 * neue AppShell-Sidebar (src/components/learn/app-shell.tsx) auf der
 * Startseite für einen angemeldeten Lernenden rendert — Navigation zeigt
 * nur echte Routen (kein "Lesezeichen", kein Benachrichtigungs-Icon).
 *
 * Rückstellung auf Original-Mockup (12.07.2026): Label-Änderungen
 * "Kurssuche" -> "Kurskatalog", "Profil und Einstellungen" -> "Einstellungen"
 * nachgezogen, siehe app-shell.tsx.
 */
test.use({ storageState: "e2e/.auth/student.json" });

test("Startseite zeigt die neue Sidebar-Navigation (Lernen/Konto)", async ({ page }) => {
  await page.goto(tenantUrl("/"));

  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Meine Kurse" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Kurskatalog" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Einstellungen" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Abmelden" })).toBeVisible();

  // Member-Account: kein Admin-Bereich-Link.
  await expect(nav.getByRole("link", { name: "Admin-Bereich" })).toHaveCount(0);
});
