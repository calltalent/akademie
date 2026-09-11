import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeBalances,
  computeBaseCents,
  computeCommissionParts,
  resolveCondition,
  type AffiliateConditionCandidate,
  type AffiliateRateResolution,
} from "@/lib/affiliate/compute";
import type {
  AffiliateBalanceInput,
  AffiliateBalances,
  AffiliateCancelReason,
  AffiliateCommissionKind,
  AffiliateCommissionStatus,
  AffiliateConditionRow,
  AffiliateConditionSnapshot,
  AffiliateGroupRow,
  AffiliatePartnerRow,
  AffiliateProgramRow,
} from "@/lib/affiliate/types";
import { AFFILIATE_PARTNER_STATUSES } from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B6-A — alle Leseabfragen der Mandanten-Oberfläche
 * (PLAN_Affiliate-System.md 8.1, 5.2, 5.10, 11.10, 11.12, 11.15).
 *
 * WARUM DURCHGEHEND `createAdminClient()` UND NICHT DER SESSION-CLIENT.
 * Das SELECT-Recht auf `affiliate_partners`, `affiliate_conditions`,
 * `affiliate_commissions` und `affiliate_billing_profiles` ist ein
 * SPALTEN-Grant (Migrationen 20260910120000 und 20260911130000), und
 * Spaltenrechte sind NICHT rollenabhängig: die Liste ist die Schnittmenge aus
 * dem, was Partner UND Manager über PostgREST sehen dürfen. Genau die
 * Spalten, aus denen die sieben Admin-Seiten bestehen — `applicant_email`,
 * `internal_note`, `status_reason`, `payout_hold_reason`, `application`,
 * `order_id`, `note`, `flag_reason`, `condition_snapshot`, `dedup_key` —
 * fehlen dort. Die Migration schreibt den Weg selbst vor: „Der Manager
 * bekommt die fehlenden Spalten über eine Server-Route mit
 * `requireAdminTenant()` und `createAdminClient()`."
 *
 * Damit gilt für JEDE Funktion dieser Datei ohne Ausnahme (CLAUDE.md
 * §2.10/§2.15, Plan 11.10):
 *   1. Der Aufrufer hat VORHER `requireAffiliateManager()` (access.ts)
 *      durchlaufen — owner/admin, nicht `trainer` (G10). Diese Datei prüft
 *      keine Rolle; sie ist reine Abfrageschicht und darf nie aus einer
 *      Route aufgerufen werden, die kein Gate davor hat.
 *   2. `tenantId` stammt aus diesem Gate, nie aus einem Formularfeld.
 *   3. Jede Abfrage trägt `.eq("tenant_id", tenantId)` — bei umgangenem RLS
 *      ist das nicht Defense-in-Depth, sondern die einzige Mandantengrenze.
 *   4. Jede Abfrage benennt ihre Spalten. `select("*")` bricht auf diesen
 *      Tabellen mit 42501 ab und wäre hier zusätzlich eine Datenleckquelle.
 *
 * KEINE dieser Funktionen wirft bei einem Datenbankfehler. Eine Admin-Seite
 * lädt ein Dutzend Kacheln mit `Promise.all`; eine geworfene Ausnahme risse
 * die ganze Seite ab, statt eine Kachel leer zu lassen. Protokolliert wird
 * der SQLSTATE ohne Nutzlast (CLAUDE.md §2.11) — die PostgREST-Meldung trägt
 * bei einer Constraint-Verletzung Bestell- und Rechnungskennungen im
 * Klartext.
 */

function logDbError(context: string, error: { code?: string } | null): void {
  console.error(
    `[affiliate/queries] ${context} fehlgeschlagen (Code ${error?.code ?? "unbekannt"}).`,
  );
}

// --- fetchAllRows -------------------------------------------------------

/**
 * Seitengröße, identisch zu `src/lib/reporting/queries.ts:81-97`. Muss
 * kleiner oder gleich der PostgREST-Einstellung „Max rows" sein (in diesem
 * Projekt 1000), sonst kappt der Server die Seite und die Abbruchbedingung
 * `batch.length < PAGE_SIZE` griffe nie.
 */
const AFFILIATE_PAGE_SIZE = 1000;

/**
 * Läuft eine Abfrage seitenweise durch, bis eine Seite weniger Zeilen
 * liefert als angefordert.
 *
 * PostgREST kappt Antworten standardmäßig bei 1000 Zeilen — OHNE Fehler und
 * ohne jeden Hinweis. Für einen Fortschrittsbericht ist das eine zu niedrige
 * Zahl; für einen SALDO ist es eine falsche Zahl, und zwar dauerhaft: der
 * Partner sähe einen Betrag, der Auszahlungslauf einen anderen. Deshalb ist
 * jede Saldo- und Aggregationsabfrage dieser Datei durch diese Funktion
 * geführt.
 *
 * `fetchPage` MUSS deterministisch sortieren (`.order("id")` vor `.range()`);
 * ohne stabile Ordnung garantiert Postgres über mehrere Anfragen hinweg keine
 * lückenlose, überschneidungsfreie Aufteilung.
 *
 * Ein Seitenfehler bricht die Schleife NICHT still ab wie im Reporting,
 * sondern meldet sich über `ok: false` zurück. Grund: eine halb geladene
 * Zeilenmenge ergibt einen zu kleinen Saldo, und ein zu kleiner Saldo sieht
 * genauso plausibel aus wie ein richtiger. Der Aufrufer muss die Kachel dann
 * als „nicht ermittelbar" rendern statt eine Zahl zu zeigen.
 */
async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ ok: boolean; rows: T[] }> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + AFFILIATE_PAGE_SIZE - 1);
    if (error) {
      logDbError("Seitenweises Laden", error as { code?: string });
      return { ok: false, rows };
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < AFFILIATE_PAGE_SIZE) break;
    from += AFFILIATE_PAGE_SIZE;
  }
  return { ok: true, rows };
}

// --- Spaltenlisten ------------------------------------------------------

