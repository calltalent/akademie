import "server-only";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { resolveLegalEntity, type LegalEntity } from "@/lib/legal/company";
import { computeBalances } from "@/lib/affiliate/compute";
import { verifyAffiliateIntegrity, type AffiliateIntegrityReport } from "@/lib/affiliate/integrity";
import { notifyAffiliatePayoutPaid } from "@/lib/affiliate/notify";
import { isValidIban } from "@/lib/affiliate/sepa";
import {
  computeAffiliateTax,
  normalizeVatId,
  resolveAffiliateTax,
  type AffiliateTaxBlockReason,
} from "@/lib/affiliate/tax";
import type {
  AffiliateBalanceInput,
  AffiliateEntityKind,
  AffiliatePayoutMethod,
  AffiliatePayoutSchedule,
  AffiliateTaxMode,
  AffiliateVatCheckResult,
} from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B8 — DER AUSZAHLUNGSLAUF
 * (PLAN_Affiliate-System.md 7.1, 7.2, 7.6, 7.7; G5, G8, G15).
 *
 * Fünf Schritte, in dieser Reihenfolge, jeder für sich wiederholbar:
 * Kandidaten ermitteln → Entwurf per Compare-and-Swap → Freigabe → als gezahlt
 * markieren → als fehlgeschlagen markieren.
 *
 * ## DREI REGELN, DIE DIESE DATEI TRAGEN
 *
 * 1. DER SALDO KOMMT AUS `computeBalances()`, NIE AUS EINER ZWEITEN FORMEL.
 *    Die Zuordnung einer Gegenbuchung zum richtigen Eimer läuft über
 *    `reverses_id` → Art des Elternteils und ist dort geprüft (5.10). Eine
 *    eigene `sum(...)`-Abfrage hier wäre schneller und irgendwann anders — und
 *    „irgendwann anders" heißt: der Partner sieht einen Betrag, der
 *    Auszahlungslauf zahlt einen anderen. Aus demselben Grund wird der
 *    gesamte Bestand geladen und NICHT paginiert: PostgREST kappt still bei
 *    1000 Zeilen, und ein gekappter Saldo ist nicht „etwas zu klein", sondern
 *    falsch.
 *
 * 2. DER ENTWURF RESERVIERT IM `update` SELBST (G8). Keine vorgelagerte
 *    Prüfung, kein „lesen, dann schreiben" — Muster `markPayoutPaid()`
 *    (`src/lib/platform/marketplace.ts:561`). Zwei gleichzeitige Läufe greifen
 *    damit nie dieselbe Zeile: der erste stempelt sie, der zweite sieht sie
 *    nicht mehr und bekommt eine leere Menge zurück.
 *
 * 3. DIE SUMMEN DES BELEGS STAMMEN AUS DEN TATSÄCHLICH RESERVIERTEN ZEILEN,
 *    nie aus der Vorschau. Zwischen Vorschau und Reservierung kann eine
 *    Erstattung eine Zeile gegengebucht oder ein zweiter Lauf sie eingesammelt
 *    haben. Rechnete der Beleg mit der Vorschau, wiche er von seinem eigenen
 *    Inhalt ab — und genau diese Abweichung sucht der Kontrollabgleich (7.6).
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Seitengröße wie in `queries.ts`; PostgREST kappt bei 1000 ohne Fehlermeldung. */
const PAYOUT_PAGE_SIZE = 1000;

/** Vorgabe aus 7.1, falls das Programm keinen eigenen Mindestbetrag trägt. */
export const AFFILIATE_DEFAULT_MIN_PAYOUT_CENTS = 2500;

// --- Spaltenlisten ------------------------------------------------------

/** Genau die Spalten, die `computeBalances()` braucht (`AffiliateBalanceInput`). */
const BALANCE_COLUMNS =
  "id, partner_id, currency, kind, status, amount_cents, payout_id, reverses_id, is_test";

const PROGRAM_COLUMNS = "id, tenant_id, min_payout_cents, payout_schedule, currency";

/**
 * Partnerspalten für den Lauf. `user_id` ist dabei, weil G15 ihn braucht;
 * `applicant_email` und `internal_note` sind es nicht — ein Auszahlungslauf
 * hat mit beidem nichts zu tun.
 */
const PARTNER_COLUMNS = "id, program_id, status, payout_hold, display_name, company, user_id";

/**
 * Abrechnungsprofil. `tax_number` war hier bewusst nicht dabei — für den
 * Steuermodus ist sie unerheblich. Sie steht jetzt trotzdem in der Liste, und
 * zwar aus einem anderen Grund (Abnahme B8/B9, Befund 10): sie gehört zum
 * EINGEFRORENEN Empfänger auf dem Beleg (§ 14 Abs. 4 Nr. 2 UStG). Gelesen wird
 * sie ausschließlich in den Schnappschuss; sie verlässt den Server nur als
 * Bestandteil des Gutschrift-PDF.
 */
const BILLING_COLUMNS =
  "partner_id, entity_kind, legal_name, street, postal_code, city, country, " +
  "small_business, vat_id, tax_number, vat_check_result, vat_checked_at, payout_method, " +
  "account_holder, iban, bic, paypal_email";

const PAYOUT_COLUMNS =
  "id, tenant_id, program_id, partner_id, period_from, period_to, currency, " +
  "gross_cents, reversal_cents, subtotal_cents, tax_mode, tax_rate_bp, tax_cents, " +
  "total_cents, status, method, document_no, document_path, document_issued_at, " +
  "reverses_payout_id, reference, approved_at, paid_at, created_at, updated_at";

/**
 * `booked_at` ist dabei, weil der Leistungszeitraum des Belegs aus den
 * TATSÄCHLICH eingesammelten Zeilen kommt (Abnahme B8/B9, Befund 13) — nicht
 * aus dem Zeitraum, den jemand ins Formular geschrieben hat.
 */
const CLAIM_COLUMNS = "id, amount_cents, kind, booked_at";

// --- Zeilenformen -------------------------------------------------------

type ProgramRow = {
  id: string;
  tenant_id: string;
  min_payout_cents: number | null;
  payout_schedule: AffiliatePayoutSchedule;
  currency: string;
};

type PartnerRow = {
  id: string;
  program_id: string;
  status: string;
  payout_hold: boolean;
  display_name: string | null;
  company: string | null;
  user_id: string | null;
};

type BillingRow = {
  partner_id: string;
  entity_kind: AffiliateEntityKind | null;
  legal_name: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  small_business: boolean;
  vat_id: string | null;
  tax_number: string | null;
  vat_check_result: AffiliateVatCheckResult | null;
  vat_checked_at: string | null;
  payout_method: AffiliatePayoutMethod | null;
  account_holder: string | null;
  iban: string | null;
  bic: string | null;
  paypal_email: string | null;
};

// --- Sperrgründe --------------------------------------------------------

/**
 * Warum kein Entwurf entsteht (7.1). Der Partner sieht in seinem Bereich
 * genau diesen Grund als `role="alert"` samt Link auf das richtige Feld, der
 * Admin denselben unter „Nicht auszahlbar" — beide über denselben Schlüssel,
 * damit eine Rückfrage nicht an zwei Formulierungen desselben Problems hängt.
 */
export const AFFILIATE_PAYOUT_BLOCK_REASONS = [
  "negative_balance",
  "below_minimum",
  "partner_inactive",
  "payout_hold",
  "billing_profile_missing",
  "address_incomplete",
  "tax_entity_kind_missing",
  "tax_country_missing",
  "tax_private_entity",
  "tax_eu_vat_missing",
  "tax_vat_country_mismatch",
  "issuer_vat_id_missing",
  "foreign_currency",
  "payout_method_missing",
  "iban_invalid",
  "paypal_missing",
] as const;
export type AffiliatePayoutBlockReason = (typeof AFFILIATE_PAYOUT_BLOCK_REASONS)[number];

