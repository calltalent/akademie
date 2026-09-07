import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `tester`-Agent-Lauf — Regressionstest für den Fund "Positionslogik erzeugt
 * Duplikate und legt die Auf/Ab-Buttons dauerhaft lahm" (`src/lib/courses/
 * actions.ts`, siehe PHASENSTATUS.md).
 *
 * Die ursprüngliche Positionslogik leitete `position` aus der ZEILENANZAHL
 * (`count`) ab statt aus `max(position) + 1` — es gibt keinen
 * Unique-Constraint auf `(course_id, position)` (0001_init.sql geprüft).
 *
 * Reproduktionsszenario (exakt wie im Auftrag beschrieben): Module
 * A(0), B(1), C(2) anlegen, B löschen, Modul D anlegen. Mit der alten
 * `count`-Logik ist `count` nach dem Löschen 2, D bekäme dieselbe Position
 * wie C (2). `moveModule` tauscht danach `b.position`/`a.position`, die bei
 * identischer Position ein No-Op sind — der "Nach oben"-Button wirkt ab da
 * kaputt, ohne jede Fehlermeldung.
 *
 * Der Mock persistiert ECHT in einem In-Memory-Store (gleiches Grundmuster
 * wie `src/lib/generator/apply.test.ts`) — nur so lässt sich der eigentliche
 * Fehler (Duplikat NACH einem Löschvorgang) nachstellen, ein reiner
 * Zähl-Spy würde ihn verdecken.
 */

type Row = Record<string, unknown>;

const { storeRef, tableRows, MockRlsClient } = vi.hoisted(() => {
  const storeRef: { current: Record<string, Row[]> } = { current: {} };

  function tableRows(table: string): Row[] {
    return storeRef.current[table] ?? (storeRef.current[table] = []);
  }

  // Generischer Query-Builder für .from(table): bildet select/insert/update/
  // delete mit .eq()/.order()/.limit() nach — genug für die in
  // courses/actions.ts verwendeten Muster (kein echtes RLS, das übernimmt
  // hier `requireStaffTenantMock`).
  class MockQueryBuilder {
    private op: "select" | "insert" | "update" | "delete" = "select";
    private filters: Array<[string, unknown]> = [];
    private orderCol: string | null = null;
    private orderAsc = true;
    private limitN: number | null = null;
    private insertRow: Row | null = null;
    private updateRow: Row | null = null;

    constructor(private table: string) {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu supabase.from().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
    select(_columns?: string): this | { single: () => Promise<{ data: Row; error: null }> } {
      // Nach `.insert(row)` bedeutet `.select(cols).single()` "gib die neu
      // eingefügte Zeile zurück" (createDraftCourse-Muster) — NICHT einen
      // zusätzlichen Lesevorgang. Sonst (normaler Lesepfad) bleibt `select`
      // ein reiner No-Op-Chain-Schritt vor `.eq()`/`.order()`/`.limit()`.
      if (this.op === "insert") {
        return {
          single: (): Promise<{ data: Row; error: null }> => {
            const row = { id: crypto.randomUUID(), ...this.insertRow };
            tableRows(this.table).push(row);
            return Promise.resolve({ data: row, error: null });
          },
        };
      }
      return this;
    }
    insert(row: Row): this {
      this.op = "insert";
      this.insertRow = row;
      return this;
    }
    update(row: Row): this {
      this.op = "update";
      this.updateRow = row;
      return this;
    }
    delete(): this {
      this.op = "delete";
      return this;
    }
    eq(column: string, value: unknown): this {
      this.filters.push([column, value]);
      return this;
    }
    order(column: string, opts?: { ascending?: boolean }): this {
      this.orderCol = column;
      this.orderAsc = opts?.ascending ?? true;
      return this;
    }
    limit(n: number): this {
      this.limitN = n;
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

    then<T>(
      onFulfilled: (v: { data: Row[] | null; error: null }) => T,
      onRejected?: (e: unknown) => T,
    ): Promise<T> {
      return this.exec().then(onFulfilled, onRejected);
    }

    private async exec(): Promise<{ data: Row[] | null; error: null }> {
      if (this.op === "select") {
        // Flache Kopien statt Objekt-Referenzen — genau wie ein echter
        // PostgREST-Response ist das Ergebnis EINES `select()` unabhängig
        // von späteren `update()`-Aufrufen auf dieselbe Zeile. Ohne diese
        // Kopie würde `moveModule`s zweiter Update-Aufruf `a.position`
        // bereits als vom ERSTEN Update mutierten Wert lesen (beide
        // Variablen zeigen sonst auf dasselbe Store-Objekt) — ein reiner
        // Mock-Artefakt, kein Fehler im getesteten Code.
        let rows = this.matching().map((r) => ({ ...r }));
        if (this.orderCol) {
          const col = this.orderCol;
          rows.sort((a, b) => {
            const av = Number(a[col]);
            const bv = Number(b[col]);
            return this.orderAsc ? av - bv : bv - av;
          });
        }
        if (this.limitN !== null) rows = rows.slice(0, this.limitN);
        return { data: rows, error: null };
      }
      if (this.op === "insert") {
        const row = { id: crypto.randomUUID(), ...this.insertRow };
        tableRows(this.table).push(row);
        return { data: [row], error: null };
      }
      if (this.op === "update") {
        for (const row of this.matching()) Object.assign(row, this.updateRow);
        return { data: null, error: null };
      }
      if (this.op === "delete") {
        const toDelete = new Set(this.matching());
        storeRef.current[this.table] = tableRows(this.table).filter((r) => !toDelete.has(r));
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
  }

  class MockRlsClient {
    from(table: string) {
      return new MockQueryBuilder(table);
    }
  }

  return { storeRef, tableRows, MockRlsClient };
});

const requireStaffTenantMock = vi.fn();

vi.mock("@/lib/auth/staff", () => ({
  requireStaffTenant: () => requireStaffTenantMock(),
  requireAdminTenant: () => requireStaffTenantMock(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createModule, deleteModule, moveModule } from "./actions";

const TENANT = { id: "tenant-1" };

function formDataWithTitle(title: string): FormData {
  const fd = new FormData();
  fd.set("title", title);
  return fd;
}

beforeEach(() => {
  storeRef.current = { modules: [] };
  requireStaffTenantMock.mockResolvedValue({ tenant: TENANT, supabase: new MockRlsClient() });
});

describe("createModule — Positions-Duplikat nach Löschen (verifizierter Fehler, behoben)", () => {
  it("Module A(0)/B(1)/C(2) anlegen, B löschen, D anlegen: D bekommt eine NEUE Position, kein Duplikat mit C", async () => {
    const courseId = "course-1";

    const a = await createModule(courseId, { error: null }, formDataWithTitle("A"));
    const b = await createModule(courseId, { error: null }, formDataWithTitle("B"));
    const c = await createModule(courseId, { error: null }, formDataWithTitle("C"));
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(c.error).toBeNull();

    const rowsBeforeDelete = tableRows("modules") as Array<{ id: string; title: string; position: number }>;
    expect(rowsBeforeDelete.map((r) => r.position).sort()).toEqual([0, 1, 2]);
    const moduleB = rowsBeforeDelete.find((r) => r.title === "B")!;
    const moduleC = rowsBeforeDelete.find((r) => r.title === "C")!;

    // B löschen — mit der alten `count`-Logik wäre die Zeilenanzahl danach 2,
    // exakt die Position von C.
    const deleteResult = await deleteModule(moduleB.id, courseId);
    expect(deleteResult.error).toBeNull();

    const d = await createModule(courseId, { error: null }, formDataWithTitle("D"));
    expect(d.error).toBeNull();

    const rowsAfter = tableRows("modules") as Array<{ id: string; title: string; position: number }>;
    const moduleD = rowsAfter.find((r) => r.title === "D")!;

    // Der eigentliche Fehler: mit `count` statt `max(position)+1` wäre
    // `moduleD.position === moduleC.position` (beide 2).
    expect(moduleD.position).not.toBe(moduleC.position);
    expect(moduleD.position).toBe(3); // max(0,2) + 1

    // Alle verbleibenden Positionen sind jetzt eindeutig — kein Duplikat.
    const positions = rowsAfter.map((r) => r.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("moveModule funktioniert nach dem Löschen/Neuanlegen weiterhin (Auf/Ab-Button nicht lahmgelegt)", async () => {
    const courseId = "course-1";
    await createModule(courseId, { error: null }, formDataWithTitle("A"));
    await createModule(courseId, { error: null }, formDataWithTitle("B"));
    await createModule(courseId, { error: null }, formDataWithTitle("C"));

    const moduleB = (tableRows("modules") as Array<{ id: string; title: string }>).find((r) => r.title === "B")!;
    await deleteModule(moduleB.id, courseId);
    await createModule(courseId, { error: null }, formDataWithTitle("D"));

    const rows = tableRows("modules") as Array<{ id: string; title: string; position: number }>;
    const moduleC = rows.find((r) => r.title === "C")!;
    const moduleD = rows.find((r) => r.title === "D")!;
    const positionCBefore = moduleC.position;
    const positionDBefore = moduleD.position;
    expect(positionCBefore).not.toBe(positionDBefore); // Vorbedingung: kein Duplikat (siehe Test oben)

    // D nach oben verschieben — muss die Position mit C tauschen (dem
    // direkten Vorgänger), NICHT ein No-Op sein.
    const moveResult = await moveModule(moduleD.id, courseId, "up");
    expect(moveResult.error).toBeNull();

    const rowsAfterMove = tableRows("modules") as Array<{ id: string; title: string; position: number }>;
    const moduleCAfter = rowsAfterMove.find((r) => r.title === "C")!;
    const moduleDAfter = rowsAfterMove.find((r) => r.title === "D")!;
    expect(moduleDAfter.position).toBe(positionCBefore);
    expect(moduleCAfter.position).toBe(positionDBefore);
  });
});
