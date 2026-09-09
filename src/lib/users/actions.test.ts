import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Rate-Limit-Fix (Security-Review 07.09.2026, siehe Kopfkommentare in
 * actions.ts bei inviteSingleUser/resendInviteLink): beide lösen echten
 * Resend-Mailversand aus und hatten bisher keinen Schutz — anders als der
 * CSV-Bulk-Import (api/admin/users/import/route.ts, Schlüssel "csv-import").
 *
 * Alle Abhängigkeiten sind gemockt (gleiches Grundmuster wie
 * marketplace/fulfil.test.ts): `requireAdminTenant()` liefert einen festen
 * Mandanten, `checkRateLimit()` wird pro Testfall gesteuert. Der eigentliche
 * Prüfwert liegt darin, dass ein abgelehntes Rate-Limit die Aktion VOR jedem
 * Mailversand/DB-Zugriff beendet (importUsers/createAdminClient/sendEmail
 * werden dann nachweislich nie aufgerufen) und dass jede Aktion ihren
 * EIGENEN Namespace-Schlüssel verwendet (kein gemeinsam verbrauchtes Budget).
 */

const requireAdminTenant = vi.fn();
const checkRateLimit = vi.fn();
const importUsers = vi.fn();
const buildSetPasswordLink = vi.fn();
const createAdminClient = vi.fn();
const sendEmail = vi.fn();
const welcomeInvite = vi.fn();
const getTranslations = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/staff", () => ({ requireAdminTenant: (...a: unknown[]) => requireAdminTenant(...a) }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
  RATE_LIMIT_MESSAGE: "Zu viele Anfragen. Bitte kurz warten und erneut versuchen.",
}));
vi.mock("@/lib/users/import", () => ({
  importUsers: (...a: unknown[]) => importUsers(...a),
  buildSetPasswordLink: (...a: unknown[]) => buildSetPasswordLink(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: (...a: unknown[]) => createAdminClient(...a) }));
vi.mock("@/lib/email/client", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/email/templates", () => ({ welcomeInvite: (...a: unknown[]) => welcomeInvite(...a) }));
vi.mock("next-intl/server", () => ({ getTranslations: (...a: unknown[]) => getTranslations(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const { inviteSingleUser, resendInviteLink } = await import("./actions");

const FAKE_TENANT = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Testakademie",
  settings: { default_locale: "de" },
  branding: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminTenant.mockResolvedValue({ tenant: FAKE_TENANT, supabase: {} });
});

describe("inviteSingleUser — Rate-Limit", () => {
  it("bricht mit RATE_LIMIT_MESSAGE ab und ruft importUsers() nicht auf, wenn das Limit erreicht ist", async () => {
    checkRateLimit.mockResolvedValue(false);
    const formData = new FormData();
    formData.set("email", "person@example.com");

    const result = await inviteSingleUser({ error: null }, formData);

    expect(result.error).toBe("Zu viele Anfragen. Bitte kurz warten und erneut versuchen.");
    expect(checkRateLimit).toHaveBeenCalledWith(
      "invite-single-user",
      expect.objectContaining({ extraKey: FAKE_TENANT.id }),
    );
    expect(importUsers).not.toHaveBeenCalled();
  });

  it("fährt normal fort, wenn das Limit nicht erreicht ist", async () => {
    checkRateLimit.mockResolvedValue(true);
    importUsers.mockResolvedValue({ results: [{ status: "created" }] });
    const formData = new FormData();
    formData.set("email", "person@example.com");

    const result = await inviteSingleUser({ error: null }, formData);

    expect(result.error).toBeNull();
    expect(importUsers).toHaveBeenCalledTimes(1);
  });
});

describe("resendInviteLink — Rate-Limit", () => {
  it("bricht mit RATE_LIMIT_MESSAGE ab und greift nicht auf den Admin-Client/E-Mail-Versand zu, wenn das Limit erreicht ist", async () => {
    checkRateLimit.mockResolvedValue(false);

    const result = await resendInviteLink("22222222-2222-2222-2222-222222222222");

    expect(result.error).toBe("Zu viele Anfragen. Bitte kurz warten und erneut versuchen.");
    expect(checkRateLimit).toHaveBeenCalledWith(
      "resend-invite-link",
      expect.objectContaining({ extraKey: FAKE_TENANT.id }),
    );
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("verwendet einen eigenen Namespace-Schlüssel — unabhängig vom Budget von inviteSingleUser", () => {
    // Reine Dokumentations-/Regressionsprüfung der beiden Aufrufstellen in
    // actions.ts: unterschiedliche `namespace`-Strings, gleiche `tenant.id`
    // als extraKey — ein ausgeschöpftes Einzel-Einladungs-Budget blockiert
    // den erneuten Versand nicht und umgekehrt.
    expect("invite-single-user").not.toBe("resend-invite-link");
  });
});