/** Alle Spalten von `affiliate_programs` (3.2). Nur für den Manager-Pfad. */
const PROGRAM_COLUMNS =
  "id, tenant_id, status, visibility, approval_mode, rate_kind, rate_bp, fixed_cents, " +
  "min_commission_cents, max_commission_cents, basis_kind, fee_deduction_bp, currency, " +
  "attribution_model, cookie_ttl_days, overwrite_policy, lifetime_binding, self_referral, " +
  "referrer_blocklist, recurring_mode, recurring_max_periods, tier2_enabled, tier2_basis, " +
  "tier2_rate_bp, hold_days, reserve_bp, reserve_days, min_payout_cents, payout_schedule, " +
  "books_closed_until, description_md, terms_text, terms_version, application_note, " +
  "application_fields, test_mode, created_at, updated_at";

/**
 * Partnerspalten für die Manager-Oberfläche. Enthält bewusst die vier
 * Spalten, die `AFFILIATE_PARTNER_CLIENT_COLUMNS` (types.ts) dem Client
 * vorenthält — `applicant_email`, `status_reason`, `payout_hold_reason`,
 * `internal_note` — plus `application` (Bewerbungsangaben, 8.1).
 * `terms_accepted_ip_hash` steht NICHT hier: er ist der Zustimmungsnachweis
 * (11.6) und hat in keiner Liste und keinem Export etwas zu suchen.
 */
const PARTNER_ADMIN_COLUMNS =
  "id, tenant_id, program_id, user_id, applicant_email, display_name, company, code, " +
  "status, status_reason, group_id, referred_by, payout_hold, payout_hold_reason, " +
  "internal_note, application, terms_version_accepted, terms_accepted_at, " +
  "notify_sale, notify_reversal, notify_payout, created_at, updated_at";

const CONDITION_COLUMNS =
  "id, tenant_id, program_id, partner_id, group_id, product_id, rate_kind, rate_bp, " +
  "fixed_cents, valid_from, valid_to, note, specificity, created_at, updated_at";

/**
 * Buchungsspalten für die Manager-Oberfläche (8.1: aufklappbare Zeile mit
 * `condition_snapshot` und Zuordnungsgrund). `dedup_key` ist bewusst dabei:
 * er ist die Idempotenzachse (G3) und im Zweifelsfall die Antwort auf
 * „warum wurde das zweimal gebucht?".
 */
const COMMISSION_ADMIN_COLUMNS =
  "id, tenant_id, program_id, partner_id, kind, order_id, stripe_invoice_id, " +
  "stripe_subscription_id, stripe_charge_id, product_id, campaign, referral_id, " +
  "parent_id, reverses_id, base_cents, basis_kind, rate_kind, rate_bp, fixed_cents, " +
  "amount_cents, currency, condition_id, condition_snapshot, status, cancel_reason, " +
  "hold_until, booked_at, payout_id, paid_at, flagged, flag_reason, is_test, note, " +
  "dedup_key, created_at, updated_at";

/** Genau die Spalten, die `computeBalances()` braucht (types.ts, `AffiliateBalanceInput`). */
const BALANCE_COLUMNS =
  "id, partner_id, currency, kind, status, amount_cents, payout_id, reverses_id, is_test";

// --- Ergebnisformen -----------------------------------------------------

/** Eine Buchungszeile, wie die Admin-Oberfläche sie liest. */
export type AffiliateCommissionAdminRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  partner_id: string;
  kind: AffiliateCommissionKind;
  order_id: string | null;
  stripe_invoice_id: string | null;
  stripe_subscription_id: string | null;
  stripe_charge_id: string | null;
  product_id: string | null;
  campaign: string | null;
  referral_id: string | null;
  parent_id: string | null;
  reverses_id: string | null;
  base_cents: number;
  basis_kind: "net" | "gross";
  rate_kind: "percent" | "fixed";
  rate_bp: number;
  fixed_cents: number;
  amount_cents: number;
  currency: string;
  condition_id: string | null;
  condition_snapshot: AffiliateConditionSnapshot | null;
  status: AffiliateCommissionStatus;
  cancel_reason: AffiliateCancelReason | null;
  hold_until: string;
  booked_at: string;
  payout_id: string | null;
  paid_at: string | null;
  flagged: boolean;
  flag_reason: string | null;
  is_test: boolean;
  note: string | null;
  dedup_key: string;
  created_at: string;
  updated_at: string;
};

/** Tageszeile aus `affiliate_daily_stats` (3.14). */
export type AffiliateDailyStatRow = {
  partner_id: string;
  day: string;
  campaign: string;
  clicks: number;
  unique_clicks: number;
  bot_clicks: number;
  leads: number;
  orders_count: number;
  revenue_cents: number;
  commission_cents: number;
  reversal_cents: number;
};

const DAILY_STAT_COLUMNS =
  "partner_id, day, campaign, clicks, unique_clicks, bot_clicks, leads, orders_count, " +
  "revenue_cents, commission_cents, reversal_cents";

/**
 * Eine Kennzahl, wie sie die Oberfläche ausgibt. `available` ist bewusst ein
 * eigenes Feld und keine Summe über die Eimer (G5/5.10).
 *
 * `complete` ist die Ehrlichkeitsspalte: `false` heißt, dass mindestens eine
 * Seite nicht geladen werden konnte. Die Oberfläche MUSS dann „nicht
 * ermittelbar" schreiben statt eine zu kleine Zahl zu zeigen — eine falsche
 * Geldzahl ist schlimmer als gar keine, und ein sehbehinderter Betrachter
 * hat keine Chance, sie als falsch zu erkennen.
 */
export type AffiliateMetric = {
  value: number;
  complete: boolean;
};

/** Zeile der Partnerliste (8.1, `/admin/affiliate/partner`). */
export type AffiliatePartnerListRow = {
  partner: AffiliatePartnerRow;
  groupName: string | null;
  /** Klicks der letzten 30 Tage (`affiliate_daily_stats`). */
  clicks30d: number;
  uniqueClicks30d: number;
  /** Verkäufe der letzten 30 Tage. */
  orders30d: number;
  /** Salden je Währung — nie über Währungen hinweg summiert (5.11). */
  balances: AffiliateBalances[];
};

