import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Affiliate-System, Block B4 — Tests der Outbox-AUFNAHME
 * (`src/lib/affiliate/intake.ts`, Plan G1/G2, 3.10, 9.3 bis 9.6).
 *
 * Der Prüfwert dieser Datei liegt auf genau einer Regel: `23505` wird
 * geschluckt, ALLES andere wirft. Das ist keine Stilfrage — ein fail-soft
 * `console.error` an dieser Stelle wäre exakt der Fehler, den die Outbox
 * vermeiden soll, nur eine Ebene früher (G2). Dieses Repo hat die Gegenprobe
 * zweimal bezahlt (`marketplace_ledger`-Upsert loggt nur, K1 war „bezahlt,
 * kein Zugriff").
 *
 * Mock-Muster wie in `src/lib/marketplace/fulfil.test.ts:42-134`: ein
 * In-Memory-Array je Tabelle und Fehler-Injektion über `tablesRef.errors`.
 * Hier genügt `insert`, weil die Aufnahme genau eine Anweisung absetzt — das
 * ist der ganze Punkt von G1.
 */

type Row = Record<string, unknown>;
type MockError = { code?: string; message: string };

const { tablesRef, MockAdminClient } = vi.hoisted(() => {
  const tablesRef: {
    current: Record<string, Row[]>;
    errors: Record<string, MockError | undefined>;
  } = { current: {}, errors: {} };

  function tableRows(table: string): Row[] {
    return tablesRef.current[table] ?? (tablesRef.current[table] = []);
  }

  class MockTable {
    constructor(private table: string) {}
    insert(row: Row): Promise<{ error: MockError | null }> {
      const err = tablesRef.errors[this.table];
      // Fehler VOR jeder Schreiblogik, damit ein simulierter Datenbankfehler
      // den Mock-Zustand nicht verändert (wie beim echten Client).
      if (err) return Promise.resolve({ error: err });
      tableRows(this.table).push({ ...row });
      return Promise.resolve({ error: null });
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

import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAffiliateEventRow, recordAffiliateEvent } from "./intake";

function mockAdmin(): Parameters<typeof recordAffiliateEvent>[0] {
  return createAdminClient() as unknown as Parameters<typeof recordAffiliateEvent>[0];
}

/** 64 Hex-Zeichen — dasselbe Muster wie `affiliateReferralTokenSchema`. */
const TOKEN = "a".repeat(64);
const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";

/** 01.09.2026, 12:00:00 UTC als Stripe-Sekunden. */
const CREATED_SECONDS = Math.trunc(Date.UTC(2026, 8, 1, 12, 0, 0) / 1000);
const PAID_SECONDS = Math.trunc(Date.UTC(2026, 8, 2, 8, 30, 0) / 1000);

function checkoutEvent(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Event {
  const session = {
    id: "cs_test_1",
    object: "checkout.session",
    created: CREATED_SECONDS,
    amount_total: 11900,
    currency: "eur",
    mode: "payment",
    payment_intent: "pi_test_1",
    subscription: null,
    total_details: { amount_tax: 1900, amount_shipping: 0 },
    metadata: { affiliate_ref_token: TOKEN },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;

  return {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    created: CREATED_SECONDS + 5,
    livemode: true,
    data: { object: session },
  } as unknown as Stripe.Event;
}

function invoiceEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  const invoice = {
    id: "in_test_1",
    object: "invoice",
    amount_paid: 9000,
    total: 11900,
    currency: "eur",
    billing_reason: "subscription_cycle",
    total_taxes: [{ amount: 1200 }, { amount: 700 }],
    status_transitions: { paid_at: PAID_SECONDS },
    parent: { subscription_details: { subscription: "sub_test_1" } },
    ...overrides,
  };

  return {
    id: "evt_invoice_1",
    type: "invoice.paid",
    created: CREATED_SECONDS,
    livemode: true,
    data: { object: invoice },
  } as unknown as Stripe.Event;
}

function chargeRefundedEvent(): Stripe.Event {
  const charge = {
    id: "ch_test_1",
    object: "charge",
    amount: 11900,
    amount_refunded: 5000,
    currency: "eur",
    created: CREATED_SECONDS,
    payment_intent: "pi_test_1",
  };

  return {
    id: "evt_charge_1",
    type: "charge.refunded",
    created: CREATED_SECONDS + 60,
    livemode: true,
    data: { object: charge },
  } as unknown as Stripe.Event;
}

beforeEach(() => {
  tablesRef.current = {};
  tablesRef.errors = {};
  vi.restoreAllMocks();
});

describe("recordAffiliateEvent — Fehlerbehandlung (G2)", () => {
  it("schluckt 23505 (Unique-Verletzung = normaler Stripe-Retry) und wirft NICHT", async () => {
    // Stripe garantiert nur "at least once". Dasselbe Ereignis erneut
    // zuzustellen ist der vereinbarte Betrieb — ein Wurf hier erzeugte eine
    // 500-Antwort und damit eine Endlosschleife aus Retries auf eine Zeile,
    // die längst da ist.
    tablesRef.errors.affiliate_events = { code: "23505", message: "duplicate key value" };

    await expect(recordAffiliateEvent(mockAdmin(), checkoutEvent(), { tenantId: TENANT })).resolves.toBe(
      "duplicate",
    );
  });

  it("wirft bei JEDEM anderen Datenbankfehler, damit der Webhook 500 antwortet", async () => {
    // Der Wurf IST der Mechanismus: 500 -> Stripe stellt erneut zu. Der
    // Käufer hat seinen Zugriff zu diesem Zeitpunkt bereits (der Aufruf sitzt
    // nach `enrollFromProduct()`, Plan 9.4), der Retry kostet ihn also nichts.
    tablesRef.errors.affiliate_events = { code: "23502", message: "null value in column" };

    await expect(
      recordAffiliateEvent(mockAdmin(), checkoutEvent(), { tenantId: TENANT }),
    ).rejects.toThrow(/affiliate_events-Insert fehlgeschlagen/);
  });

  it("wirft auch dann, wenn der Fehler gar keinen Code trägt (Netz, Timeout)", async () => {
    // Erlaubnisliste statt Sperrliste: geschluckt wird ausschließlich 23505.
    // Ein Fehler ohne Code ist nicht „harmlos", sondern unbekannt.
    tablesRef.errors.affiliate_events = { message: "fetch failed" };

    await expect(
      recordAffiliateEvent(mockAdmin(), checkoutEvent(), { tenantId: TENANT }),
    ).rejects.toThrow(/Code unbekannt/);
  });

  it("trägt weder Token noch Datenbankmeldung in die geworfene Meldung oder ins Log", async () => {
    // CLAUDE.md §2.11 und Plan 11.11: die PostgREST-Meldung trägt bei einer
    // Constraint-Verletzung den Schlüsselwert im Klartext. Ein Referral-Token
    // in einem Worker-Log ist ein Inhaber-Geheimnis in einem Log.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    tablesRef.errors.affiliate_events = {
      code: "23503",
      message: `Key (referral_token)=(${TOKEN}) is not present`,
    };

    const thrown = await recordAffiliateEvent(mockAdmin(), checkoutEvent(), {
      tenantId: TENANT,
    }).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(TOKEN);
    expect((thrown as Error).message).not.toContain("is not present");

    const output = logged.mock.calls.flat().join(" ");
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain("is not present");
    expect(output).toContain("23503");
  });

  it("schreibt bei einem Fehler nichts in die Tabelle", async () => {
    tablesRef.errors.affiliate_events = { code: "42501", message: "permission denied" };

    await expect(
      recordAffiliateEvent(mockAdmin(), checkoutEvent(), { tenantId: TENANT }),
    ).rejects.toThrow();
    expect(tablesRef.current.affiliate_events ?? []).toHaveLength(0);
  });
});

describe("recordAffiliateEvent — die aufgenommene Zeile (3.10)", () => {
  it("nimmt einen Direktkauf mit Mandant, Bestellung und Token auf", async () => {
    await expect(
      recordAffiliateEvent(mockAdmin(), checkoutEvent(), { tenantId: TENANT, orderId: ORDER }),
    ).resolves.toBe("inserted");

    expect(tablesRef.current.affiliate_events).toHaveLength(1);
    expect(tablesRef.current.affiliate_events[0]).toMatchObject({
      stripe_event_id: "evt_checkout_1",
      event_type: "checkout.session.completed",
      tenant_id: TENANT,
      order_id: ORDER,
      stripe_payment_intent: "pi_test_1",
      referral_token: TOKEN,
      // Stripe-Zeit des VORGANGS (`session.created`), nicht die des Ereignisses
      // und nicht die Verarbeitungszeit: bei einem Retry nach drei Tagen darf
      // sich die Sperrfrist nicht verschieben (3.10).
      occurred_at: "2026-09-01T12:00:00.000Z",
    });
    expect(tablesRef.current.affiliate_events[0].payload).toEqual({
      amount_total: 11900,
      amount_tax: 1900,
      amount_shipping: 0,
      currency: "eur",
      livemode: true,
    });
  });

  it("verwirft ein Token, das dem Muster nicht entspricht, statt es zu speichern", async () => {
    // Zweite Linie hinter dem Metadata-Schema (CLAUDE.md §2.3): der Wert geht
    // im Verarbeiter in einen Query-Filter.
    await recordAffiliateEvent(
      mockAdmin(),
      checkoutEvent({ metadata: { affiliate_ref_token: "nicht-hex" } } as Partial<Stripe.Checkout.Session>),
      { tenantId: TENANT },
    );

    expect(tablesRef.current.affiliate_events[0].referral_token).toBeNull();
  });

  it("hält `livemode = false` fest, weil daran die Testbuchung hängt (4.5)", async () => {
    const event = checkoutEvent();
    (event as { livemode: boolean }).livemode = false;

    await recordAffiliateEvent(mockAdmin(), event, { tenantId: TENANT });

    expect(
      (tablesRef.current.affiliate_events[0].payload as Record<string, unknown>).livemode,
    ).toBe(false);
  });

  it("nimmt eine Abo-Rate mit Abo-Kennung, Zahlbetrag und Steuersumme auf", async () => {
    await recordAffiliateEvent(mockAdmin(), invoiceEvent(), {
      stripeInvoiceId: "in_test_1",
      stripeSubscriptionId: "sub_test_1",
    });

    const row = tablesRef.current.affiliate_events[0];
    expect(row).toMatchObject({
      tenant_id: null, // 9.5 reicht keinen Mandanten durch — der Verarbeiter löst auf.
      stripe_invoice_id: "in_test_1",
      stripe_subscription_id: "sub_test_1",
      occurred_at: "2026-09-02T08:30:00.000Z",
    });
    expect(row.payload).toEqual({
      // G13: `amount_paid` ist die Basis, `total` steht nur für die anteilige
      // Kürzung der Steuer daneben (5.1).
      amount_paid: 9000,
      amount_total: 11900,
      // `stripe@18` kennt kein `invoice.tax` mehr — die Steuer ist eine Summe
      // über `total_taxes[]`.
      amount_tax: 1900,
      amount_shipping: 0,
      currency: "eur",
      billing_reason: "subscription_cycle",
      livemode: true,
    });
  });

  it("findet die Abo-Kennung auch ohne Kontext direkt am Rechnungsobjekt", async () => {
    await recordAffiliateEvent(mockAdmin(), invoiceEvent({ subscription: "sub_direkt" }), {});

    expect(tablesRef.current.affiliate_events[0].stripe_subscription_id).toBe("sub_direkt");
  });

  it("nimmt `charge.refunded` OHNE Mandant auf — die Auflösung ist Aufgabe des Verarbeiters", async () => {
    // Ein `Stripe.Charge` trägt keine Session-Metadata. Ein `not null` auf
    // `tenant_id` ließe genau die Ereignisse scheitern, für die die Outbox
    // gebaut wurde (3.10).
    await expect(recordAffiliateEvent(mockAdmin(), chargeRefundedEvent(), {})).resolves.toBe(
      "inserted",
    );

    const row = tablesRef.current.affiliate_events[0];
    expect(row).toMatchObject({
      tenant_id: null,
      order_id: null,
      stripe_charge_id: "ch_test_1",
      stripe_payment_intent: "pi_test_1",
    });
    expect(row.payload).toMatchObject({
      // G7: kumulativer Stand, nicht das Delta dieses Ereignisses.
      amount_refunded: 5000,
      charge_amount: 11900,
    });
  });

  it("hält bei einem Dispute die STREITFALL-Kennung fest, nicht nur die des Charge", async () => {
    // `dispute.id` steht ausschließlich auf diesem Objekt. Sie bildet später
    // `dedup_key` und Sperrschlüssel der Gegenbuchung
    // (`reversal:<reverses_id>:<dispute_id>:<betrag>`, 3.11). Fehlt sie in der
    // Nutzlast, müsste der Verarbeiter auf `charge.id` ausweichen — dann
    // teilten sich Erstattung und Rückbuchung DESSELBEN Charge einen
    // Schlüsselraum, und die Wiedergutschrift eines gewonnenen Streitfalls
    // holte die Gegenbuchungen der Erstattung mit zurück.
    const event = {
      id: "evt_dispute_1",
      type: "charge.dispute.created",
      created: CREATED_SECONDS,
      livemode: true,
      data: {
        object: {
          id: "dp_test_1",
          charge: "ch_test_1",
          payment_intent: "pi_test_1",
          amount: 11900,
          status: "needs_response",
          currency: "eur",
          created: CREATED_SECONDS,
        },
      },
    } as unknown as Stripe.Event;

    await expect(recordAffiliateEvent(mockAdmin(), event, {})).resolves.toBe("inserted");

    const row = tablesRef.current.affiliate_events[0];
    expect(row).toMatchObject({ stripe_charge_id: "ch_test_1", tenant_id: null });
    expect(row.payload).toMatchObject({
      dispute_id: "dp_test_1",
      dispute_amount: 11900,
      dispute_status: "needs_response",
    });
  });

  it("nimmt eine unbekannte Ereignisart gar nicht erst auf und wirft dabei nicht", async () => {
    const event = {
      id: "evt_unbekannt",
      type: "customer.updated",
      created: CREATED_SECONDS,
      livemode: true,
      data: { object: {} },
    } as unknown as Stripe.Event;

    await expect(recordAffiliateEvent(mockAdmin(), event, {})).resolves.toBe("duplicate");
    expect(tablesRef.current.affiliate_events ?? []).toHaveLength(0);
  });
});

describe("buildAffiliateEventRow — der Nachhol-Lauf baut dieselbe Zeile (6.6)", () => {
  it("liefert null für eine Art außerhalb der Erlaubnisliste", () => {
    const event = { id: "evt_x", type: "ping", created: 1, livemode: true, data: { object: {} } };
    expect(buildAffiliateEventRow(event as unknown as Stripe.Event)).toBeNull();
  });

  it("fällt für `occurred_at` auf `event.created` zurück, wenn das Fachobjekt keine Zeit trägt", () => {
    // Eine Zeile ohne `occurred_at` ist nicht schreibbar (`not null`). Ein
    // fehlender Zeitstempel am Fachobjekt darf die Aufnahme nicht kosten.
    const row = buildAffiliateEventRow(
      invoiceEvent({ status_transitions: { paid_at: null } }),
    );
    expect(row?.occurred_at).toBe(new Date(CREATED_SECONDS * 1000).toISOString());
  });
});
