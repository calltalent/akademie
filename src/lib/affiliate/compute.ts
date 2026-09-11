/**
 * Affiliate-System, Block B1 — der Rechenkern (PLAN_Affiliate-System.md,
 * Abschnitte 5.1 bis 5.11, Grundsatzentscheidungen G3, G5, G6, G7, G12, G13).
 *
 * Diese Datei enthält AUSSCHLIESSLICH reine Funktionen: kein Supabase, kein
 * `import "server-only"`, kein `Date.now()`. Jeder Zeitpunkt wird
 * hereingereicht (`resolveCondition(..., { at })`), damit jede Zahl dieses
 * Moduls ohne Mock und ohne Systemuhr reproduzierbar ist — der Beleg, der aus
 * den Provisionszeilen entsteht, ist zehn Jahre aufbewahrungspflichtig und
 * muss aus den Daten nachrechenbar bleiben (G4).
 *
 * ABWEICHUNG vom Plan-Vorspann zu Abschnitt 5 („Der Prozentkern ist
 * `computeCommission()` aus `src/lib/marketplace/fulfil.ts:37-43` —
 * unverändert importiert, nicht kopiert"): dieser Import findet hier NICHT
 * statt. `fulfil.ts` beginnt mit `import "server-only"` und zieht über
 * `@/lib/supabase/admin`, `@/lib/email/client` und `next-intl/server` den
 * halben Serverbaum nach; ein Import machte compute.ts in jedem Client-Bundle
 * unbrauchbar (Build-Fehler) und widerspräche der Testbarkeitsforderung
 * desselben Absatzes („I/O-frei und ohne Supabase-Mock testbar"). Die
 * Prozentzeile `Math.floor((base * rate_bp) / 10000)` ist zudem nur die halbe
 * Funktion — `computeCommission()` liefert zusätzlich ein `netCents`, das hier
 * keine Bedeutung hat. Sie steht deshalb einmal in `percentOf()` und wird von
 * allen Schritten benutzt.
 *
 * Ganzzahlarithmetik durchgehend (G12): alle Beträge in Cent, alle Sätze in
 * Basispunkten, `Math.floor` in jedem Schritt — nie kaufmännisch, nie
 * gemischt. Eine gemischte Rundungsregel summiert sich über tausende
 * Buchungen zu unerklärbaren Differenzen. Die einzige Stelle mit
 * kaufmännischer Rundung im ganzen Modul ist der Steuerbetrag auf der
 * Gutschrift (7.4), und die liegt nicht in dieser Datei.
 */

import type {
  AffiliateBalanceInput,
  AffiliateBalances,
  AffiliateBasisKind,
  AffiliateCommissionKind,
  AffiliateConditionRow,
  AffiliateProgramRow,
  AffiliateRateKind,
  AffiliateTier2Basis,
} from "./types";
import { AFFILIATE_RESERVE_KINDS } from "./types";

// --- Ganzzahl-Hilfen ----------------------------------------------------

/**
 * Jede von außen kommende Zahl wird auf eine Ganzzahl gezwungen, bevor sie in
 * eine Geldrechnung geht. Die Werte stammen aus Stripe (dort bereits
 * Ganzzahl-Cent) und aus `int`-Spalten, aber `NaN`/`Infinity` aus einem
 * fehlerhaften JSON-Feld würde sich sonst lautlos durch jede Summe ziehen und
 * am Ende als `NaN` in einer Buchungszeile stehen.
 */
