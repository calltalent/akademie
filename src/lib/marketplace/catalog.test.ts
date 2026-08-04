import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Marketplace M4 — Tests für `src/lib/marketplace/catalog.ts`
 * (`tester`-Agent-Lauf, 03.08.2026).
 *
 * ABWEICHUNG von `src/lib/marketplace/schema.test.ts` (M2): dort wurde ein
 * Mock für `@/lib/supabase/admin` bewusst ausgelassen, weil im Projekt zu
 * dem Zeitpunkt kein etabliertes Muster existierte und der geprüfte Code
 * (`resolveUniquePublicSlug()`) im Kern eine Kollisionsschleife gegen eine
 * echte DB ist — ein Mock hätte dort nur die Mock-Implementierung selbst
 * getestet. `catalog.ts` liegt anders: laut eigenem Kopfkommentar "der
 * sicherheitskritischste Block bisher" (einziger vollständig anonymer,
 * mandantenübergreifender Lesezugriff im Projekt), und die eigentliche
 * Prüflast liegt NICHT in der SQL-Abfrage selbst, sondern in der
 * Anwendungslogik danach (`buildPublicListings()`: welche Felder werden
 * durchgereicht, welche Zeilen werden herausgefiltert, wie werden Minuten/
 * Modul-/Lektionszahlen aggregiert). Genau das lässt sich mit einem Mock
 * sinnvoll und isoliert testen, ohne eine echte DB zu brauchen — deshalb
 * hier ein eigener, kleiner In-Memory-Query-Builder (kein bestehendes
 * Projekt-Muster gefunden, `grep -rl "supabase/admin" src --include="*.test.ts"`
 * lieferte vor dieser Datei nur `schema.test.ts`, das den Mock explizit
 * NICHT einführt).
 *
 * Der Mock bildet `.select().eq()/.in()/.order()/.maybeSingle()` nach und
 * wendet `.eq()`/`.in()` ECHT auf die Fixture-Zeilen an (kein reines
 * Attrappen-Objekt, das jede Kette ignoriert) — damit prüfen die Tests auch,
 * dass `catalog.ts` tatsächlich mit den richtigen Spaltennamen/Werten
 * filtert (z. B. `lessons.status = 'published'`), nicht nur, dass die
 * JS-Aggregation nach dem Laden stimmt.
 */

type Row = Record<string, unknown>;

const { fixturesRef, MockQueryBuilder } = vi.hoisted(() => {
  class MockQueryBuilder implements PromiseLike<{ data: Row[]; error: null }> {
    private rows: Row[];
    constructor(rows: Row[]) {
      this.rows = rows;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
    select(_columns: string): this {
      return this;
    }
    eq(column: string, value: unknown): this {
      this.rows = this.rows.filter((row) => row[column] === value);
      return this;
    }
    in(column: string, values: unknown[]): this {
      const set = new Set(values);
      this.rows = this.rows.filter((row) => set.has(row[column]));
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().order(col, opts) passen, der Mock sortiert die Fixture-Zeilen nicht (Tests bestätigen Inhalt, nicht Reihenfolge)
    order(_column: string, _opts?: unknown): this {
      return this;
    }
    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.rows[0] ?? null, error: null });
    }
    then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
    }
  }

  const fixturesRef: { current: Record<string, Row[]> } = { current: {} };
  return { fixturesRef, MockQueryBuilder };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => new MockQueryBuilder([...(fixturesRef.current[table] ?? [])]),
  }),
}));

// Normaler statischer Import, obwohl er hier NACH vi.mock()/vi.hoisted()
// steht: Vitest hoisted `import`-Deklarationen und `vi.mock()`-Aufrufe
// beide automatisch an den Dateianfang (offizielles vi.hoisted-Muster) —
// die Position hier dient nur der Lesbarkeit (Mock-Aufbau vor Verwendung).
import { getListingSellerLink, getPublicListing, listPublicListings } from "./catalog";

type Fixtures = {
  marketplace_listings: Row[];
  tenants: Row[];
  courses: Row[];
  course_categories: Row[];
  modules: Row[];
  lessons: Row[];
};

function setFixtures(overrides: Partial<Fixtures>): void {
  fixturesRef.current = {
    marketplace_listings: [],
    tenants: [],
    courses: [],
    course_categories: [],
    modules: [],
    lessons: [],
    ...overrides,
  };
}

