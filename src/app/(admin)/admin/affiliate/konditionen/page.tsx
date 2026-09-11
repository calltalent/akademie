import { getFormatter, getTranslations } from "next-intl/server";
import { checkAffiliateManagerAccess } from "@/lib/affiliate/access";
import {
  getAffiliateProgram,
  listAffiliateConditions,
  listAffiliateGroups,
  listAffiliatePartners,
  listAffiliateProducts,
  previewAffiliateCommission,
} from "@/lib/affiliate/queries";
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
  bpToRatio,
  centsToAmount,
  conditionScopeKind,
  currencyCode,
} from "../affiliate-format";
import { ConditionForm } from "./condition-form";
import { CONDITION_COLS, ConditionRow } from "./condition-row";

/**
 * Affiliate-System, Block B6-B — `/admin/affiliate/konditionen`
 * (PLAN_Affiliate-System.md 8.1 Zeile 4, 5.1–5.4, 8.5).
 *
 * Zweck laut Plan: „die Vorrangkette sichtbar und prüfbar machen." Die Liste
 * steht deshalb in exakt der Reihenfolge, in der `resolveCondition()` prüft,
 * und trägt diese Reihenfolge als Spalte „Rang".
 *
 * DER RECHNER IST DER EIGENTLICHE GRUND FÜR DIESE SEITE. Er ruft
 * `previewAffiliateCommission()` (queries.ts) und damit DIESELBEN reinen
 * Funktionen wie der Verarbeiter: `computeBaseCents` → `resolveCondition` →
 * `computeCommissionParts`. Es gibt keine zweite Formel in dieser Datei und
 * keine im Browser. Zwei Rechenwege, die auseinanderlaufen, sind ein Streit
 * mit dem Partner — und derjenige, der ihn führt, hat die Zahl aus genau
 * diesem Rechner.
 *
 * Der Rechner ist ein GET-Formular: die Eingabe steht in der Adresse, das
 * Ergebnis entsteht auf dem Server, und die Seite funktioniert ohne
 * JavaScript. Ein Rechner, der im Browser rechnet, wäre der zweite Rechenweg.
 *
 * `calcPartner`/`calcProduct` sind client-geliefert und laufen deshalb erst
 * gegen das UUID-Muster (CLAUDE.md §2.12) und dann in die Abfrage, die ihre
 * Mandantenbindung prüft (§2.15): ein fremder Partner und ein erfundener
 * ergeben dasselbe Ergebnis — „keine Vorschau".
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `JJJJ-MM-TTThh:mm` für `<input type="datetime-local">`. */
function toDateTimeLocal(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

export default async function AdminAffiliateConditionsPage({
  searchParams,
}: {
  searchParams: Promise<{ calcPartner?: string; calcProduct?: string }>;
}) {
  const access = await checkAffiliateManagerAccess();
  if (!access.ok) return <AffiliateAccessNotice reason={access.reason} />;

  const t = await getTranslations("admin.affiliate");
  const format = await getFormatter();
  const { calcPartner, calcProduct } = await searchParams;

  const [program, conditions, partners, groups, products] = await Promise.all([
    getAffiliateProgram(access.tenant.id),
    listAffiliateConditions(access.tenant.id),
    listAffiliatePartners(access.tenant.id),
    listAffiliateGroups(access.tenant.id),
    listAffiliateProducts(access.tenant.id),
  ]);

  if (program === null) {
    return (
      <AffiliateShell active="conditions" title={t("conditions.title")}>
        <AffiliateProgramMissing />
      </AffiliateShell>
    );
  }

  const money = (cents: number, currency: string) =>
    format.number(centsToAmount(cents), {
      style: "currency",
      currency: currencyCode(currency),
    });
  const percent = (bp: number) =>
    format.number(bpToRatio(bp), {
      style: "percent",
      maximumFractionDigits: 2,
    });
  const dayTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const partnerNameById = new Map(
    partners.rows.map((row) => [row.id, row.display_name]),
  );
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));
  const productTitleById = new Map(
    products.map((product) => [product.id, product.title]),
  );

  const partnerOptions = partners.rows.map((row) => ({
    id: row.id,
    name: row.display_name,
  }));
  const groupOptions = groups.map((group) => ({
    id: group.id,
    name: group.name,
  }));
  const productOptions = products.map((product) => ({
    id: product.id,
    title: product.title,
  }));

  // `new Date()` in einer async Server Component: einmal je Anfrage, kein
  // Re-Render (gleiche Begründung wie in abgaben/page.tsx).
  const defaultValidFrom = toDateTimeLocal(new Date());

  // --- Rechner ----------------------------------------------------------
  const calcPartnerId =
    typeof calcPartner === "string" && UUID_PATTERN.test(calcPartner)
      ? calcPartner
      : null;
  const calcProductId =
    typeof calcProduct === "string" && UUID_PATTERN.test(calcProduct)
      ? calcProduct
      : null;

  const preview =
    calcPartnerId === null
      ? null
      : await previewAffiliateCommission({
          tenantId: access.tenant.id,
          partnerId: calcPartnerId,
          productId: calcProductId,
        });

  const previewRank =
    preview === null || preview.resolution.condition_id === null
      ? null
      : conditions.findIndex(
          (row) => row.id === preview.resolution.condition_id,
        ) + 1;

  return (
    <AffiliateShell
      active="conditions"
      title={t("conditions.title")}
      description={t("conditions.description")}
    >
      {/* Programmstandard — die unterste Stufe der Vorrangkette (5.2). */}
      <section
        aria-labelledby="affiliate-default-heading"
        className={`${CARD_CLASS} p-[22px_24px]`}
        style={{ borderColor: CARD_BORDER }}
      >
        <h2
          id="affiliate-default-heading"
          className="text-[17px] font-bold"
          style={{ color: INK }}
        >
          {t("conditions.defaultHeading")}
        </h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
          <dt
            className="text-[13px] font-bold uppercase tracking-[0.04em]"
            style={{ color: MUTED }}
          >
            {t("conditions.defaultRate")}
          </dt>
          <dd className="m-0 text-[15px]" style={{ color: INK }}>
            {program.rate_kind === "percent"
              ? percent(program.rate_bp)
              : money(program.fixed_cents, program.currency)}
          </dd>
          <dt
            className="text-[13px] font-bold uppercase tracking-[0.04em]"
            style={{ color: MUTED }}
          >
            {t("conditions.defaultBasis")}
          </dt>
          <dd className="m-0 text-[15px]" style={{ color: INK }}>
            {t(
              `settings.commission.basis${program.basis_kind === "net" ? "Net" : "Gross"}`,
            )}
          </dd>
        </dl>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        {/* Regelliste, sortiert wie sie greift. */}
        <section
          aria-labelledby="affiliate-rules-heading"
          className={`${CARD_CLASS} overflow-hidden`}
          style={{ borderColor: CARD_BORDER }}
        >
          <h2
            id="affiliate-rules-heading"
            className="p-[22px_24px_12px] text-[17px] font-bold"
            style={{ color: INK }}
          >
            {t("conditions.listHeading")}
          </h2>
          <div
            className="rgrid-header px-[24px] pb-2.5 text-[13px] font-bold"
            style={
              {
                "--rgrid-cols": CONDITION_COLS,
                color: MUTED,
                borderBottom: `1px solid ${HAIRLINE}`,
              } as React.CSSProperties
            }
          >
            <div>{t("conditions.columnRank")}</div>
            <div>{t("conditions.columnScope")}</div>
            <div>{t("conditions.columnProduct")}</div>
            <div>{t("conditions.columnKind")}</div>
            <div>{t("conditions.columnRate")}</div>
            <div>{t("conditions.columnPeriod")}</div>
            <div className="lg:text-right">{t("conditions.columnActions")}</div>
          </div>

          {conditions.length === 0 ? (
            <p className="px-[24px] py-6 text-[15px]" style={{ color: MUTED }}>
              {t("conditions.empty")}
            </p>
          ) : (
            conditions.map((row, index) => {
              const scope = conditionScopeKind(row);
              return (
                <ConditionRow
                  key={row.id}
                  rank={index + 1}
                  values={{
                    id: row.id,
                    partnerId: row.partner_id,
                    groupId: row.group_id,
                    productId: row.product_id,
                    rateKind: row.rate_kind,
                    rateBp: row.rate_bp,
                    fixedCents: row.fixed_cents,
                    validFrom: toDateTimeLocal(row.valid_from),
                    validTo:
                      row.valid_to === null
                        ? null
                        : toDateTimeLocal(row.valid_to),
                    note: row.note,
                  }}
                  scopeText={
                    scope === "partner"
                      ? `${t("conditions.scopePartner")}: ${partnerNameById.get(row.partner_id ?? "") ?? t("overview.partnerUnknown")}`
                      : scope === "group"
                        ? `${t("conditions.scopeGroup")}: ${groupNameById.get(row.group_id ?? "") ?? t("partners.noGroup")}`
                        : t("conditions.scopeAll")
                  }
                  productText={
                    row.product_id === null
                      ? t("conditions.productAll")
                      : (productTitleById.get(row.product_id) ??
                        t("commissions.productUnknown"))
                  }
                  kindText={
                    row.rate_kind === "percent"
                      ? t("conditions.form.kindPercent")
                      : t("conditions.form.kindFixed")
                  }
                  rateText={
                    row.rate_kind === "percent"
                      ? percent(row.rate_bp)
                      : money(row.fixed_cents, program.currency)
                  }
                  periodText={
                    row.valid_to === null
                      ? t("conditions.periodOpen", {
                          from: dayTime(row.valid_from),
                        })
                      : t("conditions.periodClosed", {
                          from: dayTime(row.valid_from),
                          to: dayTime(row.valid_to),
                        })
                  }
                  noteText={row.note}
                  partners={partnerOptions}
                  groups={groupOptions}
                  products={productOptions}
                  defaultValidFrom={defaultValidFrom}
                />
              );
            })
          )}
        </section>

        <div className="flex flex-col gap-6 xl:sticky xl:top-4 xl:self-start">
          <section
            aria-labelledby="affiliate-newrule-heading"
            className={`${CARD_CLASS} p-[22px_24px]`}
            style={{ borderColor: CARD_BORDER }}
          >
            <h2
              id="affiliate-newrule-heading"
              className="mb-4 text-[17px] font-bold"
              style={{ color: INK }}
            >
              {t("conditions.form.heading")}
            </h2>
            <ConditionForm
              partners={partnerOptions}
              groups={groupOptions}
              products={productOptions}
              defaultValidFrom={defaultValidFrom}
            />
          </section>

          {/* Rechner (8.1 Zeile 4). */}
          <section
            aria-labelledby="affiliate-calculator-heading"
            className={`${CARD_CLASS} p-[22px_24px]`}
            style={{ borderColor: CARD_BORDER }}
          >
            <h2
              id="affiliate-calculator-heading"
              className="text-[17px] font-bold"
              style={{ color: INK }}
            >
              {t("conditions.calculator.heading")}
            </h2>
            <form method="get" className="mt-3 flex flex-col">
              <label
                htmlFor="calc-partner"
                className="mb-1.5 block text-[13px] font-semibold"
                style={{ color: MUTED }}
              >
                {t("conditions.calculator.partnerLabel")}
              </label>
              <select
                id="calc-partner"
                name="calcPartner"
                required
                defaultValue={calcPartnerId ?? ""}
                className={`mb-4 min-h-[40px] w-full rounded-[10px] border bg-white px-[13px] py-[11px] text-[15px] ${FOCUS_RING}`}
                style={{ borderColor: CARD_BORDER, color: INK }}
              >
                <option value="">
                  {t("conditions.form.selectPlaceholder")}
                </option>
                {partnerOptions.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>

              <label
                htmlFor="calc-product"
                className="mb-1.5 block text-[13px] font-semibold"
                style={{ color: MUTED }}
              >
                {t("conditions.calculator.productLabel")}
              </label>
              <select
                id="calc-product"
                name="calcProduct"
                defaultValue={calcProductId ?? ""}
                className={`mb-4 min-h-[40px] w-full rounded-[10px] border bg-white px-[13px] py-[11px] text-[15px] ${FOCUS_RING}`}
                style={{ borderColor: CARD_BORDER, color: INK }}
              >
                <option value="">{t("conditions.calculator.noProduct")}</option>
                {productOptions.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.title}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                className={`min-h-[44px] rounded-[11px] border px-[18px] text-[15px] font-bold ${FOCUS_RING}`}
                style={{ borderColor: CARD_BORDER, color: INK }}
              >
                {t("conditions.calculator.submit")}
              </button>
            </form>

            {/* Ergebnis. `role="status"`: nach dem Absenden lädt die Seite
                neu, die Meldung ist dann neu im Baum und wird angesagt. */}
            {calcPartnerId !== null && (
              <div role="status" className="mt-4 text-[15px]">
                {preview === null ? (
                  <p style={{ color: "#B24343" }}>
                    {t("conditions.calculator.noResult")}
                  </p>
                ) : (
                  <>
                    <p style={{ color: INK }}>
                      {t("conditions.calculator.result", {
                        rule:
                          previewRank === null || previewRank === 0
                            ? t("conditions.calculator.ruleDefault")
                            : t("conditions.calculator.ruleNumbered", {
                                rank: previewRank,
                              }),
                        rate:
                          preview.resolution.rate_kind === "percent"
                            ? percent(preview.resolution.rate_bp)
                            : money(
                                preview.resolution.fixed_cents,
                                preview.currency,
                              ),
                        gross: money(preview.gross_cents, preview.currency),
                        amount: money(preview.amount_cents, preview.currency),
                      })}
                    </p>
                    <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
                      <dt
                        className="text-[13px] font-bold uppercase"
                        style={{ color: MUTED }}
                      >
                        {t("conditions.calculator.base")}
                      </dt>
                      <dd className="m-0" style={{ color: INK }}>
                        {money(preview.base_cents, preview.currency)}
                      </dd>
                      <dt
                        className="text-[13px] font-bold uppercase"
                        style={{ color: MUTED }}
                      >
                        {t("conditions.calculator.payoutPart")}
                      </dt>
                      <dd className="m-0" style={{ color: INK }}>
                        {money(preview.sale_cents, preview.currency)}
                      </dd>
                      <dt
                        className="text-[13px] font-bold uppercase"
                        style={{ color: MUTED }}
                      >
                        {t("conditions.calculator.reservePart")}
                      </dt>
                      <dd className="m-0" style={{ color: INK }}>
                        {money(preview.reserve_cents, preview.currency)}
                      </dd>
                    </dl>
                    {/* Pflichthinweis: die Vorschau rechnet ohne Steueranteil
                        (queries.ts). Bei `basis_kind = 'net'` liegt der echte
                        Betrag später darunter. */}
                    <p className="mt-2" style={{ color: MUTED }}>
                      {t("conditions.calculator.taxHint")}
                    </p>
                    {preview.flagged && (
                      <p
                        className="mt-1 font-bold"
                        style={{ color: "#8A6D1F" }}
                      >
                        {t("conditions.calculator.cappedHint")}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </AffiliateShell>
  );
}
