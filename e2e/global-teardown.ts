import { createE2eAdminClient, getDemoTenantId, cleanupE2eTenantData, cleanupE2eUsers } from "./helpers/test-data";
import { E2E_STAFF_EMAIL, E2E_STUDENT_EMAIL } from "./global-setup";

/**
 * Phase 4, Block 6 — räumt nach jedem E2E-Lauf alle `e2e-`-präfixten
 * Zeilen wieder auf (Kurse/Produkte/Bestellungen, Nutzer), damit `demo-blau`
 * bei wiederholten Läufen nicht zuwächst. Löscht NICHT die beiden
 * persistenten Test-Accounts (e2e-staff@example.test/e2e-student@
 * example.test) — der nächste Lauf nutzt sie wieder, spart Setup-Zeit.
 */
export default async function globalTeardown(): Promise<void> {
  const admin = createE2eAdminClient();
  const tenantId = await getDemoTenantId(admin);
  await cleanupE2eTenantData(admin, tenantId);
  await cleanupE2eUsers(admin, [E2E_STAFF_EMAIL, E2E_STUDENT_EMAIL]);
}
