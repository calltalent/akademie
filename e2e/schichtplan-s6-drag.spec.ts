import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createE2eAdminClient, getDemoTenantId, tenantUrl } from "./helpers/test-data";
import { E2E_STAFF_EMAIL, E2E_STUDENT_EMAIL } from "./global-setup";

/**
 * "Schichtplan" Block S6 (09.08.2026, Freelancer-Drag-and-Drop im
 * Wochenraster — architect-Plan `plane-und-erstelle-mit-floofy-curry.md`).
 * NEUE Datei — `schichtplan.spec.ts`/`-s2`/`-s3` bleiben UNVERÄNDERT (siehe
 * Kopfkommentar `shift-calendar-view.tsx`), diese Suite legt ein EIGENES
 * Projekt/eine eigene Freelancer-Arbeiterzeile an (Präfix "E2E S6"), damit
 * sie unabhängig von den S2/S3-Testdaten läuft und kein Locator-
 * Kollisionsrisiko trägt (`E2E Student` wird hier — anders als in S2/S3 —
 * direkt als `worker_type: "freelancer"` angelegt).
 *
 * Playwright unterstützt Pointer-Drag über `page.mouse.move/down/up` — kein
 * HTML5-Drag-and-Drop nötig, passt zum Pointer-Events-Ansatz in
 * `shift-calendar-view.tsx` (`setPointerCapture`, gleiches Muster wie
 * `video-trimmer.tsx`).
 *
 * Zeitplan der Testdaten (alle Zeiten Berlin-lokal):
 * - Zeitfenster A: heute 08:00–16:00, Kapazität 5 — Fall 1 zieht einen
 *   TEIL-Zeitraum daraus.
 * - Zeitfenster B: heute 18:00–20:00, Kapazität 1 — Fall 2 klickt (kein
 *   Zug) und bucht den GANZEN Slot.
 * - Bestehende Schicht: ein ANDERER Tag als heute, 09:00–17:00 — Fall 3
 *   zieht sie (Vorschlag, keine Direktschreibung). Bewusst ein anderer Tag
 *   als A/B, damit keine Zeitüberschneidung mit den durch Fall 1/2 neu
 *   gebuchten Schichten desselben Arbeiters entstehen kann (EXCLUDE-
 *   Constraint `calendar_shifts_no_overlap`, S1-Migration). Welcher Tag das
 *   konkret ist, bestimmt `otherDayInSameWeekIso()` unten — bewusst NICHT
 *   fest "morgen", weil das an Sonntagen (letzter Tag der Montag-Sonntag-
 *   Wochenansicht) den Tag aus der Standardansicht der Wochenansicht
 *   herausreißen würde.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: "e2e/.auth/staff.json" });

let admin: SupabaseClient;
let tenantId: string;
let studentUserId: string;
let studentMembershipId: string;
let staffUserId: string;
let staffMembershipId: string;
let workerId: string; // E2E Student — als Freelancer angelegt
let secondWorkerId: string; // E2E Staff — Fall 4 (Festangestellter, Regressionsschutz)
let projectId: string;
let slotAId: string;
let slotBId: string;
let ownShiftId: string;
const projectName = `E2E S6 Projekt ${Date.now()}`;

function todayBerlinIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(d);
}

/** ISO-Wochentag (Montag=1…Sonntag=7) einer Y-M-D-Kalenderdatumsangabe — reine Kalenderarithmetik, kein Zeitzonenbezug nötig, weil `iso` bereits ein Berlin-lokales Kalenderdatum ist (siehe `todayBerlinIso()`). Gleiche Definition wie `isoWeekday()` in `src/lib/calendar/date.ts`. */
function isoWeekdayFromDateOnly(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sonntag…6=Samstag
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Ein anderer Kalendertag als `todayIso`, aber GARANTIERT innerhalb
 * derselben Montag-bis-Sonntag-Woche (`startOfIsoWeek()` in
 * `src/lib/calendar/date.ts` — die Wochenansicht zeigt standardmäßig genau
 * diese Woche, siehe `(portal)/schichtplan/page.tsx`). Ursprünglich stand
 * hier fest "morgen" — das riss die Bestehende-Schicht-Testdaten (Fall 3)
 * aus der Standardansicht heraus, sobald der Testlauf an einem Sonntag
 * passiert (Sonntag = letzter Tag der ISO-Woche, "morgen" = Montag der
 * NÄCHSTEN Woche, siehe Fehlerbild vom 09.08.2026: Fall 3 fand den
 * Schicht-Block nicht, weil die Standardansicht die Folgewoche gar nicht
 * zeigt). Montag +1 Tag (Dienstag) bleibt in derselben Woche; jeder andere
 * Wochentag -1 Tag bleibt ebenfalls in derselben Woche (Dienstag…Sonntag
 * minus 1 Tag landet nie vor Montag).
 */
function otherDayInSameWeekIso(todayIso: string): string {
  return isoWeekdayFromDateOnly(todayIso) === 1 ? addDaysIso(todayIso, 1) : addDaysIso(todayIso, -1);
}

/**
 * Gleicher Korrekturalgorithmus wie `zonedTimeToUtc()` in
 * `src/lib/calendar/date.ts` — hier eigenständig nachgebaut, damit dieser
 * Spec kein "server-only"-App-Modul importiert (siehe
 * `helpers/test-data.ts`-Kopfkommentar zum selben Grund bei
 * `createE2eAdminClient()`).
 */
function berlinToUtcIso(dateIso: string, hhmm: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, min] = hhmm.split(":").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hh, min, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  const zonedAsUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour === 24 ? 0 : map.hour, map.minute, map.second);
  const drift = zonedAsUtc - utcGuess;
  return new Date(utcGuess - drift).toISOString();
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
    .insert({ tenant_id: tenantId, membership_id: studentMembershipId, user_id: studentUserId, worker_type: "freelancer" })
    .select("id")
    .single();
  if (workerError || !worker) throw new Error(`Arbeiterzeile (Freelancer) konnte nicht angelegt werden: ${workerError?.message}`);
  workerId = worker.id as string;

  const { data: secondWorker, error: secondWorkerError } = await admin
    .from("calendar_workers")
    .insert({ tenant_id: tenantId, membership_id: staffMembershipId, user_id: staffUserId, worker_type: "employee" })
    .select("id")
    .single();
  if (secondWorkerError || !secondWorker) {
    throw new Error(`Arbeiterzeile (Festangestellter, Fall 4) konnte nicht angelegt werden: ${secondWorkerError?.message}`);
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

  const todayIso = todayBerlinIso();
  const otherDayIso = otherDayInSameWeekIso(todayIso);

  const { data: slotA, error: slotAError } = await admin
    .from("calendar_slots")
    .insert({
      tenant_id: tenantId,
      project_id: projectId,
      starts_at: berlinToUtcIso(todayIso, "08:00"),
      ends_at: berlinToUtcIso(todayIso, "16:00"),
      capacity: 5,
      status: "open",
    })
    .select("id")
    .single();
  if (slotAError || !slotA) throw new Error(`Zeitfenster A konnte nicht angelegt werden: ${slotAError?.message}`);
  slotAId = slotA.id as string;

  const { data: slotB, error: slotBError } = await admin
    .from("calendar_slots")
    .insert({
      tenant_id: tenantId,
      project_id: projectId,
      starts_at: berlinToUtcIso(todayIso, "18:00"),
      ends_at: berlinToUtcIso(todayIso, "20:00"),
      capacity: 1,
      status: "open",
    })
    .select("id")
    .single();
  if (slotBError || !slotB) throw new Error(`Zeitfenster B konnte nicht angelegt werden: ${slotBError?.message}`);
  slotBId = slotB.id as string;

  const { data: ownShift, error: ownShiftError } = await admin
    .from("calendar_shifts")
    .insert({
      tenant_id: tenantId,
      worker_id: workerId,
      project_id: projectId,
      starts_at: berlinToUtcIso(otherDayIso, "09:00"),
      ends_at: berlinToUtcIso(otherDayIso, "17:00"),
      break_minutes: 0,
      status: "planned",
      source: "admin",
    })
    .select("id")
    .single();
  if (ownShiftError || !ownShift) throw new Error(`Bestehende Schicht (Fall 3) konnte nicht angelegt werden: ${ownShiftError?.message}`);
  ownShiftId = ownShift.id as string;
});

