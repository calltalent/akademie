import { beforeEach, describe, expect, it } from "vitest";
import { verifyAffiliateIntegrity } from "./integrity";
import {
  approveAffiliatePayout,
  createAffiliatePayoutDrafts,
  markAffiliatePayoutFailed,
  markAffiliatePayoutPaid,
  planAffiliatePayoutRun,
  resolveAffiliatePayoutPeriod,
} from "./payout";

/**
 * Affiliate-System, Block B8 — DER AUSZAHLUNGSLAUF
 * (PLAN_Affiliate-System.md 7.1, 7.2, 7.6, 7.7; G8, G15).
 *
 * Mock-Muster wie `reversal.test.ts` und `process.test.ts`: ein In-Memory-
 * Array je Tabelle mit ECHT angewandten Filtern. Der Compare-and-Swap ist
 * deshalb ein echter Compare-and-Swap — `update(...).is("payout_id", null)`
 * greift im Mock nur, solange die Zeile ungestempelt ist. Ohne diese
 * Eigenschaft prüfte der Test „zwei gleichzeitige Läufe" nichts.
 *
 * ## WARUM DIESER MOCK SO STRENG IST WIE DIE DATENBANK
 *
 * Die Abnahme B8/B9 hat drei Fehler gefunden, die den Auszahlungsweg
 * vollständig funktionsunfähig machten — und KEINEN davon hat diese Testsuite
 * gesehen, obwohl sie grün war:
 *
 *   1. Jeder Entwurf brach beim INSERT mit 23514 ab (`check (subtotal_cents > 0)`
 *      gegen `subtotal_cents: 0`).
 *   2. Jede Freigabe brach ab: die RPC wurde mit einem statt drei
 *      Pflichtargumenten gerufen.
 *   3. `deleteEmptyDraft()` lief unter `service_role` gegen den Lösch-Guard und
 *      scheiterte immer; zusammen mit dem Teil-Unique-Index auf offene Entwürfe
 *      sperrte die erste leer gebliebene Entwurfszeile den Partner für immer.
 *
 * Der Grund war nicht, dass Tests fehlten, sondern dass der Mock GROSSZÜGIGER
 * war als die Datenbank: keine CHECK-Bedingungen, keine Guard-Trigger, keine
 * Indizes, und ein RPC-Nachbau, der die beiden fehlenden Argumente gar nicht
 * kannte. Ein Mock, der weniger streng ist als die Datenbank, prüft nichts — er
 * gibt falsche Sicherheit, und zwar genau an der Naht zwischen Migration und
 * TypeScript, an der in diesem Modul alle drei Fehler lagen.
 *
 * Nachgebaut sind deshalb, Wort für Wort aus
 * `supabase/migrations/20260911150000_affiliate_payouts.sql`:
 *   - die CHECK-Bedingungen von `affiliate_payouts` (Abschnitt 2.1),
 *   - die Übergangstabelle und der Belegfrost aus `affiliate_payouts_guard()`
 *     (2.3), einschließlich der Erlaubnisliste (der Mock ist `service_role`),
 *   - `affiliate_payouts_delete_guard()` (2.7) — jedes DELETE scheitert,
 *   - die beiden Teil-Unique-Indizes (2.2) und `unique (tenant_id, document_no)`,
 *   - die Signatur von `approve_affiliate_payout()` samt aller drei
 *     Pflichtargumente (Abschnitt 5, Abweichung A4) und der Ableitung des
 *     Belegjahrs aus dem AUSSTELLUNGSDATUM in Europe/Berlin (nicht aus
 *     `period_to`).
 *   - `select("*")` bricht auf den Affiliate-Tabellen mit 42501 ab
 *     (Spalten-Grant).
 *
 * WAS DER MOCK NICHT KANN, ausdrücklich statt stillschweigend:
 *   - ECHTE NEBENLÄUFIGKEIT. Die Tests laufen in einer Schleife im selben
 *     Thread; `for update`, Zeilensperren und das Warten der zweiten
 *     Transaktion gibt es hier nicht. Der Test „zwei gleichzeitige Läufe"
 *     prüft deshalb die REIHENFOLGE der Anweisungen (Compare-and-Swap statt
 *     lesen-dann-schreiben), nicht das Sperrverhalten von Postgres.
 *   - TRANSAKTIONEN und damit das Zurückrollen des Zählerstands (Fall 1 im
 *     Kopf der Migration). Schlägt hier etwas nach dem Zug der Nummer fehl,
 *     bleibt der Zähler erhöht.
 *   - `pg_trigger_depth()` und damit den Kaskadenausweg für `created_by`.
 *   - Fremdschlüssel: ein Verweis auf eine nicht existierende Zeile fällt im
 *     Mock nicht auf.
 *   - `current_user`: der Mock ist IMMER `service_role`. Die Zweige für
 *     'postgres'/'supabase_admin' sind damit nicht abgedeckt — sie sind der
 *     ausdrückliche Berichtigungsweg per Migration.
 *
 * Geprüft werden die sechs Fälle aus dem Bauplan (Mindestbetrag, Negativsaldo,
 * blockiertes Profil, Währungstrennung, zwei gleichzeitige Läufe, G15) und
 * zusätzlich die Regeln, an denen die Abnahme hängen geblieben ist.
 */

type Row = Record<string, unknown>;
type MockError = { code?: string; message: string };

/** Ein Fehler, wie ihn PostgREST zurückgibt: als WERT, nicht als Ausnahme. */
class DbError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const db: {
  tables: Record<string, Row[]>;
  errors: Record<string, MockError | undefined>;
  nextId: number;
  counters: Record<string, number>;
  /** Die Systemzeit des Nachbaus — die Datenbank setzt Zeitstempel selbst. */
  now: Date;
} = { tables: {}, errors: {}, nextId: 0, counters: {}, now: new Date("2026-10-01T06:00:00.000Z") };

function table(name: string): Row[] {
  return db.tables[name] ?? (db.tables[name] = []);
}

function nextId(prefix: string): string {
  db.nextId += 1;
  return `${prefix}_${db.nextId}`;
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// --- Die Regeln von `affiliate_payouts` ---------------------------------

const PAYOUT_STATUSES = ["draft", "approved", "exported", "paid", "failed", "cancelled"];
const TAX_MODES = ["regular", "small_business", "reverse_charge", "non_eu"];
const DOCUMENT_NO_PATTERN = /^GS-[A-Z0-9][A-Z0-9-]{1,40}-[0-9]{4}-[0-9]{6}$/;

/** `check (...)`-Verletzung: derselbe SQLSTATE wie in Postgres. */
function check(condition: boolean, name: string): void {
  if (!condition) throw new DbError("23514", `affiliate_payouts_check: ${name}`);
}

/**
 * Die CHECK-Bedingungen der Tabelle, in der Reihenfolge der Migration
 * (Abschnitt 2.1). Jede Zeile hier hat ihre Entsprechung dort; wer eine
 * ändert, ändert beide.
 */
function assertPayoutChecks(row: Row): void {
  const gross = num(row.gross_cents);
  const reversal = num(row.reversal_cents);
  const subtotal = num(row.subtotal_cents);
  const tax = num(row.tax_cents);
  const total = num(row.total_cents);
  const rateBp = num(row.tax_rate_bp);
  const status = String(row.status ?? "");
  const taxMode = String(row.tax_mode ?? "");
  const reverses = str(row.reverses_payout_id);
  const documentNo = str(row.document_no);
  const documentIssuedAt = str(row.document_issued_at);
  const documentPath = str(row.document_path);
  const approvedAt = str(row.approved_at);
  const paidAt = str(row.paid_at);

  check(/^[a-z]{3}$/.test(String(row.currency ?? "")), "currency");
  check(PAYOUT_STATUSES.includes(status), "status");
  check(TAX_MODES.includes(taxMode), "tax_mode");
  check(Number.isInteger(rateBp) && rateBp >= 0 && rateBp <= 10_000, "tax_rate_bp");

  check(subtotal === gross + reversal, "subtotal = gross + reversal");
  check(total === subtotal + tax, "total = subtotal + tax");
  check(
    reverses === null ? gross >= 0 && reversal <= 0 : gross <= 0 && reversal >= 0,
    "Vorzeichen von gross/reversal",
  );
  check(
    reverses !== null
      ? subtotal < 0
      : status === "draft" || status === "cancelled"
        ? subtotal >= 0
        : subtotal > 0,
    "subtotal_cents",
  );
  check((rateBp > 0) === (taxMode === "regular"), "(tax_rate_bp > 0) = (tax_mode = regular)");
  check(
    tax ===
      (subtotal >= 0
        ? Math.trunc((subtotal * rateBp + 5000) / 10_000)
        : -Math.trunc((-subtotal * rateBp + 5000) / 10_000)),
    "Steuerformel",
  );

  check(status === "draft" || status === "cancelled" || documentNo !== null, "Nummernpflicht");
  check((documentNo === null) === (documentIssuedAt === null), "Nummer und Datum");
  check(status !== "draft" || documentNo === null, "Entwurf ohne Nummer");
  check(documentNo === null || DOCUMENT_NO_PATTERN.test(documentNo), "Format der Nummer");
  check(
    documentPath === null ||
      documentPath === `${String(row.tenant_id)}/affiliate/payouts/${String(row.id)}.pdf`,
    "Pfadkonvention",
  );
  check(
    (approvedAt !== null) === !(status === "draft" || status === "cancelled"),
    "approved_at",
  );
  check((status === "paid") === (paidAt !== null), "paid_at");
  check(status === "draft" || status === "cancelled" || str(row.method) !== null, "method");
  check(reverses === null || reverses !== row.id, "kein Selbst-Storno");
}

/** `unique`-Verletzung: derselbe SQLSTATE wie in Postgres. */
function unique(condition: boolean, name: string): void {
  if (!condition) throw new DbError("23505", `affiliate_payouts_uniq: ${name}`);
}

/**
 * Die Indizes aus Abschnitt 2.2, die im Betrieb tatsächlich greifen:
 *   - `affiliate_payouts_open_draft_uniq` — ein offener Entwurf je Mandant,
 *     Partner und Währung (Storno-Entwürfe ausgenommen);
 *   - `affiliate_payouts_reverses_uniq` — ein Beleg wird höchstens einmal
 *     storniert;
 *   - `unique (tenant_id, document_no)`.
 */
function assertPayoutIndexes(rows: readonly Row[]): void {
  const openDrafts = new Set<string>();
  const reverses = new Set<string>();
  const documents = new Set<string>();
  for (const row of rows) {
    if (row.status === "draft" && (row.reverses_payout_id ?? null) === null) {
      const key = `${String(row.tenant_id)}|${String(row.partner_id)}|${String(row.currency)}`;
      unique(!openDrafts.has(key), "affiliate_payouts_open_draft_uniq");
      openDrafts.add(key);
    }
    if ((row.reverses_payout_id ?? null) !== null) {
      const key = `${String(row.tenant_id)}|${String(row.reverses_payout_id)}`;
      unique(!reverses.has(key), "affiliate_payouts_reverses_uniq");
      reverses.add(key);
    }
    if ((row.document_no ?? null) !== null) {
      const key = `${String(row.tenant_id)}|${String(row.document_no)}`;
      unique(!documents.has(key), "unique (tenant_id, document_no)");
      documents.add(key);
    }
  }
}

/** `raise exception` aus einem Guard: P0001, wie in Postgres. */
function guardError(name: string): DbError {
  return new DbError("P0001", name);
}

/**
 * `affiliate_payouts_guard()`, INSERT-Zweig. Der Mock ist `service_role` und
 * steht damit NICHT auf der Erlaubnisliste — genau das ist der Punkt.
 */
function payoutInsertGuard(row: Row): Row {
  const next = { ...row };
  next.created_at = db.now.toISOString();
  next.updated_at = db.now.toISOString();
  if (next.status !== "draft") throw guardError("affiliate_payout_insert_must_be_draft");
  if (
    (next.document_no ?? null) !== null ||
    (next.document_issued_at ?? null) !== null ||
    (next.document_path ?? null) !== null ||
    (next.approved_at ?? null) !== null ||
    (next.paid_at ?? null) !== null
  ) {
    throw guardError("affiliate_payout_insert_not_issued");
  }
  return next;
}

/** Die Übergangstabelle aus 2.3 — 'paid', 'failed' und 'cancelled' sind Endzustände. */
const PAYOUT_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["approved", "cancelled"],
  approved: ["exported", "paid", "failed"],
  exported: ["paid", "failed"],
  paid: [],
  failed: [],
  cancelled: [],
};

