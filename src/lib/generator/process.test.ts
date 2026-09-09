import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `tester`-Agent-Lauf — Regressionstest für den security-reviewer-Fund
 * "Compare-and-Swap-Lock-Update ohne `.select()` liefert bei 0 betroffenen
 * Zeilen weder Fehler noch Zeilenzahl" (`src/lib/generator/process.ts`).
 *
 * Simuliert exakt die Race Condition aus dem Auftragstext: zwei überlappende
 * Aufrufe von `processNextCourseGenJob()`. Der erste (hier über den Store
 * simuliert) hat den Job zwischen dem `SELECT` und diesem `UPDATE` bereits
 * auf `status='running'` gesetzt — das CAS-Update `eq("status", "queued")`
 * des ZWEITEN Aufrufs darf dann KEINE Zeile mehr treffen. Der Mock trennt
 * dafür bewusst die vom `SELECT` zurückgegebenen "Kandidaten" (statischer,
 * bereits veralteter Snapshot mit `status:"queued"`) vom `liveStore`
 * (aktueller Zustand, hier schon `status:"running"`) — das UPDATE filtert
 * ECHT gegen den `liveStore`, genau wie ein reales CAS-Update gegen die
 * echte DB-Zeile filtert.
 *
 * Mit dem alten Code (kein `.select()` am Update) wäre `lockError` hier
 * `null` geblieben und die Funktion hätte fälschlich weitergemacht (Kontingent-
 * Prüfung + KI-Aufruf ein zweites Mal) — dieser Test schlägt mit dem alten
 * Code fehl, weil `enforceQuota`/`generateOutlineStep` dann aufgerufen worden
 * wären und `processed` nicht `false` gewesen wäre.
 */

type Row = Record<string, unknown>;

const { adminClientRef, enforceQuotaMock, updateAiJobMock, generateOutlineStepMock } = vi.hoisted(() => {
  const adminClientRef: { current: unknown } = { current: null };
  const enforceQuotaMock = vi.fn();
  const updateAiJobMock = vi.fn();
  const generateOutlineStepMock = vi.fn();
  return { adminClientRef, enforceQuotaMock, updateAiJobMock, generateOutlineStepMock };
});

/** Bildet nur die eine Verkettung nach, die der SELECT-Kandidatenlauf in process.ts braucht: `.select().eq().or().order().limit()`, liefert den statischen Snapshot. */
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

/** Bildet `.update(data).eq(...).eq(...).select("id")` nach — filtert ECHT gegen `liveStore`, genau wie ein reales CAS-Update gegen die aktuelle DB-Zeile. */
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

/** Baut eine Admin-Client-Attrappe: `candidates` ist der statische SELECT-Snapshot, `liveStore` der aktuelle Zeilenzustand, gegen den das UPDATE ECHT filtert. */
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
vi.mock("@/lib/generator/pipeline", () => ({
  generateOutlineStep: (...args: unknown[]) => generateOutlineStepMock(...args),
  generateLessonContentStep: vi.fn(),
  generateQuizStep: vi.fn(),
}));

import { processNextCourseGenJob } from "./process";

beforeEach(() => {
  enforceQuotaMock.mockReset();
  updateAiJobMock.mockReset();
  generateOutlineStepMock.mockReset();
});

describe("processNextCourseGenJob — CAS-Sperre (verifizierter Fehler, behoben)", () => {
  it("gibt processed:false zurück und startet KEINEN KI-Aufruf, wenn ein anderer Prozess den Job zwischenzeitlich bereits übernommen hat", async () => {
    const staleSnapshot: Row = {
      id: "job-1",
      tenant_id: "tenant-1",
      status: "queued",
      input: { sourceText: "Text" },
      output: { step: 0 },
      tokens_in: 0,
      tokens_out: 0,
    };
    // liveStore: ein "konkurrierender" Aufruf hat den Status bereits auf
    // "running" gesetzt — das CAS-Update unten (eq("status","queued")) darf
    // diese Zeile deshalb NICHT mehr treffen.
    const liveRow: Row = { ...staleSnapshot, status: "running" };
    adminClientRef.current = makeMockAdminClient([staleSnapshot], [liveRow]);

    const result = await processNextCourseGenJob();

    expect(result).toEqual({ processed: false });
    // Der entscheidende Beleg für den Fix: mit dem alten Code (kein
    // `.select()`, `lockError` bleibt `null`) wäre hier trotz verlorenem CAS
    // weitergemacht und das Kontingent geprüft/ein KI-Aufruf gestartet worden.
    expect(enforceQuotaMock).not.toHaveBeenCalled();
    expect(generateOutlineStepMock).not.toHaveBeenCalled();
    expect(updateAiJobMock).not.toHaveBeenCalled();
  });

  it("verarbeitet den Job normal weiter, wenn die Sperre erfolgreich gesetzt wurde (Gegenprobe)", async () => {
    const row: Row = {
      id: "job-2",
      tenant_id: "tenant-1",
      status: "queued",
      input: { sourceText: "Text" },
      output: { step: 0 },
      tokens_in: 0,
      tokens_out: 0,
    };
    // Gleiche Zeile für Snapshot UND liveStore -> das CAS-Update trifft.
    adminClientRef.current = makeMockAdminClient([row], [row]);
    enforceQuotaMock.mockResolvedValue({ allowed: true, remaining: 10 });
    generateOutlineStepMock.mockResolvedValue({ data: { title: "T", modules: [] }, tokensIn: 10, tokensOut: 20 });

    const result = await processNextCourseGenJob();

    expect(result.processed).toBe(true);
    expect(enforceQuotaMock).toHaveBeenCalledTimes(1);
  });
});
