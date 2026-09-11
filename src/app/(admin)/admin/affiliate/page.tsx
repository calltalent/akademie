import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { checkAffiliateManagerAccess } from "@/lib/affiliate/access";
import {
  defaultAffiliateRange,
  getAffiliateDashboardData,
  listAffiliatePartners,
  type AffiliateCommissionAdminRow,
  type AffiliateMetric,
  type AffiliatePartnerListRow,
} from "@/lib/affiliate/queries";
import { AffiliateAccessNotice, AffiliateShell } from "./affiliate-shell";
import {
  CARD_BORDER,
  CARD_CLASS,
  COMMISSION_STATUS_STYLE,
  FOCUS_RING,
  HAIRLINE,
  INK,
  MUTED,
  NAVY,
  PARTNER_STATUS_STYLE,
  bpToRatio,
  centsToAmount,
  currencyCode,
} from "./affiliate-format";

/**
 * Affiliate-System, Block B6-B — `/admin/affiliate`, die Übersicht
 * (PLAN_Affiliate-System.md 8.1, Zeile 1 der Tabelle; 8.5; 8.6).
 *
 * Zweck laut Plan: „in fünf Sekunden sehen, ob das Programm gesund ist."
 * Deshalb steht ALLES als Text. Es gibt auf dieser Seite bewusst kein
 * Diagramm — nicht, weil eines schaden würde, sondern weil jede Zahl, die
 * ausschließlich in einer Grafik existiert, für den Auftraggeber nicht
 * existiert (8.5, CLAUDE.md §3.4).
 *
 * Gate dreistufig (8.1): `checkStaffAccess()` im Layout, hier zusätzlich
 * `checkAffiliateManagerAccess()` — owner/admin, ausdrücklich nicht
 * `trainer` (G10) — und darin der Feature-Schalter. Die Abfragen darunter
 * laufen über `createAdminClient()` (queries.ts) und sind deshalb NUR hinter
 * diesem Gate zulässig.
 *
 * Ehrlichkeit der Kacheln: jede Kennzahl trägt aus `queries.ts` ein
 * `complete`-Flag. Ist es `false`, wurde eine Seite der Abfrage nicht
 * geladen; dann steht „nicht ermittelbar" statt einer zu kleinen Zahl. Eine
 * falsche Geldzahl ist schlimmer als gar keine — und ein sehbehinderter
 * Betrachter hat keine Chance, sie als falsch zu erkennen.
 */

/** `JJJJ-MM-TT`, dieselbe Prüfung wie in `queries.ts` (Plan 11.12). */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const TOP_PARTNER_COLS = "1.6fr 1fr 0.9fr 0.9fr 1.1fr";
const LATEST_COLS = "1fr 1.4fr 1fr 1fr 1fr";

function safeRange(from?: string, to?: string): { from: string; to: string } {
  const fallback = defaultAffiliateRange();
  // Kein Wert aus `searchParams` erreicht je einen Filterausdruck, ohne
  // vorher gegen dieses Muster zu laufen (CLAUDE.md §2.12).
  const okFrom =
    typeof from === "string" && ISO_DATE_PATTERN.test(from)
      ? from
      : fallback.from;
  const okTo =
    typeof to === "string" && ISO_DATE_PATTERN.test(to) ? to : fallback.to;
  // Vertauschte Grenzen ergäben eine leere Menge und damit lautlos „0 Klicks".
  return okFrom <= okTo ? { from: okFrom, to: okTo } : fallback;
}