/** `affiliate_payouts_guard()`, UPDATE-Zweig. */
function payoutUpdateGuard(old: Row, patched: Row): Row {
  const next = { ...patched };

  // Identitätsspalten sind für jede Rolle fest.
  next.id = old.id;
  next.tenant_id = old.tenant_id;
  next.program_id = old.program_id;
  next.partner_id = old.partner_id;
  next.created_at = old.created_at;
  next.created_by = old.created_by;
  next.reverses_payout_id = old.reverses_payout_id ?? null;
  next.updated_at = db.now.toISOString();

  const oldStatus = String(old.status ?? "");
  const newStatus = String(next.status ?? "");
  if (newStatus !== oldStatus && !(PAYOUT_TRANSITIONS[oldStatus] ?? []).includes(newStatus)) {
    throw guardError("affiliate_payout_status_transition_forbidden");
  }

  // Befund 8: die Nummer entsteht ausschließlich im Übergang draft -> approved.
  if (
    (next.document_no ?? null) !== (old.document_no ?? null) &&
    !(oldStatus === "draft" && newStatus === "approved")
  ) {
    throw guardError("affiliate_payout_document_no_immutable");
  }

  if (oldStatus === "draft" && newStatus === "approved") {
    if ((next.document_no ?? null) === null) {
      throw guardError("affiliate_payout_document_no_required");
    }
    next.approved_at = db.now.toISOString();
    next.document_issued_at = db.now.toISOString();
  }

  if (newStatus === "paid" && oldStatus !== "paid") next.paid_at = db.now.toISOString();
  if ((old.paid_at ?? null) !== null) next.paid_at = old.paid_at;

  // Der Belegfrost: ab vergebener Nummer ist alles außer `document_path` fest.
  if ((old.document_no ?? null) !== null) {
    for (const column of [
      "period_from",
      "period_to",
      "currency",
      "gross_cents",
      "reversal_cents",
      "subtotal_cents",
      "tax_mode",
      "tax_rate_bp",
      "tax_cents",
      "total_cents",
      "document_no",
      "document_issued_at",
      "approved_at",
      "recipient_snapshot",
    ]) {
      next[column] = old[column];
    }
  }

  // Der Zahlungsfrost.
  if (oldStatus === "paid") {
    next.method = old.method;
    next.reference = old.reference;
  }

  return next;
}

/**
 * `affiliate_payouts_delete_guard()` (2.7). Für `service_role` gibt es keinen
 * Weg vorbei — ein Beleg wird nie gelöscht, auch kein verworfener Entwurf.
 */
function payoutDeleteGuard(): never {
  throw guardError("affiliate_payout_immutable");
}

/** Die Standardwerte der Spalten, damit ein INSERT dieselbe Zeile ergibt wie in Postgres. */
const PAYOUT_DEFAULTS: Row = {
  currency: "eur",
  tax_rate_bp: 0,
  tax_cents: 0,
  status: "draft",
  method: null,
  document_no: null,
  document_path: null,
  document_issued_at: null,
  reverses_payout_id: null,
  recipient_snapshot: null,
  reference: null,
  approved_at: null,
  paid_at: null,
  created_by: null,
};

// --- Die Abfragekette ---------------------------------------------------

type Predicate = (row: Row) => boolean;

/** Die Filterkette, die Lesen, Schreiben und Löschen teilen. */
class Filters {
  protected predicates: Predicate[] = [];

  eq(column: string, value: unknown): this {
    this.predicates.push((r) => r[column] === value);
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    this.predicates.push((r) => values.includes(r[column]));
    return this;
  }
  is(column: string, value: null): this {
    this.predicates.push((r) => (r[column] ?? null) === value);
    return this;
  }
  lte(column: string, value: unknown): this {
    this.predicates.push((r) => compare(r[column], value) <= 0);
    return this;
  }
  lt(column: string, value: unknown): this {
    this.predicates.push((r) => compare(r[column], value) < 0);
    return this;
  }
  gt(column: string, value: unknown): this {
    this.predicates.push((r) => compare(r[column] ?? 0, value) > 0);
    return this;
  }
  protected matches(rows: readonly Row[]): Row[] {
    return rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
  }
}

/** Eine Regelverletzung kommt als Wert zurück, nicht als Ausnahme — wie bei PostgREST. */
function asDbError(e: unknown): { data: null; error: MockError } {
  if (e instanceof DbError) return { data: null, error: { code: e.code, message: e.message } };
  throw e;
}

class MockSelect extends Filters {
  private sortColumn: string | null = null;

  constructor(
    private tableName: string,
    private columns: string,
  ) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().select().order(col, opts) passen; der Mock sortiert nur nach Spalte
  order(column: string, _options?: { ascending?: boolean }): this {
    this.sortColumn = column;
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu .range(from, to) passen; der Test bleibt unter der Seitengroesse
  range(_from: number, _to: number): this {
    // Der Test bleibt bewusst unter der Seitengröße; die Schleife in payout.ts
    // bricht damit nach der ersten Seite ab.
    return this;
  }

  private resolve(): { data: Row[] | null; error: MockError | null } {
    const error = db.errors[this.tableName];
    if (error) return { data: null, error };
    if (this.columns.trim() === "*") {
      return { data: null, error: { code: "42501", message: "permission denied for column" } };
    }
    const rows = this.matches(table(this.tableName)).map((row) => ({ ...row }));
    if (this.sortColumn !== null) {
      const column = this.sortColumn;
      rows.sort((a, b) => compare(a[column], b[column]));
    }
    return { data: rows, error: null };
  }

  maybeSingle<T = Row>(): Promise<{ data: T | null; error: MockError | null }> {
    const { data, error } = this.resolve();
    return Promise.resolve({ data: (data?.[0] ?? null) as T | null, error });
  }
  then<T>(onFulfilled: (v: { data: Row[] | null; error: MockError | null }) => T): Promise<T> {
    return Promise.resolve(onFulfilled(this.resolve()));
  }
}

class MockUpdate extends Filters {
  constructor(
    private tableName: string,
    private patch: Row,
  ) {
    super();
  }