const TENANT_ACTIVE: Row = { id: "tenant-1", slug: "acme", name: "Acme GmbH", status: "active" };
const TENANT_SUSPENDED: Row = { id: "tenant-2", slug: "gesperrt", name: "Gesperrt GmbH", status: "suspended" };

const COURSE_PUBLISHED: Row = { id: "course-1", title: "Kurs A", status: "published", category_id: "cat-1" };
const COURSE_DRAFT: Row = { id: "course-2", title: "Kurs B (Entwurf)", status: "draft", category_id: "cat-1" };
const COURSE_NO_CATEGORY: Row = {
  id: "course-3",
  title: "Kurs C ohne Kategorie",
  status: "published",
  category_id: null,
};

const CATEGORY: Row = { id: "cat-1", name: "Vertrieb" };

function listing(overrides: Partial<Row> = {}): Row {
  return {
    id: "listing-1",
    tenant_id: "tenant-1",
    course_id: "course-1",
    public_slug: "kurs-a",
    headline: "Werde zum Vertriebsprofi",
    summary: "Ein toller Kurs.",
    cover_url: "https://cdn.example.test/cover.jpg",
    price_cents: 4900,
    currency: "eur",
    status: "approved",
    enabled: true,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  setFixtures({});
});

describe("listPublicListings — Feldschutz (sicherheitskritisch)", () => {
  it("gibt NIE tenant_id/course_id/product_id/review_note/reviewed_by/status/enabled zurück, auch nicht als zusätzliches Feld", async () => {
    setFixtures({
      marketplace_listings: [listing()],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED],
      course_categories: [CATEGORY],
      modules: [],
      lessons: [],
    });

    const listings = await listPublicListings();
    expect(listings).toHaveLength(1);
    expect(Object.keys(listings[0]).sort()).toEqual(
      [
        "categoryName",
        "coverUrl",
        "currency",
        "headline",
        "isFree",
        "lessonCount",
        "moduleCount",
        "priceCents",
        "sellerName",
        "sellerSlug",
        "slug",
        "summary",
        "totalMinutes",
      ].sort(),
    );
    // Explizit auch die konkreten Feldnamen aus dem Auftragstext, falls sich
    // die Liste oben je verändert und die Absicht dieses Tests verwässert:
    for (const forbidden of ["tenant_id", "course_id", "product_id", "review_note", "reviewed_by", "status", "enabled"]) {
      expect(listings[0]).not.toHaveProperty(forbidden);
    }
  });
});

describe("listPublicListings — Sichtbarkeitsfilter", () => {
  it("filtert ein Listing heraus, dessen Mandant nicht status='active' ist", async () => {
    setFixtures({
      marketplace_listings: [listing({ id: "l1", tenant_id: "tenant-1", public_slug: "aktiv" }), listing({ id: "l2", tenant_id: "tenant-2", public_slug: "gesperrt" })],
      tenants: [TENANT_ACTIVE, TENANT_SUSPENDED],
      courses: [COURSE_PUBLISHED],
      course_categories: [CATEGORY],
    });

    const listings = await listPublicListings();
    expect(listings.map((l) => l.slug)).toEqual(["aktiv"]);
  });

  it("filtert ein Listing heraus, dessen Kurs nicht status='published' ist", async () => {
    setFixtures({
      marketplace_listings: [
        listing({ id: "l1", course_id: "course-1", public_slug: "veroeffentlicht" }),
        listing({ id: "l2", course_id: "course-2", public_slug: "entwurf" }),
      ],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED, COURSE_DRAFT],
      course_categories: [CATEGORY],
    });

    const listings = await listPublicListings();
    expect(listings.map((l) => l.slug)).toEqual(["veroeffentlicht"]);
  });

  it("berücksichtigt nur Listings mit status='approved' UND enabled=true (Pflichtfilter der SQL-Abfrage)", async () => {
    setFixtures({
      marketplace_listings: [
        listing({ id: "l1", public_slug: "genehmigt", status: "approved", enabled: true }),
        listing({ id: "l2", public_slug: "wartet", status: "pending", enabled: true }),
        listing({ id: "l3", public_slug: "deaktiviert", status: "approved", enabled: false }),
      ],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED],
      course_categories: [CATEGORY],
    });

    const listings = await listPublicListings();
    expect(listings.map((l) => l.slug)).toEqual(["genehmigt"]);
  });
});

