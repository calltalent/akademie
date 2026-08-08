import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createE2eAdminClient, getDemoTenantId, tenantUrl } from "./helpers/test-data";
import { E2E_STUDENT_EMAIL, E2E_TEST_PASSWORD } from "./global-setup";

/**
 * "Schichtplan" Block S5c (Josips Auftrag, 08.08.2026) — KI-Feiertagsrecherche
 * (Mandanten-Einstellung "Feiertagsregionen", Auslöse-Formular/Auftragsliste,
 * Review + Übernahme im Abwesenheiten-Reiter). NEUE Datei — `schichtplan.
 * spec.ts` (S1)/`-s2.spec.ts` (S2)/`-s3.spec.ts` (S3)/`-s4.spec.ts` (S4)
 * bleiben UNVERÄNDERT, eigene serielle Kette.
 *
 * KEIN ECHTER CLAUDE-API-AUFRUF in diesem Spec: `startHolidayResearchJob()`
 * legt nur einen `queued`-Auftrag an (Fall 4) — der eigentliche Cron-Prozess
 * (`processNextHolidayResearchJob()`) wird NICHT getriggert. Den fertigen
 * Entwurf (Status `done` + `output.draft`) legt dieser Spec direkt per
 * Admin-Client an (Fall 5), nach `holidayResearchOutputSchema`
 * (`src/lib/calendar/ai/holidays/schema.ts`) — simuliert das Ergebnis eines
 * echten KI-Laufs, ohne einen zu bezahlen. Der reale End-to-End-Claude-
 * Aufruf ist bereits einmalig manuell verifiziert (PHASENSTATUS.md,
 * "Schichtplan — Block S5b: realer KI-Testlauf").
 *
 * `signOut({ scope: "local" })` bei jedem Ad-hoc-Client (S1-Testbug darf sich
 * nicht wiederholen, siehe Kommentar in allen bisherigen Schichtplan-Specs).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: "e2e/.auth/staff.json" });

let admin: SupabaseClient;
let tenantId: string;
let studentUserId: string;
let jobId: string;

const YEAR = 2099; // Weit in der Zukunft, kollidiert nicht mit echten Feiertagsdaten anderer Specs.
const EXISTING_MARKER = "E2E S5 Bestandsfeiertag";
const APPLIED_MARKER = "Dan državnosti";

// Vier feste, zodkonforme UUIDs (Version 4, Variante 8) — gleiches Muster
// wie die hartkodierten Zeilen-IDs in schichtplan-s4.spec.ts.
const rowHrFreeId = "aaaaaaaa-1111-4111-8111-111111111111"; // HR, konfliktfrei
const rowBaRsDuplicateId = "bbbbbbbb-2222-4111-8111-222222222222"; // BA_RS, selbes Datum wie rowHrFree -> duplicate
const rowHrExistingId = "cccccccc-3333-4111-8111-333333333333"; // HR, Datum bereits als calendar_absences vorhanden -> existing
const rowDeUnverifiedId = "dddddddd-4444-4111-8111-444444444444"; // DE, nicht in buildHolidays() -> unverified

/**
 * Der Abwesenheiten-Reiter zeigt ZWEI verschiedene `<ul><li>`-Listen
 * gleichzeitig: die Liste bestehender Feiertage (`calendar_absences`,
 * `region "Feiertage"`, zeigt Daten wie "2099-01-01" — enthält also
 * ebenfalls die Jahreszahl als Substring) und die KI-Auftragsliste
 * (`calendar-holidays-ki-panel.tsx`). Ein ungescopter `page.locator("ul
 * li").filter({hasText: YEAR})` trifft zuerst die FALSCHE, bestehende Liste
 * (DOM-Reihenfolge: Feiertage-Liste steht vor der KI-Karte) — bekannte
 * Fehlerklasse, bereits in `schichtplan-s2.spec.ts`/`-s4.spec.ts`
 * dokumentiert. Fix: auf den Bereich unterhalb der KI-Überschrift scopen.
 */
function kiPanelSection(page: import("@playwright/test").Page) {
  // `ancestor::div[2]`, nicht `[1]`: die Überschrift steckt in
  // `calendar-holidays-ki-panel.tsx` in einem inneren `<div>` (nur
  // Überschrift+Beschreibung) — erst der ÜBERNÄCHSTE `<div>` ist der
  // äußere Container, der auch die Auftragsliste (`<ul><li>`) enthält.
  return page.getByRole("heading", { name: "Feiertage per KI recherchieren" }).locator("xpath=ancestor::div[2]");
}

