import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  AFFILIATE_REVERSAL_SOURCE_COLUMNS,
  createAffiliateReversalDraft,
  type AffiliateReversalSourceRow,
} from "@/lib/affiliate/payout-reversal";
import type {
  AffiliateCommissionKind,
  AffiliateCommissionStatus,
} from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B8 — KONTROLLABGLEICH
 * (PLAN_Affiliate-System.md 7.6; Abnahme B8: „meldet nach einem vollständigen
 * Testdurchlauf keine Abweichung").
 *
 * ## WAS DIESE DATEI IST
 *
 * Die Kontrolle, die einen Rechenfehler findet, BEVOR ein Partner ihn findet.
 * Jede einzelne Rechenregel des Moduls ist für sich geprüft — `compute.ts`
 * kennt die Provision, `tax.ts` die Steuer, `payout.ts` die Reservierung. Was
 * keine dieser Prüfungen leisten kann, ist die Frage, ob die BESTÄNDE
 * zueinander passen, nachdem Wochen von Webhooks, Stornos, Handbuchungen und
 * Auszahlungsläufen darüber gelaufen sind.
 *
 * Der Plan nennt den Grund unmissverständlich: der Datenbank-CHECK auf der
 * Auszahlungszeile (`subtotal = gross + reversal`) prüft die Zeile nur mit
 * SICH SELBST. Nichts in der Datenbank bindet den Belegkopf an seine
 * Positionen. Wird eine Provisionszeile nachträglich entstempelt, bleibt die
 * Summe auf dem Beleg stehen, der CHECK ist weiter erfüllt, und der Beleg
 * behauptet einen Betrag, den seine Positionen nicht mehr hergeben. Genau das
 * findet Gleichung 1.
 *
 * ## DIE WICHTIGSTE EIGENSCHAFT: LIEBER NICHTS SAGEN ALS FALSCH ALARMIEREN
 *
 * Bricht auch nur eine Seite beim Laden ab, liefert der Bericht `ok: false`
 * und KEINE Befunde. Eine halb geladene Zeilenmenge erzeugt zwangsläufig
 * Abweichungen — bei Gleichung 1 fehlten Positionen zu einem vollständigen
 * Belegkopf, und der Bericht setzte einen fehlerfreien Auszahlungssatz auf
 * `failed`. Ein Kontrollwerkzeug, das aus einem Netzwerkfehler einen
 * Buchungsfehler macht, wird nach dem zweiten Fehlalarm ignoriert, und ab dann
 * kontrolliert es gar nichts mehr.
 */

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Seitengröße wie in `queries.ts` (PostgREST kappt bei 1000, ohne Fehler und
 * ohne Hinweis). Für einen Abgleich ist eine gekappte Menge nicht „etwas
 * weniger Daten", sondern eine andere Aussage.
 */
const INTEGRITY_PAGE_SIZE = 1000;

/**
 * Seitenweises Laden mit Ehrlichkeitsflagge. Bewusst hier und nicht aus
 * `queries.ts` importiert: dort ist die Funktion privat und arbeitet auf einem
 * selbst erzeugten Admin-Client, während der Abgleich aus dem Cron-Lauf,
 * aus der Freigabe UND aus dem Test mit einem übergebenen Client läuft.
 */
async function fetchAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ ok: boolean; rows: T[] }> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + INTEGRITY_PAGE_SIZE - 1);
    if (error) {
      console.error(
        `[affiliate/integrity] Seitenweises Laden fehlgeschlagen (Code ${
          (error as { code?: string }).code ?? "unbekannt"
        }).`,
      );
      return { ok: false, rows };
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < INTEGRITY_PAGE_SIZE) break;
    from += INTEGRITY_PAGE_SIZE;
  }
  return { ok: true, rows };
}

// --- Spaltenlisten ------------------------------------------------------

