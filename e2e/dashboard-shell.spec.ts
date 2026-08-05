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
 *
 * ZWEITER FIX (05.08.2026, beim ersten funktionierenden E2E-Lauf gegen den
 * wiederhergestellten demo-blau-Mandanten gefunden, siehe PHASENSTATUS.md):
 * "Einstellungen" und "Abmelden" standen früher direkt im Sidebar-<nav>, sind
 * aber laut Kopfkommentar in Sidebar.tsx seit dem KONTO-Umbau (23.07.2026)
 * ins Profilmenü (TopBar.tsx/topbar-menus.tsx, role="menu") gewandert — diese
 * Datei wurde damals nicht nachgezogen. Live per read_page verifiziert:
 * `<aside aria-label="Hauptnavigation">` (Rolle "complementary") enthält nur
 * noch Meine-Kurse/Lesezeichen/Kurskatalog/Hilfe & Kontakt; Einstellungen/
 * Abmelden erscheinen erst nach Öffnen des Profilmenü-Buttons
 * (aria-label "Profilmenü: {name}", messages/de.json profileMenuAriaLabel).
 */
test.use({ storageState: "e2e/.auth/student.json" });

test("Startseite zeigt die neue Sidebar-Navigation (Lernen/Konto)", async ({ page }) => {
  await page.goto(tenantUrl("/"));

  const nav = page.getByRole("complementary", { name: "Hauptnavigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Meine Kurse" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Kurskatalog" })).toBeVisible();

  // Member-Account: kein Admin-Bereich-Link in der Sidebar.
  await expect(nav.getByRole("link", { name: "Admin-Bereich" })).toHaveCount(0);

  // "Einstellungen"/"Abmelden" sitzen im Profilmenü, nicht mehr in der Sidebar.
  // topbar-menus.tsx: ProfileMenu existiert ZWEIMAL im DOM (Desktop-Variante in
  // TopBar.tsx, `compact`-Variante für Mobile in LearnMobileNav.tsx) — bei
  // Desktop-Breite ist nur die Desktop-Variante sichtbar, ihr Name kommt (kein
  // aria-label, siehe `compact ? aria-label : undefined`) aus dem sichtbaren
  // Text "{Name} {Rolle}". Die unsichtbare Mobile-Variante trägt stattdessen
  // aria-label "Profilmenü: {Name}" — `/^Profilmenü:/` matchte nur SIE (nie
  // sichtbar bei Desktop-Breite), click() wartete deshalb bis zum Timeout.
  // "Kursteilnehmer" kommt nur im sichtbaren Text vor, eindeutig.
  await page.getByRole("button", { name: /Kursteilnehmer/ }).click();
  const profileMenu = page.getByRole("menu");
  await expect(profileMenu.getByRole("link", { name: "Einstellungen" })).toBeVisible();
  await expect(profileMenu.getByRole("button", { name: "Abmelden" })).toBeVisible();
});
