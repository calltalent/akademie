"use client";

import { useActionState, useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  decideAffiliateCommission,
  reassignAffiliateOrder,
  setAffiliateCommissionFlag,
} from "@/lib/affiliate/actions";
import { initialAffiliateCommissionActionState } from "@/lib/affiliate/state";
import { AFFILIATE_MANUAL_CANCEL_REASONS } from "@/lib/affiliate/schema";
import type {
  AffiliateCommissionKind,
  AffiliateCommissionStatus,
  AffiliateConditionSnapshot,
} from "@/lib/affiliate/types";
import {
  CARD_BORDER,
  COMMISSION_STATUS_STYLE,
  FOCUS_RING,
  HAIRLINE,
  INK,
  MUTED,
  bpToRatio,
  centsToAmount,
  currencyCode,
} from "../affiliate-format";

import { useStatusFocus } from "../use-status-focus";

/**
 * Affiliate-System, Block B6-B — eine Zeile des Provisionsbuchs mit
 * aufklappbarer Rechnung (PLAN_Affiliate-System.md 8.1 Zeile 5, 3.11, 6.3).
 *
 * DER AUFGEKLAPPTE BEREICH IST DER ZWECK DIESER SEITE. Er zeigt den
 * eingefrorenen `condition_snapshot` — Satz, Bemessungsgrundlage,
 * Gebührenabzug, Grenzen, Reserve und Fristen, wie sie IM MOMENT DER BUCHUNG
 * galten (G4/5.7). Deshalb ist jede Zeile für sich nachrechenbar, ohne eine
 * einzige andere Tabelle: eine seither geänderte Programmeinstellung oder
 * eine gelöschte Kondition ändert nichts an dem, was hier steht.
 *
 * Fehlt der Snapshot (ältere Zeile aus einem Reparaturlauf), wird das
 * ausdrücklich gesagt, statt die aktuellen Programmwerte einzublenden — die
 * wären eine Behauptung über die Vergangenheit.
 *
 * Die vier Aktionen (markieren, Markierung lösen, freigeben, stornieren) und
 * die Umbuchung prüfen G15 serverseitig (`assertNoSelfApproval()`); hier
 * werden sie nur dort gezeigt, wo der Zustand sie überhaupt zulässt — die
 * Grenze ist und bleibt die Server Action.
 */

export const COMMISSION_COLS = "0.9fr 1.2fr 1.2fr 0.9fr 0.9fr 0.8fr 1fr 1fr";

export type CommissionRowData = {
  id: string;
  partnerId: string;
  partnerName: string;
  productText: string;
  campaign: string | null;
  orderId: string | null;
  stripeInvoiceId: string | null;
  stripeSubscriptionId: string | null;
  referralId: string | null;
  dedupKey: string;
  kind: AffiliateCommissionKind;
  /** Währung der Zeile — der Snapshot trägt selbst keine (3.11). */
  currency: string;
  status: AffiliateCommissionStatus;
  flagged: boolean;
  flagReason: string | null;
  isTest: boolean;
  note: string | null;
  snapshot: AffiliateConditionSnapshot | null;
  /** Fertig formatiert vom Server — hier wird nichts gerechnet. */
  dateText: string;
  baseText: string;
  rateText: string;
  amountText: string;
  holdUntilText: string;
};

