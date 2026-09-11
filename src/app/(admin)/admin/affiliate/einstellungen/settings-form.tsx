"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { saveAffiliateProgramSettings } from "@/lib/affiliate/actions";
import { initialAffiliateProgramActionState } from "@/lib/affiliate/state";
import { centsToEuroInput } from "@/lib/affiliate/schema";
import {
  AFFILIATE_APPROVAL_MODES,
  AFFILIATE_ATTRIBUTION_MODELS,
  AFFILIATE_BASIS_KINDS,
  AFFILIATE_OVERWRITE_POLICIES,
  AFFILIATE_PAYOUT_SCHEDULES,
  AFFILIATE_PROGRAM_STATUSES,
  AFFILIATE_PROGRAM_VISIBILITIES,
  AFFILIATE_RATE_KINDS,
  AFFILIATE_RECURRING_MODES,
  AFFILIATE_SELF_REFERRAL_MODES,
  AFFILIATE_TIER2_BASES,
  type AffiliateApplicationField,
} from "@/lib/affiliate/types";

import { useStatusFocus } from "../use-status-focus";
import {
  CARD_BORDER,
  CARD_CLASS,
  FOCUS_RING,
  INK,
  MUTED,
} from "../affiliate-format";

/**
 * Affiliate-System, Block B6-B — `/admin/affiliate/einstellungen`, das
 * Formular (PLAN_Affiliate-System.md 8.1 Zeile 7 und der Absatz darunter;
 * 3.2; 8.5).
 *
 * Zweck laut Plan: „das Programm konfigurieren, ohne sich selbst zu
 * schaden." Daher die vier ausdrücklich geforderten, NICHT blockierenden
 * Warnungen, die schon beim Tippen erscheinen:
 *   - Sperrfrist unter 14 Tagen (kürzer als die Widerrufsfrist),
 *   - Satz über 50 %,
 *   - erste und zweite Stufe zusammen über 60 %,
 *   - Änderung an Bemessungsgrundlage oder Satz (gilt nur für künftige
 *     Buchungen),
 * dazu der Hinweis bei „alle Raten" (unbefristete Verbindlichkeit).
 * Sie warnen und verhindern nichts — die Entscheidung gehört dem Händler,
 * die Information ihm auch.
 *
 * EINHEITEN: die Datenbank speichert Basispunkte und Cent (3.2). Die Felder
 * heißen und messen deshalb genauso, und daneben steht laufend der Wert in
 * Prozent bzw. Euro. Eine stille Umrechnung im Browser wäre ein zweiter
 * Rechenweg für genau die Zahlen, aus denen später Geld wird.
 *
 * ZWEI FELDER FEHLEN HIER MIT ABSICHT und beide sind im Schema begründet:
 * `terms_version` (steigt serverseitig, wenn sich der Text ändert — sonst
 * ließen sich die Bedingungen ohne neue Zustimmung ändern) und
 * `books_closed_until` (G14).
 */

const fieldClass =
  "w-full min-h-[40px] rounded-[10px] border px-[13px] py-[11px] text-[15px]";
const labelClass = "mb-1.5 block text-[13px] font-semibold";
const sectionClass = "flex flex-col gap-4";

export type AffiliateSettingsValues = {
  status: string;
  visibility: string;
  approvalMode: string;
  rateKind: string;
  rateBp: number;
  fixedCents: number;
  minCommissionCents: number | null;
  maxCommissionCents: number | null;
  basisKind: string;
  feeDeductionBp: number;
  currency: string;
  attributionModel: string;
  cookieTtlDays: number;
  overwritePolicy: string;
  lifetimeBinding: boolean;
  selfReferral: string;
  referrerBlocklist: string[];
  recurringMode: string;
  recurringMaxPeriods: number;
  tier2Enabled: boolean;
  tier2Basis: string;
  tier2RateBp: number;
  holdDays: number;
  reserveBp: number;
  reserveDays: number;
  minPayoutCents: number;
  payoutSchedule: string;
  descriptionMd: string;
  termsText: string;
  termsVersion: number;
  applicationNote: string;
  applicationFields: AffiliateApplicationField[];
  testMode: boolean;
};

