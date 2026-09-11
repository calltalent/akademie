import type {
  AffiliateBasisKind,
  AffiliateCommissionKind,
  AffiliateCommissionStatus,
  AffiliateRateKind,
} from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B7-A — der Kontoauszug des Partners als REINE
 * Funktion (PLAN_Affiliate-System.md 8.2 Zeile „/partner/kontoauszug", 5.10,
 * 5.11, 11.15; CLAUDE.md §3.4).
 *
 * Kein `server-only`, kein Supabase, kein `Date.now()` — gleiche Bauart wie
 * `compute.ts`. Ein Kontoauszug, den man nur mit einer Datenbank und der
 * Systemuhr nachrechnen kann, ist im Streitfall nicht nachrechenbar; genau
 * dieser Streitfall ist der Zweck der Seite.
 *
 * ## DIE DATENSCHUTZGRENZE STECKT IM EINGABETYP, NICHT IN DER ANZEIGE
 *
 * `AffiliateStatementRow` ist bewusst KEIN `Pick<AffiliateCommissionRow, …>`
 * über die halbe Tabelle, sondern eine eigene, kurze Liste. Sie enthält weder
 * `order_id` noch `stripe_invoice_id`, `stripe_charge_id`,
 * `stripe_subscription_id`, `referral_id`, `note`, `flag_reason`,
 * `cancel_reason` oder `condition_snapshot`. Damit ist „ein Partner sieht nie
 * Käuferdaten" (Plan 8.2, letzter Absatz) an drei Stellen zugleich gesichert,
 * und keine davon ist eine Anzeigeentscheidung:
 *
 *   1. In der Datenbank: `affiliate_commissions` trägt überhaupt keine
 *      Käuferspalte (3.11). Der Bezug zum Käufer läuft über `order_id`, und
 *      `orders` liest ein Partner nicht.
 *   2. Im SELECT-Spaltenrecht: `grant select (…) on affiliate_commissions to
 *      authenticated` (Migration 20260911130000) lässt `order_id` und die
 *      Stripe-Kennungen aus. Eine Abfrage, die sie anfordert, bricht mit
 *      42501 ab — sie kommt gar nicht erst bis hierher.
 *   3. In diesem Typ: wer einer Oberfläche später eine Bestellnummer zeigen
 *      wollte, müsste diese Datei ändern, und diese Datei erklärt, warum das
 *      nicht passiert. Ein `Pick<>` über den vollen Zeilentyp hätte die
 *      Spalten dagegen still mitgeschleppt, sobald jemand die Abfrage
 *      erweitert.
 *
 * `campaign` ist die einzige Freitextspalte, die durchgereicht wird. Sie
 * stammt aus dem Partnerlink des Partners selbst (`?cam=`, Muster
 * `AFFILIATE_CAMPAIGN_PATTERN`) und ist damit seine eigene Angabe, keine des
 * Käufers.
 *
 * ## WARUM EIN LAUFENDER SALDO UND NICHT NUR EINE LISTE
 *
 * Der Partner soll „jeden Cent nachvollziehen" (8.2). Eine Liste aus Beträgen
 * ohne fortlaufenden Stand zwingt ihn, selbst zu addieren — und bei einem
 * Storno, das eine ältere Zeile ausgleicht, ist genau das die Stelle, an der
 * er zu einem anderen Ergebnis kommt als das Provisionsbuch. Der laufende
 * Saldo hier und die fünf Eimer aus `computeBalances()` (5.10) rechnen
 * deshalb nach denselben zwei Regeln: `is_test` zählt nie mit (4.5), und eine
 * `cancelled`-Zeile zählt nie mit (6.1 — sie ist nie Geld geworden).
 *
 * Was der laufende Saldo NICHT ist: der auszahlbare Betrag. Er ist die Summe
 * alles Gebuchten, quer über alle fünf Zustände. Deshalb steht auf der Seite
 * über dem Auszug immer auch `SaldoKarten` — der Auszug erklärt die Bewegung,
 * die Karten erklären die Verfügbarkeit. Diese Trennung ist der Grund, warum
 * `buildStatement()` keinen „verfügbar"-Wert berechnet: dafür gibt es genau
 * eine getestete Stelle, und die heißt `computeBalances()`.
 */