  private resolve(): { data: Row[] | null; error: MockError | null } {
    const error = db.errors[this.tableName];
    if (error) return { data: null, error };
    const rows = table(this.tableName);
    const matched = this.matches(rows);

    try {
      const patched = matched.map((row) => {
        const next = { ...row, ...this.patch };
        if (this.tableName === "affiliate_payouts") {
          const guarded = payoutUpdateGuard(row, next);
          assertPayoutChecks(guarded);
          return guarded;
        }
        // Der Guard-Trigger setzt `paid_at` selbst (G8, zweite Hälfte).
        if (this.tableName === "affiliate_commissions" && this.patch.status === "paid") {
          next.paid_at = db.now.toISOString();
        }
        return next;
      });

      if (this.tableName === "affiliate_payouts") {
        assertPayoutIndexes(
          rows.map((row) => {
            const index = matched.indexOf(row);
            return index === -1 ? row : patched[index];
          }),
        );
      }
      matched.forEach((row, index) => Object.assign(row, patched[index]));
    } catch (e) {
      return asDbError(e);
    }

    return { data: matched.map((row) => ({ ...row })), error: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().update().select(cols) passen, der Mock braucht die Spaltenliste selbst nicht
  select(_columns: string): { then: MockUpdate["then"] } {
    return { then: (onFulfilled) => this.then(onFulfilled) };
  }
  then<T>(onFulfilled: (v: { data: Row[] | null; error: MockError | null }) => T): Promise<T> {
    return Promise.resolve(onFulfilled(this.resolve()));
  }
}

class MockDelete extends Filters {
  constructor(private tableName: string) {
    super();
  }

  then<T>(onFulfilled: (v: { data: Row[] | null; error: MockError | null }) => T): Promise<T> {
    const error = db.errors[this.tableName];
    if (error) return Promise.resolve(onFulfilled({ data: null, error }));
    const rows = table(this.tableName);
    const removed = this.matches(rows);
    try {
      // `affiliate_payouts_delete_guard()`: für `service_role` scheitert JEDES
      // DELETE — auch eines, das gar keine Zeile trifft, feuert den Trigger
      // nicht; deshalb nur bei tatsächlich getroffenen Zeilen.
      if (this.tableName === "affiliate_payouts" && removed.length > 0) payoutDeleteGuard();
    } catch (e) {
      return Promise.resolve(onFulfilled(asDbError(e)));
    }
    db.tables[this.tableName] = rows.filter((row) => !removed.includes(row));
    return Promise.resolve(onFulfilled({ data: removed, error: null }));
  }
}

class MockInsert {
  constructor(
    private tableName: string,
    private values: Row,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur muss zu admin.from().insert().select(cols) passen
  select(_columns: string): {
    maybeSingle: <T = Row>() => Promise<{ data: T | null; error: MockError | null }>;
  } {
    return {
      maybeSingle: <T = Row>() => {
        const error = db.errors[this.tableName];
        if (error) return Promise.resolve({ data: null, error });
        let row: Row = { id: nextId("pay"), ...this.values };
        try {
          if (this.tableName === "affiliate_payouts") {
            row = payoutInsertGuard({ ...PAYOUT_DEFAULTS, ...row });
            assertPayoutChecks(row);
            assertPayoutIndexes([...table(this.tableName), row]);
          }
        } catch (e) {
          return Promise.resolve(asDbError(e) as { data: T | null; error: MockError });
        }
        table(this.tableName).push(row);
        return Promise.resolve({ data: { ...row } as T, error: null });
      },
    };
  }
}

// --- Der Nachbau von `approve_affiliate_payout()` (Abschnitt 5) ---------

/**
 * Das Belegdatum in DEUTSCHER Zeitzone, nicht in UTC — wie in der RPC. Der
 * frühere Mock leitete das Belegjahr aus `period_to` ab; ein Beleg vom
 * 02.01.2027 für die Periode Dezember 2026 bekäme damit im Test eine Nummer aus
 * dem Kreis 2026, in der Datenbank aber (richtig) eine aus 2027.
 */
function berlinDate(now: Date): string {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : now.toISOString().slice(0, 10);
}

function approveRpc(args: Record<string, unknown>): { data: unknown; error: MockError | null } {
  try {
    // DIE DREI PFLICHTARGUMENTE (Abweichung A4). `p_tenant_id` und
    // `p_actor_user_id` sind in der Migration mit `default null` deklariert:
    // ein Aufruf ohne sie läuft durch und bricht INNEN ab — genau deshalb muss
    // der Mock hier abbrechen und nicht erst beim Lesen der Zeile.
    if ((args.p_payout_id ?? null) === null) throw guardError("affiliate_payout_id_missing");
    if ((args.p_tenant_id ?? null) === null) throw guardError("affiliate_payout_tenant_required");
    if ((args.p_actor_user_id ?? null) === null) {
      throw guardError("affiliate_payout_actor_required");
    }

    const issuedOn = berlinDate(db.now);
    const year = Number(issuedOn.slice(0, 4));

    const payouts = table("affiliate_payouts");
    const payout = payouts.find(
      (row) => row.id === args.p_payout_id && row.tenant_id === args.p_tenant_id,
    );
    if (payout === undefined) throw guardError("affiliate_payout_not_found");
    if (payout.status !== "draft") throw guardError("affiliate_payout_not_draft");
    if (String(payout.period_to) > issuedOn) {
      throw guardError("affiliate_payout_period_in_future");
    }

    const partner = table("affiliate_partners").find(
      (row) => row.id === payout.partner_id && row.tenant_id === payout.tenant_id,
    );
    if (partner === undefined) throw guardError("affiliate_payout_partner_tenant_mismatch");
    if ((partner.user_id ?? null) !== null && partner.user_id === args.p_actor_user_id) {
      throw guardError("affiliate_payout_self_dealing_forbidden");
    }
    if (partner.status !== "active" || partner.payout_hold === true) {
      throw guardError("affiliate_payout_partner_not_payable");
    }
    if (partner.program_id !== payout.program_id) {
      throw guardError("affiliate_payout_program_mismatch");
    }
    if ((payout.method ?? null) === null) throw guardError("affiliate_payout_method_missing");

    const tenant = table("tenants").find((row) => row.id === payout.tenant_id);
    if (tenant === undefined) throw guardError("affiliate_payout_tenant_not_found");
    const entity = (tenant.legal as { entity?: Row } | null)?.entity;
    if (
      entity === undefined ||
      typeof entity.name !== "string" ||
      entity.name === "" ||
      !Array.isArray(entity.addressLines) ||
      entity.addressLines.length === 0
    ) {
      throw guardError("affiliate_payout_tenant_legal_entity_missing");
    }

    let rowCount = 0;
    if ((payout.reverses_payout_id ?? null) !== null) {
      // Der Storno rechnet gegen den Ursprungsbeleg, nicht gegen das
      // Provisionsbuch (7.7).
      const origin = payouts.find(
        (row) => row.id === payout.reverses_payout_id && row.tenant_id === payout.tenant_id,
      );
      if (origin === undefined) throw guardError("affiliate_payout_reversal_origin_missing");
      if ((origin.document_no ?? null) === null) {
        throw guardError("affiliate_payout_reversal_origin_unissued");
      }
      if (origin.status !== "failed") {
        throw guardError("affiliate_payout_reversal_origin_not_failed");
      }
      if (
        origin.partner_id !== payout.partner_id ||
        origin.program_id !== payout.program_id ||
        origin.currency !== payout.currency ||
        origin.tax_mode !== payout.tax_mode ||
        num(origin.tax_rate_bp) !== num(payout.tax_rate_bp)
      ) {
        throw guardError("affiliate_payout_reversal_origin_mismatch");
      }
      for (const column of [
        "gross_cents",
        "reversal_cents",
        "subtotal_cents",
        "tax_cents",
        "total_cents",
      ]) {
        if (num(payout[column]) !== -num(origin[column])) {
          throw guardError("affiliate_payout_reversal_sums_mismatch");
        }
      }
    } else {
      const claimed = table("affiliate_commissions").filter(
        (row) => row.tenant_id === payout.tenant_id && row.payout_id === payout.id,
      );
      rowCount = claimed.length;
      if (rowCount === 0) throw guardError("affiliate_payout_no_rows");
      if (claimed.some((row) => row.status !== "approved")) {
        throw guardError("affiliate_payout_row_status_invalid");
      }
      if (claimed.some((row) => row.currency !== payout.currency)) {
        throw guardError("affiliate_payout_row_currency_mismatch");
      }
      if (claimed.some((row) => row.partner_id !== payout.partner_id)) {
        throw guardError("affiliate_payout_row_partner_mismatch");
      }
      if (claimed.some((row) => row.program_id !== payout.program_id)) {
        throw guardError("affiliate_payout_row_program_mismatch");
      }
      if (claimed.some((row) => row.is_test === true)) {
        throw guardError("affiliate_payout_row_is_test");
      }
      if (claimed.some((row) => row.flagged === true)) {
        throw guardError("affiliate_payout_row_flagged");
      }
      const gross = claimed.reduce((sum, row) => sum + Math.max(num(row.amount_cents), 0), 0);
      const reversal = claimed.reduce((sum, row) => sum + Math.min(num(row.amount_cents), 0), 0);
      if (gross !== num(payout.gross_cents)) throw guardError("affiliate_payout_gross_mismatch");
      if (reversal !== num(payout.reversal_cents)) {
        throw guardError("affiliate_payout_reversal_mismatch");
      }
      if (gross + reversal !== num(payout.subtotal_cents)) {
        throw guardError("affiliate_payout_subtotal_mismatch");
      }
    }

    // ERST JETZT die Nummer — nach allen Prüfungen (7.3).
    const key = `${String(payout.tenant_id)}|${year}`;
    const no = (db.counters[key] ?? 0) + 1;
    db.counters[key] = no;
    if (no > 999_999) throw guardError("affiliate_payout_document_no_exhausted");
    const documentNo = `GS-${String(tenant.slug ?? "").toUpperCase()}-${year}-${String(no).padStart(6, "0")}`;

    // Der Statuswechsel läuft über DENSELBEN Weg wie jedes andere UPDATE:
    // Guard, CHECKs, Indizes. Ein Nachbau, der die Zeile direkt beschriebe,
    // bewiese nichts über die Kante draft -> approved.
    const patched = payoutUpdateGuard(payout, {
      ...payout,
      status: "approved",
      document_no: documentNo,
    });
    assertPayoutChecks(patched);
    assertPayoutIndexes(payouts.map((row) => (row === payout ? patched : row)));
    Object.assign(payout, patched);

    if ((payout.reverses_payout_id ?? null) === null) {
      const program = table("affiliate_programs").find(
        (row) => row.id === payout.program_id && row.tenant_id === payout.tenant_id,
      );
      if (program !== undefined) {
        const current = str(program.books_closed_until);
        const next = String(payout.period_to);
        program.books_closed_until = current === null || next > current ? next : current;
      }
    }

    return {
      data: {
        payout_id: payout.id,
        document_no: documentNo,
        document_year: year,
        document_date: issuedOn,
        row_count: rowCount,
        reverses_payout_id: payout.reverses_payout_id ?? null,
      },
      error: null,
    };
  } catch (e) {
    return asDbError(e);
  }
}

const mockAdmin = {
  from(tableName: string) {
    return {
      select: (columns: string) => new MockSelect(tableName, columns),
      update: (patch: Row) => new MockUpdate(tableName, patch),
      insert: (values: Row) => new MockInsert(tableName, values),
      delete: () => new MockDelete(tableName),
    };
  },
  rpc(name: string, args: Record<string, unknown>) {
    if (name !== "approve_affiliate_payout") {
      return Promise.resolve({ data: null, error: { code: "42883", message: "unknown rpc" } });
    }
    return Promise.resolve(approveRpc(args));
  },
};

type Admin = Parameters<typeof planAffiliatePayoutRun>[0];
const admin = mockAdmin as unknown as Admin;

// --- Ausgangsbestand ----------------------------------------------------

const TENANT = "tenant-1";
const PROGRAM = "program-1";
const NOW = new Date("2026-10-01T06:00:00.000Z");
const PERIOD = { from: "2026-09-01", to: "2026-09-30" };

const LEGAL_ENTITY = {
  name: "Calltalent LLC",
  addressLines: ["1309 Coffeen Avenue STE 1200", "Sheridan, WY 82801", "United States"],
  email: "office@calltalent.ai",
  registrationNumber: "2026-002057636",
  /** Keine echte Nummer — Prüfziffernfreie Testkennung (CLAUDE.md §2.6). */
  vatId: "DE111111111",
};

/** Vollständiges Inlandsprofil mit gültiger Testnummer (keine echte Bankverbindung). */
function billingProfile(partnerId: string, patch: Row = {}): Row {
  return {
    partner_id: partnerId,
    tenant_id: TENANT,
    entity_kind: "business",
    legal_name: "Beispiel Partner GmbH",
    street: "Musterweg 1",
    postal_code: "10115",
    city: "Berlin",
    country: "DE",
    small_business: false,
    vat_id: null,
    tax_number: null,
    vat_check_result: null,
    vat_checked_at: null,
    payout_method: "sepa",
    account_holder: "Beispiel Partner GmbH",
    iban: "DE02120300000000202051",
    bic: "BYLADEM1001",
    paypal_email: null,
    ...patch,
  };
}

function partner(id: string, patch: Row = {}): Row {
  return {
    id,
    tenant_id: TENANT,
    program_id: PROGRAM,
    user_id: `user-${id}`,
    display_name: `Partner ${id}`,
    company: null,
    status: "active",
    payout_hold: false,
    ...patch,
  };
}

/** Eine auszahlungsreife Provisionszeile. */
function commission(patch: Row = {}): Row {
  return {
    id: nextId("com"),
    tenant_id: TENANT,
    program_id: PROGRAM,
    partner_id: "p1",
    kind: "sale",
    order_id: null,
    amount_cents: 10_000,
    currency: "eur",
    status: "approved",
    payout_id: null,
    reverses_id: null,
    hold_until: "2026-09-20",
    booked_at: "2026-09-15",
    is_test: false,
    flagged: false,
    ...patch,
  };
}

/** Eine fertige Auszahlungszeile für die Regeltests am Mock selbst. */
function payoutRow(patch: Row = {}): Row {
  return {
    tenant_id: TENANT,
    program_id: PROGRAM,
    partner_id: "p1",
    period_from: PERIOD.from,
    period_to: PERIOD.to,
    currency: "eur",
    gross_cents: 60_000,
    reversal_cents: 0,
    subtotal_cents: 60_000,
    tax_mode: "regular",
    tax_rate_bp: 1900,
    tax_cents: 11_400,
    total_cents: 71_400,
    status: "draft",
    method: "sepa",
    ...patch,
  };
}

beforeEach(() => {
  db.tables = {};
  db.errors = {};
  db.counters = {};
  db.nextId = 0;
  db.now = NOW;

  table("tenants").push({ id: TENANT, slug: "demo", legal: { entity: LEGAL_ENTITY } });
  table("affiliate_programs").push({
    id: PROGRAM,
    tenant_id: TENANT,
    min_payout_cents: 2500,
    payout_schedule: "monthly",
    currency: "eur",
    books_closed_until: null,
  });
  table("affiliate_payouts");
  table("affiliate_daily_stats");
  table("orders");
});

async function plan() {
  return planAffiliatePayoutRun(admin, { tenantId: TENANT, programId: PROGRAM, now: NOW });
}

async function runDrafts(
  candidates: Parameters<typeof createAffiliatePayoutDrafts>[1]["candidates"],
  patch: Partial<Parameters<typeof createAffiliatePayoutDrafts>[1]> = {},
) {
  return createAffiliatePayoutDrafts(admin, {
    tenantId: TENANT,
    candidates,
    minPayoutCents: 2500,
    periodFrom: PERIOD.from,
    periodTo: PERIOD.to,
    now: NOW,
    ...patch,
  });
}

// --- 0. Der Mock selbst -------------------------------------------------

/**
 * DIESE SECHS TESTS PRÜFEN DEN NACHBAU, NICHT DIE ANWENDUNG — und sie sind der
 * Grund, warum die Tests darunter etwas wert sind. Jeder von ihnen wäre vor der
 * Abnahme B8/B9 ROT gewesen, weil der Mock die jeweilige Regel gar nicht kannte
 * und damit alles durchließ, woran die Datenbank abbricht.
 */
describe("Der Mock ist so streng wie die Datenbank", () => {
  it("CHECK: der Entwurf darf 0 sein, der freigegebene Beleg nicht (Befund 1)", async () => {
    // Der Entwurf entsteht mit Nullbeträgen — sonst könnte der
    // Compare-and-Swap seine `id` nicht als Stempel benutzen. GENAU DAS hat
    // der alte `check (subtotal_cents > 0)` verhindert.
    const draft = await admin
      .from("affiliate_payouts")
      .insert(payoutRow({ gross_cents: 0, subtotal_cents: 0, tax_cents: 0, total_cents: 0 }))
      .select("id")
      .maybeSingle<{ id: string }>();
    expect(draft.error).toBeNull();

    // Ein BELEG über 0 bleibt ausgeschlossen: derselbe Satz, freigegeben.
    const approved = await admin
      .from("affiliate_payouts")
      .update({ status: "approved", document_no: "GS-DEMO-2026-000001" })
      .eq("id", draft.data?.id)
      .eq("tenant_id", TENANT)
      .select("id");
    expect(approved.error?.code).toBe("23514");

    // Und ein negativer Kopf ohne Storno-Verweis ebenfalls.
    const negative = await admin
      .from("affiliate_payouts")
      .insert(
        payoutRow({
          currency: "chf",
          gross_cents: -60_000,
          subtotal_cents: -60_000,
          tax_cents: -11_400,
          total_cents: -71_400,
        }),
      )
      .select("id")
      .maybeSingle();
    expect(negative.error?.code).toBe("23514");
  });

  it("CHECK: die Steuerformel gilt auf den Cent genau", async () => {
    const { error } = await admin
      .from("affiliate_payouts")
      // 19 % auf 60.000 sind 11.400, nicht 11.399.
      .insert(payoutRow({ tax_cents: 11_399, total_cents: 71_399 }))
      .select("id")
      .maybeSingle();

    expect(error?.code).toBe("23514");
  });

  it("CHECK: ein Entwurf trägt keine Belegnummer (Befund 8)", async () => {
    table("affiliate_payouts").push(payoutRow({ id: "pay_x" }));

    const { error } = await admin
      .from("affiliate_payouts")
      .update({
        document_no: "GS-DEMO-2026-000900",
        document_issued_at: "2026-10-01T00:00:00.000Z",
      })
      .eq("id", "pay_x")
      .eq("tenant_id", TENANT)
      .select("id");

    // Der Guard greift vor dem CHECK: eine Nummer entsteht ausschließlich im
    // Übergang draft -> approved.
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("affiliate_payout_document_no_immutable");
  });

  it("GUARD: die Übergangstabelle kennt keine Kante draft -> failed (Befund 9)", async () => {
    table("affiliate_payouts").push(payoutRow({ id: "pay_x" }));

    const { error } = await admin
      .from("affiliate_payouts")
      .update({ status: "failed" })
      .eq("id", "pay_x")
      .eq("tenant_id", TENANT)
      .select("id");

    expect(error).toEqual({
      code: "P0001",
      message: "affiliate_payout_status_transition_forbidden",
    });

    // draft -> cancelled dagegen ist der vorgesehene Ausstieg.
    const { error: cancelError } = await admin
      .from("affiliate_payouts")
      .update({ status: "cancelled" })
      .eq("id", "pay_x")
      .eq("tenant_id", TENANT)
      .select("id");
    expect(cancelError).toBeNull();
  });

  it("LÖSCH-GUARD: service_role löscht keinen Beleg, auch keinen Entwurf (Befund 3)", async () => {
    table("affiliate_payouts").push(payoutRow({ id: "pay_x" }));

    const { error } = await admin
      .from("affiliate_payouts")
      .delete()
      .eq("id", "pay_x")
      .eq("tenant_id", TENANT);

    expect(error).toEqual({ code: "P0001", message: "affiliate_payout_immutable" });
    expect(table("affiliate_payouts")).toHaveLength(1);
  });

  it("RPC: ein Aufruf ohne p_tenant_id oder p_actor_user_id scheitert (Befund 2)", async () => {
    table("affiliate_payouts").push(payoutRow({ id: "pay_x" }));

    const onlyId = await mockAdmin.rpc("approve_affiliate_payout", { p_payout_id: "pay_x" });
    expect(onlyId.error).toEqual({
      code: "P0001",
      message: "affiliate_payout_tenant_required",
    });

    const withoutActor = await mockAdmin.rpc("approve_affiliate_payout", {
      p_payout_id: "pay_x",
      p_tenant_id: TENANT,
    });
    expect(withoutActor.error).toEqual({
      code: "P0001",
      message: "affiliate_payout_actor_required",
    });
  });

  it("INDEX: höchstens ein offener Entwurf je Mandant, Partner und Währung", async () => {
    const first = await admin
      .from("affiliate_payouts")
      .insert(payoutRow())
      .select("id")
      .maybeSingle();
    expect(first.error).toBeNull();

    const second = await admin
      .from("affiliate_payouts")
      .insert(payoutRow())
      .select("id")
      .maybeSingle();
    expect(second.error?.code).toBe("23505");

    // Eine andere Währung ist ein anderer Vorgang und damit erlaubt.
    const otherCurrency = await admin
      .from("affiliate_payouts")
      .insert(payoutRow({ currency: "chf" }))
      .select("id")
      .maybeSingle();
    expect(otherCurrency.error).toBeNull();
  });

  it("INDEX: ein Beleg wird höchstens einmal storniert", async () => {
    table("affiliate_payouts").push(
      payoutRow({
        id: "pay_origin",
        status: "failed",
        approved_at: "2026-10-01T00:00:00.000Z",
        document_no: "GS-DEMO-2026-000001",
        document_issued_at: "2026-10-01T00:00:00.000Z",
      }),
    );
    const reversal = payoutRow({
      gross_cents: -60_000,
      reversal_cents: 0,
      subtotal_cents: -60_000,
      tax_cents: -11_400,
      total_cents: -71_400,
      reverses_payout_id: "pay_origin",
    });

    const first = await admin
      .from("affiliate_payouts")
      .insert(reversal)
      .select("id")
      .maybeSingle();
    expect(first.error).toBeNull();

    const second = await admin
      .from("affiliate_payouts")
      .insert(reversal)
      .select("id")
      .maybeSingle();
    expect(second.error?.code).toBe("23505");
  });

  it("RPC: das Belegjahr kommt aus dem Ausstellungsdatum, nicht aus period_to", async () => {
    // Beleg vom 02.01.2027 für die Periode Dezember 2026 — die Nummer gehört
    // in den Kreis 2027. Der alte Mock leitete das Jahr aus `period_to` ab und
    // hätte eine Nummer aus 2026 vergeben.
    db.now = new Date("2027-01-02T09:00:00.000Z");
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_payouts").push(
      payoutRow({ id: "pay_x", period_from: "2026-12-01", period_to: "2026-12-31" }),
    );
    table("affiliate_commissions").push(
      commission({ amount_cents: 60_000, payout_id: "pay_x" }),
    );

    const result = await mockAdmin.rpc("approve_affiliate_payout", {
      p_payout_id: "pay_x",
      p_tenant_id: TENANT,
      p_actor_user_id: "manager-2",
    });

    expect(result.error).toBeNull();
    expect((result.data as { document_no: string }).document_no).toBe("GS-DEMO-2027-000001");
  });
});

// --- 1. Mindestbetrag ---------------------------------------------------

describe("Mindestbetrag (7.1)", () => {
  it("erzeugt keinen Entwurf unter dem Mindestbetrag und meldet den Grund", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 2400 }));

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(0);
    expect(result.blocked).toEqual([
      {
        partner_id: "p1",
        currency: "eur",
        available_cents: 2400,
        reason: "below_minimum",
        field: null,
        messageKey: "affiliate.payoutRun.blocked.below_minimum",
      },
    ]);
  });

