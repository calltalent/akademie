import { describe, expect, it, vi } from "vitest";
import { isCheckoutSettled, revokePurchase } from "./fulfilment";

describe("isCheckoutSettled (Sicherheitsaudit S3)", () => {
  it("schaltet bei bezahlter Session frei", () => {
    expect(isCheckoutSettled({ payment_status: "paid" })).toBe(true);
  });
  it("schaltet bei Abo-Testphase oder 100-%-Gutschein frei", () => {
    expect(isCheckoutSettled({ payment_status: "no_payment_required" })).toBe(true);
  });
  it("schaltet bei asynchroner, noch offener Zahlung NICHT frei", () => {
    expect(isCheckoutSettled({ payment_status: "unpaid" })).toBe(false);
  });
});

describe("revokePurchase (Sicherheitsaudit S3)", () => {
  function makeAdmin() {
    const calls: Array<{ table: string; values: unknown; filters: Array<[string, string, unknown]> }> = [];
    const admin = {
      from(table: string) {
        const entry = { table, values: undefined as unknown, filters: [] as Array<[string, string, unknown]> };
        calls.push(entry);
        const builder = {
          update(values: unknown) {
            entry.values = values;
            return builder;
          },
          eq(col: string, val: unknown) {
            entry.filters.push(["eq", col, val]);
            return builder;
          },
          in(col: string, val: unknown) {
            entry.filters.push(["in", col, val]);
            return builder;
          },
          then(resolve: (v: { error: null }) => unknown) {
            return Promise.resolve(resolve({ error: null }));
          },
        };
        return builder;
      },
    };
    return { admin, calls };
  }

  it("setzt die Bestellung auf refunded und lässt nur Kauf-Einschreibungen ablaufen", async () => {
    const { admin, calls } = makeAdmin();
    await revokePurchase(admin as never, {
      tenantId: "t1",
      userId: "u1",
      courseIds: ["c1", "c2"],
      checkoutSessionId: "cs_1",
      marketplace: false,
    });

    expect(calls[0].table).toBe("orders");
    expect(calls[0].values).toEqual({ status: "refunded" });
    expect(calls[0].filters).toContainEqual(["eq", "tenant_id", "t1"]);

    expect(calls[1].table).toBe("enrollments");
    expect(calls[1].values).toHaveProperty("expires_at");
    expect(calls[1].filters).toContainEqual(["in", "source", ["purchase", "marketplace"]]);
    expect(calls[1].filters).toContainEqual(["in", "course_id", ["c1", "c2"]]);
    expect(calls[1].filters).toContainEqual(["eq", "user_id", "u1"]);
  });

  it("fasst ohne Kurse keine Einschreibungen an und meldet Marketplace-Storno", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin, calls } = makeAdmin();
    await revokePurchase(admin as never, {
      tenantId: "t1",
      userId: "u1",
      courseIds: [],
      checkoutSessionId: "cs_2",
      marketplace: true,
    });
    expect(calls).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
