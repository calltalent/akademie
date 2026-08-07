import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createE2eAdminClient, getDemoTenantId, tenantUrl } from "./helpers/test-data";
import { E2E_STAFF_EMAIL, E2E_STUDENT_EMAIL, E2E_TEST_PASSWORD } from "./global-setup";

/**
 * "Schichtplan" Block S3 (Josips Auftrag, 09.08.2026) — Änderungsanfragen-UI
 * (Arbeiter-Selbstanfrage + Admin-/Projektleiter-Entscheidung) und
 * Projektleiter-Zugang zum Admin-Bereich. NEUE Datei — `schichtplan.spec.ts`
 * (S1) und `schichtplan-s2.spec.ts` (S2) bleiben UNVERÄNDERT, eigene
 * serielle Kette (`mode: "serial"`, die acht Fälle bauen aufeinander auf).
 *
 * Migration `20260807215142_shift_calendar_s3.sql` ist zum Zeitpunkt des
 * Schreibens dieser Datei NOCH NICHT auf der verlinkten Supabase-Instanz
 * angewendet — dieser Spec läuft deshalb noch nicht gegen echte Daten, wird
 * aber nach der Migration verifiziert (gleiches Vorgehen wie S1/S2).
 *
 * `signOut({ scope: "local" })` bei JEDEM Ad-hoc-Client (S1-Testbug darf
 * sich nicht wiederholen, siehe PHASENSTATUS.md "Schichtplan Block S2").
 * NUR `exact: true`/rollenspezifische Locator — S2 hatte drei
 * Substring-Matching-Bugs (getByLabel("Bis") kollidierte mit dem
 * Schicht-Button-aria-label, getByRole("heading",{name:"Zeitfenster"})
 * kollidierte mit "Zeitfenster anlegen", getByRole("spinbutton") statt
 * getByLabel für "Jahr" wegen doppeltem Accessible Name) — hier bewusst
 * vermieden: die Formularfelder heißen "Neue Startzeit"/"Neue Endzeit"
 * (NICHT "Von"/"Bis", siehe `shift-change-request-panel.tsx`-Kopfkommentar),
 * und jede Interaktion mit der Arbeiter-eigenen Anfragen-Liste ist auf die
 * eigene `<section>` ("Änderung beantragen") gescoped — `shift-calendar-
 * view.tsx` rendert darüber eine EIGENE `<ul><li>`-Liste ("Liste"-Sektion,
 * S1, unverändert) mit denselben Projektnamen als Text, ein ungescopter
 * `page.locator("li")`-Zugriff würde sonst beide Listen treffen.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: "e2e/.auth/staff.json" });

let admin: SupabaseClient;
let tenantId: string;
let studentUserId: string;
let studentMembershipId: string;
let staffUserId: string;
let staffMembershipId: string;
let workerId: string; // E2E Student
let secondWorkerId: string; // E2E Staff — nur für Fall 4 (fremde Schicht)
let projectId: string;
let shiftId: string; // Schicht aus Fall 1, wird in Fall 2/3/4/5/6 wiederverwendet
const projectName = `E2E S3 Projekt ${Date.now()}`;

async function signInAsStudent(): Promise<SupabaseClient> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: E2E_STUDENT_EMAIL, password: E2E_TEST_PASSWORD });
  if (error) throw new Error(`Studenten-Anmeldung für Direktabfrage fehlgeschlagen: ${error.message}`);
  return client;
}

/** Arbeiter-eigene Anfragen-Sektion auf `/schichtplan` — siehe Kopfkommentar (Scoping-Grund). */
function changeSectionOf(page: import("@playwright/test").Page) {
  return page.locator("section").filter({ hasText: "Änderung beantragen" });
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

  const { data: tenantRow } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  await admin.from("tenants").update({ settings: { ...settings, shift_calendar_enabled: true } }).eq("id", tenantId);

  const { data: worker, error: workerError } = await admin
    .from("calendar_workers")
    .insert({ tenant_id: tenantId, membership_id: studentMembershipId, user_id: studentUserId, worker_type: "employee" })
    .select("id")
    .single();
  if (workerError || !worker) throw new Error(`Arbeiterzeile konnte nicht angelegt werden: ${workerError?.message}`);
  workerId = worker.id as string;

  const { data: secondWorker, error: secondWorkerError } = await admin
    .from("calendar_workers")
    .insert({ tenant_id: tenantId, membership_id: staffMembershipId, user_id: staffUserId, worker_type: "employee" })
    .select("id")
    .single();
  if (secondWorkerError || !secondWorker) {
    throw new Error(`Zweite Arbeiterzeile konnte nicht angelegt werden: ${secondWorkerError?.message}`);
  }
  secondWorkerId = secondWorker.id as string;

  const { data: project, error: projectError } = await admin
    .from("calendar_projects")
    .insert({ tenant_id: tenantId, name: projectName })
    .select("id")
    .single();
  if (projectError || !project) throw new Error(`Projekt konnte nicht angelegt werden: ${projectError?.message}`);
  projectId = project.id as string;

  await admin.from("calendar_project_members").insert([
    { tenant_id: tenantId, project_id: projectId, worker_id: workerId },
    { tenant_id: tenantId, project_id: projectId, worker_id: secondWorkerId },
  ]);
});