/**
 * Genau die Spalten, die das SELECT-Spaltenrecht dem Partner gibt UND die der
 * Auszug braucht. Siehe Kopfkommentar — diese Liste ist die Datenschutzgrenze
 * in Typform.
 */
export type AffiliateStatementRow = {
  id: string;
  kind: AffiliateCommissionKind;
  /** Vorzeichenbehaftet: `reversal` negativ, `recredit` positiv (3.11). */
  amount_cents: number;
  currency: string;
  status: AffiliateCommissionStatus;
  /** Abrechnungsperiode, ISO-Datum `JJJJ-MM-TT` (G14). */
  booked_at: string;
  /** Ende der Sperrfrist — die Antwort auf „ab wann ist das mein Geld?". */
  hold_until: string;
  product_id: string | null;
  campaign: string | null;
  payout_id: string | null;
  /** `reversal` → die stornierte Zeile; nur für die Verkettung in der Anzeige. */
  reverses_id: string | null;
  base_cents: number;
  basis_kind: AffiliateBasisKind;
  rate_kind: AffiliateRateKind;
  rate_bp: number;
  fixed_cents: number;
  is_test: boolean;
};

/**
 * Dieselbe Liste als PostgREST-Spaltenausdruck — die einzige Stelle, an der
 * der Partnerbereich `affiliate_commissions` auswählt.
 *
 * Sie ist kürzer als das SELECT-Spaltenrecht des Partners und soll es
 * bleiben: das Recht ist die Grenze, diese Liste ist die Absicht. `select("*")`
 * bricht auf dieser Tabelle ohnehin mit 42501 ab (das Recht ist ein
 * Spalten-Grant) — was hier steht, ist also nicht Bequemlichkeit, sondern die
 * bewusste Auswahl. Wer eine Spalte ergänzt, ergänzt sie zugleich in
 * `AffiliateStatementRow` und muss sich dort dem Kopfkommentar stellen.
 */
export const AFFILIATE_STATEMENT_COLUMNS =
  "id, kind, amount_cents, currency, status, booked_at, hold_until, product_id, " +
  "campaign, payout_id, reverses_id, base_cents, basis_kind, rate_kind, fixed_cents, " +
  "rate_bp, is_test";

/** Eine Zeile des Auszugs: die Buchung plus ihr Stand. */
export type AffiliateStatementEntry = {
  row: AffiliateStatementRow;
  /**
   * Der Saldo NACH dieser Zeile, in chronologischer Reihenfolge gerechnet —
   * unabhängig davon, in welcher Reihenfolge die Liste am Ende ausgegeben
   * wird.
   */
  balance_cents: number;
  /**
   * Zählt diese Zeile in den Saldo? `false` bei `cancelled`. Die Zeile bleibt
   * trotzdem sichtbar: eine stornierte Buchung spurlos zu verschweigen wäre
   * genau die Lücke, wegen der ein Partner nachfragt.
   */
  counts: boolean;
};

export type AffiliateStatement = {
  currency: string;
  /** Chronologisch oder umgekehrt, je nach `order` (Vorgabe: neueste zuerst). */
  entries: AffiliateStatementEntry[];
  /** Der Stand nach der letzten (chronologisch jüngsten) Zeile. */
  closing_balance_cents: number;
  /** Zahl der Zeilen, die der Saldo tatsächlich enthält (ohne `cancelled`). */
  counted_rows: number;
};

export type AffiliateStatementOptions = {
  /**
   * Pflicht. Ein Auszug über mehrere Währungen hinweg hätte einen Saldo, den
   * es nicht gibt (5.11: „es gibt kein einziges Summenfeld über Währungen
   * hinweg"). Wer zwei Währungen hat, bekommt zwei Auszüge.
   */
  currency: string;
  /** Ausgabereihenfolge. Der Saldo wird IMMER chronologisch gerechnet. */
  order?: "asc" | "desc";
  /**
   * Begrenzt die AUSGABE, nie die Rechnung: der Saldo der jüngsten Zeile
   * bleibt der Saldo des gesamten Kontos. Wird `order: "asc"` mit `limit`
   * kombiniert, sind es die ältesten Zeilen.
   */
  limit?: number;
};

