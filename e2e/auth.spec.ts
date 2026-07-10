import { test, expect } from "@playwright/test";

test("Login-Seite zeigt Passwort- und Magic-Link-Formular", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  await expect(page.getByLabel("E-Mail")).toBeVisible();
  await expect(page.getByLabel("Passwort")).toBeVisible();
});
