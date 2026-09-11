"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createAffiliateGroup,
  deleteAffiliateGroup,
  renameAffiliateGroup,
} from "@/lib/affiliate/actions";
import { initialAffiliateGroupActionState } from "@/lib/affiliate/state";

import { useStatusFocus } from "../use-status-focus";
import {
  CARD_BORDER,
  CARD_CLASS,
  FOCUS_RING,
  HAIRLINE,
  INK,
  MUTED,
} from "../affiliate-format";

/**
 * Affiliate-System, Block B6-B — Partnergruppen (3.4, 8.1).
 *
 * Eine Gruppe trägt selbst KEINEN Satz; sie ist nur der Geltungsbereich, auf
 * den sich eine Kondition beziehen kann (3.4/3.5). Deshalb steht hier auch
 * kein Prozentfeld, und der Hinweis darauf steht in der Oberfläche — sonst
 * legt jemand eine Gruppe „40 %" an und wundert sich, dass 20 % gebucht
 * werden.
 *
 * Löschen ist folgenreich und deshalb zweistufig: die Kaskade
 * (`on delete set null` für Partner, Kaskade für Konditionen mit dieser
 * Gruppe, siehe `deleteAffiliateGroup()`) steht im Bestätigungstext, bevor
 * der zweite Klick kommt. Bestätigt wird über ein sichtbares Feld und nicht
 * über `window.confirm()`: ein Browserdialog ist nicht gestaltbar, wird von
 * Screenreadern uneinheitlich angesagt, und der Text darin lässt sich nicht
 * übersetzen.
 */

const fieldClass =
  "w-full min-h-[40px] rounded-[10px] border px-[13px] py-[11px] text-[15px]";

export function PartnerGroups({
  groups,
}: {
  groups: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("admin.affiliate");
  const tCommon = useTranslations("admin.common");
  const [state, formAction, pending] = useActionState(
    createAffiliateGroup,
    initialAffiliateGroupActionState,
  );
  const statusRef = useStatusFocus(
    Boolean(state.success) || Boolean(state.error),
  );
  const idPrefix = useId();

  return (
    <section
      aria-labelledby="affiliate-groups-heading"
      className={`${CARD_CLASS} p-[22px_24px]`}
      style={{ borderColor: CARD_BORDER }}
    >
      <h2
        id="affiliate-groups-heading"
        className="text-[17px] font-bold"
        style={{ color: INK }}
      >
        {t("partners.groups.heading")}
      </h2>
      <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
        {t("partners.groups.description")}
      </p>

      <ul
        className="mt-4 flex flex-col gap-3 p-0"
        style={{ listStyle: "none" }}
      >
        {groups.length === 0 && (
          <li className="text-[15px]" style={{ color: MUTED }}>
            {t("partners.groups.empty")}
          </li>
        )}
        {groups.map((group) => (
          <li
            key={group.id}
            className="pt-3"
            style={{ borderTop: `1px solid ${HAIRLINE}` }}
          >
            <GroupRow group={group} />
          </li>
        ))}
      </ul>

      <form action={formAction} className="mt-5 flex flex-col">
        <label
          htmlFor={`${idPrefix}-new-group`}
          className="mb-1.5 block text-[13px] font-semibold"
          style={{ color: MUTED }}
        >
          {t("partners.groups.nameLabel")}
        </label>
        <input
          id={`${idPrefix}-new-group`}
          name="name"
          type="text"
          required
          maxLength={100}
          className={`${fieldClass} mb-3 ${FOCUS_RING}`}
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
            {t("partners.groups.created")}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className={`min-h-[44px] rounded-[11px] border px-[18px] text-[15px] font-bold disabled:opacity-50 ${FOCUS_RING}`}
          style={{ borderColor: CARD_BORDER, color: INK }}
        >
          {pending ? tCommon("saving") : t("partners.groups.create")}
        </button>
      </form>
    </section>
  );
}

/** Eine Gruppe: umbenennen oder löschen. */
function GroupRow({ group }: { group: { id: string; name: string } }) {
  const t = useTranslations("admin.affiliate");
  const tCommon = useTranslations("admin.common");
  const [renameState, renameAction, renamePending] = useActionState(
    renameAffiliateGroup,
    initialAffiliateGroupActionState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteAffiliateGroup,
    initialAffiliateGroupActionState,
  );
  const [confirming, setConfirming] = useState(false);
  const statusRef = useStatusFocus(
    Boolean(renameState.success) ||
      Boolean(renameState.error) ||
      Boolean(deleteState.success) ||
      Boolean(deleteState.error),
  );
  const idPrefix = useId();

  const message = renameState.error ?? deleteState.error ?? null;
  const succeeded =
    (renameState.success ?? false) || (deleteState.success ?? false);

  return (
    <div className="flex flex-col gap-2">
      <form action={renameAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="groupId" value={group.id} />
        <div className="min-w-[180px] flex-1">
          <label
            htmlFor={`${idPrefix}-name`}
            className="mb-1.5 block text-[13px] font-semibold"
            style={{ color: MUTED }}
          >
            {t("partners.groups.nameLabel")}
          </label>
          <input
            id={`${idPrefix}-name`}
            name="name"
            type="text"
            required
            maxLength={100}
            defaultValue={group.name}
            className={`${fieldClass} ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
        </div>
        <button
          type="submit"
          disabled={renamePending}
          className={`min-h-[40px] rounded-[11px] border px-[14px] text-[15px] font-semibold disabled:opacity-50 ${FOCUS_RING}`}
          style={{ borderColor: CARD_BORDER, color: INK }}
        >
          {renamePending ? tCommon("saving") : t("partners.groups.rename")}
        </button>
      </form>

      {confirming ? (
        <form
          action={deleteAction}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="groupId" value={group.id} />
          <p className="w-full text-[15px]" style={{ color: "#B24343" }}>
            {t("partners.groups.deleteConfirm", { name: group.name })}
          </p>
          <button
            type="submit"
            disabled={deletePending}
            className={`min-h-[40px] rounded-[11px] px-[14px] text-[15px] font-bold text-white disabled:opacity-50 ${FOCUS_RING}`}
            style={{ background: "#B24343" }}
          >
            {deletePending
              ? tCommon("saving")
              : t("partners.groups.deleteConfirmYes")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className={`min-h-[40px] rounded-[11px] border px-[14px] text-[15px] font-semibold ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          >
            {t("partners.groups.deleteConfirmNo")}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`min-h-[40px] self-start rounded-[11px] border px-[14px] text-[15px] font-semibold ${FOCUS_RING}`}
          style={{ borderColor: CARD_BORDER, color: "#B24343" }}
        >
          {t("partners.groups.delete")}
        </button>
      )}

      {message !== null && (
        <p
          ref={statusRef}
          tabIndex={-1}
          role="alert"
          className="text-[15px] font-semibold outline-none"
          style={{ color: "#B24343" }}
        >
          {message}
        </p>
      )}
      {succeeded && message === null && (
        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="text-[15px] font-semibold outline-none"
          style={{ color: "#1F8A5B" }}
        >
          {t("partners.groups.saved")}
        </p>
      )}
    </div>
  );
}
