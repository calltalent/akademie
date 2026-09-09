import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `tester`-Agent-Lauf — Regressionstests für den in dieser Sitzung
 * gemeldeten Fund "Reporting kappt still bei der PostgREST-Zeilengrenze"
 * (`src/lib/reporting/queries.ts`).
 *
 * PostgREST kappt Antworten OHNE `.range()`/`.limit()` serverseitig
 * standardmäßig bei "Max rows" (in diesem Projekt: 1000 Zeilen) — OHNE
 * Fehler. Der Mock unten bildet genau das nach: `then()` (der Pfad, den
 * eine Query OHNE `.range()`-Aufruf nimmt) kappt seine Antwort hart bei
 * 1000 Zeilen, exakt wie der reale PostgREST-Server. `range(from, to)`
 * (der Pfad, den `fetchAllRows()` benutzt) sortiert nach der übergebenen
 * `.order()`-Spalte und liefert seitenweise vollständig, wie der echte
 * Server bei korrekter Pagination.
 *
 * Ein Test, der mit dem alten Code (Query ohne `.range()`, landet also im
 * `then()`-Pfad) läuft, würde an genau diesen Assertions scheitern — ein
 * Revert des `fetchAllRows()`-Fixes lässt diese Tests also zuverlässig
 * fehlschlagen. Gleiches Grundmuster wie `src/lib/reporting/actions.test.ts`
 * (Mock bildet das reale, fehlerhafte Verhalten nach statt es zu simulieren).
 */

type Row = Record<string, unknown>;

const { storeRef, MockClient } = vi.hoisted(() => {
  const PAGE_CAP = 1000; // reale PostgREST-"Max rows"-Grenze in diesem Projekt

  const storeRef: { current: Record<string, Row[]> } = { current: {} };

  function tableRows(table: string): Row[] {
    return storeRef.current[table] ?? (storeRef.current[table] = []);
  }

  class MockQuery {
    private filters: Array<(r: Row) => boolean> = [];
    private orderColumn: string | null = null;
    private orderAscending = true;

    constructor(private table: string) {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu supabase.from().select(cols) passen
    select(_columns?: string): this {
      return this;
    }
    eq(column: string, value: unknown): this {
      this.filters.push((r) => r[column] === value);
      return this;
    }
    in(column: string, values: unknown[]): this {
      const set = new Set(values);
      this.filters.push((r) => set.has(r[column]));
      return this;
    }
    order(column: string, opts?: { ascending?: boolean }): this {
      this.orderColumn = column;
      this.orderAscending = opts?.ascending !== false;
      return this;
    }

    private matching(): Row[] {
      const rows = tableRows(this.table).filter((r) => this.filters.every((f) => f(r)));
      if (!this.orderColumn) return rows;
      const col = this.orderColumn;
      const sign = this.orderAscending ? 1 : -1;
      return [...rows].sort((a, b) => {
        const av = a[col] as string | number;
        const bv = b[col] as string | number;
        if (av < bv) return -1 * sign;
        if (av > bv) return 1 * sign;
        return 0;
      });
    }

    /** Simuliert `.range(from, to)` — echte, vollständige Seitenweise-Auslieferung. */
    range(from: number, to: number): Promise<{ data: Row[]; error: null }> {
      return Promise.resolve({ data: this.matching().slice(from, to + 1), error: null });
    }

    /**
     * Simuliert den Pfad OHNE `.range()` — genau das reale PostgREST-
     * Verhalten: hart bei `PAGE_CAP` gekappt, ohne Fehler.
     */
    then<T>(onFulfilled: (v: { data: Row[]; error: null }) => T): Promise<T> {
      return Promise.resolve(onFulfilled({ data: this.matching().slice(0, PAGE_CAP), error: null }));
    }
  }

  class MockClient {
    from(table: string) {
      return new MockQuery(table);
    }
  }

  return { storeRef, MockClient };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => new MockClient(),
}));

const { getCourseReport, getUserReport, getQuizReport } = await import("./queries");

const TENANT_ID = "tenant-1";

