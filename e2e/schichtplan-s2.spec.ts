import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createE2eAdminClient, getDemoTenantId, tenantUrl } from "./helpers/test-data";
import { E2E_STAFF_EMAIL, E2E_STUDENT_EMAIL, E2E_TEST_PASSWORD } from "./global-setup";

/**
 * "Schichtplan" Block S2 (Josips Auftrag, 08.08.2026) — Admin-Schicht-CRUD,
 * Zeitfenster-Serienanlage, Freelancer-Selbstbuchung, Sollstunden-
 * Selbstverwaltung, Feiertagsimport. NEUE Datei (nicht
 * `e2e/schichtplan.spec.ts` erweitert) — S1 bleibt als eigenständiges
 * Regressionsnetz unverändert, diese Datei ist eine eigene serielle Kette
 * (`test.describe.configure({ mode: "serial" })`, gleiches Prinzip wie S1:
 * die sieben Fälle bauen bewusst aufeinander auf).
 *
 * Migration `20260807171725_shift_calendar_s2.sql` ist zum Zeitpunkt des
 * Schreibens dieser Datei NOCH NICHT auf der verlinkten Supabase-Instanz
 * angewendet — dieser Spec läuft deshalb noch nicht gegen echte Daten, wird
 * aber nach der Migration verifiziert (gleiches Vorgehen wie S1).
 *
 * DOKUMENTIERTE ABWEICHUNG (Fall 5, "Zweiter Direkt-Insert desselben
 * Studenten in das jetzt volle Zeitfenster scheitert mit CT001"): technisch
 * NICHT wie wörtlich beauftragt umsetzbar. `bookOwnShift()` übernimmt
 * `starts_at`/`ends_at` IMMER 1:1 vom Zeitfenster — ein zweiter Insert
 * DESSELBEN Arbeiters für DASSELBE Zeitfenster hat deshalb zwangsläufig
 * exakt dieselbe Zeitspanne wie die erste (bereits gebuchte) Schicht. Der
 * `calendar_shifts_no_overlap`-EXCLUDE-Constraint (`worker_id` gleich UND
 * Zeitspannen-Overlap, S1-Migration) ist ein Postgres-STATEMENT-Constraint
 * und wird beim Einfügen der Zeile geprüft, BEVOR der `AFTER`-Trigger
 * `calendar_slot_capacity_guard()` überhaupt feuert (AFTER-Trigger laufen
 * erst, nachdem die Zeile alle unmittelbaren Constraints bereits bestanden
 * hat) — ein gleichzeitig überlappender UND kapazitätsverletzender Insert
 * scheitert deshalb IMMER zuerst mit `23P01` (Overlap), nie mit `CT001`
 * (Kapazität), wenn es derselbe Arbeiter zur selben Zeit ist. `23P01` war
 * bereits Teil des S1-Regressionsnetzes (`e2e/schichtplan.spec.ts`, Fall 5)
 * — dieser Fall hier soll gezielt den NEUEN, S2-spezifischen
 * Kapazitäts-Trigger prüfen, der WORKER-UNABHÄNGIG auf das Zeitfenster
 * wirkt. Umgesetzt deshalb mit einem ZWEITEN, eigens für diesen Test
 * angelegten Arbeiter (wiederverwendet: das bereits bestehende
 * `E2E Staff`-Testkonto bekommt zusätzlich zu seiner Rolle eine
 * Arbeiterzeile) statt einem zweiten Insert desselben Studenten — das ist
 * die einzige Konstellation, die tatsächlich `CT001` auslöst, ohne vorher
 * an `23P01` zu scheitern.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: "e2e/.auth/staff.json" });

let admin: SupabaseClient;
let tenantId: string;
let studentUserId: string;
let studentMembershipId: string;
let staffUserId: string;
let staffMembershipId: string;
let workerId: string; // E2E Student, Arbeiterzeile
let secondWorkerId: string; // E2E Staff, nur für Fall 5 (CT001)
let projectId: string;
let firstSlot: { id: string; startsAt: string; endsAt: string } | null = null;
const projectName = `E2E S2 Projekt ${Date.now()}`;

function todayBerlinIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
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

  const { data: studentProfile, error: studentError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", E2E_STUDENT_EMAIL)
    .single();
  if (studentError || !studentProfile) throw new Error(`Studentenprofil nicht gefunden: ${studentError?.message}`);
  studentUserId = studentProfile.id as string;

  const { data: staffProfile, error: staffError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", E2E_STAFF_EMAIL)
    .single();
  if (staffError || !staffProfile) throw new Error(`Staff-Profil nicht gefunden: ${staffError?.message}`);
  staffUserId = staffProfile.id as string;

  const { data: studentMembership } = await admin
    .from("memberships")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", studentUserId)
    .single();
  studentMembershipId = studentMembership!.id as string;

  const { data: staffMembership } = await admin
    .from("memberships")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", staffUserId)
    .single();
  staffMembershipId = staffMembership!.id as string;

  // Sauberer Ausgangszustand, falls ein vorheriger Lauf abgebrochen wurde.
  await admin.from("calendar_workers").delete().eq("tenant_id", tenantId).eq("user_id", studentUserId);
  await admin.from("calendar_workers").delete().eq("tenant_id", tenantId).eq("user_id", staffUserId);
  await admin.from("calendar_projects").delete().eq("tenant_id", tenantId).eq("name", projectName);
  // Fall 7 (Feiertagsimport) braucht einen leeren Ausgangszustand für 2026.
  await admin
    .from("calendar_absences")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("kind", "holiday")
    .gte("starts_on", "2026-01-01")
    .lte("starts_on", "2026-12-31");

  // Flag muss an sein — S1s afterAll schaltet es nach dessen eigenem Lauf
  // wieder aus, dieser Spec ist unabhängig davon und schaltet es selbst an.
  const { data: tenantRow } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  await admin.from("tenants").update({ settings: { ...settings, shift_calendar_enabled: true } }).eq("id", tenantId);

  // Arbeiterzeile + Projekt + Mitgliedschaft direkt anlegen (S1 hat den
  // Anlage-Weg über die UI bereits getestet) — dieser Block S2-Spec testet
  // die NEUEN Flows (Schicht-CRUD, Zeitfenster-Serie, Selbstbuchung,
  // Sollstunden, Feiertagsimport), nicht erneut die S1-Arbeiterverwaltung.
  const { data: worker, error: workerError } = await admin
    .from("calendar_workers")
    .insert({ tenant_id: tenantId, membership_id: studentMembershipId, user_id: studentUserId, worker_type: "employee" })
    .select("id")
    .single();
  if (workerError || !worker) throw new Error(`Arbeiterzeile konnte nicht angelegt werden: ${workerError?.message}`);
  workerId = worker.id as string;

  const { data: project, error: projectError } = await admin
    .from("calendar_projects")
    .insert({ tenant_id: tenantId, name: projectName })
    .select("id")
    .single();
  if (projectError || !project) throw new Error(`Projekt konnte nicht angelegt werden: ${projectError?.message}`);
  projectId = project.id as string;

  await admin.from("calendar_project_members").insert({ tenant_id: tenantId, project_id: projectId, worker_id: workerId });
});

test.afterAll(async () => {
  if (projectId) {
    await admin.from("calendar_shifts").delete().eq("project_id", projectId);
    await admin.from("calendar_slots").delete().eq("project_id", projectId);
    await admin.from("calendar_projects").delete().eq("id", projectId);
  }
  if (workerId) {
    await admin.from("calendar_time_entries").delete().eq("worker_id", workerId);
    await admin.from("calendar_shifts").delete().eq("worker_id", workerId);
    await admin.from("calendar_workers").delete().eq("id", workerId);
  }
  if (secondWorkerId) {
    await admin.from("calendar_shifts").delete().eq("worker_id", secondWorkerId);
    await admin.from("calendar_workers").delete().eq("id", secondWorkerId);
  }
  await admin
    .from("calendar_absences")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("kind", "holiday")
    .gte("starts_on", "2026-01-01")
    .lte("starts_on", "2026-12-31");

  const { data: tenantRow } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  await admin.from("tenants").update({ settings: { ...settings, shift_calendar_enabled: false } }).eq("id", tenantId);
});

test("Fall 1 — Admin legt Schicht an: erscheint im Admin-Raster UND in der Wochenansicht des Studenten", async ({
  page,
  browser,
}) => {
  await page.goto(tenantUrl("/admin/schichtplanung?tab=shifts"));
  await expect(page.getByRole("heading", { name: "Schichten" })).toBeVisible();

  const addButtonPattern = new RegExp("^Schicht für E2E Student am ");
  const addButton = page.getByRole("button", { name: addButtonPattern }).first();
  await addButton.click();

  await expect(page.getByRole("heading", { name: "Schicht anlegen" })).toBeVisible();
  await page.getByLabel("Projekt (optional)").selectOption({ label: projectName });
  await page.getByRole("button", { name: "Schicht anlegen" }).click();

  const shiftButton = page.getByRole("button", { name: new RegExp(`E2E Student, .*08:00 bis 16:00 Uhr, Projekt ${projectName}`) });
  await expect(shiftButton).toBeVisible({ timeout: 15000 });

  const studentContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const studentPage = await studentContext.newPage();
  try {
    await studentPage.goto(tenantUrl("/schichtplan"));
    const studentShift = studentPage.getByRole("button", {
      name: new RegExp(`08:00 bis 16:00 Uhr, Projekt ${projectName}`),
    });
    await expect(studentShift).toBeVisible({ timeout: 15000 });
  } finally {
    await studentContext.close();
  }
});

test("Fall 2 — Admin ändert die Zeit: neuer Wert sichtbar; Storno entfernt Schicht aus Lernansicht", async ({
  page,
  browser,
}) => {
  await page.goto(tenantUrl("/admin/schichtplanung?tab=shifts"));

  const shiftButton = page.getByRole("button", { name: new RegExp(`E2E Student, .*08:00 bis 16:00 Uhr, Projekt ${projectName}`) });
  await shiftButton.click();
  await expect(page.getByRole("heading", { name: "Schicht bearbeiten" })).toBeVisible();

  // exact: true ist hier Pflicht — ohne exakten Namensvergleich matcht
  // getByLabel("Bis") auch den Schicht-Button, dessen aria-label die
  // Zeitspanne als Substring enthält ("... 08:00 bis 16:00 Uhr ...").
  await page.getByLabel("Bis", { exact: true }).fill("17:00");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("08:00–17:00")).toBeVisible({ timeout: 15000 });

  // Storno über den zweiten Bearbeiten-Aufruf.
  const updatedShiftButton = page.getByRole("button", { name: new RegExp(`E2E Student, .*08:00 bis 17:00 Uhr, Projekt ${projectName}`) });
  await updatedShiftButton.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Schicht stornieren" }).click();
  await expect(page.getByText("Storniert")).toBeVisible({ timeout: 15000 });

  const studentContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const studentPage = await studentContext.newPage();
  try {
    await studentPage.goto(tenantUrl("/schichtplan"));
    const studentShift = studentPage.getByRole("button", { name: /08:00 bis 17:00 Uhr/ });
    await expect(studentShift).toHaveCount(0);
  } finally {
    await studentContext.close();
  }
});

test("Fall 3 — Serienanlage über 4 Wochen erzeugt 4 Zeitfenster", async ({ page }) => {
  const startDate = todayBerlinIso();

  await page.goto(tenantUrl("/admin/schichtplanung?tab=slots"));
  // exact: true — ohne exakten Namensvergleich matcht dieser Locator auch
  // die Überschrift "Zeitfenster anlegen" desselben Reiters (Substring-
  // Treffer, gleiche Fehlerklasse wie der getByLabel("Bis")-Fund in Fall 2).
  await expect(page.getByRole("heading", { name: "Zeitfenster", exact: true })).toBeVisible();

  const addSection = page.locator("section").filter({ hasText: "Zeitfenster anlegen" });
  await addSection.getByLabel("Projekt", { exact: true }).selectOption({ label: projectName });
  await addSection.getByLabel("Datum").fill(startDate);
  await addSection.getByLabel("Von").fill("08:00");
  await addSection.getByLabel("Bis").fill("16:00");
  await addSection.getByLabel("Kapazität").fill("1");
  await addSection.getByLabel("Wiederholen für (Wochen)").fill("4");
  await expect(page.getByText(/4 Termine werden angelegt:/)).toBeVisible();
  await addSection.getByRole("button", { name: "Zeitfenster anlegen" }).click();

  await expect(page.locator("li").filter({ hasText: projectName }).first()).toBeVisible({ timeout: 15000 });

  const { data: slots, error } = await admin
    .from("calendar_slots")
    .select("id, starts_at, ends_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`Zeitfenster-Prüfung fehlgeschlagen: ${error.message}`);
  expect(slots).toHaveLength(4);

  firstSlot = { id: slots![0].id as string, startsAt: slots![0].starts_at as string, endsAt: slots![0].ends_at as string };
});

test("Fall 4 — Student wird auf Freelancer gesetzt: sieht offenes Zeitfenster mit 1 von 1 Plätzen frei, bucht per Klick", async ({
  page,
  browser,
}) => {
  await page.goto(tenantUrl("/admin/schichtplanung?tab=workers"));
  const listSection = page.locator("section").filter({ hasText: "Arbeiter", hasNotText: "hinzufügen" }).first();
  const studentRow = listSection.locator("li").filter({ hasText: "E2E Student" });
  await studentRow.getByRole("button", { name: "Bearbeiten" }).click();
  await studentRow.getByLabel("Art").selectOption({ label: "Freelancer" });
  await studentRow.getByRole("button", { name: "Speichern" }).click();
  await expect(studentRow.getByText("Freelancer")).toBeVisible({ timeout: 15000 });

  const studentContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const studentPage = await studentContext.newPage();
  try {
    await studentPage.goto(tenantUrl("/schichtplan"));
    await expect(studentPage.getByRole("heading", { name: "Offene Zeitfenster" })).toBeVisible();
    await expect(studentPage.getByText("1 von 1 Plätzen frei")).toBeVisible({ timeout: 15000 });

    await studentPage.getByRole("button", { name: "Buchen" }).click();
    await expect(studentPage.getByRole("button", { name: "Bereits gebucht" })).toBeVisible({ timeout: 15000 });

    const bookedShift = studentPage.getByRole("button", { name: /08:00 bis 16:00 Uhr, Projekt/ });
    await expect(bookedShift).toBeVisible({ timeout: 15000 });
  } finally {
    await studentContext.close();
  }
});

test("Fall 5 — Zweiter Insert eines ANDEREN Arbeiters in das jetzt volle Zeitfenster scheitert mit CT001", async () => {
  if (!firstSlot) throw new Error("firstSlot aus Fall 3 fehlt.");

  const { data: secondWorker, error: secondWorkerError } = await admin
    .from("calendar_workers")
    .insert({ tenant_id: tenantId, membership_id: staffMembershipId, user_id: staffUserId, worker_type: "employee" })
    .select("id")
    .single();
  if (secondWorkerError || !secondWorker) {
    throw new Error(`Zweite Arbeiterzeile (Fall 5) konnte nicht angelegt werden: ${secondWorkerError?.message}`);
  }
  secondWorkerId = secondWorker.id as string;

  const { error: capacityError } = await admin.from("calendar_shifts").insert({
    tenant_id: tenantId,
    worker_id: secondWorkerId,
    project_id: projectId,
    slot_id: firstSlot.id,
    starts_at: firstSlot.startsAt,
    ends_at: firstSlot.endsAt,
    break_minutes: 0,
    status: "planned",
    source: "admin",
  });

  expect(capacityError).not.toBeNull();
  expect(capacityError?.code).toBe("CT001");
});

test("Fall 6 — Student ändert eigene Sollstunden über Formular; direkter Manipulationsversuch auf worker_type/status wird vom Guard-Trigger zurückgesetzt", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/schichtplan"));
    await expect(page.getByRole("heading", { name: "Sollstunden" })).toBeVisible();

    // getByRole("textbox", ...) statt getByLabel — die umschließende
    // <section aria-labelledby="target-hours-heading"> trägt denselben
    // Accessible Name "Sollstunden" wie das Eingabefeld selbst (exact:true
    // hilft hier nicht, beide Namen sind exakt gleich), die Eingrenzung auf
    // die Textbox-Rolle ist eindeutig.
    await page.getByRole("textbox", { name: "Sollstunden" }).fill("20");
    await page.getByLabel("Zeitraum").selectOption({ label: "pro Monat" });
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Sollstunden gespeichert.")).toBeVisible({ timeout: 15000 });
  } finally {
    await context.close();
  }

  const studentClient = await signInAsStudent();
  try {
    const { error: updateError } = await studentClient
      .from("calendar_workers")
      .update({ worker_type: "employee", status: "inactive" })
      .eq("id", workerId);
    // Läuft OHNE Fehler durch — RLS lässt den Update-Versuch zu, der
    // Spaltenschutz-Trigger calendar_workers_guard() setzt worker_type/
    // status dabei serverseitig lautlos auf OLD zurück (kein sichtbarer
    // Fehler, das ist Absicht: die WITH CHECK-Klausel der Policy sieht nur
    // das bereits vom BEFORE-Trigger korrigierte NEW).
    expect(updateError).toBeNull();
  } finally {
    await studentClient.auth.signOut({ scope: "local" });
  }

  const { data: workerRow, error: readError } = await admin
    .from("calendar_workers")
    .select("worker_type, status, target_hours, target_period")
    .eq("id", workerId)
    .single();
  if (readError || !workerRow) throw new Error(`Arbeiterzeile (Fall 6) nicht lesbar: ${readError?.message}`);

  expect(workerRow.worker_type).toBe("freelancer");
  expect(workerRow.status).toBe("active");
  expect(Number(workerRow.target_hours)).toBe(20);
  expect(workerRow.target_period).toBe("month");
});

test("Fall 7 — Feiertagsimport DE 2026 meldet 9 eingefügt, zweiter Klick meldet 0 eingefügt/9 übersprungen", async ({
  page,
}) => {
  await page.goto(tenantUrl("/admin/schichtplanung?tab=absences&year=2026"));
  await expect(page.getByRole("heading", { name: "Feiertage importieren" })).toBeVisible();

  await page.getByLabel("Land").selectOption({ label: "Deutschland" });
  // getByRole("spinbutton", ...) statt getByLabel — der Reiter hat oben
  // bereits eine Jahresauswahl (<select>, gleicher Accessible Name "Jahr")
  // für die Anzeige, der Import-Block darunter ein eigenes <input
  // type="number">. Die Rolle unterscheidet beide eindeutig.
  await page.getByRole("spinbutton", { name: "Jahr" }).fill("2026");
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByText("9 eingefügt, 0 übersprungen.")).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByText("0 eingefügt, 9 übersprungen.")).toBeVisible({ timeout: 15000 });
});
