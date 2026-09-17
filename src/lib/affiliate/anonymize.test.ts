import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AFFILIATE_ANONYMIZED_DISPLAY_NAME,
  anonymizeAffiliatePartner,
  anonymizedApplicantEmail,
} from "./anonymize";

/**
 * Affiliate-System, Block B9 — ANONYMISIERUNG STATT LÖSCHUNG
 * (PLAN_Affiliate-System.md 7.8).
 *
 * Die Abnahme aus 10/B9 lautet wörtlich: „die Anonymisierung lässt
 * `affiliate_commissions` und `affiliate_payouts` unverändert". Genau das
 * prüft der Kern dieser Datei — und zwar nicht über einen Spion auf
 * `update()`, sondern über einen VORHER/NACHHER-Vergleich der kompletten
 * Zeilen: ein Test, der nur zählt, welche Methoden gerufen wurden, hätte
 * einen Tippfehler im Tabellennamen (`affiliate_commission`) nicht bemerkt.
 *
 * Mock-Muster wie `reversal.test.ts`: ein In-Memory-Array je Tabelle mit
 * ECHT angewandten Filtern. `eq()` filtert wirklich, `delete()` entfernt
 * wirklich — sonst prüfte der Mandantenbindungs-Test nichts.
 *
 * `writeAuditEntry()` ist gemockt, weil es selbst `createAdminClient()`
 * ruft (echtes Netz). Der Eintrag wird trotzdem geprüft: ohne Prüfpfad
 * ist eine Anonymisierung gegenüber einer Aufsichtsbehörde wertlos.
 */

const auditEntries: Array<Record<string, unknown>> = [];
vi.mock("./audit", () => ({
  writeAuditEntry: vi.fn(async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  }),
}));

type Row = Record<string, unknown>;
type MockError = { code?: string; message: string } | null;

const db: { tables: Record<string, Row[]>; errors: Record<string, MockError> } = {
  tables: {},
  errors: {},
};

function table(name: string): Row[] {
  return db.tables[name] ?? (db.tables[name] = []);
}

/** Eine Filterkette, die auf einer Kopie der Zeilenreferenzen arbeitet. */
class MockQuery {
  private rows: Row[];

  constructor(
    private tableName: string,
    private mode: "select" | "update" | "delete",
    private patch: Row = {},
  ) {
    this.rows = [...table(tableName)];
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((r) => r[column] === value);
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    this.rows = this.rows.filter((r) => values.includes(r[column]));
    return this;
  }
  limit(count: number): this {
    this.rows = this.rows.slice(0, count);
    return this;
  }
  /** `.is(col, null)` — die Grenze „Beleg mit Nummer / Entwurf ohne" (N4). */
  is(column: string, value: null): this {
    this.rows = this.rows.filter((r) => (r[column] ?? null) === value);
    return this;
  }

  private apply(): { data: Row[] | null; error: MockError } {
    const error = db.errors[`${this.tableName}:${this.mode}`] ?? null;
    if (error) return { data: null, error };

    if (this.mode === "update") {
      for (const row of this.rows) Object.assign(row, this.patch);
    } else if (this.mode === "delete") {
      const doomed = new Set(this.rows);
      db.tables[this.tableName] = table(this.tableName).filter((r) => !doomed.has(r));
    }
    return { data: this.rows.map((r) => ({ ...r })), error: null };
  }

  /** `.select(...)` nach update/delete gibt die betroffenen Zeilen zurück. */
  select(): this {
    return this;
  }

  maybeSingle(): Promise<{ data: Row | null; error: MockError }> {
    const { data, error } = this.apply();
    return Promise.resolve({ data: data?.[0] ?? null, error });
  }

  then<T>(onFulfilled: (v: { data: Row[] | null; error: MockError }) => T): Promise<T> {
    return Promise.resolve(onFulfilled(this.apply()));
  }
}

