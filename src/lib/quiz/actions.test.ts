import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `tester`-Agent-Lauf — Regressionstest für den Fund "Versuchslimit bei
 * Prüfungen per Doppelklick umgehbar" (`src/lib/quiz/actions.ts`, siehe
 * PHASENSTATUS.md).
 *
 * `submitAttempt()` zählte bisherige Versuche und schrieb den neuen Versuch
 * als ZWEI getrennte Anfragen ohne Sperre — `attempts` hat keinen
 * Unique-Index auf (quiz_id, user_id, ...) (0001_init.sql geprüft).
 *
 * Reproduktionsszenario (exakt wie im Auftrag beschrieben): Prüfung mit
 * `attempts_allowed = 1`. Der Lernende sendet dasselbe Formular zweimal fast
 * gleichzeitig (Doppelklick/zwei Tabs, hier per `Promise.all` nachgestellt).
 * Mit der alten Logik lesen beide Aufrufe `count = 0`, beide bestehen die
 * Limit-Prüfung, beide schreiben eine `attempts`-Zeile — zwei Versuche trotz
 * Limit 1.
 *
 * Fix: Zählung+Insert laufen jetzt als EINE RPC (`submit_quiz_attempt`,
 * siehe supabase/migrations/20260907091500_quiz_attempt_limit_rpc.sql). Der
 * Mock bildet diese RPC bewusst SYNCHRON nach (keine `await`-Lücke zwischen
 * Zählung und Insert innerhalb des Mock-Aufrufs) — das entspricht der
 * tatsächlichen Eigenschaft einer einzelnen Datenbank-Funktion/Transaktion:
 * ein zweiter, "gleichzeitiger" Aufruf sieht IMMER entweder den Zustand vor
 * oder nach dem ersten kompletten Aufruf, nie einen Zwischenzustand.
 */

type Row = Record<string, unknown>;

const { storeRef, tableRows, currentUserRef, mockClient, mockAdminClient } = vi.hoisted(() => {
  const storeRef: { current: Record<string, Row[]> } = { current: {} };
  const currentUserRef: { current: string } = { current: "user-1" };

  function tableRows(table: string): Row[] {
    return storeRef.current[table] ?? (storeRef.current[table] = []);
  }

  // Minimaler Query-Builder — deckt genau die in submitAttempt() verwendeten
  // Muster ab: .select(cols).eq(...).maybeSingle(), .select(cols,{count,
  // head}).eq(...).eq(...) (thenable), .select(cols).eq(...).eq(...).order(...)
  // (thenable, Array-Ergebnis).
  class MockQueryBuilder {
    private filters: Array<[string, unknown]> = [];
    private wantHead = false;

    constructor(private table: string) {}

    select(_columns?: string, opts?: { count?: string; head?: boolean }): this {
      if (opts?.head) this.wantHead = true;
      return this;
    }
    eq(column: string, value: unknown): this {
      this.filters.push([column, value]);
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu supabase.from().select().eq().order() passen, Sortierung ist für diese Tests irrelevant (nur eine Zeile pro Quiz)
    order(_column: string, _opts?: { ascending?: boolean }): this {
      return this;
    }

    private matching(): Row[] {
      let rows = tableRows(this.table);
      for (const [col, val] of this.filters) rows = rows.filter((r) => r[col] === val);
      return rows;
    }

    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.matching()[0] ?? null, error: null });
    }

    then<T>(onFulfilled: (v: { data: Row[] | null; error: null; count?: number }) => T): Promise<T> {
      const rows = this.matching();
      if (this.wantHead) return Promise.resolve(onFulfilled({ data: null, error: null, count: rows.length }));
      return Promise.resolve(onFulfilled({ data: rows, error: null }));
    }
  }

  // Bildet `submit_quiz_attempt` nach — SYNCHRON (kein `await` zwischen
  // Zählung und Insert), siehe Dateikopf-Kommentar.
  function rpc(fnName: string, params: Record<string, unknown>): Promise<{ data: Row | null; error: { message: string } | null }> {
    if (fnName !== "submit_quiz_attempt") {
      return Promise.resolve({ data: null, error: { message: `unbekannte RPC ${fnName}` } });
    }
    const quiz = tableRows("quizzes").find((q) => q.id === params.p_quiz_id);
    if (!quiz) return Promise.resolve({ data: null, error: { message: "quiz_not_found" } });

    const settings = (quiz.settings ?? {}) as { attempts_allowed?: number | null };
    const attemptsAllowed = settings.attempts_allowed ?? null;
    const userId = currentUserRef.current;
    const used = tableRows("attempts").filter((a) => a.quiz_id === params.p_quiz_id && a.user_id === userId).length;

    if (attemptsAllowed !== null && used >= attemptsAllowed) {
      return Promise.resolve({ data: null, error: { message: "attempts_limit_reached" } });
    }

    const row: Row = {
      id: crypto.randomUUID(),
      tenant_id: quiz.tenant_id,
      quiz_id: params.p_quiz_id,
      user_id: userId,
      answers: params.p_answers,
      score_pct: params.p_score_pct,
      passed: params.p_passed,
    };
    tableRows("attempts").push(row);
    return Promise.resolve({ data: row, error: null });
  }

  const mockClient = {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: currentUserRef.current } } }),
    },
    from: (table: string) => new MockQueryBuilder(table),
    rpc,
  };

  const mockAdminClient = {
    from: (table: string) => new MockQueryBuilder(table),
  };

  return { storeRef, tableRows, currentUserRef, mockClient, mockAdminClient };
});

