"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  approveAffiliatePartner,
  rejectAffiliatePartner,
  saveAffiliatePartnerAdminFields,
  suspendAffiliatePartner,
} from "@/lib/affiliate/actions";
import {
  initialAffiliatePartnerActionState,
  type AffiliatePartnerActionState,
} from "@/lib/affiliate/state";
import type { AffiliatePartnerStatus } from "@/lib/affiliate/types";

import { ManualBookingForm } from "../../manual-booking-form";
import { useStatusFocus } from "../../use-status-focus";
import {
  CARD_BORDER,
  CARD_CLASS,
  FOCUS_RING,
  INK,
  MUTED,
} from "../../affiliate-format";

/**
 * Affiliate-System, Block B6-B — die Aktionen der Partnerseite
 * (PLAN_Affiliate-System.md 8.1, Zeile 3: „freigeben, ablehnen mit
 * Begründung, sperren, Auszahlungssperre, Handbuchung, interne Notiz").
 *
 * JE VORGANG EIN EIGENES FORMULAR MIT EIGENER ACTION. Der Zielstatus kommt
 * nie aus einem Formularfeld — `actions.ts` hält das ausdrücklich fest
 * („sonst genügte ein geändertes Hidden-Feld, um aus ‚ablehnen' ein
 * ‚freigeben' zu machen"). Die Oberfläche spiegelt diese Trennung, statt sie
 * mit einem `<select name="status">` wieder einzureißen.
 *
 * Was hier NICHT passiert: keine Prüfung, ob der handelnde Manager selbst
 * dieser Partner ist. Das ist G15 und gehört in die Server Action
 * (`assertNoSelfApproval()`); eine Prüfung im Browser wäre ein Vorschlag,
 * keine Grenze. Die Oberfläche zeigt nur die Meldung, die von dort
 * zurückkommt.
 *
 * Fokusführung (8.5): jede Action meldet sich in einer `role="status"`- bzw.
 * `role="alert"`-Zeile mit `tabIndex={-1}`, und `useStatusFocus()` setzt den
 * Fokus dorthin. Ohne das steht der Betreiber nach „Freigeben" wieder am
 * Seitenanfang.
 */

const fieldClass =
  "w-full min-h-[40px] rounded-[10px] border px-[13px] py-[11px] text-[15px]";
const labelClass = "mb-1.5 block text-[13px] font-semibold";

export function PartnerDetailActions({
  partnerId,
  status,
  groupId,
  referredBy,
  payoutHold,
  payoutHoldReason,
  internalNote,
  currency,
  groups,
  partners,
}: {
  partnerId: string;
  status: AffiliatePartnerStatus;
  groupId: string | null;
  referredBy: string | null;
  payoutHold: boolean;
  payoutHoldReason: string | null;
  internalNote: string | null;
  currency: string;
  groups: Array<{ id: string; name: string }>;
  partners: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("admin.affiliate");

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section
        aria-labelledby="affiliate-actions-heading"
        className={`${CARD_CLASS} p-[22px_24px]`}
        style={{ borderColor: CARD_BORDER }}
      >
        <h2
          id="affiliate-actions-heading"
          className="text-[17px] font-bold"
          style={{ color: INK }}
        >
          {t("partner.actions.heading")}
        </h2>

        {/* Freigeben: aus einer offenen Bewerbung ODER aus einer Sperre
            heraus. Bei `rejected` ebenfalls möglich — eine Ablehnung ist eine
            Entscheidung, keine Endstation. */}
        {status !== "active" && (
          <StatusActionForm
            action={approveAffiliatePartner}
            partnerId={partnerId}
            submitLabel={
              status === "suspended"
                ? t("partner.actions.unsuspend")
                : t("partner.actions.approve")
            }
            reasonLabel={t("partner.actions.reasonLabel")}
            reasonRequired={false}
            tone="primary"
          />
        )}

        {status !== "rejected" && (
          <StatusActionForm
            action={rejectAffiliatePartner}
            partnerId={partnerId}
            submitLabel={t("partner.actions.reject")}
            reasonLabel={t("partner.actions.reasonLabel")}
            reasonRequired
            tone="danger"
          />
        )}

        {status !== "suspended" && (
          <StatusActionForm
            action={suspendAffiliatePartner}
            partnerId={partnerId}
            submitLabel={t("partner.actions.suspend")}
            reasonLabel={t("partner.actions.reasonLabel")}
            reasonRequired
            tone="danger"
          />
        )}
      </section>

      <AdminFieldsForm
        partnerId={partnerId}
        groupId={groupId}
        referredBy={referredBy}
        payoutHold={payoutHold}
        payoutHoldReason={payoutHoldReason}
        internalNote={internalNote}
        groups={groups}
        partners={partners}
      />

      {/* Dieselbe Komponente wie in der Provisionsliste, hier mit fester
          Partnerzeile (11.17 steht damit nur an einer Stelle). */}
      <ManualBookingForm partnerId={partnerId} currency={currency} />
    </div>
  );
}

