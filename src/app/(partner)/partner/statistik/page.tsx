import { getFormatter, getTranslations } from "next-intl/server";
import { checkAffiliatePartnerAccess } from "@/lib/affiliate/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  AFFILIATE_STATEMENT_COLUMNS,
  collectPages,
  deriveStats,
  groupStats,
  sumStats,
  type AffiliateStatementRow,
  type AffiliateStatsInput,
} from "@/lib/affiliate/statement";
import {
  PartnerAccessNotice,
  PartnerMetric,
  PartnerShell,
  PARTNER_BORDER,
  PARTNER_BUTTON_BG,
  PARTNER_BUTTON_CLASS,
  PARTNER_CARD_CLASS,
  PARTNER_FOCUS_RING,
  PARTNER_HAIRLINE,
  PARTNER_INK,
  PARTNER_MUTED,
} from "@/components/affiliate/partner-shell";
import { Zeitreihe, type ZeitreihePunkt } from "@/components/affiliate/zeitreihe";

/**
 * Affiliate-System, Block B7-A — `/partner/statistik`
 * (PLAN_Affiliate-System.md 8.2 Zeile 3, 3.14, 8.5, 11.12).
 *
 * ## Quelle
 *
 * Für Klicks, eindeutige Klicks, Leads, Verkäufe und Provision ist
 * `affiliate_daily_stats` die einzige Quelle (8.2, letzter Satz der Zeile).
 * `affiliate_clicks` wird nach 90 Tagen gelöscht (3.6) und taugt für keine
 * Zeitreihe.
 *
 * ## ABWEICHUNG: die Aufschlüsselung „nach Produkt"
 *
 * Der Plan nennt drei Aufschlüsselungen — Tag, Produkt, Kampagne — und als
 * Quelle ausschließlich `affiliate_daily_stats`. Beides zusammen geht nicht:
 * die Tabelle hat die Schlüssel `(tenant_id, partner_id, day, campaign)` und
 * KEINE Produktspalte (3.14). Eine Produktzeile mit erfundenen Klickzahlen
 * wäre die schlechteste aller Antworten.
 *
 * Deshalb: Tag und Kampagne kommen vollständig aus `affiliate_daily_stats`.
 * Die Produktsicht kommt aus den eigenen Buchungszeilen (`product_id` steht
 * im SELECT-Spaltenrecht des Partners) und zeigt genau die zwei Größen, die
 * es dort gibt — Verkäufe und Provision. Dass Klicks je Produkt nicht
 * gemessen werden, steht als Satz daneben, statt als Null in einer Spalte.
 *
 * ## Filter
 *
 * Zeitraum aus `searchParams`, jeder Wert gegen `JJJJ-MM-TT` geprüft, bevor
 * er einen Filter erreicht (CLAUDE.md §2.12). Die Aufschlüsselung läuft
 * gegen eine `as const`-Liste — ein unbekannter Wert fällt auf „Tag"
 * zurück, nicht in eine Abfrage.
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GROUPS = ["day", "campaign", "product"] as const;
type GroupId = (typeof GROUPS)[number];
const DEFAULT_RANGE_DAYS = 30;

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function safeRange(from?: string, to?: string): { from: string; to: string } {
  const now = new Date();
  const fallback = {
    from: isoDay(new Date(now.getTime() - (DEFAULT_RANGE_DAYS - 1) * 86_400_000)),
    to: isoDay(now),
  };
  const okFrom = typeof from === "string" && ISO_DATE_PATTERN.test(from) ? from : fallback.from;
  const okTo = typeof to === "string" && ISO_DATE_PATTERN.test(to) ? to : fallback.to;
  // Vertauschte Grenzen ergäben eine leere Menge und damit lautlos „0 Klicks".
  return okFrom <= okTo ? { from: okFrom, to: okTo } : fallback;
}

type DailyRow = AffiliateStatsInput & { day: string; campaign: string };

export default async function PartnerStatistikPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; group?: string }>;
}) {
  const access = await checkAffiliatePartnerAccess();
  if (!access.ok) return <PartnerAccessNotice reason={access.reason} />;

  const params = await searchParams;
  const range = safeRange(params.from, params.to);
  const group: GroupId = GROUPS.find((value) => value === params.group) ?? "day";

  const supabase = await createClient();
  const t = await getTranslations("affiliate.statistics");
  const format = await getFormatter();

  const [{ data: program }, daily, commissions] = await Promise.all([
    supabase
      .from("affiliate_programs")
      .select("id, currency, tier2_enabled")
      .eq("tenant_id", access.tenant.id)
      .maybeSingle(),
    collectPages<DailyRow>((rangeFrom, rangeTo) =>
      supabase
        .from("affiliate_daily_stats")
        .select("day, campaign, clicks, unique_clicks, leads, orders_count, revenue_cents, commission_cents, reversal_cents")
        .eq("tenant_id", access.tenant.id)
        .eq("partner_id", access.partnerId)
        .gte("day", range.from)
        .lte("day", range.to)
        .order("day", { ascending: true })
        .order("campaign", { ascending: true })
        .range(rangeFrom, rangeTo) as unknown as PromiseLike<{
        data: DailyRow[] | null;
        error: unknown;
      }>,
    ),
    group === "product"
      ? collectPages<AffiliateStatementRow>((rangeFrom, rangeTo) =>
          supabase
            .from("affiliate_commissions")
            .select(AFFILIATE_STATEMENT_COLUMNS)
            .eq("tenant_id", access.tenant.id)
            .eq("partner_id", access.partnerId)
            .gte("booked_at", range.from)
            .lte("booked_at", range.to)
            .order("id", { ascending: true })
            .range(rangeFrom, rangeTo) as unknown as PromiseLike<{
            data: AffiliateStatementRow[] | null;
            error: unknown;
          }>,
        )
      : Promise.resolve({ ok: true, rows: [] as AffiliateStatementRow[] }),
  ]);

  const currency = program?.currency ?? "eur";
  const code = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "EUR";
  const money = (cents: number): string =>
    format.number(cents / 100, { style: "currency", currency: code });
  const ratio = (bp: number | null): string =>
    bp === null ? "—" : format.number(bp / 10000, { style: "percent", maximumFractionDigits: 2 });

  const totals = sumStats(daily.rows);
  const derived = deriveStats(totals);

  const dayLabel = (iso: string): string =>
    format.dateTime(new Date(`${iso}T00:00:00.000Z`), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

  const points: ZeitreihePunkt[] =
    group === "campaign"
      ? groupStats(daily.rows, (row) => row.campaign).map((entry) => ({
          key: entry.key === "" ? "—" : entry.key,
          // Die leere Kampagne ist der Normalfall „Link ohne `cam=`" und
          // bekommt einen sprechenden Namen statt einer leeren Zelle.
          label: entry.key === "" ? t("campaignNone") : entry.key,
          clicks: entry.stats.clicks,
          unique_clicks: entry.stats.unique_clicks,
          orders: entry.stats.orders_count,
          commission_cents: entry.stats.commission_cents,
        }))
      : groupStats(daily.rows, (row) => row.day).map((entry) => ({
          key: entry.key,
          label: dayLabel(entry.key),
          clicks: entry.stats.clicks,
          unique_clicks: entry.stats.unique_clicks,
          orders: entry.stats.orders_count,
          commission_cents: entry.stats.commission_cents,
        }));

  // Produktsicht: Titel NACH dem Gate über den Admin-Client, ausdrückliche
  // Spaltenliste (8.2, 11.10). Ein Partner liest `products` nicht per RLS.
  let productRows: Array<{ title: string; orders: number; commissionCents: number }> = [];
  if (group === "product") {
    const byProduct = new Map<string, { orders: number; commissionCents: number }>();
    for (const row of commissions.rows) {
      if (row.is_test || row.status === "cancelled") continue;
      const key = row.product_id ?? "";
      const entry = byProduct.get(key) ?? { orders: 0, commissionCents: 0 };
      // „Verkauf" ist die `sale`-Zeile; Reserve, Zweitstufe und Storno
      // gehören zum selben Verkauf und würden ihn sonst mehrfach zählen.
      if (row.kind === "sale") entry.orders += 1;
      entry.commissionCents += row.amount_cents;
      byProduct.set(key, entry);
    }

    const ids = [...byProduct.keys()].filter((id) => id !== "");
    const titles = new Map<string, string>();
    if (ids.length > 0) {
      const admin = createAdminClient();
      const { data: products } = await admin
        .from("products")
        .select("id, title")
        .eq("tenant_id", access.tenant.id)
        .in("id", ids);
      for (const product of products ?? []) titles.set(product.id, product.title);
    }

    productRows = [...byProduct.entries()]
      .map(([id, value]) => ({
        title: id === "" ? t("productNone") : (titles.get(id) ?? t("productNone")),
        orders: value.orders,
        commissionCents: value.commissionCents,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  const PRODUCT_COLS = "2fr 1fr 1fr";

  return (
    <PartnerShell
      active="statistics"
      title={t("title")}
      tenantName={access.tenant.name}
      logoUrl={access.tenant.branding?.logo_url ?? null}
      showTeam={program?.tier2_enabled === true}
    >
      {/* Filter als gewöhnliches GET-Formular: native Felder, kein
          JavaScript, Zurück-Taste und Lesezeichen funktionieren. */}
      <form
        method="get"
        className={`${PARTNER_CARD_CLASS} flex flex-wrap items-end gap-4 p-[18px_20px]`}
        style={{ borderColor: PARTNER_BORDER }}
      >
        <div>
          <label
            className="mb-1 block text-[13px] font-semibold"
            style={{ color: PARTNER_INK }}
            htmlFor="stats-from"
          >
            {t("rangeLabel")}
          </label>
          <input
            id="stats-from"
            name="from"
            type="date"
            defaultValue={range.from}
            className={`min-h-[40px] rounded-[10px] border bg-white px-3 py-2 text-[15px] ${PARTNER_FOCUS_RING}`}
            style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
          />
        </div>
        <div>
          <label
            className="mb-1 block text-[13px] font-semibold"
            style={{ color: PARTNER_INK }}
            htmlFor="stats-to"
          >
            {t("rangeToLabel")}
          </label>
          <input
            id="stats-to"
            name="to"
            type="date"
            defaultValue={range.to}
            className={`min-h-[40px] rounded-[10px] border bg-white px-3 py-2 text-[15px] ${PARTNER_FOCUS_RING}`}
            style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
          />
        </div>
        <div>
          <label
            className="mb-1 block text-[13px] font-semibold"
            style={{ color: PARTNER_INK }}
            htmlFor="stats-group"
          >
            {t("groupLabel")}
          </label>
          <select
            id="stats-group"
            name="group"
            defaultValue={group}
            className={`min-h-[40px] rounded-[10px] border bg-white px-3 py-2 text-[15px] ${PARTNER_FOCUS_RING}`}
            style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
          >
            <option value="day">{t("groupDay")}</option>
            <option value="campaign">{t("groupCampaign")}</option>
            <option value="product">{t("groupProduct")}</option>
          </select>
        </div>
        <button
          type="submit"
          className={`${PARTNER_BUTTON_CLASS} ${PARTNER_FOCUS_RING}`}
          style={{ background: PARTNER_BUTTON_BG }}
        >
          {t("apply")}
        </button>
      </form>

      {!daily.ok && (
        <p role="alert" className="text-[15px] font-semibold" style={{ color: "#B24343" }}>
          {t("incomplete")}
        </p>
      )}

      {/* Die Gesamtkennzahlen zuerst als Text — vor jeder Aufschlüsselung
          und vor jedem Diagramm (8.5). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <PartnerMetric label={t("columnClicks")} value={format.number(totals.clicks)} />
        <PartnerMetric label={t("columnUniqueClicks")} value={format.number(totals.unique_clicks)} />
        <PartnerMetric label={t("columnLeads")} value={format.number(totals.leads)} />
        <PartnerMetric label={t("columnSales")} value={format.number(totals.orders_count)} />
        <PartnerMetric label={t("columnConversion")} value={ratio(derived.conversion_bp)} />
        <PartnerMetric
          label={t("columnEpc")}
          value={derived.epc_cents === null ? "—" : money(derived.epc_cents)}
        />
        <PartnerMetric label={t("columnCommission")} value={money(totals.commission_cents)} />
        <PartnerMetric
          label={t("columnReversalRate")}
          value={ratio(derived.reversal_rate_bp)}
        />
      </div>

      {group === "product" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[17px] font-bold" style={{ color: PARTNER_INK }}>
            {t("groupProduct")}
          </h2>
          <p className="text-[15px]" style={{ color: PARTNER_MUTED }}>
            {t("productNote")}
          </p>
          {productRows.length === 0 ? (
            <p className="text-[15px]" style={{ color: PARTNER_MUTED }}>
              {t("empty")}
            </p>
          ) : (
            <div
              role="table"
              aria-label={t("groupProduct")}
              className={`${PARTNER_CARD_CLASS} overflow-hidden`}
              style={{ borderColor: PARTNER_BORDER }}
            >
              <div
                role="row"
                className="rgrid-header px-[18px] py-3 text-[13px] font-bold lg:px-[24px]"
                style={
                  {
                    "--rgrid-cols": PRODUCT_COLS,
                    color: PARTNER_MUTED,
                    borderBottom: `1px solid ${PARTNER_HAIRLINE}`,
                  } as React.CSSProperties
                }
              >
                <div role="columnheader">{t("columnProduct")}</div>
                <div role="columnheader">{t("columnSales")}</div>
                <div role="columnheader">{t("columnCommission")}</div>
              </div>
              {productRows.map((row) => (
                <div
                  key={row.title}
                  role="row"
                  className="rgrid-row px-[18px] py-3 text-[15px] lg:px-[24px]"
                  style={
                    {
                      "--rgrid-cols": PRODUCT_COLS,
                      borderBottom: `1px solid ${PARTNER_HAIRLINE}`,
                      color: PARTNER_INK,
                    } as React.CSSProperties
                  }
                >
                  <div role="cell" className="font-semibold">
                    {row.title}
                  </div>
                  <div role="cell">
                    <span className="rgrid-label">{t("columnSales")}</span>
                    {format.number(row.orders)}
                  </div>
                  <div role="cell">
                    <span className="rgrid-label">{t("columnCommission")}</span>
                    {money(row.commissionCents)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <Zeitreihe
          points={points}
          currency={currency}
          heading={group === "campaign" ? t("groupCampaign") : t("groupDay")}
          firstColumnLabel={group === "campaign" ? t("columnCampaign") : t("columnDay")}
        />
      )}

      {/* CSV per POST-Formular, nicht per Link: `verifySameOrigin()` ist
          fail-closed, und ein Browser sendet `Origin` bei einer gewöhnlichen
          Navigation nicht mit (Begründung in der Route). */}
      <form action="/api/affiliate/csv" method="post">
        <input type="hidden" name="type" value="stats" />
        <input type="hidden" name="from" value={range.from} />
        <input type="hidden" name="to" value={range.to} />
        <input type="hidden" name="group" value={group} />
        <button
          type="submit"
          className={`${PARTNER_BUTTON_CLASS} ${PARTNER_FOCUS_RING}`}
          style={{ background: PARTNER_BUTTON_BG }}
        >
          {t("exportCsv")}
        </button>
      </form>
    </PartnerShell>
  );
}