function padId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(5, "0")}`;
}

beforeEach(() => {
  storeRef.current = {};
});

describe("Pagination-Fix: lessons (loadCourseStructures) — mehr als 1000 veröffentlichte Lektionen", () => {
  it("zählt alle veröffentlichten Lektionen eines Kurses, nicht nur die ersten 1000", async () => {
    const courseId = "course-1";
    storeRef.current.courses = [{ id: courseId, tenant_id: TENANT_ID, title: "Riesenkurs" }];
    storeRef.current.modules = [{ id: "mod-1", tenant_id: TENANT_ID, course_id: courseId }];

    const lessonCount = 1200;
    storeRef.current.lessons = Array.from({ length: lessonCount }, (_, i) => ({
      id: padId("lesson", i),
      tenant_id: TENANT_ID,
      module_id: "mod-1",
      status: "published",
    }));

    storeRef.current.enrollments = [{ id: "enr-1", tenant_id: TENANT_ID, course_id: courseId, user_id: "user-1" }];
    storeRef.current.profiles = [{ id: "user-1", email: "lernende@example.test", full_name: "Lernende Person" }];
    storeRef.current.progress = [];

    const rows = await getUserReport(TENANT_ID);

    expect(rows).toHaveLength(1);
    // Ohne Fix (Query ohne `.range()`) würde `then()` hier hart bei 1000
    // Lektionen kappen — `totalLessonsCount` wäre 1000 statt 1200.
    expect(rows[0].totalLessonsCount).toBe(lessonCount);
  });
});

describe("Pagination-Fix: progress (loadProgressIndex) — 60 Lernende × 20 Lektionen = 1200 Zeilen (Szenario aus dem Auftrag)", () => {
  it("markiert ALLE 60 eingeschriebenen Lernenden als abgeschlossen, nicht nur die in den ersten 1000 progress-Zeilen", async () => {
    const courseId = "course-1";
    const lessonCount = 20;
    const userCount = 60;

    storeRef.current.courses = [{ id: courseId, tenant_id: TENANT_ID, title: "Fortgeschrittenenkurs" }];
    storeRef.current.modules = [{ id: "mod-1", tenant_id: TENANT_ID, course_id: courseId }];
    storeRef.current.lessons = Array.from({ length: lessonCount }, (_, i) => ({
      id: padId("lesson", i),
      tenant_id: TENANT_ID,
      module_id: "mod-1",
      status: "published",
    }));

    const userIds = Array.from({ length: userCount }, (_, i) => padId("user", i));
    storeRef.current.enrollments = userIds.map((userId, i) => ({
      id: `enr-${i}`,
      tenant_id: TENANT_ID,
      course_id: courseId,
      user_id: userId,
    }));
    storeRef.current.profiles = userIds.map((userId) => ({
      id: userId,
      email: `${userId}@example.test`,
      full_name: null,
    }));

    // Jeder Lernende hat JEDE der 20 Lektionen abgeschlossen -> 60*20 = 1200
    // progress-Zeilen, alle "completed". Ohne den Fix würden nur die ersten
    // 1000 (in Sortierreihenfolge nach `id`) ankommen — einige Lernende
    // hätten dann nicht alle 20 Lektionen als abgeschlossen erfasst und
    // wären fälschlich nicht "isComplete".
    const progressRows: Row[] = [];
    let progressIndex = 0;
    for (const userId of userIds) {
      for (const lessonId of storeRef.current.lessons.map((l) => l.id as string)) {
        progressRows.push({
          id: padId("prog", progressIndex++),
          tenant_id: TENANT_ID,
          user_id: userId,
          lesson_id: lessonId,
          status: "completed",
          updated_at: "2026-08-10T00:00:00.000Z",
        });
      }
    }
    expect(progressRows).toHaveLength(userCount * lessonCount);
    storeRef.current.progress = progressRows;

    const courseRows = await getCourseReport(TENANT_ID);
    expect(courseRows).toHaveLength(1);
    expect(courseRows[0].enrolledCount).toBe(userCount);
    expect(courseRows[0].activeCount).toBe(userCount);
    // Die eigentliche Kernaussage des Funds: OHNE Fix wäre dieser Wert
    // deutlich unter 100, weil ein Teil der progress-Zeilen fehlt.
    expect(courseRows[0].completionRatePct).toBe(100);

    const userRows = await getUserReport(TENANT_ID, courseId);
    expect(userRows).toHaveLength(userCount);
    expect(userRows.every((r) => r.status === "completed")).toBe(true);
    expect(userRows.every((r) => r.completedLessonsCount === lessonCount)).toBe(true);
  });
});

describe("Pagination-Fix: enrollments (getCourseReport) — mehr als 1000 Einschreibungen", () => {
  it("zählt alle eingeschriebenen Lernenden, nicht nur die ersten 1000", async () => {
    const courseId = "course-1";
    const userCount = 1500;

    storeRef.current.courses = [{ id: courseId, tenant_id: TENANT_ID, title: "Massenkurs" }];
    storeRef.current.modules = [{ id: "mod-1", tenant_id: TENANT_ID, course_id: courseId }];
    storeRef.current.lessons = [
      { id: "lesson-1", tenant_id: TENANT_ID, module_id: "mod-1", status: "published" },
    ];
    storeRef.current.enrollments = Array.from({ length: userCount }, (_, i) => ({
      id: padId("enr", i),
      tenant_id: TENANT_ID,
      course_id: courseId,
      user_id: padId("user", i),
    }));
    storeRef.current.progress = [];

    const rows = await getCourseReport(TENANT_ID);

    expect(rows).toHaveLength(1);
    // Ohne Fix (Query ohne `.range()`) würde `then()` hier hart bei 1000
    // Einschreibungen kappen.
    expect(rows[0].enrolledCount).toBe(userCount);
  });
});

describe("Pagination-Fix: attempts (getQuizReport) — mehr als 1000 Versuche", () => {
  it("zählt alle Versuche eines Nutzers, nicht nur die ersten 1000", async () => {
    storeRef.current.quizzes = [
      { id: "quiz-1", tenant_id: TENANT_ID, title: "Abschlusstest", course_id: "course-1" },
    ];
    storeRef.current.courses = [{ id: "course-1", title: "Kurs A" }];
    storeRef.current.profiles = [{ id: "user-1", email: "vielversucher@example.test", full_name: null }];

    const attemptCount = 1300;
    storeRef.current.attempts = Array.from({ length: attemptCount }, (_, i) => ({
      id: padId("att", i),
      tenant_id: TENANT_ID,
      quiz_id: "quiz-1",
      user_id: "user-1",
      submitted_at: "2026-08-10T00:00:00.000Z",
      // Der beste Versuch ist bewusst der ALLERLETZTE (Index 1299, weit
      // jenseits der alten 1000er-Kappung) — alle anderen bleiben unter 50.
      // Ohne Fix bliebe dieser Versuch außen vor und `bestScorePct` läge
      // fälschlich bei höchstens 49.
      score_pct: i === attemptCount - 1 ? 100 : i % 50,
    }));

    const rows = await getQuizReport(TENANT_ID);

    expect(rows).toHaveLength(1);
    // Ohne Fix (Query ohne `.range()`) würde `then()` hier hart bei 1000
    // Versuchen kappen.
    expect(rows[0].attemptsCount).toBe(attemptCount);
    expect(rows[0].bestScorePct).toBe(100);
  });
});