function toInt(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/**
 * Basispunkte auf `0..10000` klammern — dieselbe Verteidigungslinie wie
 * `fulfil.ts:212` (dort für `tenants.settings`, ein JSONB ohne CHECK). Die
 * DB-CHECKs auf `rate_bp`, `tier2_rate_bp`, `reserve_bp` und
 * `fee_deduction_bp` greifen zusätzlich; die Klammer hier stellt sicher, dass
 * eine Rechenfunktion niemals einem Wert vertrauen MUSS, den sie nicht selbst
 * geprüft hat (Plan 5.2, wörtlich: „auch wenn CHECK-Constraints greifen").
 */
function clampBp(value: number): number {
  return Math.min(Math.max(toInt(value), 0), 10_000);
}

/**
 * Der Prozentkern (5.3): `floor(betrag * bp / 10000)`. Beide Faktoren sind
 * hier unkritisch für die Zahlengenauigkeit — ein Cent-Betrag mal höchstens
 * 10 000 bleibt weit unter `Number.MAX_SAFE_INTEGER`. Für das Storno gilt das
 * NICHT (dort werden zwei Cent-Beträge multipliziert), siehe
 * `computeReversalDelta()`.
 */
function percentOf(amountCents: number, bp: number): number {
  return Math.floor((amountCents * bp) / 10_000);
}

// --- Schritt 1: Bemessungsgrundlage (5.1) -------------------------------

export type AffiliateBaseInput = {
  /**
   * Tatsächlich vereinnahmter Bruttobetrag (G13): `session.amount_total` beim
   * Einmalkauf, `invoice.amount_paid` bei der Abo-Rate — NIE `invoice.total`.
   * Wird ein Kundenguthaben angerechnet, zahlte der Händler sonst Provision
   * auf Geld, das nie geflossen ist.
   */
  gross_cents: number;
  /**
   * Ausgewiesene Umsatzsteuer, roh:
   * `session.total_details.amount_tax` bzw. die Summe über
   * `invoice.total_taxes[].amount` (stripe ^18 hat kein `invoice.tax` mehr).
   */
  tax_cents: number;
  /** `session.total_details.amount_shipping`; bei einer Abo-Rate immer 0. */
  shipping_cents: number;
  /**
   * `invoice.total` — NUR setzen, wenn sich `tax_cents` auf diesen
   * Gesamtbetrag bezieht und `gross_cents` (`amount_paid`) davon abweicht.
   * Dann wird die Steuer anteilig gekürzt (5.1), sonst bliebe bei einem
   * angerechneten Guthaben die volle Steuer eines höheren Rechnungsbetrags
   * von einem kleineren Zahlbetrag abgezogen. Beim Einmalkauf `null`.
   */
  invoice_total_cents?: number | null;
  basis_kind: AffiliateBasisKind;
  fee_deduction_bp: number;
};

export type AffiliateBaseResult = {
  gross_cents: number;
  /** Nach der anteiligen Kürzung aus 5.1; ohne `invoice_total_cents` unverändert. */
  tax_cents: number;
  shipping_cents: number;
  /** Der abgezogene Anteil aus `fee_deduction_bp`, für den Beleg getrennt ausgewiesen. */
  fee_deduction_cents: number;
  /**
   * Die Bemessungsgrundlage. Ist sie `0`, entsteht eine Zeile mit
   * `amount_cents = 0`, `status='cancelled'`, `cancel_reason='zero_amount'`
   * (5.1) — sichtbar, aber wertlos. Das deckt Trial-Start und
   * 100-%-Gutschein ohne Sonderlogik ab.
   */
  base_cents: number;
};

export function computeBaseCents(input: AffiliateBaseInput): AffiliateBaseResult {
  const gross = Math.max(0, toInt(input.gross_cents));
  const shipping = Math.max(0, toInt(input.shipping_cents));
  const rawTax = Math.max(0, toInt(input.tax_cents));

  const invoiceTotal = input.invoice_total_cents ?? null;
  // Anteilige Steuer nur im Rechnungsfall (5.1): floor(steuer * brutto / max(total, 1)).
  // Zusätzlich auf die ausgewiesene Rohsteuer gedeckelt — läge `amount_paid`
  // über `invoice.total` (Stripe erzeugt das nicht, ein fehlerhafter
  // Nachhol-Lauf könnte es), zöge die Formel mehr Steuer ab als je
  // ausgewiesen wurde und machte die Basis kleiner als das echte Netto.
  const tax =
    invoiceTotal === null
      ? rawTax
      : Math.min(rawTax, Math.floor((rawTax * gross) / Math.max(toInt(invoiceTotal), 1)));

  // `max(0, ...)` auch im Fall `gross`: die Basis darf nie negativ in die
  // Satzrechnung gehen, sonst entstünde eine negative `sale`-Zeile ohne
  // Gegenbuchung. Der Fall „Basis <= 0" bleibt daran erkennbar, dass
  // `base_cents === 0` ist.
  const base0 =
    input.basis_kind === "gross" ? gross : Math.max(0, gross - tax - shipping);
  const feeCents = percentOf(base0, clampBp(input.fee_deduction_bp));

  return {
    gross_cents: gross,
    tax_cents: tax,
    shipping_cents: shipping,
    fee_deduction_cents: feeCents,
    base_cents: base0 - feeCents,
  };
}

// --- Schritt 2: Satz auflösen (5.2) -------------------------------------

/**
 * Eine Kondition, wie `resolveCondition()` sie braucht. Bewusst ohne die
 * generierte Spalte `specificity`: die Rangzahl wird hier aus dem
 * Geltungsbereich neu gebildet (Partner 20 + Gruppe 10 + Produkt 5, identisch
 * zu 3.5). Damit ist die Vorrangkette an genau einer Stelle im TypeScript
 * prüfbar, ohne dass ein Test einen DB-generierten Wert von Hand nachbilden
 * und dabei falsch setzen könnte.
 */
export type AffiliateConditionCandidate = Pick<
  AffiliateConditionRow,
  | "id"
  | "partner_id"
  | "group_id"
  | "product_id"
  | "rate_kind"
  | "rate_bp"
  | "fixed_cents"
  | "valid_from"
  | "valid_to"
>;

export type AffiliateRateContext = {
  partner_id: string;
  /** Gruppe des Partners, `null` wenn er keiner angehört. */
  group_id: string | null;
  /** Gekauftes Produkt, `null` wenn die Buchung keinem Produkt zuzuordnen ist. */
  product_id: string | null;
  /**
   * `event.occurred_at`, NICHT `now()` (5.2): zwischen dem Ereignis bei
   * Stripe und seiner Verarbeitung können bei einem Retry Tage liegen, und
   * eine befristete Aktionskondition gilt nach dem Kaufzeitpunkt, nicht nach
   * dem Verarbeitungszeitpunkt.
   */
  at: Date;
};

export type AffiliateRateResolution = {
  /** `null` = kein Treffer, es gilt der Programmstandard. */
  condition_id: string | null;
  source: "condition" | "program_default";
  rate_kind: AffiliateRateKind;
  /** Bereits auf `0..10000` geklammert. */
  rate_bp: number;
  fixed_cents: number;
  /** Rangzahl des Treffers; Programmstandard ist 0. Nur für Beleg und Test. */
  specificity: number;
};

/** Rangzahl exakt wie die generierte Spalte in 3.5. */
function specificityOf(candidate: AffiliateConditionCandidate): number {
  return (
    (candidate.partner_id !== null ? 20 : 0) +
    (candidate.group_id !== null ? 10 : 0) +
    (candidate.product_id !== null ? 5 : 0)
  );
}

/**
 * Vorrangkette aus 5.2, angewandt auf bereits nach `tenant_id`/`program_id`
 * gefilterte Konditionen. Die Auswahl steht absichtlich zweimal — als
 * `order by specificity desc, valid_from desc, id limit 1` in der Abfrage und
 * als reine Funktion hier —, weil nur die reine Funktion die sechs
 * Spezifitätsstufen und die Fenstergrenzen ohne Datenbank prüfbar macht.
 *
 * Reihenfolge der Kriterien, wörtlich wie in 5.2:
 *   1. `specificity` absteigend (Partner+Produkt 25 > Partner 20 >
 *      Gruppe+Produkt 15 > Gruppe 10 > Produkt 5 > Programmstandard),
 *   2. `valid_from` absteigend — damit schlägt eine befristete
 *      Aktionskondition eine dauerhafte Regel gleicher Spezifität,
 *   3. `id` aufsteigend als letzte, stabile Entscheidung. Der lexikografische
 *      Vergleich kanonisch klein geschriebener UUIDs entspricht der
 *      Byte-Ordnung, nach der Postgres `uuid` sortiert.
 */
export function resolveCondition(
  candidates: readonly AffiliateConditionCandidate[],
  context: AffiliateRateContext,
  programDefault: Pick<AffiliateProgramRow, "rate_kind" | "rate_bp" | "fixed_cents">,
): AffiliateRateResolution {
  const atMs = context.at.getTime();

  const matching = candidates.filter((candidate) => {
    if (candidate.partner_id !== null && candidate.partner_id !== context.partner_id) return false;
    if (candidate.group_id !== null && candidate.group_id !== context.group_id) return false;
    if (candidate.product_id !== null && candidate.product_id !== context.product_id) return false;

    // Zeitfenster: `valid_from <= at < valid_to`. Ein unlesbares Datum ergibt
    // `NaN`, jeder Vergleich damit ist `false` — die Kondition fällt heraus,
    // statt mit einem stillen Standardwert zu gelten.
    const fromMs = Date.parse(candidate.valid_from);
    if (!(fromMs <= atMs)) return false;
    if (candidate.valid_to !== null) {
      const toMs = Date.parse(candidate.valid_to);
      if (!(toMs > atMs)) return false;
    }
    return true;
  });

  const best = matching.reduce<AffiliateConditionCandidate | null>((winner, candidate) => {
    if (winner === null) return candidate;
    const bySpecificity = specificityOf(candidate) - specificityOf(winner);
    if (bySpecificity !== 0) return bySpecificity > 0 ? candidate : winner;
    const byValidFrom = Date.parse(candidate.valid_from) - Date.parse(winner.valid_from);
    if (byValidFrom !== 0) return byValidFrom > 0 ? candidate : winner;
    return candidate.id < winner.id ? candidate : winner;
  }, null);

  if (best === null) {
    return {
      condition_id: null,
      source: "program_default",
      rate_kind: programDefault.rate_kind,
      rate_bp: clampBp(programDefault.rate_bp),
      fixed_cents: Math.max(0, toInt(programDefault.fixed_cents)),
      specificity: 0,
    };
  }

  return {
    condition_id: best.id,
    source: "condition",
    rate_kind: best.rate_kind,
    rate_bp: clampBp(best.rate_bp),
    fixed_cents: Math.max(0, toInt(best.fixed_cents)),
    specificity: specificityOf(best),
  };
}

// --- Schritte 3, 4 und 6 (erste Stufe): Betrag, Aufteilung, Deckel ------

export type AffiliateCommissionPartsInput = {
  base_cents: number;
  rate_kind: AffiliateRateKind;
  rate_bp: number;
  fixed_cents: number;
  /** `affiliate_programs.min_commission_cents`, `null` = keine Untergrenze. */
  min_commission_cents: number | null;
  /** `affiliate_programs.max_commission_cents`, `null` = keine Obergrenze. */
  max_commission_cents: number | null;
  /** `affiliate_programs.reserve_bp`; `0` erzeugt keine Reserve-Zeile. */
  reserve_bp: number;
};

export type AffiliateCommissionParts = {
  /** Gesamtprovision der ersten Stufe = `sale_cents + reserve_cents`. */
  amount_cents: number;
  /** Betrag der `sale`- bzw. `recurring`-Zeile (`hold_until = at + hold_days`). */
  sale_cents: number;
  /**
   * Betrag der `reserve`- bzw. `recurring_reserve`-Zeile
   * (`hold_until = at + reserve_days`). Bei `0` wird keine zweite Zeile
   * geschrieben (5.4).
   */
  reserve_cents: number;
  /** `true`, wenn die Basis `<= 0` war: Zeile mit `cancel_reason='zero_amount'` (5.1). */
  zero_base: boolean;
  /** Deckel aus 5.6 hat gegriffen — Zeile wird mit `flagged=true` geschrieben. */
  flagged: boolean;
  flag_reason: "rate_exceeds_base" | null;
};

/**
 * Schritt 3 (Betrag), Schritt 4 (Aufteilung in `sale` und `reserve`) und die
 * erste Hälfte von Schritt 6 (Gesamtdeckel) in einem Zug. Die zweite Hälfte
 * des Deckels — die Kürzung der Zweitstufe auf `base - betrag` — steckt in
 * `computeTier2Cents()`, weil nur dort beide Größen zusammenkommen.
 *
 * Gerundet wird je Bestellung, nicht je Position: die ganze Checkout-Session
 * ist eine Basis und ein Rundungsschritt. Positionsweise Rundung erzeugt
 * Cent-Drift ohne Nutzen (5.3).
 */
export function computeCommissionParts(
  input: AffiliateCommissionPartsInput,
): AffiliateCommissionParts {
  const base = toInt(input.base_cents);

  if (base <= 0) {
    return {
      amount_cents: 0,
      sale_cents: 0,
      reserve_cents: 0,
      zero_base: true,
      flagged: false,
      flag_reason: null,
    };
  }

  const rateBp = clampBp(input.rate_bp);
  const fixedCents = Math.max(0, toInt(input.fixed_cents));

  // Schritt 3: Rohbetrag. `fixed` wird an der Basis gedeckelt — eine feste
  // Provision von 5,00 EUR auf eine Bestellung über 3,00 EUR ist keine
  // Ausnahme, sondern der Normalfall bei kleinen Bestellungen und wird
  // still gekürzt (5.3), nicht markiert.
  let amount = input.rate_kind === "percent" ? percentOf(base, rateBp) : Math.min(fixedCents, base);

  // Unter- vor Obergrenze, exakt in dieser Reihenfolge (5.3): die Untergrenze
  // gilt selbst nur bis zur Basis, die Obergrenze schneidet danach ab.
  if (input.min_commission_cents !== null) {
    amount = Math.max(amount, Math.min(toInt(input.min_commission_cents), base));
  }
  if (input.max_commission_cents !== null) {
    amount = Math.min(amount, Math.max(0, toInt(input.max_commission_cents)));
  }

  // Schritt 6, erste Hälfte: `betrag <= base`. Mit der Klammer auf `rate_bp`
  // (5.2), dem `min(fixed_cents, base)` und der an der Basis gedeckelten
  // Untergrenze ist dieser Zweig heute nicht erreichbar. Er steht trotzdem
  // hier, weil 5.6 eine PRÜFUNG vor dem Schreiben verlangt und keine Annahme:
  // käme der Satz später aus einer anderen Quelle (Import, API v1), schlüge
  // ein Fehler sonst still als überhöhte Provision durch.
  let flagged = false;
  if (amount > base) {
    amount = base;
    flagged = true;
  }

  // Schritt 4: Subtraktion statt zweiter Floor-Rechnung, damit kein Cent
  // zwischen `sale` und `reserve` verloren geht.
  const reserveCents = percentOf(amount, clampBp(input.reserve_bp));

  return {
    amount_cents: amount,
    sale_cents: amount - reserveCents,
    reserve_cents: reserveCents,
    zero_base: false,
    flagged,
    flag_reason: flagged ? "rate_exceeds_base" : null,
  };
}

// --- Schritt 5: Zweite Stufe (5.5), mit Deckel aus 5.6 ------------------

export type AffiliateTier2Input = {
  /** `affiliate_programs.tier2_enabled`. */
  enabled: boolean;
  /**
   * `partner.referred_by` ist gesetzt UND der Werber hat `status='active'`
   * (5.5). Beides prüft der Aufrufer beim Laden des Werbers; hier steht es
   * als ein Schalter, damit die Regel nicht in jeder Aufrufstelle neu
   * formuliert wird.
   */
  referrer_active: boolean;
  /**
   * Art der Ursprungszeile. Eine Zweitstufe entsteht nur zu `sale` und
   * `recurring`, nie zu einer `tier2`-Zeile — es gibt genau eine Stufe, und
   * diese Grenze ist eine Codeeigenschaft und kein Konfigurationsschalter,
   * der versehentlich umgelegt werden könnte (5.5).
   */
  parent_kind: AffiliateCommissionKind;
  basis: AffiliateTier2Basis;
  rate_bp: number;
  /** Bemessungsgrundlage der Ursprungszeile. */
  base_cents: number;
  /** Gesamtprovision der ersten Stufe (`AffiliateCommissionParts.amount_cents`). */
  commission_cents: number;
};

/**
 * Betrag der `tier2`-Zeile in Cent, `0` wenn keine entsteht.
 *
 * Der Händler trägt die zweite Stufe ZUSÄTZLICH; sie kürzt die erste nicht.
 * Alles andere wäre eine verdeckte Kürzung, die kein Partner akzeptiert
 * (5.5). Gedeckelt wird deshalb ausschließlich die Zweitstufe, und zwar auf
 * den Rest der Basis (5.6) — ohne diesen Deckel addieren sich
 * Affiliate-Satz, Zweitstufe und die Marketplace-Provision des Betreibers
 * (Default 2000 bp) ungeprüft, und der Mandant zahlt bei jedem Verkauf drauf.
 */
export function computeTier2Cents(input: AffiliateTier2Input): number {
  if (!input.enabled || !input.referrer_active) return 0;
  if (input.parent_kind !== "sale" && input.parent_kind !== "recurring") return 0;

  const base = Math.max(0, toInt(input.base_cents));
  const commission = Math.max(0, toInt(input.commission_cents));
  const rateBp = clampBp(input.rate_bp);

  const raw = input.basis === "commission" ? percentOf(commission, rateBp) : percentOf(base, rateBp);

  // Schritt 6, zweite Hälfte: `betrag + t2 <= base`.
  const headroom = Math.max(0, base - commission);
  return Math.min(raw, headroom);
}

// --- Schritt 8: Storno und Wiedergutschrift (5.8, G7) -------------------

export type AffiliateReversalInput = {
  /** Betrag der zu stornierenden Ursprungszeile (positiv). */
  amount_cents: number;
  /**
   * `charge.amount_refunded` — der GESAMTE bisher erstattete Betrag, nicht
   * das Delta dieses Ereignisses (G7, belegt in
   * `node_modules/stripe/types/Charges.d.ts:35`).
   */
  refunded_total_cents: number;
  /** Bruttobetrag des Charge, auf den sich die Erstattung bezieht. */
  charge_total_cents: number;
  /**
   * Summe der bereits gebuchten Gegenbuchungen zu dieser Zeile, als POSITIVE
   * Zahl (`-1 * sum(amount_cents)` über die `reversal`-Zeilen mit
   * `reverses_id = zeile.id`).
   */
  already_reversed_cents: number;
};

export type AffiliateReversalDelta = {
  /** Der Zielwert: so viel soll insgesamt storniert sein. */
  target_cents: number;
  /** `ziel - bereits`; `<= 0` bedeutet: nichts buchen. */
  delta_cents: number;
  /** Der zu buchende, NEGATIVE Betrag der `reversal`-Zeile; `0` wenn nichts zu buchen ist. */
  amount_cents: number;
  should_book: boolean;
};

/**
 * Zielwert-Verfahren nach G7, anzuwenden auf JEDE betroffene Zeile einzeln
 * (`sale`, `reserve`, `recurring`, `recurring_reserve`, `tier2`).
 *
 * Warum ein Zielwert und kein Deckel auf 100 %: `charge.amount_refunded` ist
 * kumulativ. Zwei Teilerstattungen von je 20 % ergäben mit einem reinen
 * Deckel 60 % Storno. Der Zielwert hat zusätzlich den Nebeneffekt, dass bei
 * vollständiger Erstattung `kumulativ = charge_betrag` gilt, der Zielwert
 * exakt dem Ursprungsbetrag entspricht und kein Rundungsrest im Buch stehen
 * bleibt.
 *
 * Weil Basis und Erstattung beide Bruttogrößen desselben Charge sind, ist das
 * Verhältnis automatisch korrekt, auch wenn die Erstattung anteilig
 * Umsatzsteuer enthält (5.8).
 */
export function computeReversalDelta(input: AffiliateReversalInput): AffiliateReversalDelta {
  const amount = toInt(input.amount_cents);
  const chargeTotal = toInt(input.charge_total_cents);
  const alreadyReversed = Math.max(0, toInt(input.already_reversed_cents));

  const nothing: AffiliateReversalDelta = {
    target_cents: 0,
    delta_cents: 0,
    amount_cents: 0,
    should_book: false,
  };

  // Ohne positiven Charge-Betrag gibt es kein Verhältnis; eine Division durch
  // 0 ergäbe `Infinity` und daraus eine unbegrenzte Gegenbuchung.
  if (amount <= 0 || chargeTotal <= 0) return nothing;

  // Auf den Charge-Betrag gedeckelt: mehr als der Charge kann nicht erstattet
  // werden, ein größerer Wert wäre ein Datenfehler und ergäbe ein Ziel über
  // dem Ursprungsbetrag.
  const refunded = Math.min(Math.max(0, toInt(input.refunded_total_cents)), chargeTotal);

  // BigInt, weil hier als einziger Stelle des Moduls zwei CENT-Beträge
  // multipliziert werden und keiner der beiden Faktoren durch den Code
  // begrenzt ist — `percentOf()` multipliziert mit höchstens 10 000, hier
  // hängt die Obergrenze allein am Charge. Das Produkt übersteigt
  // `Number.MAX_SAFE_INTEGER` (9 007 199 254 740 991) ab einem Charge von
  // rund 1 000 000,00 EUR, und dann kippt das `floor` nachweislich: bei
  // Charge 99 999 999, Vollerstattung und einer Zeile über 99 999 995 Cent
  // liefert die Gleitkommarechnung 99 999 994 statt 99 999 995 — genau der
  // Restcent, den das Zielwert-Verfahren nach G7 ausschließen soll. Der Fall
  // steht als Test in `compute.test.ts`. Beide Operanden sind nicht-negativ,
  // die BigInt-Division schneidet deshalb nach unten ab und ist damit
  // dasselbe `floor` wie überall sonst.
  const target = Number(
    (BigInt(amount) * BigInt(refunded)) / BigInt(chargeTotal),
  );
  const delta = target - alreadyReversed;

  if (delta <= 0) return { target_cents: target, delta_cents: delta, amount_cents: 0, should_book: false };

  return { target_cents: target, delta_cents: delta, amount_cents: -delta, should_book: true };
}

// --- Salden (5.10) ------------------------------------------------------

const RESERVE_KINDS: ReadonlySet<AffiliateCommissionKind> = new Set(AFFILIATE_RESERVE_KINDS);

/**
 * Wie viele Ebenen `reverses_id` höchstens verfolgt werden. Zwei genügen für
 * den einzigen echten Fall (`recredit` → `reversal` → Ursprungszeile); die
 * Grenze steht gegen einen Zyklus in fehlerhaften Daten, der die Schleife
 * sonst nie verlassen würde.
 */
const REVERSAL_CHAIN_LIMIT = 8;

/**
 * Die Eimer-Zuordnung einer Zeile: eine Gegenbuchung gehört in den Eimer
 * ihres Elternteils. Eine Gegenbuchung zu einer Reserve-Zeile zählt zur
 * Reserve, nicht zu „offen" — sonst sänke der offene Saldo um einen Betrag,
 * der nie offen war, während die Reserve unverändert stehen bliebe.
 *
 * Findet sich das Elternteil nicht in der übergebenen Menge, bleibt es bei
 * der eigenen Art. Der Aufrufer muss deshalb IMMER alle Zeilen eines Partners
 * übergeben und nicht eine Seite davon.
 */
function effectiveKind(
  row: AffiliateBalanceInput,
  byId: ReadonlyMap<string, AffiliateBalanceInput>,
): AffiliateCommissionKind {
  let current = row;
  for (let depth = 0; depth < REVERSAL_CHAIN_LIMIT; depth += 1) {
    if (current.kind !== "reversal" && current.kind !== "recredit") return current.kind;
    if (current.reverses_id === null) return current.kind;
    const parent = byId.get(current.reverses_id);
    if (parent === undefined || parent.id === current.id) return current.kind;
    current = parent;
  }
  return current.kind;
}

/**
 * Die fünf Saldo-Eimer je `(partner_id, currency)` aus 5.10 — nie eine Summe
 * über Währungen hinweg (5.11) und nie eine Gesamtsumme über die Eimer: der
 * Auszahlungslauf sammelt eine Zeile ganz oder gar nicht ein, eine
 * Gesamtsumme wiche zwangsläufig von ihm ab (G5).
 *
 * `is_test`-Zeilen zählen nirgends mit. `approved` MIT `payout_id` erscheint
 * bewusst in keinem Eimer: die Zeile ist von einem Auszahlungsentwurf
 * reserviert, aber noch nicht überwiesen (G8) — weder verfügbar noch
 * ausgezahlt. `cancelled` zählt nie mit.
 *
 * Ist `available_cents` negativ, entsteht kein Auszahlungssatz; die negativen
 * Zeilen bleiben `approved` ohne `payout_id` und verrechnen sich automatisch
 * mit künftigen Provisionen — es braucht keine eigene Schuldenmechanik (5.10).
 */
export function computeBalances(rows: readonly AffiliateBalanceInput[]): AffiliateBalances[] {
  const byId = new Map<string, AffiliateBalanceInput>();
  for (const row of rows) byId.set(row.id, row);

  const buckets = new Map<string, AffiliateBalances>();

  for (const row of rows) {
    if (row.is_test) continue;

    const key = `${row.partner_id} ${row.currency}`;
    let balances = buckets.get(key);
    if (balances === undefined) {
      balances = {
        partner_id: row.partner_id,
        currency: row.currency,
        open_cents: 0,
        reserved_cents: 0,
        in_review_cents: 0,
        available_cents: 0,
        paid_cents: 0,
      };
      buckets.set(key, balances);
    }

    const amount = toInt(row.amount_cents);

    switch (row.status) {
      case "pending":
        if (RESERVE_KINDS.has(effectiveKind(row, byId))) balances.reserved_cents += amount;
        else balances.open_cents += amount;
        break;
      case "on_hold":
        balances.in_review_cents += amount;
        break;
      case "approved":
        if (row.payout_id === null) balances.available_cents += amount;
        break;
      case "paid":
        balances.paid_cents += amount;
        break;
      case "cancelled":
        break;
    }
  }

  // Stabile Reihenfolge, damit Oberfläche und Test nicht von der
  // Zeilenreihenfolge der Abfrage abhängen.
  return [...buckets.values()].sort(
    (a, b) =>
      a.partner_id.localeCompare(b.partner_id) || a.currency.localeCompare(b.currency),
  );
}

// --- Idempotenzschlüssel (G3, 3.11) -------------------------------------

/**
 * Eingabe für `buildDedupKey()`. Die Vereinigung ist nach `kind`
 * unterschieden, damit der Compiler jede Buchungsart mit genau den Feldern
 * verlangt, aus denen ihr Schlüssel besteht — ein `tier2` ohne `parent_id`
 * ist so nicht formulierbar.
 *
 * `manual` bekommt die Kennung hereingereicht statt sie selbst zu erzeugen:
 * eine Funktion, die `crypto.randomUUID()` aufriefe, wäre nicht mehr rein und
 * gäbe für dieselbe Eingabe zwei verschiedene Schlüssel — genau die
 * Eigenschaft, die G3 von dieser Achse verlangt. Die Kennung kommt aus der
 * Server Action, die die Handbuchung anstößt.
 */
export type AffiliateDedupKeyInput =
  | { kind: "sale" | "reserve"; order_id: string }
  | { kind: "recurring" | "recurring_reserve"; stripe_invoice_id: string }
  | { kind: "tier2"; parent_id: string }
  | {
      kind: "reversal";
      reverses_id: string;
      /** `charge.id`, ersatzweise die `invoice.id` — die Quelle der Erstattung. */
      source_id: string;
      /** Der KUMULATIVE Erstattungsstand (G7): er macht jede Stufe einer Teilerstattung zu einem eigenen Schlüssel. */
      refunded_total_cents: number;
    }
  | { kind: "recredit"; reverses_id: string; dispute_id: string }
  | { kind: "manual"; unique_id: string };

/**
 * Der einzige Idempotenzschlüssel des Moduls (G3): eine Textachse,
 * `unique (tenant_id, dedup_key)`. Partielle Unique-Indizes auf
 * `(order_id, partner_id, kind)` ließen Gegenbuchungen, Wiedergutschriften
 * und Handbuchungen ungeschützt — genau die Zeilen, bei denen eine
 * Doppelbuchung Geld kostet.
 *
 * Die Schlüsselformen stehen wörtlich in der Tabelle in 3.11.
 */
export function buildDedupKey(input: AffiliateDedupKeyInput): string {
  switch (input.kind) {
    case "sale":
    case "reserve":
      return `${input.kind}:${input.order_id}`;
    case "recurring":
    case "recurring_reserve":
      return `${input.kind}:${input.stripe_invoice_id}`;
    case "tier2":
      return `tier2:${input.parent_id}`;
    case "reversal":
      return `reversal:${input.reverses_id}:${input.source_id}:${toInt(input.refunded_total_cents)}`;
    case "recredit":
      return `recredit:${input.reverses_id}:${input.dispute_id}`;
    case "manual":
      return `manual:${input.unique_id}`;
    default: {
      // Erschöpfungsprüfung: eine neue Buchungsart ohne Schlüsselform bricht
      // hier zur Übersetzungszeit, nicht erst als Doppelbuchung zur Laufzeit.
      const exhaustive: never = input;
      return exhaustive;
    }
  }
}
