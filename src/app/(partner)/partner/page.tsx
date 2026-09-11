import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { checkAffiliatePartnerAccess } from "@/lib/affiliate/access";
import { createClient } from "@/lib/supabase/server";
import { computeBalances } from "@/lib/affiliate/compute";
import {
  AFFILIATE_STATEMENT_COLUMNS,
  collectPages,
  deriveStats,
  sumStats,
  type AffiliateStatementRow,
  type AffiliateStatsInput,
} from "@/lib/affiliate/statement";
import type { AffiliateBalanceInput } from "@/lib/affiliate/types";
import {
  PartnerMetric,
  PartnerShell,
  PartnerAccessNotice,
  PARTNER_BORDER,
  PARTNER_BUTTON_BG,
  PARTNER_BUTTON_CLASS,
  PARTNER_CARD_CLASS,
  PARTNER_FOCUS_RING,
  PARTNER_INK,
  PARTNER_MUTED,
} from "@/components/affiliate/partner-shell";
import { SaldoKarten, type SaldoKartenEintrag } from "@/components/affiliate/saldo-karten";

/**
 * Affiliate-System, Block B7-A — `/partner`, die Übersicht
 * (PLAN_Affiliate-System.md 8.2 Zeile 1, 5.10, 5.11, 8.5).
 *
 * Zweck laut Plan: „Was habe ich verdient?" — und zwar so, dass der Partner
 * daran seine Erwartung bilden kann. Deshalb stehen hier FÜNF Salden und
 * nie eine Summe (Begründung in `saldo-karten.tsx`), jede Kennzahl als Text,
 * und der Grund einer blockierten Auszahlung im Klartext statt als Ampel.
 *
 * ## Woher die Zahlen kommen
 *
 * Alles über den SESSION-Client, nichts über `createAdminClient()`. Das ist
 * hier nicht nur zulässig, sondern besser: das SELECT-Spaltenrecht des
 * Partners auf `affiliate_commissions` lässt `order_id` und die
 * Stripe-Kennungen gar nicht erst zu (Migration 20260911130000), und die
 * Policy `affiliate_commissions_select` bindet die Zeilen an
 * `affiliate_partner_id(tenant)`. Die Datenschutzgrenze und die
 * Mandantengrenze setzt damit die Datenbank, nicht diese Datei — zusätzlich
 * trägt jede Abfrage `.eq("tenant_id", …)` und `.eq("partner_id", …)` als
 * Defense-in-Depth (8., erster Absatz).
 *
 * Die Salden rechnet `computeBalances()` (compute.ts) — dieselbe Funktion,
 * die der Händler-Oberfläche und dem Auszahlungslauf zugrunde liegt. Eine
 * zweite Rechnung hier wäre die Stelle, an der Partneransicht und
 * Überweisung auseinanderlaufen.
 *
 * ## Ehrlichkeit
 *
 * `collectPages()` meldet über `ok: false`, wenn eine Seite der Abfrage
 * gefehlt hat. Dann steht überall „nicht ermittelbar" statt einer zu
 * kleinen Zahl: eine falsche Geldzahl ist schlimmer als gar keine, und ein
 * sehbehinderter Betrachter hat keine Chance, sie als falsch zu erkennen.
 */

