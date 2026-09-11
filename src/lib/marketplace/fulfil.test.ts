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
 * Affiliate B4 (PLAN_Affiliate-System.md 9.6/9.12): der Mock führt jetzt
 * zusätzlich `affiliate_events` — die Outbox, in die
 * `handleMarketplacePurchase()` am Ende ihr Stripe-Ereignis schreibt. Ohne
 * diese Ergänzung liefen die bestehenden Tests still ins Leere (der Mock
 * hätte den Insert klaglos geschluckt, die Aufnahme wäre ungeprüft). Er bildet
 * dafür EINEN echten Constraint nach: `stripe_event_id` ist `not null unique`
 * (Plan 3.10) und damit die einzige Idempotenzquelle der Aufnahme —
 * `recordAffiliateEvent()` erkennt einen Stripe-Retry ausschließlich am
 * PostgREST-Fehlercode `23505` (G2/G3).
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
/**
 * `code` ist neu (Affiliate B4): `recordAffiliateEvent()` unterscheidet
 * ausschließlich über den PostgREST-Fehlercode zwischen „normaler
 * Stripe-Retry" (`23505`, schlucken) und „echter Datenbankfehler" (werfen).
 * Bestehende Injektionen kommen weiterhin ohne `code` aus.
 */
type MockError = { message: string; code?: string };

const { tablesRef, MockAdminClient } = vi.hoisted(() => {
  const tablesRef: { current: Record<string, Row[]>; errors: Record<string, MockError | undefined> } = {
    current: {},
    errors: {},
  };

  function tableRows(table: string): Row[] {
    return tablesRef.current[table] ?? (tablesRef.current[table] = []);
  }

  /**
   * Tabellen mit einem Unique-Constraint auf GENAU EINER Spalte, den der
   * geprüfte Code auswertet. Bewusst eine Erlaubnisliste und keine
   * Allgemeinlösung: nur `affiliate_events.stripe_event_id` hat im hier
   * getesteten Pfad eine Bedeutung (Plan 3.10), und ein Mock, der überall
   * Unique-Verletzungen erfände, brächte die bestehenden
   * `memberships`/`enrollments`-Tests durcheinander.
   */
  const UNIQUE_COLUMNS: Record<string, string> = { affiliate_events: "stripe_event_id" };

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
      // Unique-Verletzung wie in Postgres: Fehlercode `23505`, KEINE Zeile.
      // Genau dieser Code ist für `recordAffiliateEvent()` der Unterschied
      // zwischen „schon aufgenommen" und „werfen" (G2).
      const uniqueColumn = UNIQUE_COLUMNS[this.table];
      if (uniqueColumn !== undefined) {
        const clash = tableRows(this.table).some((r) => r[uniqueColumn] === row[uniqueColumn]);
        if (clash) {
          return Promise.resolve({
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          });
        }
      }
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

// Für den neuen Erfolgspfad-Test unten (Bestätigungsmail nur bei
// tatsächlicher Neuanlage der Order) — bewusst gemockt statt echt, damit der
// Test schnell/deterministisch bleibt und die Aufrufanzahl zählbar ist
// (gleiches Muster wie `certificates/issue.test.ts`).
const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("@/lib/email/client", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/lib/email/templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/templates")>();
  return { ...actual, orderPaid: vi.fn().mockResolvedValue("<html></html>") };
});
vi.mock("@/i18n/config", () => ({ resolveTenantEmailLocale: vi.fn().mockReturnValue("de") }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn().mockResolvedValue((key: string) => key) }));

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

/**
 * Das Stripe-EREIGNIS um die Session herum (Affiliate B4). Es trägt die drei
 * Felder, die auf der Session selbst nicht stehen und die die Outbox-Zeile
 * ausmachen: `id` (Idempotenz), `type` und `livemode` (Plan 4.5,
 * Testbuchung).
 */