test.afterAll(async () => {
  if (projectId) {
    await admin.from("calendar_shift_change_requests").delete().eq("tenant_id", tenantId);
    await admin.from("calendar_shifts").delete().eq("project_id", projectId);
    await admin.from("calendar_slots").delete().eq("project_id", projectId);
    await admin.from("calendar_project_members").delete().eq("project_id", projectId);
    await admin.from("calendar_projects").delete().eq("id", projectId);
  }
  if (workerId) await admin.from("calendar_workers").delete().eq("id", workerId);
  if (secondWorkerId) await admin.from("calendar_workers").delete().eq("id", secondWorkerId);

  const { data: tenantRow } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  await admin.from("tenants").update({ settings: { ...settings, shift_calendar_enabled: false } }).eq("id", tenantId);
});

test("Fall 1 — Freelancer zieht innerhalb eines offenen Slots einen Teilbereich → Teil-Buchung in calendar_shifts", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/schichtplan"));
    await expect(page.getByRole("heading", { name: "Zeiterfassung" })).toBeVisible({ timeout: 15000 });

    const slotButton = page.getByRole("button", { name: new RegExp(`08:00 bis 16:00 Uhr, Projekt ${projectName}`) });
    await expect(slotButton).toBeVisible({ timeout: 15000 });
    // Explizit ins Sichtfeld scrollen — `boundingBox()` liefert sonst
    // ggf. Koordinaten außerhalb des aktuellen (noch nicht gescrollten)
    // Viewports, das Raster hat kein eigenes vertikales Scrollen
    // (`overflow-x-auto` ist nur horizontal, siehe shift-calendar-view.tsx).
    await slotButton.scrollIntoViewIfNeeded();

    const box = await slotButton.boundingBox();
    if (!box) throw new Error("Bounding Box des offenen Zeitfensters A nicht gefunden.");
    const x = box.x + box.width / 2;
    const startY = box.y + 8; // knapp unterhalb des oberen Rands, innerhalb des Slot-Blocks
    const endY = box.y + box.height / 2; // etwa Mitte des 8-Stunden-Slots — deutlich vor dessen Ende

    await page.mouse.move(x, startY);
    await page.mouse.down();
    await page.mouse.move(x, endY, { steps: 10 });
    await page.mouse.up();

    const todayIso = todayBerlinIso();
    const slotStartMs = new Date(berlinToUtcIso(todayIso, "08:00")).getTime();
    const slotEndMs = new Date(berlinToUtcIso(todayIso, "16:00")).getTime();

    await expect(async () => {
      const { data, error } = await admin
        .from("calendar_shifts")
        .select("id, starts_at, ends_at")
        .eq("tenant_id", tenantId)
        .eq("worker_id", workerId)
        .eq("slot_id", slotAId);
      if (error) throw error;
      expect(data).toHaveLength(1);
      const row = data![0];
      const startMs = new Date(row.starts_at as string).getTime();
      const endMs = new Date(row.ends_at as string).getTime();
      // Innerhalb der Slot-Grenzen (server-seitig ohnehin vom Trigger CT002 erzwungen).
      expect(startMs).toBeGreaterThanOrEqual(slotStartMs);
      expect(endMs).toBeLessThanOrEqual(slotEndMs);
      expect(endMs).toBeGreaterThan(startMs);
      // Echte TEIL-Buchung, nicht der ganze Slot (sonst wäre das Verhalten
      // identisch zu Fall 2 — die eigentliche neue Fähigkeit aus diesem Block).
      expect(endMs - startMs).toBeLessThan(slotEndMs - slotStartMs);
    }).toPass({ timeout: 15000 });
  } finally {
    await context.close();
  }
});

