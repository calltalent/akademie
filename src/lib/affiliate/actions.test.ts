import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Affiliate-System, Block B6-A — Tests der Server Actions der
 * Mandanten-Oberfläche (`src/lib/affiliate/actions.ts`).
 *
 * Vier Pflichtfälle, und jeder steht für einen Fehler, der in diesem Repo
 * bereits einmal Geld oder Zugriff gekostet hat:
 *
 *   1. KEIN ENUMERATION-LECK (CLAUDE.md §2.15, Plan 11.15). Jede Action
 *      weist eine FREMDE `partner_id` mit exakt derselben Meldung ab wie eine
 *      nicht existierende. Zwei verschiedene Texte wären eine Auskunft über
 *      den Partnerbestand fremder Mandanten — und die Fehlerklasse, die beim
 *      Marketplace zu vier Nachbesserungs-Migrationen geführt hat
 *      (`20260803100400:52-83`).
 *   2. G10: `member_role(t) in ('owner','admin')`, NICHT `is_staff()`. Ein
 *      `trainer` fällt unter `is_staff()` (`0001_init.sql:63-69`) und käme
 *      damit an Provisionen, Bewerbungsangaben und Auszahlungssperren. Der
 *      Test prüft nicht nur die Fehlermeldung, sondern dass NICHTS
 *      geschrieben wurde — eine Meldung ist kein Schutz.
 *   3. G15: die Selbstfreigabe wird abgewiesen, und der Versuch steht im
 *      Prüfpfad. Über `createAdminClient()` kehrt der Guard-Trigger sofort
 *      zurück (`current_user = 'service_role'`), die Datenbank schützt hier
 *      also NICHT — diese Prüfung im Anwendungscode ist die einzige.
 *   4. Eine Handbuchung ohne Begründung wird abgewiesen (3.11:
 *      `check (kind <> 'manual' or note is not null)`, Schema: mindestens
 *      fünf Zeichen).
 *
 * MOCK-MUSTER wie `src/lib/courses/actions.test.ts` und
 * `src/lib/affiliate/intake.test.ts`: ein In-Memory-Store je Tabelle, der
 * ECHT persistiert. Ein reiner Spy verdeckte genau das, worauf es hier
 * ankommt — ob nach einer abgewiesenen Aktion eine Zeile verändert wurde.
 */

type Row = Record<string, unknown>;
type MockError = { code?: string; message: string };

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const PROGRAM_A = "33333333-3333-4333-8333-333333333333";
const MANAGER = "44444444-4444-4444-8444-444444444444";

const PARTNER_A = "55555555-5555-4555-8555-555555555555";
/** Partner eines FREMDEN Mandanten — existiert, geht diesen Mandanten nichts an. */
const PARTNER_FOREIGN = "66666666-6666-4666-8666-666666666666";
/** Existiert nirgends. Muss dieselbe Antwort erzeugen wie `PARTNER_FOREIGN`. */
const PARTNER_MISSING = "77777777-7777-4777-8777-777777777777";
/** Die eigene Partnerzeile des handelnden Managers (G15). */
const PARTNER_SELF = "88888888-8888-4888-8888-888888888888";

const GROUP_A = "99999999-9999-4999-8999-999999999999";
const GROUP_SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP_FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP_MISSING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const CONDITION_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONDITION_FOREIGN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CONDITION_MISSING = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const COMMISSION_A = "10101010-1010-4010-8010-101010101010";
const COMMISSION_FOREIGN = "20202020-2020-4020-8020-202020202020";
const COMMISSION_MISSING = "30303030-3030-4030-8030-303030303030";

const ORDER_A = "40404040-4040-4040-8040-404040404040";
const PRODUCT_A = "50505050-5050-4050-8050-505050505050";

/** Wortgleich mit `access.ts` und `actions.ts` — genau das ist der Prüfgegenstand. */
const PARTNER_NOT_FOUND = "Der Partner wurde in dieser Akademie nicht gefunden.";
const COMMISSION_NOT_FOUND = "Die Buchung wurde in dieser Akademie nicht gefunden.";
const CONDITION_NOT_FOUND = "Die Kondition wurde in dieser Akademie nicht gefunden.";
const GROUP_NOT_FOUND = "Die Gruppe wurde in dieser Akademie nicht gefunden.";
const SELF_DEALING =
  "Dieser Vorgang gehört zur eigenen Partnerzeile und muss von einer anderen Person entschieden werden.";

// --- Mock-Infrastruktur -------------------------------------------------