  it("zahlt genau auf dem Mindestbetrag aus — die Grenze ist inklusiv", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 2500 }));

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      partner_id: "p1",
      currency: "eur",
      available_cents: 2500,
      tax_mode: "regular",
      tax_rate_bp: 1900,
      // 2500 netto + 19 % = 475 -> 2975 brutto.
      preview_total_cents: 2975,
    });
  });

  it("lässt den Restbetrag stehen, statt ihn zu verfallen", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 2400 }));

    await plan();

    // Kein Stempel, kein Statuswechsel: die Zeile läuft in den nächsten Lauf.
    expect(table("affiliate_commissions")[0]).toMatchObject({
      status: "approved",
      payout_id: null,
    });
  });
});

// --- 2. Negativsaldo ----------------------------------------------------

describe("Negativsaldo (5.10)", () => {
  it("erzeugt keinen Satz und keine Schuldenmechanik, meldet den Fall aber", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    const sale = commission({ amount_cents: 10_000 });
    table("affiliate_commissions").push(
      sale,
      commission({ kind: "reversal", amount_cents: -10_500, reverses_id: sale.id }),
    );

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(0);
    expect(result.blocked[0]).toMatchObject({
      reason: "negative_balance",
      available_cents: -500,
    });
    // Beide Zeilen bleiben unangetastet und verrechnen sich mit der nächsten
    // Provision — der Saldo wird vorgetragen.
    expect(table("affiliate_commissions").every((row) => row.payout_id === null)).toBe(true);
  });

  it("meldet einen Saldo von genau 0 gar nicht — das wäre nur Lärm", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    const sale = commission({ amount_cents: 10_000 });
    table("affiliate_commissions").push(
      sale,
      commission({ kind: "reversal", amount_cents: -10_000, reverses_id: sale.id }),
    );

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
  });
});

