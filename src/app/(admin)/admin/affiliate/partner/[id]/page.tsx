import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { checkAffiliateManagerAccess } from "@/lib/affiliate/access";
import {
  getAffiliatePartnerDetail,
  getAffiliateProgram,
  listAffiliateConditions,
  listAffiliatePartners,
  listAffiliateProducts,
} from "@/lib/affiliate/queries";
import { buildTenantUrl } from "@/lib/tenant/url";
import {
  AffiliateAccessNotice,
  AffiliateProgramMissing,
  AffiliateShell,
} from "../../affiliate-shell";
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
} from "../../affiliate-format";
import { PartnerDetailActions } from "./partner-actions";

/**
 * Affiliate-System, Block B6-B — `/admin/affiliate/partner/[id]`
 * (PLAN_Affiliate-System.md 8.1, Zeile 3; 8.5; 11.15).
 *
 * Zweck laut Plan: „Einzelfall klären, ohne dass eine Rückfrage in einem
 * Datenbankeingriff endet." Alles, was ein Manager zu einem Partner wissen
 * muss, steht auf dieser Seite — und zwar als Text.
 *
 * MANDANTENBINDUNG DER ID (CLAUDE.md §2.15): `params.id` ist
 * client-geliefert. `getAffiliatePartnerDetail()` prüft die UUID-Form und
 * filtert mit `.eq("tenant_id", …)`; ein fremder oder erfundener Wert ergibt
 * `null` und führt hier zu `notFound()` — dieselbe Antwort für beide Fälle,
 * sonst ließe sich aus der Unterscheidung die Existenz fremder Partner
 * ableiten.
 *
 * BANKDATEN STEHEN HIER NICHT (8.1, letzter Satz). Geladen wird aus dem
 * Abrechnungsprofil ausschließlich, OB Anschrift, Steuerstatus und Zahlweg
 * gesetzt sind — nie ein Wert. Die Ampel ist deshalb ein Satz und keine
 * Farbfläche (8.5).
 */

const STATEMENT_COLS = "1fr 1.4fr 0.9fr 0.8fr 1fr 1fr";
const AUDIT_COLS = "1.1fr 1.4fr 1.5fr";