const { state, MockClient, rpcCalls } = vi.hoisted(() => {
  const state: {
    tables: Record<string, Row[]>;
    errors: Record<string, MockError | undefined>;
    /** Rückgabewert von `member_role` — das ist der G10-Schalter im Test. */
    memberRole: string | null;
    tenantEnabled: boolean;
    user: { id: string; email?: string } | null;
    nextId: number;
  } = {
    tables: {},
    errors: {},
    memberRole: "owner",
    tenantEnabled: true,
    // Literale statt der Konstanten oben: `vi.hoisted()` läuft VOR jeder
    // Modulauswertung, die `const`-Deklarationen existieren dort noch nicht.
    user: { id: "44444444-4444-4444-8444-444444444444", email: "manager@example.invalid" },
    nextId: 0,
  };

  const rpcCalls: Array<{ name: string; payload: unknown }> = [];

  function rows(table: string): Row[] {
    return state.tables[table] ?? (state.tables[table] = []);
  }

  class MockQuery implements PromiseLike<{ data: Row[] | null; error: MockError | null }> {
    private op: "select" | "insert" | "update" | "delete" = "select";
    private eqFilters: Array<[string, unknown]> = [];
    private inFilters: Array<[string, unknown[]]> = [];
    private payload: Row | null = null;
    private wantsRow = false;
    private headOnly = false;

    constructor(private table: string) {}

    select(_columns?: string, options?: { count?: string; head?: boolean }): this {
      if (this.op !== "select") {
        // Nach `.insert()` bedeutet `.select(...)` „gib die neue Zeile zurück".
        this.wantsRow = true;
        return this;
      }
      if (options?.head === true) this.headOnly = true;
      return this;
    }
    insert(row: Row): this {
      this.op = "insert";
      this.payload = row;
      return this;
    }
    update(row: Row): this {
      this.op = "update";
      this.payload = row;
      return this;
    }
    delete(): this {
      this.op = "delete";
      return this;
    }
    eq(column: string, value: unknown): this {
      this.eqFilters.push([column, value]);
      return this;
    }
    in(column: string, values: unknown[]): this {
      this.inFilters.push([column, values]);
      return this;
    }
    order(): this {
      return this;
    }
    range(): this {
      return this;
    }
    limit(): this {
      return this;
    }
    gte(): this {
      return this;
    }
    lte(): this {
      return this;
    }

    private matching(): Row[] {
      let result = rows(this.table);
      for (const [column, value] of this.eqFilters) {
        result = result.filter((row) => row[column] === value);
      }
      for (const [column, values] of this.inFilters) {
        result = result.filter((row) => values.includes(row[column]));
      }
      return result;
    }

    private exec(): { data: Row[] | null; error: MockError | null; count?: number } {
      const injected = state.errors[this.table];
      if (injected) return { data: null, error: injected };

      if (this.op === "insert") {
        state.nextId += 1;
        const row: Row = { id: `new-${state.nextId}`, ...this.payload };
        rows(this.table).push(row);
        return { data: this.wantsRow ? [row] : null, error: null };
      }
      if (this.op === "update") {
        const matched = this.matching();
        for (const row of matched) Object.assign(row, this.payload);
        return { data: matched, error: null };
      }
      if (this.op === "delete") {
        const matched = new Set(this.matching());
        state.tables[this.table] = rows(this.table).filter((row) => !matched.has(row));
        return { data: [...matched], error: null };
      }
      const matched = this.matching().map((row) => ({ ...row }));
      return { data: this.headOnly ? [] : matched, error: null, count: matched.length };
    }

    maybeSingle(): Promise<{ data: Row | null; error: MockError | null }> {
      const result = this.exec();
      return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
    }

    then<TResult1 = { data: Row[] | null; error: MockError | null }, TResult2 = never>(
      onFulfilled?:
        | ((value: { data: Row[] | null; error: MockError | null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.exec()).then(onFulfilled, onRejected);
    }
  }

  class MockClient {
    from(table: string): MockQuery {
      return new MockQuery(table);
    }
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: MockError | null }> {
      rpcCalls.push({ name, payload: args });
      if (name === "member_role") {
        return Promise.resolve({ data: state.memberRole, error: null });
      }
      if (name === "book_affiliate_commissions") {
        return Promise.resolve({
          data: { rows: [{ ref: "manual", id: "booked-1", dedup_key: "x", inserted: true }] },
          error: null,
        });
      }
      if (name === "book_affiliate_reversals") {
        return Promise.resolve({ data: { booked: 1, existing: 0, skipped: 0, rows: [] }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
  }

  return { state, MockClient, rpcCalls };
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => new MockClient() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => new MockClient() }));

vi.mock("@/lib/tenant/context", () => ({
  getTenant: async () =>
    state.tenantEnabled
      ? { id: TENANT_A, slug: "akademie", settings: { affiliate_enabled: true } }
      : { id: TENANT_A, slug: "akademie", settings: {} },
}));

vi.mock("@/lib/auth/context", () => ({ getAuthUser: async () => state.user }));

import {
  approveAffiliatePartner,
  createAffiliateCondition,
  createAffiliateManualBooking,
  createAffiliatePartner,
  decideAffiliateCommission,
  deleteAffiliateCondition,
  deleteAffiliateGroup,
  inviteAffiliatePartner,
  reassignAffiliateOrder,
  rejectAffiliatePartner,
  renameAffiliateGroup,
  saveAffiliatePartnerAdminFields,
  setAffiliateCommissionFlag,
  suspendAffiliatePartner,
  updateAffiliateCondition,
} from "./actions";
import {
  initialAffiliateCommissionActionState,
  initialAffiliateConditionActionState,
  initialAffiliateGroupActionState,
  initialAffiliatePartnerActionState,
} from "./state";

// --- Ausgangsbestand ----------------------------------------------------

function seed(): void {
  state.tables = {
    affiliate_programs: [
      {
        id: PROGRAM_A,
        tenant_id: TENANT_A,
        status: "active",
        visibility: "link",
        approval_mode: "manual",
        rate_kind: "percent",
        rate_bp: 2000,
        fixed_cents: 0,
        min_commission_cents: null,
        max_commission_cents: null,
        basis_kind: "net",
        fee_deduction_bp: 0,
        currency: "eur",
        attribution_model: "last",
        cookie_ttl_days: 30,
        overwrite_policy: "allow",
        lifetime_binding: false,
        self_referral: "block",
        referrer_blocklist: [],
        recurring_mode: "first_only",
        recurring_max_periods: 12,
        tier2_enabled: false,
        tier2_basis: "commission",
        tier2_rate_bp: 1000,
        hold_days: 30,
        reserve_bp: 1000,
        reserve_days: 60,
        min_payout_cents: 2500,
        payout_schedule: "monthly",
        books_closed_until: null,
        description_md: "",
        terms_text: "Fassung 1",
        terms_version: 1,
        application_note: "",
        application_fields: [],
        test_mode: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    affiliate_partners: [
      {
        id: PARTNER_A,
        tenant_id: TENANT_A,
        program_id: PROGRAM_A,
        user_id: null,
        applicant_email: "partner@example.invalid",
        display_name: "Partner A",
        company: null,
        code: "partner-a",
        status: "pending",
        status_reason: null,
        group_id: GROUP_A,
        referred_by: null,
        payout_hold: false,
        payout_hold_reason: null,
        internal_note: null,
      },
      {
        id: PARTNER_SELF,
        tenant_id: TENANT_A,
        program_id: PROGRAM_A,
        // Das ist der G15-Fall: die Partnerzeile gehört dem handelnden Manager.
        user_id: MANAGER,
        applicant_email: "manager@example.invalid",
        display_name: "Manager als Partner",
        company: null,
        code: "chef",
        status: "pending",
        status_reason: null,
        group_id: GROUP_SELF,
        referred_by: null,
        payout_hold: false,
        payout_hold_reason: null,
        internal_note: null,
      },
      {
        id: PARTNER_FOREIGN,
        tenant_id: TENANT_B,
        program_id: "ffffffff-0000-4000-8000-000000000000",
        user_id: null,
        applicant_email: "fremd@example.invalid",
        display_name: "Fremder Partner",
        company: null,
        code: "fremd",
        status: "active",
        status_reason: null,
        group_id: null,
        referred_by: null,
        payout_hold: false,
        payout_hold_reason: null,
        internal_note: null,
      },
    ],
    affiliate_groups: [
      { id: GROUP_A, tenant_id: TENANT_A, program_id: PROGRAM_A, name: "Standard" },
      { id: GROUP_SELF, tenant_id: TENANT_A, program_id: PROGRAM_A, name: "Chefgruppe" },
      { id: GROUP_FOREIGN, tenant_id: TENANT_B, program_id: "x", name: "Fremd" },
    ],
    affiliate_conditions: [
      {
        id: CONDITION_A,
        tenant_id: TENANT_A,
        program_id: PROGRAM_A,
        partner_id: PARTNER_A,
        group_id: null,
        product_id: null,
        rate_kind: "percent",
        rate_bp: 3000,
        fixed_cents: 0,
        valid_from: "2026-01-01T00:00:00.000Z",
        valid_to: null,
        note: null,
        specificity: 20,
      },
      {
        id: CONDITION_FOREIGN,
        tenant_id: TENANT_B,
        program_id: "x",
        partner_id: PARTNER_FOREIGN,
        group_id: null,
        product_id: null,
        rate_kind: "percent",
        rate_bp: 9000,
        fixed_cents: 0,
        valid_from: "2026-01-01T00:00:00.000Z",
        valid_to: null,
        note: null,
        specificity: 20,
      },
    ],
    affiliate_commissions: [
      {
        id: COMMISSION_A,
        tenant_id: TENANT_A,
        program_id: PROGRAM_A,
        partner_id: PARTNER_A,
        kind: "sale",
        order_id: ORDER_A,
        status: "pending",
        cancel_reason: null,
        amount_cents: 5000,
        currency: "eur",
        hold_until: "2026-10-01T00:00:00.000Z",
        is_test: false,
        base_cents: 25000,
        basis_kind: "net",
        product_id: PRODUCT_A,
        campaign: null,
        referral_id: null,
        dedup_key: `sale:${ORDER_A}`,
        flagged: false,
        flag_reason: null,
      },
      {
        id: COMMISSION_FOREIGN,
        tenant_id: TENANT_B,
        program_id: "x",
        partner_id: PARTNER_FOREIGN,
        kind: "sale",
        order_id: "00000000-0000-4000-8000-000000000001",
        status: "pending",
        cancel_reason: null,
        amount_cents: 9999,
        currency: "eur",
        hold_until: "2026-10-01T00:00:00.000Z",
        is_test: false,
        base_cents: 10000,
        basis_kind: "net",
        product_id: null,
        campaign: null,
        referral_id: null,
        dedup_key: "sale:fremd",
        flagged: false,
        flag_reason: null,
      },
    ],
    orders: [
      {
        id: ORDER_A,
        tenant_id: TENANT_A,
        product_id: PRODUCT_A,
        amount_cents: 29750,
        currency: "eur",
        status: "paid",
      },
    ],
    products: [
      {
        id: PRODUCT_A,
        tenant_id: TENANT_A,
        title: "Kurspaket",
        price_cents: 29750,
        currency: "eur",
        kind: "one_time",
        active: true,
      },
    ],
    affiliate_audit_log: [],
  };
  state.errors = {};
  state.memberRole = "owner";
  state.tenantEnabled = true;
  state.user = { id: MANAGER, email: "manager@example.invalid" };
  state.nextId = 0;
  rpcCalls.length = 0;
}

beforeEach(() => {
  seed();
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function partnerRow(id: string): Row | undefined {
  return state.tables.affiliate_partners.find((row) => row.id === id);
}

function auditActions(): string[] {
  return state.tables.affiliate_audit_log.map((row) => String(row.action));
}

// =======================================================================
// 1. Kein Enumeration-Leck: fremde ID = unbekannte ID (§2.15, Plan 11.15)
// =======================================================================

describe("Mandantenprüfung client-gelieferter IDs", () => {
  /**
   * Der Kern des Auftrags: für JEDE Action muss die Antwort auf eine fremde
   * ID zeichengleich mit der auf eine erfundene ID sein. Verglichen wird
   * deshalb nicht nur gegen die Konstante, sondern auch die beiden Antworten
   * miteinander — ein künftiger Umbau, der beide gleichzeitig ändert, bleibt
   * damit trotzdem sicher.
   */
  const partnerCases: Array<{
    name: string;
    run: (partnerId: string) => Promise<{ error: string | null }>;
  }> = [
    {
      name: "approveAffiliatePartner",
      run: (partnerId) =>
        approveAffiliatePartner(initialAffiliatePartnerActionState, form({ partnerId })),
    },
    {
      name: "rejectAffiliatePartner",
      run: (partnerId) =>
        rejectAffiliatePartner(
          initialAffiliatePartnerActionState,
          form({ partnerId, reason: "Passt inhaltlich nicht." }),
        ),
    },
    {
      name: "suspendAffiliatePartner",
      run: (partnerId) =>
        suspendAffiliatePartner(
          initialAffiliatePartnerActionState,
          form({ partnerId, reason: "Verdacht auf Eigenbestellungen." }),
        ),
    },
    {
      name: "saveAffiliatePartnerAdminFields",
      run: (partnerId) =>
        saveAffiliatePartnerAdminFields(
          initialAffiliatePartnerActionState,
          form({ partnerId, internalNote: "Notiz" }),
        ),
    },
    {
      name: "createAffiliateManualBooking",
      run: (partnerId) =>
        createAffiliateManualBooking(
          initialAffiliateCommissionActionState,
          form({ partnerId, amountEuro: "25,00", currency: "eur", note: "Kulanz nach Rückfrage." }),
        ),
    },
    {
      name: "createAffiliateCondition",
      run: (partnerId) =>
        createAffiliateCondition(
          initialAffiliateConditionActionState,
          form({
            partnerId,
            rateKind: "percent",
            rateBp: "3500",
            fixedCents: "0",
            validFrom: "2026-09-01T00:00",
          }),
        ),
    },
    {
      name: "reassignAffiliateOrder",
      run: (partnerId) =>
        reassignAffiliateOrder(
          initialAffiliateCommissionActionState,
          form({ orderId: ORDER_A, newPartnerId: partnerId, reason: "Klick war vom Newsletter." }),
        ),
    },
    {
      name: "createAffiliatePartner (referredBy)",
      run: (partnerId) =>
        createAffiliatePartner(
          initialAffiliatePartnerActionState,
          form({
            applicantEmail: "neu@example.invalid",
            displayName: "Neuer Partner",
            code: "neu-partner",
            referredBy: partnerId,
          }),
        ),
    },
  ];

  for (const testCase of partnerCases) {
    it(`${testCase.name}: fremde und unbekannte partner_id liefern dieselbe Meldung`, async () => {
      const foreign = await testCase.run(PARTNER_FOREIGN);
      seed();
      const missing = await testCase.run(PARTNER_MISSING);

      expect(foreign.error).toBe(PARTNER_NOT_FOUND);
      expect(missing.error).toBe(PARTNER_NOT_FOUND);
      expect(foreign.error).toBe(missing.error);
    });
  }

  it("die fremde Partnerzeile bleibt unverändert", async () => {
    await approveAffiliatePartner(initialAffiliatePartnerActionState, form({ partnerId: PARTNER_FOREIGN }));
    expect(partnerRow(PARTNER_FOREIGN)?.status).toBe("active");
    expect(auditActions()).toEqual([]);
  });

  it("setAffiliateCommissionFlag: fremde und unbekannte commission_id liefern dieselbe Meldung", async () => {
    const foreign = await setAffiliateCommissionFlag(
      initialAffiliateCommissionActionState,
      form({ commissionId: COMMISSION_FOREIGN, flagged: "on", reason: "Verdacht" }),
    );
    const missing = await setAffiliateCommissionFlag(
      initialAffiliateCommissionActionState,
      form({ commissionId: COMMISSION_MISSING, flagged: "on", reason: "Verdacht" }),
    );
    expect(foreign.error).toBe(COMMISSION_NOT_FOUND);
    expect(missing.error).toBe(COMMISSION_NOT_FOUND);
    // Und die fremde Zeile ist unberührt geblieben.
    expect(
      state.tables.affiliate_commissions.find((row) => row.id === COMMISSION_FOREIGN)?.flagged,
    ).toBe(false);
  });

  it("decideAffiliateCommission: fremde und unbekannte commission_id liefern dieselbe Meldung", async () => {
    const foreign = await decideAffiliateCommission(
      initialAffiliateCommissionActionState,
      form({ commissionId: COMMISSION_FOREIGN, decision: "cancelled", reason: "Doppelte Buchung." }),
    );
    const missing = await decideAffiliateCommission(
      initialAffiliateCommissionActionState,
      form({ commissionId: COMMISSION_MISSING, decision: "cancelled", reason: "Doppelte Buchung." }),
    );
    expect(foreign.error).toBe(COMMISSION_NOT_FOUND);
    expect(missing.error).toBe(COMMISSION_NOT_FOUND);
    expect(
      state.tables.affiliate_commissions.find((row) => row.id === COMMISSION_FOREIGN)?.status,
    ).toBe("pending");
  });

  it("Kondition: fremde und unbekannte condition_id liefern dieselbe Meldung", async () => {
    const base = {
      rateKind: "percent",
      rateBp: "1000",
      fixedCents: "0",
      validFrom: "2026-09-01T00:00",
      productId: PRODUCT_A,
    };
    const foreignUpdate = await updateAffiliateCondition(
      initialAffiliateConditionActionState,
      form({ conditionId: CONDITION_FOREIGN, ...base }),
    );
    const missingUpdate = await updateAffiliateCondition(
      initialAffiliateConditionActionState,
      form({ conditionId: CONDITION_MISSING, ...base }),
    );
    expect(foreignUpdate.error).toBe(CONDITION_NOT_FOUND);
    expect(missingUpdate.error).toBe(CONDITION_NOT_FOUND);

    const foreignDelete = await deleteAffiliateCondition(
      initialAffiliateConditionActionState,
      form({ conditionId: CONDITION_FOREIGN }),
    );
    const missingDelete = await deleteAffiliateCondition(
      initialAffiliateConditionActionState,
      form({ conditionId: CONDITION_MISSING }),
    );
    expect(foreignDelete.error).toBe(CONDITION_NOT_FOUND);
    expect(missingDelete.error).toBe(CONDITION_NOT_FOUND);
    // Die fremde Kondition existiert weiterhin — kein Löschen über die
    // Mandantengrenze hinweg.
    expect(
      state.tables.affiliate_conditions.some((row) => row.id === CONDITION_FOREIGN),
    ).toBe(true);
  });

  it("Gruppe: fremde und unbekannte group_id liefern dieselbe Meldung", async () => {
    const foreignRename = await renameAffiliateGroup(
      initialAffiliateGroupActionState,
      form({ groupId: GROUP_FOREIGN, name: "Umbenannt" }),
    );
    const missingRename = await renameAffiliateGroup(
      initialAffiliateGroupActionState,
      form({ groupId: GROUP_MISSING, name: "Umbenannt" }),
    );
    expect(foreignRename.error).toBe(GROUP_NOT_FOUND);
    expect(missingRename.error).toBe(GROUP_NOT_FOUND);

    const foreignDelete = await deleteAffiliateGroup(
      initialAffiliateGroupActionState,
      form({ groupId: GROUP_FOREIGN }),
    );
    const missingDelete = await deleteAffiliateGroup(
      initialAffiliateGroupActionState,
      form({ groupId: GROUP_MISSING }),
    );
    expect(foreignDelete.error).toBe(GROUP_NOT_FOUND);
    expect(missingDelete.error).toBe(GROUP_NOT_FOUND);
    expect(state.tables.affiliate_groups.some((row) => row.id === GROUP_FOREIGN)).toBe(true);
    expect(state.tables.affiliate_groups.find((row) => row.id === GROUP_FOREIGN)?.name).toBe("Fremd");
  });

  it("eine fremde group_id am Partnerformular wird abgewiesen", async () => {
    const result = await saveAffiliatePartnerAdminFields(
      initialAffiliatePartnerActionState,
      form({ partnerId: PARTNER_A, groupId: GROUP_FOREIGN }),
    );
    expect(result.error).toBe(GROUP_NOT_FOUND);
    expect(partnerRow(PARTNER_A)?.group_id).toBe(GROUP_A);
  });
});

// =======================================================================
// 2. G10 — Geld- und Personaldaten nur owner/admin, nie trainer
// =======================================================================

describe("Rollen-Gate (G10)", () => {
  /**
   * `is_staff()` schließt `trainer` ein (`0001_init.sql:63-69`) — genau
   * deshalb prüft `requireAffiliateManager()` `member_role(t) in
   * ('owner','admin')`. Geprüft wird hier die WIRKUNG, nicht der Text: eine
   * Fehlermeldung ohne ausgebliebene Schreibung wäre kein Schutz.
   */
  it("ein trainer gibt keine Bewerbung frei", async () => {
    state.memberRole = "trainer";
    const result = await approveAffiliatePartner(
      initialAffiliatePartnerActionState,
      form({ partnerId: PARTNER_A }),
    );

    expect(result.error).not.toBeNull();
    expect(partnerRow(PARTNER_A)?.status).toBe("pending");
    expect(auditActions()).toEqual([]);
  });

  it("ein trainer bucht nichts von Hand", async () => {
    state.memberRole = "trainer";
    const result = await createAffiliateManualBooking(
      initialAffiliateCommissionActionState,
      form({ partnerId: PARTNER_A, amountEuro: "25,00", currency: "eur", note: "Kulanz nach Rückfrage." }),
    );

    expect(result.error).not.toBeNull();
    expect(rpcCalls.some((call) => call.name === "book_affiliate_commissions")).toBe(false);
    expect(auditActions()).toEqual([]);
  });

  it("ein trainer bucht keine Bestellung um", async () => {
    state.memberRole = "trainer";
    const result = await reassignAffiliateOrder(
      initialAffiliateCommissionActionState,
      form({ orderId: ORDER_A, newPartnerId: PARTNER_A, reason: "Klick war vom Newsletter." }),
    );

    expect(result.error).not.toBeNull();
    expect(
      state.tables.affiliate_commissions.find((row) => row.id === COMMISSION_A)?.status,
    ).toBe("pending");
  });

  it("ein trainer sieht keine Kondition, die er angelegt hätte", async () => {
    state.memberRole = "trainer";
    const before = state.tables.affiliate_conditions.length;
    const result = await createAffiliateCondition(
      initialAffiliateConditionActionState,
      form({
        partnerId: PARTNER_A,
        rateKind: "percent",
        rateBp: "9000",
        fixedCents: "0",
        validFrom: "2026-09-01T00:00",
      }),
    );

    expect(result.error).not.toBeNull();
    expect(state.tables.affiliate_conditions.length).toBe(before);
  });

  it("owner und admin kommen durch", async () => {
    for (const role of ["owner", "admin"] as const) {
      seed();
      state.memberRole = role;
      const result = await approveAffiliatePartner(
        initialAffiliatePartnerActionState,
        form({ partnerId: PARTNER_A }),
      );
      expect(result.error).toBeNull();
      expect(partnerRow(PARTNER_A)?.status).toBe("active");
    }
  });

  it("ohne aktives Modul passiert nichts (Feature-Schalter, 9.8)", async () => {
    state.tenantEnabled = false;
    const result = await approveAffiliatePartner(
      initialAffiliatePartnerActionState,
      form({ partnerId: PARTNER_A }),
    );
    expect(result.error).not.toBeNull();
    expect(partnerRow(PARTNER_A)?.status).toBe("pending");
  });
});

// =======================================================================
// 3. G15 — Selbstfreigabe
// =======================================================================

describe("Selbstfreigabe (G15)", () => {
  it("die eigene Bewerbung wird nicht freigegeben", async () => {
    const result = await approveAffiliatePartner(
      initialAffiliatePartnerActionState,
      form({ partnerId: PARTNER_SELF }),
    );

    expect(result.error).toBe(SELF_DEALING);
    expect(partnerRow(PARTNER_SELF)?.status).toBe("pending");
    // G15 verlangt ausdrücklich einen Protokolleintrag je Versuch.
    expect(auditActions()).toContain("partner.self_approval_blocked");
  });

  it("die eigene Auszahlungssperre wird nicht gelöst", async () => {
    const result = await saveAffiliatePartnerAdminFields(
      initialAffiliatePartnerActionState,
      form({ partnerId: PARTNER_SELF, internalNote: "alles gut" }),
    );
    expect(result.error).toBe(SELF_DEALING);
    expect(partnerRow(PARTNER_SELF)?.internal_note).toBeNull();
  });

  it("keine Handbuchung auf die eigene Partnerzeile", async () => {
    const result = await createAffiliateManualBooking(
      initialAffiliateCommissionActionState,
      form({
        partnerId: PARTNER_SELF,
        amountEuro: "250,00",
        currency: "eur",
        note: "Bonus für mich selbst.",
      }),
    );
    expect(result.error).toBe(SELF_DEALING);
    expect(rpcCalls.some((call) => call.name === "book_affiliate_commissions")).toBe(false);
  });

  it("keine Kondition auf die eigene Partnerzeile", async () => {
    const before = state.tables.affiliate_conditions.length;
    const result = await createAffiliateCondition(
      initialAffiliateConditionActionState,
      form({
        partnerId: PARTNER_SELF,
        rateKind: "percent",
        rateBp: "9000",
        fixedCents: "0",
        validFrom: "2026-09-01T00:00",
      }),
    );
    expect(result.error).toBe(SELF_DEALING);
    expect(state.tables.affiliate_conditions.length).toBe(before);
    expect(auditActions()).toContain("condition.self_approval_blocked");
  });

  it("auch nicht über die EIGENE GRUPPE — der Umweg, den der Guard-Trigger zuerst übersah", async () => {
    const before = state.tables.affiliate_conditions.length;
    const result = await createAffiliateCondition(
      initialAffiliateConditionActionState,
      form({
        groupId: GROUP_SELF,
        rateKind: "percent",
        rateBp: "9000",
        fixedCents: "0",
        validFrom: "2026-09-01T00:00",
      }),
    );
    expect(result.error).toBe(SELF_DEALING);
    expect(state.tables.affiliate_conditions.length).toBe(before);
  });

  it("eine Kondition für eine FREMDE Gruppe bleibt erlaubt", async () => {
    const result = await createAffiliateCondition(
      initialAffiliateConditionActionState,
      form({
        groupId: GROUP_A,
        rateKind: "percent",
        rateBp: "2500",
        fixedCents: "0",
        validFrom: "2026-09-01T00:00",
      }),
    );
    expect(result.error).toBeNull();
    expect(auditActions()).toContain("condition.create");
  });

  it("die Umbuchung auf die eigene Partnerzeile wird abgewiesen", async () => {
    const result = await reassignAffiliateOrder(
      initialAffiliateCommissionActionState,
      form({ orderId: ORDER_A, newPartnerId: PARTNER_SELF, reason: "Kam über meinen Link." }),
    );
    expect(result.error).toBe(SELF_DEALING);
    expect(
      state.tables.affiliate_commissions.find((row) => row.id === COMMISSION_A)?.status,
    ).toBe("pending");
  });

  it("eine Einladung an die eigene Anmeldeadresse ist eine Selbstfreigabe", async () => {
    const before = state.tables.affiliate_partners.length;
    const result = await inviteAffiliatePartner(
      initialAffiliatePartnerActionState,
      form({
        applicantEmail: "Manager@Example.invalid",
        displayName: "Ich selbst",
        code: "ich-selbst",
      }),
    );
    expect(result.error).toBe(SELF_DEALING);
    expect(state.tables.affiliate_partners.length).toBe(before);
    expect(auditActions()).toContain("partner.self_approval_blocked");
  });

  it("die Einladung einer fremden Adresse legt eine vorab freigegebene Zeile an", async () => {
    const result = await inviteAffiliatePartner(
      initialAffiliatePartnerActionState,
      form({
        applicantEmail: "gast@example.invalid",
        displayName: "Gastpartner",
        code: "gastpartner",
      }),
    );
    expect(result.error).toBeNull();
    const created = state.tables.affiliate_partners.find(
      (row) => row.applicant_email === "gast@example.invalid",
    );
    expect(created?.status).toBe("active");
    expect(auditActions()).toContain("partner.invite");
  });

  it("sich selbst als Werber einzutragen wird abgewiesen", async () => {
    const result = await createAffiliatePartner(
      initialAffiliatePartnerActionState,
      form({
        applicantEmail: "neu@example.invalid",
        displayName: "Neuer Partner",
        code: "neu-partner",
        referredBy: PARTNER_SELF,
      }),
    );
    expect(result.error).toBe(SELF_DEALING);
  });
});

// =======================================================================
// 4. Handbuchung: Begründung und Betragsgrenze
// =======================================================================

describe("Handbuchung", () => {
  it("ohne Begründung wird abgewiesen", async () => {
    const result = await createAffiliateManualBooking(
      initialAffiliateCommissionActionState,
      form({ partnerId: PARTNER_A, amountEuro: "25,00", currency: "eur", note: "" }),
    );

    expect(result.error).toBe("Begründung: mindestens 5 Zeichen.");
    expect(rpcCalls.some((call) => call.name === "book_affiliate_commissions")).toBe(false);
    expect(auditActions()).toEqual([]);
  });

  it("mit Begründung wird gebucht und protokolliert", async () => {
    const result = await createAffiliateManualBooking(
      initialAffiliateCommissionActionState,
      form({
        partnerId: PARTNER_A,
        amountEuro: "25,00",
        currency: "eur",
        note: "Kulanz nach Rückfrage vom 02.09.",
      }),
    );

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    const call = rpcCalls.find((entry) => entry.name === "book_affiliate_commissions");
    expect(call).toBeDefined();
    const payload = (call?.payload as { p_payload: { rows: Array<Record<string, unknown>> } }).p_payload;
    expect(payload.rows[0]?.kind).toBe("manual");
    expect(payload.rows[0]?.amount_cents).toBe(2500);
    expect(String(payload.rows[0]?.dedup_key)).toMatch(/^manual:/);
    expect(auditActions()).toContain("commission.manual");
  });

  it("ein negativer Betrag wird sofort fällig, ein positiver erst nach der Sperrfrist", async () => {
    await createAffiliateManualBooking(
      initialAffiliateCommissionActionState,
      form({ partnerId: PARTNER_A, amountEuro: "-25,00", currency: "eur", note: "Korrektur Doppelbuchung." }),
    );
    const debtPayload = (
      rpcCalls.find((entry) => entry.name === "book_affiliate_commissions")
        ?.payload as { p_payload: { rows: Array<Record<string, unknown>> } }
    ).p_payload;
    const debtHold = Date.parse(String(debtPayload.rows[0]?.hold_until));

    seed();
    await createAffiliateManualBooking(
      initialAffiliateCommissionActionState,
      form({ partnerId: PARTNER_A, amountEuro: "25,00", currency: "eur", note: "Kulanz nach Rückfrage." }),
    );
    const creditPayload = (
      rpcCalls.find((entry) => entry.name === "book_affiliate_commissions")
        ?.payload as { p_payload: { rows: Array<Record<string, unknown>> } }
    ).p_payload;
    const creditHold = Date.parse(String(creditPayload.rows[0]?.hold_until));

    // 30 Tage Sperrfrist aus dem Programm — die Schuld wirkt sofort (G6).
    expect(creditHold - debtHold).toBeGreaterThan(29 * 86_400_000);
  });

  it("über 500 EUR braucht die zweite, ausgeschriebene Bestätigung (11.17)", async () => {
    const withoutConfirmation = await createAffiliateManualBooking(
      initialAffiliateCommissionActionState,
      form({
        partnerId: PARTNER_A,
        amountEuro: "750,00",
        currency: "eur",
        note: "Sondervereinbarung laut Mail.",
      }),
    );
    expect(withoutConfirmation.error).toContain("zweites Mal");
    expect(rpcCalls.some((call) => call.name === "book_affiliate_commissions")).toBe(false);

    const mismatched = await createAffiliateManualBooking(
      initialAffiliateCommissionActionState,
      form({
        partnerId: PARTNER_A,
        amountEuro: "750,00",
        currency: "eur",
        note: "Sondervereinbarung laut Mail.",
        confirmAmountEuro: "75,00",
      }),
    );
    expect(mismatched.error).toContain("zweites Mal");

    const confirmed = await createAffiliateManualBooking(
      initialAffiliateCommissionActionState,
      form({
        partnerId: PARTNER_A,
        amountEuro: "750,00",
        currency: "eur",
        note: "Sondervereinbarung laut Mail.",
        confirmAmountEuro: "750,00",
      }),
    );
    expect(confirmed.error).toBeNull();
  });
});

// =======================================================================
// 5. Umbuchung (4.6)
// =======================================================================

describe("Umbuchung", () => {
  it("ohne Begründung wird abgewiesen", async () => {
    const result = await reassignAffiliateOrder(
      initialAffiliateCommissionActionState,
      form({ orderId: ORDER_A, newPartnerId: PARTNER_A, reason: "" }),
    );
    expect(result.error).toBe("Begründung: mindestens 5 Zeichen.");
  });

  it("offene Zeilen werden mit cancel_reason='reassigned' storniert und eine neue Zeile entsteht", async () => {
    const result = await reassignAffiliateOrder(
      initialAffiliateCommissionActionState,
      form({ orderId: ORDER_A, newPartnerId: PARTNER_A, reason: "Klick war vom Newsletter." }),
    );

    expect(result.error).toBeNull();
    const original = state.tables.affiliate_commissions.find((row) => row.id === COMMISSION_A);
    expect(original?.status).toBe("cancelled");
    expect(original?.cancel_reason).toBe("reassigned");

    const call = rpcCalls.find((entry) => entry.name === "book_affiliate_commissions");
    const payload = (call?.payload as { p_payload: { rows: Array<Record<string, unknown>> } }).p_payload;
    // Schlüsselform wörtlich aus Plan 4.6: 'sale:' || order_id || ':r' || <lfd>.
    expect(payload.rows[0]?.dedup_key).toBe(`sale:${ORDER_A}:r1`);
    expect(payload.rows[0]?.partner_id).toBe(PARTNER_A);
    expect(auditActions()).toContain("commission.reassign");
  });

  it("eine unbekannte Bestellung liefert dieselbe Meldung wie eine fremde", async () => {
    const unknown = await reassignAffiliateOrder(
      initialAffiliateCommissionActionState,
      form({
        orderId: "90909090-9090-4090-8090-909090909090",
        newPartnerId: PARTNER_A,
        reason: "Klick war vom Newsletter.",
      }),
    );
    expect(unknown.error).toBe("Die Bestellung wurde in dieser Akademie nicht gefunden.");
  });
});
