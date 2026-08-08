import { test, expect, type Locator } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createE2eAdminClient, getDemoTenantId, tenantUrl } from "./helpers/test-data";
import { E2E_STUDENT_EMAIL, E2E_TEST_PASSWORD } from "./global-setup";

/**
 * "Schichtplan" Block S4 (Josips Auftrag, 08.08.2026) — KI-Schichtplanung
 * (Auslöse-Formular, Auftragsliste, Review + Übernahme). NEUE Datei —
 * `schichtplan.spec.ts` (S1)/`-s2.spec.ts` (S2)/`-s3.spec.ts` (S3) bleiben
 * UNVERÄNDERT, eigene serielle Kette.
 *
 * KEIN ECHTER CLAUDE-API-AUFRUF in diesem Spec: `startShiftPlanJob()` legt
 * nur einen `queued`-Auftrag an (Fall 3) — der eigentliche Cron-Prozess
 * (`processNextShiftPlanJob()`, ruft `callShiftPlanModel()` auf) wird NICHT
 * getriggert. Den fertigen Entwurf (Status `done` + `output.draft`) legt
 * dieser Spec direkt per Admin-Client an (Fall 4), exakt nach dem Schema aus
 * `src/lib/calendar/ai/schema.ts` (`shiftPlanOutputSchema`) — simuliert das
 * Ergebnis eines echten KI-Laufs, ohne einen zu bezahlen. Der reale
 * End-to-End-Claude-Aufruf wird EINMALIG manuell/über ein separates Skript
 * verifiziert (PHASENSTATUS.md), nicht in der CI-Testsuite.
 *
 * `signOut({ scope: "local" })` bei jedem Ad-hoc-Client (S1-Testbug darf
 * sich nicht wiederholen). Zeilen-Locator: die Review-Tabelle hat pro Zeile
 * dieselben Spalten-`aria-label`s ("Datum"/"Von"/"Bis"/"Pause (Min.)") —
 * mehrdeutig bei mehreren Zeilen, deshalb IMMER über
 * `page.locator("table tbody tr").nth(i)` scopen, nie ungescopt `getByLabel`.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: "e2e/.auth/staff.json" });

let admin: SupabaseClient;
let tenantId: string;
let studentUserId: string;
let studentMembershipId: string;
let workerId: string; // E2E Student
let projectId: string;
let jobId: string;
const projectName = `E2E S4 Projekt ${Date.now()}`;
const rowAId = "11111111-1111-4111-8111-111111111111"; // konfliktfrei
const rowBId = "22222222-2222-4222-8222-222222222222"; // blockiert durch die real angelegte 15:00-16:00-Schicht (siehe beforeAll)

/**
 * Setzt den Wert eines React-kontrollierten `<input type="time">` verlässlich.
 * `.fill()`/`.pressSequentially()` sind bei diesem segmentierten Chromium-
 * Steuerelement in dieser Umgebung nachweislich flackrig (reproduzierbar
 * beobachtet: der neue Wert wird zwar kurz im DOM sichtbar, springt aber vor
 * dem nächsten Render wieder auf den alten React-State-Wert zurück, weil das
 * native Input-Event nicht zuverlässig bei React ankommt). Fix: Wert über
 * den NATIVEN Value-Setter von `HTMLInputElement` schreiben (umgeht Reacts
 * eigenen, vom internen Fiber-Wert getrackten Setter) und danach ein
 * echtes `input`-Event auslösen — Standard-Workaround für React-kontrollierte
 * Formularfelder in Browser-Automatisierung.
 */
