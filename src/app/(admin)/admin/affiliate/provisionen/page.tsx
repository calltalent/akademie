import { getFormatter, getTranslations } from "next-intl/server";
import { checkAffiliateManagerAccess } from "@/lib/affiliate/access";
import {
  getAffiliateProgram,
  listAffiliateCommissions,
  listAffiliatePartners,
  listAffiliateProducts,
} from "@/lib/affiliate/queries";
import { AFFILIATE_COMMISSION_STATUSES } from "@/lib/affiliate/types";
import {
  AffiliateAccessNotice,
  AffiliateProgramMissing,
  AffiliateShell,
} from "../affiliate-shell";
import {
  CARD_BORDER,
  CARD_CLASS,
  FOCUS_RING,
  HAIRLINE,
  INK,
  MUTED,
  NAVY,
  bpToRatio,
  centsToAmount,
  currencyCode,
} from "../affiliate-format";
import { ManualBookingForm } from "../manual-booking-form";
import {
  COMMISSION_COLS,
  CommissionRow,
  type CommissionRowData,
} from "./commission-row";

/**
 * Affiliate-System, Block B6-B — `/admin/affiliate/provisionen`
 * (PLAN_Affiliate-System.md 8.1 Zeile 5, 3.11, 6.3, 11.12, 11.15).
 *
 * Zweck laut Plan: „jede Rückfrage zu einem einzelnen Betrag endet hier."
 * Deshalb ist jede Zeile aufklappbar und zeigt den eingefrorenen
 * `condition_snapshot` — die Zeile ist damit ohne jede andere Tabelle
 * nachrechenbar (`commission-row.tsx`).
 *
 * FILTER: alle sieben Werte kommen aus `searchParams` und laufen durch
 * `listAffiliateCommissions()`, das jeden einzeln weißt — Status gegen eine
 * `as const`-Liste, IDs gegen das UUID-Muster, Daten gegen
 * `/^\d{4}-\d{2}-\d{2}$/` (CLAUDE.md §2.12, Plan 11.12). Diese Seite baut
 * keinen einzigen Filterausdruck selbst zusammen; sie reicht die Werte
 * unverändert weiter und verlässt sich auf genau eine Weißung — zwei
 * Weißungen an zwei Orten wären zwei Gelegenheiten, eine zu vergessen.
 *
 * `is_test`-Zeilen sind standardmäßig AUS (4.5): so zeigt die Liste dieselbe
 * Menge, aus der Salden und Auszahlungslauf entstehen. Wer sie einblendet,
 * sieht sie je Zeile als „Testbuchung" gekennzeichnet.
 */

const FILTER_STATUSES = ["all", ...AFFILIATE_COMMISSION_STATUSES] as const;

