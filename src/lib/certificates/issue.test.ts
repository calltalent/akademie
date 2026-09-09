import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeCourseProgress } from "@/lib/progress/compute";
import { generateCertificateSerial } from "@/lib/certificates/serial";
import { safeAccentColor } from "@/lib/email/templates";

/**
 * `issue.ts` selbst hat `import "server-only"` und braucht einen echten
 * Supabase-Admin-Client (DB/Storage) — deshalb wird hier NICHT `issue.ts`
 * importiert (kein Mocking-Aufwand für einen Sandbox-Block), sondern nur
 * die isolierbaren, reinen Bausteine, die `issue.ts` tatsächlich nutzt:
 * - Eignungsprüfung: dieselbe `computeCourseProgress()`-Funktion, mit der
 *   `issue.ts` intern die Vollständigkeit neu berechnet.
 * - Seriennummer-Format (`serial.ts`).
 * - Hex-Farbvalidierung (`safeAccentColor` aus email/templates.ts, von
 *   `pdf.ts` wiederverwendet statt dupliziert, siehe dortiger Kommentar).
 */

describe("Zertifikats-Eignungsprüfung (isComplete aus computeCourseProgress)", () => {
  it("ist NICHT erfüllt, wenn keine Lektion abgeschlossen ist", () => {
    const progress = computeCourseProgress([
      {
        id: "m1",
        lessons: [
          { id: "l1", completed: false },
          { id: "l2", completed: false },
        ],
      },
    ]);
    expect(progress.isComplete).toBe(false);
  });

  it("ist NICHT erfüllt, wenn nur ein Teil der Lektionen abgeschlossen ist", () => {
    const progress = computeCourseProgress([
      {
        id: "m1",
        lessons: [
          { id: "l1", completed: true },
          { id: "l2", completed: false },
        ],
      },
    ]);
    expect(progress.isComplete).toBe(false);
  });

  it("ist erfüllt, wenn alle veröffentlichten Lektionen über alle Module hinweg abgeschlossen sind", () => {
    const progress = computeCourseProgress([
      { id: "m1", lessons: [{ id: "l1", completed: true }] },
      {
        id: "m2",
        lessons: [
          { id: "l2", completed: true },
          { id: "l3", completed: true },
        ],
      },
    ]);
    expect(progress.isComplete).toBe(true);
  });

  it("ist NICHT erfüllt bei einem Kurs ohne (veröffentlichte) Lektionen", () => {
    const progress = computeCourseProgress([]);
    expect(progress.isComplete).toBe(false);
  });
});

