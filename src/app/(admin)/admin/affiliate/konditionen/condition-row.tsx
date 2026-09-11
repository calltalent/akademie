"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { deleteAffiliateCondition } from "@/lib/affiliate/actions";
import { initialAffiliateConditionActionState } from "@/lib/affiliate/state";

import { useStatusFocus } from "../use-status-focus";
import { ConditionForm, type ConditionFormValues } from "./condition-form";
import {
  CARD_BORDER,
  FOCUS_RING,
  HAIRLINE,
  INK,
  MUTED,
} from "../affiliate-format";

/**
 * Affiliate-System, Block B6-B — eine Zeile der Vorrangkette
 * (PLAN_Affiliate-System.md 8.1 Zeile 4, 5.2).
 *
 * Die Spalte „Rang" ist keine Zierde: die Liste steht in exakt der
 * Reihenfolge, in der `resolveCondition()` prüft (`specificity desc`,
 * `valid_from desc`, `id`), und die Nummer ist damit die Antwort auf „warum
 * greift diese Regel und nicht jene?". Sie kommt als `rank` von der Seite,
 * die dieselbe sortierte Liste rendert — nicht aus einer zweiten Sortierung
 * hier.
 *
 * Alle Werte (Satz, Zeitraum, Geltungsbereich) kommen FERTIG FORMATIERT von
 * der Server Component.
 */

export const CONDITION_COLS = "0.5fr 1.3fr 1.2fr 0.8fr 0.9fr 1.3fr 0.8fr";

export function ConditionRow({
  rank,
  values,
  scopeText,
  productText,
  kindText,
  rateText,
  periodText,
  noteText,
  partners,
  groups,
  products,
  defaultValidFrom,
}: {
  rank: number;
  values: ConditionFormValues;
  scopeText: string;
  productText: string;
  kindText: string;
  rateText: string;
  periodText: string;
  noteText: string | null;
  partners: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  products: Array<{ id: string; title: string }>;
  defaultValidFrom: string;
}) {
  const t = useTranslations("admin.affiliate");
  const tCommon = useTranslations("admin.common");
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteAffiliateCondition,
    initialAffiliateConditionActionState,
  );
  const statusRef = useStatusFocus(Boolean(deleteState.error));

  return (
    <div style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <div
        className="rgrid-row px-[18px] py-4 text-[15px] lg:px-[24px]"
        style={{ "--rgrid-cols": CONDITION_COLS } as React.CSSProperties}
      >
        <div>
          <span className="rgrid-label">{t("conditions.columnRank")}</span>
          <span className="font-bold" style={{ color: INK }}>
            {rank}
          </span>
        </div>
        <div className="min-w-0">
          <span className="rgrid-label">{t("conditions.columnScope")}</span>
          <span style={{ color: INK }}>{scopeText}</span>
        </div>
        <div className="min-w-0">
          <span className="rgrid-label">{t("conditions.columnProduct")}</span>
          <span style={{ color: MUTED }}>{productText}</span>
        </div>
        <div>
          <span className="rgrid-label">{t("conditions.columnKind")}</span>
          <span style={{ color: MUTED }}>{kindText}</span>
        </div>
        <div>
          <span className="rgrid-label">{t("conditions.columnRate")}</span>
          <span className="font-semibold" style={{ color: INK }}>
            {rateText}
          </span>
        </div>
        <div className="min-w-0">
          <span className="rgrid-label">{t("conditions.columnPeriod")}</span>
          <span style={{ color: MUTED }}>{periodText}</span>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className={`min-h-[40px] rounded-[11px] border px-[14px] text-[15px] font-semibold ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          >
            {expanded ? t("conditions.form.close") : t("conditions.form.edit")}
          </button>
        </div>
      </div>

      {noteText && (
        <p
          className="px-[18px] pb-3 text-[15px] lg:px-[24px]"
          style={{ color: MUTED }}
        >
          {t("conditions.form.noteLabel")}: {noteText}
        </p>
      )}

      {deleteState.error && (
        <p
          ref={statusRef}
          tabIndex={-1}
          role="alert"
          className="px-[18px] pb-3 text-[15px] font-semibold outline-none lg:px-[24px]"
          style={{ color: "#B24343" }}
        >
          {deleteState.error}
        </p>
      )}

      {expanded && (
        <div className="flex flex-col gap-4 px-[18px] pb-6 lg:px-[24px]">
          <ConditionForm
            condition={values}
            partners={partners}
            groups={groups}
            products={products}
            defaultValidFrom={defaultValidFrom}
          />

          {confirming ? (
            <form
              action={deleteAction}
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="conditionId" value={values.id} />
              <p className="w-full text-[15px]" style={{ color: "#B24343" }}>
                {t("conditions.form.deleteConfirm")}
              </p>
              <button
                type="submit"
                disabled={deletePending}
                className={`min-h-[40px] rounded-[11px] px-[14px] text-[15px] font-bold text-white disabled:opacity-50 ${FOCUS_RING}`}
                style={{ background: "#B24343" }}
              >
                {deletePending
                  ? tCommon("saving")
                  : t("conditions.form.deleteConfirmYes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={`min-h-[40px] rounded-[11px] border px-[14px] text-[15px] font-semibold ${FOCUS_RING}`}
                style={{ borderColor: CARD_BORDER, color: INK }}
              >
                {t("conditions.form.deleteConfirmNo")}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={`min-h-[40px] self-start rounded-[11px] border px-[14px] text-[15px] font-semibold ${FOCUS_RING}`}
              style={{ borderColor: CARD_BORDER, color: "#B24343" }}
            >
              {t("conditions.form.delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