/**
 * Die Spalten, die alle drei Gleichungen zusammen brauchen — einmal geladen,
 * dreimal ausgewertet. `select("*")` bricht auf dieser Tabelle mit 42501 ab
 * (Spalten-Grant), die Liste ist also Pflicht und nicht Stilfrage.
 */
const INTEGRITY_COMMISSION_COLUMNS =
  "id, partner_id, currency, kind, status, amount_cents, payout_id, reverses_id, " +
  "is_test, order_id, booked_at";

const INTEGRITY_PAYOUT_COLUMNS =
  "id, partner_id, currency, status, gross_cents, reversal_cents, subtotal_cents, " +
  "reverses_payout_id";

const INTEGRITY_DAILY_STAT_COLUMNS = "partner_id, day, campaign, commission_cents";

const INTEGRITY_ORDER_COLUMNS = "id, refunded_cents";

type IntegrityCommissionRow = {
  id: string;
  partner_id: string;
  currency: string;
  kind: AffiliateCommissionKind;
  status: AffiliateCommissionStatus;
  amount_cents: number;
  payout_id: string | null;
  reverses_id: string | null;
  is_test: boolean;
  order_id: string | null;
  booked_at: string;
};

type IntegrityPayoutRow = {
  id: string;
  partner_id: string;
  currency: string;
  status: string;
  gross_cents: number;
  reversal_cents: number;
  subtotal_cents: number;
  reverses_payout_id?: string | null;
};

type IntegrityDailyStatRow = {
  partner_id: string;
  day: string;
  campaign: string;
  commission_cents: number;
};

type IntegrityOrderRow = { id: string; refunded_cents: number | null };

// --- Befunde ------------------------------------------------------------

export const AFFILIATE_INTEGRITY_CHECKS = [
  "payout_subtotal",
  "daily_stats",
  "over_reversal",
] as const;
export type AffiliateIntegrityCheck = (typeof AFFILIATE_INTEGRITY_CHECKS)[number];

/**
 * `critical` heißt: hier steht Geld falsch, und ein Beleg darf so nicht
 * hinausgehen. `warning` heißt: eine abgeleitete Kennzahl weicht ab — das
 * Provisionsbuch selbst ist unberührt, die Anzeige lügt aber.
 */
export type AffiliateIntegritySeverity = "critical" | "warning";

export type AffiliateIntegrityFinding = {
  check: AffiliateIntegrityCheck;
  severity: AffiliateIntegritySeverity;
  entity: "payout" | "daily_stat" | "order";
  /** Kennung der betroffenen Zeile; bei `daily_stat` „<partner>/<tag>". */
  entity_id: string;
  partner_id: string | null;
  currency: string | null;
  /** Was stehen müsste — die Summe aus dem Provisionsbuch. */
  expected_cents: number;
  /** Was tatsächlich steht. */
  actual_cents: number;
  /** `actual - expected`; Vorzeichen sagt, in welche Richtung es abweicht. */
  difference_cents: number;
  messageKey: string;
  /** Wurde der Auszahlungssatz daraufhin stillgelegt (nur Gleichung 1)? */
  quarantined?: boolean;
  /**
   * Kennung des daraufhin angelegten Storno-Entwurfs (Abnahme, Befund N3).
   *
   * Gesetzt, sobald ein bereits NUMMERIERTER Satz stillgelegt wurde — dort
   * bleibt sonst ein Beleg mit ausgewiesener Steuer ohne jeden Weg zur
   * Berichtigung nach § 14c UStG im Bestand, weil 'failed' im Guard keine
   * ausgehende Kante hat. `null` bei gesetztem `reversal_pending` heißt „hätte
   * einen geben müssen und gibt keinen".
   */
  reversal_payout_id?: string | null;
  /**
   * `true` heißt: für diesen Satz FEHLT die Stornogutschrift. Ein eigener,
   * sichtbarer Zustand und kein Logeintrag — dieselbe Form, in der
   * `markAffiliatePayoutFailed()` es an seinen Aufrufer meldet.
   */
  reversal_pending?: boolean;
};

