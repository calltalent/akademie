import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `tester`-Agent-Lauf — Regressionstest für den security-reviewer-Fund
 * "`deleteDraft()` löscht `ai_jobs` über den RLS-Client, `ai_jobs` hat aber
 * keine DELETE-Policy" (`src/lib/generator/actions.ts`).
 *
 * `ai_jobs` hat laut 0001_init.sql KEINE DELETE-Policy für irgendeine
 * Rolle — eine Löschung über den regulären Tenant-Client lief still ins
 * Leere (0 betroffene Zeilen, `error` bleibt `null`), die Action meldete
 * trotzdem Erfolg, und der Entwurf war nach einem Reload wieder da.
 *
 * Gleiches Mock-Grundmuster wie `reporting/actions.test.ts`: eine RLS-
 * Attrappe, deren `.delete()` NICHTS aus dem Store entfernt (genau das
 * reale, durch die fehlende Policy verursachte Verhalten), und eine Admin-
 * Attrappe, die tatsächlich löscht. `deleteDraft()` muss die Admin-Attrappe
 * verwenden — der Test prüft das, indem er nach dem Aufruf kontrolliert, ob
 * die Zeile im Store wirklich verschwunden ist.
 */

type Row = Record<string, unknown>;

const { storeRef, MockAdminClient, MockRlsClient } = vi.hoisted(() => {
  const storeRef: { current: Record<string, Row[]> } = { current: {} };

  function tableRows(table: string): Row[] {
    return storeRef.current[table] ?? (storeRef.current[table] = []);
  }

  class MockSelect {
    constructor(private rows: Row[]) {}
    eq(column: string, value: unknown): this {
      this.rows = this.rows.filter((r) => r[column] === value);
      return this;
    }
    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.rows[0] ?? null, error: null });
    }
  }

  abstract class DeleteFilter {
    protected filters: Array<(r: Row) => boolean> = [];
    constructor(protected table: string) {}
    eq(column: string, value: unknown): this {
      this.filters.push((r) => r[column] === value);
      return this;
    }
    protected matching(): Row[] {
      return tableRows(this.table).filter((r) => this.filters.every((f) => f(r)));
    }
  }

  /** RLS-Attrappe: bildet die real fehlende DELETE-Policy nach — `error: null`, aber nichts wird entfernt. */
  class RlsDelete extends DeleteFilter {
    then<T>(onFulfilled: (v: { error: null }) => T): Promise<T> {
      return Promise.resolve(onFulfilled({ error: null }));
    }
  }

  /** Admin-Attrappe: entfernt passende Zeilen ECHT aus dem Store. */
  class AdminDelete extends DeleteFilter {
    then<T>(onFulfilled: (v: { error: null }) => T): Promise<T> {
      const matching = this.matching();
      storeRef.current[this.table] = tableRows(this.table).filter((r) => !matching.includes(r));
      return Promise.resolve(onFulfilled({ error: null }));
    }
  }

  class MockRlsClient {
    from(table: string) {
      return {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu supabase.from().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
        select: (_columns?: string) => new MockSelect([...tableRows(table)]),
        delete: () => new RlsDelete(table),
      };
    }
  }
  class MockAdminClient {
    from(table: string) {
      return {
        delete: () => new AdminDelete(table),
      };
    }
  }

  return { storeRef, MockAdminClient, MockRlsClient };
});

const requireStaffTenantMock = vi.fn();

vi.mock("@/lib/auth/staff", () => ({
  requireStaffTenant: () => requireStaffTenantMock(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => new MockAdminClient(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { deleteDraft } from "./actions";

const TENANT = { id: "tenant-1" };

beforeEach(() => {
  storeRef.current = {
    ai_jobs: [{ id: "job-1", tenant_id: TENANT.id, kind: "course_gen", status: "done" }],
  };
  requireStaffTenantMock.mockResolvedValue({ tenant: TENANT, user: { id: "staff-1" }, supabase: new MockRlsClient() });
});

describe("deleteDraft — löscht ai_jobs ECHT (ai_jobs hat keine DELETE-Policy für den RLS-Client)", () => {
  it("entfernt die ai_jobs-Zeile tatsächlich aus der Datenbank", async () => {
    const result = await deleteDraft("job-1");

    // Mit dem alten Code (Löschung über den RLS-Client) wäre die Zeile
    // unverändert im Store stehen geblieben — der Fix muss sie entfernen.
    expect(storeRef.current.ai_jobs).toEqual([]);
    expect(result).toEqual({ error: null, success: true });
  });

  it("meldet 'nicht gefunden', wenn der Entwurf zu einem FREMDEN Mandanten gehört, statt ihn zu löschen", async () => {
    storeRef.current.ai_jobs = [{ id: "job-1", tenant_id: "tenant-FREMD", kind: "course_gen", status: "done" }];

    const result = await deleteDraft("job-1");

    expect(result.error).toBeTruthy();
    expect(result.success).toBeFalsy();
    expect(storeRef.current.ai_jobs).toHaveLength(1);
  });
});
