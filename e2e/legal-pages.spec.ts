import { test, expect } from "@playwright/test";
import {
  createE2eAdminClient,
  DEMO_TENANT_URL,
  getDemoTenantId,
} from "./helpers/test-data";

/**
 * Rechtsseiten eines Mandanten (24.08.2026, Rechtsträger-Wechsel auf die
 * Calltalent LLC). Prüft die eine Grenze, die hier sicherheitsrelevant ist:
 * die Seiten erscheinen NUR für Mandanten mit hinterlegtem Rechtsträger
 * (`tenants.legal.entity`). Ohne diesen Datensatz stünde sonst auf der
 * Domain eines White-Label-Kunden Calltalents eigenes Impressum.
 *
 * Der Testmandant `demo-blau` hat bewusst keinen Rechtsträger — der
 * Positivfall setzt ihn deshalb selbst (beforeAll) und entfernt ihn danach
 * wieder (afterAll), statt einen zweiten Seed-Mandanten zu verlangen.
 *
 * Lauffähigkeit: dieselbe Einschränkung wie bei den Marketplace-Specs — die
 * gesamte Suite hängt an `global-setup.ts`/`demo-blau` und an einem
 * laufenden Dev-Server, siehe Kopfkommentar in marketplace-public.spec.ts.
 */
const TEST_ENTITY = {
  name: "Calltalent LLC",
  addressLines: ["1309 Coffeen Avenue STE 1200", "Sheridan, WY 82801", "United States"],
  email: "office@calltalent.ai",
  registrationNumber: null,
};

test.describe("Mandanten-Rechtsseiten", () => {
  test("ohne hinterlegten Rechtsträger antworten die Rechtsseiten mit 404", async ({ page }) => {
    const admin = createE2eAdminClient();
    const tenantId = await getDemoTenantId(admin);
    await admin.from("tenants").update({ legal: {} }).eq("id", tenantId);

    for (const path of ["/legal-notice", "/privacy", "/terms"]) {
      const response = await page.goto(`${DEMO_TENANT_URL}${path}`);
      expect(response?.status(), `${path} darf ohne Rechtsträger nicht rendern`).toBe(404);
    }
  });

  test.describe("mit hinterlegtem Rechtsträger", () => {
    test.beforeAll(async () => {
      const admin = createE2eAdminClient();
      const tenantId = await getDemoTenantId(admin);
      await admin.from("tenants").update({ legal: { entity: TEST_ENTITY } }).eq("id", tenantId);
    });

    test.afterAll(async () => {
      const admin = createE2eAdminClient();
      const tenantId = await getDemoTenantId(admin);
      await admin.from("tenants").update({ legal: {} }).eq("id", tenantId);
    });

    test("Impressum, Datenschutz und AGB rendern mit den Firmendaten", async ({ page }) => {
      const notice = await page.goto(`${DEMO_TENANT_URL}/legal-notice`);
      expect(notice?.ok()).toBe(true);
      await expect(page.getByText("Calltalent LLC", { exact: true })).toBeVisible();
      await expect(page.getByText("Sheridan, WY 82801", { exact: true })).toBeVisible();
      // Registernummer fehlt im Datensatz -> der Abschnitt darf gar nicht erst
      // erscheinen (keine erfundene Nummer auf einer Rechtsseite).
      await expect(page.getByText("Filing ID")).toHaveCount(0);

      const privacy = await page.goto(`${DEMO_TENANT_URL}/privacy`);
      expect(privacy?.ok()).toBe(true);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const terms = await page.goto(`${DEMO_TENANT_URL}/terms`);
      expect(terms?.ok()).toBe(true);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });

    test("die deutschen Alias-Pfade leiten auf die kanonischen Seiten weiter", async ({ page }) => {
      for (const [alias, target] of [
        ["/impressum", "/legal-notice"],
        ["/datenschutz", "/privacy"],
        ["/agb", "/terms"],
      ]) {
        await page.goto(`${DEMO_TENANT_URL}${alias}`);
        await expect(page).toHaveURL(new RegExp(`${target}$`));
      }
    });
  });
});