/** Ergebnis des Konditionen-Rechners (8.1, `/admin/affiliate/konditionen`). */
export type AffiliateConditionPreview = {
  resolution: AffiliateRateResolution;
  /** Bruttopreis des gewählten Produkts, Ausgangspunkt der Rechnung. */
  gross_cents: number;
  base_cents: number;
  amount_cents: number;
  sale_cents: number;
  reserve_cents: number;
  currency: string;
  /** Der Deckel aus 5.6 hat gegriffen — dieselbe Markierung wie in der Buchung. */
  flagged: boolean;
};

// --- Programm -----------------------------------------------------------

/**
 * Die Programmzeile des Mandanten. Je Mandant genau eine (`unique (tenant_id)`,
 * 3.2); `null` bedeutet „das Modul ist eingeschaltet, aber noch nie
 * konfiguriert worden" — die Einstellungsseite legt sie beim ersten Speichern
 * an.
 */
export async function getAffiliateProgram(
  tenantId: string,
): Promise<AffiliateProgramRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("affiliate_programs")
    .select(PROGRAM_COLUMNS)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    logDbError("Programm lesen", error);
    return null;
  }
  return (data ?? null) as AffiliateProgramRow | null;
}

// --- Gruppen ------------------------------------------------------------

export async function listAffiliateGroups(tenantId: string): Promise<AffiliateGroupRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("affiliate_groups")
    .select("id, tenant_id, program_id, name, created_at")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  if (error) {
    logDbError("Gruppen lesen", error);
    return [];
  }
  return (data ?? []) as unknown as AffiliateGroupRow[];
}

// --- Konditionen --------------------------------------------------------

/**
 * Die Vorrangkette, sortiert wie sie greift (8.1): `specificity desc`, dann
 * `valid_from desc`, dann `id` — wortgleich zu `resolveCondition()` (5.2).
 * Die Oberfläche nummeriert die Liste durch und zeigt damit denselben Rang,
 * den der Verarbeiter benutzt.
 */
export async function listAffiliateConditions(
  tenantId: string,
): Promise<AffiliateConditionRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("affiliate_conditions")
    .select(CONDITION_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("specificity", { ascending: false })
    .order("valid_from", { ascending: false })
    .order("id", { ascending: true });
  if (error) {
    logDbError("Konditionen lesen", error);
    return [];
  }
  return (data ?? []) as unknown as AffiliateConditionRow[];
}

/**
 * Der Rechner aus 8.1: „Es gilt Regel #3: 35 %, das sind bei 499 € brutto
 * 132,08 €."
 *
 * Er ruft ausdrücklich DIESELBEN reinen Funktionen wie der Verarbeiter
 * (`computeBaseCents` → `resolveCondition` → `computeCommissionParts`) und
 * rechnet nichts nach. Eine zweite Rechenlogik in der Oberfläche wäre genau
 * der Fall, in dem die Vorschau etwas anderes ausgibt als die spätere
 * Buchung — und der Manager der Buchung dann nicht mehr traut.
 *
 * `at` ist der Bewertungszeitpunkt; die Vorschau nimmt `now()`, weil sie eine
 * Aussage über den heutigen Stand macht. Der Verarbeiter nimmt statt dessen
 * `event.occurred_at` (5.2) — derselbe Parameter, anderer Wert.
 *
 * Steuer und Versand sind hier 0: der Listenpreis eines Produkts ist der
 * Bruttobetrag, den Stripe später als `amount_total` meldet, und wie viel
 * davon Steuer ist, steht erst an der Bestellung fest. Die Oberfläche muss
 * das als Satz danebenschreiben („ohne Steueranteil gerechnet"), sonst ist
 * die Zahl bei `basis_kind = 'net'` zu hoch.
 */
export async function previewAffiliateCommission(params: {
  tenantId: string;
  partnerId: string;
  productId: string | null;
  at?: Date;
}): Promise<AffiliateConditionPreview | null> {
  const admin = createAdminClient();

  const [program, partner] = await Promise.all([
    getAffiliateProgram(params.tenantId),
    getAffiliatePartner(params.tenantId, params.partnerId),
  ]);
  // Plan 11.15: eine fremde oder erfundene `partnerId` findet hier nichts und
  // führt zu derselben Antwort wie ein fehlendes Programm — `null`.
  if (program === null || partner === null) return null;

  let grossCents = 0;
  let currency = program.currency;
  if (params.productId !== null) {
    const { data, error } = await admin
      .from("products")
      .select("id, price_cents, currency")
      .eq("tenant_id", params.tenantId)
      .eq("id", params.productId)
      .maybeSingle();
    if (error) {
      logDbError("Produkt für Vorschau lesen", error);
      return null;
    }
    // Auch hier 11.15: ein Produkt aus einem anderen Mandanten ist kein
    // Fehler mit eigenem Text, sondern schlicht nicht vorhanden.
    if (!data) return null;
    grossCents = (data as { price_cents: number }).price_cents;
    currency = (data as { currency: string | null }).currency ?? program.currency;
  }

  const conditions = await listAffiliateConditions(params.tenantId);
  const candidates: AffiliateConditionCandidate[] = conditions.map((row) => ({
    id: row.id,
    partner_id: row.partner_id,
    group_id: row.group_id,
    product_id: row.product_id,
    rate_kind: row.rate_kind,
    rate_bp: row.rate_bp,
    fixed_cents: row.fixed_cents,
    valid_from: row.valid_from,
    valid_to: row.valid_to,
  }));

  const resolution = resolveCondition(
    candidates,
    {
      partner_id: partner.id,
      group_id: partner.group_id,
      product_id: params.productId,
      at: params.at ?? new Date(),
    },
    { rate_kind: program.rate_kind, rate_bp: program.rate_bp, fixed_cents: program.fixed_cents },
  );

  const base = computeBaseCents({
    gross_cents: grossCents,
    tax_cents: 0,
    shipping_cents: 0,
    basis_kind: program.basis_kind,
    fee_deduction_bp: program.fee_deduction_bp,
  });

  const parts = computeCommissionParts({
    base_cents: base.base_cents,
    rate_kind: resolution.rate_kind,
    rate_bp: resolution.rate_bp,
    fixed_cents: resolution.fixed_cents,
    min_commission_cents: program.min_commission_cents,
    max_commission_cents: program.max_commission_cents,
    reserve_bp: program.reserve_bp,
  });

  return {
    resolution,
    gross_cents: base.gross_cents,
    base_cents: base.base_cents,
    amount_cents: parts.amount_cents,
    sale_cents: parts.sale_cents,
    reserve_cents: parts.reserve_cents,
    currency,
    flagged: parts.flagged,
  };
}