// --- 3. Blockiertes Profil ----------------------------------------------

describe("Blockiertes Profil (7.1, 7.4)", () => {
  beforeEach(() => {
    table("affiliate_commissions").push(commission({ amount_cents: 50_000 }));
  });

  it("blockiert eine Privatperson mit eigenem Grund, nicht als Warnung", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1", { entity_kind: "private" }));

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(0);
    expect(result.blocked[0]).toMatchObject({
      reason: "tax_private_entity",
      field: "entity_kind",
      messageKey: "affiliate.payoutRun.blocked.tax_private_entity",
    });
  });

  it("blockiert einen EU-Partner ohne geprüfte USt-IdNr. und verlinkt auf das Feld", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1", { country: "AT", vat_id: null }));

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocked[0]).toMatchObject({ reason: "tax_eu_vat_missing", field: "vat_id" });
  });

  /**
   * Befund 6 der Abnahme: die geprüfte Nummer stammt aus einem anderen Land als
   * die Anschrift. Beide Richtungen führten still zum falschen Steuerausweis
   * (§ 14c UStG) — vorher war dieser Test rot, weil `resolveAffiliateTaxMode()`
   * das Länderpräfix nirgends gegen `profile.country` gehalten hat.
   */
  it("blockiert eine USt-IdNr. aus einem anderen Land als der Anschrift (Befund 6)", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(
      billingProfile("p1", {
        country: "IT",
        vat_id: "DE111111111",
        vat_check_result: "valid",
        vat_checked_at: "2026-09-25T00:00:00.000Z",
      }),
    );

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(0);
    expect(result.blocked[0]).toMatchObject({
      reason: "tax_vat_country_mismatch",
      field: "vat_id",
    });
  });

  it("gibt Reverse Charge frei, wenn Nummer und Land zusammenpassen", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(
      billingProfile("p1", {
        country: "AT",
        vat_id: "ATU11111111",
        vat_check_result: "valid",
        vat_checked_at: "2026-09-25T00:00:00.000Z",
      }),
    );

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]).toMatchObject({ tax_mode: "reverse_charge", tax_rate_bp: 0 });
  });

  /**
   * Befund 5: ohne USt-IdNr. des Mandanten kann der Beleg die Pflichtangabe
   * nach § 14a Abs. 5 UStG nicht tragen. Vorher entstand er trotzdem — mit
   * einem Gedankenstrich an dieser Stelle.
   */
  it("blockiert Reverse Charge, solange die Akademie keine eigene USt-IdNr. hat (Befund 5)", async () => {
    db.tables.tenants = [
      {
        id: TENANT,
        slug: "demo",
        legal: { entity: { ...LEGAL_ENTITY, vatId: undefined } },
      },
    ];
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(
      billingProfile("p1", {
        country: "AT",
        vat_id: "ATU11111111",
        vat_check_result: "valid",
        vat_checked_at: "2026-09-25T00:00:00.000Z",
      }),
    );

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(0);
    expect(result.blocked[0]).toMatchObject({
      reason: "issuer_vat_id_missing",
      field: null,
    });
  });

  it("lässt einen Inlandspartner davon unberührt — er braucht keinen Reverse Charge", async () => {
    db.tables.tenants = [
      { id: TENANT, slug: "demo", legal: { entity: { ...LEGAL_ENTITY, vatId: undefined } } },
    ];
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));

    const result = await plan();

    expect(result.ok && result.candidates[0]).toMatchObject({ tax_mode: "regular" });
  });

  it("nennt bei unvollständiger Anschrift GENAU das erste fehlende Feld", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1", { postal_code: "  " }));

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocked[0]).toMatchObject({
      reason: "address_incomplete",
      field: "postal_code",
    });
  });

  it("blockiert ein gesperrtes Konto und einen nicht aktiven Partner", async () => {
    table("affiliate_partners").push(partner("p1", { payout_hold: true }));
    table("affiliate_billing_profiles").push(billingProfile("p1"));

    const held = await plan();
    expect(held.ok && held.blocked[0].reason).toBe("payout_hold");

    db.tables.affiliate_partners = [partner("p1", { status: "suspended" })];
    const suspended = await plan();
    expect(suspended.ok && suspended.blocked[0].reason).toBe("partner_inactive");
  });

  it("blockiert eine unbrauchbare IBAN, bevor eine Bankdatei daraus entsteht", async () => {
    table("affiliate_partners").push(partner("p1"));
    // Ein Zahlendreher in der Prüfziffer.
    table("affiliate_billing_profiles").push(
      billingProfile("p1", { iban: "DE03120300000000202051" }),
    );

    const result = await plan();

    expect(result.ok && result.blocked[0]).toMatchObject({ reason: "iban_invalid", field: "iban" });
  });

  it("blockiert ein fehlendes Abrechnungsprofil ganz", async () => {
    table("affiliate_partners").push(partner("p1"));

    const result = await plan();

    expect(result.ok && result.blocked[0].reason).toBe("billing_profile_missing");
  });

  it("sperrt den GESAMTEN Lauf, wenn der Mandant keinen Rechtsträger hinterlegt hat", async () => {
    db.tables.tenants = [{ id: TENANT, slug: "demo", legal: {} }];
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));

    expect(await plan()).toEqual({ ok: false, reason: "tenant_legal_entity_missing" });
  });

  it("liefert keinen Saldo, wenn die Zeilen nicht vollständig geladen werden konnten", async () => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    db.errors.affiliate_commissions = { code: "57014", message: "canceling statement" };

    expect(await plan()).toEqual({ ok: false, reason: "balances_incomplete" });
  });
});

