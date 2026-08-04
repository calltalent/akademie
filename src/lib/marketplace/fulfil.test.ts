import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Marketplace M5 — Tests für die reine Provisionsrechnung
 * (`computeCommission()`) und den sicherheitskritischen
 * Zugriffsgewähr-Baustein (`grantMarketplaceAccess()`) in
 * `src/lib/marketplace/fulfil.ts`.
 *
 * Gleiches Grundmuster wie `marketplace/catalog.test.ts` (M4) — dort zuerst
 * für reine SELECT-Ketten etabliert, hier auf `insert`/`upsert` erweitert
 * (kein bestehendes Projekt-Muster für mutierende Admin-Client-Aufrufe
 * gefunden). Der Mock hält `memberships`/`enrollments` als In-Memory-Arrays
 * und wendet `.eq()`-Filter sowie Insert-/Upsert-Konfliktauflösung ECHT auf
 * diese Arrays an — der Test prüft damit tatsächlich das
 * "eine bestehende Rolle wird niemals herabgestuft"-Verhalten (Plan
 * Abschnitt 2), nicht nur eine Attrappe.
 *
 * `handleMarketplacePurchase()` bleibt für den ERFOLGSPFAD bewusst
 * ungetestet (bräuchte zusätzlich einen Stripe-`Checkout.Session`-Fixture UND
 * einen `dispatchWebhookEvent()`/`sendEmail()`-Mock — der eigentliche
 * Prüfwert dieser Funktion liegt im Zusammenspiel mit einer echten
 * Datenbank, siehe Plan Abschnitt "Verifikation": E2E-Test im
 * Stripe-Testmodus statt Unit-Mock). Die beiden NEUEN Wurf-Pfade unten
 * (`orders`-Upsert-Fehler, Listing nicht gefunden) sind davon ausgenommen:
 * beide werfen NACH dem `orders`-Upsert bzw. der `marketplace_listings`-Suche
 * und VOR `grantMarketplaceAccess()`/dem Ledger-Eintrag/dem
 * Bestätigungsmail-Versand — sie erreichen also nie `dispatchWebhookEvent()`
 * oder `sendEmail()` und sind deshalb ohne deren Mocks sicher isolierbar.
 *
 * Sicherheitsfix-Testabdeckung (03.08.2026, security-reviewer PASS MIT
 * ANMERKUNGEN, direkt gefixt): `grantMarketplaceAccess()` und
 * `handleMarketplacePurchase()` werfen jetzt bei DB-Fehlern statt nur zu
 * loggen (Fund 2), der `marketplace_listings`-Lookup filtert zusätzlich auf
 * `tenant_id` (Fund 3). Beide werden unten durch Fehler-Injektion
 * (`tablesRef.errors`) bzw. eine Listing-Zeile unter einem FREMDEN Mandanten
 * abgedeckt.
 */

type Row = Record<string, unknown>;
type MockError = { message: string };