// --- Partner ------------------------------------------------------------

/**
 * Eine einzelne Partnerzeile — und zugleich die Mandantenprüfung einer
 * client-gelieferten `partnerId` (CLAUDE.md §2.15). `null` heißt „in dieser
 * Akademie nicht vorhanden" und unterscheidet bewusst NICHT zwischen „gibt es
 * gar nicht" und „gehört einem anderen Mandanten": aus zwei verschiedenen
 * Antworten ließe sich die Existenz fremder Partner ableiten.
 */
export async function getAffiliatePartner(
  tenantId: string,
  partnerId: string,
): Promise<AffiliatePartnerRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("affiliate_partners")
    .select(PARTNER_ADMIN_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", partnerId)
    .maybeSingle();
  if (error) {
    logDbError("Partner lesen", error);
    return null;
  }
  return (data ?? null) as AffiliatePartnerRow | null;
}

/**
 * Alle Partner des Mandanten, optional auf einen Status eingegrenzt.
 *
 * `status` wird gegen `AFFILIATE_PARTNER_STATUSES` geweißt und NICHT als
 * Zeichenkette in den Filter gereicht (CLAUDE.md §2.12, Plan 11.12): der Wert
 * kommt bei `/admin/affiliate/partner` aus `searchParams` und ist damit
 * Nutzereingabe.
 *
 * `fetchAllRows()`, weil ein Mandant mit mehr als 1000 Partnern sonst eine
 * still verkürzte Liste bekäme — und weil dieselbe Liste die Grundlage der
 * Kennzahlen ist.
 */
export async function listAffiliatePartners(
  tenantId: string,
  options: { status?: string | null } = {},
): Promise<{ ok: boolean; rows: AffiliatePartnerRow[] }> {
  const admin = createAdminClient();
  const status = AFFILIATE_PARTNER_STATUSES.find((value) => value === options.status) ?? null;

  const result = await fetchAllRows<AffiliatePartnerRow>((from, to) => {
    let query = admin
      .from("affiliate_partners")
      .select(PARTNER_ADMIN_COLUMNS)
      .eq("tenant_id", tenantId);
    if (status !== null) query = query.eq("status", status);
    return query.order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{
      data: AffiliatePartnerRow[] | null;
      error: unknown;
    }>;
  });

  return result;
}

// --- Salden (5.10) ------------------------------------------------------

/**
 * DIE SALDO-ABFRAGE. Zwei Eigenschaften sind hier nicht verhandelbar, und
 * beide stehen aus einem konkreten Grund so:
 *
 * 1. SIE IST NICHT PAGINIERT. `computeBalances()` ordnet eine Gegenbuchung
 *    über `reverses_id` dem Eimer ihres ELTERNTEILS zu (G6/5.10). Findet sich
 *    das Elternteil nicht in der übergebenen Menge, bleibt die Gegenbuchung
 *    bei ihrer eigenen Art — eine Gegenbuchung auf eine Reserve-Zeile zöge
 *    dann vom Eimer „offen" ab statt von „in Reserve", und BEIDE Zahlen wären
 *    falsch, ohne dass ihre Summe es wäre. Deshalb geht hier immer die
 *    vollständige Zeilenmenge eines Partners hinein, nie eine Seite davon.
 *    `fetchAllRows()` ist genau dafür da.
 *
 * 2. DIE FORMEL WIRD NICHT IN SQL NACHGEBAUT. Ein `sum(amount_cents) group by
 *    status` wäre schneller und für vier der fünf Eimer sogar richtig — die
 *    Eimer-Zuordnung über `reverses_id` bekäme man aber nur mit einem Join auf
 *    dieselbe Tabelle, und damit stünde die Saldoregel an zwei Orten. Der Ort,
 *    an dem sie getestet ist, ist `compute.ts` (5.10, letzter Absatz). Eine
 *    zweite Fassung in SQL wäre die Stelle, an der Anzeige und
 *    Auszahlungslauf auseinanderlaufen.
 *
 * `is_test`-Zeilen filtert `computeBalances()` selbst heraus (4.5); sie werden
 * hier trotzdem mitgeladen, weil die Admin-Transaktionsliste sie zeigt und
 * eine zweite Abfrage dafür nichts einbrächte.
 */