export default async function AdminAffiliateCommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    partnerId?: string;
    productId?: string;
    from?: string;
    to?: string;
    flagged?: string;
    test?: string;
  }>;
}) {
  const access = await checkAffiliateManagerAccess();
  if (!access.ok) return <AffiliateAccessNotice reason={access.reason} />;

  const t = await getTranslations("admin.affiliate");
  const format = await getFormatter();
  const params = await searchParams;

  const statusParam =
    FILTER_STATUSES.find((value) => value === params.status) ?? "all";
  const flagged = params.flagged === "1";
  const includeTest = params.test === "1";

  const [program, partners, products, rows] = await Promise.all([
    getAffiliateProgram(access.tenant.id),
    listAffiliatePartners(access.tenant.id),
    listAffiliateProducts(access.tenant.id),
    listAffiliateCommissions(access.tenant.id, {
      status: statusParam === "all" ? null : statusParam,
      partnerId: params.partnerId ?? null,
      productId: params.productId ?? null,
      from: params.from ?? null,
      to: params.to ?? null,
      flagged: flagged ? true : null,
      includeTest,
      limit: 500,
    }),
  ]);

  if (program === null) {
    return (
      <AffiliateShell active="commissions" title={t("commissions.title")}>
        <AffiliateProgramMissing />
      </AffiliateShell>
    );
  }

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

  const partnerNameById = new Map(
    partners.rows.map((row) => [row.id, row.display_name]),
  );
  const productTitleById = new Map(
    products.map((product) => [product.id, product.title]),
  );
  const partnerOptions = partners.rows.map((row) => ({
    id: row.id,
    name: row.display_name,
  }));

  const viewRows: CommissionRowData[] = rows.map((row) => ({
    id: row.id,
    partnerId: row.partner_id,
    partnerName:
      partnerNameById.get(row.partner_id) ?? t("overview.partnerUnknown"),
    productText:
      row.product_id === null
        ? t(`commissions.kind.${row.kind}`)
        : (productTitleById.get(row.product_id) ??
          t("commissions.productUnknown")),
    campaign: row.campaign,
    orderId: row.order_id,
    stripeInvoiceId: row.stripe_invoice_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    referralId: row.referral_id,
    dedupKey: row.dedup_key,
    kind: row.kind,
    currency: row.currency,
    status: row.status,
    flagged: row.flagged,
    flagReason: row.flag_reason,
    isTest: row.is_test,
    note: row.note,
    snapshot: row.condition_snapshot,
    dateText: day(row.booked_at),
    baseText: money(row.base_cents, row.currency),
    rateText:
      row.rate_kind === "percent"
        ? format.number(bpToRatio(row.rate_bp), {
            style: "percent",
            maximumFractionDigits: 2,
          })
        : money(row.fixed_cents, row.currency),
    amountText: money(row.amount_cents, row.currency),
    holdUntilText: day(row.hold_until),
  }));

  return (
    <AffiliateShell active="commissions" title={t("commissions.title")}>
      {/* Filter als GET-Formular: der Zustand steht in der Adresse und ist
          damit teilbar („schau dir diese Auswahl an"). */}
      <form
        method="get"
        className={`${CARD_CLASS} p-[20px_24px]`}
        style={{ borderColor: CARD_BORDER }}
      >
        <fieldset className="border-0 p-0">
          <legend className="mb-3 text-[15px] font-bold" style={{ color: INK }}>
            {t("commissions.filter.heading")}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <label
                htmlFor="filter-status"
                className="mb-1.5 block text-[13px] font-semibold"
                style={{ color: MUTED }}
              >
                {t("commissions.filter.status")}
              </label>
              <select
                id="filter-status"
                name="status"
                defaultValue={statusParam}
                className={`min-h-[40px] w-full rounded-[10px] border bg-white px-[13px] py-[11px] text-[15px] ${FOCUS_RING}`}
                style={{ borderColor: CARD_BORDER, color: INK }}
              >
                <option value="all">{t("commissions.filter.all")}</option>
                {AFFILIATE_COMMISSION_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`status.commission.${value}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-partner"
                className="mb-1.5 block text-[13px] font-semibold"
                style={{ color: MUTED }}
              >
                {t("commissions.filter.partner")}
              </label>
              <select
                id="filter-partner"
                name="partnerId"
                defaultValue={params.partnerId ?? ""}
                className={`min-h-[40px] w-full rounded-[10px] border bg-white px-[13px] py-[11px] text-[15px] ${FOCUS_RING}`}
                style={{ borderColor: CARD_BORDER, color: INK }}
              >
                <option value="">{t("commissions.filter.all")}</option>
                {partnerOptions.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-product"
                className="mb-1.5 block text-[13px] font-semibold"
                style={{ color: MUTED }}
              >
                {t("commissions.filter.product")}
              </label>
              <select
                id="filter-product"
                name="productId"
                defaultValue={params.productId ?? ""}
                className={`min-h-[40px] w-full rounded-[10px] border bg-white px-[13px] py-[11px] text-[15px] ${FOCUS_RING}`}
                style={{ borderColor: CARD_BORDER, color: INK }}
              >
                <option value="">{t("commissions.filter.all")}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-from"
                className="mb-1.5 block text-[13px] font-semibold"
                style={{ color: MUTED }}
              >
                {t("commissions.filter.from")}
              </label>
              <input
                id="filter-from"
                name="from"
                type="date"
                defaultValue={params.from ?? ""}
                className={`min-h-[40px] w-full rounded-[10px] border px-[13px] py-[11px] text-[15px] ${FOCUS_RING}`}
                style={{ borderColor: CARD_BORDER, color: INK }}
              />
            </div>

            <div>
              <label
                htmlFor="filter-to"
                className="mb-1.5 block text-[13px] font-semibold"
                style={{ color: MUTED }}
              >
                {t("commissions.filter.to")}
              </label>
              <input
                id="filter-to"
                name="to"
                type="date"
                defaultValue={params.to ?? ""}
                className={`min-h-[40px] w-full rounded-[10px] border px-[13px] py-[11px] text-[15px] ${FOCUS_RING}`}
                style={{ borderColor: CARD_BORDER, color: INK }}
              />
            </div>

            <div className="flex flex-col justify-end gap-2">
              <label
                htmlFor="filter-flagged"
                className="flex min-h-[40px] items-center gap-2 text-[15px]"
                style={{ color: INK }}
              >
                <input
                  id="filter-flagged"
                  name="flagged"
                  type="checkbox"
                  value="1"
                  defaultChecked={flagged}
                  className={FOCUS_RING}
                />
                {t("commissions.filter.flagged")}
              </label>
              <label
                htmlFor="filter-test"
                className="flex min-h-[40px] items-center gap-2 text-[15px]"
                style={{ color: INK }}
              >
                <input
                  id="filter-test"
                  name="test"
                  type="checkbox"
                  value="1"
                  defaultChecked={includeTest}
                  className={FOCUS_RING}
                />
                {t("commissions.filter.test")}
              </label>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              className={`min-h-[44px] rounded-[11px] px-[18px] text-[15px] font-bold text-white ${FOCUS_RING}`}
              style={{ background: "#5663AE" }}
            >
              {t("commissions.filter.apply")}
            </button>
            {/* Zurücksetzen als Link auf die nackte Route: ein `type="reset"`
                setzte nur die Felder zurück, nicht die Abfrage. */}
            <a
              href="/admin/affiliate/provisionen"
              className={`inline-flex min-h-[44px] items-center rounded-[11px] border px-[18px] text-[15px] font-bold no-underline ${FOCUS_RING}`}
              style={{ borderColor: CARD_BORDER, color: NAVY }}
            >
              {t("commissions.filter.reset")}
            </a>
          </div>
        </fieldset>
      </form>

      <p role="status" className="text-[15px]" style={{ color: MUTED }}>
        {t("commissions.resultCount", { count: viewRows.length })}
        {viewRows.length === 500 && ` ${t("commissions.limitHint")}`}
      </p>

      <section
        aria-labelledby="affiliate-commissions-heading"
        className={`${CARD_CLASS} overflow-hidden`}
        style={{ borderColor: CARD_BORDER }}
      >
        <h2 id="affiliate-commissions-heading" className="sr-only">
          {t("commissions.title")}
        </h2>
        <div
          className="rgrid-header px-[24px] pb-2.5 pt-[20px] text-[13px] font-bold"
          style={
            {
              "--rgrid-cols": COMMISSION_COLS,
              color: MUTED,
              borderBottom: `1px solid ${HAIRLINE}`,
            } as React.CSSProperties
          }
        >
          <div>{t("commissions.columnDate")}</div>
          <div>{t("commissions.columnPartner")}</div>
          <div>{t("commissions.columnProduct")}</div>
          <div>{t("commissions.columnCampaign")}</div>
          <div>{t("commissions.columnBase")}</div>
          <div>{t("commissions.columnRate")}</div>
          <div>{t("commissions.columnAmount")}</div>
          <div>{t("commissions.columnStatus")}</div>
        </div>

        {viewRows.length === 0 ? (
          <p className="px-[24px] py-6 text-[15px]" style={{ color: MUTED }}>
            {t("commissions.empty")}
          </p>
        ) : (
          viewRows.map((row) => (
            <CommissionRow key={row.id} row={row} partners={partnerOptions} />
          ))
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <ManualBookingForm
          partners={partnerOptions}
          currency={program.currency}
        />

        {/* CSV-Export mit genau demselben Filter wie die Liste — POST wegen
            der Origin-Prüfung, Begründung in der Route. */}
        <form
          method="post"
          action="/api/admin/affiliate/csv"
          className={`${CARD_CLASS} p-[22px_24px]`}
          style={{ borderColor: CARD_BORDER }}
        >
          <h2 className="text-[17px] font-bold" style={{ color: INK }}>
            {t("commissions.exportCsv")}
          </h2>
          <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
            {t("commissions.exportHint")}
          </p>
          <input type="hidden" name="type" value="commissions" />
          <input
            type="hidden"
            name="status"
            value={statusParam === "all" ? "" : statusParam}
          />
          <input
            type="hidden"
            name="partnerId"
            value={params.partnerId ?? ""}
          />
          <input
            type="hidden"
            name="productId"
            value={params.productId ?? ""}
          />
          <input type="hidden" name="from" value={params.from ?? ""} />
          <input type="hidden" name="to" value={params.to ?? ""} />
          <input type="hidden" name="flagged" value={flagged ? "1" : ""} />
          <input type="hidden" name="test" value={includeTest ? "1" : ""} />
          <button
            type="submit"
            className={`mt-4 min-h-[44px] rounded-[11px] border px-[18px] text-[15px] font-bold ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: NAVY }}
          >
            {t("commissions.exportCsv")}
          </button>
        </form>
      </div>
    </AffiliateShell>
  );
}
