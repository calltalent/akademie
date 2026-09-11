"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createAffiliateCondition,
  updateAffiliateCondition,
} from "@/lib/affiliate/actions";
import { initialAffiliateConditionActionState } from "@/lib/affiliate/state";
import { centsToEuroInput } from "@/lib/affiliate/schema";
import type { AffiliateRateKind } from "@/lib/affiliate/types";

import { useStatusFocus } from "../use-status-focus";
import { CARD_BORDER, FOCUS_RING, INK, MUTED } from "../affiliate-format";

/**
 * Affiliate-System, Block B6-B — Formular einer Kondition
 * (PLAN_Affiliate-System.md 3.5, 5.2, 8.1 Zeile 4).
 *
 * Ein Formular für Anlegen und Ändern, wie `ListingForm` im Marketplace:
 * `condition` gesetzt bindet `updateAffiliateCondition`, sonst
 * `createAffiliateCondition`.
 *
 * GELTUNGSBEREICH: Partner und Gruppe schließen sich aus (CHECK in 3.5, und
 * `affiliateConditionSchema` spiegelt es). Deshalb zeigt das Formular immer
 * nur EINES der beiden Auswahlfelder — das jeweils andere wird gar nicht
 * abgeschickt und kann so auch nicht versehentlich gesetzt bleiben. Der
 * Server weist die unzulässige Kombination trotzdem ab; diese Oberfläche
 * erspart nur den Weg dorthin.
 *
 * SATZ IN BASISPUNKTEN: die Datenbank speichert `rate_bp` (1 bp = 0,01 %),
 * und das Schema nimmt genau diesen Wert. Das Feld heißt deshalb auch so und
 * zeigt daneben laufend die Prozentangabe — eine stille Umrechnung im Browser
 * wäre ein zweiter Rechenweg an genau der Stelle, an der es um den Satz geht.
 */

const fieldClass =
  "w-full min-h-[40px] rounded-[10px] border px-[13px] py-[11px] text-[15px]";
const labelClass = "mb-1.5 block text-[13px] font-semibold";

export type ConditionFormValues = {
  id: string;
  partnerId: string | null;
  groupId: string | null;
  productId: string | null;
  rateKind: AffiliateRateKind;
  rateBp: number;
  fixedCents: number;
  /** Für `<input type="datetime-local">`, also `JJJJ-MM-TTThh:mm`. */
  validFrom: string;
  validTo: string | null;
  note: string | null;
};

