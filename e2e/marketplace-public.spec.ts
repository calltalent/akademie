import { test, expect } from "@playwright/test";
import { DEMO_TENANT_URL } from "./helpers/test-data";

/**
 * Marketplace M4 — Host-Gate-Smoke-Test (`tester`-Agent, 03.08.2026).
 *
 * ANDERS als jede andere Datei in diesem Verzeichnis: `/impressum` unter
 * dem Marketplace-Host ist eine rein statische Rechtsseite ohne DB-Zugriff
 * (kein Mandant, kein Testnutzer, kein `demo-blau`-Kurs/Modul/Lektion
 * nötig) — die Prüfhandlung selbst bräuchte also KEIN Seed-Setup.
 *
 * Trotzdem NICHT lauffähig in dieser Umgebung: `playwright.config.ts`
 * definiert genau EIN `globalSetup` (`./e2e/global-setup.ts`) für die
 * GESAMTE Suite, nicht pro Spec-Datei oder Projekt. Der dort seit M2/M3
 * dokumentierte Blocker (Seed-Mandant `demo-blau` fehlt im verbundenen
 * Supabase-Projekt, `getDemoTenantId()` wirft) bricht `npm run e2e`
 * deshalb VOR der ersten Testdatei ab — unabhängig davon, ob die konkrete
 * Datei `demo-blau` selbst braucht. Diese Datei bleibt trotzdem bestehen
 * (gleiches Muster wie `e2e/marketplace-listing.spec.ts` aus M2, das
 * denselben prozessweiten Blocker schon vor diesem Block hatte) — sobald
 * der Seed existiert, laufen beide Tests unten ohne weitere Änderung.
 *
 * `DEMO_TENANT_URL` wird nur für den NEGATIV-Fall gebraucht (Test 2) — der
 * eigentliche Mandant muss dafür nicht existieren, nur sein Host-Name (die
 * Anfrage selbst löst ohnehin keinen Mandanten auf, siehe `layout.tsx`-
 * Kopfkommentar: das Host-Gate greift bereits in der Middleware, bevor
 * irgendein DB-Zugriff stattfindet).
 */

const MARKETPLACE_URL = "http://marketplace.localhost:3000";

test.describe("Marketplace-Host-Gate (M4)", () => {
  test("Impressum rendert unter dem Marketplace-Host", async ({ page }) => {
    const response = await page.goto(`${MARKETPLACE_URL}/impressum`);
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { level: 1, name: "Impressum" })).toBeVisible();
    // AKTUALISIERT (24.08.2026, Rechtsträger-Wechsel): Betreiber ist die
    // Calltalent LLC (Wyoming, USA) statt der Calltalent Ltd. — die Prüfung
    // hing vorher am UK-Firmennamen und der Company Number 16591113, die es
    // auf dieser Seite nicht mehr gibt (siehe lib/legal/company.ts).
    // `exact: true` weiterhin nötig: "Calltalent LLC" steht zusätzlich im
    // Rechtsform-Satz, im Vertretungs-Satz und in der Fußzeile — ohne
    // Eingrenzung wäre das ein Strict-Mode-Verstoß.
    await expect(page.getByText("Calltalent LLC", { exact: true })).toBeVisible();
    await expect(page.getByText("Sheridan, WY 82801", { exact: true })).toBeVisible();
  });

  test("derselbe Pfad liefert 404 unter einem normalen Mandanten-Host (kein Header-Spoofing)", async ({
    page,
  }) => {
    // Direkter Aufruf des ROH-Pfads `/marketplace/impressum` (nicht des
    // umgeschriebenen `/impressum`) auf einem Mandanten-Host — genau der
    // Fund aus dem "Während der Umsetzung gefundener und behobener Fund"-
    // Abschnitt in PHASENSTATUS.md: x-marketplace-host muss auf diesem Host
    // explizit "0" sein, layout.tsx muss dadurch notFound() auslösen.
    const response = await page.goto(`${DEMO_TENANT_URL}/marketplace/impressum`);
    expect(response?.status()).toBe(404);
  });
});