export default async function AdminAffiliatePartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await checkAffiliateManagerAccess();
  if (!access.ok) return <AffiliateAccessNotice reason={access.reason} />;

  const t = await getTranslations("admin.affiliate");
  const format = await getFormatter();
  const { id } = await params;

  const detail = await getAffiliatePartnerDetail(access.tenant.id, id);
  if (detail === null) notFound();

  const [program, conditions, products, allPartners] = await Promise.all([
    getAffiliateProgram(access.tenant.id),
    listAffiliateConditions(access.tenant.id),
    listAffiliateProducts(access.tenant.id),
    // Für das Werber-Auswahlfeld: Name und ID, sonst nichts. Der Werber ist
    // eine Geldbeziehung (zweite Stufe, 5.5) und darf nicht als roh
    // eingetippte UUID gesetzt werden.
    listAffiliatePartners(access.tenant.id),
  ]);

  if (program === null) {
    return (
      <AffiliateShell active="partners" title={detail.partner.display_name}>
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
  const dayTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const productTitleById = new Map(
    products.map((product) => [product.id, product.title]),
  );

  /**
   * Der TATSÄCHLICH wirksame Satz samt Herkunft (8.1: „aus Gruppe
   * ‚Top-Partner': 40 %"). Die Auflösung selbst kommt aus `resolveCondition()`
   * (queries.ts); hier wird nur nachgeschlagen, WELCHE Regel getroffen hat,
   * um die Herkunft in Worten zu nennen.
   */
  const matched =
    detail.resolution?.condition_id === null || detail.resolution === null
      ? null
      : (conditions.find((row) => row.id === detail.resolution?.condition_id) ??
        null);

  const rateText =
    detail.resolution === null
      ? t("overview.metricUnavailable")
      : detail.resolution.rate_kind === "percent"
        ? format.number(bpToRatio(detail.resolution.rate_bp), {
            style: "percent",
            maximumFractionDigits: 2,
          })
        : money(detail.resolution.fixed_cents, program.currency);

  const originText =
    matched === null
      ? t("partner.condition.originProgram")
      : matched.partner_id !== null
        ? t("partner.condition.originPartner")
        : matched.group_id !== null
          ? t("partner.condition.originGroup", {
              name: detail.groupName ?? t("partners.noGroup"),
            })
          : t("partner.condition.originProduct", {
              name:
                matched.product_id === null
                  ? t("conditions.productAll")
                  : (productTitleById.get(matched.product_id) ??
                    t("conditions.productAll")),
            });

  // Vollständigkeitsampel als TEXT (8.1/8.5): was fehlt, wird benannt.
  const missing: string[] = [];
  if (!detail.payoutReadiness.hasAddress)
    missing.push(t("partner.banking.fieldAddress"));
  if (!detail.payoutReadiness.hasTaxStatus)
    missing.push(t("partner.banking.fieldTax"));
  if (!detail.payoutReadiness.hasPayoutMethod)
    missing.push(t("partner.banking.fieldPayout"));

  const applicationEntries = Object.entries(detail.partner.application ?? {});
  const applicationLabels = new Map(
    program.application_fields.map((field) => [field.key, field.label]),
  );

  return (
    <AffiliateShell active="partners" title={detail.partner.display_name}>
      <p>
        <Link
          href="/admin/affiliate/partner"
          prefetch={false}
          className={`inline-flex min-h-[40px] items-center font-semibold underline ${FOCUS_RING}`}
          style={{ color: NAVY }}
        >
          {t("partner.backLink")}
        </Link>
      </p>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* 1. Stammdaten und Bewerbungsangaben. */}
        <section
          aria-labelledby="affiliate-master-heading"
          className={`${CARD_CLASS} p-[22px_24px]`}
          style={{ borderColor: CARD_BORDER }}
        >
          <h2
            id="affiliate-master-heading"
            className="text-[17px] font-bold"
            style={{ color: INK }}
          >
            {t("partner.master.heading")}
          </h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
            <Row
              label={t("partner.master.nameLabel")}
              value={detail.partner.display_name}
            />
            <Row
              label={t("partner.master.companyLabel")}
              value={detail.partner.company ?? "—"}
            />
            <Row
              label={t("partner.master.emailLabel")}
              value={detail.partner.applicant_email}
            />
            <Row
              label={t("partner.master.codeLabel")}
              value={detail.partner.code}
            />
            <Row
              label={t("partner.master.groupLabel")}
              value={detail.groupName ?? t("partners.noGroup")}
            />
            <Row
              label={t("partner.master.joinedLabel")}
              value={day(detail.partner.created_at)}
            />
            <div
              className="text-[13px] font-bold uppercase tracking-[0.04em]"
              style={{ color: MUTED }}
            >
              {t("partner.master.statusLabel")}
            </div>
            <dd className="m-0 text-[15px]">
              <span
                className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
                style={PARTNER_STATUS_STYLE[detail.partner.status]}
              >
                {t(`status.partner.${detail.partner.status}`)}
              </span>
              {detail.partner.status_reason && (
                <span className="ml-2" style={{ color: MUTED }}>
                  {detail.partner.status_reason}
                </span>
              )}
            </dd>
            <Row
              label={t("partner.master.linkLabel")}
              value={buildTenantUrl(
                access.tenant,
                `/api/aff/k?c=${detail.partner.code}`,
              )}
            />
          </dl>

          <h3 className="mt-5 text-[15px] font-bold" style={{ color: INK }}>
            {t("partner.master.applicationHeading")}
          </h3>
          {applicationEntries.length === 0 ? (
            <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
              {t("partner.master.applicationEmpty")}
            </p>
          ) : (
            <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
              {applicationEntries.map(([key, value]) => (
                <Row
                  key={key}
                  label={applicationLabels.get(key) ?? key}
                  value={value}
                />
              ))}
            </dl>
          )}
        </section>

        {/* 2. Kondition, Salden und Auszahlbarkeit. */}
        <section
          aria-labelledby="affiliate-condition-heading"
          className={`${CARD_CLASS} p-[22px_24px]`}
          style={{ borderColor: CARD_BORDER }}
        >
          <h2
            id="affiliate-condition-heading"
            className="text-[17px] font-bold"
            style={{ color: INK }}
          >
            {t("partner.condition.heading")}
          </h2>
          <p className="mt-2 text-[15px]" style={{ color: INK }}>
            <span className="font-bold">
              {t("partner.condition.effectiveRate")}:{" "}
            </span>
            {rateText}
          </p>
          <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
            <span className="font-bold">{t("partner.condition.origin")}: </span>
            {originText}
          </p>
          <Link
            href="/admin/affiliate/konditionen"
            prefetch={false}
            className={`mt-2 inline-flex min-h-[40px] items-center font-semibold underline ${FOCUS_RING}`}
            style={{ color: "#5663AE" }}
          >
            {t("partner.condition.editLink")}
          </Link>

          <h3 className="mt-5 text-[15px] font-bold" style={{ color: INK }}>
            {t("partner.balances.heading")}
          </h3>
          {!detail.balancesComplete && (
            <p
              role="status"
              className="mt-1 text-[15px]"
              style={{ color: "#B24343" }}
            >
              {t("overview.metricUnavailable")}
            </p>
          )}
          {detail.balances.length === 0 ? (
            <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
              {t("partner.balances.empty")}
            </p>
          ) : (
            detail.balances.map((balance) => (
              <dl
                key={balance.currency}
                className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]"
              >
                <Row
                  label={t("partner.balances.open")}
                  value={money(balance.open_cents, balance.currency)}
                />
                <Row
                  label={t("partner.balances.reserved")}
                  value={money(balance.reserved_cents, balance.currency)}
                />
                <Row
                  label={t("partner.balances.inReview")}
                  value={money(balance.in_review_cents, balance.currency)}
                />
                <Row
                  label={t("partner.balances.available")}
                  value={money(balance.available_cents, balance.currency)}
                />
                <Row
                  label={t("partner.balances.paid")}
                  value={money(balance.paid_cents, balance.currency)}
                />
              </dl>
            ))
          )}

          <h3 className="mt-5 text-[15px] font-bold" style={{ color: INK }}>
            {t("partner.banking.heading")}
          </h3>
          <p
            className="mt-1 text-[15px]"
            style={{ color: missing.length === 0 ? "#1F8A5B" : "#8A6D1F" }}
          >
            {missing.length === 0
              ? t("partner.banking.complete")
              : t("partner.banking.incomplete", { fields: missing.join(", ") })}
          </p>
          <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
            {t("partner.banking.hint")}
          </p>
          {detail.partner.payout_hold && (
            <p
              className="mt-1 text-[15px] font-bold"
              style={{ color: "#B24343" }}
            >
              {t("partner.banking.payoutHold")}
            </p>
          )}
        </section>
      </div>

      {/* 3. Aktionen. */}
      <PartnerDetailActions
        partnerId={detail.partner.id}
        status={detail.partner.status}
        groupId={detail.partner.group_id}
        referredBy={detail.partner.referred_by}
        payoutHold={detail.partner.payout_hold}
        payoutHoldReason={detail.partner.payout_hold_reason}
        internalNote={detail.partner.internal_note}
        currency={program.currency}
        groups={detail.groups.map((group) => ({
          id: group.id,
          name: group.name,
        }))}
        partners={allPartners.rows.map((row) => ({
          id: row.id,
          name: row.display_name,
        }))}
      />

      {/* 4. Kontoauszug. */}
      <section
        aria-labelledby="affiliate-statement-heading"
        className={`${CARD_CLASS} overflow-hidden`}
        style={{ borderColor: CARD_BORDER }}
      >
        <h2
          id="affiliate-statement-heading"
          className="p-[22px_24px_12px] text-[17px] font-bold"
          style={{ color: INK }}
        >
          {t("partner.statement.heading")}
        </h2>
        <div
          className="rgrid-header px-[24px] pb-2.5 text-[13px] font-bold"
          style={
            {
              "--rgrid-cols": STATEMENT_COLS,
              color: MUTED,
              borderBottom: `1px solid ${HAIRLINE}`,
            } as React.CSSProperties
          }
        >
          <div>{t("partner.statement.columnDate")}</div>
          <div>{t("partner.statement.columnProduct")}</div>
          <div>{t("partner.statement.columnBase")}</div>
          <div>{t("partner.statement.columnRate")}</div>
          <div>{t("partner.statement.columnAmount")}</div>
          <div>{t("partner.statement.columnStatus")}</div>
        </div>
        {detail.statement.length === 0 ? (
          <p className="px-[24px] py-6 text-[15px]" style={{ color: MUTED }}>
            {t("partner.statement.empty")}
          </p>
        ) : (
          detail.statement.map((row) => (
            <div
              key={row.id}
              className="rgrid-row px-[18px] py-4 text-[15px] lg:px-[24px]"
              style={
                {
                  "--rgrid-cols": STATEMENT_COLS,
                  borderBottom: `1px solid ${HAIRLINE}`,
                } as React.CSSProperties
              }
            >
              <div>
                <span className="rgrid-label">
                  {t("partner.statement.columnDate")}
                </span>
                <span style={{ color: MUTED }}>{day(row.booked_at)}</span>
              </div>
              <div className="min-w-0">
                <span className="rgrid-label">
                  {t("partner.statement.columnProduct")}
                </span>
                <span style={{ color: INK }}>
                  {row.product_id === null
                    ? t(`commissions.kind.${row.kind}`)
                    : (productTitleById.get(row.product_id) ??
                      t("commissions.productUnknown"))}
                </span>
              </div>
              <div>
                <span className="rgrid-label">
                  {t("partner.statement.columnBase")}
                </span>
                <span style={{ color: MUTED }}>
                  {money(row.base_cents, row.currency)}
                </span>
              </div>
              <div>
                <span className="rgrid-label">
                  {t("partner.statement.columnRate")}
                </span>
                <span style={{ color: MUTED }}>
                  {row.rate_kind === "percent"
                    ? format.number(bpToRatio(row.rate_bp), {
                        style: "percent",
                        maximumFractionDigits: 2,
                      })
                    : money(row.fixed_cents, row.currency)}
                </span>
              </div>
              <div>
                <span className="rgrid-label">
                  {t("partner.statement.columnAmount")}
                </span>
                <span className="font-semibold" style={{ color: INK }}>
                  {money(row.amount_cents, row.currency)}
                </span>
              </div>
              <div>
                <span className="rgrid-label">
                  {t("partner.statement.columnStatus")}
                </span>
                <span
                  className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
                  style={COMMISSION_STATUS_STYLE[row.status]}
                >
                  {t(`status.commission.${row.status}`)}
                </span>
                {row.is_test && (
                  <span
                    className="mt-1 block text-[13px] font-bold"
                    style={{ color: MUTED }}
                  >
                    {t("commissions.testChip")}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
        <div className="p-[16px_24px]">
          <Link
            href={`/admin/affiliate/provisionen?partnerId=${detail.partner.id}`}
            prefetch={false}
            className={`inline-flex min-h-[40px] items-center font-bold underline ${FOCUS_RING}`}
            style={{ color: "#5663AE" }}
          >
            {t("partner.statement.more")}
          </Link>
        </div>
      </section>

      {/* 5. Änderungsprotokoll. */}
      <section
        aria-labelledby="affiliate-audit-heading"
        className={`${CARD_CLASS} overflow-hidden`}
        style={{ borderColor: CARD_BORDER }}
      >
        <h2
          id="affiliate-audit-heading"
          className="p-[22px_24px_12px] text-[17px] font-bold"
          style={{ color: INK }}
        >
          {t("partner.audit.heading")}
        </h2>
        <div
          className="rgrid-header px-[24px] pb-2.5 text-[13px] font-bold"
          style={
            {
              "--rgrid-cols": AUDIT_COLS,
              color: MUTED,
              borderBottom: `1px solid ${HAIRLINE}`,
            } as React.CSSProperties
          }
        >
          <div>{t("partner.audit.columnDate")}</div>
          <div>{t("partner.audit.columnActor")}</div>
          <div>{t("partner.audit.columnAction")}</div>
        </div>
        {detail.auditEntries.length === 0 ? (
          <p className="px-[24px] py-6 text-[15px]" style={{ color: MUTED }}>
            {t("partner.audit.empty")}
          </p>
        ) : (
          detail.auditEntries.map((entry) => (
            <div
              key={entry.id}
              className="rgrid-row px-[18px] py-3 text-[15px] lg:px-[24px]"
              style={
                {
                  "--rgrid-cols": AUDIT_COLS,
                  borderBottom: `1px solid ${HAIRLINE}`,
                } as React.CSSProperties
              }
            >
              <div>
                <span className="rgrid-label">
                  {t("partner.audit.columnDate")}
                </span>
                <span style={{ color: MUTED }}>
                  {dayTime(entry.created_at)}
                </span>
              </div>
              <div>
                <span className="rgrid-label">
                  {t("partner.audit.columnActor")}
                </span>
                <span style={{ color: MUTED }}>
                  {t(`partner.audit.actor.${entry.actor_kind}`)}
                </span>
              </div>
              <div>
                <span className="rgrid-label">
                  {t("partner.audit.columnAction")}
                </span>
                {/* Der Vorgangsname steht bewusst technisch und unübersetzt
                    (`partner.approve`): er ist der Schlüssel, unter dem
                    derselbe Vorgang im Protokoll, in `actions.ts` und im Plan
                    steht — eine Übersetzung erzeugte hier drei Namen für eine
                    Sache. */}
                <span style={{ color: INK }}>{entry.action}</span>
              </div>
            </div>
          ))
        )}
      </section>
    </AffiliateShell>
  );
}

/** Ein Feld einer Definitionsliste — Label und Wert, beide als Text. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt
        className="text-[13px] font-bold uppercase tracking-[0.04em]"
        style={{ color: MUTED }}
      >
        {label}
      </dt>
      <dd className="m-0 break-words text-[15px]" style={{ color: INK }}>
        {value}
      </dd>
    </>
  );
}
