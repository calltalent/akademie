import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `tester`-Agent-Lauf — Regressionstest für den security-reviewer-Fund
 * "Compare-and-Swap-Lock-Update ohne `.select()` liefert bei 0 betroffenen
 * Zeilen weder Fehler noch Zeilenzahl" (`src/lib/calendar/ai/process.ts`),
 * identische Stelle wie `src/lib/generator/process.ts` (siehe
 * `generator/process.test.ts` für die ausführliche Begründung des
 * Mock-Aufbaus: statischer SELECT-Snapshot vs. `liveStore`, gegen den das
 * UPDATE ECHT filtert).
 */

type Row = Record<string, unknown>;

const { adminClientRef, enforceQuotaMock, updateAiJobMock, callShiftPlanModelMock } = vi.hoisted(() => {
  const adminClientRef: { current: unknown } = { current: null };
  const enforceQuotaMock = vi.fn();
  const updateAiJobMock = vi.fn();
  const callShiftPlanModelMock = vi.fn();
  return { adminClientRef, enforceQuotaMock, updateAiJobMock, callShiftPlanModelMock };
});

class MockSelectChain {
  constructor(private candidates: Row[]) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zur echten Kette passen, der Mock braucht Spalte/Wert nicht
  eq(_column: string, _value: unknown): this {
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  or(_expr: string): this {
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  order(_column: string, _opts?: unknown): this {
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  limit(_n: number): Promise<{ data: Row[]; error: null }> {
    return Promise.resolve({ data: this.candidates, error: null });
  }
}

class MockUpdateChain {
  private filters: Array<(r: Row) => boolean> = [];
  constructor(
    private liveStore: Row[],
    private data: Row,
  ) {}
  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.update().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
  select(_columns?: string): Promise<{ data: { id: unknown }[]; error: null }> {
    const matching = this.liveStore.filter((r) => this.filters.every((f) => f(r)));
    matching.forEach((r) => Object.assign(r, this.data));
    return Promise.resolve({ data: matching.map((r) => ({ id: r.id })), error: null });
  }
}

function makeMockAdminClient(candidates: Row[], liveStore: Row[]) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from(table) passen, dieser Mock kennt nur eine Tabelle
    from(_table: string) {
      return {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        select: (_columns?: string) => new MockSelectChain(candidates),
        update: (data: Row) => new MockUpdateChain(liveStore, data),
      };
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminClientRef.current,
}));
vi.mock("@/lib/ai/usage", () => ({
  enforceQuota: (...args: unknown[]) => enforceQuotaMock(...args),
  updateAiJob: (...args: unknown[]) => updateAiJobMock(...args),
}));
vi.mock("@/lib/calendar/ai/pipeline", () => ({
  callShiftPlanModel: (...args: unknown[]) => callShiftPlanModelMock(...args),
}));

import { processNextShiftPlanJob } from "./process";

beforeEach(() => {
  enforceQuotaMock.mockReset();
  updateAiJobMock.mockReset();
  callShiftPlanModelMock.mockReset();
});

describe("processNextShiftPlanJob — CAS-Sperre (verifizierter Fehler, behoben)", () => {
  it("gibt processed:false zurück und startet KEINEN KI-Aufruf, wenn ein anderer Prozess den Job zwischenzeitlich bereits übernommen hat", async () => {
    const staleSnapshot: Row = {
      id: "job-1",
      tenant_id: "tenant-1",
      status: "queued",
      input: { projectId: "11111111-1111-1111-1111-111111111111", workerIds: [], fromDate: "2026-09-07", toDate: "2026-09-13" },
      tokens_in: 0,
      tokens_out: 0,
    };
    // liveStore: ein konkurrierender Aufruf hat den Status bereits auf
    // "running" gesetzt — das CAS-Update unten (eq("status","queued")) darf
    // diese Zeile deshalb NICHT mehr treffen.
    const liveRow: Row = { ...staleSnapshot, status: "running" };
    adminClientRef.current = makeMockAdminClient([staleSnapshot], [liveRow]);

    const result = await processNextShiftPlanJob();

    expect(result).toEqual({ processed: false });
    // Der entscheidende Beleg für den Fix: mit dem alten Code (kein
    // `.select()`, `lockError` bleibt `null`) wäre hier trotz verlorenem CAS
    // weitergemacht und das Kontingent geprüft/ein KI-Aufruf gestartet worden.
    expect(enforceQuotaMock).not.toHaveBeenCalled();
    expect(callShiftPlanModelMock).not.toHaveBeenCalled();
    expect(updateAiJobMock).not.toHaveBeenCalled();
  });
});