export function CommissionRow({
  row,
  partners,
}: {
  row: CommissionRowData;
  partners: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("admin.affiliate");
  const format = useFormatter();
  const [expanded, setExpanded] = useState(false);

  // Der Snapshot speichert Cent und Basispunkte (3.11). Formatiert wird mit
  // dem Formatter der aktiven Sprache — dieselbe Schreibweise wie in jeder
  // anderen Geldzahl der Oberfläche.
  const snapshotMoney = (cents: number) =>
    format.number(centsToAmount(cents), {
      style: "currency",
      currency: currencyCode(row.currency),
    });
  const snapshotPercent = (bp: number) =>
    format.number(bpToRatio(bp), {
      style: "percent",
      maximumFractionDigits: 2,
    });

  return (
    <div style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <div
        className="rgrid-row px-[18px] py-4 text-[15px] lg:px-[24px]"
        style={{ "--rgrid-cols": COMMISSION_COLS } as React.CSSProperties}
      >
        <div>
          <span className="rgrid-label">{t("commissions.columnDate")}</span>
          <span style={{ color: MUTED }}>{row.dateText}</span>
        </div>
        <div className="min-w-0">
          <span className="rgrid-label">{t("commissions.columnPartner")}</span>
          <span className="font-semibold" style={{ color: INK }}>
            {row.partnerName}
          </span>
        </div>
        <div className="min-w-0">
          <span className="rgrid-label">{t("commissions.columnProduct")}</span>
          <span style={{ color: MUTED }}>{row.productText}</span>
        </div>
        <div className="min-w-0">
          <span className="rgrid-label">{t("commissions.columnCampaign")}</span>
          <span style={{ color: MUTED }}>
            {row.campaign ?? t("commissions.noCampaign")}
          </span>
        </div>
        <div>
          <span className="rgrid-label">{t("commissions.columnBase")}</span>
          <span style={{ color: MUTED }}>{row.baseText}</span>
        </div>
        <div>
          <span className="rgrid-label">{t("commissions.columnRate")}</span>
          <span style={{ color: MUTED }}>{row.rateText}</span>
        </div>
        <div>
          <span className="rgrid-label">{t("commissions.columnAmount")}</span>
          <span className="font-semibold" style={{ color: INK }}>
            {row.amountText}
          </span>
        </div>
        <div>
          <span className="rgrid-label">{t("commissions.columnStatus")}</span>
          <span
            className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
            style={COMMISSION_STATUS_STYLE[row.status]}
          >
            {t(`status.commission.${row.status}`)}
          </span>
          {row.flagged && (
            <span
              className="mt-1 block text-[13px] font-bold"
              style={{ color: "#8A6D1F" }}
            >
              {t("commissions.flaggedChip")}
            </span>
          )}
          {row.isTest && (
            <span
              className="mt-1 block text-[13px] font-bold"
              style={{ color: MUTED }}
            >
              {t("commissions.testChip")}
            </span>
          )}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className={`mt-2 min-h-[40px] text-[15px] font-semibold underline ${FOCUS_RING}`}
            style={{ color: "#5663AE" }}
          >
            {expanded
              ? t("commissions.detailsClose")
              : t("commissions.detailsOpen")}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-5 px-[18px] pb-6 lg:px-[24px]">
          {/* 1. Zuordnung im Klartext. */}
          <section>
            <h3 className="text-[15px] font-bold" style={{ color: INK }}>
              {t("commissions.reasonHeading")}
            </h3>
            <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
              {row.kind === "manual"
                ? t("commissions.reason.manual")
                : row.referralId !== null
                  ? t("commissions.reason.referral")
                  : t("commissions.reason.binding")}
            </p>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-[auto_1fr]">
              <Entry
                label={t("commissions.columnCampaign")}
                value={row.campaign ?? t("commissions.noCampaign")}
              />
              <Entry
                label={t("commissions.kindLabel")}
                value={t(`commissions.kind.${row.kind}`)}
              />
              <Entry
                label={t("commissions.holdUntilLabel")}
                value={row.holdUntilText}
              />
              {row.orderId !== null && (
                <Entry
                  label={t("commissions.orderLabel")}
                  value={row.orderId}
                />
              )}
              {row.stripeInvoiceId !== null && (
                <Entry
                  label={t("commissions.invoiceLabel")}
                  value={row.stripeInvoiceId}
                />
              )}
              {row.stripeSubscriptionId !== null && (
                <Entry
                  label={t("commissions.subscriptionLabel")}
                  value={row.stripeSubscriptionId}
                />
              )}
              {/* Die Idempotenzachse (G3) — die Antwort auf „warum wurde das
                  zweimal gebucht?" steht hier und nirgends sonst. */}
              <Entry label={t("commissions.dedupLabel")} value={row.dedupKey} />
              {row.note !== null && (
                <Entry label={t("commissions.noteLabel")} value={row.note} />
              )}
              {row.flagReason !== null && (
                <Entry
                  label={t("commissions.flagReasonLabel")}
                  value={row.flagReason}
                />
              )}
            </dl>
          </section>

          {/* 2. Der eingefrorene Rechenweg. */}
          <section>
            <h3 className="text-[15px] font-bold" style={{ color: INK }}>
              {t("commissions.snapshotHeading")}
            </h3>
            {row.snapshot === null ? (
              <p className="mt-1 text-[15px]" style={{ color: "#B24343" }}>
                {t("commissions.snapshotMissing")}
              </p>
            ) : (
              <dl className="mt-1 grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-[auto_1fr]">
                <Entry
                  label={t("commissions.snapshot.source")}
                  value={
                    row.snapshot.source === "condition"
                      ? t("commissions.snapshot.sourceCondition")
                      : t("commissions.snapshot.sourceProgram")
                  }
                />
                <Entry
                  label={t("commissions.snapshot.rate")}
                  value={
                    row.snapshot.rate_kind === "percent"
                      ? snapshotPercent(row.snapshot.rate_bp)
                      : snapshotMoney(row.snapshot.fixed_cents)
                  }
                />
                <Entry
                  label={t("commissions.snapshot.basis")}
                  value={
                    row.snapshot.basis_kind === "net"
                      ? t("settings.commission.basisNet")
                      : t("settings.commission.basisGross")
                  }
                />
                <Entry
                  label={t("commissions.snapshot.feeDeduction")}
                  value={snapshotPercent(row.snapshot.fee_deduction_bp)}
                />
                <Entry
                  label={t("commissions.snapshot.min")}
                  value={
                    row.snapshot.min_commission_cents === null
                      ? t("commissions.snapshot.noLimit")
                      : snapshotMoney(row.snapshot.min_commission_cents)
                  }
                />
                <Entry
                  label={t("commissions.snapshot.max")}
                  value={
                    row.snapshot.max_commission_cents === null
                      ? t("commissions.snapshot.noLimit")
                      : snapshotMoney(row.snapshot.max_commission_cents)
                  }
                />
                <Entry
                  label={t("commissions.snapshot.reserve")}
                  value={snapshotPercent(row.snapshot.reserve_bp)}
                />
                <Entry
                  label={t("commissions.snapshot.holdDays")}
                  value={String(row.snapshot.hold_days)}
                />
                <Entry
                  label={t("commissions.snapshot.reserveDays")}
                  value={String(row.snapshot.reserve_days)}
                />
                <Entry
                  label={t("commissions.snapshot.tier2")}
                  value={
                    row.snapshot.tier2_enabled
                      ? `${snapshotPercent(row.snapshot.tier2_rate_bp)} (${
                          row.snapshot.tier2_basis === "commission"
                            ? t("settings.tier2.basisCommission")
                            : t("settings.tier2.basisRevenue")
                        })`
                      : t("commissions.snapshot.tier2Off")
                  }
                />
              </dl>
            )}
          </section>

          {/* 3. Aktionen. */}
          <CommissionActions row={row} partners={partners} />
        </div>
      )}
    </div>
  );
}