test.afterAll(async () => {
  if (projectId) {
    await admin.from("calendar_shift_change_requests").delete().eq("tenant_id", tenantId);
    await admin.from("calendar_shifts").delete().eq("project_id", projectId);
    await admin.from("calendar_project_members").delete().eq("project_id", projectId);
    await admin.from("calendar_projects").delete().eq("id", projectId);
  }
  if (workerId) await admin.from("calendar_workers").delete().eq("id", workerId);
  if (secondWorkerId) await admin.from("calendar_workers").delete().eq("id", secondWorkerId);

  const { data: tenantRow } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  await admin.from("tenants").update({ settings: { ...settings, shift_calendar_enabled: false } }).eq("id", tenantId);
});

test("Fall 1 — Admin legt Schicht an; Arbeiter sieht sie unter 'Änderung beantragen' mit beiden aktiven Knöpfen", async ({
  page,
  browser,
}) => {
  await page.goto(tenantUrl("/admin/schichtplanung?tab=shifts"));
  const addButtonPattern = new RegExp("^Schicht für E2E Student am ");
  await page.getByRole("button", { name: addButtonPattern }).first().click();
  await expect(page.getByRole("heading", { name: "Schicht anlegen" })).toBeVisible();
  await page.getByLabel("Projekt (optional)").selectOption({ label: projectName });
  await page.getByRole("button", { name: "Schicht anlegen" }).click();

  const shiftButton = page.getByRole("button", { name: new RegExp(`E2E Student, .*08:00 bis 16:00 Uhr, Projekt ${projectName}`) });
  await expect(shiftButton).toBeVisible({ timeout: 15000 });

  const { data: shiftRow, error } = await admin
    .from("calendar_shifts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("worker_id", workerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !shiftRow) throw new Error(`Schicht (Fall 1) nicht gefunden: ${error?.message}`);
  shiftId = shiftRow.id as string;

  const studentContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const studentPage = await studentContext.newPage();
  try {
    await studentPage.goto(tenantUrl("/schichtplan"));
    await expect(studentPage.getByRole("heading", { name: "Änderung beantragen" })).toBeVisible();
    const listItem = changeSectionOf(studentPage).locator("li").filter({ hasText: projectName });
    await expect(listItem.getByRole("button", { name: "Zeit ändern" })).toBeEnabled({ timeout: 15000 });
    await expect(listItem.getByRole("button", { name: "Stornieren" })).toBeEnabled();
  } finally {
    await studentContext.close();
  }
});

test("Fall 2 — Arbeiter stellt 'Zeit ändern'-Anfrage; danach sind beide Knöpfe deaktiviert und ein Hinweistext sichtbar", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/schichtplan"));
    const section = changeSectionOf(page);
    const listItem = section.locator("li").filter({ hasText: projectName });
    await listItem.getByRole("button", { name: "Zeit ändern" }).click();
    await expect(section.getByRole("heading", { name: "Zeitänderung beantragen" })).toBeVisible();

    await section.getByLabel("Neue Startzeit", { exact: true }).fill("09:00");
    await section.getByLabel("Neue Endzeit", { exact: true }).fill("17:00");
    await section.getByLabel("Begründung (optional)").fill("Arzttermin");
    await section.getByRole("button", { name: "Anfrage senden" }).click();

    await expect(listItem.getByText("Für diese Schicht liegt bereits eine offene Anfrage vor.")).toBeVisible({ timeout: 15000 });
    await expect(listItem.getByRole("button", { name: "Zeit ändern" })).toBeDisabled();
    await expect(listItem.getByRole("button", { name: "Stornieren" })).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("Fall 3 — Zweiter Direkt-Insert derselben Anfrage scheitert an 23505 (ein offener Antrag je Schicht)", async () => {
  const studentClient = await signInAsStudent();
  try {
    const { error } = await studentClient.from("calendar_shift_change_requests").insert({
      tenant_id: tenantId,
      shift_id: shiftId,
      worker_id: workerId,
      kind: "update",
      proposed_starts_at: new Date().toISOString(),
      proposed_ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      proposed_break_minutes: 0,
      status: "pending",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");
  } finally {
    await studentClient.auth.signOut({ scope: "local" });
  }
});

test("Fall 4 — Direkt-Insert des Studenten für die Schicht eines ANDEREN Arbeiters wird abgelehnt (42501, calendar_may_request_change())", async () => {
  const { data: otherShift, error: otherShiftError } = await admin
    .from("calendar_shifts")
    .insert({
      tenant_id: tenantId,
      worker_id: secondWorkerId,
      project_id: projectId,
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      ends_at: new Date(Date.now() + 86_400_000 + 3_600_000).toISOString(),
      break_minutes: 0,
      status: "planned",
      source: "admin",
    })
    .select("id")
    .single();
  if (otherShiftError || !otherShift) throw new Error(`Zweite Schicht (Fall 4) konnte nicht angelegt werden: ${otherShiftError?.message}`);

  const studentClient = await signInAsStudent();
  try {
    const { error } = await studentClient.from("calendar_shift_change_requests").insert({
      tenant_id: tenantId,
      shift_id: otherShift.id,
      worker_id: workerId,
      kind: "cancel",
      status: "pending",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  } finally {
    await studentClient.auth.signOut({ scope: "local" });
    await admin.from("calendar_shifts").delete().eq("id", otherShift.id);
  }
});

test("Fall 5 — Admin öffnet 'Änderungsanfragen', sieht Arbeitername/Zeiten/Begründung, genehmigt mit Notiz — Schicht umgeschrieben, Anfrage 'approved'", async ({
  page,
}) => {
  await page.goto(tenantUrl("/admin/schichtplanung?tab=requests"));
  await expect(page.getByRole("heading", { name: "Änderungsanfragen" })).toBeVisible();

  const toggle = page.getByRole("button", { name: /E2E Student/ }).first();
  await toggle.click();
  await expect(page.getByText("Arzttermin")).toBeVisible();

  await page.getByLabel("Entscheidungsnotiz (optional)").fill("Passt, gute Besserung.");
  await page.getByRole("button", { name: "Genehmigen", exact: true }).click();

  // Standardfilter ist "Offen" — nach Genehmigung verschwindet die Zeile aus der Ansicht.
  await expect(page.getByRole("button", { name: /E2E Student/ })).toHaveCount(0, { timeout: 15000 });

  const { data: shiftRow, error } = await admin.from("calendar_shifts").select("starts_at, status").eq("id", shiftId).single();
  if (error || !shiftRow) throw new Error(`Schicht nach Genehmigung (Fall 5) nicht lesbar: ${error?.message}`);
  const startHour = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(
    new Date(shiftRow.starts_at as string),
  );
  // Node/ICU hängt an ein reines "hour: 2-digit"-Format in de-DE zusätzlich
  // " Uhr" an (versionsabhängig) — nur die Ziffern vergleichen, nicht den
  // exakten String.
  expect(startHour.replace(/\D/g, "")).toBe("09");
  expect(shiftRow.status).toBe("planned");

  const { data: requestRow } = await admin
    .from("calendar_shift_change_requests")
    .select("status")
    .eq("shift_id", shiftId)
    .eq("kind", "update")
    .single();
  expect(requestRow?.status).toBe("approved");
});

test("Fall 6 — Konfliktfall: Genehmigung schlägt bei Zeitüberschneidung sichtbar fehl und Anfrage bleibt offen; nach Stornierung der blockierenden Schicht gelingt die erneute Genehmigung", async ({
  page,
  browser,
}) => {
  // Blockierende zweite Schicht am selben Tag: 18:00-20:00 Uhr.
  await page.goto(tenantUrl("/admin/schichtplanung?tab=shifts"));
  const addButtonPattern = new RegExp("^Schicht für E2E Student am ");
  await page.getByRole("button", { name: addButtonPattern }).first().click();
  await expect(page.getByRole("heading", { name: "Schicht anlegen" })).toBeVisible();
  await page.getByLabel("Von", { exact: true }).fill("18:00");
  await page.getByLabel("Bis", { exact: true }).fill("20:00");
  await page.getByLabel("Projekt (optional)").selectOption({ label: projectName });
  await page.getByRole("button", { name: "Schicht anlegen" }).click();

  const blockingShiftButton = page.getByRole("button", {
    name: new RegExp(`E2E Student, .*18:00 bis 20:00 Uhr, Projekt ${projectName}`),
  });
  await expect(blockingShiftButton).toBeVisible({ timeout: 15000 });

  // Arbeiter beantragt für die Schicht aus Fall 1/5 (aktuell 09:00-17:00) eine Verschiebung genau in die Blockzeit.
  const studentContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const studentPage = await studentContext.newPage();
  try {
    await studentPage.goto(tenantUrl("/schichtplan"));
    const section = changeSectionOf(studentPage);
    const listItem = section.locator("li").filter({ hasText: projectName }).first();
    await listItem.getByRole("button", { name: "Zeit ändern" }).click();
    await section.getByLabel("Neue Startzeit", { exact: true }).fill("18:30");
    await section.getByLabel("Neue Endzeit", { exact: true }).fill("19:30");
    await section.getByRole("button", { name: "Anfrage senden" }).click();
    await expect(listItem.getByText("Für diese Schicht liegt bereits eine offene Anfrage vor.")).toBeVisible({ timeout: 15000 });
  } finally {
    await studentContext.close();
  }

  await page.goto(tenantUrl("/admin/schichtplanung?tab=requests"));
  const toggle = page.getByRole("button", { name: /E2E Student/ }).first();
  await toggle.click();
  await page.getByRole("button", { name: "Genehmigen", exact: true }).click();
  await expect(page.getByText(/Genehmigung nicht möglich/)).toBeVisible({ timeout: 15000 });

  const { data: shiftAfterFail } = await admin.from("calendar_shifts").select("starts_at, status").eq("id", shiftId).single();
  const hourAfterFail = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(
    new Date(shiftAfterFail!.starts_at as string),
  );
  expect(hourAfterFail.replace(/\D/g, "")).toBe("09");

  const { data: stillPending } = await admin
    .from("calendar_shift_change_requests")
    .select("status")
    .eq("shift_id", shiftId)
    .eq("status", "pending")
    .maybeSingle();
  expect(stillPending).not.toBeNull();

  // Blockierende Schicht stornieren, dann erneut genehmigen. Zurück zum
  // Reiter "Schichten" — der Button existiert nur dort, nicht im gerade
  // aktiven Reiter "Änderungsanfragen".
  await page.goto(tenantUrl("/admin/schichtplanung?tab=shifts"));
  await blockingShiftButton.click();
  await expect(page.getByRole("heading", { name: "Schicht bearbeiten" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Schicht stornieren" }).click();
  await expect(page.getByText("Storniert")).toBeVisible({ timeout: 15000 });

  await page.goto(tenantUrl("/admin/schichtplanung?tab=requests"));
  const toggleAgain = page.getByRole("button", { name: /E2E Student/ }).first();
  await toggleAgain.click();
  await page.getByRole("button", { name: "Genehmigen", exact: true }).click();
  await expect(page.getByRole("button", { name: /E2E Student/ })).toHaveCount(0, { timeout: 15000 });

  const { data: shiftAfterSuccess } = await admin.from("calendar_shifts").select("starts_at, status").eq("id", shiftId).single();
  const hourAfterSuccess = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(
    new Date(shiftAfterSuccess!.starts_at as string),
  );
  expect(hourAfterSuccess.replace(/\D/g, "")).toBe("18");
  expect(shiftAfterSuccess?.status).toBe("planned");
});

test("Fall 7 — Stornierungs-Anfrage: Genehmigung setzt Schicht auf 'cancelled'; zweite Stornierungs-Anfrage wird mit Notiz abgelehnt und die Schicht bleibt unverändert", async ({
  page,
  browser,
}) => {
  // Zwei weitere Schichten (08:00-16:00, Standardzeit) für Fall 7 anlegen.
  await page.goto(tenantUrl("/admin/schichtplanung?tab=shifts"));
  const addButtonPattern = new RegExp("^Schicht für E2E Student am ");
  await page.getByRole("button", { name: addButtonPattern }).nth(1).click();
  await expect(page.getByRole("heading", { name: "Schicht anlegen" })).toBeVisible();
  await page.getByLabel("Projekt (optional)").selectOption({ label: projectName });
  await page.getByRole("button", { name: "Schicht anlegen" }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(`E2E Student, .*08:00 bis 16:00 Uhr, Projekt ${projectName}`) }).first(),
  ).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: addButtonPattern }).nth(2).click();
  await expect(page.getByRole("heading", { name: "Schicht anlegen" })).toBeVisible();
  await page.getByLabel("Projekt (optional)").selectOption({ label: projectName });
  await page.getByRole("button", { name: "Schicht anlegen" }).click();
  // Ohne diese Wartebestätigung läuft die folgende DB-Abfrage gegen
  // Supabase, bevor der zweite Server-Action-Aufruf tatsächlich committed
  // ist (Race Condition) — die erste Anlage wurde bereits so abgesichert.
  await expect(
    page.getByRole("button", { name: new RegExp(`E2E Student, .*08:00 bis 16:00 Uhr, Projekt ${projectName}`) }),
  ).toHaveCount(2, { timeout: 15000 });

  const { data: newShifts, error } = await admin
    .from("calendar_shifts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("worker_id", workerId)
    .eq("status", "planned")
    .neq("id", shiftId)
    .order("starts_at", { ascending: true });
  if (error || !newShifts || newShifts.length < 2) {
    throw new Error(`Zwei neue Schichten (Fall 7) nicht gefunden: ${error?.message}`);
  }
  const shiftCId = newShifts[0].id as string;
  const shiftDId = newShifts[1].id as string;

  const studentContext = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const studentPage = await studentContext.newPage();
  try {
    // Stornierungs-Anfrage 1 (shiftC) — wird genehmigt.
    await studentPage.goto(tenantUrl("/schichtplan"));
    let section = changeSectionOf(studentPage);
    let cancelCandidates = section.locator("li").filter({ hasText: projectName }).filter({ hasText: "08:00" });
    await cancelCandidates.first().getByRole("button", { name: "Stornieren" }).click();
    await expect(section.getByRole("heading", { name: "Stornierung beantragen" })).toBeVisible();
    await section.getByLabel("Begründung (optional)").fill("Krank.");
    studentPage.once("dialog", (dialog) => dialog.accept());
    await section.getByRole("button", { name: "Anfrage senden" }).click();
    await expect(cancelCandidates.first().getByText("Für diese Schicht liegt bereits eine offene Anfrage vor.")).toBeVisible({
      timeout: 15000,
    });

    await page.goto(tenantUrl("/admin/schichtplanung?tab=requests"));
    await page.getByRole("button", { name: /E2E Student/ }).first().click();
    await expect(page.getByText("Krank.")).toBeVisible();
    await page.getByRole("button", { name: "Genehmigen", exact: true }).click();
    await expect(page.getByRole("button", { name: /E2E Student/ })).toHaveCount(0, { timeout: 15000 });

    const { data: shiftCRow } = await admin.from("calendar_shifts").select("status").eq("id", shiftCId).single();
    expect(shiftCRow?.status).toBe("cancelled");

    // Stornierungs-Anfrage 2 (shiftD) — wird mit Notiz abgelehnt.
    await studentPage.goto(tenantUrl("/schichtplan"));
    section = changeSectionOf(studentPage);
    cancelCandidates = section.locator("li").filter({ hasText: projectName }).filter({ hasText: "08:00" });
    await cancelCandidates.first().getByRole("button", { name: "Stornieren" }).click();
    await section.getByLabel("Begründung (optional)").fill("Doppelbuchung.");
    studentPage.once("dialog", (dialog) => dialog.accept());
    await section.getByRole("button", { name: "Anfrage senden" }).click();
    await expect(cancelCandidates.first().getByText("Für diese Schicht liegt bereits eine offene Anfrage vor.")).toBeVisible({
      timeout: 15000,
    });

    await page.goto(tenantUrl("/admin/schichtplanung?tab=requests"));
    await page.getByRole("button", { name: /E2E Student/ }).first().click();
    await page.getByLabel("Entscheidungsnotiz (optional)").fill("Bitte Kollegen fragen.");
    await page.getByRole("button", { name: "Ablehnen", exact: true }).click();
    await expect(page.getByRole("button", { name: /E2E Student/ })).toHaveCount(0, { timeout: 15000 });

    const { data: shiftDRow } = await admin.from("calendar_shifts").select("status").eq("id", shiftDId).single();
    expect(shiftDRow?.status).toBe("planned");

    await studentPage.goto(tenantUrl("/schichtplan"));
    section = changeSectionOf(studentPage);
    const decidedItem = section.locator("li").filter({ hasText: projectName }).filter({ hasText: "08:00" }).first();
    await expect(decidedItem.getByText("Abgelehnt")).toBeVisible({ timeout: 15000 });
    await expect(decidedItem.getByText("Bitte Kollegen fragen.")).toBeVisible();
  } finally {
    await studentContext.close();
  }
});

test("Fall 8 — Projektleiter-Zugang: sieht in /admin/schichtplanung NUR 'Schichten'/'Änderungsanfragen', /admin/teilnehmer verweigert Zugriff", async ({
  browser,
}) => {
  const { error: leadError } = await admin.from("calendar_projects").update({ lead_user_id: studentUserId }).eq("id", projectId);
  if (leadError) throw new Error(`lead_user_id (Fall 8) konnte nicht gesetzt werden: ${leadError.message}`);

  const context = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/admin/schichtplanung"));
    await expect(page.getByRole("button", { name: "Schichten", exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Änderungsanfragen", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Arbeiter", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Projekte", exact: true })).toHaveCount(0);

    // role="complementary", nicht "navigation" — aria-label sitzt auf dem
    // <aside>, der innere <nav> trägt kein eigenes Label (bekanntes Muster,
    // siehe PHASENSTATUS.md "Kunden Area", Abschnitt zum Locator-Bug in
    // dashboard-shell.spec.ts/admin-shell.spec.ts).
    const nav = page.getByRole("complementary", { name: "Verwaltungs-Navigation" });
    await expect(nav.getByText("Schichtplanung")).toBeVisible();
    await expect(nav.getByText("Teilnehmer")).toHaveCount(0);
    await expect(nav.getByText("Kurse")).toHaveCount(0);

    await page.goto(tenantUrl("/admin/teilnehmer"));
    await expect(page.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible({ timeout: 15000 });
  } finally {
    await context.close();
    await admin.from("calendar_projects").update({ lead_user_id: null }).eq("id", projectId);
  }
});