function fakeEvent(
  session: Stripe.Checkout.Session,
  overrides: { id?: string; livemode?: boolean } = {},
): Stripe.Event {
  return {
    id: overrides.id ?? "evt_test_123",
    type: "checkout.session.completed",
    livemode: overrides.livemode ?? false,
    created: 1_780_000_000,
    data: { object: session },
  } as unknown as Stripe.Event;
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
  sendEmailMock.mockClear();
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
      handleMarketplacePurchase(mockAdmin(), fakeSession(), fakeMetadata(), fakeEvent(fakeSession())),
    ).rejects.toThrow(/orders-Upsert fehlgeschlagen/);
  });

  it("wirft, wenn kein Listing zur listing_id gefunden wird, statt still zurückzukehren", async () => {
    // Vorher: stiller `return` bei fehlendem Listing. Kein Listing in
    // tablesRef.current.marketplace_listings angelegt -> maybeSingle()
    // liefert null -> Wurf. Passiert nach dem (hier erfolgreichen)
    // orders-Upsert, aber VOR grantMarketplaceAccess()/Ledger/Mail.
    await expect(
      handleMarketplacePurchase(mockAdmin(), fakeSession(), fakeMetadata(), fakeEvent(fakeSession())),
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
      handleMarketplacePurchase(
        mockAdmin(),
        fakeSession(),
        fakeMetadata({ tenant_id: "tenant-1" }),
        fakeEvent(fakeSession()),
      ),
    ).rejects.toThrow(/Listing für Erfüllung nicht gefunden/);
  });
});