// --- 4. Währung und Programm --------------------------------------------

describe("Währung des Programms (5.11, Befund 12)", () => {
  beforeEach(() => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(
      commission({ amount_cents: 120_000, currency: "eur" }),
      commission({ amount_cents: 80_000, currency: "chf" }),
    );
  });

  /**
   * `min_payout_cents` ist ein Betrag in der Währung des PROGRAMMS. Vorher
   * wurde jeder Saldo — gleich welcher Währung — gegen diese Schwelle
   * gehalten: 2.600 Rappen galten als über 25,00 €.
   */
  it("prüft fremde Währungen nicht gegen die Schwelle des Programms, sondern meldet sie", async () => {
    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ currency: "eur", available_cents: 120_000 });
    expect(result.blocked).toEqual([
      {
        partner_id: "p1",
        currency: "chf",
        available_cents: 80_000,
        reason: "foreign_currency",
        field: null,
        messageKey: "affiliate.payoutRun.blocked.foreign_currency",
      },
    ]);
  });

  it("sammelt in den Entwurf keine Zeile der anderen Währung ein", async () => {
    const result = await plan();
    if (!result.ok) return;

    const outcomes = await runDrafts(result.candidates);

    expect(outcomes.filter((outcome) => outcome.status === "created")).toHaveLength(1);
    const payouts = table("affiliate_payouts");
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({
      currency: "eur",
      gross_cents: 120_000,
      subtotal_cents: 120_000,
      total_cents: 142_800,
    });

    // Die CHF-Zeile bleibt ungestempelt und wartet auf einen CHF-Lauf.
    const chf = table("affiliate_commissions").find((row) => row.currency === "chf");
    expect(chf?.payout_id ?? null).toBeNull();
  });

  it("nimmt keinen Partner eines anderen Programms mit (Befund 11)", async () => {
    table("affiliate_partners").push(partner("p2", { program_id: "program-2" }));
    table("affiliate_billing_profiles").push(billingProfile("p2"));
    table("affiliate_commissions").push(
      commission({ partner_id: "p2", program_id: "program-2", amount_cents: 90_000 }),
    );

    const result = await plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates.map((candidate) => candidate.partner_id)).toEqual(["p1"]);
    expect(result.blocked.map((entry) => entry.partner_id)).not.toContain("p2");
  });
});

// --- 5. Der Entwurfslauf ------------------------------------------------

describe("Entwurfslauf: Reservierung, Aufräumen, Zeitraum (7.1)", () => {
  beforeEach(() => {
    table("affiliate_partners").push(partner("p1"));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 60_000 }));
  });

  it("legt einen Entwurf an — der INSERT mit Nullbeträgen geht durch (Befund 1)", async () => {
    const result = await plan();
    if (!result.ok) return;

    const outcomes = await runDrafts(result.candidates);

    expect(outcomes[0]).toMatchObject({ status: "created", subtotal_cents: 60_000 });
    expect(table("affiliate_payouts")[0]).toMatchObject({
      status: "draft",
      subtotal_cents: 60_000,
      total_cents: 71_400,
      document_no: null,
    });
  });

  /**
   * Zwei Läufe für denselben Partner und dieselbe Währung: der zweite bricht am
   * Teil-Unique-Index ab (23505) — genau so, wie die Migration es ankündigt
   * („brechen damit mit 23505 ab"). Der Mock kannte diesen Index vorher nicht
   * und ließ beide durch.
   */
  it("lässt keinen zweiten offenen Entwurf für denselben Partner entstehen", async () => {
    const first = await plan();
    const second = await plan();
    if (!first.ok || !second.ok) return;

    const [a, b] = await Promise.all([runDrafts(first.candidates), runDrafts(second.candidates)]);

    const statuses = [...a, ...b].map((outcome) => outcome.status).sort();
    expect(statuses).toEqual(["created", "failed"]);
    expect([...a, ...b].find((outcome) => outcome.status === "failed")).toMatchObject({
      reason: "insert_failed",
    });
    expect(table("affiliate_payouts")).toHaveLength(1);
    expect(table("affiliate_payouts")[0]).toMatchObject({
      subtotal_cents: 60_000,
      status: "draft",
    });
  });

  /**
   * Befund 3: der leer gebliebene Entwurf wird VERWORFEN, nicht gelöscht — und
   * er darf den nächsten Lauf nicht blockieren. Vorher scheiterte das `delete()`
   * am Lösch-Guard, die Zeile blieb als 'draft' stehen, und jeder weitere
   * Entwurf dieses Partners brach danach mit 23505 ab.
   */
  it("verwirft einen leer gebliebenen Entwurf und gibt den Partner wieder frei", async () => {
    const result = await plan();
    if (!result.ok) return;

    // Die Zeilen sind inzwischen von einem anderen Satz eingesammelt worden.
    const foreign = table("affiliate_commissions")[0];
    foreign.payout_id = "pay_fremd";

    const outcomes = await runDrafts(result.candidates);

    expect(outcomes[0]).toMatchObject({ status: "skipped", reason: "no_rows" });
    const payouts = table("affiliate_payouts");
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ status: "cancelled", document_no: null });

    // Und der nächste Lauf kommt wieder durch: 'cancelled' zählt nicht mehr
    // als offener Entwurf.
    foreign.payout_id = null;
    const again = await plan();
    if (!again.ok) return;
    const second = await runDrafts(again.candidates);
    expect(second[0]).toMatchObject({ status: "created" });
  });

  it("sammelt weder Testbestellungen noch Zeilen mit laufender Sperrfrist ein", async () => {
    table("affiliate_commissions").push(
      commission({ amount_cents: 9_000, is_test: true }),
      commission({ amount_cents: 7_000, hold_until: "2026-10-20" }),
      commission({ amount_cents: 5_000, status: "pending" }),
    );

    const result = await plan();
    if (!result.ok) return;

    await runDrafts(result.candidates);

    // Nur die 60 000 aus dem Ausgangsbestand; die Belegsumme stammt aus den
    // TATSÄCHLICH reservierten Zeilen, nicht aus der Vorschau.
    expect(table("affiliate_payouts")[0]).toMatchObject({ subtotal_cents: 60_000 });
    const stamped = table("affiliate_commissions").filter((row) => row.payout_id !== null);
    expect(stamped).toHaveLength(1);
    expect(stamped[0].amount_cents).toBe(60_000);
  });

  /**
   * Befund 13: `hold_until` ist ein ZEITPUNKT. Mit `lte(hold_until, periodTo)`
   * fiel eine Zeile, deren Sperrfrist am letzten Tag des Zeitraums um 14:00 Uhr
   * endete, aus dem Lauf heraus — für den Partner ein unerklärlicher Monat
   * Verzögerung.
   */
  it("nimmt eine Zeile mit, deren Sperrfrist am letzten Tag des Zeitraums endet", async () => {
    db.tables.affiliate_commissions = [
      commission({ amount_cents: 60_000, hold_until: "2026-09-30T14:00:00.000Z" }),
    ];

    const result = await plan();
    if (!result.ok) return;
    await runDrafts(result.candidates);

    expect(table("affiliate_payouts")[0]).toMatchObject({ subtotal_cents: 60_000 });
  });

  /**
   * Befund 13, zweiter Teil: der Leistungszeitraum auf dem Beleg muss zu seinem
   * INHALT passen (§ 14 Abs. 4 Nr. 6 UStG). Eine liegengebliebene Zeile aus dem
   * Juli macht aus „01.09. bis 30.09." eine falsche Angabe.
   */
  it("zieht period_from auf den frühesten tatsächlich eingesammelten Buchungstag", async () => {
    table("affiliate_commissions").push(
      commission({ amount_cents: 3_000, booked_at: "2026-07-04", hold_until: "2026-07-20" }),
    );

    const result = await plan();
    if (!result.ok) return;
    await runDrafts(result.candidates);

    expect(table("affiliate_payouts")[0]).toMatchObject({
      period_from: "2026-07-04",
      period_to: "2026-09-30",
      subtotal_cents: 63_000,
    });
  });

  it("löst die Stempel wieder, wenn nach dem Einsammeln zu wenig zusammenkommt", async () => {
    // Die Vorschau sieht 60 000; bis zur Reservierung ist eine Gegenbuchung
    // dazwischengekommen, die den Satz unter den Mindestbetrag drückt.
    const result = await plan();
    if (!result.ok) return;

    const sale = table("affiliate_commissions")[0];
    table("affiliate_commissions").push(
      commission({ kind: "reversal", amount_cents: -59_000, reverses_id: sale.id }),
    );

    const outcomes = await runDrafts(result.candidates);

    expect(outcomes[0]).toMatchObject({ status: "skipped", reason: "below_minimum_after_claim" });
    // Der Entwurf ist verworfen, nicht gelöscht: ein Beleg verschwindet nie.
    expect(table("affiliate_payouts")).toHaveLength(1);
    expect(table("affiliate_payouts")[0]).toMatchObject({ status: "cancelled" });
    expect(table("affiliate_commissions").every((row) => row.payout_id === null)).toBe(true);
  });

  /**
   * Befund 7: ein Zeitraum, der in der Zukunft endet, schließt beim Freigeben
   * `books_closed_until` des Programms auf diesen Wert — und `greatest()` nimmt
   * das nie wieder zurück.
   */
  it("weist einen Zeitraum in der Zukunft ab, bevor ein Entwurf entsteht", async () => {
    const result = await plan();
    if (!result.ok) return;

    await expect(
      runDrafts(result.candidates, { periodFrom: "2026-09-01", periodTo: "2099-12-31" }),
    ).rejects.toThrow(/future/);
    expect(table("affiliate_payouts")).toHaveLength(0);
  });

  it("weist einen Zeitraum ab, der mehr als 24 Monate zurückreicht", async () => {
    const result = await plan();
    if (!result.ok) return;

    await expect(
      runDrafts(result.candidates, { periodFrom: "2020-01-01", periodTo: "2026-09-30" }),
    ).rejects.toThrow(/too_old/);
  });
});