describe("generateCertificateSerial", () => {
  it("folgt dem Format CT-<Jahr>-<8-stelliger Crockford-Base32-Code>", () => {
    const serial = generateCertificateSerial(new Date("2026-07-11T00:00:00Z"));
    expect(serial).toMatch(/^CT-2026-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  });

  it("nutzt das aktuelle Jahr, wenn kein Datum übergeben wird", () => {
    const serial = generateCertificateSerial();
    expect(serial.startsWith(`CT-${new Date().getFullYear()}-`)).toBe(true);
  });

  it("erzeugt in der Praxis eindeutige Codes (die eigentliche Garantie liefert der DB-Unique-Constraint, nicht diese Funktion)", () => {
    const serials = new Set(Array.from({ length: 200 }, () => generateCertificateSerial()));
    expect(serials.size).toBe(200);
  });
});

describe("Hex-Farbvalidierung (safeAccentColor, wiederverwendet von pdf.ts für die PDF-Akzentfarbe)", () => {
  it("lässt gültige 6-stellige Hex-Werte durch", () => {
    expect(safeAccentColor("#1d4ed8")).toBe("#1d4ed8");
  });

  it("lässt gültige 3-stellige Hex-Werte durch", () => {
    expect(safeAccentColor("#fff")).toBe("#fff");
  });

  it("fällt bei fehlendem Wert auf die neutrale Standardfarbe zurück", () => {
    expect(safeAccentColor(undefined)).toBe("#171717");
  });

  it("fällt bei ungültigem/schädlichem Wert auf die neutrale Standardfarbe zurück", () => {
    expect(safeAccentColor("javascript:alert(1)")).toBe("#171717");
  });
});

/**
 * Regressionstests für den in dieser Sitzung gemeldeten Fund "Verwaiste
 * PDF-Dateien im privaten Bucket" (`issueCertificateIfEligible`, Schritt
 * (e)/(f)): das PDF wird hochgeladen, BEVOR die `certificates`-Zeile
 * geschrieben wird. Schlägt der Insert fehl (23505-Race oder jeder andere
 * Fehler), muss das eben hochgeladene PDF wieder entfernt werden.
 *
 * Anders als der Block oben (der bewusst nur reine Bausteine testet) wird
 * `issue.ts` hier vollständig importiert und über gemockte Module (Admin-
 * Client inkl. Storage, PDF-Erzeugung, E-Mail-Versand, i18n) isoliert —
 * gleiches Grundmuster wie `src/lib/reporting/actions.test.ts`
 * (In-Memory-Store + Mock-Query-Builder für `createAdminClient()`).
 */
type Row = Record<string, unknown>;
type MockError = { message: string; code?: string };

const {
  storeRef,
  uploadedPathsRef,
  removedPathsRef,
  insertErrorRef,
  raceWinnerRowRef,
  MockAdminClient,
} = vi.hoisted(() => {
  const storeRef: { current: Record<string, Row[]> } = { current: {} };
  const uploadedPathsRef: { current: Set<string> } = { current: new Set() };
  const removedPathsRef: { current: string[] } = { current: [] };
  const insertErrorRef: { current: MockError | null } = { current: null };
  const raceWinnerRowRef: { current: Row | null } = { current: null };

  function tableRows(table: string): Row[] {
    return storeRef.current[table] ?? (storeRef.current[table] = []);
  }

  class MockQuery {
    private filters: Array<(r: Row) => boolean> = [];
    private pendingInsert: Row | null = null;

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
    insert(row: Row): this {
      this.pendingInsert = { id: `generated-${tableRows(this.table).length + 1}`, ...row };
      return this;
    }

    private matching(): Row[] {
      return tableRows(this.table).filter((r) => this.filters.every((f) => f(r)));
    }

    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.matching()[0] ?? null, error: null });
    }

    single(): Promise<{ data: Row | null; error: MockError | null }> {
      if (this.pendingInsert) {
        const err = insertErrorRef.current;
        if (err) {
          // Race-Simulation: die "gewinnende" parallele Transaktion committet
          // genau in dem Moment, in dem unser eigener Insert am Unique-
          // Constraint scheitert — VOR unserem eigenen Insert war noch nichts
          // im Store (sonst hätte bereits die Idempotenz-Vorprüfung in
          // issue.ts zugeschlagen und wir wären nie bis hierher gekommen).
          if (raceWinnerRowRef.current) {
            tableRows(this.table).push(raceWinnerRowRef.current);
          }
          return Promise.resolve({ data: null, error: err });
        }
        tableRows(this.table).push(this.pendingInsert);
        return Promise.resolve({ data: this.pendingInsert, error: null });
      }
      return Promise.resolve({ data: this.matching()[0] ?? null, error: null });
    }

    then<T>(onFulfilled: (v: { data: Row[]; error: null }) => T): Promise<T> {
      return Promise.resolve(onFulfilled({ data: this.matching(), error: null }));
    }
  }

  class MockAdminClient {
    storage = {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Bucket-Name wird im Mock nicht gebraucht (nur ein Bucket im Test)
      from: (_bucket: string) => ({
        upload: (path: string) => {
          uploadedPathsRef.current.add(path);
          return Promise.resolve({ data: { path }, error: null });
        },
        remove: (paths: string[]) => {
          for (const p of paths) {
            uploadedPathsRef.current.delete(p);
            removedPathsRef.current.push(p);
          }
          return Promise.resolve({ data: paths.map((p) => ({ name: p })), error: null });
        },
      }),
    };
    from(table: string) {
      return new MockQuery(table);
    }
  }

  return { storeRef, uploadedPathsRef, removedPathsRef, insertErrorRef, raceWinnerRowRef, MockAdminClient };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => new MockAdminClient(),
}));
vi.mock("@/lib/certificates/pdf", () => ({
  generateCertificatePdf: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));
vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/lib/email/templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/templates")>();
  return { ...actual, certificateIssued: vi.fn().mockResolvedValue("<html></html>") };
});
vi.mock("@/i18n/config", () => ({
  resolveTenantEmailLocale: vi.fn().mockReturnValue("de"),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}));