export type AffiliateIntegrityReport = {
  /**
   * `false` heißt „nicht ermittelbar", nicht „in Ordnung". Die Oberfläche MUSS
   * das als eigenen Zustand rendern; ein grüner Haken auf unvollständiger
   * Datengrundlage ist schlimmer als gar keine Anzeige, und ein sehbehinderter
   * Betrachter hat keine Möglichkeit, ihn zu hinterfragen.
   */
  ok: boolean;
  checked_at: string;
  findings: AffiliateIntegrityFinding[];
  /** Wie viele Objekte tatsächlich verglichen wurden — der Beleg für „geprüft". */
  counts: { payouts: number; daily_stats: number; orders: number };
};

/** Die Buchungsarten, die eine Gegenbuchung überhaupt haben können (5.8). */
const REVERSIBLE_KINDS: ReadonlySet<AffiliateCommissionKind> = new Set([
  "sale",
  "reserve",
  "recurring",
  "recurring_reserve",
  "tier2",
]);

/**
 * Statuswerte eines Auszahlungssatzes, der noch stillgelegt werden kann — und
 * WOHIN er dabei geht (Abnahme B8/B9, Befund 9).
 *
 * 'draft' stand hier zusammen mit den anderen, und die Stilllegung setzte
 * pauschal `status = 'failed'`. Das konnte nie gelingen: die Übergangstabelle
 * im Beleg-Guard kennt keine Kante draft -> failed, und
 * `check ((approved_at is not null) = (status not in ('draft','cancelled')))`
 * wäre zusätzlich verletzt. Der UPDATE scheiterte also immer, der Befund blieb
 * ohne `quarantined`, und der defekte Entwurf blockierte über
 * `affiliate_payouts_open_draft_uniq` zugleich jeden neuen Entwurf für diesen
 * Partner.
 *
 * Ein Entwurf hat keine Belegnummer gezogen; er wird VERWORFEN. Ein bereits
 * freigegebener oder exportierter Satz hat eine — er wird stillgelegt.
 */
const QUARANTINE_TARGET: Record<string, "failed" | "cancelled"> = {
  draft: "cancelled",
  approved: "failed",
  exported: "failed",
};

export type AffiliateIntegrityOptions = {
  now?: Date;
  /**
   * Setzt einen Auszahlungssatz mit abweichender Positionssumme auf `failed`
   * (7.6, Gleichung 1: „der Satz wird auf `failed` gesetzt und nicht
   * exportiert").
   *
   * Vorgabe `false`, weil derselbe Bericht auch nur zur Anzeige läuft
   * (`/portal/affiliate`, Mandanten-Übersicht) und eine Anzeige nichts
   * verändert. Der Auszahlungsweg ruft ihn mit `true`.
   *
   * Die zugeordneten Provisionszeilen werden dabei ABSICHTLICH NICHT
   * freigegeben — anders als bei einer fehlgeschlagenen Überweisung
   * (`markAffiliatePayoutFailed()`). Hier ist ungeklärt, WARUM die Summen
   * auseinanderlaufen; die Stempel sind in dem Moment das einzige, woran sich
   * nachvollziehen lässt, welche Zeilen der Satz einmal eingesammelt hatte.
   * Wer sie sofort löste, vernichtete den Beweis für die Untersuchung.
   */
  quarantine?: boolean;
};

/**
 * Prüft die drei Gleichungen aus 7.6 für einen Mandanten.
 *
 * Aufrufstellen: vor jeder Freigabe (dort mit `quarantine: true`) und einmal
 * je Cron-Lauf. Der Mandant wird IMMER übergeben und nie aus den Daten
 * abgeleitet; jede Abfrage filtert zusätzlich zu RLS auf `tenant_id`
 * (Defense in Depth, CLAUDE.md §2.15).
 */
