"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { createAffiliateManualBooking } from "@/lib/affiliate/actions";
import { initialAffiliateCommissionActionState } from "@/lib/affiliate/state";

import { useStatusFocus } from "./use-status-focus";
import {
  CARD_BORDER,
  CARD_CLASS,
  FOCUS_RING,
  INK,
  MUTED,
} from "./affiliate-format";

/**
 * Affiliate-System, Block B6-B — die Handbuchung (PLAN_Affiliate-System.md
 * 8.1 Zeilen 3 und 5, 11.17).
 *
 * EINE Komponente für beide Orte: auf der Partnerseite steht der Partner
 * fest (`partners` fehlt, die ID kommt als verstecktes Feld), in der
 * Provisionsliste wird er gewählt. Zwei Fassungen desselben Geldformulars
 * wären zwei Orte, an denen die Bestätigungsschwelle aus 11.17 stehen müsste
 * — und einer davon würde sie irgendwann verlieren.
 *
 * DIE ZWEITE BESTÄTIGUNG (11.17): über 500 € verlangt
 * `createAffiliateManualBooking()` den Betrag ein zweites Mal, und er muss
 * auf denselben Cent parsen. Hier wird das Feld eingeblendet, sobald die
 * Eingabe die Schwelle überschreitet. Der Browser entscheidet damit nichts:
 * fehlt das Feld oder weicht es ab, weist der Server ab. Die Einblendung ist
 * nur der Hinweis, dass gleich eine zweite Eingabe verlangt wird.
 *
 * Ein negativer Betrag ist zulässig und gewollt (Korrektur ohne Änderung
 * einer bestehenden Zeile, G4); der Hinweistext sagt das, damit niemand das
 * Minuszeichen für einen Tippfehler hält.
 */

const fieldClass =
  "w-full min-h-[40px] rounded-[10px] border px-[13px] py-[11px] text-[15px]";
const labelClass = "mb-1.5 block text-[13px] font-semibold";

/** Wortgleich zu `AFFILIATE_MANUAL_CONFIRM_THRESHOLD_CENTS` in `actions.ts` (50 000 Cent). */
const MANUAL_CONFIRM_THRESHOLD_EURO = 500;

export function ManualBookingForm({
  partnerId,
  partners,
  currency,
}: {
  /** Feste Partnerzeile (Partnerseite). Genau eines von beiden setzen. */
  partnerId?: string;
  /** Auswahlliste (Provisionsliste). */
  partners?: Array<{ id: string; name: string }>;
  currency: string;
}) {
  const t = useTranslations("admin.affiliate");
  const tCommon = useTranslations("admin.common");
  const [state, formAction, pending] = useActionState(
    createAffiliateManualBooking,
    initialAffiliateCommissionActionState,
  );
  const [amount, setAmount] = useState("");
  const statusRef = useStatusFocus(
    Boolean(state.success) || Boolean(state.error),
  );
  const idPrefix = useId();

  const parsed = Number.parseFloat(amount.replace(",", "."));
  const needsConfirm =
    Number.isFinite(parsed) && Math.abs(parsed) > MANUAL_CONFIRM_THRESHOLD_EURO;

  return (
    <section
      aria-labelledby={`${idPrefix}-heading`}
      className={`${CARD_CLASS} p-[22px_24px]`}
      style={{ borderColor: CARD_BORDER }}
    >
      <h2
        id={`${idPrefix}-heading`}
        className="text-[17px] font-bold"
        style={{ color: INK }}
      >
        {t("commissions.manual.heading")}
      </h2>
      <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
        {t("commissions.manual.description")}
      </p>

      <form action={formAction} className="mt-3 flex flex-col">
        {partnerId !== undefined && (
          <input type="hidden" name="partnerId" value={partnerId} />
        )}
        {/* Währung folgt dem Programm (3.2/5.11) und ist deshalb kein
            Eingabefeld — eine Handbuchung in einer fremden Währung wäre ein
            eigener Saldo, den kein Auszahlungslauf aufgreift. */}
        <input type="hidden" name="currency" value={currency} />

        {partners !== undefined && (
          <>
            <label
              htmlFor={`${idPrefix}-partner`}
              className={labelClass}
              style={{ color: MUTED }}
            >
              {t("commissions.manual.partnerLabel")}
            </label>
            <select
              id={`${idPrefix}-partner`}
              name="partnerId"
              required
              defaultValue=""
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

        <label
          htmlFor={`${idPrefix}-amount`}
          className={labelClass}
          style={{ color: MUTED }}
        >
          {t("commissions.manual.amountLabel", {
            currency: currency.toUpperCase(),
          })}
        </label>
        <input
          id={`${idPrefix}-amount`}
          name="amountEuro"
          type="text"
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-describedby={`${idPrefix}-amount-hint`}
          className={`${fieldClass} mb-1 ${FOCUS_RING}`}
          style={{ borderColor: CARD_BORDER, color: INK }}
        />
        <p
          id={`${idPrefix}-amount-hint`}
          className="mb-4 text-[13px]"
          style={{ color: MUTED }}
        >
          {t("commissions.manual.amountHint")}
        </p>

        {needsConfirm && (
          <>
            <label
              htmlFor={`${idPrefix}-confirm`}
              className={labelClass}
              style={{ color: "#8A6D1F" }}
            >
              {t("commissions.manual.confirmLabel")}
            </label>
            <input
              id={`${idPrefix}-confirm`}
              name="confirmAmountEuro"
              type="text"
              inputMode="decimal"
              required
              aria-describedby={`${idPrefix}-confirm-hint`}
              className={`${fieldClass} mb-1 ${FOCUS_RING}`}
              style={{ borderColor: "#E7C98F", color: INK }}
            />
            <p
              id={`${idPrefix}-confirm-hint`}
              className="mb-4 text-[13px]"
              style={{ color: "#8A6D1F" }}
            >
              {t("commissions.manual.confirmHint")}
            </p>
          </>
        )}

        <label
          htmlFor={`${idPrefix}-note`}
          className={labelClass}
          style={{ color: MUTED }}
        >
          {t("commissions.manual.reasonLabel")}
        </label>
        <textarea
          id={`${idPrefix}-note`}
          name="note"
          rows={3}
          required
          minLength={5}
          maxLength={1000}
          className={`${fieldClass} mb-4 resize-y ${FOCUS_RING}`}
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
            {t("commissions.manual.saved")}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className={`min-h-[44px] self-start rounded-[11px] px-[18px] text-[15px] font-bold text-white disabled:opacity-50 ${FOCUS_RING}`}
          style={{ background: "#5663AE" }}
        >
          {pending ? tCommon("saving") : t("commissions.manual.submit")}
        </button>
      </form>
    </section>
  );
}