// --- 6. G15 und der weitere Lebenslauf ----------------------------------

describe("Freigabe, G15 und Bankabgleich (7.2, 7.7)", () => {
  async function createDraft(): Promise<string> {
    const result = await plan();
    if (!result.ok) throw new Error("Plan fehlgeschlagen");
    const outcomes = await runDrafts(result.candidates);
    const created = outcomes.find((outcome) => outcome.status === "created");
    if (created === undefined || created.status !== "created") throw new Error("Kein Entwurf");
    return created.payout_id;
  }

  beforeEach(() => {
    table("affiliate_partners").push(partner("p1", { user_id: "manager-1" }));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 60_000 }));
  });

  it("G15: der Manager gibt eine Auszahlung an sich selbst NICHT frei", async () => {
    const payoutId = await createDraft();

    const result = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId,
      actorUserId: "manager-1",
    });

    expect(result).toEqual({ ok: false, reason: "self_approval" });
    // Kein Statuswechsel, keine Belegnummer — der Vorgang bleibt offen für
    // eine andere Person.
    expect(table("affiliate_payouts")[0]).toMatchObject({ status: "draft" });
    expect(table("affiliate_payouts")[0].document_no).toBeNull();
  });

  it("G15 greift nicht bei einer fremden Partnerzeile", async () => {
    const payoutId = await createDraft();

    const result = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId,
      actorUserId: "manager-2",
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.document_no).toBe("GS-DEMO-2026-000001");
    expect(table("affiliate_payouts")[0]).toMatchObject({ status: "approved" });
  });

  /**
   * Befund 2: die RPC verlangt alle drei Argumente. Vorher ging nur
   * `p_payout_id` hinaus, und jede Freigabe brach mit
   * `affiliate_payout_tenant_required` ab — der Mock sah es nicht, weil er
   * ausschließlich `args.p_payout_id` las.
   */
  it("reicht Mandant und handelnden Menschen an die RPC durch", async () => {
    const payoutId = await createDraft();
    const seen: Record<string, unknown>[] = [];
    const original = mockAdmin.rpc.bind(mockAdmin);
    const spy = {
      ...mockAdmin,
      rpc(name: string, args: Record<string, unknown>) {
        seen.push(args);
        return original(name, args);
      },
    } as unknown as Admin;

    const result = await approveAffiliatePayout(spy, {
      tenantId: TENANT,
      payoutId,
      actorUserId: "manager-2",
    });

    expect(result.ok).toBe(true);
    expect(seen[0]).toEqual({
      p_payout_id: payoutId,
      p_tenant_id: TENANT,
      p_actor_user_id: "manager-2",
    });
  });

  it("gibt ohne handelnden Menschen gar nicht erst frei", async () => {
    const payoutId = await createDraft();

    const result = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId,
      actorUserId: "  ",
    });

    expect(result).toEqual({ ok: false, reason: "actor_missing" });
    expect(table("affiliate_payouts")[0]).toMatchObject({ status: "draft" });
  });

  it("vergibt lückenlos fortlaufende Belegnummern", async () => {
    const firstId = await createDraft();
    table("affiliate_commissions").push(commission({ partner_id: "p2", amount_cents: 30_000 }));
    table("affiliate_partners").push(partner("p2", { user_id: "user-p2" }));
    table("affiliate_billing_profiles").push(billingProfile("p2"));
    const secondPlan = await plan();
    if (!secondPlan.ok) return;
    const outcomes = await runDrafts(secondPlan.candidates);
    const secondId = outcomes.find((outcome) => outcome.status === "created");
    if (secondId === undefined || secondId.status !== "created") throw new Error("Kein Entwurf");

    const a = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId: firstId,
      actorUserId: "manager-2",
    });
    const b = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId: secondId.payout_id,
      actorUserId: "manager-2",
    });

    expect(a.ok && a.document_no).toBe("GS-DEMO-2026-000001");
    expect(b.ok && b.document_no).toBe("GS-DEMO-2026-000002");
  });

  it("schließt mit der Freigabe die Bücher des Programms bis period_to (G14)", async () => {
    const payoutId = await createDraft();
    await approveAffiliatePayout(admin, { tenantId: TENANT, payoutId, actorUserId: "manager-2" });

    expect(table("affiliate_programs")[0].books_closed_until).toBe("2026-09-30");
  });

  it("gibt einen bereits freigegebenen Satz kein zweites Mal frei", async () => {
    const payoutId = await createDraft();
    await approveAffiliatePayout(admin, { tenantId: TENANT, payoutId, actorUserId: "manager-2" });

    const second = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId,
      actorUserId: "manager-2",
    });

    expect(second).toEqual({ ok: false, reason: "not_draft" });
  });

  it("findet einen Satz eines fremden Mandanten nicht (§2.15)", async () => {
    const payoutId = await createDraft();

    const result = await approveAffiliatePayout(admin, {
      tenantId: "tenant-fremd",
      payoutId,
      actorUserId: "manager-2",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("verweigert die Freigabe, wenn die Positionssumme vom Belegkopf abweicht (7.6)", async () => {
    const payoutId = await createDraft();
    // Eine Zeile wird nachträglich entstempelt — genau der Fall, für den es
    // Gleichung 1 gibt.
    table("affiliate_commissions")[0].payout_id = null;

    const result = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId,
      actorUserId: "manager-2",
    });

    expect(result).toEqual({ ok: false, reason: "integrity_mismatch" });
    expect(table("affiliate_payouts")[0]).toMatchObject({ status: "draft" });
  });

  it("setzt nach dem Bankabgleich Satz und Zeilen auf bezahlt", async () => {
    const payoutId = await createDraft();
    await approveAffiliatePayout(admin, { tenantId: TENANT, payoutId, actorUserId: "manager-2" });

    const result = await markAffiliatePayoutPaid(admin, {
      tenantId: TENANT,
      payoutId,
      reference: "SEPA-2026-10-01/17",
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, affected_rows: 1 });
    expect(table("affiliate_payouts")[0]).toMatchObject({
      status: "paid",
      reference: "SEPA-2026-10-01/17",
    });
    expect(table("affiliate_commissions")[0]).toMatchObject({ status: "paid" });
  });

  it("weist eine Referenz mit unzulässigen Zeichen ab", async () => {
    const payoutId = await createDraft();
    await approveAffiliatePayout(admin, { tenantId: TENANT, payoutId, actorUserId: "manager-2" });

    await expect(
      markAffiliatePayoutPaid(admin, {
        tenantId: TENANT,
        payoutId,
        reference: "<script>alert(1)</script>",
      }),
    ).rejects.toThrow();
  });
});