/**
 * Ganzzahlschutz. Ein `amount_cents`, das aus JSON als Gleitkommazahl
 * zurückkommt (PostgREST liefert `numeric` als String, `int` als Zahl —
 * und ein Testfixture liefert, was jemand hinschreibt), würde den Saldo um
 * Bruchteile eines Cents verschieben und ihn damit dauerhaft von
 * `computeBalances()` trennen. Gleiche Vorsichtsmaßnahme wie `toInt()` in
 * `compute.ts` (G12: alle Beträge in Ganzzahl-Cent).
 */
function toInt(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/**
 * Chronologische Ordnung: `booked_at` ist ein Datum ohne Uhrzeit (G14), an
 * einem Tag können also mehrere Buchungen liegen. Zweites Kriterium ist die
 * `id` — nicht `created_at`, das nicht in der Eingabe steht, und nicht die
 * Reihenfolge der Abfrage, die Postgres ohne `order by` nicht zusichert. Die
 * Ordnung muss deterministisch sein, sonst zeigt ein zweiter Aufruf desselben
 * Kontoauszugs einen anderen Zwischenstand.
 */
function chronologically(a: AffiliateStatementRow, b: AffiliateStatementRow): number {
  return a.booked_at.localeCompare(b.booked_at) || a.id.localeCompare(b.id);
}

/**
 * Die Währungen, in denen dieser Partner überhaupt Buchungen hat — die
 * Grundlage dafür, dass die Seite je Währung einen eigenen Auszug rendert
 * (5.11). `is_test` fällt schon hier heraus: eine Testbestellung in einer
 * zweiten Währung soll dem Partner keinen zweiten Auszug erzeugen.
 */
export function statementCurrencies(rows: readonly AffiliateStatementRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.is_test) continue;
    seen.add(row.currency);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Baut den Auszug EINER Währung mit laufendem Saldo.
 *
 * Zwei Filter, beide wortgleich mit `computeBalances()` (5.10) — und das ist
 * der ganze Punkt dieser Funktion:
 *   - `is_test`: Testbestellungen sind für den Partner kein Geld (4.5). Sie
 *     erscheinen im Auszug gar nicht; anders als in der Admin-Liste, die sie
 *     gekennzeichnet zeigt, weil dort jemand sie gerade erzeugt hat.
 *   - `cancelled`: die Zeile bleibt sichtbar, zählt aber nicht. Ein Storno
 *     ist NIE ein `cancelled` der Ursprungszeile (G6), sondern eine eigene
 *     negative Zeile — `cancelled` trifft nur Buchungen, die von Anfang an
 *     keine waren (Selbst-Empfehlung, Nullbetrag, Umbuchung).
 */
export function buildStatement(
  rows: readonly AffiliateStatementRow[],
  options: AffiliateStatementOptions,
): AffiliateStatement {
  const relevant = rows
    .filter((row) => !row.is_test && row.currency === options.currency)
    .sort(chronologically);

  let balance = 0;
  let counted = 0;
  const chronological: AffiliateStatementEntry[] = relevant.map((row) => {
    const counts = row.status !== "cancelled";
    if (counts) {
      balance += toInt(row.amount_cents);
      counted += 1;
    }
    return { row, balance_cents: balance, counts };
  });

  const order = options.order ?? "desc";
  const ordered = order === "asc" ? chronological : [...chronological].reverse();
  const limit = options.limit;
  const entries =
    typeof limit === "number" && limit > 0 && limit < ordered.length
      ? ordered.slice(0, limit)
      : ordered;

  return {
    currency: options.currency,
    entries,
    closing_balance_cents: balance,
    counted_rows: counted,
  };
}

/**
 * Der Übersetzungsschlüssel einer Buchungsart, relativ zum Namensraum
 * `affiliate.statement`.
 *
 * Warum eine Funktion und kein `t(\`kind.${row.kind}\`)` an der Oberfläche:
 * die Schlüssel im Gerüst heißen `kindSale`/`kindRecurring`/… und nicht
 * `kind.sale`, und die acht Buchungsarten teilen sich sechs Texte — eine
 * Reserve ist für den Partner „Einbehalt zum Verkauf", gleichgültig ob sie
 * aus einem Erstkauf oder einer Abo-Rate stammt. Die Zuordnung gehört damit
 * in eine getestete reine Funktion und nicht in eine Zeichenkette im JSX.
 *
 * Die Erschöpfungsprüfung im `default`-Zweig ist Absicht: eine neue
 * Buchungsart ohne Text bricht hier zur Übersetzungszeit, nicht erst als
 * leere Zelle im Kontoauszug eines Partners.
 */
export type AffiliateStatementKindKey =
  | "kindSale"
  | "kindRecurring"
  | "kindReserve"
  | "kindTier2"
  | "kindReversal"
  | "kindRecredit"
  | "kindManual";

export function statementKindKey(kind: AffiliateCommissionKind): AffiliateStatementKindKey {
  switch (kind) {
    case "sale":
      return "kindSale";
    case "recurring":
      return "kindRecurring";
    case "reserve":
    case "recurring_reserve":
      return "kindReserve";
    case "tier2":
      return "kindTier2";
    case "reversal":
      return "kindReversal";
    case "recredit":
      return "kindRecredit";
    case "manual":
      return "kindManual";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * Kennzahlen einer Tageszeile aus `affiliate_daily_stats` (3.14), zu einer
 * Reihe zusammengefasst. Eigener Typ statt `AffiliateDailyStatRow`, weil
 * derselbe Satz Zahlen dreimal gebraucht wird — je Tag, je Kampagne und als
 * Gesamtsumme — und weil `queries.ts` `server-only` ist, diese Datei aber
 * rein bleibt.
 */
export type AffiliateStatsInput = {
  clicks: number;
  unique_clicks: number;
  leads: number;
  orders_count: number;
  revenue_cents: number;
  commission_cents: number;
  reversal_cents: number;
};

/**
 * Die abgeleiteten Kennzahlen des Partnerbereichs (8.2: Conversion, EPC,
 * Stornoquote).
 *
 * Alle drei sind `null`, wenn ihr Nenner 0 ist. Das ist kein Formalismus:
 * „0 % Conversion" bei null Klicks ist eine Falschaussage, und ein
 * sehbehinderter Betrachter hat keine Möglichkeit, sie von einer echten
 * Null zu unterscheiden. Die Oberfläche schreibt in diesem Fall einen
 * Strich — dieselbe Entscheidung wie `reversalRateBp: null` im
 * Händler-Dashboard (queries.ts).
 *
 * Einheiten (G12): Quoten in Basispunkten, EPC in Cent. Kein Gleitkomma
 * verlässt diese Funktion — die Oberfläche formatiert, sie rechnet nicht.
 */
export type AffiliateDerivedStats = {
  /** Verkäufe je Klick, in Basispunkten (`orders/clicks`). */
  conversion_bp: number | null;
  /** Verdienst je Klick, in Cent (`commission/clicks`), Storno bereits abgezogen. */
  epc_cents: number | null;
  /** Storniert je gebuchter Provision, in Basispunkten. */
  reversal_rate_bp: number | null;
};

export function deriveStats(input: AffiliateStatsInput): AffiliateDerivedStats {
  const clicks = toInt(input.clicks);
  const commission = toInt(input.commission_cents);
  const reversal = toInt(input.reversal_cents);

  return {
    conversion_bp: clicks > 0 ? Math.round((toInt(input.orders_count) * 10000) / clicks) : null,
    // Netto gerechnet: ein EPC, der Stornos ignoriert, ist die Zahl, mit der
    // ein Partner seinen Werbeeinkauf falsch kalkuliert. `reversal_cents`
    // steht in `affiliate_daily_stats` positiv (3.14), wird also abgezogen.
    // `Math.round` statt `Math.floor`, weil der EPC eine Anzeigekennzahl ist
    // und kein Buchungsbetrag — G12 (`floor` überall) gilt für Geld, das
    // gebucht wird, und genau dafür ist diese Zahl nicht.
    epc_cents: clicks > 0 ? Math.round((commission - reversal) / clicks) : null,
    reversal_rate_bp: commission > 0 ? Math.round((reversal * 10000) / commission) : null,
  };
}

/** Summiert Tageszeilen — für die Gesamtzeile unter der Zeitreihe. */
export function sumStats(rows: readonly AffiliateStatsInput[]): AffiliateStatsInput {
  const total: AffiliateStatsInput = {
    clicks: 0,
    unique_clicks: 0,
    leads: 0,
    orders_count: 0,
    revenue_cents: 0,
    commission_cents: 0,
    reversal_cents: 0,
  };
  for (const row of rows) {
    total.clicks += toInt(row.clicks);
    total.unique_clicks += toInt(row.unique_clicks);
    total.leads += toInt(row.leads);
    total.orders_count += toInt(row.orders_count);
    total.revenue_cents += toInt(row.revenue_cents);
    total.commission_cents += toInt(row.commission_cents);
    total.reversal_cents += toInt(row.reversal_cents);
  }
  return total;
}

/**
 * Verdichtet Tageszeilen auf einen Schlüssel (Tag oder Kampagne) — die
 * Aufschlüsselung aus 8.2 (`/partner/statistik`).
 *
 * Die Reihenfolge ist die des Schlüssels, aufsteigend. Für Tage ist das die
 * Zeitachse (ISO-Datum sortiert lexikografisch korrekt), für Kampagnen die
 * alphabetische Liste; beides ist stabil und damit zwischen zwei Aufrufen
 * gleich — anders als eine Sortierung nach Umsatz, die bei gleichen Werten
 * springt und einen Screenreader-Nutzer zwingt, die Liste neu zu lesen.
 */
export function groupStats<T extends AffiliateStatsInput>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): Array<{ key: string; stats: AffiliateStatsInput }> {
  const byKey = new Map<string, AffiliateStatsInput[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [row]);
    else list.push(row);
  }
  return [...byKey.entries()]
    .map(([key, list]) => ({ key, stats: sumStats(list) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// --- Seitenweises Laden -------------------------------------------------

/**
 * Seitengröße, identisch zu `queries.ts` und `reporting/queries.ts`. Muss
 * kleiner oder gleich der PostgREST-Einstellung „Max rows" sein (in diesem
 * Projekt 1000), sonst kappt der Server die Seite und die Abbruchbedingung
 * `batch.length < PAGE_SIZE` griffe nie.
 */
export const AFFILIATE_STATEMENT_PAGE_SIZE = 1000;

/**
 * Läuft eine Abfrage seitenweise durch, bis eine Seite weniger Zeilen
 * liefert als angefordert.
 *
 * Warum das hier steht, obwohl diese Datei sonst rein ist: `queries.ts` hat
 * dieselbe Schleife, ist aber `server-only` UND durchgehend auf den
 * Admin-Client ausgelegt (es liest für den MANAGER, mit dessen
 * Spaltenrechten). Der Partnerbereich liest mit dem SESSION-Client und
 * dessen engerem Spalten-Grant — er kann `queries.ts` also nicht benutzen,
 * ohne dessen Spaltenlisten zu erben, und die enthalten Spalten, die ein
 * Partner nicht sehen darf. Diese Funktion nimmt deshalb nur eine
 * Rückruffunktion entgegen und weiß von Supabase nichts; die Spaltenliste
 * bleibt bei der Seite, die sie braucht.
 *
 * PostgREST kappt Antworten standardmäßig bei 1000 Zeilen — OHNE Fehler und
 * ohne jeden Hinweis. Für einen Kontoauszug ist das eine falsche Zahl, und
 * zwar dauerhaft: der Partner sähe einen anderen Saldo als der
 * Auszahlungslauf. Ein Seitenfehler bricht deshalb NICHT still ab, sondern
 * meldet sich über `ok: false` zurück; die Seite schreibt dann „nicht
 * ermittelbar" statt einer zu kleinen Summe.
 *
 * `fetchPage` MUSS deterministisch sortieren (`.order("id")` vor `.range()`);
 * ohne stabile Ordnung garantiert Postgres über mehrere Anfragen hinweg
 * keine lückenlose, überschneidungsfreie Aufteilung.
 */
export async function collectPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ ok: boolean; rows: T[] }> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(
      from,
      from + AFFILIATE_STATEMENT_PAGE_SIZE - 1,
    );
    if (error) return { ok: false, rows };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < AFFILIATE_STATEMENT_PAGE_SIZE) break;
    from += AFFILIATE_STATEMENT_PAGE_SIZE;
  }
  return { ok: true, rows };
}