const { issueCertificateIfEligible } = await import("./issue");

const TENANT_ID = "tenant-1";
const COURSE_ID = "course-1";
const USER_ID = "learner-1";

beforeEach(() => {
  uploadedPathsRef.current = new Set();
  removedPathsRef.current = [];
  insertErrorRef.current = null;
  raceWinnerRowRef.current = null;
  storeRef.current = {
    courses: [{ id: COURSE_ID, tenant_id: TENANT_ID, title: "Einsteiger-Kurs", settings: {} }],
    modules: [{ id: "mod-1", course_id: COURSE_ID }],
    lessons: [{ id: "lesson-1", module_id: "mod-1", status: "published" }],
    progress: [{ lesson_id: "lesson-1", status: "completed", user_id: USER_ID }],
    tenants: [{ id: TENANT_ID, name: "Calltalent-Akademie", branding: {}, settings: {} }],
    profiles: [{ id: USER_ID, email: "lernende@example.test", full_name: "Lernende Person" }],
    certificates: [],
  };
});

describe("issueCertificateIfEligible — Aufräumen verwaister PDFs nach Upload", () => {
  it("räumt das eben hochgeladene PDF auf, wenn der Insert am 23505-Unique-Constraint scheitert (Race)", async () => {
    // Die Idempotenz-Vorprüfung (Schritt b) findet zu diesem Zeitpunkt noch
    // NICHTS (certificates-Store bleibt bis zum Insert-Versuch leer) — sonst
    // würde issue.ts schon dort früher zurückkehren und nie hochladen. Der
    // parallele "Gewinner" committet seine Zeile erst GENAU in dem Moment,
    // in dem unser eigener Insert am Unique-Constraint scheitert (siehe
    // `raceWinnerRowRef` im Mock oben) — exakt der Race-Zustand aus dem
    // Fund: unser PDF liegt bereits im Bucket, bevor unser eigener Insert
    // das feststellt.
    insertErrorRef.current = { message: "duplicate key value violates unique constraint", code: "23505" };
    raceWinnerRowRef.current = {
      id: "cert-winner",
      tenant_id: TENANT_ID,
      course_id: COURSE_ID,
      user_id: USER_ID,
      pdf_path: "anderer/pfad.pdf",
    };

    const result = await issueCertificateIfEligible(COURSE_ID, USER_ID, TENANT_ID);

    expect(result).toEqual({ ok: true, alreadyExisted: true, certificateId: "cert-winner" });
    // Der eigentliche Rückgabewert bleibt unverändert vom Aufräumen — aber
    // das verwaiste PDF darf danach nicht mehr im Bucket liegen.
    expect(uploadedPathsRef.current.size).toBe(0);
    expect(removedPathsRef.current).toHaveLength(1);
  });

  it("räumt das eben hochgeladene PDF auch bei jedem anderen Insert-Fehler auf", async () => {
    insertErrorRef.current = { message: "connection reset", code: "08006" };

    const result = await issueCertificateIfEligible(COURSE_ID, USER_ID, TENANT_ID);

    expect(result.ok).toBe(false);
    expect(uploadedPathsRef.current.size).toBe(0);
    expect(removedPathsRef.current).toHaveLength(1);
  });

  it("räumt NICHTS auf, wenn der Insert erfolgreich war (kein Grund, das eigene gültige PDF zu löschen)", async () => {
    const result = await issueCertificateIfEligible(COURSE_ID, USER_ID, TENANT_ID);

    expect(result.ok).toBe(true);
    expect(uploadedPathsRef.current.size).toBe(1);
    expect(removedPathsRef.current).toHaveLength(0);
  });
});