/** Die fünf Blockaden aus `tax.ts` in die Sprache des Auszahlungslaufs. */
const TAX_BLOCK_MAPPING: Record<AffiliateTaxBlockReason, AffiliatePayoutBlockReason> = {
  entity_kind_missing: "tax_entity_kind_missing",
  country_missing: "tax_country_missing",
  private_entity: "tax_private_entity",
  eu_vat_missing: "tax_eu_vat_missing",
  vat_country_mismatch: "tax_vat_country_mismatch",
};

/**
 * Das Feld, auf das der Partner klicken soll. `null`, wo es kein einzelnes
 * Feld gibt (gesperrtes Konto, Betrag unter dem Mindestbetrag) — dort wäre ein
 * Link ins Formular eine falsche Fährte.
 */
const BLOCK_FIELDS: Record<AffiliatePayoutBlockReason, string | null> = {
  negative_balance: null,
  below_minimum: null,
  partner_inactive: null,
  payout_hold: null,
  billing_profile_missing: "legal_name",
  address_incomplete: "street",
  tax_entity_kind_missing: "entity_kind",
  tax_country_missing: "country",
  tax_private_entity: "entity_kind",
  tax_eu_vat_missing: "vat_id",
  tax_vat_country_mismatch: "vat_id",
  // Nicht der Partner ist gemeint, sondern der Mandant: der Link ins
  // Partnerformular wäre eine falsche Fährte.
  issuer_vat_id_missing: null,
  foreign_currency: null,
  payout_method_missing: "payout_method",
  iban_invalid: "iban",
  paypal_missing: "paypal_email",
};

export type AffiliatePayoutBlocker = {
  partner_id: string;
  currency: string;
  available_cents: number;
  reason: AffiliatePayoutBlockReason;
  /** Feldname im Abrechnungsprofil für den Direktlink, sonst `null`. */
  field: string | null;
  messageKey: string;
};

function blocker(
  partnerId: string,
  currency: string,
  availableCents: number,
  reason: AffiliatePayoutBlockReason,
  field?: string,
): AffiliatePayoutBlocker {
  return {
    partner_id: partnerId,
    currency,
    available_cents: availableCents,
    reason,
    field: field ?? BLOCK_FIELDS[reason],
    messageKey: `affiliate.payoutRun.blocked.${reason}`,
  };
}

// --- Kandidaten ---------------------------------------------------------

/**
 * Der Empfänger, wie er auf dem Beleg steht (§ 14 Abs. 4 Nr. 1 und 2 UStG).
 *
 * Wird beim Entwurf aus dem Abrechnungsprofil gezogen und mit dem Beleg
 * eingefroren (`affiliate_payouts.recipient_snapshot`). Grund: das PDF ist nur
 * die Darstellung der eingefrorenen Zahlen, und eine Anschrift, die sich
 * zwischen Freigabe und Reparaturlauf ändert, machte aus derselben Belegnummer
 * zwei verschiedene Dokumente (Abnahme B8/B9, Befund 10).
 */
export type AffiliatePayoutRecipientSnapshot = {
  legal_name: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
  vat_id: string | null;
  tax_number: string | null;
};

export type AffiliatePayoutCandidate = {
  partner_id: string;
  program_id: string;
  currency: string;
  /** Saldo laut `computeBalances()` — die VORSCHAU, nicht die Belegsumme. */
  available_cents: number;
  tax_mode: AffiliateTaxMode;
  tax_rate_bp: number;
  /** Pflichtangabe auf dem Beleg, fester Wortlaut (7.4). */
  taxDocumentHint: string;
  method: AffiliatePayoutMethod;
  /** Nur für die Bestätigungsmaske („Sie zahlen … an … Partner aus."). */
  preview_total_cents: number;
  /** Anschrift und Steuerkennzeichen des Empfängers, zum Einfrieren (7.2). */
  recipient_snapshot: AffiliatePayoutRecipientSnapshot;
};

/**
 * Die USt-IdNr. des AUSSTELLERS aus `tenants.legal` (Abnahme B8/B9, Befund 5).
 *
 * Gelesen wird `legal.entity.vatId` (ersatzweise `legal.entity.vat_id` — beide
 * Schreibweisen kommen in gepflegten Mandantenzeilen vor). `resolveLegalEntity()`
 * bleibt unverändert zuständig für Name, Anschrift und Registernummer; die
 * USt-IdNr. steht bewusst nicht in dessen zod-Schema, weil sie für die
 * Rechtsseiten keine Rolle spielt und dort nichts verloren hat.
 *
 * WARUM DAS ZÄHLT: bei `reverse_charge` sind nach § 14a Abs. 5 UStG BEIDE
 * USt-IdNr. Pflichtangabe. Fehlt die des Ausstellers, ist die
 * Steuerschuldnerschaft des Leistungsempfängers formal nicht belegt — die
 * Befreiung wird versagt, und der Mandant schuldet 19 % auf jede so
 * abgerechnete Provision rückwirkend (§ 233a AO obendrauf). Deshalb ist der
 * Rückgabewert `null` ein SPERRGRUND und kein Gedankenstrich auf dem Beleg.
 */
export function resolveTenantVatId(legal: unknown): string | null {
  const entity = (legal as { entity?: unknown } | null | undefined)?.entity as
    | { vatId?: unknown; vat_id?: unknown }
    | null
    | undefined;
  if (entity === null || entity === undefined || typeof entity !== "object") return null;
  const raw = typeof entity.vatId === "string" ? entity.vatId : entity.vat_id;
  return normalizeVatId(typeof raw === "string" ? raw : null);
}

export type AffiliatePayoutRunPlan =
  | { ok: false; reason: "program_missing" | "tenant_legal_entity_missing" | "balances_incomplete" }
  | {
      ok: true;
      programId: string;
      minPayoutCents: number;
      legalEntity: LegalEntity;
      candidates: AffiliatePayoutCandidate[];
      blocked: AffiliatePayoutBlocker[];
    };

/**
 * Seitenweises Laden mit Ehrlichkeitsflagge — dieselbe Begründung wie in
 * `queries.ts`: ein halb geladener Saldo sieht genauso plausibel aus wie ein
 * richtiger, und hier entscheidet er über eine Überweisung.
 */
async function fetchAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ ok: boolean; rows: T[] }> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + PAYOUT_PAGE_SIZE - 1);
    if (error) {
      logDbError("Seitenweises Laden", error);
      return { ok: false, rows };
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAYOUT_PAGE_SIZE) break;
    from += PAYOUT_PAGE_SIZE;
  }
  return { ok: true, rows };
}

/**
 * Nur der SQLSTATE und der Vorgangsname ins Log. `error.message` von PostgREST
 * trägt bei einer Constraint-Verletzung den Schlüsselwert im Klartext — in
 * diesem Modul wären das IBAN, USt-IdNr. oder Belegnummer (CLAUDE.md §2.11).
 */
function logDbError(context: string, error: unknown): void {
  console.error(
    `[affiliate/payout] ${context} fehlgeschlagen (Code ${
      (error as { code?: string } | null)?.code ?? "unbekannt"
    }).`,
  );
}

function isFilled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Ermittelt, wer ausgezahlt werden kann und wer nicht — ohne etwas zu
 * verändern. Die Oberfläche zeigt damit die Vorschau, der Cron-Lauf reicht das
 * Ergebnis direkt an `createAffiliatePayoutDrafts()` weiter.
 *
 * `tenants.legal.entity` ist ein Gate für den GESAMTEN Lauf, nicht je Partner:
 * ohne Rechtsträger des Mandanten gibt es keinen Aussteller für die Gutschrift.
 * Dieselbe Logik wie das 404-Gate im Rechtsbereich — auf einer
 * White-Label-Domain darf nie das Impressum des Betreibers auf einem fremden
 * Beleg landen.
 */