async function signInAsStudent(): Promise<SupabaseClient> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: E2E_STUDENT_EMAIL, password: E2E_TEST_PASSWORD });
  if (error) throw new Error(`Studenten-Anmeldung für Direktabfrage fehlgeschlagen: ${error.message}`);
  return client;
}

async function setTenantSettings(patch: Record<string, unknown>): Promise<void> {
  const { data: tenantRow } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  await admin.from("tenants").update({ settings: { ...settings, ...patch } }).eq("id", tenantId);
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

  // Sauberer Ausgangszustand, falls ein vorheriger Lauf abgebrochen wurde.
  await admin.from("ai_jobs").delete().eq("tenant_id", tenantId).eq("kind", "holiday_research");
  await admin
    .from("calendar_absences")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("kind", "holiday")
    .or(`note.ilike.%${EXISTING_MARKER}%,note.ilike.%${APPLIED_MARKER}%`);
  // `startHolidayResearchJob()` limitiert auf 3 Anfragen/Tag/Mandant
  // (`checkRateLimit("ki-holidays", ...)`) — Zähler vor diesem Lauf
  // zurücksetzen (gleiches Muster wie `ki-shift-plan` in schichtplan-s4.spec.ts).
  await admin.from("rate_limits").delete().eq("key", `ki-holidays:${tenantId}`);

  // Fall 1 braucht den Schichtplan explizit DEAKTIVIERT und keine Region
  // gewählt — unabhängig davon, welchen Zustand ein vorheriger Spec-Lauf
  // hinterlassen hat.
  await setTenantSettings({ shift_calendar_enabled: false, shift_calendar_holiday_regions: [] });

  // Realer Bestandsfeiertag für den "existing"-Konflikt in Fall 5/6.
  const { error: existingError } = await admin.from("calendar_absences").insert({
    tenant_id: tenantId,
    worker_id: null,
    kind: "holiday",
    starts_on: `${YEAR}-01-01`,
    ends_on: `${YEAR}-01-01`,
    note: EXISTING_MARKER,
    status: "approved",
  });
  if (existingError) throw new Error(`Bestandsfeiertag konnte nicht angelegt werden: ${existingError.message}`);
});

test.afterAll(async () => {
  if (jobId) await admin.from("ai_jobs").delete().eq("id", jobId);
  await admin
    .from("calendar_absences")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("kind", "holiday")
    .or(`note.ilike.%${EXISTING_MARKER}%,note.ilike.%${APPLIED_MARKER}%`);
  await setTenantSettings({ shift_calendar_enabled: false, shift_calendar_holiday_regions: [] });
  await admin.from("memberships").update({ role: "member" }).eq("tenant_id", tenantId).eq("user_id", studentUserId);
});