async function setControlledTimeValue(locator: Locator, value: string) {
  await locator.evaluate((el: HTMLInputElement, val: string) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    nativeSetter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

function berlinIsoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(d);
}
const planDate = berlinIsoDate(10);

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

  const { data: studentMembership } = await admin
    .from("memberships")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", studentUserId)
    .single();
  studentMembershipId = studentMembership!.id as string;

  // Sauberer Ausgangszustand, falls ein vorheriger Lauf abgebrochen wurde.
  await admin.from("calendar_workers").delete().eq("tenant_id", tenantId).eq("user_id", studentUserId);
  await admin.from("calendar_projects").delete().eq("tenant_id", tenantId).eq("name", projectName);
  await admin.from("ai_jobs").delete().eq("tenant_id", tenantId).eq("kind", "shift_plan");
  // `startShiftPlanJob()` limitiert auf 5 Anfragen/Stunde/Mandant
  // (`checkRateLimit("ki-shift-plan", ...)`) — Zähler vor diesem Lauf
  // zurücksetzen, damit wiederholte lokale Testläufe (oder CI-Retries
  // innerhalb derselben Stunde) nicht an einem Rest-Zähler aus einem
  // vorherigen Lauf scheitern.
  await admin.from("rate_limits").delete().eq("key", `ki-shift-plan:${tenantId}`);

  const { data: tenantRow } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  await admin.from("tenants").update({ settings: { ...settings, shift_calendar_enabled: true } }).eq("id", tenantId);

  const { data: worker, error: workerError } = await admin
    .from("calendar_workers")
    .insert({
      tenant_id: tenantId,
      membership_id: studentMembershipId,
      user_id: studentUserId,
      worker_type: "employee",
      target_hours: 20,
      target_period: "week",
    })
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

  // Reale, bereits existierende Schicht 15:00-16:00 — blockiert Entwurfszeile B (14:30-17:00) absichtlich.
  const { error: conflictShiftError } = await admin.from("calendar_shifts").insert({
    tenant_id: tenantId,
    worker_id: workerId,
    project_id: projectId,
    starts_at: new Date(`${planDate}T15:00:00+02:00`).toISOString(),
    ends_at: new Date(`${planDate}T16:00:00+02:00`).toISOString(),
    break_minutes: 0,
    status: "planned",
    source: "admin",
  });
  if (conflictShiftError) throw new Error(`Blockierende Schicht konnte nicht angelegt werden: ${conflictShiftError.message}`);
});

test.afterAll(async () => {
  if (jobId) await admin.from("ai_jobs").delete().eq("id", jobId);
  if (projectId) {
    await admin.from("calendar_shifts").delete().eq("project_id", projectId);
    await admin.from("calendar_project_members").delete().eq("project_id", projectId);
    await admin.from("calendar_projects").delete().eq("id", projectId);
  }
  if (workerId) await admin.from("calendar_workers").delete().eq("id", workerId);

  const { data: tenantRow } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  await admin.from("tenants").update({ settings: { ...settings, shift_calendar_enabled: false } }).eq("id", tenantId);
});