export async function planAffiliatePayoutRun(
  admin: Admin,
  params: { tenantId: string; programId: string; now?: Date },
): Promise<AffiliatePayoutRunPlan> {
  const now = params.now ?? new Date();

  const { data: program, error: programError } = await admin
    .from("affiliate_programs")
    .select(PROGRAM_COLUMNS)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.programId)
    .maybeSingle<ProgramRow>();

  if (programError || program === null) return { ok: false, reason: "program_missing" };

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, legal")
    .eq("id", params.tenantId)
    .maybeSingle<{ id: string; legal: unknown }>();

  if (tenantError || tenant === null) return { ok: false, reason: "tenant_legal_entity_missing" };
  const legalEntity = resolveLegalEntity(tenant.legal);
  if (legalEntity === null) return { ok: false, reason: "tenant_legal_entity_missing" };
  const issuerVatId = resolveTenantVatId(tenant.legal);

  const minPayoutCents =
    typeof program.min_payout_cents === "number" && program.min_payout_cents > 0
      ? program.min_payout_cents
      : AFFILIATE_DEFAULT_MIN_PAYOUT_CENTS;

  // Der GESAMTE Bestand des Mandanten, nicht eine Seite: `computeBalances()`
  // löst Gegenbuchungen über ihr Elternteil auf und braucht dafür alle Zeilen
  // eines Partners. Fehlte eine, landete eine Gegenbuchung zu einer
  // Reserve-Zeile im Eimer „verfügbar" und würde ausgezahlt.
  const commissions = await fetchAll<AffiliateBalanceInput>((from, to) =>
    admin
      .from("affiliate_commissions")
      .select(BALANCE_COLUMNS)
      .eq("tenant_id", params.tenantId)
      // Abnahme B8/B9, Befund 11: OHNE diesen Filter erfasst der Lauf für
      // Programm A auch die Partner von Programm B — geprüft gegen den
      // Mindestbetrag von A, abgerechnet im Zeitraum von A, und Schritt 7 der
      // Freigabe schlösse anschließend die Bücher von B mit einem Zeitraum aus
      // dem Zeitplan von A.
      .eq("program_id", params.programId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
      data: AffiliateBalanceInput[] | null;
      error: unknown;
    }>,
  );
  if (!commissions.ok) return { ok: false, reason: "balances_incomplete" };

  const balances = computeBalances(commissions.rows);
  const partnerIds = [...new Set(balances.map((balance) => balance.partner_id))];

  if (partnerIds.length === 0) {
    return { ok: true, programId: program.id, minPayoutCents, legalEntity, candidates: [], blocked: [] };
  }

  const partners = await fetchAll<PartnerRow>((from, to) =>
    admin
      .from("affiliate_partners")
      .select(PARTNER_COLUMNS)
      .eq("tenant_id", params.tenantId)
      .eq("program_id", params.programId)
      .in("id", partnerIds)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: PartnerRow[] | null; error: unknown }>,
  );
  if (!partners.ok) return { ok: false, reason: "balances_incomplete" };

  const profiles = await fetchAll<BillingRow>((from, to) =>
    admin
      .from("affiliate_billing_profiles")
      .select(BILLING_COLUMNS)
      .eq("tenant_id", params.tenantId)
      .in("partner_id", partnerIds)
      .order("partner_id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: BillingRow[] | null; error: unknown }>,
  );
  if (!profiles.ok) return { ok: false, reason: "balances_incomplete" };

  const partnerById = new Map(partners.rows.map((row) => [row.id, row]));
  const profileByPartner = new Map(profiles.rows.map((row) => [row.partner_id, row]));

  const candidates: AffiliatePayoutCandidate[] = [];
  const blocked: AffiliatePayoutBlocker[] = [];

  for (const balance of balances) {
    const { partner_id: partnerId, currency, available_cents: available } = balance;

    // Nichts zu tun: kein Saldo, keine Meldung. Ein „0,00 € nicht auszahlbar"
    // in der Liste wäre Lärm, der die echten Fälle verdeckt.
    if (available === 0) continue;

    // WÄHRUNG VOR BETRAG (Abnahme B8/B9, Befund 12). `min_payout_cents` ist ein
    // Betrag in der Währung des PROGRAMMS. Ihn gegen einen Saldo in einer
    // anderen Währung zu halten, ist genau die Klasse „hier wird verglichen,
    // was nicht verglichen werden darf", gegen die G12/5.11 im ganzen Modul
    // sonst gearbeitet wird: 2.600 Rappen sind nicht 26,00 €, und ein
    // stillschweigender Kurs existiert im Plan bewusst nicht. Der Saldo bleibt
    // stehen und wird gemeldet, statt gegen eine fremde Schwelle geprüft zu
    // werden.
    if (currency !== program.currency) {
      blocked.push(blocker(partnerId, currency, available, "foreign_currency"));
      continue;
    }

    // Ein negativer Saldo erzeugt keinen Satz und keine Schuld: die Zeilen
    // bleiben `approved` ohne `payout_id` und verrechnen sich mit künftigen
    // Provisionen (5.10). Er wird trotzdem gemeldet, weil ein Partner sonst
    // monatelang auf eine Auszahlung wartet, die rechnerisch nicht kommt.
    if (available < 0) {
      blocked.push(blocker(partnerId, currency, available, "negative_balance"));
      continue;
    }

    if (available < minPayoutCents) {
      blocked.push(blocker(partnerId, currency, available, "below_minimum"));
      continue;
    }

    const partner = partnerById.get(partnerId);
    // `partner.program_id !== programId` kann nach dem Filter oben nur noch
    // auftreten, wenn eine Provisionszeile auf ein anderes Programm zeigt als
    // ihr Partner. Das wird VERWORFEN statt mitgenommen (Befund 11): ein Satz
    // mit der Programmkennung des Partners, aber den Konditionen des Laufs
    // wäre falsch belegt, und die Freigabe-RPC merkte nichts, weil beide Werte
    // bei ihr übereinstimmen.
    if (
      partner === undefined ||
      partner.program_id !== params.programId ||
      partner.status !== "active"
    ) {
      blocked.push(blocker(partnerId, currency, available, "partner_inactive"));
      continue;
    }
    if (partner.payout_hold === true) {
      blocked.push(blocker(partnerId, currency, available, "payout_hold"));
      continue;
    }

    const profile = profileByPartner.get(partnerId);
    if (profile === undefined) {
      blocked.push(blocker(partnerId, currency, available, "billing_profile_missing"));
      continue;
    }

    // Anschrift: alle vier Felder, und zwar in dieser Reihenfolge geprüft,
    // damit der Link genau auf das erste fehlende Feld zeigt.
    const addressField = (
      [
        ["legal_name", profile.legal_name],
        ["street", profile.street],
        ["postal_code", profile.postal_code],
        ["city", profile.city],
      ] as const
    ).find(([, value]) => !isFilled(value));
    if (addressField !== undefined) {
      blocked.push(
        blocker(partnerId, currency, available, "address_incomplete", addressField[0]),
      );
      continue;
    }

    const tax = resolveAffiliateTax(profile, available, now);
    if (!tax.ok) {
      blocked.push(blocker(partnerId, currency, available, TAX_BLOCK_MAPPING[tax.reason]));
      continue;
    }

    // FAIL-CLOSED für den Reverse Charge (Abnahme B8/B9, Befund 5). Ohne die
    // USt-IdNr. des Mandanten kann der Beleg die Pflichtangabe nach § 14a
    // Abs. 5 UStG nicht tragen — dann darf er gar nicht erst entstehen. Vorher
    // entstand er und trug an ihrer Stelle einen Gedankenstrich; auffallen
    // konnte das erst bei einer Betriebsprüfung.
    if (tax.tax_mode === "reverse_charge" && issuerVatId === null) {
      blocked.push(blocker(partnerId, currency, available, "issuer_vat_id_missing"));
      continue;
    }

    if (profile.payout_method === null) {
      blocked.push(blocker(partnerId, currency, available, "payout_method_missing"));
      continue;
    }
    if (profile.payout_method === "sepa" && !isValidIban(profile.iban)) {
      blocked.push(blocker(partnerId, currency, available, "iban_invalid"));
      continue;
    }
    if (profile.payout_method === "paypal" && !isFilled(profile.paypal_email)) {
      blocked.push(blocker(partnerId, currency, available, "paypal_missing"));
      continue;
    }

    candidates.push({
      partner_id: partnerId,
      program_id: params.programId,
      currency,
      available_cents: available,
      tax_mode: tax.tax_mode,
      tax_rate_bp: tax.tax_rate_bp,
      taxDocumentHint: tax.documentHint,
      method: profile.payout_method,
      preview_total_cents: tax.total_cents,
      // Die vier Anschriftsfelder sind oben bereits als nicht leer geprüft;
      // `String(...)` ist hier nur die Typverengung, kein zweiter Fallback.
      recipient_snapshot: {
        legal_name: String(profile.legal_name),
        street: String(profile.street),
        postal_code: String(profile.postal_code),
        city: String(profile.city),
        country: String(profile.country),
        vat_id: profile.vat_id,
        tax_number: profile.tax_number,
      },
    });
  }

  return { ok: true, programId: program.id, minPayoutCents, legalEntity, candidates, blocked };
}