export function ConditionForm({
  condition,
  partners,
  groups,
  products,
  defaultValidFrom,
}: {
  condition?: ConditionFormValues;
  partners: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  products: Array<{ id: string; title: string }>;
  /** Vom Server gerechnet — `new Date()` im Browser erzeugte einen Hydrationsunterschied. */
  defaultValidFrom: string;
}) {
  const t = useTranslations("admin.affiliate");
  const tCommon = useTranslations("admin.common");
  const isEdit = condition !== undefined;
  const [state, formAction, pending] = useActionState(
    isEdit ? updateAffiliateCondition : createAffiliateCondition,
    initialAffiliateConditionActionState,
  );
  const [scope, setScope] = useState<"all" | "group" | "partner">(
    condition?.partnerId ? "partner" : condition?.groupId ? "group" : "all",
  );
  const [rateKind, setRateKind] = useState<AffiliateRateKind>(
    condition?.rateKind ?? "percent",
  );
  const [rateBp, setRateBp] = useState(String(condition?.rateBp ?? 0));
  const statusRef = useStatusFocus(
    Boolean(state.success) || Boolean(state.error),
  );
  const idPrefix = condition?.id ?? "new";

  const parsedBp = Number.parseInt(rateBp, 10);
  const percentPreview = Number.isFinite(parsedBp)
    ? (parsedBp / 100).toFixed(2)
    : "—";

  return (
    <form action={formAction} className="flex flex-col">
      {isEdit && (
        <input type="hidden" name="conditionId" value={condition.id} />
      )}

      <label
        htmlFor={`${idPrefix}-scope`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {t("conditions.form.scopeLabel")}
      </label>
      <select
        id={`${idPrefix}-scope`}
        value={scope}
        onChange={(event) =>
          setScope(event.target.value as "all" | "group" | "partner")
        }
        className={`${fieldClass} mb-4 bg-white ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      >
        <option value="all">{t("conditions.scopeAll")}</option>
        <option value="group">{t("conditions.scopeGroup")}</option>
        <option value="partner">{t("conditions.scopePartner")}</option>
      </select>

      {scope === "partner" && (
        <>
          <label
            htmlFor={`${idPrefix}-partner`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("conditions.form.partnerLabel")}
          </label>
          <select
            id={`${idPrefix}-partner`}
            name="partnerId"
            required
            defaultValue={condition?.partnerId ?? ""}
            className={`${fieldClass} mb-4 bg-white ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          >
            <option value="">{t("conditions.form.selectPlaceholder")}</option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
        </>
      )}

      {scope === "group" && (
        <>
          <label
            htmlFor={`${idPrefix}-group`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("conditions.form.groupLabel")}
          </label>
          <select
            id={`${idPrefix}-group`}
            name="groupId"
            required
            defaultValue={condition?.groupId ?? ""}
            className={`${fieldClass} mb-4 bg-white ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          >
            <option value="">{t("conditions.form.selectPlaceholder")}</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </>
      )}

      <label
        htmlFor={`${idPrefix}-product`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {t("conditions.form.productLabel")}
      </label>
      <select
        id={`${idPrefix}-product`}
        name="productId"
        defaultValue={condition?.productId ?? ""}
        className={`${fieldClass} mb-4 bg-white ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      >
        <option value="">{t("conditions.productAll")}</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.title}
          </option>
        ))}
      </select>

      <label
        htmlFor={`${idPrefix}-kind`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {t("conditions.form.kindLabel")}
      </label>
      <select
        id={`${idPrefix}-kind`}
        name="rateKind"
        value={rateKind}
        onChange={(event) =>
          setRateKind(event.target.value as AffiliateRateKind)
        }
        className={`${fieldClass} mb-4 bg-white ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      >
        <option value="percent">{t("conditions.form.kindPercent")}</option>
        <option value="fixed">{t("conditions.form.kindFixed")}</option>
      </select>

      {/* Beide Felder gehen immer mit: `affiliateConditionSchema` verlangt
          `rateBp` UND `fixedCents`, und der jeweils nicht benutzte Wert wird
          serverseitig ignoriert. Das nicht gewählte Feld ist deshalb
          ausgeblendet, aber als `hidden` weiterhin vorhanden — sonst
          scheiterte das Absenden an einem fehlenden Pflichtfeld. */}
      {rateKind === "percent" ? (
        <>
          <label
            htmlFor={`${idPrefix}-rate`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("conditions.form.rateBpLabel")}
          </label>
          <input
            id={`${idPrefix}-rate`}
            name="rateBp"
            type="number"
            min={0}
            max={10000}
            step={1}
            required
            value={rateBp}
            onChange={(event) => setRateBp(event.target.value)}
            aria-describedby={`${idPrefix}-rate-hint`}
            className={`${fieldClass} mb-1 ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
          <p
            id={`${idPrefix}-rate-hint`}
            className="mb-4 text-[13px]"
            style={{ color: MUTED }}
          >
            {t("conditions.form.rateBpHint", { percent: percentPreview })}
          </p>
          <input
            type="hidden"
            name="fixedCents"
            value={condition?.fixedCents ?? 0}
          />
        </>
      ) : (
        <>
          <label
            htmlFor={`${idPrefix}-fixed`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("conditions.form.fixedCentsLabel")}
          </label>
          <input
            id={`${idPrefix}-fixed`}
            name="fixedCents"
            type="number"
            min={0}
            step={1}
            required
            defaultValue={condition?.fixedCents ?? 0}
            aria-describedby={`${idPrefix}-fixed-hint`}
            className={`${fieldClass} mb-1 ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
          <p
            id={`${idPrefix}-fixed-hint`}
            className="mb-4 text-[13px]"
            style={{ color: MUTED }}
          >
            {t("conditions.form.fixedCentsHint", {
              euro: centsToEuroInput(condition?.fixedCents ?? 0),
            })}
          </p>
          <input type="hidden" name="rateBp" value={rateBp} />
        </>
      )}

      <label
        htmlFor={`${idPrefix}-from`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {t("conditions.form.validFromLabel")}
      </label>
      <input
        id={`${idPrefix}-from`}
        name="validFrom"
        type="datetime-local"
        required
        defaultValue={condition?.validFrom ?? defaultValidFrom}
        aria-describedby={isEdit ? `${idPrefix}-from-hint` : undefined}
        className={`${fieldClass} mb-1 ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      />
      {isEdit && (
        /* `updateAffiliateCondition()` schreibt `valid_from` NICHT fort (siehe
           dort): der Beginn einer geltenden Regel ist Teil ihrer Identität im
           Ausschluss-Index. Das Feld bleibt sichtbar, weil das Schema es
           verlangt — geändert wird damit nichts. */
        <p
          id={`${idPrefix}-from-hint`}
          className="mb-4 text-[13px]"
          style={{ color: MUTED }}
        >
          {t("conditions.form.validFromLocked")}
        </p>
      )}
      {!isEdit && <div className="mb-4" />}

      <label
        htmlFor={`${idPrefix}-to`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {t("conditions.form.validToLabel")}
      </label>
      <input
        id={`${idPrefix}-to`}
        name="validTo"
        type="datetime-local"
        defaultValue={condition?.validTo ?? ""}
        className={`${fieldClass} mb-4 ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      />

      <label
        htmlFor={`${idPrefix}-note`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {t("conditions.form.noteLabel")}
      </label>
      <input
        id={`${idPrefix}-note`}
        name="note"
        type="text"
        maxLength={500}
        defaultValue={condition?.note ?? ""}
        className={`${fieldClass} mb-4 ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      />

      {state.error && (
        <p
          ref={statusRef}
          tabIndex={-1}
          role="alert"
          className="mb-3 text-[15px] font-semibold outline-none"
          style={{ color: "#B24343" }}
        >
          {state.error}
        </p>
      )}
      {state.success && !state.error && (
        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="mb-3 text-[15px] font-semibold outline-none"
          style={{ color: "#1F8A5B" }}
        >
          {t("conditions.form.saved")}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`min-h-[44px] rounded-[11px] px-[18px] text-[15px] font-bold text-white disabled:opacity-50 ${FOCUS_RING}`}
        style={{ background: "#5663AE" }}
      >
        {pending ? tCommon("saving") : t("conditions.form.submit")}
      </button>
    </form>
  );
}