/** Kennzahlen-Zeitraum der Übersicht, wie im Händler-Dashboard (8.1). */
const RANGE_DAYS = 30;

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export default async function PartnerDashboardPage() {
  const access = await checkAffiliatePartnerAccess();
  if (!access.ok) return <PartnerAccessNotice reason={access.reason} />;

  const supabase = await createClient();
  const t = await getTranslations("affiliate.dashboard");
  const format = await getFormatter();

  const to = new Date();
  const from = new Date(to.getTime() - (RANGE_DAYS - 1) * 86_400_000);

  const [{ data: program }, commissions, stats, { data: profile }, { data: partner }] =
    await Promise.all([
      supabase
        .from("affiliate_programs")
        .select("id, currency, min_payout_cents, payout_schedule, tier2_enabled")
        .eq("tenant_id", access.tenant.id)
        .maybeSingle(),
      collectPages<AffiliateStatementRow & { partner_id: string }>((rangeFrom, rangeTo) =>
        supabase
          .from("affiliate_commissions")
          .select(`${AFFILIATE_STATEMENT_COLUMNS}, partner_id`)
          .eq("tenant_id", access.tenant.id)
          .eq("partner_id", access.partnerId)
          .order("id", { ascending: true })
          .range(rangeFrom, rangeTo) as unknown as PromiseLike<{
          data: Array<AffiliateStatementRow & { partner_id: string }> | null;
          error: unknown;
        }>,
      ),
      collectPages<AffiliateStatsInput>((rangeFrom, rangeTo) =>
        supabase
          .from("affiliate_daily_stats")
          .select("clicks, unique_clicks, leads, orders_count, revenue_cents, commission_cents, reversal_cents")
          .eq("tenant_id", access.tenant.id)
          .eq("partner_id", access.partnerId)
          .gte("day", isoDay(from))
          .lte("day", isoDay(to))
          .order("day", { ascending: true })
          .order("campaign", { ascending: true })
          .range(rangeFrom, rangeTo) as unknown as PromiseLike<{
          data: AffiliateStatsInput[] | null;
          error: unknown;
        }>,
      ),
      // Nur die Vollständigkeitsmerkmale, nie die Werte: `iban`, `bic`,
      // `account_holder`, `paypal_email` und `tax_number` stehen ohnehin
      // nicht im SELECT-Recht des Partners (Migration 20260910120000,
      // Abschnitt 6) — die Abfrage nennt deshalb nur, was sie braucht.
      supabase
        .from("affiliate_billing_profiles")
        .select("partner_id, entity_kind, street, postal_code, city, country, small_business, vat_id, payout_method")
        .eq("tenant_id", access.tenant.id)
        .eq("partner_id", access.partnerId)
        .maybeSingle(),
      supabase
        .from("affiliate_partners")
        .select("id, payout_hold")
        .eq("tenant_id", access.tenant.id)
        .eq("id", access.partnerId)
        .maybeSingle(),
    ]);

  const programCurrency = program?.currency ?? "eur";

  const balanceRows: AffiliateBalanceInput[] = commissions.rows.map((row) => ({
    id: row.id,
    partner_id: row.partner_id,
    currency: row.currency,
    kind: row.kind,
    status: row.status,
    amount_cents: row.amount_cents,
    payout_id: row.payout_id,
    reverses_id: row.reverses_id,
    is_test: row.is_test,
  }));
  const balances = computeBalances(balanceRows);

  /**
   * „Das Datum, ab dem der Betrag frei wird" (8.2): das FRÜHESTE `hold_until`
   * der Zeilen im jeweiligen Eimer. Nicht das späteste — die Frage des
   * Partners lautet „wann bewegt sich das nächste Mal etwas?", und die
   * Antwort darauf ist der nächste Termin, nicht der letzte.
   */
  const freeFrom = (currency: string, reserve: boolean): string | null => {
    let earliest: string | null = null;
    for (const row of commissions.rows) {
      if (row.is_test || row.currency !== currency || row.status !== "pending") continue;
      const isReserve = row.kind === "reserve" || row.kind === "recurring_reserve";
      if (isReserve !== reserve) continue;
      if (earliest === null || row.hold_until < earliest) earliest = row.hold_until;
    }
    return earliest;
  };

  const saldoEntries: SaldoKartenEintrag[] = balances.map((entry) => ({
    balances: entry,
    openFreeFrom: freeFrom(entry.currency, false),
    reservedFreeFrom: freeFrom(entry.currency, true),
  }));

  const totals = sumStats(stats.rows);
  const derived = deriveStats(totals);

  const metric = (value: number): string =>
    stats.ok ? format.number(value) : t("unavailable");
  const ratio = (bp: number | null): string =>
    !stats.ok
      ? t("unavailable")
      : bp === null
        ? "—"
        : format.number(bp / 10000, { style: "percent", maximumFractionDigits: 2 });
  const money = (cents: number, currency: string): string =>
    format.number(cents / 100, {
      style: "currency",
      currency: /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "EUR",
    });

  /**
   * Der Hinweisbanner „Auszahlung blockiert" nennt das KONKRET fehlende Feld
   * (8.2, letzte Spalte). „Bitte Stammdaten vervollständigen" ohne zu sagen,
   * was fehlt, ist für jeden Nutzer eine Zumutung und für einen
   * sehbehinderten eine Suche durch ein ganzes Formular.
   */
  const missing: string[] = [];
  if (
    profile === null ||
    profile.street === null ||
    profile.postal_code === null ||
    profile.city === null ||
    profile.country === null
  ) {
    missing.push(t("missingAddress"));
  }
  if (profile === null || profile.entity_kind === null) missing.push(t("missingTaxStatus"));
  if (profile === null || profile.payout_method === null) missing.push(t("missingPayoutMethod"));

  const availableCents =
    balances.find((entry) => entry.currency === programCurrency)?.available_cents ?? 0;
  const minPayoutCents = Number(program?.min_payout_cents ?? 0);
  const missingToMinimum = Math.max(minPayoutCents - availableCents, 0);

  return (
    <PartnerShell
      active="dashboard"
      title={t("title")}
      tenantName={access.tenant.name}
      logoUrl={access.tenant.branding?.logo_url ?? null}
      showTeam={program?.tier2_enabled === true}
    >
      {partner?.payout_hold === true && (
        // Kein Grund im Klartext: `payout_hold_reason` ist dem Partner im
        // SELECT-Spaltenrecht bewusst entzogen (Migration 20260910120000,
        // Abschnitt 4) — der Freitext ist ein Vermerk ÜBER ihn. Er erfährt
        // DASS gesperrt ist und an wen er sich wendet.
        <p
          role="status"
          className={`${PARTNER_CARD_CLASS} p-[16px_18px] text-[15px] font-semibold`}
          style={{ borderColor: "#E4C07A", background: "#FBF1DC", color: "#5A4512" }}
        >
          {t("payoutHold")}
        </p>
      )}

      {missing.length > 0 && (
        <div
          className={`${PARTNER_CARD_CLASS} p-[16px_18px]`}
          style={{ borderColor: "#E4C07A", background: "#FBF1DC" }}
        >
          <p className="text-[15px] font-semibold" style={{ color: "#5A4512" }}>
            {t("payoutBlocked", { fields: missing.join(", ") })}
          </p>
          <Link
            href="/partner/stammdaten"
            prefetch={false}
            className={`mt-3 ${PARTNER_BUTTON_CLASS} ${PARTNER_FOCUS_RING}`}
            style={{ background: PARTNER_BUTTON_BG }}
          >
            {t("payoutBlockedLink")}
          </Link>
        </div>
      )}

      <SaldoKarten entries={saldoEntries} complete={commissions.ok} />

      {commissions.ok && minPayoutCents > 0 && (
        <p className="text-[15px]" style={{ color: PARTNER_INK }}>
          {missingToMinimum > 0
            ? t("minPayoutMissing", { amount: money(missingToMinimum, programCurrency) })
            : t("minPayoutReached", { amount: money(minPayoutCents, programCurrency) })}
        </p>
      )}

      <section aria-labelledby="metrics-heading" className="flex flex-col gap-3">
        <h2 id="metrics-heading" className="text-[17px] font-bold" style={{ color: PARTNER_INK }}>
          {t("metricsHeading")}
        </h2>
        <p className="text-[13px]" style={{ color: PARTNER_MUTED }}>
          {t("rangeHint", { days: RANGE_DAYS })}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PartnerMetric label={t("clicks")} value={metric(totals.clicks)} />
          <PartnerMetric label={t("uniqueClicks")} value={metric(totals.unique_clicks)} />
          <PartnerMetric label={t("leads")} value={metric(totals.leads)} />
          <PartnerMetric label={t("sales")} value={metric(totals.orders_count)} />
          <PartnerMetric label={t("conversion")} value={ratio(derived.conversion_bp)} />
          <PartnerMetric
            label={t("epc")}
            value={
              !stats.ok
                ? t("unavailable")
                : derived.epc_cents === null
                  ? "—"
                  : money(derived.epc_cents, programCurrency)
            }
          />
        </div>
      </section>

      <div
        className={`${PARTNER_CARD_CLASS} p-[16px_18px] text-[15px]`}
        style={{ borderColor: PARTNER_BORDER, color: PARTNER_MUTED }}
      >
        {t("privacyNote")}
      </div>
    </PartnerShell>
  );
}