// --- 7. Fehlschlag, Bestätigung und Stornogutschrift --------------------

describe("Fehlgeschlagene Überweisung (7.7, Befund 4 und 16)", () => {
  async function approvedPayout(): Promise<string> {
    const result = await plan();
    if (!result.ok) throw new Error("Plan fehlgeschlagen");
    const outcomes = await runDrafts(result.candidates);
    const created = outcomes.find((outcome) => outcome.status === "created");
    if (created === undefined || created.status !== "created") throw new Error("Kein Entwurf");
    await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId: created.payout_id,
      actorUserId: "manager-2",
    });
    return created.payout_id;
  }

  beforeEach(() => {
    table("affiliate_partners").push(partner("p1", { user_id: "manager-1" }));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 60_000 }));
  });

  /**
   * Befund 16: `failed` ist ein Endzustand ohne Rückweg. Ohne Bestätigung
   * genügt ein Fehlklick, um eine angekommene Überweisung ein zweites Mal
   * auszulösen.
   */
  it("verlangt die abgetippte Belegnummer, bevor etwas geschieht", async () => {
    const payoutId = await approvedPayout();

    const wrong = await markAffiliatePayoutFailed(admin, {
      tenantId: TENANT,
      payoutId,
      confirmDocumentNo: "GS-DEMO-2026-000002",
    });

    expect(wrong).toEqual({ ok: false, reason: "confirmation_mismatch" });
    expect(table("affiliate_payouts")[0]).toMatchObject({ status: "approved" });
    expect(table("affiliate_commissions")[0].payout_id).toBe(payoutId);
  });

  it("gibt die Zeilen frei, behält den Beleg und legt den Storno-Entwurf an", async () => {
    const payoutId = await approvedPayout();

    const result = await markAffiliatePayoutFailed(admin, {
      tenantId: TENANT,
      payoutId,
      // Kleinschreibung und Leerzeichen sind Schreibweise, nicht Inhalt.
      confirmDocumentNo: " gs-demo-2026-000001 ",
    });

    expect(result).toMatchObject({ ok: true, affected_rows: 1 });
    if (!result.ok) return;
    expect(result.reversal_payout_id).not.toBeNull();

    const origin = table("affiliate_payouts").find((row) => row.id === payoutId);
    expect(origin).toMatchObject({ status: "failed", document_no: "GS-DEMO-2026-000001" });

    // Die Zeile ist wieder frei und läuft in den nächsten Entwurf — Status
    // bleibt `approved`, sie war nie bezahlt.
    expect(table("affiliate_commissions")[0]).toMatchObject({
      status: "approved",
      payout_id: null,
    });

    // Und der Storno spiegelt den Beleg exakt (Befund 4).
    const reversal = table("affiliate_payouts").find(
      (row) => row.id === result.reversal_payout_id,
    );
    expect(reversal).toMatchObject({
      status: "draft",
      reverses_payout_id: payoutId,
      gross_cents: -60_000,
      subtotal_cents: -60_000,
      tax_cents: -11_400,
      total_cents: -71_400,
      document_no: null,
    });
  });

  it("gibt dem Storno eine eigene Nummer aus demselben Kreis", async () => {
    const payoutId = await approvedPayout();
    const failure = await markAffiliatePayoutFailed(admin, {
      tenantId: TENANT,
      payoutId,
      confirmDocumentNo: "GS-DEMO-2026-000001",
    });
    if (!failure.ok || failure.reversal_payout_id === null) throw new Error("Kein Storno");

    const approval = await approveAffiliatePayout(admin, {
      tenantId: TENANT,
      payoutId: failure.reversal_payout_id,
      actorUserId: "manager-2",
    });

    expect(approval.ok && approval.document_no).toBe("GS-DEMO-2026-000002");
    const reversal = table("affiliate_payouts").find(
      (row) => row.id === failure.reversal_payout_id,
    );
    expect(reversal).toMatchObject({ status: "approved", subtotal_cents: -60_000 });
  });

  it("blockiert einen Satz, der schon bezahlt ist", async () => {
    const payoutId = await approvedPayout();
    await markAffiliatePayoutPaid(admin, {
      tenantId: TENANT,
      payoutId,
      reference: "SEPA-2026-10-01/17",
      now: NOW,
    });

    const result = await markAffiliatePayoutFailed(admin, {
      tenantId: TENANT,
      payoutId,
      confirmDocumentNo: "GS-DEMO-2026-000001",
    });

    expect(result).toEqual({ ok: false, reason: "wrong_status" });
  });
});

// --- 8. Kontrollabgleich am Auszahlungssatz -----------------------------

describe("Kontrollabgleich und Stilllegung (7.6, Befund 9)", () => {
  beforeEach(() => {
    table("affiliate_partners").push(partner("p1", { user_id: "manager-1" }));
    table("affiliate_billing_profiles").push(billingProfile("p1"));
    table("affiliate_commissions").push(commission({ amount_cents: 60_000 }));
  });

  /**
   * Ein Entwurf kennt keine Kante nach 'failed' — der Stilllegungs-UPDATE
   * scheiterte deshalb IMMER, still, und der defekte Entwurf blockierte über
   * den Teil-Unique-Index zugleich jeden neuen Entwurf dieses Partners.
   */
  it("verwirft einen abweichenden Entwurf, statt ihn auf failed setzen zu wollen", async () => {
    const result = await plan();
    if (!result.ok) return;
    await runDrafts(result.candidates);
    // Eine Zeile wird entstempelt: der Kopf sagt 60.000, die Positionen 0.
    table("affiliate_commissions")[0].payout_id = null;

    const report = await verifyAffiliateIntegrity(admin, TENANT, {
      now: NOW,
      quarantine: true,
    });

    const finding = report.findings.find((entry) => entry.check === "payout_subtotal");
    expect(finding).toBeDefined();
    expect(finding?.quarantined).toBe(true);
    expect(table("affiliate_payouts")[0]).toMatchObject({ status: "cancelled" });
  });

  it("meldet den Nullstand eines gerade laufenden Entwurfs nicht als Befund", async () => {
    // Genau der Zwischenstand zwischen INSERT und Finalisierung.
    table("affiliate_payouts").push(
      payoutRow({
        id: "pay_open",
        gross_cents: 0,
        subtotal_cents: 0,
        tax_cents: 0,
        total_cents: 0,
      }),
    );

    const report = await verifyAffiliateIntegrity(admin, TENANT, { now: NOW, quarantine: true });

    expect(report.findings.filter((entry) => entry.check === "payout_subtotal")).toHaveLength(0);
    expect(table("affiliate_payouts")[0]).toMatchObject({ status: "draft" });
  });

  it("vergleicht eine Stornogutschrift gegen ihren Ursprungsbeleg, nicht gegen das Buch", async () => {
    table("affiliate_payouts").push(
      payoutRow({
        id: "pay_origin",
        status: "failed",
        approved_at: "2026-10-01T00:00:00.000Z",
        document_no: "GS-DEMO-2026-000001",
        document_issued_at: "2026-10-01T00:00:00.000Z",
      }),
      payoutRow({
        id: "pay_reversal",
        gross_cents: -60_000,
        subtotal_cents: -60_000,
        tax_cents: -11_400,
        total_cents: -71_400,
        reverses_payout_id: "pay_origin",
      }),
    );

    const report = await verifyAffiliateIntegrity(admin, TENANT, { now: NOW });

    // Der Storno hat keine Positionen; er spiegelt exakt und ist damit in
    // Ordnung. Ein Vergleich gegen das Provisionsbuch hätte ihn als kritischen
    // Dauerbefund gemeldet.
    expect(report.findings.filter((entry) => entry.check === "payout_subtotal")).toHaveLength(0);
  });
});

// --- Fälligkeit ---------------------------------------------------------

describe("resolveAffiliatePayoutPeriod (7.1)", () => {
  it("weekly: montags, Zeitraum Montag bis Sonntag davor", () => {
    // 2026-10-05 ist ein Montag.
    expect(resolveAffiliatePayoutPeriod("weekly", new Date("2026-10-05T03:00:00Z"))).toEqual({
      due: true,
      from: "2026-09-28",
      to: "2026-10-04",
    });
    expect(resolveAffiliatePayoutPeriod("weekly", new Date("2026-10-06T03:00:00Z")).due).toBe(false);
  });

  it("semi_monthly: am 16. die erste Monatshälfte, am 1. die zweite des Vormonats", () => {
    expect(resolveAffiliatePayoutPeriod("semi_monthly", new Date("2026-10-16T03:00:00Z"))).toEqual({
      due: true,
      from: "2026-10-01",
      to: "2026-10-15",
    });
    expect(resolveAffiliatePayoutPeriod("semi_monthly", new Date("2026-10-01T03:00:00Z"))).toEqual({
      due: true,
      from: "2026-09-16",
      to: "2026-09-30",
    });
    expect(resolveAffiliatePayoutPeriod("semi_monthly", new Date("2026-10-07T03:00:00Z")).due).toBe(
      false,
    );
  });

  it("monthly: am 1. der volle Vormonat, auch über einen Jahreswechsel", () => {
    expect(resolveAffiliatePayoutPeriod("monthly", new Date("2027-01-01T03:00:00Z"))).toEqual({
      due: true,
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("trifft den Februar eines Schaltjahrs", () => {
    expect(resolveAffiliatePayoutPeriod("monthly", new Date("2028-03-01T03:00:00Z"))).toEqual({
      due: true,
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });
});