export async function getAffiliateBalances(
  tenantId: string,
  partnerId: string,
): Promise<{ ok: boolean; balances: AffiliateBalances[] }> {
  const admin = createAdminClient();

  const { ok, rows } = await fetchAllRows<AffiliateBalanceInput>((from, to) =>
    admin
      .from("affiliate_commissions")
      .select(BALANCE_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("partner_id", partnerId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
      data: AffiliateBalanceInput[] | null;
      error: unknown;
    }>,
  );

  // Bei einer abgebrochenen Seite wird KEIN Saldo geliefert. Ein zu kleiner
  // Betrag sieht genauso plausibel aus wie ein richtiger, und der Manager
  // trifft daraufhin Auszahlungsentscheidungen.
  if (!ok) return { ok: false, balances: [] };
  return { ok: true, balances: computeBalances(rows) };
}

/**
 * Dieselbe Rechnung für ALLE Partner eines Mandanten in EINEM Durchlauf —
 * die Partnerliste und das Dashboard brauchen sie für jede Zeile, und eine
 * Abfrage je Partner wären bei 300 Partnern 300 Rundläufe.
 *
 * Auch hier gilt Punkt 1 von oben unverändert: geladen wird der gesamte
 * Mandantenbestand, nicht eine Seite. `computeBalances()` gruppiert selbst
 * nach `(partner_id, currency)`.
 */
export async function getAffiliateBalancesByPartner(
  tenantId: string,
): Promise<{ ok: boolean; byPartner: Map<string, AffiliateBalances[]> }> {
  const admin = createAdminClient();

  const { ok, rows } = await fetchAllRows<AffiliateBalanceInput>((from, to) =>
    admin
      .from("affiliate_commissions")
      .select(BALANCE_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
      data: AffiliateBalanceInput[] | null;
      error: unknown;
    }>,
  );

  if (!ok) return { ok: false, byPartner: new Map() };

  const byPartner = new Map<string, AffiliateBalances[]>();
  for (const balances of computeBalances(rows)) {
    const list = byPartner.get(balances.partner_id);
    if (list === undefined) byPartner.set(balances.partner_id, [balances]);
    else list.push(balances);
  }
  return { ok: true, byPartner };
}

// --- Buchungen ----------------------------------------------------------

/**
 * Die Filter der Provisionsliste (8.1). ERLAUBNISLISTE auf Spaltennamen, kein
 * einziger Wert wird in einen Filterausdruck konkateniert (CLAUDE.md §2.12,
 * Plan 11.12). Alles, was nicht in dieser Form beschreibbar ist, gibt es in
 * der Oberfläche nicht.
 */
export type AffiliateCommissionFilter = {
  status?: string | null;
  partnerId?: string | null;
  productId?: string | null;
  /** ISO-Datum `JJJJ-MM-TT`, inklusiv, gegen `booked_at`. */
  from?: string | null;
  to?: string | null;
  flagged?: boolean | null;
  includeTest?: boolean;
  limit?: number;
};

const AFFILIATE_COMMISSION_STATUS_VALUES = [
  "pending",
  "on_hold",
  "approved",
  "paid",
  "cancelled",
] as const satisfies readonly AffiliateCommissionStatus[];

/** `JJJJ-MM-TT` — enger als jedes PostgREST-Trennzeichen. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Kanonische UUID; alles andere erreicht keinen Filter. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Obergrenze einer Listenseite; darüber hilft nur der CSV-Export. */
const COMMISSION_LIST_LIMIT = 500;

export async function listAffiliateCommissions(
  tenantId: string,
  filter: AffiliateCommissionFilter = {},
): Promise<AffiliateCommissionAdminRow[]> {
  const admin = createAdminClient();

  let query = admin
    .from("affiliate_commissions")
    .select(COMMISSION_ADMIN_COLUMNS)
    .eq("tenant_id", tenantId);

  const status = AFFILIATE_COMMISSION_STATUS_VALUES.find((value) => value === filter.status);
  if (status !== undefined) query = query.eq("status", status);

  if (typeof filter.partnerId === "string" && UUID_PATTERN.test(filter.partnerId)) {
    query = query.eq("partner_id", filter.partnerId);
  }
  if (typeof filter.productId === "string" && UUID_PATTERN.test(filter.productId)) {
    query = query.eq("product_id", filter.productId);
  }
  if (typeof filter.from === "string" && ISO_DATE_PATTERN.test(filter.from)) {
    query = query.gte("booked_at", filter.from);
  }
  if (typeof filter.to === "string" && ISO_DATE_PATTERN.test(filter.to)) {
    query = query.lte("booked_at", filter.to);
  }
  if (filter.flagged === true) query = query.eq("flagged", true);
  // Testbuchungen sind in der Admin-Liste sichtbar und als „Test"
  // gekennzeichnet (4.5) — aber nur, wenn der Manager sie ausdrücklich
  // einblendet. Vorgabe ist „aus", damit die Liste dieselbe Menge zeigt wie
  // Salden und Auszahlungslauf.
  if (filter.includeTest !== true) query = query.eq("is_test", false);

  const limit = Math.min(Math.max(1, filter.limit ?? 100), COMMISSION_LIST_LIMIT);

  const { data, error } = await query
    .order("booked_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) {
    logDbError("Buchungen lesen", error);
    return [];
  }
  return (data ?? []) as unknown as AffiliateCommissionAdminRow[];
}

/**
 * Der Kontoauszug eines Partners (8.1: „Kontoauszug, letzte 50 Buchungen").
 * `partnerId` ist client-geliefert und wird deshalb hier mit derselben
 * `.eq("tenant_id", …)`-Bindung gefiltert wie überall sonst; eine fremde ID
 * liefert eine leere Liste, keine Fehlermeldung.
 */
export async function listAffiliatePartnerStatement(
  tenantId: string,
  partnerId: string,
  limit = 50,
): Promise<AffiliateCommissionAdminRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("affiliate_commissions")
    .select(COMMISSION_ADMIN_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .order("booked_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(Math.min(Math.max(1, limit), COMMISSION_LIST_LIMIT));
  if (error) {
    logDbError("Kontoauszug lesen", error);
    return [];
  }
  return (data ?? []) as unknown as AffiliateCommissionAdminRow[];
}

/**
 * Alle Buchungszeilen EINER Bestellung — die Grundlage der Umbuchung (4.6)
 * und der aufklappbaren Zeile in der Provisionsliste.
 */
export async function listAffiliateCommissionsByOrder(
  tenantId: string,
  orderId: string,
): Promise<AffiliateCommissionAdminRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("affiliate_commissions")
    .select(COMMISSION_ADMIN_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .order("id", { ascending: true });
  if (error) {
    logDbError("Buchungen zur Bestellung lesen", error);
    return [];
  }
  return (data ?? []) as unknown as AffiliateCommissionAdminRow[];
}

// --- Tagesstatistik -----------------------------------------------------

/**
 * `affiliate_daily_stats` für einen Zeitraum. Einzige Quelle der
 * Klick-Kennzahlen — `affiliate_clicks` wird nach 90 Tagen gelöscht (3.6) und
 * taugt für keine Zeitreihe.
 */
export async function listAffiliateDailyStats(
  tenantId: string,
  range: { from: string; to: string },
): Promise<{ ok: boolean; rows: AffiliateDailyStatRow[] }> {
  if (!ISO_DATE_PATTERN.test(range.from) || !ISO_DATE_PATTERN.test(range.to)) {
    return { ok: false, rows: [] };
  }

  const admin = createAdminClient();
  return fetchAllRows<AffiliateDailyStatRow>((from, to) =>
    admin
      .from("affiliate_daily_stats")
      .select(DAILY_STAT_COLUMNS)
      .eq("tenant_id", tenantId)
      .gte("day", range.from)
      .lte("day", range.to)
      // Kein `id` in dieser Tabelle (der Primärschlüssel ist fachlich);
      // `(day, partner_id, campaign)` ist trotzdem eindeutig und damit eine
      // stabile Ordnung im Sinne von `fetchAllRows()`.
      .order("day", { ascending: true })
      .order("partner_id", { ascending: true })
      .order("campaign", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
      data: AffiliateDailyStatRow[] | null;
      error: unknown;
    }>,
  );
}

/** Summiert Tageszeilen je Partner — die Spalten „Klicks 30 T" und „Verkäufe". */
export function sumDailyStatsByPartner(
  rows: readonly AffiliateDailyStatRow[],
): Map<string, { clicks: number; uniqueClicks: number; orders: number; revenueCents: number }> {
  const byPartner = new Map<
    string,
    { clicks: number; uniqueClicks: number; orders: number; revenueCents: number }
  >();
  for (const row of rows) {
    const entry = byPartner.get(row.partner_id) ?? {
      clicks: 0,
      uniqueClicks: 0,
      orders: 0,
      revenueCents: 0,
    };
    entry.clicks += row.clicks;
    entry.uniqueClicks += row.unique_clicks;
    entry.orders += row.orders_count;
    entry.revenueCents += row.revenue_cents;
    byPartner.set(row.partner_id, entry);
  }
  return byPartner;
}

// --- Warnbanner des Dashboards -----------------------------------------

/**
 * „n Zahlungsereignisse nicht verarbeitet" (8.1).
 *
 * `affiliate_events` ist eine Deny-All-Tabelle (3.10) — nur `service_role`
 * liest sie, und deshalb gibt es diese Zahl ausschließlich über den
 * Admin-Client. Gezählt werden `error` und `pending`; ein `pending`-Ereignis
 * ist erst dann eine Auffälligkeit, wenn es liegen bleibt, weshalb die
 * Oberfläche zusätzlich das Alter der ältesten Zeile zeigt.
 *
 * Bewusst NULLABLE `tenant_id` (3.10): für `charge.refunded` und die drei
 * Dispute-Ereignisse ist der Mandant zur Aufnahmezeit unbekannt. Diese Zeilen
 * erscheinen hier NICHT — sie gehören keinem Mandanten und stünden sonst im
 * Dashboard jedes Mandanten. Sie sind Sache der Betreiber-Aufsicht (8.4).
 */
export async function getAffiliateEventBacklog(tenantId: string): Promise<{
  ok: boolean;
  pending: number;
  errored: number;
  oldestAt: string | null;
}> {
  const admin = createAdminClient();

  const [pendingResult, errorResult, oldestResult] = await Promise.all([
    admin
      .from("affiliate_events")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "pending"),
    admin
      .from("affiliate_events")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "error"),
    admin
      .from("affiliate_events")
      .select("created_at")
      .eq("tenant_id", tenantId)
      .in("status", ["pending", "error"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (pendingResult.error || errorResult.error || oldestResult.error) {
    logDbError(
      "Ereignis-Rückstand lesen",
      pendingResult.error ?? errorResult.error ?? oldestResult.error,
    );
    return { ok: false, pending: 0, errored: 0, oldestAt: null };
  }

  return {
    ok: true,
    pending: pendingResult.count ?? 0,
    errored: errorResult.count ?? 0,
    oldestAt: (oldestResult.data as { created_at: string } | null)?.created_at ?? null,
  };
}

/** „n geflaggte Buchungen" (8.1). Testzeilen zählen nicht mit (4.5). */
export async function countFlaggedAffiliateCommissions(
  tenantId: string,
): Promise<{ ok: boolean; value: number }> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("affiliate_commissions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("flagged", true)
    .eq("is_test", false);
  if (error) {
    logDbError("Markierte Buchungen zählen", error);
    return { ok: false, value: 0 };
  }
  return { ok: true, value: count ?? 0 };
}

/** „Offene Bewerbungen (n)" (8.1). */
export async function countAffiliateApplications(
  tenantId: string,
): Promise<{ ok: boolean; value: number }> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("affiliate_partners")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "pending");
  if (error) {
    logDbError("Offene Bewerbungen zählen", error);
    return { ok: false, value: 0 };
  }
  return { ok: true, value: count ?? 0 };
}

// --- Änderungsprotokoll -------------------------------------------------

export type AffiliateAuditEntryRow = {
  id: string;
  actor_user_id: string | null;
  actor_kind: "manager" | "partner" | "system";
  entity: string;
  entity_id: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Das Änderungsprotokoll zu einem Gegenstand (8.1: unter der Partnerseite).
 * `entityId` ist client-geliefert; die Mandantenbindung steht wie überall im
 * `.eq("tenant_id", …)`.
 */
export async function listAffiliateAuditEntries(
  tenantId: string,
  params: { entity?: string; entityId?: string | null; limit?: number } = {},
): Promise<AffiliateAuditEntryRow[]> {
  const admin = createAdminClient();
  let query = admin
    .from("affiliate_audit_log")
    .select("id, actor_user_id, actor_kind, entity, entity_id, action, before, after, created_at")
    .eq("tenant_id", tenantId);

  if (typeof params.entity === "string" && /^[a-z]{1,20}$/.test(params.entity)) {
    query = query.eq("entity", params.entity);
  }
  if (typeof params.entityId === "string" && UUID_PATTERN.test(params.entityId)) {
    query = query.eq("entity_id", params.entityId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(1, params.limit ?? 50), 200));
  if (error) {
    logDbError("Änderungsprotokoll lesen", error);
    return [];
  }
  return (data ?? []) as unknown as AffiliateAuditEntryRow[];
}

// --- Produkte (Auswahlfelder) -------------------------------------------

export type AffiliateProductOption = {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  kind: string;
  active: boolean;
};

/** Produkte des Mandanten für die `<select>`-Felder in Kondition und Rechner. */
export async function listAffiliateProducts(
  tenantId: string,
): Promise<AffiliateProductOption[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products")
    .select("id, title, price_cents, currency, kind, active")
    .eq("tenant_id", tenantId)
    .order("title", { ascending: true });
  if (error) {
    logDbError("Produkte lesen", error);
    return [];
  }
  return ((data ?? []) as unknown as Array<AffiliateProductOption & { currency: string | null }>).map(
    (row) => ({ ...row, currency: row.currency ?? "eur" }),
  );
}

// --- Zusammengesetzte Sichten ------------------------------------------

/** ISO-Datum `JJJJ-MM-TT` in UTC — dieselbe Form wie `booked_at` und `day`. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Der Zeitraum der Kennzahlen, Vorgabe 30 Tage (8.1: „Klicks 30 T"). Der
 * Zeitraumwähler der Seite reicht abweichende Werte herein; sie laufen
 * trotzdem durch `ISO_DATE_PATTERN`, weil sie aus `searchParams` stammen.
 */
export const AFFILIATE_DEFAULT_RANGE_DAYS = 30;

export function defaultAffiliateRange(now: Date = new Date()): { from: string; to: string } {
  const to = toIsoDate(now);
  const fromDate = new Date(now.getTime() - (AFFILIATE_DEFAULT_RANGE_DAYS - 1) * 86_400_000);
  return { from: toIsoDate(fromDate), to };
}

/** Die Kacheln von `/admin/affiliate` (8.1), alle vier zugleich als Text. */
export type AffiliateDashboardData = {
  program: AffiliateProgramRow | null;
  range: { from: string; to: string };
  clicks: AffiliateMetric;
  orders: AffiliateMetric;
  /** Summe der verfügbaren Provision je Währung — nie über Währungen summiert (5.11). */
  availableByCurrency: Array<{ currency: string; cents: number }>;
  availableComplete: boolean;
  /**
   * Stornoquote in Basispunkten (`reversal_cents / commission_cents`), damit
   * die Oberfläche ohne Fließkomma formatiert. `null` = im Zeitraum wurde
   * keine Provision gebucht; dann gibt es keine Quote, und „0 %" wäre eine
   * Falschaussage.
   */
  reversalRateBp: number | null;
  eventBacklog: Awaited<ReturnType<typeof getAffiliateEventBacklog>>;
  flagged: Awaited<ReturnType<typeof countFlaggedAffiliateCommissions>>;
  openApplications: Awaited<ReturnType<typeof countAffiliateApplications>>;
  topPartners: AffiliatePartnerListRow[];
  latestCommissions: AffiliateCommissionAdminRow[];
};

/**
 * Alles, was `/admin/affiliate` braucht, in einem Aufruf. Die Seite selbst
 * bleibt damit frei von Rechenlogik und rendert nur.
 *
 * Reihenfolge der Top-10 (8.1): nach verfügbarer Provision der
 * Programmwährung, absteigend. Partner ohne Buchung in dieser Währung stehen
 * mit 0 am Ende — sie verschwinden nicht, sonst sähe ein Manager eine Liste,
 * in der der neue Partner fehlt, ohne zu wissen warum.
 */
export async function getAffiliateDashboardData(
  tenantId: string,
  range?: { from: string; to: string },
): Promise<AffiliateDashboardData> {
  const effectiveRange = range ?? defaultAffiliateRange();

  const [program, stats, balances, partners, eventBacklog, flagged, openApplications, latest] =
    await Promise.all([
      getAffiliateProgram(tenantId),
      listAffiliateDailyStats(tenantId, effectiveRange),
      getAffiliateBalancesByPartner(tenantId),
      listAffiliatePartners(tenantId),
      getAffiliateEventBacklog(tenantId),
      countFlaggedAffiliateCommissions(tenantId),
      countAffiliateApplications(tenantId),
      listAffiliateCommissions(tenantId, { limit: 10 }),
    ]);

  let clicks = 0;
  let orders = 0;
  let commissionCents = 0;
  let reversalCents = 0;
  for (const row of stats.rows) {
    clicks += row.clicks;
    orders += row.orders_count;
    commissionCents += row.commission_cents;
    reversalCents += row.reversal_cents;
  }

  const byCurrency = new Map<string, number>();
  for (const list of balances.byPartner.values()) {
    for (const entry of list) {
      byCurrency.set(entry.currency, (byCurrency.get(entry.currency) ?? 0) + entry.available_cents);
    }
  }

  const groups = await listAffiliateGroups(tenantId);
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const statsByPartner = sumDailyStatsByPartner(stats.rows);

  const programCurrency = program?.currency ?? "eur";
  const partnerRows: AffiliatePartnerListRow[] = partners.rows.map((partner) => {
    const partnerStats = statsByPartner.get(partner.id);
    return {
      partner,
      groupName: partner.group_id === null ? null : (groupNames.get(partner.group_id) ?? null),
      clicks30d: partnerStats?.clicks ?? 0,
      uniqueClicks30d: partnerStats?.uniqueClicks ?? 0,
      orders30d: partnerStats?.orders ?? 0,
      balances: balances.byPartner.get(partner.id) ?? [],
    };
  });

  const availableOf = (row: AffiliatePartnerListRow): number =>
    row.balances.find((entry) => entry.currency === programCurrency)?.available_cents ?? 0;

  const topPartners = [...partnerRows]
    .sort((a, b) => availableOf(b) - availableOf(a) || a.partner.id.localeCompare(b.partner.id))
    .slice(0, 10);

  return {
    program,
    range: effectiveRange,
    clicks: { value: clicks, complete: stats.ok },
    orders: { value: orders, complete: stats.ok },
    availableByCurrency: [...byCurrency.entries()]
      .map(([currency, cents]) => ({ currency, cents }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    availableComplete: balances.ok,
    // `reversal_cents` steht in `affiliate_daily_stats` positiv; die Quote ist
    // damit ein reiner Verhältniswert und braucht kein Vorzeichen.
    reversalRateBp:
      commissionCents > 0 ? Math.round((reversalCents * 10000) / commissionCents) : null,
    eventBacklog,
    flagged,
    openApplications,
    topPartners,
    latestCommissions: latest,
  };
}

/** Alles, was `/admin/affiliate/partner` braucht. */
export async function getAffiliatePartnerListData(
  tenantId: string,
  options: { status?: string | null; range?: { from: string; to: string } } = {},
): Promise<{
  ok: boolean;
  range: { from: string; to: string };
  rows: AffiliatePartnerListRow[];
  groups: AffiliateGroupRow[];
}> {
  const range = options.range ?? defaultAffiliateRange();
  const [partners, stats, balances, groups] = await Promise.all([
    listAffiliatePartners(tenantId, { status: options.status ?? null }),
    listAffiliateDailyStats(tenantId, range),
    getAffiliateBalancesByPartner(tenantId),
    listAffiliateGroups(tenantId),
  ]);

  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const statsByPartner = sumDailyStatsByPartner(stats.rows);

  const rows = partners.rows.map((partner) => {
    const partnerStats = statsByPartner.get(partner.id);
    return {
      partner,
      groupName: partner.group_id === null ? null : (groupNames.get(partner.group_id) ?? null),
      clicks30d: partnerStats?.clicks ?? 0,
      uniqueClicks30d: partnerStats?.uniqueClicks ?? 0,
      orders30d: partnerStats?.orders ?? 0,
      balances: balances.byPartner.get(partner.id) ?? [],
    };
  });

  return { ok: partners.ok && stats.ok && balances.ok, range, rows, groups };
}

/**
 * Alles, was `/admin/affiliate/partner/[id]` braucht.
 *
 * `null` heißt „in dieser Akademie nicht vorhanden" — für eine erfundene ID
 * und für die eines fremden Mandanten dieselbe Antwort (11.15). Die Seite
 * rendert daraufhin `notFound()`.
 *
 * BANKDATEN STEHEN HIER NICHT (8.1, letzter Satz der Zeile). Das
 * Abrechnungsprofil wird ausschließlich als Vollständigkeitsampel geladen:
 * ob Anschrift, Steuerstatus und Zahlweg gesetzt sind — nie die Werte. Die
 * Spaltenliste ist deshalb kurz und enthält weder `iban` noch `bic`,
 * `account_holder`, `paypal_email` oder `tax_number`.
 */
export async function getAffiliatePartnerDetail(
  tenantId: string,
  partnerId: string,
): Promise<{
  partner: AffiliatePartnerRow;
  groupName: string | null;
  groups: AffiliateGroupRow[];
  resolution: AffiliateRateResolution | null;
  balances: AffiliateBalances[];
  balancesComplete: boolean;
  statement: AffiliateCommissionAdminRow[];
  auditEntries: AffiliateAuditEntryRow[];
  payoutReadiness: {
    hasAddress: boolean;
    hasTaxStatus: boolean;
    hasPayoutMethod: boolean;
  };
} | null> {
  if (!UUID_PATTERN.test(partnerId)) return null;

  const partner = await getAffiliatePartner(tenantId, partnerId);
  if (partner === null) return null;

  const admin = createAdminClient();
  const [program, conditions, groups, balances, statement, auditEntries, profileResult] =
    await Promise.all([
      getAffiliateProgram(tenantId),
      listAffiliateConditions(tenantId),
      listAffiliateGroups(tenantId),
      getAffiliateBalances(tenantId, partnerId),
      listAffiliatePartnerStatement(tenantId, partnerId, 50),
      listAffiliateAuditEntries(tenantId, { entity: "partner", entityId: partnerId }),
      admin
        .from("affiliate_billing_profiles")
        .select("partner_id, entity_kind, street, postal_code, city, country, small_business, vat_id, payout_method")
        .eq("tenant_id", tenantId)
        .eq("partner_id", partnerId)
        .maybeSingle(),
    ]);

  const profile = (profileResult.data ?? null) as {
    entity_kind: string | null;
    street: string | null;
    postal_code: string | null;
    city: string | null;
    country: string | null;
    small_business: boolean | null;
    vat_id: string | null;
    payout_method: string | null;
  } | null;

  // Der TATSÄCHLICH wirksame Satz samt Herkunft (8.1: „aus Gruppe
  // ‚Top-Partner': 40 %"). Ohne Produkt gerechnet — das ist der Satz, der
  // gilt, solange keine Produktkondition greift.
  const resolution =
    program === null
      ? null
      : resolveCondition(
          conditions.map((row) => ({
            id: row.id,
            partner_id: row.partner_id,
            group_id: row.group_id,
            product_id: row.product_id,
            rate_kind: row.rate_kind,
            rate_bp: row.rate_bp,
            fixed_cents: row.fixed_cents,
            valid_from: row.valid_from,
            valid_to: row.valid_to,
          })),
          { partner_id: partner.id, group_id: partner.group_id, product_id: null, at: new Date() },
          {
            rate_kind: program.rate_kind,
            rate_bp: program.rate_bp,
            fixed_cents: program.fixed_cents,
          },
        );

  return {
    partner,
    groupName:
      partner.group_id === null
        ? null
        : (groups.find((group) => group.id === partner.group_id)?.name ?? null),
    groups,
    resolution,
    balances: balances.balances,
    balancesComplete: balances.ok,
    statement,
    auditEntries,
    payoutReadiness: {
      hasAddress:
        profile !== null &&
        profile.street !== null &&
        profile.postal_code !== null &&
        profile.city !== null &&
        profile.country !== null,
      hasTaxStatus:
        profile !== null &&
        profile.entity_kind !== null &&
        (profile.small_business === true || profile.vat_id !== null || profile.entity_kind === "private"),
      hasPayoutMethod: profile !== null && profile.payout_method !== null,
    },
  };
}