test("Fall 2 — Freelancer klickt (keine Zugbewegung) auf einen offenen Slot-Block → bucht den GANZEN Slot (Paritäts-Regression zum Buchen-Knopf)", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/schichtplan"));
    const slotButton = page.getByRole("button", { name: new RegExp(`18:00 bis 20:00 Uhr, Projekt ${projectName}`) });
    await expect(slotButton).toBeVisible({ timeout: 15000 });
    await slotButton.click();

    const todayIso = todayBerlinIso();
    const expectedStart = berlinToUtcIso(todayIso, "18:00");
    const expectedEnd = berlinToUtcIso(todayIso, "20:00");

    await expect(async () => {
      const { data, error } = await admin
        .from("calendar_shifts")
        .select("id, starts_at, ends_at")
        .eq("tenant_id", tenantId)
        .eq("worker_id", workerId)
        .eq("slot_id", slotBId);
      if (error) throw error;
      expect(data).toHaveLength(1);
      expect(new Date(data![0].starts_at as string).toISOString()).toBe(expectedStart);
      expect(new Date(data![0].ends_at as string).toISOString()).toBe(expectedEnd);
    }).toPass({ timeout: 15000 });
  } finally {
    await context.close();
  }
});

test("Fall 3 — Freelancer zieht eine eigene bestehende Schicht → 'Zeit ändern'-Formular öffnet sich vorausgefüllt, KEINE Schreibung in calendar_shifts", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: "e2e/.auth/student.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/schichtplan"));
    const shiftButton = page.getByRole("button", { name: new RegExp(`09:00 bis 17:00 Uhr, Projekt ${projectName}`) });
    await expect(shiftButton).toBeVisible({ timeout: 15000 });
    await shiftButton.scrollIntoViewIfNeeded();

    const box = await shiftButton.boundingBox();
    if (!box) throw new Error("Bounding Box der eigenen Schicht (Fall 3) nicht gefunden.");
    const x = box.x + box.width / 2;
    // Startpunkt bewusst in der oberen Blockhälfte (statt exakt in der
    // Mitte) — bei einer sehr kurzen Schicht könnte "Mitte + 88px" sonst
    // über den unteren Bildschirmrand hinauslaufen; so bleibt auch der
    // Zielpunkt sicher innerhalb des sichtbaren Viewports.
    const startY = box.y + Math.min(24, box.height / 2);
    const endY = startY + 88; // ~2 Stunden nach unten (2 * HOUR_ROW_HEIGHT_PX)

    await page.mouse.move(x, startY);
    await page.mouse.down();
    await page.mouse.move(x, endY, { steps: 10 });
    await page.mouse.up();

    const section = page.locator("section").filter({ hasText: "Änderung beantragen" });
    await expect(section.getByRole("heading", { name: "Zeitänderung beantragen" })).toBeVisible({ timeout: 15000 });

    // Vorausgefüllt MIT der gezogenen (verschobenen) Zeit — nicht mehr mit
    // der ursprünglichen 09:00/17:00.
    const startInput = section.getByLabel("Neue Startzeit", { exact: true });
    const endInput = section.getByLabel("Neue Endzeit", { exact: true });
    await expect(startInput).not.toHaveValue("09:00");
    await expect(endInput).not.toHaveValue("17:00");

    // KEINE Direktschreibung — die Original-Schicht ist unverändert, solange
    // der Freelancer den vorbefüllten Antrag nicht explizit abschickt.
    const { data: shiftRow, error } = await admin
      .from("calendar_shifts")
      .select("starts_at, ends_at")
      .eq("id", ownShiftId)
      .single();
    if (error || !shiftRow) throw new Error(`Eigene Schicht (Fall 3) nach dem Ziehen nicht lesbar: ${error?.message}`);
    const otherDayIso = otherDayInSameWeekIso(todayBerlinIso());
    expect(new Date(shiftRow.starts_at as string).toISOString()).toBe(berlinToUtcIso(otherDayIso, "09:00"));
    expect(new Date(shiftRow.ends_at as string).toISOString()).toBe(berlinToUtcIso(otherDayIso, "17:00"));

    // Auch keine (auch nicht offene) Änderungsanfrage — reines Vorbefüllen,
    // kein automatisches Absenden.
    const { data: requests } = await admin
      .from("calendar_shift_change_requests")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("shift_id", ownShiftId);
    expect(requests ?? []).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test("Fall 4 — Festangestellter sieht keine offenen Zeitfenster-Blöcke/keinen Zieh-Hinweis im Raster (Regressionsschutz)", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "e2e/.auth/staff.json" });
  const page = await context.newPage();
  try {
    await page.goto(tenantUrl("/schichtplan"));
    await expect(page.getByRole("heading", { name: "Zeiterfassung" })).toBeVisible({ timeout: 15000 });

    // Kein Selbstbuchungs-Block (weder OpenSlotsPanel noch die neuen
    // Raster-Blöcke) — identisch zum Verhalten vor Block S6.
    await expect(page.getByRole("heading", { name: "Offene Zeitfenster" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: new RegExp(`Uhr, Projekt ${projectName}.*Plätzen frei`) })).toHaveCount(0);
    await expect(page.getByText("Ziehen im Raster bucht")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
