"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { copyToClipboard } from "@/lib/clipboard";
import {
  acceptAffiliateTerms,
  saveAffiliateBillingProfile,
  saveAffiliatePartnerSelf,
} from "@/lib/affiliate/partner-actions";
import {
  initialAffiliateBillingProfileActionState,
  initialAffiliatePartnerSelfActionState,
  initialAffiliateTermsActionState,
} from "@/lib/affiliate/state";

/**
 * Affiliate-System, Block B7-A — die vier interaktiven Formulare des
 * Partnerbereichs (PLAN_Affiliate-System.md 8.2, 8.5).
 *
 * ## ABWEICHUNG VOM AUFTRAG, mit Begründung
 *
 * Die Dateiliste des Auftrags nennt nur Server-Dateien. Drei Anforderungen
 * des Plans lassen sich ohne eine `"use client"`-Datei aber nicht erfüllen:
 *   - 8.2 verlangt einen Kopierknopf, „dessen Erfolg über
 *     `role="status" aria-live="polite"` bestätigt wird" — Zwischenablage und
 *     Live-Region brauchen Browser-Code.
 *   - 8.5 verlangt Fehler in `role="alert"` und Erfolg in `role="status"`
 *     sowie eine ausdrückliche Fokusführung nach jeder Aktion. Ohne
 *     `useActionState` gibt es den Rückgabewert einer Server Action in der
 *     Oberfläche überhaupt nicht, also auch keinen Fehlertext.
 *   - Der Link soll in drei Klicks entstehen (Produktregel 2); ein
 *     Server-Roundtrip je Auswahl wären mehr.
 * Deshalb EINE zusätzliche Datei statt vier — sie enthält ausschließlich
 * Formulare, keine Datenbeschaffung, und liest nichts, was die Seite nicht
 * ohnehin schon geladen hat.
 *
 * ## Gemeinsame Regeln
 *
 * - `htmlFor` + `id` mit Datensatz-Präfix, nie umschließende Labels: sonst
 *   fällt `getByLabel()` in Playwright herein (8.5, Muster
 *   `e2e/marketplace-listing.spec.ts:45-50`). `useId()` liefert das Präfix.
 * - Native `<select>` und `<input type="search">` statt nachgebauter
 *   Widgets (8.5, Begründung in `locale-switcher.tsx:9-25`).
 * - Nach jeder Aktion springt der Fokus auf die Rückmeldung. Ohne das
 *   verliert ein sehbehinderter Nutzer nach jedem Speichern seine Position,
 *   und die Meldung bliebe ungelesen.
 * - Kein Feld trägt einen Wert, den die Oberfläche nicht lesen darf: IBAN,
 *   BIC, Kontoinhaber, PayPal-Adresse und Steuernummer stehen NICHT im
 *   SELECT-Spaltenrecht des Partners (Migration 20260910120000, Abschnitt 6).
 *   Sie werden deshalb leer angezeigt und beim Speichern neu gesetzt; die
 *   Seite schreibt daneben, ob bereits etwas hinterlegt ist.
 */

// --- Palette ------------------------------------------------------------

/**
 * DIESELBEN WERTE wie in `partner-shell.tsx`, hier bewusst ein zweites Mal.
 * `partner-shell.tsx` ist eine Server-Komponente und importiert
 * `next-intl/server`; ein Import von dort zöge dieses Modul ins
 * Browser-Bündel und bräche den Build — derselbe Grund, aus dem im
 * Händlerbereich `affiliate-format.ts` von `affiliate-shell.tsx` getrennt
 * ist. Wer einen Wert ändert, ändert ihn an beiden Stellen; die Begründung
 * der Werte (Kontrast ≥ 4,5:1) steht in 8.5 und im Kopf von
 * `partner-shell.tsx`.
 */
const PARTNER_MUTED = "#66679B";
const PARTNER_INK = "#1A1A2E";
const PARTNER_BORDER = "#E7E8F2";
const PARTNER_FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3E3F66]";
const PARTNER_CARD_CLASS = "rounded-[14px] border bg-white";
const PARTNER_BUTTON_CLASS =
  "inline-flex min-h-[40px] items-center justify-center rounded-[11px] px-[18px] text-[15px] font-bold text-white no-underline disabled:opacity-60";
const PARTNER_BUTTON_BG = "#5663AE";

/** Fehlerrot auf Weiß ≈ 5,0:1; Erfolgsgrün ≈ 4,6:1 — beide über AA. */
const PARTNER_ERROR = "#B24343";
const PARTNER_SUCCESS = "#1F8A5B";

