"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createAffiliatePartner,
  inviteAffiliatePartner,
} from "@/lib/affiliate/actions";
import { initialAffiliatePartnerActionState } from "@/lib/affiliate/state";
import { CARD_BORDER, FOCUS_RING, INK, MUTED } from "../affiliate-format";

/**
 * Affiliate-System, Block B6-B — Einladung und Handanlage eines Partners
 * (PLAN_Affiliate-System.md 8.1, Zeile 2; 8.5).
 *
 * EIN Formular für beide Wege, umgeschaltet über eine Radiogruppe:
 *   „einladen"  -> `inviteAffiliatePartner()`, Zeile entsteht als `active`
 *                  (Vorab-Freigabe, der Link gilt sofort),
 *   „anlegen"   -> `createAffiliatePartner()`, Zeile entsteht als `pending`
 *                  und muss wie jede Bewerbung freigegeben werden.
 * Zwei getrennte Formulare mit denselben fünf Feldern wären dieselbe Eingabe
 * an zwei Orten — und der Unterschied (sofort freigegeben oder nicht) steht
 * dann nicht mehr zwischen den beiden Möglichkeiten, sondern zwischen zwei
 * Kästen, die man vergleichen muss.
 *
 * Beide Server Actions prüfen ihr Gate selbst (`requireAffiliateManager()`,
 * G10) und beide werten G15 aus — die Auswahl hier ist reine Bedienung, keine
 * Berechtigung.
 *
 * Der erzeugte Link ist der Empfehlungslink des Partners
 * (`/api/aff/k?c=<code>`, 4.2). Er entsteht allein aus dem Code und ist
 * gültig, sobald die Zeile `active` ist; deshalb steht er nur nach dem
 * Einladen und nicht nach dem Anlegen einer Bewerbung.
 */

const fieldClass =
  "w-full min-h-[40px] rounded-[10px] border px-[13px] py-[11px] text-[15px]";
const labelClass = "mb-1.5 block text-[13px] font-semibold";

export function PartnerInviteForm({
  groups,
  linkPrefix,
}: {
  groups: Array<{ id: string; name: string }>;
  linkPrefix: string;
}) {
  const t = useTranslations("admin.affiliate");
  const tCommon = useTranslations("admin.common");
  const [mode, setMode] = useState<"invite" | "create">("invite");
  const [state, formAction, pending] = useActionState(
    mode === "invite" ? inviteAffiliatePartner : createAffiliatePartner,
    initialAffiliatePartnerActionState,
  );
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const idPrefix = useId();

  const link = `${linkPrefix}${code}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Ohne Zwischenablage-Recht bleibt das Feld selbst der Weg: es ist
      // lesbar und markierbar, der Knopf meldet nur keinen Erfolg.
      setCopied(false);
    }
  }

  return (
    <form action={formAction} className="mt-4 flex flex-col">
      <fieldset className="mb-4 border-0 p-0">
        <legend className={labelClass} style={{ color: MUTED }}>
          {t("partners.invite.modeLabel")}
        </legend>
        {(["invite", "create"] as const).map((value) => (
          <label
            key={value}
            htmlFor={`${idPrefix}-mode-${value}`}
            className="flex min-h-[40px] items-center gap-2 text-[15px]"
            style={{ color: INK }}
          >
            <input
              id={`${idPrefix}-mode-${value}`}
              type="radio"
              name="mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
              className={FOCUS_RING}
            />
            {value === "invite"
              ? t("partners.invite.modeInvite")
              : t("partners.invite.modeCreate")}
          </label>
        ))}
      </fieldset>

      <label
        htmlFor={`${idPrefix}-email`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {t("partners.invite.emailLabel")}
      </label>
      <input
        id={`${idPrefix}-email`}
        name="applicantEmail"
        type="email"
        required
        autoComplete="off"
        className={`${fieldClass} mb-4 ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      />

      <label
        htmlFor={`${idPrefix}-name`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {t("partners.invite.nameLabel")}
      </label>
      <input
        id={`${idPrefix}-name`}
        name="displayName"
        type="text"
        required
        maxLength={120}
        className={`${fieldClass} mb-4 ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      />

      <label
        htmlFor={`${idPrefix}-company`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {t("partners.invite.companyLabel")}
      </label>
      <input
        id={`${idPrefix}-company`}
        name="company"
        type="text"
        maxLength={200}
        className={`${fieldClass} mb-4 ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      />

      <label
        htmlFor={`${idPrefix}-code`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {t("partners.invite.codeLabel")}
      </label>
      <input
        id={`${idPrefix}-code`}
        name="code"
        type="text"
        required
        value={code}
        onChange={(event) => {
          setCode(event.target.value);
          setCopied(false);
        }}
        aria-describedby={`${idPrefix}-code-hint`}
        className={`${fieldClass} mb-1 ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      />
      <p
        id={`${idPrefix}-code-hint`}
        className="mb-4 text-[13px]"
        style={{ color: MUTED }}
      >
        {t("partners.invite.codeHint")}
      </p>

      <label
        htmlFor={`${idPrefix}-group`}
        className={labelClass}
        style={{ color: MUTED }}
      >
        {t("partners.invite.groupLabel")}
      </label>
      <select
        id={`${idPrefix}-group`}
        name="groupId"
        defaultValue=""
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

      {state.error && (
        <p
          role="alert"
          className="mb-3 text-[15px] font-semibold"
          style={{ color: "#B24343" }}
        >
          {state.error}
        </p>
      )}
      {state.success && !state.error && (
        <div role="status" aria-live="polite" className="mb-3 text-[15px]">
          <p className="font-semibold" style={{ color: "#1F8A5B" }}>
            {mode === "invite"
              ? t("partners.invite.savedInvite")
              : t("partners.invite.savedCreate")}
          </p>
          {mode === "invite" && code.length > 0 && (
            <div className="mt-2">
              <label
                htmlFor={`${idPrefix}-link`}
                className={labelClass}
                style={{ color: MUTED }}
              >
                {t("partners.invite.linkLabel")}
              </label>
              <input
                id={`${idPrefix}-link`}
                type="text"
                readOnly
                value={link}
                className={`${fieldClass} ${FOCUS_RING}`}
                style={{ borderColor: CARD_BORDER, color: INK }}
              />
              <button
                type="button"
                onClick={copyLink}
                className={`mt-2 min-h-[40px] rounded-[11px] border px-[14px] text-[15px] font-semibold ${FOCUS_RING}`}
                style={{ borderColor: CARD_BORDER, color: INK }}
              >
                {t("partners.invite.copy")}
              </button>
              {copied && (
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-1 text-[15px]"
                  style={{ color: "#1F8A5B" }}
                >
                  {t("partners.invite.copied")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`min-h-[44px] rounded-[11px] px-[18px] text-[15px] font-bold text-white disabled:opacity-50 ${FOCUS_RING}`}
        style={{ background: "#5663AE" }}
      >
        {pending
          ? tCommon("saving")
          : mode === "invite"
            ? t("partners.invite.submit")
            : t("partners.invite.submitCreate")}
      </button>
    </form>
  );
}