describe("listPublicListings — Feldableitungen", () => {
  it("headline fällt auf course.title zurück, wenn marketplace_listings.headline leer/null ist", async () => {
    setFixtures({
      marketplace_listings: [
        listing({ id: "l1", public_slug: "mit-headline", headline: "Eigene Headline" }),
        listing({ id: "l2", public_slug: "ohne-headline", headline: null }),
        listing({ id: "l3", public_slug: "leere-headline", headline: "   " }),
      ],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED],
      course_categories: [CATEGORY],
    });

    const listings = await listPublicListings();
    const bySlug = new Map(listings.map((l) => [l.slug, l]));
    expect(bySlug.get("mit-headline")?.headline).toBe("Eigene Headline");
    expect(bySlug.get("ohne-headline")?.headline).toBe("Kurs A");
    expect(bySlug.get("leere-headline")?.headline).toBe("Kurs A");
  });

  it("isFree ist true genau bei price_cents=0, sonst false", async () => {
    setFixtures({
      marketplace_listings: [
        listing({ id: "l1", public_slug: "gratis", price_cents: 0 }),
        listing({ id: "l2", public_slug: "kostenpflichtig", price_cents: 100 }),
      ],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED],
      course_categories: [CATEGORY],
    });

    const listings = await listPublicListings();
    const bySlug = new Map(listings.map((l) => [l.slug, l]));
    expect(bySlug.get("gratis")?.isFree).toBe(true);
    expect(bySlug.get("kostenpflichtig")?.isFree).toBe(false);
  });

  it("categoryName ist null, wenn course.category_id fehlt", async () => {
    setFixtures({
      marketplace_listings: [listing({ course_id: "course-3", public_slug: "ohne-kategorie" })],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_NO_CATEGORY],
      course_categories: [CATEGORY],
    });

    const listings = await listPublicListings();
    expect(listings[0].categoryName).toBeNull();
  });

  it("aggregiert moduleCount/lessonCount/totalMinutes korrekt über mehrere Module, nur lessons.status='published' zählt", async () => {
    setFixtures({
      marketplace_listings: [listing()],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED],
      course_categories: [CATEGORY],
      modules: [
        { id: "mod-1", course_id: "course-1" },
        { id: "mod-2", course_id: "course-1" },
      ],
      lessons: [
        { module_id: "mod-1", video_duration_s: 600, status: "published" },
        { module_id: "mod-2", video_duration_s: 900, status: "published" },
        // Entwurf mit absichtlich riesiger Dauer — muss vollständig
        // ignoriert werden (weder Zählung noch Minutensumme).
        { module_id: "mod-1", video_duration_s: 100000, status: "draft" },
      ],
    });

    const listings = await listPublicListings();
    expect(listings).toHaveLength(1);
    expect(listings[0].moduleCount).toBe(2);
    expect(listings[0].lessonCount).toBe(2);
    expect(listings[0].totalMinutes).toBe(25); // (600 + 900) / 60 = 25
  });

  it("zählt Module/Lektionen eines fremden Kurses nicht mit (keine Kurs-Vermischung)", async () => {
    setFixtures({
      marketplace_listings: [listing({ course_id: "course-1" })],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED, { id: "course-9", title: "Fremdkurs", status: "published", category_id: null }],
      course_categories: [CATEGORY],
      modules: [
        { id: "mod-1", course_id: "course-1" },
        { id: "mod-9", course_id: "course-9" },
      ],
      lessons: [
        { module_id: "mod-1", video_duration_s: 300, status: "published" },
        { module_id: "mod-9", video_duration_s: 999, status: "published" },
      ],
    });

    const listings = await listPublicListings();
    expect(listings[0].moduleCount).toBe(1);
    expect(listings[0].lessonCount).toBe(1);
    expect(listings[0].totalMinutes).toBe(5);
  });
});

