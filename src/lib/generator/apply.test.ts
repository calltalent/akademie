import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `tester`-Agent-Lauf — Regressionstest für den security-reviewer-Fund
 * "Idempotenz-Marker wird über den RLS-Client geschrieben, `ai_jobs` hat
 * aber keine UPDATE-Policy" (`src/lib/generator/apply.ts`).
 *
 * `ai_jobs` erlaubt laut 0001_init.sql:547-549 nur `_staff_select`/
 * `_staff_insert` — kein UPDATE für irgendeine Rolle. Der ursprüngliche Code
 * schrieb `output.appliedCourseId` über den RLS-Client
 * (`supabase.from("ai_jobs").update(...)`), was still (0 betroffene Zeilen,
 * kein Fehler) ins Leere lief. Der `appliedCourseId`-Guard am Funktionsanfang
 * griff dadurch nie: ein zweiter Aufruf (Doppelklick auf "Entwurf
 * übernehmen") legte denselben Kurs samt Modulen/Lektionen ein zweites Mal an.
 *
 * Der Mock persistiert `updateAiJob()`-Aufrufe ECHT in den `ai_jobs`-Store
 * (statt sie nur als Spy zu zählen) — nur so lässt sich der eigentliche
 * Doppelklick-Fehler nachstellen: ein ZWEITER `applyDraftAsCourse()`-Aufruf
 * mit demselben `jobId` MUSS den bereits angelegten Kurs zurückmelden statt
 * einen zweiten anzulegen. Mit dem alten RLS-Client-Code (Marker wird nie
 * persistiert) würde dieser Test fehlschlagen: `courses` hätte danach zwei
 * Zeilen statt einer. Gleiches Grundmuster wie `marketplace/fulfil.test.ts`
 * (In-Memory-Store + Mock-Query-Builder für Insert/Select).
 */

type Row = Record<string, unknown>;

const { storeRef, tableRows, MockRlsClient, updateAiJobMock } = vi.hoisted(() => {
  const storeRef: { current: Record<string, Row[]> } = { current: {} };

  function tableRows(table: string): Row[] {
    return storeRef.current[table] ?? (storeRef.current[table] = []);
  }
  // Echte UUIDs statt lesbarer Kürzel: `applyDraftAsCourse()` schreibt die
  // Kurs-ID als `appliedCourseId` zurück in `ai_jobs.output`, das beim
  // ZWEITEN Aufruf erneut gegen `courseGenOutputSchema` geparst wird
  // (`appliedCourseId: z.string().uuid()`) — ein nicht-UUID-Platzhalter
  // würde diesen Reparse fälschlich scheitern lassen.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Präfix bewusst ungenutzt, siehe Kommentar oben
  function nextId(_prefix: string): string {
    return crypto.randomUUID();
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

  // Bildet sowohl `.insert(row)` (direkt awaitbar, z. B. Lektionen ohne
  // `.select()`) als auch `.insert(row).select(cols).single()` nach
  // (z. B. Kurs-/Modul-Anlage) — gleiches Grundmuster wie
  // `MockUpsertResult` in marketplace/fulfil.test.ts.
  class MockInsert {
    private stored: Row;
    private committed = false;
    constructor(
      private table: string,
      row: Row,
    ) {
      this.stored = { id: nextId(table), ...row };
    }
    private commit(): Row {
      if (!this.committed) {
        tableRows(this.table).push(this.stored);
        this.committed = true;
      }
      return this.stored;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu supabase.from().insert().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
    select(_columns: string) {
      return {
        single: (): Promise<{ data: Row; error: null }> =>
          Promise.resolve({ data: { id: this.commit().id }, error: null }),
      };
    }
    then<T>(onFulfilled: (v: { error: null }) => T): Promise<T> {
      this.commit();
      return Promise.resolve(onFulfilled({ error: null }));
    }
  }

  class MockRlsClient {
    from(table: string) {
      return {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu supabase.from().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
        select: (_columns?: string) => new MockSelect([...tableRows(table)]),
        insert: (row: Row) => new MockInsert(table, row),
      };
    }
  }

  // Persistiert `output`-Updates ECHT im Store — anders als ein reiner Spy
  // nötig, um den Doppelklick-Fehler (Marker wird nie gespeichert) tatsächlich
  // nachzustellen (siehe Dateikopf).
  const updateAiJobMock = vi.fn(async (jobId: string, params: { output?: Record<string, unknown> }) => {
    const job = tableRows("ai_jobs").find((r) => r.id === jobId);
    if (job && params.output !== undefined) {
      job.output = params.output;
    }
  });

  return { storeRef, tableRows, MockRlsClient, updateAiJobMock };
});

const requireStaffTenantMock = vi.fn();

vi.mock("@/lib/auth/staff", () => ({
  requireStaffTenant: () => requireStaffTenantMock(),
}));
vi.mock("@/lib/ai/usage", () => ({
  updateAiJob: (...args: [string, { output?: Record<string, unknown> }]) => updateAiJobMock(...args),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { applyDraftAsCourse } from "./apply";

const TENANT = { id: "tenant-1" };
const USER = { id: "staff-1" };

function baseDraft() {
  return {
    title: "Mein Kurs",
    description: "Eine Beschreibung.",
    modules: [
      {
        title: "Modul 1",
        lessons: [{ title: "Lektion 1", contentHtml: "<p>Inhalt</p>" }],
        quiz: null,
      },
    ],
  };
}

function seedDoneJob(): void {
  storeRef.current.ai_jobs = [
    {
      id: "job-1",
      tenant_id: TENANT.id,
      kind: "course_gen",
      status: "done",
      input: { sourceText: "Quelltext des hochgeladenen Dokuments." },
      output: { step: 3, draft: baseDraft() },
    },
  ];
}

beforeEach(() => {
  storeRef.current = { ai_jobs: [], courses: [], modules: [], lessons: [] };
  updateAiJobMock.mockClear();
  requireStaffTenantMock.mockResolvedValue({ tenant: TENANT, user: USER, supabase: new MockRlsClient() });
  seedDoneJob();
});

describe("applyDraftAsCourse — Idempotenz-Marker (verifizierter Fehler, behoben)", () => {
  it("persistiert appliedCourseId über updateAiJob() (Admin-Client), nicht über den RLS-Client", async () => {
    const result = await applyDraftAsCourse("job-1");

    expect(result.ok).toBe(true);
    expect(updateAiJobMock).toHaveBeenCalledTimes(1);
    if (!result.ok) throw new Error("erwarteter Erfolg");
    expect(updateAiJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ output: expect.objectContaining({ appliedCourseId: result.courseId }) }),
    );
  });

  it("legt bei einem zweiten Aufruf (Doppelklick) KEINEN zweiten Kurs an, weil der Marker tatsächlich gespeichert wurde", async () => {
    const first = await applyDraftAsCourse("job-1");
    expect(first.ok).toBe(true);

    const second = await applyDraftAsCourse("job-1");

    expect(second).toEqual(first);
    // Mit dem alten RLS-Client-Code wäre `appliedCourseId` nie im Store
    // angekommen — der Guard hätte nie gegriffen, und dieser zweite Aufruf
    // hätte einen ZWEITEN Kurs samt Modul/Lektion angelegt.
    expect(tableRows("courses")).toHaveLength(1);
    expect(tableRows("modules")).toHaveLength(1);
    expect(tableRows("lessons")).toHaveLength(1);
    // Der zweite Aufruf bricht bereits am appliedCourseId-Guard ab, bevor er
    // erneut schreibt.
    expect(updateAiJobMock).toHaveBeenCalledTimes(1);
  });
});
