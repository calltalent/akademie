import { test, expect } from "@playwright/test";

test("Login-Seite zeigt Passwort- und Magic-Link-Formular", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  // exact: true, da die Seite bewusst zwei E-Mail-Felder hat (Passwort-Login
  // + Magic-Link) — getByLabel matcht sonst per Teilstring auf beide.
  await expect(page.getByLabel("E-Mail", { exact: true })).toBeVisible();
  await expect(page.getByLabel("E-Mail für Magic Link")).toBeVisible();
  // exact: true — sonst matcht getByLabel("Passwort") per Teilstring auch
  // das umgebende <form aria-label="Mit Passwort anmelden">.
  await expect(page.getByLabel("Passwort", { exact: true })).toBeVisible();
});