const { tablesRef, MockAdminClient } = vi.hoisted(() => {
  const tablesRef: { current: Record<string, Row[]>; errors: Record<string, MockError | undefined> } = {
    current: {},
    errors: {},
  };

  function tableRows(table: string): Row[] {
    return tablesRef.current[table] ?? (tablesRef.current[table] = []);
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

  // Ergebnis eines `.upsert()`-Aufrufs: sowohl direkt `await`-bar (Verhalten
  // unverändert gegenüber vorher — reine Umbenennung von "gibt ein Promise
  // zurück" zu "gibt ein Thenable zurück", `await` behandelt beides
  // identisch) ALS AUCH über `.select(cols).single()` verkettbar, wie es
  // `handleMarketplacePurchase()`s `orders`-Upsert braucht
  // (`.upsert(...).select("id").single()`). Fehler-Injektion über
  // `tablesRef.errors[table]` VOR jeder Lese-/Schreiblogik geprüft, damit ein
  // simulierter DB-Fehler den Mock-Zustand nicht verändert (wie beim echten
  // Supabase-Client).
  class MockUpsertResult {
    constructor(
      private table: string,
      private row: Row,
      private opts: { onConflict: string; ignoreDuplicates?: boolean },
    ) {}
    private resolve(): { data: Row | null; error: MockError | null } {
      const err = tablesRef.errors[this.table];
      if (err) return { data: null, error: err };
      const keys = this.opts.onConflict.split(",");
      const rows = tableRows(this.table);
      const idx = rows.findIndex((r) => keys.every((k) => r[k] === this.row[k]));
      let stored: Row;
      if (idx >= 0) {
        if (!this.opts.ignoreDuplicates) rows[idx] = { ...rows[idx], ...this.row };
        stored = rows[idx];
      } else {
        stored = { ...this.row };
        rows.push(stored);
      }
      return { data: stored, error: null };
    }
    then<T>(onFulfilled: (v: { error: MockError | null }) => T): Promise<T> {
      const { error } = this.resolve();
      return Promise.resolve(onFulfilled({ error }));
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().upsert().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
    select(_columns: string) {
      return {
        single: (): Promise<{ data: Row | null; error: MockError | null }> => Promise.resolve(this.resolve()),
      };
    }
  }

  class MockTable {
    constructor(private table: string) {}
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
    select(_columns: string): MockSelect {
      return new MockSelect([...tableRows(this.table)]);
    }
    insert(row: Row): Promise<{ error: MockError | null }> {
      const err = tablesRef.errors[this.table];
      if (err) return Promise.resolve({ error: err });
      tableRows(this.table).push({ ...row });
      return Promise.resolve({ error: null });
    }
    upsert(row: Row, opts: { onConflict: string; ignoreDuplicates?: boolean }): MockUpsertResult {
      return new MockUpsertResult(this.table, row, opts);
    }
  }

  class MockAdminClient {
    from(table: string): MockTable {
      return new MockTable(table);
    }
  }

  return { tablesRef, MockAdminClient };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => new MockAdminClient(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { computeCommission, grantMarketplaceAccess, handleMarketplacePurchase } from "./fulfil";
import type Stripe from "stripe";
import type { MarketplaceCheckoutMetadata } from "@/lib/stripe/schema";

function mockAdmin(): Parameters<typeof grantMarketplaceAccess>[0] {
  return createAdminClient() as unknown as Parameters<typeof grantMarketplaceAccess>[0];
}

function fakeSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_123",
    payment_intent: "pi_test_123",
    amount_total: 4900,
    currency: "eur",
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

function fakeMetadata(overrides: Partial<MarketplaceCheckoutMetadata> = {}): MarketplaceCheckoutMetadata {
  return {
    tenant_id: "tenant-1",
    product_id: "product-1",
    user_id: "user-1",
    listing_id: "listing-1",
    source: "marketplace",
    ...overrides,
  };
}

beforeEach(() => {
  tablesRef.current = {};
  tablesRef.errors = {};
});

describe("computeCommission", () => {
  it("berechnet 20 % Provision auf 4900 Cent (49,00 EUR)", () => {
    expect(computeCommission(4900, 2000)).toEqual({ commissionCents: 980, netCents: 3920 });
  });

  it("rundet per floor ab statt kaufmännisch (999 * 2000 / 10000 = 199,8)", () => {
    expect(computeCommission(999, 2000)).toEqual({ commissionCents: 199, netCents: 800 });
  });

  it("liefert 0 Provision bei 0 % Satz", () => {
    expect(computeCommission(5000, 0)).toEqual({ commissionCents: 0, netCents: 5000 });
  });

  it("liefert den vollen Bruttobetrag als Provision bei 100 % Satz", () => {
    expect(computeCommission(5000, 10000)).toEqual({ commissionCents: 5000, netCents: 0 });
  });

  it("klammert `rateBp` NICHT selbst auf [0, 10000] — bewusste Design-Entscheidung, siehe unten", () => {
    // Security-reviewer-Fund (03.08.2026, NIEDRIG, behoben): die Klammerung
    // `Math.min(Math.max(rawRateBp, 0), 10000)` sitzt in `handleMarketplacePurchase()`
    // (Aufrufer), UNMITTELBAR bevor `computeCommission()` aufgerufen wird — nicht in
    // dieser Funktion selbst. Dieser Test pinnt genau das: `computeCommission()`
    // bleibt eine reine, vertrauensvolle Rechenfunktion ohne eigene Eingabeprüfung;
    // ein Wert außerhalb [0, 10000] (hier 15000 = 150 %) erzeugt hier absichtlich
    // eine Provision GRÖSSER als der Bruttobetrag und ein negatives `netCents` —
    // das ist kein Bug dieser Funktion, sondern der Beleg dafür, dass die
    // Verantwortung beim Aufrufer liegt. Ein Test, der hier stattdessen eine
    // Klammerung erwartet, wäre falsch (testet eine Garantie, die diese Funktion
    // nie gegeben hat) und würde bei einer legitimen künftigen Änderung an
    // `handleMarketplacePurchase()`s Klammerung fälschlich rot werden.
    expect(computeCommission(5000, 15000)).toEqual({ commissionCents: 7500, netCents: -2500 });
  });
});

describe("grantMarketplaceAccess — Sicherheitskern (Plan Abschnitt 2)", () => {
  it("legt eine neue guest-Mitgliedschaft mit source='marketplace' an, wenn noch keine existiert", async () => {
    await grantMarketplaceAccess(mockAdmin(), "tenant-1", "user-1", "course-1");
    expect(tablesRef.current.memberships).toEqual([
      { tenant_id: "tenant-1", user_id: "user-1", role: "guest", source: "marketplace", status: "active" },
    ]);
  });

  it("stuft eine bestehende member-Mitgliedschaft NIEMALS auf guest herab", async () => {
    tablesRef.current.memberships = [{ id: "m1", tenant_id: "tenant-1", user_id: "user-1", role: "member" }];

    await grantMarketplaceAccess(mockAdmin(), "tenant-1", "user-1", "course-1");

    expect(tablesRef.current.memberships).toEqual([
      { id: "m1", tenant_id: "tenant-1", user_id: "user-1", role: "member" },
    ]);
  });

  it("rührt eine bereits bestehende guest-Mitgliedschaft nicht an", async () => {
    tablesRef.current.memberships = [
      { id: "m1", tenant_id: "tenant-1", user_id: "user-1", role: "guest", source: "marketplace", status: "active" },
    ];

    await grantMarketplaceAccess(mockAdmin(), "tenant-1", "user-1", "course-1");

    expect(tablesRef.current.memberships).toHaveLength(1);
  });

  it("legt eine enrollments-Zeile an und meldet enrollmentCreated=true bei Neuanlage", async () => {
    const result = await grantMarketplaceAccess(mockAdmin(), "tenant-1", "user-1", "course-1");

    expect(result.enrollmentCreated).toBe(true);
    expect(tablesRef.current.enrollments).toEqual([
      { tenant_id: "tenant-1", course_id: "course-1", user_id: "user-1", source: "marketplace" },
    ]);
  });

  it("meldet enrollmentCreated=false, wenn bereits eine Einschreibung existiert (Idempotenz, z. B. Webhook-Retry)", async () => {
    tablesRef.current.enrollments = [
      { id: "e1", tenant_id: "tenant-1", course_id: "course-1", user_id: "user-1", source: "purchase" },
    ];

    const result = await grantMarketplaceAccess(mockAdmin(), "tenant-1", "user-1", "course-1");

    expect(result.enrollmentCreated).toBe(false);
  });

  it("wirft, wenn der memberships-Insert fehlschlägt (security-reviewer-Fund 2, behoben)", async () => {
    // Vorher: stiller Fehlschlag -> is_marketplace_guest() bleibt dauerhaft
    // false, sämtliche *_guest_select-Policies blockieren den Kurs, obwohl
    // die enrollments-Zeile ggf. erfolgreich angelegt worden wäre. Jetzt:
    // Wurf, damit der Webhook mit 500 antwortet und Stripe erneut zustellt.
    tablesRef.errors.memberships = { message: "insert fehlgeschlagen (simuliert)" };

    await expect(grantMarketplaceAccess(mockAdmin(), "tenant-1", "user-1", "course-1")).rejects.toThrow(
      /memberships-Insert fehlgeschlagen/,
    );
  });

  it("wirft NICHT beim memberships-Fehler, wenn bereits eine Mitgliedschaft existiert (Insert wird gar nicht erst versucht)", async () => {
    tablesRef.current.memberships = [{ id: "m1", tenant_id: "tenant-1", user_id: "user-1", role: "member" }];
    tablesRef.errors.memberships = { message: "insert fehlgeschlagen (simuliert)" };

    await expect(
      grantMarketplaceAccess(mockAdmin(), "tenant-1", "user-1", "course-1"),
    ).resolves.toEqual({ enrollmentCreated: true });
  });

  it("wirft, wenn der enrollments-Upsert fehlschlägt (security-reviewer-Fund 2, behoben)", async () => {
    // Gleiche Begründung wie beim memberships-Insert-Test oben: vorher
    // stiller Fehlschlag, jetzt Wurf für den Stripe-Retry-Mechanismus.
    tablesRef.errors.enrollments = { message: "upsert fehlgeschlagen (simuliert)" };

    await expect(grantMarketplaceAccess(mockAdmin(), "tenant-1", "user-1", "course-1")).rejects.toThrow(
      /enrollments-Upsert fehlgeschlagen/,
    );
    // Die memberships-Zeile wurde trotzdem angelegt (Reihenfolge in
    // grantMarketplaceAccess: memberships zuerst, dann enrollments) — kein
    // Rollback, entspricht dem bestehenden Verhalten ohne Transaktion.
    expect(tablesRef.current.memberships).toHaveLength(1);
  });
});

describe("handleMarketplacePurchase — Wurf-Pfade (security-reviewer-Fund 2 + 3, behoben)", () => {
  it("wirft, wenn der orders-Upsert fehlschlägt, statt still zurückzukehren", async () => {
    // Vorher: stiller `return` — der Kunde hätte bei Stripe bezahlt, aber nie
    // Zugriff bekommen, und ohne 500-Antwort hätte Stripe das Event nie
    // erneut zugestellt. Der Wurf passiert VOR dem marketplace_listings-Lookup,
    // vor grantMarketplaceAccess() und vor dem Ledger-/Mail-Versand — deshalb
    // hier ohne zusätzliche Mocks für dispatchWebhookEvent()/sendEmail()
    // sicher isolierbar (siehe Kopfkommentar dieser Datei).
    tablesRef.errors.orders = { message: "orders-Upsert fehlgeschlagen (simuliert)" };

    await expect(
      handleMarketplacePurchase(mockAdmin(), fakeSession(), fakeMetadata()),
    ).rejects.toThrow(/orders-Upsert fehlgeschlagen/);
  });

  it("wirft, wenn kein Listing zur listing_id gefunden wird, statt still zurückzukehren", async () => {
    // Vorher: stiller `return` bei fehlendem Listing. Kein Listing in
    // tablesRef.current.marketplace_listings angelegt -> maybeSingle()
    // liefert null -> Wurf. Passiert nach dem (hier erfolgreichen)
    // orders-Upsert, aber VOR grantMarketplaceAccess()/Ledger/Mail.
    await expect(
      handleMarketplacePurchase(mockAdmin(), fakeSession(), fakeMetadata()),
    ).rejects.toThrow(/Listing für Erfüllung nicht gefunden/);
  });

  it("behandelt ein Listing eines FREMDEN Mandanten als 'nicht gefunden' (tenant_id-Filter, Fund 3, behoben)", async () => {
    // Security-reviewer-Fund (03.08.2026, NIEDRIG, behoben): der
    // marketplace_listings-Lookup filtert jetzt zusätzlich auf tenant_id.
    // Dieses Listing existiert (listing_id passt), gehört aber zu einem
    // ANDEREN Mandanten als metadata.tenant_id — der Lookup muss es trotzdem
    // als nicht gefunden behandeln (Defense-in-Depth, siehe fulfil.ts-Kommentar).
    tablesRef.current.marketplace_listings = [
      { id: "listing-1", tenant_id: "tenant-FREMD", course_id: "course-1" },
    ];

    await expect(
      handleMarketplacePurchase(mockAdmin(), fakeSession(), fakeMetadata({ tenant_id: "tenant-1" })),
    ).rejects.toThrow(/Listing für Erfüllung nicht gefunden/);
  });
});
