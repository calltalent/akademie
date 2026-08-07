import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createE2eAdminClient, getDemoTenantId, tenantUrl } from "./helpers/test-data";
import { E2E_STUDENT_EMAIL, E2E_TEST_PASSWORD } from "./global-setup";

/**
 * "Schichtplan" Block S1 (Josips Auftrag, 07.08.2026). Migration
 * 20260807090000_shift_calendar.sql ist zum Zeitpunkt des Schreibens dieser
 * Datei NOCH NICHT auf der verlinkten Supabase-Instanz angewendet (siehe
 * PHASENSTATUS.md) — dieser Spec läuft deshalb noch nicht gegen echte Daten,
 * wird aber nach der Migration verifiziert.
 *
 * `test.describe.configure({ mode: "serial" })`: die Tests bauen bewusst
 * aufeinander auf (Flag → Arbeiterzeile → Projektzuweisung → Stempeln),
 * exakt die im Bauauftrag verlangte Reihenfolge — kein unabhängiges
 * Setup je Test wie bei `kunden-area.spec.ts`.
 *
 * DOKUMENTIERTE ABWEICHUNG (Testfall "Owner legt Projekt an und weist
 * Studenten-Testkonto zu → Projektname erscheint in dessen Ansicht"): S1
 * baut laut Scope-Grenze bewusst KEIN Schicht-CRUD — ohne eine geplante
 * Schicht hat die Lernbereich-Wochenansicht (`/schichtplan`) keinen Ort, an
 * dem eine reine Projektmitgliedschaft (ohne Schicht) sichtbar würde (die
 * Ansicht zeigt Schichten, nicht "meine Projekte"). Die im Auftrag gemeinte
 * Prüfung — dass der zugewiesene Student den Projektnamen "in seiner
 * Ansicht" sieht — wird deshalb auf der Datenebene verifiziert, exakt an der
 * dafür zuständigen Stelle: ein zweiter Supabase-Client, angemeldet ALS der
 * Student (Passwort-Login mit dem anon key, kein service_role), fragt
 * `calendar_projects` direkt ab und bekommt den Projektnamen zurück — das
 * ist die RLS-Policy `calendar_projects_select`, Zweig
 * "eigene Projektmitgliedschaft über calendar_project_members", in Aktion.
 * Zusätzlich wird admin-seitig sichtbar geprüft, dass die Zuweisung in der
 * Verwaltungsoberfläche ankommt (Mitgliederzähler "1 Arbeiter").
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: "e2e/.auth/staff.json" });

let admin: SupabaseClient;
let tenantId: string;
let studentUserId: string;
let workerId: string | null = null;
let projectId: string | null = null;
const projectName = `E2E Schichtplan-Projekt ${Date.now()}`;

async function setShiftCalendarEnabled(enabled: boolean): Promise<void> {
  const { data: tenantRow } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  await admin
    .from("tenants")
    .update({ settings: { ...settings, shift_calendar_enabled: enabled } })
    .eq("id", tenantId);
}

async function signInAsStudent(): Promise<SupabaseClient> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: E2E_STUDENT_EMAIL, password: E2E_TEST_PASSWORD });
  if (error) throw new Error(`Studenten-Anmeldung für Direktabfrage fehlgeschlagen: ${error.message}`);
  return client;
}

test.beforeAll(async () => {
  admin = createE2eAdminClient();
  tenantId = await getDemoTenantId(admin);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", E2E_STUDENT_EMAIL)
    .single();
  if (profileError || !profile) throw new Error(`Studentenprofil nicht gefunden: ${profileError?.message}`);
  studentUserId = profile.id as string;

  // Sauberer Ausgangszustand, falls ein vorheriger Lauf abgebrochen wurde.
  await admin.from("calendar_workers").delete().eq("tenant_id", tenantId).eq("user_id", studentUserId);
  await admin.from("calendar_projects").delete().eq("tenant_id", tenantId).eq("name", projectName);
});

test.afterAll(async () => {
  if (projectId) await admin.from("calendar_projects").delete().eq("id", projectId);
  if (workerId) {
    await admin.from("calendar_time_entries").delete().eq("worker_id", workerId);
    await admin.from("calendar_workers").delete().eq("id", workerId);
  }
  await setShiftCalendarEnabled(false);
});

test("Flag aus → kein Menüpunkt Mein Schichtplan für den Studenten", async ({ browser }) => {
  await setShiftCalendarEnabled(false);

  const context = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/dashboard"));
    const nav = page.getByRole("complementary", { name: "Hauptnavigation" });
    await expect(nav.getByRole("link", { name: "Mein Schichtplan" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("Flag an, aber ohne Arbeiterzeile → weiterhin kein Menüpunkt", async ({ browser }) => {
  await setShiftCalendarEnabled(true);

  const context = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/dashboard"));
    const nav = page.getByRole("complementary", { name: "Hauptnavigation" });
    await expect(nav.getByRole("link", { name: "Mein Schichtplan" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("Admin legt den Studenten als Arbeiter an — danach Menüpunkt + Wochenansicht sichtbar", async ({ page, browser }) => {
  await page.goto(tenantUrl("/admin/schichtplanung"));
  await expect(page.getByRole("heading", { name: "Schichtplanung" })).toBeVisible();

  const addSection = page.locator("section").filter({ hasText: "Arbeiter hinzufügen" });
  await addSection.getByLabel("Mitglied").selectOption({ label: "E2E Student" });
  await addSection.getByRole("button", { name: "Arbeiter hinzufügen" }).click();

  // Zeile in der Arbeiterliste bestätigt das erfolgreiche Anlegen.
  const listSection = page.locator("section").filter({ hasText: "Arbeiter", hasNotText: "hinzufügen" }).first();
  await expect(listSection.getByText("E2E Student")).toBeVisible({ timeout: 15000 });

  const { data: worker, error } = await admin
    .from("calendar_workers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", studentUserId)
    .single();
  if (error || !worker) throw new Error(`Arbeiterzeile nach dem Anlegen nicht gefunden: ${error?.message}`);
  workerId = worker.id as string;

  const studentContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const studentPage = await studentContext.newPage();
  try {
    await studentPage.goto(tenantUrl("/dashboard"));
    const nav = studentPage.getByRole("complementary", { name: "Hauptnavigation" });
    const link = nav.getByRole("link", { name: "Mein Schichtplan" });
    await expect(link).toBeVisible({ timeout: 15000 });
    await link.click();
    await expect(studentPage).toHaveURL(/\/schichtplan$/);
    await expect(studentPage.getByRole("heading", { name: "Zeiterfassung" })).toBeVisible();
    await expect(studentPage.getByText("Aktuell nicht eingestempelt.")).toBeVisible();
  } finally {
    await studentContext.close();
  }
});

test("Owner legt Projekt an und weist den Arbeiter zu — Zuweisung admin-seitig sichtbar UND für den Studenten per RLS lesbar", async ({
  page,
}) => {
  await page.goto(tenantUrl("/admin/schichtplanung"));
  await page.getByRole("button", { name: "Projekte" }).click();

  const addSection = page.locator("section").filter({ hasText: "Projekt anlegen" });
  await addSection.getByLabel("Name", { exact: true }).fill(projectName);
  await addSection.getByRole("button", { name: "Projekt anlegen" }).click();

  const projectRow = page.locator("li").filter({ hasText: projectName });
  await expect(projectRow).toBeVisible({ timeout: 15000 });

  const { data: project, error } = await admin
    .from("calendar_projects")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", projectName)
    .single();
  if (error || !project) throw new Error(`Projekt nach dem Anlegen nicht gefunden: ${error?.message}`);
  projectId = project.id as string;

  await projectRow.getByRole("button", { name: "Arbeiter zuweisen" }).click();
  await projectRow.getByRole("checkbox", { name: "E2E Student" }).check();
  await projectRow.getByRole("button", { name: "Zuweisung speichern" }).click();
  await expect(projectRow.getByText("1 Arbeiter")).toBeVisible({ timeout: 15000 });

  // Datenebenen-Nachweis "Projektname erscheint in dessen Ansicht" (siehe
  // Kopfkommentar, dokumentierte Abweichung): RLS-Policy
  // `calendar_projects_select` muss dem Studenten jetzt genau DIESES
  // Projekt zeigen — als er selbst angemeldet, nicht über service_role.
  const studentClient = await signInAsStudent();
  try {
    const { data: visibleProject, error: visibleError } = await studentClient
      .from("calendar_projects")
      .select("id, name")
      .eq("id", projectId)
      .maybeSingle();
    expect(visibleError).toBeNull();
    expect(visibleProject?.name).toBe(projectName);
  } finally {
    await studentClient.auth.signOut();
  }
});

test("Ein-/Ausstempeln funktioniert; zweites Einstempeln ohne vorheriges Ausstempeln wird abgelehnt", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/schichtplan"));

    await page.getByRole("button", { name: "Einstempeln" }).click();
    await expect(page.getByText(/^Eingestempelt seit /)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Ausstempeln" })).toBeVisible();

    // Zweites Einstempeln OHNE vorheriges Ausstempeln — der Button selbst
    // ist durch den Client-Zustand bereits zu "Ausstempeln" gewechselt
    // (normale Nutzerführung verhindert einen doppelten Klick strukturell).
    // Die eigentliche, im Auftrag verlangte Ablehnung prüft deshalb direkt
    // die Datenbankebene: ein zweiter offener `calendar_time_entries`-
    // Datensatz für denselben Arbeiter muss am
    // `calendar_time_entries_one_open`-Unique-Index (bzw. am
    // EXCLUDE-Constraint `calendar_time_entries_no_overlap`) scheitern —
    // exakt der Mechanismus, der ein doppeltes Einstempeln (z. B. über zwei
    // gleichzeitig offene Tabs) verhindert.
    const studentClient = await signInAsStudent();
    try {
      const { error: duplicateError } = await studentClient.from("calendar_time_entries").insert({
        tenant_id: tenantId,
        worker_id: workerId,
        started_at: new Date().toISOString(),
        source: "self",
      });
      expect(duplicateError).not.toBeNull();
    } finally {
      await studentClient.auth.signOut();
    }

    await page.getByRole("button", { name: "Ausstempeln" }).click();
    await expect(page.getByText("Aktuell nicht eingestempelt.")).toBeVisible({ timeout: 15000 });
  } finally {
    await context.close();
  }
});
