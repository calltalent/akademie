import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Marketplace M5 — Regressionstest für den Fund "Unbehandelte Ausnahme im
 * Gratis-Erwerb" (`acquireFreeListing()`): `grantMarketplaceAccess()` wirft
 * bewusst bei einem `memberships`-Insert-/`enrollments`-Upsert-Fehler (siehe
 * `fulfil.ts`/`fulfil.test.ts`) — das ist im Stripe-Webhook-Kontext richtig
 * (Wurf -> 500 -> Stripe-Retry), hätte in dieser Server Action VOR dem Fix
 * aber zur generischen Next.js-Fehlerseite geführt, statt einer
 * verständlichen deutschen Fehlermeldung.
 *
 * Alle Fremdaufrufe (Supabase-Clients, Rate-Limit, `grantMarketplaceAccess`,
 * `redirect()`) sind gemockt — geprüft wird ausschließlich das
 * Fehlerbehandlungs-Verhalten von `acquireFreeListing()` selbst.
 */

const { authUserRef, listingsRef, grantMarketplaceAccessMock, redirectMock } = vi.hoisted(() => ({
  authUserRef: { current: { id: "user-1" } as { id: string } | null },
  listingsRef: { current: [{ id: "listing-1", tenant_id: "tenant-1", course_id: "course-1" }] as Record<
    string,
    unknown
  >[] },
  grantMarketplaceAccessMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: authUserRef.current } }),
    },
  }),
}));

class FakeListingsQuery {
  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  maybeSingle(): Promise<{ data: Record<string, unknown> | null }> {
    return Promise.resolve({ data: listingsRef.current[0] ?? null });
  }
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table !== "marketplace_listings") throw new Error(`Unerwartete Tabelle im Test-Stub: ${table}`);
      return new FakeListingsQuery();
    },
  }),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  RATE_LIMIT_MESSAGE: "Zu viele Anfragen. Bitte kurz warten und erneut versuchen.",
}));

vi.mock("@/lib/marketplace/fulfil", () => ({
  grantMarketplaceAccess: grantMarketplaceAccessMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { acquireFreeListing } from "./acquire";

beforeEach(() => {
  authUserRef.current = { id: "user-1" };
  listingsRef.current = [{ id: "listing-1", tenant_id: "tenant-1", course_id: "course-1" }];
  grantMarketplaceAccessMock.mockReset();
  redirectMock.mockReset();
});

describe("acquireFreeListing", () => {
  it("leitet nach erfolgreicher Zugriffsgewähr zur Danke-Seite weiter", async () => {
    grantMarketplaceAccessMock.mockResolvedValue({ enrollmentCreated: true });

    await acquireFreeListing("intro-kurs");

    expect(grantMarketplaceAccessMock).toHaveBeenCalledWith(expect.anything(), "tenant-1", "user-1", "course-1");
    expect(redirectMock).toHaveBeenCalledWith("/kurs/intro-kurs/danke");
  });

  it("gibt eine verständliche deutsche Fehlermeldung zurück, wenn grantMarketplaceAccess() wirft, statt die Ausnahme durchzureichen (Fund, behoben)", async () => {
    // Simuliert genau den Fall aus fulfil.ts: memberships-Insert bzw.
    // enrollments-Upsert schlägt fehl -> grantMarketplaceAccess() wirft.
    grantMarketplaceAccessMock.mockRejectedValue(new Error("enrollments-Upsert fehlgeschlagen: simulierter DB-Fehler"));

    const result = await acquireFreeListing("intro-kurs");

    expect(result.error).toBe("Der Kurs konnte nicht freigeschaltet werden. Bitte versuche es erneut.");
  });

  it("leitet NICHT weiter, wenn grantMarketplaceAccess() wirft (redirect() bleibt außerhalb des try/catch, wird aber nach einem Fehler nie erreicht)", async () => {
    grantMarketplaceAccessMock.mockRejectedValue(new Error("simulierter DB-Fehler"));

    await acquireFreeListing("intro-kurs");

    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("die Fehlermeldung enthält keine rohe Fehlerdetails/Stacktraces (kein Secret-/Interna-Leck)", async () => {
    grantMarketplaceAccessMock.mockRejectedValue(new Error("enrollments-Upsert fehlgeschlagen: Verbindung zu db.internal:5432 verweigert"));

    const result = await acquireFreeListing("intro-kurs");

    expect(result.error).not.toContain("db.internal");
    expect(result.error).not.toContain("Verbindung");
  });
});