describe("handleMarketplacePurchase — Bestätigungsmail nur bei Neuanlage der Order (Fund: Stripe-Retry)", () => {
  function seedHappyPathRows(): void {
    tablesRef.current.tenants = [
      { id: "tenant-1", slug: "acme", custom_domain: null, name: "Acme", branding: {}, settings: {} },
    ];
    tablesRef.current.courses = [{ id: "course-1", slug: "intro", title: "Intro-Kurs" }];
    tablesRef.current.profiles = [{ id: "user-1", email: "buyer@example.com", full_name: "Käufer" }];
    tablesRef.current.marketplace_listings = [{ id: "listing-1", tenant_id: "tenant-1", course_id: "course-1" }];
  }

  it("verschickt die Bestätigungsmail bei der ERSTEN Zustellung von checkout.session.completed", async () => {
    seedHappyPathRows();

    await handleMarketplacePurchase(mockAdmin(), fakeSession(), fakeMetadata(), fakeEvent(fakeSession()));

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("verschickt die Bestätigungsmail NICHT ein zweites Mal bei einem Stripe-Retry desselben checkout.session.completed (Fund, behoben)", async () => {
    // Stripe garantiert Event-Zustellung nur "at least once" — dasselbe
    // Event kann erneut ankommen (z. B. weil der erste Aufruf NACH dem
    // Mailversand am marketplace_ledger-Upsert hängen geblieben und ins
    // Timeout gelaufen ist). VORHER: sendMarketplacePurchaseMail() lief
    // unbedingt, der Käufer hätte die Bestätigung ein zweites Mal bekommen.
    // Jetzt: an `isNewOrder` gekoppelt, genau wie die Webhook-Dispatches
    // daneben (`enrollmentCreated`).
    seedHappyPathRows();
    const session = fakeSession();
    const event = fakeEvent(session);

    await handleMarketplacePurchase(mockAdmin(), session, fakeMetadata(), event);
    await handleMarketplacePurchase(mockAdmin(), session, fakeMetadata(), event);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Affiliate B4 — die Aufnahme in die Outbox (Plan 9.6).
 *
 * Eigene UUID-Fixtures, weil `intake.ts` `tenant_id` und `order_id` als UUID
 * prüft und einen unbrauchbaren Wert bewusst zu `null` verwirft
 * (`.catch(null)`): mit den `"tenant-1"`-Kennungen der Tests oben stünde in
 * der Zeile überall `null` und der Test bewiese nichts.
 */
describe("handleMarketplacePurchase — Affiliate-Aufnahme in affiliate_events (B4, Plan 9.6)", () => {
  const TENANT_ID = "11111111-1111-4111-8111-111111111111";
  const ORDER_ID = "22222222-2222-4222-8222-222222222222";

  function seedAffiliateRows(): void {
    tablesRef.current.tenants = [
      { id: TENANT_ID, slug: "acme", custom_domain: null, name: "Acme", branding: {}, settings: {} },
    ];
    tablesRef.current.courses = [{ id: "course-1", slug: "intro", title: "Intro-Kurs" }];
    tablesRef.current.profiles = [{ id: "user-1", email: "buyer@example.invalid", full_name: "Käufer" }];
    tablesRef.current.marketplace_listings = [
      { id: "listing-1", tenant_id: TENANT_ID, course_id: "course-1" },
    ];
    // Die Bestellung existiert bereits (Vorlauf des Upserts), damit `order.id`
    // eine echte UUID ist — im echten Betrieb vergibt sie die Datenbank.
    tablesRef.current.orders = [
      { id: ORDER_ID, tenant_id: TENANT_ID, stripe_checkout_id: "cs_test_123", status: "paid" },
    ];
  }

  const metadata = () => fakeMetadata({ tenant_id: TENANT_ID });

  it("schreibt genau eine Outbox-Zeile mit Mandant, Bestellung und Ereignis-Kennung", async () => {
    seedAffiliateRows();
    const session = fakeSession();

    await handleMarketplacePurchase(mockAdmin(), session, metadata(), fakeEvent(session));

    expect(tablesRef.current.affiliate_events).toHaveLength(1);
    expect(tablesRef.current.affiliate_events[0]).toMatchObject({
      stripe_event_id: "evt_test_123",
      event_type: "checkout.session.completed",
      tenant_id: TENANT_ID,
      order_id: ORDER_ID,
      // Ohne Partnerlink gibt es kein Token — die Zeile entsteht trotzdem,
      // der Verarbeiter legt sie als `skipped/no_attribution` ab (Plan 4.4 R9).
      referral_token: null,
      payload: { amount_total: 4900, currency: "eur", livemode: false },
    });
  });

  it("schreibt bei einem Stripe-Retry desselben Ereignisses KEINE zweite Zeile (23505 wird geschluckt, G3)", async () => {
    seedAffiliateRows();
    const session = fakeSession();
    const event = fakeEvent(session);

    await handleMarketplacePurchase(mockAdmin(), session, metadata(), event);
    // Zweite Zustellung desselben Ereignisses: die Unique-Verletzung auf
    // `stripe_event_id` ist der vereinbarte Betrieb, kein Zwischenfall — die
    // Funktion darf NICHT werfen.
    await expect(
      handleMarketplacePurchase(mockAdmin(), session, metadata(), event),
    ).resolves.toBeUndefined();

    expect(tablesRef.current.affiliate_events).toHaveLength(1);
  });

  it("wirft bei jedem anderen Datenbankfehler der Aufnahme, damit Stripe erneut zustellt (G2)", async () => {
    // Der Gegenbeweis zum `marketplace_ledger`-Upsert darüber, der einen
    // Fehlschlag nur loggt und die Zeile damit dauerhaft verliert: ein
    // Geldereignis darf so nicht verschwinden.
    seedAffiliateRows();
    tablesRef.errors.affiliate_events = { code: "42501", message: "permission denied (simuliert)" };
    const session = fakeSession();

    await expect(
      handleMarketplacePurchase(mockAdmin(), session, metadata(), fakeEvent(session)),
    ).rejects.toThrow(/affiliate_events-Insert fehlgeschlagen/);
  });

  it("hält die Aufnahme hinter Zugriffsgewähr, Ledger und Mail — der Kauf ist vorher vollständig erfüllt", async () => {
    // Die Reihenfolge ist der eigentliche Schutz (Plan 9.6): schlägt die
    // Aufnahme fehl, hat der Käufer Mitgliedschaft, Einschreibung und Mail
    // bereits, und der Stripe-Retry wiederholt nur die Aufnahme.
    seedAffiliateRows();
    tablesRef.current.orders = []; // Neuanlage -> die Mail läuft mit.
    tablesRef.errors.affiliate_events = { code: "42501", message: "permission denied (simuliert)" };
    const session = fakeSession();

    await expect(
      handleMarketplacePurchase(mockAdmin(), session, metadata(), fakeEvent(session)),
    ).rejects.toThrow(/affiliate_events-Insert fehlgeschlagen/);

    expect(tablesRef.current.memberships).toHaveLength(1);
    expect(tablesRef.current.enrollments).toHaveLength(1);
    expect(tablesRef.current.marketplace_ledger).toHaveLength(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