export default async function AdminAffiliatePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const access = await checkAffiliateManagerAccess();
  if (!access.ok) return <AffiliateAccessNotice reason={access.reason} />;

  const t = await getTranslations("admin.affiliate");
  const format = await getFormatter();
  const params = await searchParams;
  const range = safeRange(params.from, params.to);

  // Die Namen der letzten Buchungen kommen aus der VOLLSTÄNDIGEN Partnerliste
  // und nicht aus den Top-10 der Kachel darüber: eine Buchung eines Partners
  // außerhalb der Top-10 stünde sonst ohne Namen da, und ausgerechnet die
  // ungewohnte Zeile wäre die unleserliche.
  const [data, partners] = await Promise.all([
    getAffiliateDashboardData(access.tenant.id, range),
    listAffiliatePartners(access.tenant.id),
  ]);
  const partnerNameById = new Map(
    partners.rows.map((row) => [row.id, row.display_name]),
  );

  const money = (cents: number, currency: string) =>
    format.number(centsToAmount(cents), {
      style: "currency",
      currency: currencyCode(currency),
    });
  const day = (iso: string) =>
    format.dateTime(new Date(iso), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

  /** Eine Kennzahl als Text — oder als ehrliches „nicht ermittelbar". */
  function metricText(metric: AffiliateMetric): string {
    return metric.complete
      ? format.number(metric.value)
      : t("overview.metricUnavailable");
  }

  const availableText = !data.availableComplete
    ? t("overview.metricUnavailable")
    : data.availableByCurrency.length === 0
      ? money(0, "eur")
      : // Nie über Währungen hinweg summiert (5.11): jede Währung steht für
        // sich, getrennt durch ein Semikolon.
        data.availableByCurrency
          .map((entry) => money(entry.cents, entry.currency))
          .join("; ");

  const reversalText =
    data.reversalRateBp === null
      ? t("overview.reversalRateUnknown")
      : format.number(bpToRatio(data.reversalRateBp), {
          style: "percent",
          maximumFractionDigits: 2,
        });

  const backlogTotal = data.eventBacklog.pending + data.eventBacklog.errored;

  return (
    <AffiliateShell
      active="overview"
      title={t("overview.title")}
      description={t("description")}
    >
      {/* Zeitraum: natives Formular per GET. Kein Client-Zustand, keine
          JavaScript-Abhängigkeit — die Seite ist nach dem Absenden dieselbe
          Server Component mit anderen `searchParams`. */}
      <form
        method="get"
        className={`${CARD_CLASS} flex flex-wrap items-end gap-4 p-[20px_24px]`}
        style={{ borderColor: CARD_BORDER }}
      >
        <fieldset className="flex flex-wrap items-end gap-4 border-0 p-0">
          <legend
            className="mb-2 text-[13px] font-bold"
            style={{ color: MUTED }}
          >
            {t("overview.rangeLabel")}
          </legend>
          <div>
            <label
              htmlFor="range-from"
              className="mb-1.5 block text-[13px] font-semibold"
              style={{ color: MUTED }}
            >
              {t("overview.rangeFrom")}
            </label>
            <input
              id="range-from"
              name="from"
              type="date"
              defaultValue={range.from}
              className={`min-h-[40px] rounded-[10px] border px-[13px] py-[11px] text-[15px] ${FOCUS_RING}`}
              style={{ borderColor: CARD_BORDER, color: INK }}
            />
          </div>
          <div>
            <label
              htmlFor="range-to"
              className="mb-1.5 block text-[13px] font-semibold"
              style={{ color: MUTED }}
            >
              {t("overview.rangeTo")}
            </label>
            <input
              id="range-to"
              name="to"
              type="date"
              defaultValue={range.to}
              className={`min-h-[40px] rounded-[10px] border px-[13px] py-[11px] text-[15px] ${FOCUS_RING}`}
              style={{ borderColor: CARD_BORDER, color: INK }}
            />
          </div>
          <button
            type="submit"
            className={`min-h-[40px] rounded-[11px] px-[18px] text-[15px] font-bold text-white ${FOCUS_RING}`}
            style={{ background: "#5663AE" }}
          >
            {t("overview.applyRange")}
          </button>
        </fieldset>
        <p className="text-[15px]" style={{ color: MUTED }}>
          {t("overview.rangeValue", {
            from: day(range.from),
            to: day(range.to),
          })}
        </p>
      </form>

      {/* Vier Kennzahlen, alle als Text (8.1/8.5). */}
      <section aria-labelledby="affiliate-metrics-heading">
        <h2 id="affiliate-metrics-heading" className="sr-only">
          {t("overview.metricsHeading")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              key: "clicks",
              label: t("overview.clicks"),
              value: metricText(data.clicks),
            },
            {
              key: "sales",
              label: t("overview.sales"),
              value: metricText(data.orders),
            },
            {
              key: "available",
              label: t("overview.availableCommission"),
              value: availableText,
            },
            {
              key: "reversal",
              label: t("overview.reversalRate"),
              value: reversalText,
            },
          ].map((tile) => (
            <div
              key={tile.key}
              className={`${CARD_CLASS} p-[20px_24px]`}
              style={{ borderColor: CARD_BORDER }}
            >
              <p
                className="text-[13px] font-bold uppercase tracking-[0.04em]"
                style={{ color: MUTED }}
              >
                {tile.label}
              </p>
              {/* Keine feste Höhe: bei 200 % Zoom muss der Wert umbrechen
                  dürfen, statt abgeschnitten zu werden (8.5). */}
              <p
                className="mt-1 text-[24px] font-extrabold"
                style={{ color: INK, lineHeight: 1.3 }}
              >
                {tile.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Warnungen. `role="status"`, nicht `role="alert"`: sie sind beim
          Laden schon da und sollen den Screenreader nicht unterbrechen. */}
      {(backlogTotal > 0 || data.flagged.value > 0) && (
        <section
          aria-labelledby="affiliate-warnings-heading"
          className="flex flex-col gap-3"
        >
          <h2
            id="affiliate-warnings-heading"
            className="text-[17px] font-bold"
            style={{ color: INK }}
          >
            {t("overview.warningsHeading")}
          </h2>
          {backlogTotal > 0 && (
            <div
              role="status"
              className="rounded-[14px] border p-[16px_20px] text-[15px]"
              style={{
                borderColor: "#E7C98F",
                background: "#FBF1DC",
                color: "#6B5312",
              }}
            >
              <p className="font-bold">
                {t("overview.unprocessedEvents", { count: backlogTotal })}
              </p>
              {data.eventBacklog.errored > 0 && (
                <p className="mt-1">
                  {t("overview.unprocessedErrored", {
                    count: data.eventBacklog.errored,
                  })}
                </p>
              )}
              {data.eventBacklog.oldestAt !== null && (
                <p className="mt-1">
                  {t("overview.unprocessedOldest", {
                    date: day(data.eventBacklog.oldestAt),
                  })}
                </p>
              )}
              {/* Bewusst ohne Link: eine Ereignisliste gibt es in dieser
                  Ausbaustufe nicht, und ein Link auf eine Seite, die es nicht
                  gibt, kostet den Betreiber einen Ladevorgang, um festzustellen,
                  dass er nichts sieht. Der Nachhol-Lauf hängt am Cron (9.7). */}
              <p className="mt-1">{t("overview.unprocessedHint")}</p>
            </div>
          )}
          {data.flagged.value > 0 && (
            <div
              role="status"
              className="rounded-[14px] border p-[16px_20px] text-[15px]"
              style={{
                borderColor: "#E7C98F",
                background: "#FBF1DC",
                color: "#6B5312",
              }}
            >
              <p className="font-bold">
                {t("overview.flaggedCommissions", {
                  count: data.flagged.value,
                })}
              </p>
              <Link
                href="/admin/affiliate/provisionen?flagged=1"
                prefetch={false}
                className={`mt-1 inline-flex min-h-[40px] items-center font-bold underline ${FOCUS_RING}`}
                style={{ color: "#6B5312" }}
              >
                {t("overview.flaggedLink")}
              </Link>
            </div>
          )}
        </section>
      )}

      {/* Offene Bewerbungen. */}
      <section
        aria-labelledby="affiliate-applications-heading"
        className={`${CARD_CLASS} p-[20px_24px]`}
        style={{ borderColor: CARD_BORDER }}
      >
        <h2
          id="affiliate-applications-heading"
          className="text-[17px] font-bold"
          style={{ color: INK }}
        >
          {t("overview.openApplications", {
            count: data.openApplications.value,
          })}
        </h2>
        {data.openApplications.value === 0 ? (
          <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
            {t("overview.openApplicationsEmpty")}
          </p>
        ) : (
          <Link
            href="/admin/affiliate/partner?status=pending"
            prefetch={false}
            className={`mt-2 inline-flex min-h-[40px] items-center rounded-[11px] px-[18px] text-[15px] font-bold text-white no-underline ${FOCUS_RING}`}
            style={{ background: "#5663AE" }}
          >
            {t("overview.openApplicationsLink")}
          </Link>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Top-10-Partner. */}
        <section
          aria-labelledby="affiliate-top-heading"
          className={`${CARD_CLASS} overflow-hidden`}
          style={{ borderColor: CARD_BORDER }}
        >
          <h2
            id="affiliate-top-heading"
            className="p-[20px_24px_12px] text-[17px] font-bold"
            style={{ color: INK }}
          >
            {t("overview.topPartners")}
          </h2>
          <div
            className="rgrid-header px-[24px] pb-2.5 text-[13px] font-bold"
            style={
              {
                "--rgrid-cols": TOP_PARTNER_COLS,
                color: MUTED,
                borderBottom: `1px solid ${HAIRLINE}`,
              } as React.CSSProperties
            }
          >
            <div>{t("partners.columnName")}</div>
            <div>{t("partners.columnCode")}</div>
            <div>{t("partners.columnClicks")}</div>
            <div>{t("partners.columnSales")}</div>
            <div>{t("partners.columnAvailable")}</div>
          </div>
          {data.topPartners.length === 0 ? (
            <p className="px-[24px] py-6 text-[15px]" style={{ color: MUTED }}>
              {t("overview.topPartnersEmpty")}
            </p>
          ) : (
            data.topPartners.map((row) => (
              <TopPartnerRow
                key={row.partner.id}
                row={row}
                statusLabel={t(`status.partner.${row.partner.status}`)}
                clicksLabel={t("partners.columnClicks")}
                salesLabel={t("partners.columnSales")}
                availableLabel={t("partners.columnAvailable")}
                codeLabel={t("partners.columnCode")}
                clicksText={format.number(row.clicks30d)}
                salesText={format.number(row.orders30d)}
                availableText={
                  row.balances.length === 0
                    ? money(0, data.program?.currency ?? "eur")
                    : row.balances
                        .map((balance) =>
                          money(balance.available_cents, balance.currency),
                        )
                        .join("; ")
                }
              />
            ))
          )}
        </section>

        {/* Letzte Buchungen. */}
        <section
          aria-labelledby="affiliate-latest-heading"
          className={`${CARD_CLASS} overflow-hidden`}
          style={{ borderColor: CARD_BORDER }}
        >
          <h2
            id="affiliate-latest-heading"
            className="p-[20px_24px_12px] text-[17px] font-bold"
            style={{ color: INK }}
          >
            {t("overview.recentCommissions")}
          </h2>
          <div
            className="rgrid-header px-[24px] pb-2.5 text-[13px] font-bold"
            style={
              {
                "--rgrid-cols": LATEST_COLS,
                color: MUTED,
                borderBottom: `1px solid ${HAIRLINE}`,
              } as React.CSSProperties
            }
          >
            <div>{t("commissions.columnDate")}</div>
            <div>{t("commissions.columnPartner")}</div>
            <div>{t("commissions.columnCampaign")}</div>
            <div>{t("commissions.columnAmount")}</div>
            <div>{t("commissions.columnStatus")}</div>
          </div>
          {data.latestCommissions.length === 0 ? (
            <p className="px-[24px] py-6 text-[15px]" style={{ color: MUTED }}>
              {t("overview.recentCommissionsEmpty")}
            </p>
          ) : (
            data.latestCommissions.map((row) => (
              <LatestCommissionRow
                key={row.id}
                row={row}
                partnerName={
                  partnerNameById.get(row.partner_id) ??
                  t("overview.partnerUnknown")
                }
                dateText={day(row.booked_at)}
                amountText={money(row.amount_cents, row.currency)}
                statusLabel={t(`status.commission.${row.status}`)}
                campaignText={row.campaign ?? t("commissions.noCampaign")}
                labels={{
                  date: t("commissions.columnDate"),
                  partner: t("commissions.columnPartner"),
                  campaign: t("commissions.columnCampaign"),
                  amount: t("commissions.columnAmount"),
                  status: t("commissions.columnStatus"),
                }}
              />
            ))
          )}
          <div className="p-[16px_24px]">
            <Link
              href="/admin/affiliate/provisionen"
              prefetch={false}
              className={`inline-flex min-h-[40px] items-center font-bold underline ${FOCUS_RING}`}
              style={{ color: "#5663AE" }}
            >
              {t("overview.allCommissionsLink")}
            </Link>
          </div>
        </section>
      </div>

      {/* CSV-Export als POST-Formular, nicht als Link — Begründung in
          src/app/api/admin/affiliate/csv/route.ts (Origin-Prüfung). */}
      <form
        method="post"
        action="/api/admin/affiliate/csv"
        className={`${CARD_CLASS} flex flex-wrap items-center gap-4 p-[20px_24px]`}
        style={{ borderColor: CARD_BORDER }}
      >
        <input type="hidden" name="type" value="partners" />
        <input type="hidden" name="from" value={range.from} />
        <input type="hidden" name="to" value={range.to} />
        <p className="text-[15px]" style={{ color: MUTED }}>
          {t("overview.exportHint")}
        </p>
        <button
          type="submit"
          className={`min-h-[40px] rounded-[11px] border px-[18px] text-[15px] font-bold ${FOCUS_RING}`}
          style={{ borderColor: CARD_BORDER, color: NAVY }}
        >
          {t("overview.exportCsv")}
        </button>
      </form>
    </AffiliateShell>
  );
}

function TopPartnerRow({
  row,
  statusLabel,
  codeLabel,
  clicksLabel,
  salesLabel,
  availableLabel,
  clicksText,
  salesText,
  availableText,
}: {
  row: AffiliatePartnerListRow;
  statusLabel: string;
  codeLabel: string;
  clicksLabel: string;
  salesLabel: string;
  availableLabel: string;
  clicksText: string;
  salesText: string;
  availableText: string;
}) {
  const style = PARTNER_STATUS_STYLE[row.partner.status];
  return (
    <div
      className="rgrid-row px-[18px] py-4 text-[15px] lg:px-[24px]"
      style={
        {
          "--rgrid-cols": TOP_PARTNER_COLS,
          borderBottom: `1px solid ${HAIRLINE}`,
        } as React.CSSProperties
      }
    >
      <div className="min-w-0">
        <Link
          href={`/admin/affiliate/partner/${row.partner.id}`}
          prefetch={false}
          className={`font-semibold underline ${FOCUS_RING}`}
          style={{ color: NAVY }}
        >
          {row.partner.display_name}
        </Link>
        <span
          className="ml-2 inline-flex rounded-lg px-2.5 py-0.5 text-[13px] font-bold"
          style={style}
        >
          {statusLabel}
        </span>
      </div>
      <div>
        <span className="rgrid-label">{codeLabel}</span>
        <span style={{ color: MUTED }}>{row.partner.code}</span>
      </div>
      <div>
        <span className="rgrid-label">{clicksLabel}</span>
        <span style={{ color: INK }}>{clicksText}</span>
      </div>
      <div>
        <span className="rgrid-label">{salesLabel}</span>
        <span style={{ color: INK }}>{salesText}</span>
      </div>
      <div>
        <span className="rgrid-label">{availableLabel}</span>
        <span className="font-semibold" style={{ color: INK }}>
          {availableText}
        </span>
      </div>
    </div>
  );
}

function LatestCommissionRow({
  row,
  partnerName,
  dateText,
  amountText,
  statusLabel,
  campaignText,
  labels,
}: {
  row: AffiliateCommissionAdminRow;
  partnerName: string;
  dateText: string;
  amountText: string;
  statusLabel: string;
  campaignText: string;
  labels: {
    date: string;
    partner: string;
    campaign: string;
    amount: string;
    status: string;
  };
}) {
  return (
    <div
      className="rgrid-row px-[18px] py-4 text-[15px] lg:px-[24px]"
      style={
        {
          "--rgrid-cols": LATEST_COLS,
          borderBottom: `1px solid ${HAIRLINE}`,
        } as React.CSSProperties
      }
    >
      <div>
        <span className="rgrid-label">{labels.date}</span>
        <span style={{ color: MUTED }}>{dateText}</span>
      </div>
      <div className="min-w-0">
        <span className="rgrid-label">{labels.partner}</span>
        <span className="truncate font-semibold" style={{ color: INK }}>
          {partnerName}
        </span>
      </div>
      <div className="min-w-0">
        <span className="rgrid-label">{labels.campaign}</span>
        <span className="truncate" style={{ color: MUTED }}>
          {campaignText}
        </span>
      </div>
      <div>
        <span className="rgrid-label">{labels.amount}</span>
        <span className="font-semibold" style={{ color: INK }}>
          {amountText}
        </span>
      </div>
      <div>
        <span className="rgrid-label">{labels.status}</span>
        <span
          className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
          style={COMMISSION_STATUS_STYLE[row.status]}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  );
}
