import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createE2eAdminClient, getDemoTenantId, DEMO_TENANT_URL } from "./helpers/test-data";

/**
 * Phase 4, Block 6 — E2E-Fundament. Legt zwei synthetische Test-Accounts
 * idempotent an (`e2e-staff@example.test` Rolle `owner`, `e2e-student@
 * example.test` Rolle `member`, beide Mitglied im Mandanten `demo-blau`)
 * und speichert je Rolle EINMAL einen echten UI-Login-Zustand
 * (`storageState`) für alle nachfolgenden Specs — Standardmuster für
 * Playwright-Authentifizierung.
 *
 * `example.test` ist laut RFC 2606 eine reservierte, garantiert nicht
 * auflösbare Testdomain — CLAUDE.md §2.6 ("keine echten E-Mail-Adressen/
 * Kundendaten in Tests/Fixtures") ist damit strukturell erfüllt.
 */
export const E2E_STAFF_EMAIL = "e2e-staff@example.test";
export const E2E_STUDENT_EMAIL = "e2e-student@example.test";

/**
 * Reiner Test-Wert für zwei synthetische Fake-Accounts unter der
 * reservierten Testdomain example.test — KEIN Produktionssecret (CLAUDE.md
 * §2.4 gilt für echte API-/Session-Keys, nicht für ein lokal in Supabase
 * Auth angelegtes Wegwerf-Passwort). Überschreibbar über
 * `E2E_TEST_PASSWORD`, falls Josip einen abweichenden Wert bevorzugt.
 */
export const E2E_TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || "E2eTest!Passwort2026";

const AUTH_DIR = path.join(__dirname, ".auth");

type AdminClient = ReturnType<typeof createE2eAdminClient>;

async function ensureTestUser(admin: AdminClient, email: string, fullName: string): Promise<string> {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: E2E_TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  let userId: string;
  if (created?.user) {
    userId = created.user.id;
  } else {
    // Account existiert bereits von einem vorherigen Lauf (Teardown löscht
    // die beiden persistenten Test-Accounts bewusst NICHT) — nachschlagen
    // statt Fehler zu werfen, gleiches Muster wie
    // src/lib/users/import.ts::findUserByEmail.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!existing) {
      throw new Error(
        `Test-Account ${email} konnte weder angelegt noch gefunden werden: ${createError?.message}`,
      );
    }
    userId = existing.id;
    // Passwort erzwingen (idempotent bei wiederholten Läufen, falls
    // E2E_TEST_PASSWORD sich seit dem letzten Lauf geändert hat).
    await admin.auth.admin.updateUserById(userId, { password: E2E_TEST_PASSWORD });
  }

  // profiles-Zeile MUSS vor der memberships-Zeile existieren
  // (memberships.user_id referenziert public.profiles(id), NICHT
  // auth.users(id) direkt — siehe 0001_init.sql Zeile 41) — deshalb hier
  // direkt per Admin-Client angelegt statt auf den späteren UI-Login (der
  // dies ebenfalls täte, siehe src/lib/auth/actions.ts::ensureProfile) zu
  // warten.
  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, email, full_name: fullName }, { onConflict: "id" });
  if (profileError) {
    throw new Error(`Profil für ${email} konnte nicht angelegt werden: ${profileError.message}`);
  }

  return userId;
}

async function ensureMembership(
  admin: AdminClient,
  tenantId: string,
  userId: string,
  role: "owner" | "member",
): Promise<void> {
  const { error } = await admin
    .from("memberships")
    .upsert(
      { tenant_id: tenantId, user_id: userId, role, status: "active" },
      { onConflict: "tenant_id,user_id" },
    );
  if (error) {
    throw new Error(`Mitgliedschaft (${role}) konnte nicht angelegt werden: ${error.message}`);
  }
}

async function loginAndSaveState(email: string, password: string, outFile: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${DEMO_TENANT_URL}/login`);
    // exact: true — die Login-Seite hat bewusst zwei überlappende
    // E-Mail-/Passwort-Feld-Beschriftungen (Passwort-Login + Magic-Link),
    // siehe Kommentar in e2e/auth.spec.ts.
    await page.getByLabel("E-Mail", { exact: true }).fill(email);
    await page.getByLabel("Passwort", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
    await page.context().storageState({ path: outFile });
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(): Promise<void> {
  const admin = createE2eAdminClient();
  const tenantId = await getDemoTenantId(admin);

  // Defensive Absicherung der für die Suite nötigen Feature-Flags — laut
  // Recherche aktuell bereits alle `true` für demo-blau (siehe
  // PHASENSTATUS.md Block 6), hier trotzdem zur Sicherheit erzwungen, falls
  // sich das seither geändert hat.
  const { data: tenantRow } = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  const settings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (settings.tutor_enabled !== true) patch.tutor_enabled = true;
  if (settings.payments_enabled !== true) patch.payments_enabled = true;
  if (settings.course_generator_enabled !== true) patch.course_generator_enabled = true;
  if (Object.keys(patch).length > 0) {
    await admin
      .from("tenants")
      .update({ settings: { ...settings, ...patch } })
      .eq("id", tenantId);
  }

  const staffId = await ensureTestUser(admin, E2E_STAFF_EMAIL, "E2E Staff");
  const studentId = await ensureTestUser(admin, E2E_STUDENT_EMAIL, "E2E Student");
  await ensureMembership(admin, tenantId, staffId, "owner");
  await ensureMembership(admin, tenantId, studentId, "member");

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await loginAndSaveState(E2E_STAFF_EMAIL, E2E_TEST_PASSWORD, path.join(AUTH_DIR, "staff.json"));
  await loginAndSaveState(E2E_STUDENT_EMAIL, E2E_TEST_PASSWORD, path.join(AUTH_DIR, "student.json"));
}