// --- Entwurf ------------------------------------------------------------

export type AffiliatePayoutDraftOutcome =
  | { status: "created"; payout_id: string; partner_id: string; currency: string; subtotal_cents: number; total_cents: number; claimed_rows: number }
  | { status: "skipped"; partner_id: string; currency: string; reason: "no_rows" | "below_minimum_after_claim" | "non_positive_after_claim" }
  | {
      status: "failed";
      partner_id: string;
      currency: string;
      reason: "insert_failed" | "claim_failed" | "finalize_failed" | "cleanup_failed";
    };

const periodSchema = z.object({
  /** Abrechnungsperiode, ISO-Datum `JJJJ-MM-TT` (G14). */
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Wie weit ein Abrechnungszeitraum zurückreichen darf (7.1). */
export const AFFILIATE_PAYOUT_MAX_PERIOD_MONTHS = 24;

export type AffiliatePayoutPeriodProblem = "reversed" | "future" | "too_old";

/**
 * Grenzen des Abrechnungszeitraums (Abnahme B8/B9, Befund 7).
 *
 * Der Zeitraum kommt aus zwei Datumsfeldern der Oberfläche und war bis dahin
 * nur auf Form und Reihenfolge geprüft. Ein Vertipper („2099-12-31" statt
 * „2026-09-30") wanderte unverändert in `affiliate_payouts.period_to` und von
 * dort in Schritt 7 der Freigabe: `books_closed_until = greatest(…, period_to)`
 * schließt die Bücher des GESAMTEN Programms — und `greatest()` nimmt das nie
 * wieder zurück. Ab da datiert jede neue Provisionszeile um und trägt den
 * unveränderlichen Nachbuchungsvermerk. Nebenbei wäre der Leistungszeitraum
 * auf der Gutschrift nach § 14 Abs. 4 Nr. 6 UStG unbrauchbar.
 *
 * Rein rechnend, damit dieselbe Regel in der Server Action (für die Meldung an
 * den Menschen) und im Lauf selbst (als Sperre) gilt. Die dritte Linie steht in
 * `approve_affiliate_payout()`, wo alle Schreibwege vorbeikommen.
 */
export function checkAffiliatePayoutPeriodBounds(
  periodFrom: string,
  periodTo: string,
  now: Date = new Date(),
): AffiliatePayoutPeriodProblem | null {
  if (periodTo < periodFrom) return "reversed";
  const today = isoDate(now);
  if (periodTo > today) return "future";

  const earliest = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - AFFILIATE_PAYOUT_MAX_PERIOD_MONTHS,
      now.getUTCDate(),
    ),
  );
  if (periodFrom < isoDate(earliest)) return "too_old";
  return null;
}

/** Der Folgetag als ISO-Datum — die obere Grenze eines Zeitraums als Zeitpunkt. */
function nextIsoDay(iso: string): string {
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return iso;
  return isoDate(new Date(parsed + 86_400_000));
}

/**
 * Erzeugt je Kandidat einen Entwurf (7.1).
 *
 * Reihenfolge, und jeder Schritt hat seinen Grund:
 *
 *   1. Entwurfszeile mit NULLBETRÄGEN anlegen. Sie muss zuerst existieren,
 *      weil der Compare-and-Swap ihre `id` als Stempel braucht. Die CHECKs der
 *      Tabelle lassen diesen Zwischenstand ausdrücklich zu — aber NUR für
 *      `status = 'draft'` und erst seit der Abnahme B8/B9 (Befund 1): davor
 *      stand dort ein hartes `check (subtotal_cents > 0)`, an dem jeder Insert
 *      mit 23514 abbrach, während dieser Kommentar das Gegenteil behauptete.
 *      Wer die Migration ändert, ändert diesen Satz mit.
 *   2. Zeilen per Compare-and-Swap einsammeln — mit `currency` im Filter. OHNE
 *      diesen Filter landeten EUR und CHF in einem Satz mit genau einem
 *      Währungsfeld (5.11), und der Beleg wiese einen Betrag aus, den es in
 *      dieser Währung nie gab.
 *   3. Summen aus den EINGESAMMELTEN Zeilen bilden, Steuer darauf rechnen,
 *      Entwurf fortschreiben.
 *   4. Kommt nichts oder zu wenig zusammen, werden die Stempel wieder gelöst
 *      und die leere Entwurfszeile VERWORFEN (`status = 'cancelled'`, nie
 *      gelöscht). Ein Entwurf über 0,00 € wäre keine Auszahlung, sondern eine
 *      Belegnummer im Wartestand.
 */
