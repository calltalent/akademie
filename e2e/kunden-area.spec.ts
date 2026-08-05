import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createE2eAdminClient, getDemoTenantId, tenantUrl } from "./helpers/test-data";
import { E2E_STUDENT_EMAIL } from "./global-setup";

/**
 * "Meine Kunden Area" (Plan Abschnitt 9.3,
 * verwende-den-planungs-agenten-sequential-frost.md). Migration
 * 20260805090000_customer_area.sql ist zum Zeitpunkt des Schreibens dieser
 * Datei NOCH NICHT auf der verlinkten Supabase-Instanz angewendet — dieser
 * Spec läuft deshalb noch nicht gegen echte Daten, wird aber nach der
 * Migration verifiziert (siehe PHASENSTATUS.md).
 *
 * DOKUMENTIERTE ABWEICHUNG vom Plan-Wortlaut ("Nutzer außerhalb der Gruppe
 * sieht keinen von beidem"): `global-setup.ts` provisioniert für die
 * GESAMTE Suite nur genau zwei persistente Accounts (owner "staff", member
 * "student") — kein drittes Konto für einen zweiten, nicht zugewiesenen
 * Nutzer, und kein anderer Spec in diesem Repo legt bislang zusätzliche
 * Auth-Konten innerhalb eines einzelnen Specs an. Statt eines dritten Kontos
 * prüft der erste Test denselben Effekt als Vorher/Nachher am EINEN
 * Studenten-Konto: vor der Gruppenzuweisung sieht der Student weder
 * Menüpunkt noch Link (obwohl er reguläres Mandanten-Mitglied ist), nach der
 * Zuweisung beides — das belegt, dass die Sichtbarkeit tatsächlich an die
 * Gruppenzuordnung gebunden ist, nicht nur an die Mandantenmitgliedschaft.
 */

test.use({ storageState: "e2e/.auth/staff.json" });

let admin: SupabaseClient;
let tenantId: string;
let groupName: string;
let linkTitle: string;
let secondLinkTitle: string;
let contactTrainerId: string | null = null;
let contactItemId: string | null = null;

const TRAINER_PHONE = "+49 30 1234567";
const TRAINER_EMAIL = "e2e-kontakt@example.test";

test.beforeAll(async () => {
  admin = createE2eAdminClient();
  tenantId = await getDemoTenantId(admin);
  const suffix = Date.now();
  groupName = `E2E Gruppe ${suffix}`;
  linkTitle = `E2E Kundenlink ${suffix}`;
  secondLinkTitle = `E2E Zweiter Link ${suffix}`;

  // Kontakt-Fixture direkt per Service-Role-Client (gleiches Prinzip wie
  // createTestModule/createTestLesson in helpers/test-data.ts): der
  // eigentliche Prüfgegenstand ist die tel:/mailto:-Darstellung in der
  // Lernansicht, nicht der Trainer-Anlage-Flow selbst.
  const { data: trainer, error: trainerError } = await admin
    .from("trainers")
    .insert({ tenant_id: tenantId, name: `E2E Ansprechpartner ${suffix}`, phone: TRAINER_PHONE, email: TRAINER_EMAIL })
    .select("id")
    .single();
  if (trainerError || !trainer) {
    throw new Error(`E2E-Trainerprofil konnte nicht angelegt werden: ${trainerError?.message}`);
  }
  contactTrainerId = trainer.id as string;

  // `visibility: "restricted"` OHNE Zuordnung (nicht "all") — sonst wäre der
  // Kontakt von Anfang an für JEDES Mitglied sichtbar und würde den
  // Menüpunkt "Meine Kunden Area" schon vor der Gruppenzuweisung im ersten
  // Test zeigen (Bug gefunden 05.08.2026 beim ersten echten Testlauf gegen
  // demo-blau: `toHaveCount(0)` schlug fehl, weil bereits 1 Eintrag da war).
  // "restricted" ohne Audience ist laut RLS/Perf-Fix-Migration nur für
  // owner/admin sichtbar — der tel:/mailto:-Test unten läuft als `staff`
  // (Datei-Standard `test.use`, Zeile 27), sieht den Kontakt also trotzdem.
  const { data: contactItem, error: contactError } = await admin
    .from("customer_area_items")
    .insert({ tenant_id: tenantId, kind: "contact", trainer_id: contactTrainerId, visibility: "restricted" })
    .select("id")
    .single();
  if (contactError || !contactItem) {
    throw new Error(`E2E-Kunden-Area-Kontakt konnte nicht angelegt werden: ${contactError?.message}`);
  }
  contactItemId = contactItem.id as string;
});

test.afterAll(async () => {
  if (contactItemId) await admin.from("customer_area_items").delete().eq("id", contactItemId);
  if (contactTrainerId) await admin.from("trainers").delete().eq("id", contactTrainerId);
  await admin.from("customer_area_items").delete().eq("tenant_id", tenantId).eq("title", linkTitle);
  await admin.from("customer_area_items").delete().eq("tenant_id", tenantId).eq("title", secondLinkTitle);
  await admin.from("customer_area_groups").delete().eq("tenant_id", tenantId).eq("name", groupName);
});