test("Fall 1 — Projektleiter sieht den Reiter 'KI-Planung' nicht; direkter Query-Parameter '?tab=ki' fällt auf 'Schichten' zurück", async ({
  browser,
}) => {
  const { error: leadError } = await admin.from("calendar_projects").update({ lead_user_id: studentUserId }).eq("id", projectId);
  if (leadError) throw new Error(`lead_user_id (Fall 1) konnte nicht gesetzt werden: ${leadError.message}`);

  const context = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/admin/schichtplanung"));
    await expect(page.getByRole("button", { name: "Schichten", exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "KI-Planung", exact: true })).toHaveCount(0);

    await page.goto(tenantUrl("/admin/schichtplanung?tab=ki"));
    await expect(page.getByRole("button", { name: "Schichten", exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("heading", { name: "KI-Planung" })).toHaveCount(0);
  } finally {
    await context.close();
    await admin.from("calendar_projects").update({ lead_user_id: null }).eq("id", projectId);
  }
});

test("Fall 2 — Nicht-Mitglied (Student ohne Projektleitung) hat auf /admin/schichtplanung überhaupt keinen Zugriff", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/admin/schichtplanung?tab=ki"));
    await expect(page.getByText(/Kein Zugriff|nicht berechtigt|keine Berechtigung/).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("heading", { name: "KI-Planung" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("Fall 3 — Admin: leerer Zustand, Formular erfordert Projekt + mind. einen Arbeiter; Start erzeugt einen 'queued'-Auftrag", async ({
  page,
}) => {
  await page.goto(tenantUrl("/admin/schichtplanung?tab=ki"));
  await expect(page.getByRole("heading", { name: "KI-Planung" })).toBeVisible();
  await expect(page.getByText("Noch keine KI-Läufe gestartet.")).toBeVisible();

  await page.getByLabel("Projekt", { exact: true }).selectOption({ label: projectName });
  await expect(page.getByLabel("E2E Student", { exact: true })).toBeChecked();

  await page.getByRole("button", { name: "Vorschlag erzeugen" }).click();

  const jobRow = page.locator("ul li").filter({ hasText: projectName }).first();
  await expect(jobRow.getByText("In Arbeit")).toBeVisible({ timeout: 15000 });

  const { data: jobRowDb, error } = await admin
    .from("ai_jobs")
    .select("id, status, input")
    .eq("tenant_id", tenantId)
    .eq("kind", "shift_plan")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !jobRowDb) throw new Error(`Auftrag (Fall 3) nicht in der DB gefunden: ${error?.message}`);
  jobId = jobRowDb.id as string;
  expect(jobRowDb.status).toBe("queued");
  // Datenminimierung: workerIds sind UUIDs, kein Klarname/keine E-Mail im gespeicherten Input.
  const inputJson = JSON.stringify(jobRowDb.input);
  expect(inputJson).not.toMatch(/E2E Student|@/);
});

test("Fall 4 — (Lauf simuliert) Auftrag auf 'done' mit zwei Entwurfszeilen gesetzt; Review zeigt Arbeitername, Konfliktbadge und Stunden-Soll", async ({
  page,
}) => {
  const draft = {
    rows: [
      { id: rowAId, workerId, date: planDate, startTime: "09:00", endTime: "12:00", breakMinutes: 0, conflict: null },
      { id: rowBId, workerId, date: planDate, startTime: "14:30", endTime: "17:00", breakMinutes: 0, conflict: "overlap" },
    ],
    notes: "Testlauf ohne echten KI-Aufruf.",
  };
  const { error } = await admin.from("ai_jobs").update({ status: "done", output: { draft, appliedRowIds: [] } }).eq("id", jobId);
  if (error) throw new Error(`Entwurf (Fall 4) konnte nicht gesetzt werden: ${error.message}`);

  await page.goto(tenantUrl("/admin/schichtplanung?tab=ki"));
  const jobRow = page.locator("ul li").filter({ hasText: projectName }).first();
  await expect(jobRow.getByText("Zu prüfen")).toBeVisible({ timeout: 15000 });
  await jobRow.getByRole("button", { name: "Öffnen" }).click();

  await expect(page.getByRole("heading", { name: "KI-Vorschlag prüfen" })).toBeVisible();
  await expect(page.getByText("2 vorgeschlagene Schichten")).toBeVisible();
  await expect(page.getByText("Testlauf ohne echten KI-Aufruf.")).toBeVisible();
  await expect(page.getByText(/E2E Student: 5[.,]5 Std\./)).toBeVisible();
  await expect(page.getByText(/Soll: 20 Std\. pro Woche/)).toBeVisible();

  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Überschneidung mit bestehender Schicht");
});

test("Fall 5 — Übernahme: Zeile A (konfliktfrei) gelingt und wird zu einer echten Schicht; Zeile B scheitert an der realen Überschneidung", async ({
  page,
}) => {
  await page.goto(tenantUrl(`/admin/schichtplanung?tab=ki&job=${jobId}`));
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(2);

  // Zeile B abwählen — nur Zeile A wird in diesem Durchgang übernommen.
  await rows.nth(1).getByRole("checkbox").uncheck();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Ausgewählte übernehmen" }).click();

  await expect(page.getByText("1 Schicht übernommen")).toBeVisible({ timeout: 15000 });
  await expect(rows.nth(0).getByText("Bereits übernommen")).toBeVisible();

  const { data: created, error } = await admin
    .from("calendar_shifts")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("worker_id", workerId)
    .eq("source", "ai")
    .maybeSingle();
  if (error || !created) throw new Error(`Übernommene Schicht (Fall 5) nicht gefunden: ${error?.message}`);
  expect(created.status).toBe("planned");

  // Zeile B jetzt (noch mit der konfliktbehafteten Zeit) übernehmen — muss serverseitig scheitern.
  await rows.nth(1).getByRole("checkbox").check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Ausgewählte übernehmen" }).click();
  await expect(rows.nth(1).getByText("Diese Zeit überschneidet sich mit einer bestehenden Schicht.")).toBeVisible({ timeout: 15000 });
});

test("Fall 6 — Nach Zeitkorrektur der zuvor gescheiterten Zeile B gelingt die erneute Übernahme", async ({ page }) => {
  await page.goto(tenantUrl(`/admin/schichtplanung?tab=ki&job=${jobId}`));
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(2);

  // Nur "Bis" korrigieren (14:30 bleibt unverändert): [14:30, 15:00) berührt
  // die blockierende Schicht [15:00, 16:00) nur an der Grenze, überlappt
  // aber nicht (`tstzrange`-Standardgrenzen sind `[)`). Siehe
  // `setControlledTimeValue()`-Kommentar zur Begründung des Ansatzes.
  const bisInput = rows.nth(1).getByLabel("Bis", { exact: true });
  await setControlledTimeValue(bisInput, "15:00");
  await expect(bisInput).toHaveValue("15:00");
  await rows.nth(1).getByRole("checkbox").check();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Ausgewählte übernehmen" }).click();

  await expect(page.getByText("1 Schicht übernommen")).toBeVisible({ timeout: 15000 });
  await expect(rows.nth(1).getByText("Bereits übernommen")).toBeVisible();

  const { data: createdRows, error } = await admin
    .from("calendar_shifts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("worker_id", workerId)
    .eq("source", "ai");
  if (error) throw new Error(`Übernommene Schichten (Fall 6) nicht lesbar: ${error.message}`);
  expect(createdRows).toHaveLength(2);
});

test("Fall 7 — Löschen des Auftrags entfernt ihn aus der Liste; die bereits übernommenen echten Schichten bleiben bestehen", async ({
  page,
}) => {
  await page.goto(tenantUrl("/admin/schichtplanung?tab=ki"));
  const jobRow = page.locator("ul li").filter({ hasText: projectName }).first();
  page.once("dialog", (dialog) => dialog.accept());
  await jobRow.getByRole("button", { name: "Löschen" }).click();

  await expect(page.locator("ul li").filter({ hasText: projectName })).toHaveCount(0, { timeout: 15000 });

  const { data: jobAfterDelete } = await admin.from("ai_jobs").select("id").eq("id", jobId).maybeSingle();
  expect(jobAfterDelete).toBeNull();
  jobId = ""; // afterAll soll nicht erneut versuchen zu löschen.

  const { data: shiftsAfterDelete, error } = await admin
    .from("calendar_shifts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("worker_id", workerId)
    .eq("source", "ai");
  if (error) throw new Error(`Schichten nach Auftragslöschung (Fall 7) nicht lesbar: ${error.message}`);
  expect(shiftsAfterDelete).toHaveLength(2);
});

test("Fall 8 — Direkt-Insert eines fremden Kontos in ai_jobs (kind='shift_plan') wird von RLS abgelehnt (kein INSERT für Nicht-Staff)", async () => {
  const studentClient = await signInAsStudent();
  try {
    const { error } = await studentClient.from("ai_jobs").insert({
      tenant_id: tenantId,
      kind: "shift_plan",
      status: "queued",
      input: { projectId, fromDate: planDate, toDate: planDate, workerIds: [workerId] },
      output: {},
    });
    expect(error).not.toBeNull();
  } finally {
    await studentClient.auth.signOut({ scope: "local" });
  }
});

test("Fall 9 — Rolle 'trainer' (is_staff()=true, aber kein Admin) wird für kind='shift_plan' per RLS abgelehnt (Sicherheitsfund HOCH, security-reviewer 08.08.2026)", async () => {
  // `is_staff()` schließt 'trainer' ein — vor der Fix-Migration
  // `20260808061159_shift_calendar_s4_ai_jobs_scope_fix.sql` hätte ein
  // Trainer per Direkt-Client einen shift_plan-Auftrag anlegen ODER
  // bestehende Aufträge lesen können, obwohl `actions.ts` Trainer/
  // Projektleiter bewusst ausschließt (nur App-Ebene, keine RLS). Dieser
  // Fall testet genau die Lücke, die Fall 8 (Rolle 'member') nicht abdeckt.
  const { error: roleError } = await admin
    .from("memberships")
    .update({ role: "trainer" })
    .eq("tenant_id", tenantId)
    .eq("user_id", studentUserId);
  if (roleError) throw new Error(`Rolle 'trainer' (Fall 9) konnte nicht gesetzt werden: ${roleError.message}`);

  const { data: seededJob, error: seedError } = await admin
    .from("ai_jobs")
    .insert({ tenant_id: tenantId, kind: "shift_plan", status: "done", input: {}, output: {} })
    .select("id")
    .single();
  if (seedError || !seededJob) throw new Error(`Test-Auftrag (Fall 9) konnte nicht angelegt werden: ${seedError?.message}`);

  const trainerClient = await signInAsStudent();
  try {
    const { error: insertError } = await trainerClient.from("ai_jobs").insert({
      tenant_id: tenantId,
      kind: "shift_plan",
      status: "queued",
      input: { projectId, fromDate: planDate, toDate: planDate, workerIds: [workerId] },
      output: {},
    });
    expect(insertError).not.toBeNull();

    const { data: visibleJobs, error: selectError } = await trainerClient
      .from("ai_jobs")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("kind", "shift_plan");
    expect(selectError).toBeNull();
    expect(visibleJobs).toHaveLength(0);
  } finally {
    await trainerClient.auth.signOut({ scope: "local" });
    await admin.from("ai_jobs").delete().eq("id", seededJob.id);
    await admin.from("memberships").update({ role: "member" }).eq("tenant_id", tenantId).eq("user_id", studentUserId);
  }
});