export async function verifyAffiliateIntegrity(
  admin: Admin,
  tenantId: string,
  options: AffiliateIntegrityOptions = {},
): Promise<AffiliateIntegrityReport> {
  const checkedAt = (options.now ?? new Date()).toISOString();
  const empty: AffiliateIntegrityReport = {
    ok: false,
    checked_at: checkedAt,
    findings: [],
    counts: { payouts: 0, daily_stats: 0, orders: 0 },
  };

  const commissions = await fetchAll<IntegrityCommissionRow>((from, to) =>
    admin
      .from("affiliate_commissions")
      .select(INTEGRITY_COMMISSION_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
      data: IntegrityCommissionRow[] | null;
      error: unknown;
    }>,
  );
  if (!commissions.ok) return empty;

  const payouts = await fetchAll<IntegrityPayoutRow>((from, to) =>
    admin
      .from("affiliate_payouts")
      .select(INTEGRITY_PAYOUT_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
      data: IntegrityPayoutRow[] | null;
      error: unknown;
    }>,
  );
  if (!payouts.ok) return empty;

  const dailyStats = await fetchAll<IntegrityDailyStatRow>((from, to) =>
    admin
      .from("affiliate_daily_stats")
      .select(INTEGRITY_DAILY_STAT_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("day", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
      data: IntegrityDailyStatRow[] | null;
      error: unknown;
    }>,
  );
  if (!dailyStats.ok) return empty;

  const orders = await fetchAll<IntegrityOrderRow>((from, to) =>
    admin
      .from("orders")
      .select(INTEGRITY_ORDER_COLUMNS)
      .eq("tenant_id", tenantId)
      .gt("refunded_cents", 0)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
      data: IntegrityOrderRow[] | null;
      error: unknown;
    }>,
  );
  if (!orders.ok) return empty;

  const findings: AffiliateIntegrityFinding[] = [
    ...checkPayoutSubtotals(payouts.rows, commissions.rows),
    ...checkDailyStats(dailyStats.rows, commissions.rows),
    ...checkOverReversal(orders.rows, commissions.rows),
  ];

  if (options.quarantine === true) {
    await quarantineFailedPayouts(admin, tenantId, payouts.rows, findings);
  }

  return {
    ok: true,
    checked_at: checkedAt,
    findings,
    counts: {
      payouts: payouts.rows.length,
      daily_stats: dailyStats.rows.length,
      orders: orders.rows.length,
    },
  };
}

// --- Gleichung 1: Belegkopf gegen seine Positionen ----------------------

/**
 * `sum(amount_cents) über affiliate_commissions where payout_id = X` muss
 * `subtotal_cents` des Satzes entsprechen.
 *
 * Gezählt wird JEDE zugeordnete Zeile, unabhängig vom Status: `approved`
 * (noch nicht überwiesen) und `paid` (überwiesen) gehören beide zu dem Satz,
 * der sie eingesammelt hat. Ein Statusfilter hätte genau in dem Moment eine
 * Abweichung erzeugt, in dem `markAffiliatePayoutPaid()` die Zeilen umstellt.
 *
 * `is_test` wird hier NICHT gefiltert: eine Testzeile darf gar nicht erst
 * eingesammelt worden sein (der CAS des Entwurfs filtert sie aus). Ist eine
 * dabei, soll der Abgleich genau das melden und nicht darüber hinwegsehen.
 */
