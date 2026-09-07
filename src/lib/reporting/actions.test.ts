import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `tester`-Agent-Lauf (fyi CLAUDE.md §4.3) — Regressionstests für den
 * security-reviewer-Fund "Schreibzugriffe über den RLS-Client schlagen still
 * fehl und melden trotzdem Erfolg" (`src/lib/reporting/actions.ts`).
 *
 * `progress_own_delete` (supabase/migrations/20260712234600_rls_consolidate_
 * part_b.sql:129) erlaubt nur `user_id = auth.uid()` — ein Admin, der über
 * den regulären RLS-Client den Fortschritt EINES ANDEREN Nutzers löscht,
 * bekommt 0 gelöschte Zeilen und KEINEN Fehler zurück (genau das reale
 * Postgres-RLS-Verhalten). `attempts` hat nach Migration 20260712234500 gar
 * keine DELETE-Policy.
 *
 * Der Mock bildet das über zwei getrennte, im selben In-Memory-`storeRef`
 * arbeitende Klassen nach: `RlsDelete` (simuliert die fehlende/zu enge
 * Policy — `error: null`, aber NICHTS wird entfernt) und `AdminDelete`
 * (entfernt passende Zeilen ECHT). `resetCourseReport()`/`resetUserReport()`/
 * `resetQuizReport()` müssen für die eigentliche Löschung den Admin-Client
 * verwenden — ein Test, der stattdessen prüft, dass die Zeile im Store nach
 * dem Aufruf tatsächlich verschwunden ist, reproduziert den Fehler zuverlässig:
 * mit dem alten RLS-Client-Code bliebe die Zeile unverändert im Store stehen.
 *
 * Gleiches Grundmuster wie `src/lib/marketplace/fulfil.test.ts` (In-Memory-
 * Store + Mock-Query-Builder für `createAdminClient()`), hier zusätzlich um
 * einen zweiten, für den RLS-Client verwendeten Mock erweitert (kein
 * bestehendes Projekt-Muster für "zwei unterschiedliche Clients in derselben
 * Funktion" gefunden).
 */

type Row = Record<string, unknown>;
type MockError = { message: string };

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
    in(column: string, values: unknown[]): this {
      const set = new Set(values);
      this.rows = this.rows.filter((r) => set.has(r[column]));
      return this;
    }
    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.rows[0] ?? null, error: null });
    }
    then<T>(onFulfilled: (v: { data: Row[]; error: null }) => T): Promise<T> {
      return Promise.resolve(onFulfilled({ data: this.rows, error: null }));
    }
  }

  const errorsRef: { current: Record<string, MockError | undefined> } = { current: {} };

  abstract class DeleteFilter {
    protected filters: Array<(r: Row) => boolean> = [];
    constructor(protected table: string) {}
    eq(column: string, value: unknown): this {
      this.filters.push((r) => r[column] === value);
      return this;
    }
    in(column: string, values: unknown[]): this {
      const set = new Set(values);
      this.filters.push((r) => set.has(r[column]));
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu <client>.from().delete().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
    select(_columns?: string): this {
      return this;
    }
    protected matching(): Row[] {
      return tableRows(this.table).filter((r) => this.filters.every((f) => f(r)));
    }
  }

  /**
   * RLS-Attrappe: bildet die real fehlende/zu enge DELETE-Policy nach —
   * `error` bleibt `null`, aber es wird NICHTS aus dem Store entfernt. Genau
   * das reale stille Fehlschlagsverhalten, das den Fehler verursacht hat.
   */
  class RlsDelete extends DeleteFilter {
    then<T>(onFulfilled: (v: { data: never[]; error: null }) => T): Promise<T> {
      return Promise.resolve(onFulfilled({ data: [], error: null }));
    }
  }

  /** Admin-Attrappe: entfernt passende Zeilen ECHT aus dem Store. */
  class AdminDelete extends DeleteFilter {
    then<T>(onFulfilled: (v: { data: Row[]; error: MockError | null }) => T): Promise<T> {
      const err = errorsRef.current[this.table];
      if (err) return Promise.resolve(onFulfilled({ data: [], error: err }));
      const matching = this.matching();
      storeRef.current[this.table] = tableRows(this.table).filter((r) => !matching.includes(r));
      return Promise.resolve(onFulfilled({ data: matching, error: null }));
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- wie oben
        select: (_columns?: string) => new MockSelect([...tableRows(table)]),
        delete: () => new AdminDelete(table),
      };
    }
  }

  return { storeRef, MockAdminClient, MockRlsClient, errorsRef };
});

const requireAdminTenantMock = vi.fn();