function Entry({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt
        className="text-[13px] font-bold uppercase tracking-[0.04em]"
        style={{ color: MUTED }}
      >
        {label}
      </dt>
      <dd className="m-0 break-all" style={{ color: INK }}>
        {value}
      </dd>
    </>
  );
}

const fieldClass =
  "w-full min-h-[40px] rounded-[10px] border px-[13px] py-[11px] text-[15px]";
const labelClass = "mb-1.5 block text-[13px] font-semibold";

function CommissionActions({
  row,
  partners,
}: {
  row: CommissionRowData;
  partners: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("admin.affiliate");
  const tCommon = useTranslations("admin.common");
  const idPrefix = useId();

  const [flagState, flagAction, flagPending] = useActionState(
    setAffiliateCommissionFlag,
    initialAffiliateCommissionActionState,
  );
  const [decideState, decideAction, decidePending] = useActionState(
    decideAffiliateCommission,
    initialAffiliateCommissionActionState,
  );
  const [reassignState, reassignAction, reassignPending] = useActionState(
    reassignAffiliateOrder,
    initialAffiliateCommissionActionState,
  );

  const flagRef = useStatusFocus(
    Boolean(flagState.error) || Boolean(flagState.success),
  );
  const decideRef = useStatusFocus(
    Boolean(decideState.error) || Boolean(decideState.success),
  );
  const reassignRef = useStatusFocus(
    Boolean(reassignState.error) || Boolean(reassignState.success),
  );

  // Nur diese beiden Zustände lassen eine menschliche Entscheidung zu (6.3);
  // die Server Action prüft es erneut und ist die verbindliche Instanz.
  const decidable = row.status === "pending" || row.status === "on_hold";

  return (
    <section
      className="flex flex-col gap-4 border-t pt-4"
      style={{ borderColor: CARD_BORDER }}
    >
      <h3 className="text-[15px] font-bold" style={{ color: INK }}>
        {t("commissions.actionsHeading")}
      </h3>

      {/* Markierung setzen oder lösen. */}
      <form action={flagAction} className="flex flex-col gap-2">
        <input type="hidden" name="commissionId" value={row.id} />
        <input
          type="hidden"
          name="flagged"
          value={row.flagged ? "off" : "on"}
        />
        {!row.flagged && (
          <>
            <label
              htmlFor={`${idPrefix}-flagreason`}
              className={labelClass}
              style={{ color: MUTED }}
            >
              {t("commissions.flagReasonLabel")}
            </label>
            <input
              id={`${idPrefix}-flagreason`}
              name="reason"
              type="text"
              required
              maxLength={1000}
              className={`${fieldClass} ${FOCUS_RING}`}
              style={{ borderColor: CARD_BORDER, color: INK }}
            />
          </>
        )}
        <ActionFeedback
          statusRef={flagRef}
          error={flagState.error}
          success={Boolean(flagState.success)}
          successText={t("commissions.actions.done")}
        />
        <button
          type="submit"
          disabled={flagPending}
          className={`min-h-[40px] self-start rounded-[11px] border px-[14px] text-[15px] font-semibold disabled:opacity-50 ${FOCUS_RING}`}
          style={{ borderColor: CARD_BORDER, color: INK }}
        >
          {flagPending
            ? tCommon("saving")
            : row.flagged
              ? t("commissions.actions.unflag")
              : t("commissions.actions.flag")}
        </button>
      </form>

      {/* Freigeben oder stornieren. */}
      {decidable && (
        <form action={decideAction} className="flex flex-col gap-2">
          <input type="hidden" name="commissionId" value={row.id} />
          <label
            htmlFor={`${idPrefix}-decision`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("commissions.decision.label")}
          </label>
          <select
            id={`${idPrefix}-decision`}
            name="decision"
            defaultValue="cancelled"
            className={`${fieldClass} bg-white ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          >
            <option value="approved">
              {t("commissions.decision.approve")}
            </option>
            <option value="cancelled">
              {t("commissions.decision.cancel")}
            </option>
          </select>

          <label
            htmlFor={`${idPrefix}-cancelreason`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("commissions.decision.cancelReasonLabel")}
          </label>
          <select
            id={`${idPrefix}-cancelreason`}
            name="cancelReason"
            defaultValue="manual"
            className={`${fieldClass} bg-white ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          >
            {AFFILIATE_MANUAL_CANCEL_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {t(`commissions.cancelReason.${reason}`)}
              </option>
            ))}
          </select>

          <label
            htmlFor={`${idPrefix}-decisionreason`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("commissions.decision.reasonLabel")}
          </label>
          <textarea
            id={`${idPrefix}-decisionreason`}
            name="reason"
            rows={2}
            required
            minLength={5}
            maxLength={1000}
            className={`${fieldClass} resize-y ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
          <ActionFeedback
            statusRef={decideRef}
            error={decideState.error}
            success={Boolean(decideState.success)}
            successText={t("commissions.actions.done")}
          />
          <button
            type="submit"
            disabled={decidePending}
            className={`min-h-[40px] self-start rounded-[11px] border px-[14px] text-[15px] font-semibold disabled:opacity-50 ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          >
            {decidePending
              ? tCommon("saving")
              : t("commissions.decision.submit")}
          </button>
        </form>
      )}

      {/* Umbuchen — nur mit Bestellung, weil die Umbuchung an der BESTELLUNG
          hängt und alle ihre Zeilen zugleich betrifft (4.6). */}
      {row.orderId !== null && (
        <form action={reassignAction} className="flex flex-col gap-2">
          <input type="hidden" name="orderId" value={row.orderId} />
          <label
            htmlFor={`${idPrefix}-newpartner`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("commissions.reassign.newPartnerLabel")}
          </label>
          <select
            id={`${idPrefix}-newpartner`}
            name="newPartnerId"
            defaultValue=""
            className={`${fieldClass} bg-white ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          >
            <option value="">{t("commissions.reassign.none")}</option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
          <label
            htmlFor={`${idPrefix}-reassignreason`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("commissions.reassign.reasonLabel")}
          </label>
          <textarea
            id={`${idPrefix}-reassignreason`}
            name="reason"
            rows={2}
            required
            minLength={5}
            maxLength={1000}
            className={`${fieldClass} resize-y ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
          <p className="text-[13px]" style={{ color: MUTED }}>
            {t("commissions.reassign.hint")}
          </p>
          <ActionFeedback
            statusRef={reassignRef}
            error={reassignState.error}
            success={Boolean(reassignState.success)}
            successText={t("commissions.actions.done")}
          />
          <button
            type="submit"
            disabled={reassignPending}
            className={`min-h-[40px] self-start rounded-[11px] border px-[14px] text-[15px] font-semibold disabled:opacity-50 ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          >
            {reassignPending
              ? tCommon("saving")
              : t("commissions.actions.rebook")}
          </button>
        </form>
      )}
    </section>
  );
}

/** Fehler- bzw. Erfolgsmeldung einer Aktion, mit Fokusziel (8.5). */
function ActionFeedback({
  statusRef,
  error,
  success,
  successText,
}: {
  statusRef: React.RefObject<HTMLParagraphElement | null>;
  error: string | null;
  success: boolean;
  successText: string;
}) {
  if (error) {
    return (
      <p
        ref={statusRef}
        tabIndex={-1}
        role="alert"
        className="text-[15px] font-semibold outline-none"
        style={{ color: "#B24343" }}
      >
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="text-[15px] font-semibold outline-none"
        style={{ color: "#1F8A5B" }}
      >
        {successText}
      </p>
    );
  }
  return null;
}