function checkPayoutSubtotals(
  payouts: readonly IntegrityPayoutRow[],
  commissions: readonly IntegrityCommissionRow[],
): AffiliateIntegrityFinding[] {
  const sums = new Map<string, number>();
  for (const row of commissions) {
    if (row.payout_id === null) continue;
    sums.set(row.payout_id, (sums.get(row.payout_id) ?? 0) + toInt(row.amount_cents));
  }

  const byId = new Map(payouts.map((payout) => [payout.id, payout]));

  const findings: AffiliateIntegrityFinding[] = [];
  for (const payout of payouts) {
    // Ein stornierter oder fehlgeschlagener Satz hat keine Zeilen mehr; ihn zu
    // vergleichen erzeugte einen Dauerbefund über einen erledigten Vorgang.
    if (payout.status === "cancelled" || payout.status === "failed") continue;

    // DER LAUFENDE ENTWURF (Abnahme B8/B9, Befund 9). Zwischen dem INSERT mit
    // Nullbeträgen und der Finalisierung ist JEDER Entwurf für Gleichung 1
    // abweichend — das ist kein Befund, sondern der Zwischenstand, den die
    // Tabelle ausdrücklich zulässt. Ein gleichzeitig laufender Abgleich mit
    // `quarantine: true` erzeugte daraus Dauerrauschen aus kritischen Befunden
    // über völlig gesunde Läufe.
    if (payout.status === "draft" && toInt(payout.subtotal_cents) === 0) continue;

    // DIE STORNOGUTSCHRIFT (7.7) hat keine eigenen Positionen — sie
    // neutralisiert einen Beleg. Verglichen wird deshalb gegen den
    // Ursprungsbeleg: ein Storno, der nicht exakt spiegelt, neutralisiert
    // nicht, sondern verschiebt.
    const reversesId = payout.reverses_payout_id ?? null;
    if (reversesId !== null) {
      const origin = byId.get(reversesId);
      if (origin === undefined) continue;
      const expected = -toInt(origin.subtotal_cents);
      const actualReversal = toInt(payout.subtotal_cents);
      if (actualReversal === expected) continue;
      findings.push({
        check: "payout_subtotal",
        severity: "critical",
        entity: "payout",
        entity_id: payout.id,
        partner_id: payout.partner_id,
        currency: payout.currency,
        expected_cents: expected,
        actual_cents: actualReversal,
        difference_cents: actualReversal - expected,
        messageKey: "affiliate.integrity.payoutSubtotalMismatch",
      });
      continue;
    }

    const actual = sums.get(payout.id) ?? 0;
    const expected = toInt(payout.subtotal_cents);
    if (actual === expected) continue;

    findings.push({
      check: "payout_subtotal",
      severity: "critical",
      entity: "payout",
      entity_id: payout.id,
      partner_id: payout.partner_id,
      currency: payout.currency,
      expected_cents: expected,
      actual_cents: actual,
      difference_cents: actual - expected,
      messageKey: "affiliate.integrity.payoutSubtotalMismatch",
    });
  }
  return findings;
}

/**
 * Setzt jeden Satz mit kritischem Befund auf `failed` (7.6). Compare-and-Swap
 * im `update` selbst: der Satz wird nur stillgelegt, wenn er noch in einem
 * Zustand ist, aus dem heraus überwiesen werden könnte. Ein bereits bezahlter
 * Satz wird NICHT angefasst — das Geld ist weg, die Korrektur läuft dann über
 * eine Stornogutschrift mit eigener Belegnummer (7.7), nie über eine
 * Statusänderung im Nachhinein.
 */