/**
 * Ein Statuswechsel. `action` ist die fertige Server Action; der Zielstatus
 * steckt in ihr und nicht in diesem Formular.
 */
function StatusActionForm({
  action,
  partnerId,
  submitLabel,
  reasonLabel,
  reasonRequired,
  tone,
}: {
  action: (
    prev: AffiliatePartnerActionState,
    formData: FormData,
  ) => Promise<AffiliatePartnerActionState>;
  partnerId: string;
  submitLabel: string;
  reasonLabel: string;
  reasonRequired: boolean;
  tone: "primary" | "danger";
}) {
  const t = useTranslations("admin.affiliate");
  const tCommon = useTranslations("admin.common");
  const [state, formAction, pending] = useActionState(
    action,
    initialAffiliatePartnerActionState,
  );
  const statusRef = useStatusFocus(
    Boolean(state.success) || Boolean(state.error),
  );
  const idPrefix = useId();

  return (
    <form
      action={formAction}
      className="mt-4 flex flex-col border-t pt-4"
      style={{ borderColor: CARD_BORDER }}
    >
      <input type="hidden" name="partnerId" value={partnerId} />
      <label
        htmlFor={`${idPrefix}-reason`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {reasonLabel}
        {!reasonRequired && ` ${t("partner.actions.reasonOptional")}`}
      </label>
      <textarea
        id={`${idPrefix}-reason`}
        name="reason"
        rows={2}
        required={reasonRequired}
        maxLength={1000}
        className={`${fieldClass} mb-3 resize-y ${FOCUS_RING}`}
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
          {t("partner.actions.saved")}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className={`min-h-[44px] self-start rounded-[11px] px-[18px] text-[15px] font-bold disabled:opacity-50 ${FOCUS_RING}`}
        style={
          tone === "primary"
            ? { background: "#5663AE", color: "#FFFFFF" }
            : {
                background: "#FFFFFF",
                border: `1px solid ${CARD_BORDER}`,
                color: "#B24343",
              }
        }
      >
        {pending ? tCommon("saving") : submitLabel}
      </button>
    </form>
  );
}

/** Gruppe, Werber, Auszahlungssperre und interne Notiz — alle vier in EINEM Formular. */
function AdminFieldsForm({
  partnerId,
  groupId,
  referredBy,
  payoutHold,
  payoutHoldReason,
  internalNote,
  groups,
  partners,
}: {
  partnerId: string;
  groupId: string | null;
  referredBy: string | null;
  payoutHold: boolean;
  payoutHoldReason: string | null;
  internalNote: string | null;
  groups: Array<{ id: string; name: string }>;
  partners: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("admin.affiliate");
  const tCommon = useTranslations("admin.common");
  const [state, formAction, pending] = useActionState(
    saveAffiliatePartnerAdminFields,
    initialAffiliatePartnerActionState,
  );
  const [holdChecked, setHoldChecked] = useState(payoutHold);
  const statusRef = useStatusFocus(
    Boolean(state.success) || Boolean(state.error),
  );
  const idPrefix = useId();

  return (
    <section
      aria-labelledby="affiliate-adminfields-heading"
      className={`${CARD_CLASS} p-[22px_24px]`}
      style={{ borderColor: CARD_BORDER }}
    >
      <h2
        id="affiliate-adminfields-heading"
        className="text-[17px] font-bold"
        style={{ color: INK }}
      >
        {t("partner.admin.heading")}
      </h2>
      {/* Alle vier Felder gehen gemeinsam ab — das Formular schickt also auch
          die Werte, die niemand angefasst hat. Genau deshalb sind sie alle
          vorbelegt: ein leer gelassenes Feld LÖSCHT den bestehenden Wert
          (`optionalUuid`/`optionalText` -> null im Schema). */}
      <form action={formAction} className="mt-3 flex flex-col">
        <input type="hidden" name="partnerId" value={partnerId} />

        <label
          htmlFor={`${idPrefix}-group`}
          className={labelClass}
          style={{ color: MUTED }}
        >
          {t("partner.master.groupLabel")}
        </label>
        <select
          id={`${idPrefix}-group`}
          name="groupId"
          defaultValue={groupId ?? ""}
          className={`${fieldClass} mb-4 bg-white ${FOCUS_RING}`}
          style={{ borderColor: CARD_BORDER, color: INK }}
        >
          <option value="">{t("partners.noGroup")}</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>

        <label
          htmlFor={`${idPrefix}-referrer`}
          className={labelClass}
          style={{ color: MUTED }}
        >
          {t("partner.master.referredByLabel")}
        </label>
        <select
          id={`${idPrefix}-referrer`}
          name="referredBy"
          defaultValue={referredBy ?? ""}
          className={`${fieldClass} mb-4 bg-white ${FOCUS_RING}`}
          style={{ borderColor: CARD_BORDER, color: INK }}
        >
          <option value="">{t("partner.admin.noReferrer")}</option>
          {/* Der Partner selbst steht nicht zur Wahl: `check (referred_by is
              null or referred_by <> id)` (3.3) wiese das ohnehin ab. */}
          {partners
            .filter((partner) => partner.id !== partnerId)
            .map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
        </select>

        <label
          htmlFor={`${idPrefix}-hold`}
          className="mb-3 flex min-h-[40px] items-center gap-2 text-[15px]"
          style={{ color: INK }}
        >
          <input
            id={`${idPrefix}-hold`}
            name="payoutHold"
            type="checkbox"
            defaultChecked={payoutHold}
            onChange={(event) => setHoldChecked(event.target.checked)}
            className={FOCUS_RING}
          />
          {t("partner.actions.payoutHold")}
        </label>

        <label
          htmlFor={`${idPrefix}-holdreason`}
          className={labelClass}
          style={{ color: MUTED }}
        >
          {t("partner.admin.payoutHoldReasonLabel")}
        </label>
        <input
          id={`${idPrefix}-holdreason`}
          name="payoutHoldReason"
          type="text"
          maxLength={1000}
          required={holdChecked}
          defaultValue={payoutHoldReason ?? ""}
          aria-describedby={`${idPrefix}-holdreason-hint`}
          className={`${fieldClass} mb-1 ${FOCUS_RING}`}
          style={{ borderColor: CARD_BORDER, color: INK }}
        />
        <p
          id={`${idPrefix}-holdreason-hint`}
          className="mb-4 text-[13px]"
          style={{ color: MUTED }}
        >
          {t("partner.admin.payoutHoldReasonHint")}
        </p>

        <label
          htmlFor={`${idPrefix}-note`}
          className={labelClass}
          style={{ color: MUTED }}
        >
          {t("partner.actions.noteLabel")}
        </label>
        <textarea
          id={`${idPrefix}-note`}
          name="internalNote"
          rows={3}
          maxLength={2000}
          defaultValue={internalNote ?? ""}
          aria-describedby={`${idPrefix}-note-hint`}
          className={`${fieldClass} mb-1 resize-y ${FOCUS_RING}`}
          style={{ borderColor: CARD_BORDER, color: INK }}
        />
        <p
          id={`${idPrefix}-note-hint`}
          className="mb-4 text-[13px]"
          style={{ color: MUTED }}
        >
          {t("partner.admin.noteHint")}
        </p>

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
            {t("partner.actions.saved")}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className={`min-h-[44px] self-start rounded-[11px] px-[18px] text-[15px] font-bold text-white disabled:opacity-50 ${FOCUS_RING}`}
          style={{ background: "#5663AE" }}
        >
          {pending ? tCommon("saving") : t("partner.actions.save")}
        </button>
      </form>
    </section>
  );
}