export function AffiliateSettingsForm({
  values,
}: {
  values: AffiliateSettingsValues;
}) {
  const t = useTranslations("admin.affiliate");
  const tCommon = useTranslations("admin.common");
  const [state, formAction, pending] = useActionState(
    saveAffiliateProgramSettings,
    initialAffiliateProgramActionState,
  );
  const statusRef = useStatusFocus(
    Boolean(state.success) || Boolean(state.error),
  );
  const idPrefix = useId();

  // Nur die Werte, an denen eine Warnung hängt, stehen im Zustand.
  const [rateBp, setRateBp] = useState(String(values.rateBp));
  const [tier2RateBp, setTier2RateBp] = useState(String(values.tier2RateBp));
  const [holdDays, setHoldDays] = useState(String(values.holdDays));
  const [basisKind, setBasisKind] = useState(values.basisKind);
  const [recurringMode, setRecurringMode] = useState(values.recurringMode);

  const rateBpNumber = Number.parseInt(rateBp, 10);
  const tier2BpNumber = Number.parseInt(tier2RateBp, 10);
  const holdDaysNumber = Number.parseInt(holdDays, 10);

  const warnings: string[] = [];
  if (Number.isFinite(holdDaysNumber) && holdDaysNumber < 14)
    warnings.push(t("settings.warnings.holdDays"));
  if (Number.isFinite(rateBpNumber) && rateBpNumber > 5000)
    warnings.push(t("settings.warnings.highRate"));
  if (
    Number.isFinite(rateBpNumber) &&
    Number.isFinite(tier2BpNumber) &&
    rateBpNumber + tier2BpNumber > 6000
  ) {
    warnings.push(t("settings.warnings.combinedRate"));
  }
  // „Gilt nur für künftige Buchungen": erscheint, sobald einer der beiden
  // Werte vom gespeicherten Stand abweicht — also genau dann, wenn die
  // Änderung ansteht, und nicht erst, wenn sie passiert ist.
  if (basisKind !== values.basisKind || rateBpNumber !== values.rateBp) {
    warnings.push(t("settings.warnings.basisChange"));
  }
  if (recurringMode === "all")
    warnings.push(t("settings.warnings.recurringAll"));

  const percentOf = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? (parsed / 100).toFixed(2) : "—";
  };

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* Warnungen zuerst und nicht am Ende: sie sind die Antwort auf das,
          was gleich gespeichert wird. `role="status"`, weil sie sich beim
          Tippen ändern und `role="alert"` dann dauernd unterbräche. */}
      {warnings.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-[14px] border p-[16px_20px] text-[15px]"
          style={{
            borderColor: "#E7C98F",
            background: "#FBF1DC",
            color: "#6B5312",
          }}
        >
          <h2 className="text-[15px] font-bold">
            {t("settings.warnings.heading")}
          </h2>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 1. Grunddaten und Sichtbarkeit. */}
      <Section title={t("settings.basics.heading")}>
        <Select
          id={`${idPrefix}-status`}
          name="status"
          label={t("settings.basics.statusLabel")}
          defaultValue={values.status}
          options={AFFILIATE_PROGRAM_STATUSES.map((value) => ({
            value,
            label: t(`status.program.${value}`),
          }))}
        />
        <Select
          id={`${idPrefix}-visibility`}
          name="visibility"
          label={t("settings.basics.visibilityLabel")}
          defaultValue={values.visibility}
          options={AFFILIATE_PROGRAM_VISIBILITIES.map((value) => ({
            value,
            label: t(`settings.visibility.${value}`),
          }))}
        />
        <Select
          id={`${idPrefix}-approval`}
          name="approvalMode"
          label={t("settings.basics.approvalLabel")}
          defaultValue={values.approvalMode}
          options={AFFILIATE_APPROVAL_MODES.map((value) => ({
            value,
            label:
              value === "manual"
                ? t("settings.basics.approvalManual")
                : t("settings.basics.approvalAuto"),
          }))}
        />
      </Section>

      {/* 2. Standardkondition und Provisionsbasis. */}
      <Section title={t("settings.commission.heading")}>
        <Select
          id={`${idPrefix}-ratekind`}
          name="rateKind"
          label={t("settings.commission.rateKindLabel")}
          defaultValue={values.rateKind}
          options={AFFILIATE_RATE_KINDS.map((value) => ({
            value,
            label:
              value === "percent"
                ? t("settings.commission.ratePercent")
                : t("settings.commission.rateFixed"),
          }))}
        />
        <NumberField
          id={`${idPrefix}-ratebp`}
          name="rateBp"
          label={t("settings.commission.rateBpLabel")}
          hint={t("settings.commission.rateBpHint", {
            percent: percentOf(rateBp),
          })}
          value={rateBp}
          onChange={setRateBp}
          min={0}
          max={10000}
        />
        <NumberField
          id={`${idPrefix}-fixed`}
          name="fixedCents"
          label={t("settings.commission.fixedCentsLabel")}
          hint={t("settings.commission.centsHint", {
            euro: centsToEuroInput(values.fixedCents),
          })}
          defaultValue={String(values.fixedCents)}
          min={0}
        />
        <NumberField
          id={`${idPrefix}-min`}
          name="minCommissionCents"
          label={t("settings.commission.minCentsLabel")}
          hint={t("settings.commission.optionalCentsHint")}
          defaultValue={
            values.minCommissionCents === null
              ? ""
              : String(values.minCommissionCents)
          }
          min={0}
          required={false}
        />
        <NumberField
          id={`${idPrefix}-max`}
          name="maxCommissionCents"
          label={t("settings.commission.maxCentsLabel")}
          hint={t("settings.commission.optionalCentsHint")}
          defaultValue={
            values.maxCommissionCents === null
              ? ""
              : String(values.maxCommissionCents)
          }
          min={0}
          required={false}
        />
        <Select
          id={`${idPrefix}-basis`}
          name="basisKind"
          label={t("settings.commission.basisLabel")}
          value={basisKind}
          onChange={setBasisKind}
          options={AFFILIATE_BASIS_KINDS.map((value) => ({
            value,
            label:
              value === "net"
                ? t("settings.commission.basisNet")
                : t("settings.commission.basisGross"),
          }))}
        />
        <NumberField
          id={`${idPrefix}-fee`}
          name="feeDeductionBp"
          label={t("settings.commission.feeDeductionBpLabel")}
          hint={t("settings.commission.feeDeductionBpHint")}
          defaultValue={String(values.feeDeductionBp)}
          min={0}
          max={10000}
        />
        <TextField
          id={`${idPrefix}-currency`}
          name="currency"
          label={t("settings.commission.currencyLabel")}
          hint={t("settings.commission.currencyHint")}
          defaultValue={values.currency}
          maxLength={3}
        />
      </Section>

      {/* 3. Attribution. */}
      <Section title={t("settings.attribution.heading")}>
        <Select
          id={`${idPrefix}-model`}
          name="attributionModel"
          label={t("settings.attribution.modelLabel")}
          defaultValue={values.attributionModel}
          options={AFFILIATE_ATTRIBUTION_MODELS.map((value) => ({
            value,
            label:
              value === "last"
                ? t("settings.attribution.modelLast")
                : t("settings.attribution.modelFirst"),
          }))}
        />
        <NumberField
          id={`${idPrefix}-cookie`}
          name="cookieTtlDays"
          label={t("settings.attribution.cookieTtlLabel")}
          defaultValue={String(values.cookieTtlDays)}
          min={1}
          max={365}
        />
        <Select
          id={`${idPrefix}-overwrite`}
          name="overwritePolicy"
          label={t("settings.attribution.overwriteLabel")}
          defaultValue={values.overwritePolicy}
          options={AFFILIATE_OVERWRITE_POLICIES.map((value) => ({
            value,
            label:
              value === "allow"
                ? t("settings.attribution.overwriteAllow")
                : t("settings.attribution.overwriteDeny"),
          }))}
        />
        <Checkbox
          id={`${idPrefix}-lifetime`}
          name="lifetimeBinding"
          label={t("settings.attribution.lifetimeLabel")}
          defaultChecked={values.lifetimeBinding}
        />
        <Select
          id={`${idPrefix}-selfref`}
          name="selfReferral"
          label={t("settings.attribution.selfReferralLabel")}
          defaultValue={values.selfReferral}
          options={AFFILIATE_SELF_REFERRAL_MODES.map((value) => ({
            value,
            label:
              value === "block"
                ? t("settings.attribution.selfReferralBlock")
                : t("settings.attribution.selfReferralFlag"),
          }))}
        />
        <div>
          <label
            htmlFor={`${idPrefix}-blocklist`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("settings.attribution.blocklistLabel")}
          </label>
          <textarea
            id={`${idPrefix}-blocklist`}
            name="referrerBlocklist"
            rows={4}
            defaultValue={values.referrerBlocklist.join("\n")}
            aria-describedby={`${idPrefix}-blocklist-hint`}
            className={`${fieldClass} resize-y ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
          <p
            id={`${idPrefix}-blocklist-hint`}
            className="mt-1 text-[13px]"
            style={{ color: MUTED }}
          >
            {t("settings.attribution.blocklistHint")}
          </p>
        </div>
      </Section>

      {/* 4. Abo-Verhalten. */}
      <Section title={t("settings.recurring.heading")}>
        <Select
          id={`${idPrefix}-recurring`}
          name="recurringMode"
          label={t("settings.recurring.modeLabel")}
          value={recurringMode}
          onChange={setRecurringMode}
          options={AFFILIATE_RECURRING_MODES.map((value) => ({
            value,
            label:
              value === "first_only"
                ? t("settings.recurring.modeFirstOnly")
                : value === "n_periods"
                  ? t("settings.recurring.modeNPeriods")
                  : t("settings.recurring.modeAll"),
          }))}
        />
        <NumberField
          id={`${idPrefix}-periods`}
          name="recurringMaxPeriods"
          label={t("settings.recurring.maxPeriodsLabel")}
          defaultValue={String(values.recurringMaxPeriods)}
          min={1}
          max={120}
        />
      </Section>

      {/* 5. Zweite Stufe. */}
      <Section title={t("settings.tier2.heading")}>
        <Checkbox
          id={`${idPrefix}-tier2`}
          name="tier2Enabled"
          label={t("settings.tier2.enabledLabel")}
          defaultChecked={values.tier2Enabled}
        />
        <Select
          id={`${idPrefix}-tier2basis`}
          name="tier2Basis"
          label={t("settings.tier2.basisLabel")}
          defaultValue={values.tier2Basis}
          options={AFFILIATE_TIER2_BASES.map((value) => ({
            value,
            label:
              value === "commission"
                ? t("settings.tier2.basisCommission")
                : t("settings.tier2.basisRevenue"),
          }))}
        />
        <NumberField
          id={`${idPrefix}-tier2rate`}
          name="tier2RateBp"
          label={t("settings.tier2.rateBpLabel")}
          hint={t("settings.commission.rateBpHint", {
            percent: percentOf(tier2RateBp),
          })}
          value={tier2RateBp}
          onChange={setTier2RateBp}
          min={0}
          max={10000}
        />
      </Section>

      {/* 6. Geld und Fristen. */}
      <Section title={t("settings.money.heading")}>
        <NumberField
          id={`${idPrefix}-hold`}
          name="holdDays"
          label={t("settings.money.holdDaysLabel")}
          value={holdDays}
          onChange={setHoldDays}
          min={0}
          max={365}
        />
        <NumberField
          id={`${idPrefix}-reserve`}
          name="reserveBp"
          label={t("settings.money.reserveBpLabel")}
          hint={t("settings.money.reserveBpHint")}
          defaultValue={String(values.reserveBp)}
          min={0}
          max={10000}
        />
        <NumberField
          id={`${idPrefix}-reservedays`}
          name="reserveDays"
          label={t("settings.money.reserveDaysLabel")}
          hint={t("settings.money.reserveDaysHint")}
          defaultValue={String(values.reserveDays)}
          min={0}
          max={365}
        />
        <NumberField
          id={`${idPrefix}-minpayout`}
          name="minPayoutCents"
          label={t("settings.money.minPayoutCentsLabel")}
          hint={t("settings.commission.centsHint", {
            euro: centsToEuroInput(values.minPayoutCents),
          })}
          defaultValue={String(values.minPayoutCents)}
          min={0}
        />
        <Select
          id={`${idPrefix}-schedule`}
          name="payoutSchedule"
          label={t("settings.money.scheduleLabel")}
          defaultValue={values.payoutSchedule}
          options={AFFILIATE_PAYOUT_SCHEDULES.map((value) => ({
            value,
            label:
              value === "weekly"
                ? t("settings.money.scheduleWeekly")
                : value === "semi_monthly"
                  ? t("settings.money.scheduleSemiMonthly")
                  : t("settings.money.scheduleMonthly"),
          }))}
        />
      </Section>

      {/* 7. Texte. */}
      <Section title={t("settings.texts.heading")}>
        <div>
          <label
            htmlFor={`${idPrefix}-description`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("settings.texts.descriptionLabel")}
          </label>
          <textarea
            id={`${idPrefix}-description`}
            name="descriptionMd"
            rows={6}
            maxLength={20000}
            defaultValue={values.descriptionMd}
            className={`${fieldClass} resize-y ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-terms`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("settings.texts.termsLabel")}
          </label>
          <textarea
            id={`${idPrefix}-terms`}
            name="termsText"
            rows={8}
            maxLength={50000}
            defaultValue={values.termsText}
            aria-describedby={`${idPrefix}-terms-hint`}
            className={`${fieldClass} resize-y ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
          <p
            id={`${idPrefix}-terms-hint`}
            className="mt-1 text-[13px]"
            style={{ color: MUTED }}
          >
            {t("settings.texts.termsVersionLabel")}: {values.termsVersion} —{" "}
            {t("settings.texts.termsVersionHint")}
          </p>
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-appnote`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("settings.texts.applicationNoteLabel")}
          </label>
          <textarea
            id={`${idPrefix}-appnote`}
            name="applicationNote"
            rows={3}
            maxLength={2000}
            defaultValue={values.applicationNote}
            className={`${fieldClass} resize-y ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
        </div>
        {/*
          ZUSÄTZLICHE BEWERBUNGSFELDER: hier nur ANZEIGE, kein Eingabefeld.
          `saveAffiliateProgramSettings()` reicht `applicationFields` als
          einzelnen Formularwert an ein Array-Schema weiter — ein Textfeld
          (auch mit JSON) scheiterte dort an der Typprüfung und machte jedes
          Speichern unmöglich. Das Bearbeiten dieser Felder gehört deshalb zu
          dem Arbeitsschritt, der die Action anfasst (B7, öffentliches
          Bewerbungsformular); bis dahin steht hier, was gespeichert ist.
        */}
        <div>
          <p className={labelClass} style={{ color: MUTED }}>
            {t("settings.texts.applicationFieldsLabel")}
          </p>
          {values.applicationFields.length === 0 ? (
            <p className="text-[15px]" style={{ color: MUTED }}>
              {t("settings.texts.applicationFieldsEmpty")}
            </p>
          ) : (
            <ul
              className="flex list-disc flex-col gap-1 pl-5 text-[15px]"
              style={{ color: INK }}
            >
              {values.applicationFields.map((field) => (
                <li key={field.key}>
                  {field.label} ({field.key})
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[13px]" style={{ color: MUTED }}>
            {t("settings.texts.applicationFieldsReadonly")}
          </p>
        </div>
      </Section>

      {/* 8. Testmodus. */}
      <Section title={t("settings.test.heading")}>
        <Checkbox
          id={`${idPrefix}-test`}
          name="testMode"
          label={t("settings.test.label")}
          defaultChecked={values.testMode}
          hint={t("settings.test.hint")}
        />
      </Section>

      {state.error && (
        <p
          ref={statusRef}
          tabIndex={-1}
          role="alert"
          className="text-[15px] font-semibold outline-none"
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
          className="text-[15px] font-semibold outline-none"
          style={{ color: "#1F8A5B" }}
        >
          {t("settings.saved")}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`min-h-[44px] self-start rounded-[11px] px-[18px] text-[15px] font-bold text-white disabled:opacity-50 ${FOCUS_RING}`}
        style={{ background: "#5663AE" }}
      >
        {pending ? tCommon("saving") : t("settings.save")}
      </button>
    </form>
  );
}

/** Ein Abschnitt mit eigener Überschrift — jede Gruppe ist im Baum auffindbar. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`${CARD_CLASS} p-[22px_24px]`}
      style={{ borderColor: CARD_BORDER }}
    >
      <h2 className="mb-4 text-[17px] font-bold" style={{ color: INK }}>
        {title}
      </h2>
      <div className={sectionClass}>{children}</div>
    </section>
  );
}

function Select({
  id,
  name,
  label,
  options,
  defaultValue,
  value,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass} style={{ color: MUTED }}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        {...(value === undefined
          ? { defaultValue }
          : { value, onChange: (e) => onChange?.(e.target.value) })}
        className={`${fieldClass} bg-white ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField({
  id,
  name,
  label,
  hint,
  defaultValue,
  value,
  onChange,
  min,
  max,
  required = true,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  min?: number;
  max?: number;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass} style={{ color: MUTED }}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="number"
        step={1}
        min={min}
        max={max}
        required={required}
        {...(value === undefined
          ? { defaultValue }
          : { value, onChange: (e) => onChange?.(e.target.value) })}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`${fieldClass} ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      />
      {hint && (
        <p
          id={`${id}-hint`}
          className="mt-1 text-[13px]"
          style={{ color: MUTED }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

function TextField({
  id,
  name,
  label,
  hint,
  defaultValue,
  maxLength,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  defaultValue: string;
  maxLength?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass} style={{ color: MUTED }}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        required
        maxLength={maxLength}
        defaultValue={defaultValue}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`${fieldClass} ${FOCUS_RING}`}
        style={{ borderColor: CARD_BORDER, color: INK }}
      />
      {hint && (
        <p
          id={`${id}-hint`}
          className="mt-1 text-[13px]"
          style={{ color: MUTED }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

function Checkbox({
  id,
  name,
  label,
  hint,
  defaultChecked,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  defaultChecked: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="flex min-h-[40px] items-center gap-2 text-[15px]"
        style={{ color: INK }}
      >
        <input
          id={id}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={FOCUS_RING}
        />
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-[13px]" style={{ color: MUTED }}>
          {hint}
        </p>
      )}
    </div>
  );
}