async function quarantineFailedPayouts(
  admin: Admin,
  tenantId: string,
  payouts: readonly IntegrityPayoutRow[],
  findings: AffiliateIntegrityFinding[],
): Promise<void> {
  const byId = new Map(payouts.map((payout) => [payout.id, payout]));

  for (const finding of findings) {
    if (finding.check !== "payout_subtotal") continue;
    const payout = byId.get(finding.entity_id);
    if (payout === undefined) continue;
    const target = QUARANTINE_TARGET[payout.status];
    if (target === undefined) continue;

    const { data, error } = await admin
      .from("affiliate_payouts")
      .update({ status: target })
      .eq("id", finding.entity_id)
      .eq("tenant_id", tenantId)
      // Compare-and-Swap auf GENAU den Status, für den das Ziel gilt: zwischen
      // Lesen und Schreiben kann der Satz weitergelaufen sein, und ein Entwurf
      // darf nicht auf 'failed' und ein freigegebener Satz nicht auf
      // 'cancelled' landen.
      .eq("status", payout.status)
      .select("id");

    if (error) {
      console.error(
        `[affiliate/integrity] Stilllegung eines Auszahlungssatzes fehlgeschlagen (Code ${
          (error as { code?: string }).code ?? "unbekannt"
        }).`,
      );
      // AUSDRÜCKLICH `false` statt „nichts sagen" (Befund 9): ein kritischer
      // Befund, der NICHT stillgelegt werden konnte, muss den Export
      // aufhalten. Ein `undefined` hätte an der Aufrufstelle wie „gar nicht
      // versucht" ausgesehen.
      finding.quarantined = false;
      continue;
    }
    const quarantined = (data ?? []).length > 0;
    finding.quarantined = quarantined;

    // DIE STORNOGUTSCHRIFT AN DERSELBEN KANTE (Abnahme, Befund N3).
    //
    // 'cancelled' trifft nur Entwürfe — die haben nie eine Nummer gezogen, es
    // gibt nichts zu neutralisieren. 'failed' trifft einen bereits
    // NUMMERIERTEN Beleg mit ausgewiesener Steuer; ohne Storno-Entwurf bliebe
    // er dauerhaft im Bestand, denn 'failed' hat im Guard keine ausgehende
    // Kante und `markAffiliatePayoutFailed()` verlangt approved/exported.
    // Genau dieser Endzustand sollte mit Befund 4 verschwinden — über den
    // zweiten Eingang stand er noch offen.
    //
    // Die Provisionszeilen bleiben dabei gestempelt, anders als bei der
    // fehlgeschlagenen Überweisung: hier ist ungeklärt, WARUM die Summen
    // auseinanderlaufen, und die Stempel sind der einzige Beweis dafür,
    // welche Zeilen der Satz einmal eingesammelt hatte.
    if (!quarantined || target !== "failed") continue;

    const { data: sourceData, error: sourceError } = await admin
      .from("affiliate_payouts")
      .select(AFFILIATE_REVERSAL_SOURCE_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("id", finding.entity_id)
      .maybeSingle<AffiliateReversalSourceRow>();

    if (sourceError !== null || sourceData === null) {
      console.error(
        `[affiliate/integrity] Beleg für den Storno-Entwurf nicht gelesen (Code ${
          (sourceError as { code?: string } | null)?.code ?? "unbekannt"
        }).`,
      );
      finding.reversal_payout_id = null;
      finding.reversal_pending = true;
      continue;
    }

    const reversal = await createAffiliateReversalDraft(admin, sourceData);
    if (reversal.status === "created") {
      finding.reversal_payout_id = reversal.payout_id;
      finding.reversal_pending = false;
      continue;
    }
    finding.reversal_payout_id = null;
    // `not_applicable` heißt hier: der stillgelegte Satz war selbst schon ein
    // Storno oder trug keine Nummer. Beides ist kein offener Punkt.
    finding.reversal_pending = reversal.status === "failed";
  }
}

// --- Gleichung 2: Tagesaggregat gegen das Buch --------------------------

/**
 * `affiliate_daily_stats.commission_cents` muss je Tag und Partner der Summe
 * der POSITIVEN Buchungszeilen dieses Tages entsprechen.
 *
 * Verglichen wird auf der Ebene `(partner, tag)` und nicht `(partner, tag,
 * kampagne)`: das Aggregat führt eine fehlende Kampagne als `''`, die
 * Buchungszeile als `null`, und ein Vergleich über diese Grenze hinweg meldete
 * bei jeder kampagnenlosen Bestellung eine Abweichung, die keine ist.
 *
 * `is_test` und `cancelled` zählen nirgends mit — wortgleich mit
 * `computeBalances()` (5.10) und dem Kontoauszug. Drei Stellen, eine Regel;
 * wo sie auseinanderliefen, entstünde genau der Streitfall, den der Abgleich
 * verhindern soll.
 *
 * Nur `warning`: hier ist eine ANZEIGE falsch, nicht das Buch. Der Plan sieht
 * als Abhilfe die Neuberechnung des Aggregats durch den Aggregationslauf vor
 * (3.14: der Tagescache ist idempotent und selbstheilend), nicht einen Eingriff
 * von hier aus.
 */
function checkDailyStats(
  stats: readonly IntegrityDailyStatRow[],
  commissions: readonly IntegrityCommissionRow[],
): AffiliateIntegrityFinding[] {
  const key = (partnerId: string, day: string) => `${partnerId}|${day}`;

  const aggregated = new Map<string, number>();
  for (const stat of stats) {
    const k = key(stat.partner_id, stat.day);
    aggregated.set(k, (aggregated.get(k) ?? 0) + toInt(stat.commission_cents));
  }

  const booked = new Map<string, number>();
  for (const row of commissions) {
    if (row.is_test) continue;
    if (row.status === "cancelled") continue;
    const amount = toInt(row.amount_cents);
    if (amount <= 0) continue;
    const k = key(row.partner_id, row.booked_at);
    booked.set(k, (booked.get(k) ?? 0) + amount);
  }

  const findings: AffiliateIntegrityFinding[] = [];
  for (const k of new Set([...aggregated.keys(), ...booked.keys()])) {
    const actual = aggregated.get(k) ?? 0;
    const expected = booked.get(k) ?? 0;
    if (actual === expected) continue;

    const [partnerId, day] = k.split("|");
    findings.push({
      check: "daily_stats",
      severity: "warning",
      entity: "daily_stat",
      entity_id: `${partnerId}/${day}`,
      partner_id: partnerId,
      currency: null,
      expected_cents: expected,
      actual_cents: actual,
      difference_cents: actual - expected,
      messageKey: "affiliate.integrity.dailyStatsMismatch",
    });
  }

  // Stabile Reihenfolge, damit zwei Läufe denselben Bericht ergeben.
  return findings.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
}

// --- Gleichung 3: Überstornierung ---------------------------------------

/**
 * Für jede Bestellung mit `refunded_cents > 0`: die Summe der Gegenbuchungen
 * zu ihren Zeilen darf die Summe der Ursprungsbeträge nicht übersteigen.
 *
 * Gerechnet wird NETTO — Gegenbuchungen minus Wiedergutschriften — und damit
 * mit derselben Definition wie der Deckel im Guard-Trigger und in
 * `book_affiliate_reversals()`. Eine andere Definition hier hieße: entweder
 * meldet der Abgleich einen Fall, den die Datenbank rechtmäßig zugelassen hat,
 * oder er übersieht einen, den sie verboten hätte.
 *
 * Eine Wiedergutschrift zeigt über `reverses_id` auf die GEGENBUCHUNG, nicht
 * auf die Ursprungszeile; sie wird deshalb über ihr Elternteil zugeordnet.
 */
function checkOverReversal(
  orders: readonly IntegrityOrderRow[],
  commissions: readonly IntegrityCommissionRow[],
): AffiliateIntegrityFinding[] {
  const refundedOrderIds = new Set(orders.map((order) => order.id));
  if (refundedOrderIds.size === 0) return [];

  const byId = new Map(commissions.map((row) => [row.id, row]));

  const originals = new Map<string, number>();
  const counters = new Map<string, number>();

  for (const row of commissions) {
    if (row.is_test) continue;
    if (row.status === "cancelled") continue;

    if (REVERSIBLE_KINDS.has(row.kind)) {
      if (row.order_id === null || !refundedOrderIds.has(row.order_id)) continue;
      originals.set(row.order_id, (originals.get(row.order_id) ?? 0) + toInt(row.amount_cents));
      continue;
    }

    if (row.kind === "reversal") {
      const parent = row.reverses_id === null ? undefined : byId.get(row.reverses_id);
      const orderId = parent?.order_id ?? row.order_id;
      if (orderId === null || orderId === undefined || !refundedOrderIds.has(orderId)) continue;
      // `amount_cents` einer Gegenbuchung ist negativ (3.11); die Summe der
      // Gegenbuchungen ist ihr Betrag mit umgekehrtem Vorzeichen.
      counters.set(orderId, (counters.get(orderId) ?? 0) - toInt(row.amount_cents));
      continue;
    }

    if (row.kind === "recredit") {
      const reversal = row.reverses_id === null ? undefined : byId.get(row.reverses_id);
      const parent =
        reversal?.reverses_id === null || reversal?.reverses_id === undefined
          ? undefined
          : byId.get(reversal.reverses_id);
      const orderId = parent?.order_id ?? reversal?.order_id ?? row.order_id;
      if (orderId === null || orderId === undefined || !refundedOrderIds.has(orderId)) continue;
      counters.set(orderId, (counters.get(orderId) ?? 0) - toInt(row.amount_cents));
    }
  }

  const findings: AffiliateIntegrityFinding[] = [];
  for (const orderId of [...counters.keys()].sort((a, b) => a.localeCompare(b))) {
    const counter = counters.get(orderId) ?? 0;
    const original = originals.get(orderId) ?? 0;
    if (counter <= original) continue;

    findings.push({
      check: "over_reversal",
      severity: "critical",
      entity: "order",
      entity_id: orderId,
      partner_id: null,
      currency: null,
      expected_cents: original,
      actual_cents: counter,
      difference_cents: counter - original,
      messageKey: "affiliate.integrity.overReversal",
    });
  }
  return findings;
}

/**
 * Ganzzahlschutz wie in `compute.ts` und `statement.ts`: ein Betrag, der als
 * Gleitkommazahl aus JSON zurückkommt, verschöbe den Vergleich um Bruchteile
 * eines Cents — und ein Abgleich, der wegen 0,0001 Cent Alarm schlägt, ist
 * schlimmer als keiner.
 */
function toInt(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/**
 * Kurzform für Oberflächen: gibt es einen kritischen Befund? Bewusst eine
 * eigene Funktion statt `findings.length > 0` an jeder Aufrufstelle — eine
 * abweichende Tageskennzahl (`warning`) darf keine Auszahlung aufhalten.
 */
export function hasCriticalIntegrityFinding(report: AffiliateIntegrityReport): boolean {
  return report.findings.some((finding) => finding.severity === "critical");
}

/**
 * Gibt es einen kritischen Befund, dessen Satz NICHT stillgelegt werden konnte
 * (Abnahme B8/B9, Befund 9)?
 *
 * Der Unterschied ist nicht akademisch: ein stillgelegter Satz kann nicht mehr
 * exportiert und nicht mehr überwiesen werden, ein nicht stillgelegter schon.
 * Ein fehlgeschlagener Stilllegungsversuch stand vorher nur im Serverlog — und
 * ein Log hält keine Überweisung auf.
 */
export function hasUnquarantinedCriticalFinding(report: AffiliateIntegrityReport): boolean {
  return report.findings.some(
    (finding) => finding.severity === "critical" && finding.quarantined === false,
  );
}

/**
 * Wie viele stillgelegte Belege warten auf eine Stornogutschrift, die nicht
 * angelegt werden konnte (Abnahme, Befund N3)?
 *
 * Bewusst KEIN Riegel vor der Freigabe: der stillgelegte Satz ist bereits
 * 'failed' und geht nirgendwo mehr hinaus, es ist also nichts aufzuhalten.
 * Aufzuholen ist etwas — und ein fehlender Storno verschwindet sonst
 * lautlos, weil `checkPayoutSubtotals()` einen 'failed'-Satz beim nächsten
 * Lauf überspringt und der Befund nie wiederkommt. Deshalb eine Zahl, die die
 * Oberfläche ausspricht, statt einer Zeile im Serverlog.
 */
export function countPendingReversals(report: AffiliateIntegrityReport): number {
  return report.findings.filter((finding) => finding.reversal_pending === true).length;
}