vi.mock("@/lib/auth/staff", () => ({
  requireAdminTenant: () => requireAdminTenantMock(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => new MockAdminClient(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { resetCourseReport, resetUserReport, resetQuizReport } from "./actions";

const TENANT = { id: "tenant-1" };
const OTHER_TENANT_ID = "tenant-FREMD";

beforeEach(() => {
  storeRef.current = {
    courses: [{ id: "course-1", tenant_id: TENANT.id }],
    modules: [{ id: "mod-1", tenant_id: TENANT.id, course_id: "course-1" }],
    lessons: [{ id: "lesson-1", tenant_id: TENANT.id, module_id: "mod-1" }],
    progress: [],
    attempts: [],
  };
  requireAdminTenantMock.mockResolvedValue({ tenant: TENANT, user: { id: "admin-1" }, supabase: new MockRlsClient() });
});

describe("resetCourseReport — löscht Fortschritt ECHT (nicht nur über den blockierten RLS-Client)", () => {
  it("entfernt die progress-Zeilen ANDERER Nutzer tatsächlich aus der Datenbank", async () => {
    storeRef.current.progress = [
      { id: "p1", tenant_id: TENANT.id, lesson_id: "lesson-1", user_id: "learner-1" },
      { id: "p2", tenant_id: TENANT.id, lesson_id: "lesson-1", user_id: "learner-2" },
    ];

    const result = await resetCourseReport("course-1");

    // Mit dem alten, fehlerhaften Code (Löschung über den RLS-Client) hätte
    // `progress_own_delete` nur `user_id = auth.uid()` erlaubt — beide
    // Zeilen (fremde Lernende, nicht der Admin selbst) wären unverändert
    // stehen geblieben. Der Fix muss sie tatsächlich entfernen.
    expect(storeRef.current.progress).toEqual([]);
    expect(result).toEqual({ error: null, success: true });
  });

  it("meldet eine ehrliche Rückmeldung statt blindem success:true, wenn es nichts zurückzusetzen gibt", async () => {
    // storeRef.current.progress bleibt leer (aus beforeEach).
    const result = await resetCourseReport("course-1");

    expect(result.success).toBeFalsy();
    expect(result.error).toBeTruthy();
  });

  it("löscht NIE progress-Zeilen eines fremden Mandanten (tenant_id-Filter)", async () => {
    storeRef.current.progress = [
      { id: "p1", tenant_id: TENANT.id, lesson_id: "lesson-1", user_id: "learner-1" },
      { id: "p2", tenant_id: OTHER_TENANT_ID, lesson_id: "lesson-1", user_id: "learner-x" },
    ];

    await resetCourseReport("course-1");

    expect(storeRef.current.progress).toEqual([
      { id: "p2", tenant_id: OTHER_TENANT_ID, lesson_id: "lesson-1", user_id: "learner-x" },
    ]);
  });
});

describe("resetUserReport — löscht Fortschritt ECHT und nur für den gewählten Nutzer", () => {
  it("entfernt die progress-Zeile eines ANDEREN Nutzers tatsächlich, rührt aber andere Nutzer nicht an", async () => {
    storeRef.current.progress = [
      { id: "p1", tenant_id: TENANT.id, lesson_id: "lesson-1", user_id: "learner-1" },
      { id: "p2", tenant_id: TENANT.id, lesson_id: "lesson-1", user_id: "learner-2" },
    ];

    const result = await resetUserReport("learner-1", "course-1");

    expect(storeRef.current.progress).toEqual([
      { id: "p2", tenant_id: TENANT.id, lesson_id: "lesson-1", user_id: "learner-2" },
    ]);
    expect(result).toEqual({ error: null, success: true });
  });

  it("meldet eine ehrliche Rückmeldung, wenn der Nutzer keinen Fortschritt in diesem Kurs hatte", async () => {
    const result = await resetUserReport("learner-1", "course-1");
    expect(result.success).toBeFalsy();
    expect(result.error).toBeTruthy();
  });
});

describe("resetQuizReport — löscht Versuche ECHT (attempts hat keine DELETE-Policy)", () => {
  it("entfernt die attempts-Zeilen des gewählten Nutzers/Quiz tatsächlich", async () => {
    storeRef.current.attempts = [
      { id: "a1", tenant_id: TENANT.id, user_id: "learner-1", quiz_id: "quiz-1" },
      { id: "a2", tenant_id: TENANT.id, user_id: "learner-1", quiz_id: "quiz-2" },
    ];

    const result = await resetQuizReport("learner-1", "quiz-1");

    expect(storeRef.current.attempts).toEqual([
      { id: "a2", tenant_id: TENANT.id, user_id: "learner-1", quiz_id: "quiz-2" },
    ]);
    expect(result).toEqual({ error: null, success: true });
  });

  it("meldet eine ehrliche Rückmeldung statt blindem success:true, wenn es keine Versuche gibt", async () => {
    const result = await resetQuizReport("learner-1", "quiz-1");
    expect(result.success).toBeFalsy();
    expect(result.error).toBeTruthy();
  });
});