test("Fall 1 — Einstellungen: Karte 'Feiertagsregionen' ist unsichtbar, solange shift_calendar_enabled false ist", async ({ page }) => {
  await page.goto(tenantUrl("/admin/einstellungen"));
  await expect(page.getByRole("heading", { name: "Einstellungen", exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Feiertagsregionen")).toHaveCount(0);
});

test("Fall 2 — Nach Aktivierung: Karte sichtbar, Auswahl HR + BA_RS gespeichert, Neuladen zeigt beide Haken; MERGE-Nachweis in der DB", async ({
  page,
}) => {
  await setTenantSettings({ shift_calendar_enabled: true });

  const { data: tenantBefore } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settingsBefore = (tenantBefore?.settings ?? {}) as Record<string, unknown>;

  await page.goto(tenantUrl("/admin/einstellungen"));
  await expect(page.getByText("Feiertagsregionen")).toBeVisible({ timeout: 15000 });

  // Die Seite hat ZWEI Formulare mit einem "Speichern"-Button (die
  // allgemeine `TenantSettingsForm` UND diese neue Karte) — Button-Klick
  // deshalb über das umschließende <form> der Regionscheckbox skopiert,
  // statt global mehrdeutig nach "Speichern" zu suchen.
  const holidayRegionsForm = page.getByLabel("Kroatien", { exact: true }).locator("xpath=ancestor::form[1]");
  await page.getByLabel("Kroatien", { exact: true }).check();
  await page.getByLabel("Bosnien und Herzegowina — Republika Srpska", { exact: true }).check();
  await holidayRegionsForm.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert.")).toBeVisible({ timeout: 15000 });

  await page.reload();
  await expect(page.getByLabel("Kroatien", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Bosnien und Herzegowina — Republika Srpska", { exact: true })).toBeChecked();

  const { data: tenantAfter } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settingsAfter = (tenantAfter?.settings ?? {}) as Record<string, unknown>;
  const { shift_calendar_holiday_regions: regionsAfter, ...restAfter } = settingsAfter;
  const restBefore = { ...settingsBefore };
  delete restBefore.shift_calendar_holiday_regions;
  expect((regionsAfter as string[]).slice().sort()).toEqual(["BA_RS", "HR"]);
  // MERGE-Nachweis: jedes andere settings-Feld bleibt unangetastet.
  expect(restAfter).toEqual(restBefore);
});

test("Fall 3 — Abwesenheiten-Reiter mit leerer Regionsauswahl: Auslöse-Formular fehlt, Hinweistext + Link zu den Einstellungen sichtbar", async ({
  page,
}) => {
  // Regionen für diesen einen Fall gezielt (per Admin-Client) leeren — Fall 2
  // hat sie bereits über die echte UI gesetzt, Fall 4 stellt sie unten wieder
  // her. So bleibt jeder Fall unabhängig prüfbar, ohne den UI-Speicherpfad
  // ein zweites Mal durchlaufen zu müssen.
  await setTenantSettings({ shift_calendar_holiday_regions: [] });

  await page.goto(tenantUrl(`/admin/schichtplanung?tab=absences&year=${YEAR}`));
  await expect(page.getByText("Für diese Akademie ist noch keine Region ausgewählt.")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("link", { name: "Regionen in den Einstellungen wählen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Feiertage recherchieren" })).toHaveCount(0);

  await setTenantSettings({ shift_calendar_holiday_regions: ["HR", "BA_RS"] });
});

test("Fall 4 — Mit gewählten Regionen: 'Feiertage recherchieren' erzeugt einen Auftrag mit Status 'queued'; DB-Gegenprobe auf input.regions", async ({
  page,
}) => {
  await page.goto(tenantUrl(`/admin/schichtplanung?tab=absences&year=${YEAR}`));
  await expect(page.getByRole("heading", { name: "Feiertage per KI recherchieren" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Kroatien, Bosnien und Herzegowina — Republika Srpska")).toBeVisible();

  // Einziges <input type="number"> auf dieser Seite (die Jahresauswahl oben
  // im Reiter ist ein <select>) — deshalb ohne Label-Mehrdeutigkeit direkt
  // über den Eingabetyp adressierbar.
  await page.locator('input[type="number"]').fill(String(YEAR));
  await page.getByRole("button", { name: "Feiertage recherchieren" }).click();

  const jobRow = kiPanelSection(page).locator("ul li").filter({ hasText: String(YEAR) }).first();
  await expect(jobRow.getByText("In Arbeit")).toBeVisible({ timeout: 15000 });

  const { data: jobRowDb, error } = await admin
    .from("ai_jobs")
    .select("id, status, input")
    .eq("tenant_id", tenantId)
    .eq("kind", "holiday_research")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !jobRowDb) throw new Error(`Auftrag (Fall 4) nicht in der DB gefunden: ${error?.message}`);
  jobId = jobRowDb.id as string;
  expect(jobRowDb.status).toBe("queued");
  const input = jobRowDb.input as { year: number; regions: string[] };
  expect(input.year).toBe(YEAR);
  expect(input.regions.slice().sort()).toEqual(["BA_RS", "HR"]);
});

test("Fall 5 — (Lauf simuliert) Auftrag auf 'done' mit vier Entwurfszeilen gesetzt; Review zeigt Region, Abgleich-/Konfliktbadges und Zeilenzahl", async ({
  page,
}) => {
  const sharedDate = `${YEAR}-05-30`;
  const draft = {
    rows: [
      { id: rowHrFreeId, region: "HR", date: sharedDate, name: APPLIED_MARKER, check: null, conflict: null },
      { id: rowBaRsDuplicateId, region: "BA_RS", date: sharedDate, name: "Isti datum", check: null, conflict: "duplicate" },
      {
        id: rowHrExistingId,
        region: "HR",
        date: `${YEAR}-01-01`,
        name: "Nova godina",
        check: null,
        conflict: "existing",
      },
      {
        id: rowDeUnverifiedId,
        region: "DE",
        date: `${YEAR}-07-04`,
        name: "Testfeiertag (unverifiziert)",
        check: "unverified",
        conflict: null,
      },
    ],
    notes: "Testlauf ohne echten KI-Aufruf.",
  };
  const { error } = await admin
    .from("ai_jobs")
    .update({ status: "done", output: { draft, appliedRowIds: [] } })
    .eq("id", jobId);
  if (error) throw new Error(`Entwurf (Fall 5) konnte nicht gesetzt werden: ${error.message}`);

  await page.goto(tenantUrl(`/admin/schichtplanung?tab=absences&year=${YEAR}`));
  const jobRow = kiPanelSection(page).locator("ul li").filter({ hasText: String(YEAR) }).first();
  await expect(jobRow.getByText("Zu prüfen")).toBeVisible({ timeout: 15000 });
  await jobRow.getByRole("button", { name: "Öffnen" }).click();

  await expect(page.getByRole("heading", { name: "Feiertagsvorschlag prüfen" })).toBeVisible();
  await expect(page.getByText("4 vorgeschlagene Feiertage")).toBeVisible();
  await expect(page.getByText("Testlauf ohne echten KI-Aufruf.")).toBeVisible();

  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(4);

  await expect(rows.nth(0)).toContainText("Kroatien");
  await expect(rows.nth(0)).toContainText("Für diese Region gibt es keinen festen Abgleich");
  await expect(rows.nth(0).getByRole("checkbox")).toBeChecked(); // conflict === null -> vorausgewählt

  await expect(rows.nth(1)).toContainText("Bosnien und Herzegowina — Republika Srpska");
  await expect(rows.nth(1)).toContainText("Dasselbe Datum in einer anderen Region");
  await expect(rows.nth(1).getByRole("checkbox")).not.toBeChecked(); // conflict:"duplicate" -> abgewählt

  await expect(rows.nth(2)).toContainText("Für dieses Datum ist bereits ein Feiertag eingetragen");
  await expect(rows.nth(2).getByRole("checkbox")).not.toBeChecked(); // conflict:"existing" -> abgewählt

  await expect(rows.nth(3)).toContainText("Deutschland");
  await expect(rows.nth(3)).toContainText("Nicht in der festen Liste");
  await expect(rows.nth(3).getByRole("checkbox")).toBeChecked(); // conflict === null -> vorausgewählt (check betrifft nur das Abgleich-Badge)
});

test("Fall 6 — Übernahme: die konfliktfreie HR-Zeile wird zu einer echten calendar_absences-Zeile mit Regionsbeschriftung in der Notiz", async ({
  page,
}) => {
  await page.goto(tenantUrl(`/admin/schichtplanung?tab=absences&year=${YEAR}&holidayJob=${jobId}`));
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(4);

  // Nur Zeile 0 (HR, konfliktfrei) übernehmen — Zeile 3 (DE, ebenfalls
  // konfliktfrei vorausgewählt) für diesen Durchgang abwählen, damit exakt
  // EINE Zeile entsteht (Fall 6 prüft genau diese eine Zeile).
  await rows.nth(3).getByRole("checkbox").uncheck();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Ausgewählte übernehmen" }).click();

  await expect(page.getByText("1 Feiertag übernommen")).toBeVisible({ timeout: 15000 });
  await expect(rows.nth(0).getByText("Bereits übernommen")).toBeVisible();

  const { data: created, error } = await admin
    .from("calendar_absences")
    .select("id, worker_id, kind, starts_on, ends_on, status, note")
    .eq("tenant_id", tenantId)
    .eq("kind", "holiday")
    .ilike("note", `%${APPLIED_MARKER}%`)
    .maybeSingle();
  if (error || !created) throw new Error(`Übernommener Feiertag (Fall 6) nicht gefunden: ${error?.message}`);
  expect(created.worker_id).toBeNull();
  expect(created.status).toBe("approved");
  expect(created.starts_on).toBe(`${YEAR}-05-30`);
  expect(created.note).toContain(APPLIED_MARKER);
  expect(created.note).toContain("Kroatien");
});

test("Fall 7 — Nach Neuladen bleibt die übernommene Zeile dauerhaft als 'Bereits übernommen' gesperrt; es entsteht keine zweite Zeile (Doppelklick-Schutz)", async ({
  page,
}) => {
  // Die UI verhindert einen echten zweiten Klick strukturell: sobald eine
  // Zeile lokal ODER (nach Neuladen) serverseitig als übernommen gilt, ist
  // ihre Checkbox `disabled` (siehe calendar-holidays-ki-review.tsx) — ein
  // erneutes Auswählen ist über die Oberfläche gar nicht mehr möglich. Der
  // stärkste e2e-Nachweis für den Doppelklick-Schutz ist deshalb: nach einem
  // FRISCHEN Laden (serverseitig aus `appliedRowIds` neu aufgebaut) bleibt
  // der Zustand "Bereits übernommen" bestehen UND es existiert weiterhin
  // genau eine passende DB-Zeile.
  await page.goto(tenantUrl(`/admin/schichtplanung?tab=absences&year=${YEAR}&holidayJob=${jobId}`));
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).getByText("Bereits übernommen")).toBeVisible({ timeout: 15000 });
  await expect(rows.nth(0).getByRole("checkbox")).toBeDisabled();

  const { data: createdRows, error } = await admin
    .from("calendar_absences")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("kind", "holiday")
    .ilike("note", `%${APPLIED_MARKER}%`);
  if (error) throw new Error(`Übernommene Feiertage (Fall 7) nicht lesbar: ${error.message}`);
  expect(createdRows).toHaveLength(1);
});

test("Fall 8 — Löschen des Auftrags entfernt ihn aus der Liste; die bereits übernommene Feiertagszeile bleibt bestehen", async ({ page }) => {
  await page.goto(tenantUrl(`/admin/schichtplanung?tab=absences&year=${YEAR}`));
  const jobRow = kiPanelSection(page).locator("ul li").filter({ hasText: String(YEAR) }).first();
  page.once("dialog", (dialog) => dialog.accept());
  await jobRow.getByRole("button", { name: "Löschen" }).click();

  await expect(kiPanelSection(page).locator("ul li").filter({ hasText: String(YEAR) })).toHaveCount(0, { timeout: 15000 });

  const { data: jobAfterDelete } = await admin.from("ai_jobs").select("id").eq("id", jobId).maybeSingle();
  expect(jobAfterDelete).toBeNull();
  jobId = ""; // afterAll soll nicht erneut versuchen zu löschen.

  const { data: stillThere, error } = await admin
    .from("calendar_absences")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("kind", "holiday")
    .ilike("note", `%${APPLIED_MARKER}%`)
    .maybeSingle();
  if (error) throw new Error(`Feiertag nach Auftragslöschung (Fall 8) nicht lesbar: ${error.message}`);
  expect(stillThere).not.toBeNull();
});

test("Fall 9 — RLS-Gegenprobe: Rolle 'member' und danach 'trainer' dürfen kind='holiday_research' weder per Direkt-INSERT anlegen noch per SELECT sehen", async () => {
  const seedInput = { year: YEAR, regions: ["HR"] };

  // --- Zuerst als 'member' (Ausgangsrolle des Studenten-Testkontos) -------
  const memberClient = await signInAsStudent();
  try {
    const { error: insertError } = await memberClient.from("ai_jobs").insert({
      tenant_id: tenantId,
      kind: "holiday_research",
      status: "queued",
      input: seedInput,
      output: {},
    });
    expect(insertError).not.toBeNull();

    const { data: visibleAsMember, error: selectError } = await memberClient
      .from("ai_jobs")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("kind", "holiday_research");
    expect(selectError).toBeNull();
    expect(visibleAsMember).toHaveLength(0);
  } finally {
    await memberClient.auth.signOut({ scope: "local" });
  }

  // --- Danach als 'trainer' (is_staff()=true, aber kein Admin) ------------
  const { error: roleError } = await admin
    .from("memberships")
    .update({ role: "trainer" })
    .eq("tenant_id", tenantId)
    .eq("user_id", studentUserId);
  if (roleError) throw new Error(`Rolle 'trainer' (Fall 9) konnte nicht gesetzt werden: ${roleError.message}`);

  const { data: seededJob, error: seedError } = await admin
    .from("ai_jobs")
    .insert({ tenant_id: tenantId, kind: "holiday_research", status: "done", input: {}, output: {} })
    .select("id")
    .single();
  if (seedError || !seededJob) throw new Error(`Test-Auftrag (Fall 9) konnte nicht angelegt werden: ${seedError?.message}`);

  const trainerClient = await signInAsStudent();
  try {
    const { error: insertError } = await trainerClient.from("ai_jobs").insert({
      tenant_id: tenantId,
      kind: "holiday_research",
      status: "queued",
      input: seedInput,
      output: {},
    });
    expect(insertError).not.toBeNull();

    const { data: visibleAsTrainer, error: selectError } = await trainerClient
      .from("ai_jobs")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("kind", "holiday_research");
    expect(selectError).toBeNull();
    expect(visibleAsTrainer).toHaveLength(0);
  } finally {
    await trainerClient.auth.signOut({ scope: "local" });
    await admin.from("ai_jobs").delete().eq("id", seededJob.id);
    await admin.from("memberships").update({ role: "member" }).eq("tenant_id", tenantId).eq("user_id", studentUserId);
  }
});