describe("listPublicListings — filter.categoryName", () => {
  it("filtert das Ergebnis auf die angegebene Kategorie", async () => {
    setFixtures({
      marketplace_listings: [
        listing({ id: "l1", course_id: "course-1", public_slug: "vertrieb-kurs" }),
        listing({ id: "l2", course_id: "course-3", public_slug: "ohne-kategorie-kurs" }),
      ],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED, COURSE_NO_CATEGORY],
      course_categories: [CATEGORY],
    });

    const listings = await listPublicListings({ categoryName: "Vertrieb" });
    expect(listings.map((l) => l.slug)).toEqual(["vertrieb-kurs"]);
  });

  it("liefert eine leere Liste bei einer nicht existierenden Kategorie", async () => {
    setFixtures({
      marketplace_listings: [listing()],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED],
      course_categories: [CATEGORY],
    });

    const listings = await listPublicListings({ categoryName: "Gibt es nicht" });
    expect(listings).toEqual([]);
  });
});

describe("getPublicListing", () => {
  it("liefert das passende Listing für einen bekannten Slug", async () => {
    setFixtures({
      marketplace_listings: [listing({ public_slug: "kurs-a" })],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED],
      course_categories: [CATEGORY],
    });

    const result = await getPublicListing("kurs-a");
    expect(result?.slug).toBe("kurs-a");
    expect(result?.sellerSlug).toBe("acme");
  });

  it("liefert null bei einem unbekannten Slug", async () => {
    setFixtures({
      marketplace_listings: [listing({ public_slug: "kurs-a" })],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED],
      course_categories: [CATEGORY],
    });

    const result = await getPublicListing("existiert-nicht");
    expect(result).toBeNull();
  });

  it("liefert null, wenn das Listing nicht status='approved' UND enabled=true ist", async () => {
    setFixtures({
      marketplace_listings: [listing({ public_slug: "wartet-noch", status: "pending" })],
      tenants: [TENANT_ACTIVE],
      courses: [COURSE_PUBLISHED],
      course_categories: [CATEGORY],
    });

    const result = await getPublicListing("wartet-noch");
    expect(result).toBeNull();
  });

  it("liefert null, wenn der Mandant des Listings nicht status='active' ist", async () => {
    setFixtures({
      marketplace_listings: [listing({ public_slug: "kurs-a", tenant_id: "tenant-2" })],
      tenants: [TENANT_SUSPENDED],
      courses: [COURSE_PUBLISHED],
      course_categories: [CATEGORY],
    });

    const result = await getPublicListing("kurs-a");
    expect(result).toBeNull();
  });
});

describe("getListingSellerLink (M5 — Dankeseite)", () => {
  it("liefert Verkäufer-Slug/-Domain und Kurs-Slug/-Titel für ein freigegebenes Listing", async () => {
    setFixtures({
      marketplace_listings: [listing({ public_slug: "kurs-a" })],
      tenants: [{ ...TENANT_ACTIVE, custom_domain: null }],
      courses: [{ ...COURSE_PUBLISHED, slug: "vertriebsprofi" }],
    });

    const result = await getListingSellerLink("kurs-a");
    expect(result).toEqual({
      sellerSlug: "acme",
      sellerCustomDomain: null,
      courseSlug: "vertriebsprofi",
      courseTitle: "Kurs A",
    });
  });

  it("liefert null für ein noch nicht freigegebenes Listing", async () => {
    setFixtures({
      marketplace_listings: [listing({ public_slug: "wartet-noch", status: "submitted" })],
      tenants: [TENANT_ACTIVE],
      courses: [{ ...COURSE_PUBLISHED, slug: "vertriebsprofi" }],
    });

    const result = await getListingSellerLink("wartet-noch");
    expect(result).toBeNull();
  });

  it("liefert null, wenn der Verkäufer-Mandant nicht status='active' ist", async () => {
    setFixtures({
      marketplace_listings: [listing({ public_slug: "kurs-a", tenant_id: "tenant-2" })],
      tenants: [TENANT_SUSPENDED],
      courses: [{ ...COURSE_PUBLISHED, slug: "vertriebsprofi" }],
    });

    const result = await getListingSellerLink("kurs-a");
    expect(result).toBeNull();
  });

  it("liefert null für einen unbekannten Slug", async () => {
    setFixtures({
      marketplace_listings: [listing({ public_slug: "kurs-a" })],
      tenants: [TENANT_ACTIVE],
      courses: [{ ...COURSE_PUBLISHED, slug: "vertriebsprofi" }],
    });

    const result = await getListingSellerLink("existiert-nicht");
    expect(result).toBeNull();
  });
});