test("Admin legt Gruppe + gruppen-eingeschränkten Link an — Student sieht erst nach Zuweisung Menüpunkt und Link", async ({
  page,
  browser,
}) => {
  await page.goto(tenantUrl("/admin/einstellungen"));
  await page.getByRole("button", { name: "Kunden-Area" }).click();

  // --- Gruppe anlegen (leer) ---
  const groupsSection = page.locator("section").filter({ hasText: "Gruppe anlegen" });
  await groupsSection.getByLabel("Name", { exact: true }).fill(groupName);
  await groupsSection.getByRole("button", { name: "Gruppe anlegen" }).click();
  await expect(page.getByText(groupName)).toBeVisible({ timeout: 15000 });

  // --- Link anlegen, Sichtbarkeit auf die (noch leere) Gruppe beschränken ---
  const linksSection = page.locator("section").filter({ hasText: "Link hinzufügen" });
  await linksSection.getByLabel("Titel", { exact: true }).fill(linkTitle);
  await linksSection.getByLabel("URL", { exact: true }).fill("https://example.test/e2e-kunden-area");
  await linksSection.getByLabel("Nur ausgewählte Gruppen oder Personen").check();
  await linksSection.getByRole("checkbox", { name: groupName }).check();
  await linksSection.getByRole("button", { name: "Link hinzufügen" }).click();
  await expect(linksSection.getByText(linkTitle)).toBeVisible({ timeout: 15000 });

  // --- Student VOR der Gruppenzuweisung: weder Menüpunkt noch Link sichtbar ---
  const studentContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const studentPage = await studentContext.newPage();
  try {
    await studentPage.goto(tenantUrl("/dashboard"));
    // `<aside aria-label="Hauptnavigation">` → ARIA-Rolle "complementary", NICHT
    // "navigation" (aria-label ändert die implizite Rolle nicht). Der eigentliche
    // <nav> darunter trägt kein eigenes Label. Live per read_page verifiziert
    // (05.08.2026) — betrifft auch dashboard-shell.spec.ts/admin-shell.spec.ts,
    // siehe PHASENSTATUS.md.
    const nav = studentPage.getByRole("complementary", { name: "Hauptnavigation" });
    await expect(nav.getByRole("link", { name: "Meine Kunden Area" })).toHaveCount(0);

    await studentPage.goto(tenantUrl("/kunden-area"));
    await expect(studentPage.getByText(linkTitle)).toHaveCount(0);
  } finally {
    await studentContext.close();
  }

  // --- Admin: Student der Gruppe zuweisen ---
  const groupRow = page.locator("li").filter({ hasText: groupName });
  await groupRow.getByRole("button", { name: "Mitglieder" }).click();
  await groupRow.getByRole("checkbox", { name: E2E_STUDENT_EMAIL }).check();
  await groupRow.getByRole("button", { name: "Mitglieder speichern" }).click();
  await expect(groupRow.getByText("1 Mitglied")).toBeVisible({ timeout: 15000 });

  // --- Student NACH der Zuweisung: Menüpunkt UND Link sichtbar ---
  const assignedContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const assignedPage = await assignedContext.newPage();
  try {
    await assignedPage.goto(tenantUrl("/dashboard"));
    const nav = assignedPage.getByRole("complementary", { name: "Hauptnavigation" });
    const customerAreaNavLink = nav.getByRole("link", { name: "Meine Kunden Area" });
    await expect(customerAreaNavLink).toBeVisible({ timeout: 15000 });
    await customerAreaNavLink.click();
    await expect(assignedPage).toHaveURL(/\/kunden-area$/);

    const linkCard = assignedPage.getByRole("link", { name: new RegExp(linkTitle) });
    await expect(linkCard).toBeVisible();
    await expect(linkCard).toHaveAttribute("href", "https://example.test/e2e-kunden-area");
  } finally {
    await assignedContext.close();
  }
});

test("Auf/Ab-Buttons tragen sprechende aria-label", async ({ page }) => {
  await page.goto(tenantUrl("/admin/einstellungen"));
  await page.getByRole("button", { name: "Kunden-Area" }).click();

  const linksSection = page.locator("section").filter({ hasText: "Link hinzufügen" });
  await linksSection.getByLabel("Titel", { exact: true }).fill(secondLinkTitle);
  await linksSection.getByLabel("URL", { exact: true }).fill("/e2e-zweiter-link");
  await linksSection.getByRole("button", { name: "Link hinzufügen" }).click();
  await expect(linksSection.getByText(secondLinkTitle)).toBeVisible({ timeout: 15000 });

  const row = linksSection.locator("li").filter({ hasText: secondLinkTitle });
  await expect(row.getByRole("button", { name: `Link nach oben: ${secondLinkTitle}` })).toBeVisible();
  await expect(row.getByRole("button", { name: `Link nach unten: ${secondLinkTitle}` })).toBeVisible();
});

test("Ansprechpartner-Karte zeigt korrekte tel:/mailto:-Links", async ({ page }) => {
  await page.goto(tenantUrl("/kunden-area"));

  const phoneLink = page.getByRole("link", { name: new RegExp(TRAINER_PHONE.replace("+", "\\+")) });
  await expect(phoneLink).toHaveAttribute("href", `tel:${TRAINER_PHONE}`);

  const emailLink = page.getByRole("link", { name: new RegExp(TRAINER_EMAIL) });
  await expect(emailLink).toHaveAttribute("href", `mailto:${TRAINER_EMAIL}`);
});

test.describe("Mobile 375px", () => {
  test.use({ viewport: { width: 375, height: 812 }, storageState: "e2e/.auth/student.json" });

  test("Menüpunkt im Ausklapp-Panel erreichbar, keine horizontale Scrollleiste", async ({ page }) => {
    await page.goto(tenantUrl("/kunden-area"));

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // +1: Rundungstoleranz

    await page.getByRole("button", { name: "Menü öffnen" }).click();
    const panel = page.locator("#learn-mobile-menu");
    await expect(panel.getByRole("link", { name: "Meine Kunden Area" })).toBeVisible();
  });
});
