import { describe, expect, it } from "vitest";
import { loadAbsencesForWeek } from "./queries";

/**
 * `tester`-Agent-Lauf — Regressionstest für den Jahreswechsel-Fund in
 * `admin/schichtplanung/page.tsx` (siehe `date.test.ts` für den
 * `getUTCFullYear()`-Teil des Funds): eine Woche kann selbst den
 * Jahreswechsel enthalten (z. B. Woche ab Mo. 28.12.2026, siehe
 * `date.test.ts`) — VOR dem Fix wurde nur ein einziges Jahr geladen, der
 * Feiertag Neujahr des Folgejahrs fehlte dann im Wochenraster komplett.
 *
 * `loadAbsencesForWeek()` (`queries.ts`) ist der aus `page.tsx` extrahierte
 * Baustein, der bei zwei unterschiedlichen Jahren BEIDE lädt und nach `id`
 * dedupliziert.
 */

type Row = Record<string, unknown>;

/** Bildet exakt die Aufrufkette aus `getAdminCalendarAbsences()` nach: `.from().select().eq().lte().gte().order()`, liefert die nach Tenant + Jahres-Überlappung gefilterten Zeilen. */
class FakeAbsencesQuery {
  private tenantId: string | null = null;
  private lteValue = "";
  private gteValue = "";
  constructor(private rows: Row[]) {}
  select(): this {
    return this;
  }
  eq(column: string, value: unknown): this {
    if (column === "tenant_id") this.tenantId = value as string;
    return this;
  }
  lte(_column: string, value: string): this {
    this.lteValue = value;
    return this;
  }
  gte(_column: string, value: string): this {
    this.gteValue = value;
    return this;
  }
  order(): Promise<{ data: Row[] }> {
    const data = this.rows.filter(
      (r) =>
        r.tenant_id === this.tenantId &&
        (r.starts_on as string) <= this.lteValue &&
        (r.ends_on as string) >= this.gteValue,
    );
    return Promise.resolve({ data });
  }
}

class FakeSupabase {
  constructor(private rows: Row[]) {}
  from(table: string) {
    if (table !== "calendar_absences") throw new Error(`Unerwartete Tabelle im Test-Stub: ${table}`);
    return new FakeAbsencesQuery(this.rows);
  }
}

function absenceRow(overrides: Partial<Row>): Row {
  return {
    id: "id",
    tenant_id: "t1",
    worker_id: null,
    kind: "holiday",
    starts_on: "2026-01-01",
    ends_on: "2026-01-01",
    note: null,
    status: "confirmed",
    calendar_workers: null,
    ...overrides,
  };
}

describe("loadAbsencesForWeek", () => {
  it("year === endYear (Normalfall, Woche liegt vollständig in einem Jahr): genau ein Jahr wird geladen", async () => {
    const rows = [
      absenceRow({ id: "weihnachten-2026", starts_on: "2026-12-25", ends_on: "2026-12-26" }),
      absenceRow({ id: "neujahr-2027", starts_on: "2027-01-01", ends_on: "2027-01-01" }),
    ];
    const result = await loadAbsencesForWeek(new FakeSupabase(rows) as never, "t1", 2026, 2026);
    expect(result.map((r) => r.id)).toEqual(["weihnachten-2026"]);
  });

  it("Woche ab Montag 28.12.2026 (endet 03.01.2027, umfasst 2026 UND 2027): Neujahr 2027 fehlt NICHT mehr im Wochenraster", async () => {
    // Konkreter Jahreswechsel-Fund (siehe date.test.ts, "Woche ab Montag
    // 28.12.2026 umfasst zwei Kalenderjahre") — VOR dem Fix hätte
    // `page.tsx` hier nur `getAdminCalendarAbsences(supabase, tenantId, 2026)`
    // aufgerufen (ein einziges Jahr, `weekStart.getUTCFullYear()`), der
    // Feiertag "neujahr-2027" wäre nie geladen worden.
    const rows = [
      absenceRow({ id: "weihnachten-2026", starts_on: "2026-12-25", ends_on: "2026-12-26" }),
      absenceRow({ id: "neujahr-2027", starts_on: "2027-01-01", ends_on: "2027-01-01" }),
    ];
    const result = await loadAbsencesForWeek(new FakeSupabase(rows) as never, "t1", 2026, 2027);
    const ids = result.map((r) => r.id).sort();
    expect(ids).toEqual(["neujahr-2027", "weihnachten-2026"]);
  });

  it("dedupliziert eine Abwesenheit, die den Jahreswechsel selbst überspannt (käme sonst aus beiden Jahres-Abfragen doppelt zurück)", async () => {
    const rows = [absenceRow({ id: "urlaub-jahreswechsel", starts_on: "2026-12-29", ends_on: "2027-01-02" })];
    const result = await loadAbsencesForWeek(new FakeSupabase(rows) as never, "t1", 2026, 2027);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("urlaub-jahreswechsel");
  });

  it("ignoriert Abwesenheiten anderer Mandanten (Tenant-Filter bleibt bei beiden Jahres-Abfragen aktiv)", async () => {
    const rows = [
      absenceRow({ id: "fremd-neujahr", tenant_id: "t2", starts_on: "2027-01-01", ends_on: "2027-01-01" }),
    ];
    const result = await loadAbsencesForWeek(new FakeSupabase(rows) as never, "t1", 2026, 2027);
    expect(result).toEqual([]);
  });
});