vi.mock("@/lib/auth/staff", () => ({
  requireStaffTenant: vi.fn(),
  requireAdminTenant: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(mockClient),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockAdminClient,
}));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: () => Promise.resolve(true),
  RATE_LIMIT_MESSAGE: "Zu viele Anfragen. Bitte kurz warten.",
}));
vi.mock("@/lib/webhooks/dispatch", () => ({
  dispatchWebhookEvent: () => Promise.resolve(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { submitAttempt } from "./actions";

const QUIZ_ID = "quiz-1";

function seedQuizWithAttemptLimit(attemptsAllowed: number | null): void {
  storeRef.current = {
    quizzes: [
      {
        id: QUIZ_ID,
        tenant_id: "tenant-1",
        pass_pct: 50,
        settings: { attempts_allowed: attemptsAllowed },
      },
    ],
    // Eine trivial bewertbare "single"-Frage — Inhalt/Ergebnis der
    // Bewertung ist für dieses Testszenario irrelevant, nur das
    // Versuchslimit wird geprüft.
    questions: [
      {
        id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        tenant_id: "tenant-1",
        quiz_id: QUIZ_ID,
        position: 0,
        kind: "single",
        prompt: "1 + 1?",
        points: 1,
        options: [
          { id: "opt-a", text: "2" },
          { id: "opt-b", text: "3" },
        ],
        answer: { correctOptionId: "opt-a" },
      },
    ],
    attempts: [],
  };
}

beforeEach(() => {
  currentUserRef.current = "user-1";
  seedQuizWithAttemptLimit(1);
});

describe("submitAttempt — Versuchslimit per Doppelklick (verifizierter Fehler, behoben)", () => {
  it("Doppelklick (zwei fast gleichzeitige Aufrufe) bei attempts_allowed=1: genau EIN Versuch wird gespeichert", async () => {
    const [first, second] = await Promise.all([
      submitAttempt(QUIZ_ID, { "3fa85f64-5717-4562-b3fc-2c963f66afa6": "opt-a" }),
      submitAttempt(QUIZ_ID, { "3fa85f64-5717-4562-b3fc-2c963f66afa6": "opt-a" }),
    ]);

    // Genau EIN Aufruf darf erfolgreich sein, der andere muss eine
    // verständliche deutsche Fehlermeldung liefern.
    const results = [first, second];
    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (!failures[0].ok) {
      expect(failures[0].error).toBe("Versuchslimit erreicht.");
    }

    // Der eigentliche Fehler wäre: ZWEI attempts-Zeilen trotz Limit 1.
    expect(tableRows("attempts")).toHaveLength(1);
  });

  it("ohne Limit (attempts_allowed = null) dürfen mehrere Versuche gespeichert werden", async () => {
    seedQuizWithAttemptLimit(null);

    const [first, second] = await Promise.all([
      submitAttempt(QUIZ_ID, { "3fa85f64-5717-4562-b3fc-2c963f66afa6": "opt-a" }),
      submitAttempt(QUIZ_ID, { "3fa85f64-5717-4562-b3fc-2c963f66afa6": "opt-a" }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(tableRows("attempts")).toHaveLength(2);
  });

  it("zwei verschiedene Nutzer teilen sich das Limit NICHT (je eigener Versuch möglich)", async () => {
    currentUserRef.current = "user-1";
    const forUserOne = await submitAttempt(QUIZ_ID, { "3fa85f64-5717-4562-b3fc-2c963f66afa6": "opt-a" });
    currentUserRef.current = "user-2";
    const forUserTwo = await submitAttempt(QUIZ_ID, { "3fa85f64-5717-4562-b3fc-2c963f66afa6": "opt-a" });

    expect(forUserOne.ok).toBe(true);
    expect(forUserTwo.ok).toBe(true);
    expect(tableRows("attempts")).toHaveLength(2);
  });
});