const admin = {
  from(tableName: string) {
    return {
      select: () => new MockQuery(tableName, "select"),
      update: (patch: Row) => new MockQuery(tableName, "update", patch),
      delete: () => new MockQuery(tableName, "delete"),
    };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const PARTNER = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

function seed(): void {
  db.tables = {
    affiliate_partners: [
      {
        id: PARTNER,
        tenant_id: TENANT,
        program_id: "prog",
        user_id: USER,
        applicant_email: "erika@example.invalid",
        display_name: "Erika Musterfrau",
        company: "Musterfrau GmbH",
        code: "erika-m",
        status: "active",
        internal_note: "Ruft oft an.",
        application: { motivation: "Ich habe eine Liste." },
        terms_accepted_ip_hash: "a".repeat(64),
      },
    ],
    affiliate_billing_profiles: [
      {
        partner_id: PARTNER,
        tenant_id: TENANT,
        legal_name: "Musterfrau GmbH",
        street: "Musterweg 1",
        iban: "DE00000000000000000000",
      },
    ],
    affiliate_clicks: [
      { id: "click-1", tenant_id: TENANT, partner_id: PARTNER },
      { id: "click-2", tenant_id: TENANT, partner_id: PARTNER },
      { id: "click-fremd", tenant_id: TENANT, partner_id: "anderer-partner" },
    ],
    affiliate_referrals: [
      { id: "ref-1", tenant_id: TENANT, partner_id: PARTNER, user_id: "kaeufer" },
    ],
    affiliate_commissions: [
      {
        id: "com-1",
        tenant_id: TENANT,
        partner_id: PARTNER,
        kind: "sale",
        amount_cents: 11888,
        currency: "eur",
        status: "paid",
        dedup_key: "sale:order-1",
      },
    ],
    affiliate_payouts: [
      {
        id: "pay-1",
        tenant_id: TENANT,
        partner_id: PARTNER,
        status: "paid",
        document_no: "GS-2026-000004",
        total_cents: 18860,
        // Seit Befund 10 trägt der Beleg die Anschrift eingefroren mit. Für
        // einen NUMMERIERTEN Beleg deckt Art. 17 Abs. 3 lit. b DSGVO das.
        recipient_snapshot: {
          legal_name: "Musterfrau GmbH",
          street: "Musterweg 1",
          postal_code: "12345",
          city: "Musterstadt",
          country: "DE",
          vat_id: "DE123456789",
          tax_number: "12/345/67890",
        },
      },
      {
        // Ein VERWORFENER Entwurf: nie eine Nummer gezogen, kein Beleg, und
        // er steht nicht in OPEN_PAYOUT_STATUSES — er blockiert die
        // Anonymisierung also nicht und behielte die Anschrift sonst dauerhaft
        // (Befund N4).
        id: "pay-2",
        tenant_id: TENANT,
        partner_id: PARTNER,
        status: "cancelled",
        document_no: null,
        total_cents: 0,
        recipient_snapshot: {
          legal_name: "Musterfrau GmbH",
          street: "Geheimweg 7",
          postal_code: "12345",
          city: "Musterstadt",
          country: "DE",
          vat_id: "DE123456789",
          tax_number: "12/345/67890",
        },
      },
      {
        // Gegenprobe Mandantengrenze: gleicher Partnername, fremder Mandant.
        id: "pay-fremd",
        tenant_id: OTHER_TENANT,
        partner_id: PARTNER,
        status: "cancelled",
        document_no: null,
        total_cents: 0,
        recipient_snapshot: { legal_name: "Fremd GmbH", street: "Fremdweg 3" },
      },
    ],
  };
  db.errors = {};
  auditEntries.length = 0;
}

beforeEach(seed);

describe("anonymizeAffiliatePartner", () => {
  it("lässt Provisionen und NUMMERIERTE Belege Zeichen für Zeichen unverändert", async () => {
    const commissionsBefore = JSON.stringify(db.tables.affiliate_commissions);
    const issuedBefore = JSON.stringify(
      db.tables.affiliate_payouts.find((row) => row.id === "pay-1"),
    );

    const result = await anonymizeAffiliatePartner(admin, {
      tenant_id: TENANT,
      partner_id: PARTNER,
      reason: "Löschantrag vom 12.09.2026",
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(db.tables.affiliate_commissions)).toBe(commissionsBefore);
    // Der Beleg mit Nummer bleibt vollständig — einschließlich seiner
    // eingefrorenen Anschrift. Art. 17 Abs. 3 lit. b DSGVO deckt ihn, und der
    // Belegfrost im Guard ließe eine Änderung ohnehin nicht zu.
    expect(JSON.stringify(db.tables.affiliate_payouts.find((row) => row.id === "pay-1"))).toBe(
      issuedBefore,
    );
  });

  // --- Die Grenze an der Belegnummer (Abnahme, Befund N4) ----------------

  it("nimmt einem verworfenen Entwurf OHNE Nummer die eingefrorene Anschrift", async () => {
    const result = await anonymizeAffiliatePartner(admin, {
      tenant_id: TENANT,
      partner_id: PARTNER,
      reason: "Löschantrag vom 12.09.2026",
    });

    expect(result).toMatchObject({ ok: true, payout_snapshots_cleared: 1 });
    const draft = db.tables.affiliate_payouts.find((row) => row.id === "pay-2");
    expect(draft?.recipient_snapshot).toBeNull();
    // Und die Zeile selbst bleibt stehen: gelöscht wird hier nichts, der
    // Lösch-Guard der Tabelle ließe es auch gar nicht zu.
    expect(draft).toBeDefined();
    expect(draft?.status).toBe("cancelled");
  });

  it("fasst den Entwurf eines FREMDEN Mandanten nicht an", async () => {
    await anonymizeAffiliatePartner(admin, {
      tenant_id: TENANT,
      partner_id: PARTNER,
      reason: "Löschantrag",
    });

    const foreign = db.tables.affiliate_payouts.find((row) => row.id === "pay-fremd");
    expect(foreign?.recipient_snapshot).toMatchObject({ legal_name: "Fremd GmbH" });
  });

  it("macht Name, Firma, Adresse, Konto und Zustimmungsnachweis unkenntlich", async () => {
    await anonymizeAffiliatePartner(admin, {
      tenant_id: TENANT,
      partner_id: PARTNER,
      reason: "Löschantrag vom 12.09.2026",
    });

    const partner = db.tables.affiliate_partners[0];
    expect(partner.display_name).toBe(AFFILIATE_ANONYMIZED_DISPLAY_NAME);
    expect(partner.company).toBeNull();
    expect(partner.user_id).toBeNull();
    expect(partner.applicant_email).toBe(anonymizedApplicantEmail(PARTNER));
    expect(partner.internal_note).toBeNull();
    expect(partner.terms_accepted_ip_hash).toBeNull();
    expect(partner.application).toEqual({});

    // Der Code bleibt: er steht in der Attributionshistorie jeder
    // Provisionszeile und ist ohne Stammdaten kein Personenbezug mehr.
    expect(partner.code).toBe("erika-m");
    expect(partner.status).toBe("active");

    // Und nichts vom alten Datensatz ist irgendwo übrig geblieben — mit
    // GENAU EINER benannten Ausnahme: der nummerierte Beleg behält seine
    // eingefrorene Anschrift (§ 14 Abs. 4 UStG, Art. 17 Abs. 3 lit. b DSGVO).
    // Die Anschrift des Entwurfs ohne Nummer ist dagegen fort (Befund N4).
    const dump = JSON.stringify(db.tables);
    expect(dump).not.toContain("Erika Musterfrau");
    expect(dump).not.toContain("erika@example.invalid");
    expect(dump).not.toContain("DE00000000000000000000");
    expect(dump).not.toContain("Geheimweg 7");

    const issued = db.tables.affiliate_payouts.find((row) => row.id === "pay-1");
    expect(issued?.recipient_snapshot).toMatchObject({ street: "Musterweg 1" });
    // Außerhalb des Belegs steht sie nirgends mehr.
    expect(db.tables.affiliate_billing_profiles).toHaveLength(0);
  });

  it("löscht Abrechnungsprofil, Zuordnungen und Klicks — nur die des Partners", async () => {
    const result = await anonymizeAffiliatePartner(admin, {
      tenant_id: TENANT,
      partner_id: PARTNER,
      reason: "Löschantrag",
    });

    expect(result).toMatchObject({
      ok: true,
      billing_profile_deleted: true,
      referrals_deleted: 1,
      clicks_deleted: 2,
    });
    expect(db.tables.affiliate_billing_profiles).toHaveLength(0);
    expect(db.tables.affiliate_referrals).toHaveLength(0);
    // Die Klickzeile eines ANDEREN Partners desselben Mandanten bleibt.
    expect(db.tables.affiliate_clicks).toEqual([
      { id: "click-fremd", tenant_id: TENANT, partner_id: "anderer-partner" },
    ]);
  });

  it("rührt einen Partner eines fremden Mandanten nicht an", async () => {
    const before = JSON.stringify(db.tables);

    const result = await anonymizeAffiliatePartner(admin, {
      tenant_id: OTHER_TENANT,
      partner_id: PARTNER,
      reason: "Löschantrag",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(auditEntries).toHaveLength(0);
  });

  it("verweigert die Anonymisierung, solange ein Beleg noch aussteht", async () => {
    // 7.8: das Abrechnungsprofil darf erst weg, NACHDEM alle Belege erzeugt
    // sind — die Anschrift steht dann in der PDF, wo sie hingehört.
    db.tables.affiliate_payouts.push({
      id: "pay-2",
      tenant_id: TENANT,
      partner_id: PARTNER,
      status: "approved",
      document_no: null,
    });
    const before = JSON.stringify(db.tables);

    const result = await anonymizeAffiliatePartner(admin, {
      tenant_id: TENANT,
      partner_id: PARTNER,
      reason: "Löschantrag",
    });

    expect(result).toEqual({ ok: false, reason: "payout_open" });
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  it("schreibt einen Prüfpfad-Eintrag mit Grund, aber ohne Personendaten", async () => {
    await anonymizeAffiliatePartner(admin, {
      tenant_id: TENANT,
      partner_id: PARTNER,
      reason: "Löschantrag vom 12.09.2026, Ticket 4711",
      actor_user_id: USER,
    });

    expect(auditEntries).toHaveLength(1);
    const entry = auditEntries[0];
    expect(entry).toMatchObject({
      tenantId: TENANT,
      entity: "partner",
      entityId: PARTNER,
      action: "partner.anonymize",
      actorKind: "manager",
      actorUserId: USER,
    });

    const serialised = JSON.stringify(entry);
    expect(serialised).toContain("Ticket 4711");
    expect(serialised).not.toContain("Erika Musterfrau");
    expect(serialised).not.toContain("erika@example.invalid");
  });

  it("ist wiederholbar — ein zweiter Lauf ändert nichts mehr", async () => {
    await anonymizeAffiliatePartner(admin, {
      tenant_id: TENANT,
      partner_id: PARTNER,
      reason: "Löschantrag",
    });
    const afterFirst = JSON.stringify(db.tables);

    const second = await anonymizeAffiliatePartner(admin, {
      tenant_id: TENANT,
      partner_id: PARTNER,
      reason: "Löschantrag (Wiederholung nach Abbruch)",
    });

    expect(second).toMatchObject({ ok: true, billing_profile_deleted: false, referrals_deleted: 0, clicks_deleted: 0 });
    expect(JSON.stringify(db.tables)).toBe(afterFirst);
  });

  it("bricht ab, ohne etwas zu löschen, wenn die Partnerzeile nicht schreibbar ist", async () => {
    db.errors["affiliate_partners:update"] = { code: "42501", message: "permission denied" };

    const result = await anonymizeAffiliatePartner(admin, {
      tenant_id: TENANT,
      partner_id: PARTNER,
      reason: "Löschantrag",
    });

    expect(result).toEqual({ ok: false, reason: "write_failed" });
    expect(db.tables.affiliate_billing_profiles).toHaveLength(1);
    expect(db.tables.affiliate_clicks).toHaveLength(3);
  });

  it("weist eine leere Begründung zurück, bevor irgendetwas passiert", async () => {
    await expect(
      anonymizeAffiliatePartner(admin, { tenant_id: TENANT, partner_id: PARTNER, reason: "  " }),
    ).rejects.toThrow();
    expect(db.tables.affiliate_billing_profiles).toHaveLength(1);
  });
});