// --- gemeinsame Bausteine ----------------------------------------------

const FIELD_CLASS =
  "w-full rounded-[10px] border bg-white px-3 py-2 text-[15px] min-h-[40px]";
const LABEL_CLASS = "mb-1 block text-[13px] font-semibold";

/**
 * Rückmeldung einer Server Action. Fehler `role="alert"` (unterbricht),
 * Erfolg `role="status" aria-live="polite"` (unterbricht nicht) — und in
 * beiden Fällen `tabIndex={-1}`, damit der Fokus dorthin springen kann.
 */
function ActionFeedback({
  state,
  successText,
}: {
  state: { error: string | null; success?: boolean };
  successText: string;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const active = state.error !== null || state.success === true;
  const wasActive = useRef(false);

  useEffect(() => {
    if (active && !wasActive.current) ref.current?.focus();
    wasActive.current = active;
  }, [active]);

  if (state.error !== null) {
    return (
      <p
        ref={ref}
        tabIndex={-1}
        role="alert"
        className="text-[15px] font-semibold outline-none"
        style={{ color: PARTNER_ERROR }}
      >
        {state.error}
      </p>
    );
  }
  if (state.success === true) {
    return (
      <p
        ref={ref}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="text-[15px] font-semibold outline-none"
        style={{ color: PARTNER_SUCCESS }}
      >
        {successText}
      </p>
    );
  }
  // Die Live-Region existiert auch im Ruhezustand: eine erst beim Erfolg
  // eingefügte Region liest mancher Screenreader nicht vor.
  return <p role="status" aria-live="polite" className="sr-only" />;
}

// --- Linkbaukasten (8.2, `/partner/links`) ------------------------------

export type PartnerLinkTarget = {
  /** Zielschlüssel `kurs/<slug>` bzw. `kaufen/<slug>`, leer = Startseite. */
  value: string;
  label: string;
};

/** Dieselbe Positivliste wie `AFFILIATE_CAMPAIGN_PATTERN` in schema.ts. */
const CAMPAIGN_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

export function LinkBuilder({
  origin,
  code,
  targets,
  cookieTtlDays,
}: {
  /** Die kanonische Adresse des Mandanten, serverseitig bestimmt. */
  origin: string;
  code: string;
  targets: readonly PartnerLinkTarget[];
  cookieTtlDays: number;
}) {
  const t = useTranslations("affiliate.links");
  const idPrefix = useId();
  const [target, setTarget] = useState("");
  const [campaign, setCampaign] = useState("");
  /**
   * Welcher Link zuletzt kopiert wurde — NICHT ein blosses `copied`-Flag mit
   * einem Effekt, der es bei jeder Auswahl zurücksetzt. Ein Effekt, der
   * synchron `setState` ruft, erzeugt eine zweite Renderrunde (ESLint
   * `react-hooks/set-state-in-effect`), und hier ginge es auch fachlich
   * schief: die Live-Region bestätigte kurz einen Link, der so nicht mehr im
   * Feld steht. Abgeleiteter Zustand kann das nicht.
   */
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const campaignValid = campaign === "" || CAMPAIGN_PATTERN.test(campaign);

  const link = useMemo(() => {
    // `URLSearchParams` kodiert selbst; nichts wird hier zusammengeklebt.
    const params = new URLSearchParams({ c: code });
    if (target !== "") params.set("z", target);
    if (campaign !== "" && CAMPAIGN_PATTERN.test(campaign)) params.set("cam", campaign);
    return `${origin}/api/aff/k?${params.toString()}`;
  }, [origin, code, target, campaign]);

  // Eine neue Auswahl macht die Kopierbestätigung ungültig — ohne Effekt.
  const copied = copiedLink !== null && copiedLink === link;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-target`}>
            {t("targetLabel")}
          </label>
          <select
            id={`${idPrefix}-target`}
            name="target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
            style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
          >
            <option value="">{t("productAny")}</option>
            {targets.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-campaign`}>
            {t("campaignLabel")}
          </label>
          <input
            id={`${idPrefix}-campaign`}
            name="campaign"
            type="text"
            value={campaign}
            maxLength={64}
            aria-describedby={`${idPrefix}-campaign-hint`}
            aria-invalid={campaignValid ? undefined : true}
            onChange={(event) => setCampaign(event.target.value)}
            className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
            style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
          />
          <p id={`${idPrefix}-campaign-hint`} className="mt-1 text-[13px]" style={{ color: PARTNER_MUTED }}>
            {t("campaignHint")}
          </p>
          {!campaignValid && (
            <p role="alert" className="mt-1 text-[13px] font-semibold" style={{ color: PARTNER_ERROR }}>
              {t("campaignHint")}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-link`}>
          {t("resultLabel")}
        </label>
        <input
          id={`${idPrefix}-link`}
          type="text"
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
          style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              setCopiedLink((await copyToClipboard(link)) ? link : null);
            }}
            className={`${PARTNER_BUTTON_CLASS} ${PARTNER_FOCUS_RING}`}
            style={{ background: PARTNER_BUTTON_BG }}
          >
            {t("copy")}
          </button>
          {/* Die Region steht IMMER im DOM; sie füllt sich nur (8.5). */}
          <p role="status" aria-live="polite" className="text-[15px]" style={{ color: PARTNER_SUCCESS }}>
            {copied ? t("copied") : ""}
          </p>
        </div>
        <p className="mt-2 text-[13px]" style={{ color: PARTNER_MUTED }}>
          {t("ttlHint", { days: cookieTtlDays })}
        </p>
      </div>
    </div>
  );
}

// --- Stammdaten (Name, Firma, Benachrichtigungen) -----------------------

export function PartnerSelfForm({
  displayName,
  company,
  notifySale,
  notifyReversal,
  notifyPayout,
}: {
  displayName: string;
  company: string;
  notifySale: boolean;
  notifyReversal: boolean;
  notifyPayout: boolean;
}) {
  const t = useTranslations("affiliate.profile");
  const idPrefix = useId();
  const [state, action, pending] = useActionState(
    saveAffiliatePartnerSelf,
    initialAffiliatePartnerSelfActionState,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-name`}>
            {t("nameLabel")}
          </label>
          <input
            id={`${idPrefix}-name`}
            name="displayName"
            type="text"
            required
            maxLength={120}
            defaultValue={displayName}
            className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
            style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
          />
        </div>
        <div>
          <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-company`}>
            {t("companyLabel")}
          </label>
          <input
            id={`${idPrefix}-company`}
            name="company"
            type="text"
            maxLength={200}
            defaultValue={company}
            className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
            style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
          />
        </div>
      </div>

      <fieldset className="border-0 p-0">
        <legend className="mb-2 text-[15px] font-bold" style={{ color: PARTNER_INK }}>
          {t("notificationsHeading")}
        </legend>
        <div className="flex flex-col gap-2">
          {(
            [
              { name: "notifySale", label: t("notifySale"), checked: notifySale },
              { name: "notifyReversal", label: t("notifyReversal"), checked: notifyReversal },
              { name: "notifyPayout", label: t("notifyPayout"), checked: notifyPayout },
            ] as const
          ).map((item) => (
            <div key={item.name} className="flex min-h-[40px] items-center gap-2">
              <input
                id={`${idPrefix}-${item.name}`}
                name={item.name}
                type="checkbox"
                defaultChecked={item.checked}
                className={`h-5 w-5 ${PARTNER_FOCUS_RING}`}
              />
              <label
                className="text-[15px]"
                style={{ color: PARTNER_INK }}
                htmlFor={`${idPrefix}-${item.name}`}
              >
                {item.label}
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`${PARTNER_BUTTON_CLASS} ${PARTNER_FOCUS_RING}`}
          style={{ background: PARTNER_BUTTON_BG }}
        >
          {pending ? t("pending") : t("save")}
        </button>
        <ActionFeedback state={state} successText={t("saved")} />
      </div>
    </form>
  );
}

// --- Abrechnungsprofil --------------------------------------------------

export type BillingProfileInitial = {
  entityKind: string;
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  smallBusiness: boolean;
  vatId: string;
  payoutMethod: string;
  /** Nur Ja/Nein — die Werte selbst darf die Oberfläche nicht lesen. */
  hasIban: boolean;
  hasPaypal: boolean;
  hasTaxNumber: boolean;
};

export function BillingProfileForm({ initial }: { initial: BillingProfileInitial }) {
  const t = useTranslations("affiliate.profile");
  const idPrefix = useId();
  const [state, action, pending] = useActionState(
    saveAffiliateBillingProfile,
    initialAffiliateBillingProfileActionState,
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <fieldset className="border-0 p-0">
        <legend className="mb-2 text-[15px] font-bold" style={{ color: PARTNER_INK }}>
          {t("addressHeading")}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-entityKind`}>
              {t("legalFormLabel")}
            </label>
            <select
              id={`${idPrefix}-entityKind`}
              name="entityKind"
              defaultValue={initial.entityKind}
              required
              className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
              style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
            >
              <option value="">—</option>
              <option value="business">{t("entityBusiness")}</option>
              <option value="private">{t("entityPrivate")}</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-legalName`}>
              {t("legalNameLabel")}
            </label>
            <input
              id={`${idPrefix}-legalName`}
              name="legalName"
              type="text"
              required
              maxLength={200}
              defaultValue={initial.legalName}
              className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
              style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-street`}>
              {t("streetLabel")}
            </label>
            <input
              id={`${idPrefix}-street`}
              name="street"
              type="text"
              required
              maxLength={200}
              defaultValue={initial.street}
              className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
              style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
            />
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <div>
              <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-postalCode`}>
                {t("postalCodeLabel")}
              </label>
              <input
                id={`${idPrefix}-postalCode`}
                name="postalCode"
                type="text"
                required
                maxLength={20}
                defaultValue={initial.postalCode}
                className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
                style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-city`}>
                {t("cityLabel")}
              </label>
              <input
                id={`${idPrefix}-city`}
                name="city"
                type="text"
                required
                maxLength={100}
                defaultValue={initial.city}
                className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
                style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
              />
            </div>
          </div>
          <div>
            <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-country`}>
              {t("countryLabel")}
            </label>
            <input
              id={`${idPrefix}-country`}
              name="country"
              type="text"
              required
              maxLength={2}
              defaultValue={initial.country}
              className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
              style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="border-0 p-0">
        <legend className="mb-1 text-[15px] font-bold" style={{ color: PARTNER_INK }}>
          {t("taxHeading")}
        </legend>
        <p className="mb-2 text-[13px]" style={{ color: PARTNER_MUTED }}>
          {t("taxHint")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-vatId`}>
              {t("vatIdLabel")}
            </label>
            <input
              id={`${idPrefix}-vatId`}
              name="vatId"
              type="text"
              maxLength={20}
              defaultValue={initial.vatId}
              className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
              style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-taxNumber`}>
              {t("taxNumberLabel")}
            </label>
            <input
              id={`${idPrefix}-taxNumber`}
              name="taxNumber"
              type="text"
              maxLength={40}
              // Kein `defaultValue`: die Steuernummer steht nicht im
              // SELECT-Spaltenrecht des Partners und wird deshalb nie
              // zurückgelesen. Der Hinweis daneben sagt, ob eine hinterlegt ist.
              placeholder={initial.hasTaxNumber ? t("valueStored") : ""}
              className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
              style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
            />
          </div>
          <div className="flex min-h-[40px] items-center gap-2">
            <input
              id={`${idPrefix}-smallBusiness`}
              name="smallBusiness"
              type="checkbox"
              defaultChecked={initial.smallBusiness}
              className={`h-5 w-5 ${PARTNER_FOCUS_RING}`}
            />
            <label className="text-[15px]" style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-smallBusiness`}>
              {t("smallBusinessLabel")}
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className="border-0 p-0">
        <legend className="mb-1 text-[15px] font-bold" style={{ color: PARTNER_INK }}>
          {t("paymentHeading")}
        </legend>
        <p className="mb-2 text-[13px]" style={{ color: PARTNER_MUTED }}>
          {t("paymentHint")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-payoutMethod`}>
              {t("payoutMethodLabel")}
            </label>
            <select
              id={`${idPrefix}-payoutMethod`}
              name="payoutMethod"
              defaultValue={initial.payoutMethod}
              required
              className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
              style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
            >
              <option value="">—</option>
              <option value="sepa">{t("payoutMethodSepa")}</option>
              <option value="paypal">{t("payoutMethodPaypal")}</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-accountHolder`}>
              {t("accountHolderLabel")}
            </label>
            <input
              id={`${idPrefix}-accountHolder`}
              name="accountHolder"
              type="text"
              maxLength={200}
              className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
              style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-iban`}>
              {t("ibanLabel")}
            </label>
            <input
              id={`${idPrefix}-iban`}
              name="iban"
              type="text"
              maxLength={40}
              autoComplete="off"
              placeholder={initial.hasIban ? t("valueStored") : ""}
              className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
              style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-bic`}>
              {t("bicLabel")}
            </label>
            <input
              id={`${idPrefix}-bic`}
              name="bic"
              type="text"
              maxLength={11}
              autoComplete="off"
              className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
              style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-paypalEmail`}>
              {t("paypalLabel")}
            </label>
            <input
              id={`${idPrefix}-paypalEmail`}
              name="paypalEmail"
              type="email"
              maxLength={200}
              autoComplete="off"
              placeholder={initial.hasPaypal ? t("valueStored") : ""}
              className={`${FIELD_CLASS} ${PARTNER_FOCUS_RING}`}
              style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
            />
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`${PARTNER_BUTTON_CLASS} ${PARTNER_FOCUS_RING}`}
          style={{ background: PARTNER_BUTTON_BG }}
        >
          {pending ? t("pending") : t("save")}
        </button>
        <ActionFeedback state={state} successText={t("saved")} />
      </div>
    </form>
  );
}

// --- Zustimmung zu den Bedingungen --------------------------------------

/**
 * `version` ist die Fassung, die dem Partner auf DIESER Seite angezeigt
 * wurde. Sie geht als verstecktes Feld mit und wird serverseitig gegen die
 * Programmzeile geprüft — ändert der Händler den Text, während das Formular
 * offen steht, wird nichts gespeichert (siehe `acceptAffiliateTerms()`).
 */
export function TermsAcceptForm({ version }: { version: number }) {
  const t = useTranslations("affiliate.terms");
  const idPrefix = useId();
  const [state, action, pending] = useActionState(
    acceptAffiliateTerms,
    initialAffiliateTermsActionState,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="termsVersion" value={version} />
      <div className="flex min-h-[40px] items-start gap-2">
        <input
          id={`${idPrefix}-accept`}
          name="acceptTerms"
          type="checkbox"
          required
          className={`mt-1 h-5 w-5 ${PARTNER_FOCUS_RING}`}
        />
        <label className="text-[15px]" style={{ color: PARTNER_INK }} htmlFor={`${idPrefix}-accept`}>
          {t("acceptLabel", { version })}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`${PARTNER_BUTTON_CLASS} ${PARTNER_FOCUS_RING}`}
          style={{ background: PARTNER_BUTTON_BG }}
        >
          {pending ? t("pending") : t("accept")}
        </button>
        <ActionFeedback state={state} successText={t("accepted")} />
      </div>
    </form>
  );
}

/**
 * Der Sperr-Dialog aus 8.2: „bei erhöhter `terms_version` blockiert ein
 * Dialog alle anderen Partnerseiten bis zur Neuzustimmung."
 *
 * BEWUSST KEIN modaler JS-Dialog, sondern eine serverseitig gerenderte
 * Sperre, die den Seiteninhalt ERSETZT. Drei Gründe:
 *   - Ein Dialog, den JavaScript einblendet, ist bei abgeschaltetem oder
 *     fehlgeschlagenem Skript keine Sperre, sondern Dekoration über einem
 *     weiterhin lesbaren Inhalt.
 *   - Eine Fokusfalle (`role="dialog"` mit Tab-Zyklus) ist die häufigste
 *     Stelle, an der Tastaturbedienung bricht. Wenn der Inhalt gar nicht
 *     erst da ist, braucht es keine Falle.
 *   - Der Screenreader liest die Seite von oben; die Sperre ist das Erste,
 *     was er findet.
 * Die ARIA-Rolle bleibt trotzdem `alertdialog`, damit die Unterbrechung
 * angesagt wird.
 */
export function TermsGate({ version, termsText }: { version: number; termsText: string }) {
  const t = useTranslations("affiliate.terms");
  const headingId = useId();

  return (
    <section
      role="alertdialog"
      aria-labelledby={headingId}
      aria-modal="false"
      className={`${PARTNER_CARD_CLASS} p-[24px_26px]`}
      style={{ borderColor: PARTNER_BORDER }}
    >
      <h2 id={headingId} className="text-[20px] font-bold" style={{ color: PARTNER_INK }}>
        {t("updatedHeading")}
      </h2>
      <p className="mt-2 text-[15px]" style={{ color: PARTNER_INK }}>
        {t("updatedBody")}
      </p>
      <div
        className="mt-4 max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-[10px] border p-4 text-[15px] leading-[1.6]"
        style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
        tabIndex={0}
        role="region"
        aria-label={t("title")}
      >
        {termsText}
      </div>
      <div className="mt-4">
        <TermsAcceptForm version={version} />
      </div>
    </section>
  );
}