export async function createAffiliatePayoutDrafts(
  admin: Admin,
  params: {
    tenantId: string;
    candidates: readonly AffiliatePayoutCandidate[];
    minPayoutCents: number;
    periodFrom: string;
    periodTo: string;
    createdBy?: string | null;
    /** Für die Zeitraumgrenzen; im Betrieb die Systemuhr. */
    now?: Date;
  },
): Promise<AffiliatePayoutDraftOutcome[]> {
  const { periodFrom, periodTo } = periodSchema.parse({
    periodFrom: params.periodFrom,
    periodTo: params.periodTo,
  });
  // Zweite Linie hinter der zod-Prüfung der Server Action (Befund 7): ein
  // Zeitraum, der in der Zukunft endet, schlösse beim Freigeben die Bücher des
  // Programms auf ein Datum, das nicht zurückzunehmen ist.
  const periodProblem = checkAffiliatePayoutPeriodBounds(
    periodFrom,
    periodTo,
    params.now ?? new Date(),
  );
  if (periodProblem !== null) {
    throw new Error(`createAffiliatePayoutDrafts: Abrechnungszeitraum unzulässig (${periodProblem}).`);
  }
  const outcomes: AffiliatePayoutDraftOutcome[] = [];

  for (const candidate of params.candidates) {
    const { data: draft, error: insertError } = await admin
      .from("affiliate_payouts")
      .insert({
        tenant_id: params.tenantId,
        program_id: candidate.program_id,
        partner_id: candidate.partner_id,
        period_from: periodFrom,
        period_to: periodTo,
        currency: candidate.currency,
        gross_cents: 0,
        reversal_cents: 0,
        subtotal_cents: 0,
        tax_mode: candidate.tax_mode,
        tax_rate_bp: candidate.tax_rate_bp,
        tax_cents: 0,
        total_cents: 0,
        status: "draft",
        method: candidate.method,
        created_by: params.createdBy ?? null,
        // Der Empfänger wird mit dem Beleg eingefroren (Befund 10). Das
        // Gutschrift-PDF liest ihn von hier und nicht live aus dem Profil —
        // sonst trüge ein PDF aus dem Reparaturlauf eine andere Anschrift als
        // eines vom Freigabetag.
        recipient_snapshot: candidate.recipient_snapshot,
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (insertError || draft === null) {
      logDbError("Anlegen eines Auszahlungsentwurfs", insertError);
      outcomes.push({
        status: "failed",
        partner_id: candidate.partner_id,
        currency: candidate.currency,
        reason: "insert_failed",
      });
      continue;
    }

    const { data: claimed, error: claimError } = await admin
      .from("affiliate_commissions")
      .update({ payout_id: draft.id })
      .eq("tenant_id", params.tenantId)
      .eq("partner_id", candidate.partner_id)
      // ZWINGEND — ohne diesen Filter landen EUR und CHF in einem Satz mit
      // genau einem Währungsfeld.
      .eq("currency", candidate.currency)
      .eq("status", "approved")
      .is("payout_id", null)
      // OBERGRENZE ALS ZEITPUNKT, nicht als Tag (Abnahme B8/B9, Befund 13).
      // `hold_until` ist `timestamptz`; Postgres liest 'JJJJ-MM-TT' als
      // Mitternacht. Mit `lte` fiel jede Zeile heraus, deren Sperrfrist am
      // letzten Tag des Zeitraums um 14:00 Uhr endete — für den Partner ein
      // unerklärlicher Monat Verzögerung. `lt` gegen den FOLGETAG nimmt den
      // ganzen letzten Tag mit.
      .lt("hold_until", `${nextIsoDay(periodTo)}T00:00:00.000Z`)
      .eq("is_test", false)
      .select(CLAIM_COLUMNS);

    if (claimError) {
      logDbError("Reservieren der Provisionszeilen", claimError);
      if (!(await cancelEmptyDraft(admin, params.tenantId, draft.id))) {
        outcomes.push(cleanupFailed(candidate));
        continue;
      }
      outcomes.push({
        status: "failed",
        partner_id: candidate.partner_id,
        currency: candidate.currency,
        reason: "claim_failed",
      });
      continue;
    }

    const rows = (claimed ?? []) as Array<{ amount_cents: number; booked_at?: string | null }>;
    if (rows.length === 0) {
      // Ein zweiter, gleichzeitig laufender Entwurf war schneller. Kein
      // Fehler: der andere Satz trägt die Zeilen, dieser wird verworfen.
      if (!(await cancelEmptyDraft(admin, params.tenantId, draft.id))) {
        outcomes.push(cleanupFailed(candidate));
        continue;
      }
      outcomes.push({
        status: "skipped",
        partner_id: candidate.partner_id,
        currency: candidate.currency,
        reason: "no_rows",
      });
      continue;
    }

    let gross = 0;
    let reversal = 0;
    let earliestBookedAt = periodFrom;
    for (const row of rows) {
      const amount = Math.trunc(Number(row.amount_cents) || 0);
      if (amount >= 0) gross += amount;
      else reversal += amount;
      // Der Leistungszeitraum des Belegs muss zu seinem INHALT passen
      // (§ 14 Abs. 4 Nr. 6 UStG, Befund 13). Liegengebliebene Zeilen — nach
      // einem Auszahlungsstopp oder einem unterschrittenen Mindestbetrag —
      // sind Monate älter als der Zeitraum des Laufs; der Beleg weist dann den
      // tatsächlich frühesten Buchungstag aus statt einer Angabe, die seinen
      // eigenen Positionen widerspricht.
      const bookedAt = typeof row.booked_at === "string" ? row.booked_at.slice(0, 10) : null;
      if (bookedAt !== null && bookedAt !== "" && bookedAt < earliestBookedAt) {
        earliestBookedAt = bookedAt;
      }
    }
    const subtotal = gross + reversal;

    if (subtotal <= 0 || subtotal < params.minPayoutCents) {
      // Zwischen Vorschau und Reservierung ist etwas dazwischengekommen (eine
      // Erstattung, ein paralleler Lauf). Stempel lösen, Entwurf verwerfen,
      // der Betrag wird vorgetragen (7.1).
      await releaseClaimedRows(admin, params.tenantId, draft.id);
      if (!(await cancelEmptyDraft(admin, params.tenantId, draft.id))) {
        outcomes.push(cleanupFailed(candidate));
        continue;
      }
      outcomes.push({
        status: "skipped",
        partner_id: candidate.partner_id,
        currency: candidate.currency,
        reason: subtotal <= 0 ? "non_positive_after_claim" : "below_minimum_after_claim",
      });
      continue;
    }

    const tax = taxForDraft(candidate, subtotal);

    const { error: finalizeError } = await admin
      .from("affiliate_payouts")
      .update({
        period_from: earliestBookedAt,
        gross_cents: gross,
        reversal_cents: reversal,
        subtotal_cents: subtotal,
        tax_cents: tax.tax_cents,
        total_cents: tax.total_cents,
      })
      .eq("id", draft.id)
      .eq("tenant_id", params.tenantId)
      .eq("status", "draft");

    if (finalizeError) {
      logDbError("Fortschreiben der Entwurfssummen", finalizeError);
      await releaseClaimedRows(admin, params.tenantId, draft.id);
      if (!(await cancelEmptyDraft(admin, params.tenantId, draft.id))) {
        outcomes.push(cleanupFailed(candidate));
        continue;
      }
      outcomes.push({
        status: "failed",
        partner_id: candidate.partner_id,
        currency: candidate.currency,
        reason: "finalize_failed",
      });
      continue;
    }

    outcomes.push({
      status: "created",
      payout_id: draft.id,
      partner_id: candidate.partner_id,
      currency: candidate.currency,
      subtotal_cents: subtotal,
      total_cents: tax.total_cents,
      claimed_rows: rows.length,
    });
  }

  return outcomes;
}

/**
 * Steuer auf die TATSÄCHLICHE Belegsumme, mit dem Satz, der beim Planen aus
 * dem Profil abgeleitet wurde.
 *
 * Der MODUS wird hier bewusst nicht neu ermittelt: zwischen Planung und
 * Reservierung darf ein Profilwechsel die Rechtsfolge desselben Vorgangs nicht
 * umdrehen. Gerechnet wird über `computeAffiliateTax()` — die einzige Stelle
 * mit kaufmännischer Rundung (G12), und deshalb auch die einzige, die diese
 * Formel kennt.
 */
function taxForDraft(
  candidate: AffiliatePayoutCandidate,
  subtotalCents: number,
): { tax_cents: number; total_cents: number } {
  const amounts = computeAffiliateTax(subtotalCents, candidate.tax_rate_bp);
  return { tax_cents: amounts.tax_cents, total_cents: amounts.total_cents };
}

/** Stempel lösen: `payout_id = null`, Status bleibt `approved` (G8, 7.7). */
async function releaseClaimedRows(
  admin: Admin,
  tenantId: string,
  payoutId: string,
): Promise<number> {
  const { data, error } = await admin
    .from("affiliate_commissions")
    .update({ payout_id: null })
    .eq("tenant_id", tenantId)
    .eq("payout_id", payoutId)
    .eq("status", "approved")
    .select("id");

  if (error) {
    logDbError("Freigeben reservierter Provisionszeilen", error);
    return 0;
  }
  return (data ?? []).length;
}

/** Ein nicht aufgeräumter Entwurf ist ein Fehlschlag des Laufs, keine Fußnote. */
function cleanupFailed(candidate: AffiliatePayoutCandidate): AffiliatePayoutDraftOutcome {
  return {
    status: "failed",
    partner_id: candidate.partner_id,
    currency: candidate.currency,
    reason: "cleanup_failed",
  };
}

/**
 * VERWIRFT eine Entwurfszeile, die nie Inhalt bekommen hat (Abnahme B8/B9,
 * Befund 3).
 *
 * Hier stand bis zur Abnahme ein `delete()`. Das konnte gar nicht
 * funktionieren: der Admin-Client läuft unter `service_role`, und
 * `affiliate_payouts_delete_guard()` lässt ausschließlich
 * 'postgres'/'supabase_admin' sowie Kaskaden (`pg_trigger_depth() > 1`) durch —
 * 'service_role' steht dort bewusst NICHT, und die Migration schreibt den
 * richtigen Weg ausdrücklich hin: „der normale Serverbetrieb loescht keinen
 * Beleg, auch keinen verworfenen Entwurf — der bekommt status = cancelled".
 *
 * Die Folge des alten Wegs war kein Schönheitsfehler, sondern eine Sackgasse:
 * der Fehler wurde nur protokolliert, die leere Entwurfszeile blieb stehen, und
 * `affiliate_payouts_open_draft_uniq` (ein offener Entwurf je Mandant, Partner
 * und Währung) ließ danach KEINEN weiteren Entwurf für diesen Partner mehr zu —
 * jeder Lauf endete mit 23505, gemeldet als `insert_failed`. Der Partner wurde
 * nie wieder ausgezahlt, und in der Liste stand ein 0,00-€-Entwurf, dem man das
 * nicht ansieht.
 *
 * Rückgabewert statt Protokolleintrag: ein nicht aufgeräumter Entwurf MUSS den
 * Lauf als `failed` melden, sonst wiederholt sich genau dieses stille Scheitern.
 */
async function cancelEmptyDraft(
  admin: Admin,
  tenantId: string,
  payoutId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("affiliate_payouts")
    .update({ status: "cancelled" })
    .eq("id", payoutId)
    .eq("tenant_id", tenantId)
    // Nur ein Entwurf ohne Nummer: ein Beleg wird NIE verworfen (7.7) — er
    // wird durch eine Stornogutschrift mit eigener Nummer neutralisiert. Der
    // Guard-Trigger kennt dieselbe Kante (draft -> cancelled) und ist die
    // verbindliche Grenze; dieser Filter ist die zweite Linie davor.
    .eq("status", "draft")
    .is("document_no", null)
    .select("id");

  if (error) {
    logDbError("Verwerfen eines leeren Entwurfs", error);
    return false;
  }
  return (data ?? []).length > 0;
}

// --- Freigabe -----------------------------------------------------------

export type AffiliatePayoutApproval =
  | { ok: true; payout_id: string; document_no: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_draft"
        | "actor_missing"
        | "self_approval"
        | "integrity_mismatch"
        | "integrity_unknown"
        | "rpc_failed";
    };

/**
 * Die Freigabe (7.2). Hier passiert das Unumkehrbare, und deshalb steht vor
 * der RPC eine Kette von vier Prüfungen:
 *
 *   1. Gibt es den Satz in DIESEM Mandanten? (CLAUDE.md §2.15 — nie
 *      `where id = :clientId` ohne Mandantenfilter.)
 *   2. Ist er noch `draft`? Ein zweiter Klick zieht sonst eine zweite
 *      Belegnummer für denselben Vorgang.
 *   3. G15: ein Manager gibt keine Auszahlung an sich selbst frei. Die Prüfung
 *      steht zusätzlich im Guard-Trigger und in `assertNoSelfApproval()` der
 *      Server Action — drei Linien, weil dieselbe Person sonst über ihr
 *      eigenes Geld entscheidet. Den AUDIT-Eintrag schreibt die Server Action;
 *      diese Funktion verweigert nur, damit sie ohne Protokoll-Client
 *      testbar bleibt.
 *   4. Kontrollabgleich (7.6): weicht die Positionssumme vom Belegkopf ab,
 *      wird nicht freigegeben. Der Bericht kann von außen hereingereicht
 *      werden — bei einer Stapelfreigabe über sechs Sätze soll der Mandant
 *      einmal geprüft werden, nicht sechsmal.
 *
 * Das PDF entsteht DANACH (7.2): erst Nummer und Status in einer Transaktion,
 * dann die Datei. Scheitert der Storage-Schreibvorgang, ist der Beleg trotzdem
 * gültig — die eingefrorenen Zahlen SIND der Beleg, die Datei ist nur ihre
 * deterministische Darstellung. Die umgekehrte Reihenfolge risse eine Lücke in
 * die Nummernfolge.
 */
export async function approveAffiliatePayout(
  admin: Admin,
  params: {
    tenantId: string;
    payoutId: string;
    /**
     * Der handelnde Mensch. PFLICHT (Abnahme B8/B9, Befund 2): die RPC verlangt
     * ihn seit Abweichung A4 und bricht ohne ihn mit
     * `affiliate_payout_actor_required` ab. Den früher dokumentierten
     * „Systemlauf ohne Interessenkonflikt" gibt es in der Datenbank nicht — er
     * ist hier gestrichen statt als `null` weitergereicht, weil ein Aufruf, den
     * die Datenbank ohnehin abweist, kein Aufrufmodus ist.
     */
    actorUserId: string;
    integrityReport?: AffiliateIntegrityReport;
  },
): Promise<AffiliatePayoutApproval> {
  if (typeof params.actorUserId !== "string" || params.actorUserId.trim() === "") {
    return { ok: false, reason: "actor_missing" };
  }

  const { data: payout, error } = await admin
    .from("affiliate_payouts")
    .select("id, tenant_id, partner_id, status, subtotal_cents, currency")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.payoutId)
    .maybeSingle<{ id: string; partner_id: string; status: string }>();

  if (error || payout === null) return { ok: false, reason: "not_found" };
  if (payout.status !== "draft") return { ok: false, reason: "not_draft" };

  {
    const { data: partner, error: partnerError } = await admin
      .from("affiliate_partners")
      .select("id, user_id")
      .eq("tenant_id", params.tenantId)
      .eq("id", payout.partner_id)
      .maybeSingle<{ id: string; user_id: string | null }>();

    // Fail-closed: ohne gelesene Partnerzeile wird nicht freigegeben. Der Text
    // ist derselbe wie für „gibt es nicht" (11.15, kein Enumeration-Leck).
    if (partnerError || partner === null) return { ok: false, reason: "not_found" };
    if (partner.user_id !== null && partner.user_id === params.actorUserId) {
      return { ok: false, reason: "self_approval" };
    }
  }

  const report =
    params.integrityReport ?? (await verifyAffiliateIntegrity(admin, params.tenantId));
  if (!report.ok) return { ok: false, reason: "integrity_unknown" };

  const mismatch = report.findings.some(
    (finding) =>
      finding.check === "payout_subtotal" &&
      finding.entity === "payout" &&
      finding.entity_id === params.payoutId,
  );
  if (mismatch) return { ok: false, reason: "integrity_mismatch" };

  // ALLE DREI PFLICHTARGUMENTE (Abnahme B8/B9, Befund 2). Die RPC prüft
  // `p_tenant_id` gegen die Zeile (CLAUDE.md §2.15: die Auszahlungskennung
  // kommt aus einem Formular) und `p_actor_user_id` gegen den Empfänger (G15).
  // Vorher ging nur `p_payout_id` hinaus; die beiden fehlenden Argumente sind
  // in der RPC mit `default null` deklariert, der Aufruf lief also durch und
  // brach erst innen mit `affiliate_payout_tenant_required` ab — jede Freigabe,
  // ausnahmslos. Die vorgelagerten Prüfungen oben ersetzen diese Argumente
  // NICHT: sie sind die erste Linie, die RPC die verbindliche.
  const { data, error: rpcError } = await admin.rpc("approve_affiliate_payout", {
    p_payout_id: params.payoutId,
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
  });

  if (rpcError) {
    logDbError("Freigabe-RPC", rpcError);
    return { ok: false, reason: "rpc_failed" };
  }

  const documentNo = extractDocumentNo(data);
  if (documentNo === null) {
    logDbError("Freigabe-RPC ohne Belegnummer", null);
    return { ok: false, reason: "rpc_failed" };
  }

  return { ok: true, payout_id: params.payoutId, document_no: documentNo };
}

/**
 * Die RPC liefert die Belegnummer je nach Rückgabeform als Zeichenkette, als
 * Objekt oder als einelementige Liste. Ohne Nummer gilt die Freigabe als
 * fehlgeschlagen — ein Beleg ohne Nummer ist kein Beleg.
 */
function extractDocumentNo(data: unknown): string | null {
  if (typeof data === "string" && data.trim() !== "") return data;
  const record = Array.isArray(data) ? data[0] : data;
  if (record !== null && typeof record === "object") {
    const value = (record as { document_no?: unknown }).document_no;
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

// --- Export, Überweisung, Fehlschlag ------------------------------------

export const affiliatePayoutReferenceSchema = z
  .string()
  .trim()
  .min(1, "Bitte eine Referenz aus dem Bankauszug eintragen.")
  .max(140)
  // Eine Bankreferenz ist eine Belegkennung, kein Freitext. Die
  // Erlaubnisliste ist enger als das Feld, weil der Wert später in eine CSV
  // und in ein PDF wandert.
  .regex(/^[A-Za-z0-9 \-_./:+]+$/, "Die Referenz enthält unzulässige Zeichen.");

export type AffiliatePayoutTransition =
  | { ok: true; payout_id: string; affected_rows: number }
  | { ok: false; reason: "not_found" | "wrong_status" | "write_failed" };

/** Statuswerte, aus denen heraus überwiesen oder abgebrochen werden kann. */
const PAYABLE_STATUSES = ["approved", "exported"];

/**
 * `approved → exported` (7.7). Eigener Schritt, damit sichtbar bleibt, welche
 * Sätze bereits in einer Bankdatei stehen — ein zweiter Export derselben Datei
 * ist sonst nicht von einer vergessenen Überweisung zu unterscheiden.
 */
export async function markAffiliatePayoutExported(
  admin: Admin,
  params: { tenantId: string; payoutIds: readonly string[] },
): Promise<{ ok: boolean; exported: string[] }> {
  if (params.payoutIds.length === 0) return { ok: true, exported: [] };

  const { data, error } = await admin
    .from("affiliate_payouts")
    .update({ status: "exported" })
    .eq("tenant_id", params.tenantId)
    .in("id", [...params.payoutIds])
    .eq("status", "approved")
    .select("id");

  if (error) {
    logDbError("Setzen auf exportiert", error);
    return { ok: false, exported: [] };
  }
  return { ok: true, exported: (data ?? []).map((row) => (row as { id: string }).id) };
}

/**
 * Nach dem Bankabgleich: Satz auf `paid`, dann die zugeordneten Zeilen (7.7).
 *
 * Reihenfolge ist Absicht. Der Satz wird per Compare-and-Swap umgestellt; nur
 * wenn dieser greift, werden die Zeilen angefasst. Andersherum stünden bei
 * einem Abbruch dazwischen Zeilen auf „ausgezahlt", zu denen kein bezahlter
 * Satz gehört — und die wären über `computeBalances()` aus dem Eimer
 * „verfügbar" verschwunden, ohne dass je Geld geflossen wäre.
 *
 * `paid_at` der Provisionszeilen setzt der Guard-Trigger selbst (G8, zweite
 * Hälfte); es wird hier bewusst nicht mitgeschickt.
 */
export async function markAffiliatePayoutPaid(
  admin: Admin,
  params: { tenantId: string; payoutId: string; reference: string; now?: Date },
): Promise<AffiliatePayoutTransition> {
  const reference = affiliatePayoutReferenceSchema.parse(params.reference);
  const nowIso = (params.now ?? new Date()).toISOString();

  const { data: updated, error } = await admin
    .from("affiliate_payouts")
    .update({ status: "paid", paid_at: nowIso, reference })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.payoutId)
    .in("status", PAYABLE_STATUSES)
    .select("id");

  if (error) {
    logDbError("Setzen auf bezahlt", error);
    return { ok: false, reason: "write_failed" };
  }
  if ((updated ?? []).length === 0) return { ok: false, reason: "wrong_status" };

  const { data: rows, error: rowError } = await admin
    .from("affiliate_commissions")
    .update({ status: "paid" })
    .eq("tenant_id", params.tenantId)
    .eq("payout_id", params.payoutId)
    .eq("status", "approved")
    .select("id");

  if (rowError) {
    // Der Satz steht bereits auf `paid`, die Zeilen nicht. Das ist genau der
    // Fall, den Gleichung 1 des Kontrollabgleichs sichtbar macht; ein stilles
    // `console.error` ohne Rückmeldung wäre hier der Fehler aus G1/G2.
    logDbError("Umstellen der Provisionszeilen auf bezahlt", rowError);
    return { ok: false, reason: "write_failed" };
  }

  // --- Benachrichtigung des Partners (B9, 7.7/10/B9) ---------------------
  // ERST JETZT, nachdem Satz UND Provisionszeilen auf `paid` stehen. Vor dem
  // zweiten Update wäre die Mail eine Ankündigung, die ein Abbruch zwischen
  // den beiden Anweisungen zur Falschaussage machte — und eine Mail nimmt
  // man nicht zurück. Fail-soft: `notifyAffiliatePayoutPaid()` wirft nie
  // (notify.ts, Regel 1); die Überweisung ist raus, daran ändert ein
  // Mailfehler nichts.
  await notifyAffiliatePayoutPaid(admin, {
    tenantId: params.tenantId,
    payoutId: params.payoutId,
  });

  return { ok: true, payout_id: params.payoutId, affected_rows: (rows ?? []).length };
}

export type AffiliatePayoutFailure =
  | {
      ok: true;
      payout_id: string;
      affected_rows: number;
      /** Der Status, aus dem heraus der Fehlschlag vermerkt wurde — fürs Protokoll. */
      previous_status: string;
      /**
       * Der Entwurf der Stornogutschrift. `null` heißt: er konnte NICHT
       * angelegt werden — dann steht ein Beleg mit ausgewiesener Steuer im
       * Bestand, dessen Leistung gleich noch einmal abgerechnet wird. Die
       * Oberfläche muss das sagen (7.7).
       */
      reversal_payout_id: string | null;
    }
  | {
      ok: false;
      reason: "not_found" | "wrong_status" | "write_failed" | "confirmation_mismatch";
    };

/** Belegnummern werden zum Vergleich auf ihre Form reduziert, nicht auf Gleichheit getippt. */
function normalizeDocumentNo(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/**
 * Die Überweisung ist fehlgeschlagen (7.7): Satz auf `failed`, die Zeilen
 * werden freigegeben (`payout_id = null`, Status bleibt `approved`) und laufen
 * in den nächsten Entwurf — und der ausgestellte Beleg bekommt SOFORT den
 * Entwurf seiner Stornogutschrift.
 *
 * ## WARUM DIE BESTÄTIGUNG (Abnahme B8/B9, Befund 16)
 *
 * `failed` ist im Beleg-Guard ein Endzustand: keine ausgehende Kante, kein Weg
 * zurück. Wer eine angekommene Überweisung im Kontoauszug falsch zuordnet und
 * hier klickt, gibt die Provisionszeilen frei, und der nächste Lauf zahlt
 * dieselbe Leistung ein zweites Mal aus. Deshalb muss die Belegnummer
 * eingetippt werden — dieselbe Schwelle wie bei den übrigen unumkehrbaren
 * Vorgängen des Projekts.
 *
 * ## WARUM DER STORNO-ENTWURF HIER ENTSTEHT (Befund 4)
 *
 * Der Kopf der Migration sagt dreimal zu, dass ein falscher Beleg durch eine
 * Stornogutschrift mit EIGENER Nummer neutralisiert wird. Bis zur Abnahme gab
 * es dafür weder Spalte noch Codepfad: die freigegebenen Zeilen liefen in einen
 * neuen Satz, bekamen eine zweite Gutschrift über denselben Betrag, und die
 * erste blieb mit ausgewiesener Umsatzsteuer stehen — nach § 14c Abs. 2 UStG
 * geschuldet, bis sie berichtigt ist, und berichtigen konnte das System nicht.
 * Der Entwurf entsteht deshalb im selben Vorgang, der die Zeilen freigibt; er
 * trägt die GESPIEGELTEN Summen und wird wie jeder andere Entwurf von einem
 * Menschen freigegeben, wobei er seine Nummer aus demselben Kreis zieht.
 */
export async function markAffiliatePayoutFailed(
  admin: Admin,
  params: {
    tenantId: string;
    payoutId: string;
    /** Die Belegnummer, wie sie der Mensch abgetippt hat (Befund 16). */
    confirmDocumentNo: string;
  },
): Promise<AffiliatePayoutFailure> {
  const { data: payout, error: readError } = await admin
    .from("affiliate_payouts")
    .select(
      "id, tenant_id, program_id, partner_id, period_from, period_to, currency, " +
        "gross_cents, reversal_cents, subtotal_cents, tax_mode, tax_rate_bp, tax_cents, " +
        "total_cents, status, method, document_no, reverses_payout_id, recipient_snapshot",
    )
    .eq("tenant_id", params.tenantId)
    .eq("id", params.payoutId)
    .maybeSingle<FailingPayoutRow>();

  if (readError) {
    logDbError("Lesen des Satzes vor dem Fehlschlag", readError);
    return { ok: false, reason: "write_failed" };
  }
  if (payout === null) return { ok: false, reason: "not_found" };
  if (!PAYABLE_STATUSES.includes(payout.status)) return { ok: false, reason: "wrong_status" };
  if (
    normalizeDocumentNo(payout.document_no) === "" ||
    normalizeDocumentNo(payout.document_no) !== normalizeDocumentNo(params.confirmDocumentNo)
  ) {
    return { ok: false, reason: "confirmation_mismatch" };
  }

  const { data: updated, error } = await admin
    .from("affiliate_payouts")
    .update({ status: "failed" })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.payoutId)
    .in("status", PAYABLE_STATUSES)
    .select("id");

  if (error) {
    logDbError("Setzen auf fehlgeschlagen", error);
    return { ok: false, reason: "write_failed" };
  }
  if ((updated ?? []).length === 0) return { ok: false, reason: "wrong_status" };

  const released = await releaseClaimedRows(admin, params.tenantId, params.payoutId);
  const reversalId = await createReversalDraft(admin, payout);

  return {
    ok: true,
    payout_id: params.payoutId,
    affected_rows: released,
    previous_status: payout.status,
    reversal_payout_id: reversalId,
  };
}

type FailingPayoutRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  partner_id: string;
  period_from: string;
  period_to: string;
  currency: string;
  gross_cents: number;
  reversal_cents: number;
  subtotal_cents: number;
  tax_mode: AffiliateTaxMode;
  tax_rate_bp: number;
  tax_cents: number;
  total_cents: number;
  status: string;
  method: AffiliatePayoutMethod | null;
  document_no: string | null;
  reverses_payout_id: string | null;
  recipient_snapshot: unknown;
};

/**
 * Der Entwurf der Stornogutschrift: alle Zahlen des Ursprungsbelegs mit
 * umgedrehtem Vorzeichen, derselbe Zeitraum, dieselbe Währung, derselbe
 * Steuermodus. Die Nummer zieht er erst bei seiner eigenen Freigabe (7.3) —
 * ein Entwurf verbrennt keine.
 *
 * Ein Storno auf einen Storno gibt es nicht: die Kette endet nach einem
 * Schritt, sonst neutralisiert irgendwann jemand eine Neutralisierung.
 */
async function createReversalDraft(admin: Admin, payout: FailingPayoutRow): Promise<string | null> {
  // Ohne Nummer gibt es keinen Beleg und damit nichts zu neutralisieren; ein
  // Storno auf einen Storno ist ausgeschlossen.
  if (payout.reverses_payout_id !== null) return null;
  if (normalizeDocumentNo(payout.document_no) === "") return null;

  const { data, error } = await admin
    .from("affiliate_payouts")
    .insert({
      tenant_id: payout.tenant_id,
      program_id: payout.program_id,
      partner_id: payout.partner_id,
      period_from: payout.period_from,
      period_to: payout.period_to,
      currency: payout.currency,
      gross_cents: -payout.gross_cents,
      reversal_cents: -payout.reversal_cents,
      subtotal_cents: -payout.subtotal_cents,
      tax_mode: payout.tax_mode,
      tax_rate_bp: payout.tax_rate_bp,
      tax_cents: -payout.tax_cents,
      total_cents: -payout.total_cents,
      status: "draft",
      method: payout.method,
      reverses_payout_id: payout.id,
      // Der Empfänger des Stornos ist der des Ursprungsbelegs — und zwar so,
      // wie er DORT eingefroren wurde, nicht wie er heute im Profil steht.
      recipient_snapshot: payout.recipient_snapshot ?? null,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || data === null) {
    logDbError("Anlegen des Storno-Entwurfs", error);
    return null;
  }
  return data.id;
}

// --- Fälligkeit ---------------------------------------------------------

export type AffiliatePayoutPeriod = {
  /** Ist heute ein Lauftag für diesen Plan (7.1)? */
  due: boolean;
  /** Abrechnungsperiode, ISO-Datum `JJJJ-MM-TT`, beide Grenzen inklusiv. */
  from: string;
  to: string;
};

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/**
 * Welcher Zeitraum wird heute abgerechnet (7.1)?
 *
 * „weekly montags, semi_monthly am 1. und 16., monthly am 1." — abgerechnet
 * wird immer die ABGESCHLOSSENE Periode davor, nie der laufende Tag. Eine
 * Periode, die bis heute reicht, würde Buchungen einsammeln, deren Sperrfrist
 * heute erst endet, und der Beleg wäre am Abend ein anderer als am Morgen.
 *
 * Gerechnet wird durchgehend in UTC. Das ist dieselbe Festlegung wie bei
 * `affiliate_stats_day()`, nur andersherum begründet: dort ging es um die
 * Zuordnung eines Klicks zu einem Tag, hier um die Grenze eines
 * Abrechnungszeitraums, und beide Male ist die wichtigste Eigenschaft, dass
 * sie sich nicht zweimal im Jahr um eine Stunde verschiebt.
 */
export function resolveAffiliatePayoutPeriod(
  schedule: AffiliatePayoutSchedule,
  now: Date = new Date(),
): AffiliatePayoutPeriod {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const weekday = now.getUTCDay(); // 0 = Sonntag

  if (schedule === "weekly") {
    // Montag: die Woche Montag bis Sonntag davor.
    const from = utcDate(year, month, day - 7);
    const to = utcDate(year, month, day - 1);
    return { due: weekday === 1, from: isoDate(from), to: isoDate(to) };
  }

  if (schedule === "semi_monthly") {
    if (day === 16) {
      // Am 16.: die erste Monatshälfte.
      return { due: true, from: isoDate(utcDate(year, month, 1)), to: isoDate(utcDate(year, month, 15)) };
    }
    // Am 1.: der 16. bis zum Monatsletzten des Vormonats. `utcDate(y, m, 0)`
    // ist der letzte Tag des Vormonats — auch im Februar eines Schaltjahrs.
    return {
      due: day === 1,
      from: isoDate(utcDate(year, month - 1, 16)),
      to: isoDate(utcDate(year, month, 0)),
    };
  }

  return {
    due: day === 1,
    from: isoDate(utcDate(year, month - 1, 1)),
    to: isoDate(utcDate(year, month, 0)),
  };
}

/** Die Spaltenliste für Oberflächen, die einen Auszahlungssatz vollständig zeigen. */
export const AFFILIATE_PAYOUT_COLUMNS = PAYOUT_COLUMNS;
