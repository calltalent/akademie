"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { AffiliatePayoutActionState } from "@/lib/affiliate/state";
import { initialAffiliatePayoutActionState } from "@/lib/affiliate/state";
import type { AffiliatePayoutMethod } from "@/lib/affiliate/types";

import { useStatusFocus } from "../use-status-focus";
import {
  CARD_BORDER,
  CARD_CLASS,
  FOCUS_RING,
  HAIRLINE,
  INK,
  MUTED,
  NAVY,
  SUCCESS,
  centsToAmount,
  currencyCode,
} from "../affiliate-format";

/**
 * Affiliate-System, Block B8-C — die Bedienteile der Auszahlungsseite
 * (PLAN_Affiliate-System.md 7.1, 7.2, 7.7, 8.1 Zeile 6, 8.5, 11.17).
 *
 * ## DIE FREIGABE IST DER PUNKT, AN DEM GELD DAS HAUS VERLÄSST
 *
 * Deshalb ist sie hier KEIN einzelner Knopf, sondern zwei Schritte mit einer
 * ausgeschriebenen Zahl dazwischen: „Sie zahlen 1.247,80 € an 6 Partner aus."
 * — Betrag und Empfängerzahl im Klartext, je Währung getrennt (5.11), bevor
 * irgendetwas abgeschickt wird.
 *
 * Bewusst KEIN `window.confirm()`. Der native Dialog ist für einen
 * Screenreader eine Unterbrechung ohne Struktur, sein Text lässt sich nicht
 * formatieren und nicht übersetzen, und sein Inhalt ist nicht wieder
 * auffindbar, sobald er weg ist. Stattdessen erscheint eine Bestätigungskarte
 * im Dokument, sie bekommt den Fokus (`useStatusFocus`), trägt
 * `role="group"` mit eigener Überschrift und hat zwei echte Knöpfe.
 *
 * Die ANGEZEIGTE Summe wird zusätzlich als verstecktes Feld mitgeschickt
 * (`expected`, je Währung ein Eintrag). Die Server Action rechnet sie gegen
 * die Sätze nach, die sie tatsächlich freigeben würde, und bricht bei
 * Abweichung ab. Damit ist ausgeschlossen, dass zwischen Anzeige und Klick
 * ein zweiter Lauf die Beträge verändert hat und der Mensch etwas anderes
 * freigibt, als er gelesen hat — dieselbe Zweitbestätigung wie bei der
 * Handbuchung über 500 € (11.17), nur über die Summe statt über einen Betrag.
 *
 * ## BARRIEREFREIHEIT (8.5), an dieser Stelle gebündelt
 *
 * - Jede Kennzahl steht als TEXT. Es gibt in dieser Datei keine Grafik, keinen
 *   Balken und keine Ampel, deren Farbe eine Information trägt: der
 *   Vollständigkeitszustand steht ausgeschrieben („Unvollständig. Es fehlt:
 *   IBAN"), der Status trägt seinen Namen, die Farbe wiederholt ihn nur.
 * - Kontraste, jeder Wert NACHGERECHNET (WCAG 2.1, relative Luminanz), nicht
 *   geschätzt:
 *     #1A1A2E auf #FFFFFF = 17,06:1   (Werte, Beträge, Überschriften)
 *     #66679B auf #FFFFFF =  5,28:1   (Sekundärtext, Beschriftungen)
 *     #B24343 auf #FFFFFF =  5,56:1   (Fehlermeldung, fehlende Angabe)
 *     #166B47 auf #FFFFFF =  6,51:1   (Erfolgsmeldung)
 *     #FFFFFF auf #3E3F66 =  9,96:1   (Hauptknopf)
 *     #FFFFFF auf #5663AE =  5,54:1   (Freigabeknopf)
 *   Die Statuschips unten tragen ihre gemessenen Werte einzeln.
 * - Jede `rgrid`-Zelle mit einer bloßen Zahl oder einem bloßen Datum trägt ein
 *   `rgrid-label`; unter 1024 px stapelt die Zeile zur Karte und dieses Label
 *   ist dann die einzige Spaltenbeschriftung.
 * - Auswahlkästchen tragen ein `aria-label`, das Partner UND Betrag nennt —
 *   „Auszahlung an Maria Berg über 412,90 € auswählen". Ein nacktes
 *   „Auswählen" wäre in einer Liste aus 30 Kästchen wertlos.
 * - Klickziele mindestens 40 × 40 px, sichtbarer Fokusring an jedem
 *   Bedienelement, nie `outline-none` ohne Ersatz.
 */

// --- Spaltenraster ------------------------------------------------------

/**
 * Acht Spalten. Das Auswahlkästchen bekommt bewusst KEINE neunte: es steht in
 * der Partnerzelle, damit die gestapelte Kartenansicht unter 1024 px nicht mit
 * einer beschriftungslosen Zelle beginnt.
 */
export const PAYOUT_COLS =
  "1.4fr 1.1fr 0.9fr 1fr 1fr 1.1fr 0.9fr 1.1fr";

// --- Statusfarben -------------------------------------------------------

/**
 * Jede Fläche trägt in der Oberfläche ZUSÄTZLICH den ausgeschriebenen
 * Statustext; die Farbe ist Wiederholung, nie die Information selbst (8.5).
 *
 * Die Chips sind 13 px und fett, zählen also als Normaltext (Large Text
 * beginnt erst bei 18,66 px fett) — Schwelle 4,5:1, nicht 3:1. Jeder Wert
 * einzeln nachgerechnet, dieselben geprüften Paare wie in `affiliate-format.ts`:
 *
 *   #66679B auf #EEF0F7 = 4,64:1
 *   #7D6119 auf #FBF1DC = 5,21:1
 *   #3E3F66 auf #E7E8F2 = 8,17:1
 *   #156F45 auf #E3F2EA = 5,35:1
 *   #B24343 auf #FBEAEA = 4,78:1
 */
const PAYOUT_STATUS_STYLE: Record<
  PayoutStatus,
  { color: string; background: string }
> = {
  draft: { color: "#66679B", background: "#EEF0F7" },
  approved: { color: "#7D6119", background: "#FBF1DC" },
  exported: { color: "#3E3F66", background: "#E7E8F2" },
  paid: { color: "#156F45", background: "#E3F2EA" },
  failed: { color: "#B24343", background: "#FBEAEA" },
  cancelled: { color: "#B24343", background: "#FBEAEA" },
};

const DANGER = "#B24343";

const fieldClass =
  "w-full min-h-[40px] rounded-[10px] border bg-white px-[13px] py-[11px] text-[15px]";
const labelClass = "mb-1.5 block text-[13px] font-semibold";
const buttonClass =
  "inline-flex min-h-[40px] items-center justify-center rounded-[11px] px-[18px] text-[15px] font-bold";

// --- Datenformen --------------------------------------------------------

export type PayoutStatus =
  | "draft"
  | "approved"
  | "exported"
  | "paid"
  | "failed"
  | "cancelled";

/** Eine Server Action dieser Seite; Form wie überall im Modul (`state.ts`). */
export type PayoutAction = (
  state: AffiliatePayoutActionState,
  formData: FormData,
) => Promise<AffiliatePayoutActionState>;

/**
 * Eine Zeile der Auszahlungsliste. ALLE Texte kommen fertig formatiert vom
 * Server — hier wird nicht gerechnet und nicht umgerechnet; die einzige
 * Ausnahme ist die Summe der AUSGEWÄHLTEN Zeilen, die es serverseitig noch
 * nicht geben kann, weil die Auswahl erst im Browser entsteht. Sie wird
 * deshalb aus `totalCents` gebildet und über denselben Formatter ausgegeben.
 */
export type PayoutRowView = {
  id: string;
  partnerName: string;
  periodText: string;
  grossText: string;
  reversalText: string;
  subtotalText: string;
  taxText: string;
  totalText: string;
  totalCents: number;
  currency: string;
  taxModeText: string;
  methodText: string;
  method: AffiliatePayoutMethod | null;
  status: PayoutStatus;
  statusText: string;
  documentNo: string | null;
  /** Das PDF liegt im Bucket. `false` heißt „Beleg gültig, Datei folgt" (7.2). */
  documentReady: boolean;
  reference: string | null;
  /** Vollständigkeit des Abrechnungsprofils als TEXT, nie nur als Farbe. */
  completenessText: string;
  complete: boolean;
};

// --- Der Lauf -----------------------------------------------------------

/**
 * Erzeugt die Entwürfe (7.1). Der Zeitraum ist vorbelegt mit der zuletzt
 * abgeschlossenen Periode laut `program.payout_schedule` und bleibt
 * änderbar — ein nachgeholter Lauf für einen früheren Zeitraum ist der
 * Normalfall nach einer Störung, kein Sonderfall.
 *
 * Die Vorschau darüber ist genau das: eine Vorschau. Der Entwurf bildet seine
 * Summen aus den TATSÄCHLICH reservierten Zeilen (7.1), nicht aus diesen
 * Zahlen — der Text sagt das, damit eine Abweichung um einen Cent niemanden
 * beunruhigt.
 */
export function PayoutRunForm({
  action,
  periodFrom,
  periodTo,
  candidateCount,
  candidateTotals,
}: {
  action: PayoutAction;
  periodFrom: string;
  periodTo: string;
  candidateCount: number;
  /** Je Währung eine fertig formatierte Summe (5.11: nie eine Gesamtzahl). */
  candidateTotals: string[];
}) {
  const t = useTranslations("admin.affiliate.payouts");
  const [state, formAction, pending] = useActionState(
    action,
    initialAffiliatePayoutActionState,
  );
  const statusRef = useStatusFocus(
    Boolean(state.error) || Boolean(state.success),
  );
  const idPrefix = useId();

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
        {t("run.heading")}
      </h2>
      <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
        {t("run.description")}
      </p>

      {/* Die Vorschau als Text, nicht als Kachelgrafik: jede Zahl ist ein
          Satz, der auch vorgelesen einen Sinn ergibt. */}
      <p className="mt-3 text-[15px]" style={{ color: INK }}>
        {t("run.preview", { count: candidateCount })}
      </p>
      {candidateTotals.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5 p-0 text-[15px]" style={{ listStyle: "none" }}>
          {candidateTotals.map((line) => (
            <li key={line} style={{ color: INK }}>
              {line}
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="sm:w-[190px]">
          <label
            htmlFor={`${idPrefix}-from`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("run.periodFrom")}
          </label>
          <input
            id={`${idPrefix}-from`}
            name="periodFrom"
            type="date"
            required
            defaultValue={periodFrom}
            className={`${fieldClass} ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
        </div>
        <div className="sm:w-[190px]">
          <label
            htmlFor={`${idPrefix}-to`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("run.periodTo")}
          </label>
          <input
            id={`${idPrefix}-to`}
            name="periodTo"
            type="date"
            required
            defaultValue={periodTo}
            className={`${fieldClass} ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className={`${buttonClass} text-white ${FOCUS_RING}`}
          style={{ background: NAVY, opacity: pending ? 0.7 : 1 }}
        >
          {pending ? t("run.pending") : t("run.submit")}
        </button>
      </form>

      <Feedback state={state} statusRef={statusRef} successText={t("run.done")} />
    </section>
  );
}

// --- Liste, Auswahl, Freigabe, Export -----------------------------------

/**
 * Die Liste eines Reiters.
 *
 * `mode` entscheidet, WAS an einer Zeile getan werden kann, nicht WAS sie
 * zeigt — die Darstellung ist in allen fünf Reitern dieselbe:
 *   `approve` — Entwürfe: Auswahl, Bestätigung, Freigabe.
 *   `settle`  — Freigegeben/Exportiert: Auswahl für den Export, je Zeile
 *               „als gezahlt markieren" und „fehlgeschlagen".
 *   `read`    — Bezahlt/Historie: nur lesen.
 *
 * Die Auswahl liegt NICHT in einem Formular, sondern im Zustand dieser
 * Komponente: Freigabe (Server Action) und Export (Route Handler mit
 * Origin-Prüfung) sind zwei verschiedene Ziele, und beide brauchen dieselbe
 * Auswahl. Jedes der beiden Formulare schreibt sie als versteckte Felder neu
 * — so gibt es keine Schachtelung von Formularen, die HTML ohnehin verbietet.
 */
export function PayoutList({
  mode,
  rows,
  approveAction,
  paidAction,
  failedAction,
}: {
  mode: "approve" | "settle" | "read";
  rows: readonly PayoutRowView[];
  approveAction?: PayoutAction;
  paidAction?: PayoutAction;
  failedAction?: PayoutAction;
}) {
  const t = useTranslations("admin.affiliate.payouts");
  const [selected, setSelected] = useState<readonly string[]>([]);

  const selectable = mode !== "read";
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.includes(row.id)),
    [rows, selected],
  );

  function toggle(id: string, checked: boolean): void {
    setSelected((current) =>
      checked ? [...current, id] : current.filter((value) => value !== id),
    );
  }

  if (rows.length === 0) {
    return (
      <div
        className={`${CARD_CLASS} p-[22px_24px] text-[15px]`}
        style={{ borderColor: CARD_BORDER, color: MUTED }}
      >
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`${CARD_CLASS} overflow-hidden`}
        style={{ borderColor: CARD_BORDER }}
      >
        <div
          className="rgrid-header px-[24px] py-3 text-[13px] font-bold uppercase tracking-[0.04em]"
          style={
            {
              "--rgrid-cols": PAYOUT_COLS,
              color: MUTED,
              borderBottom: `1px solid ${HAIRLINE}`,
            } as React.CSSProperties
          }
        >
          <span>{t("columnPartner")}</span>
          <span>{t("columnPeriod")}</span>
          <span>{t("columnGross")}</span>
          <span>{t("columnReversals")}</span>
          <span>{t("columnAmount")}</span>
          <span>{t("columnTaxMode")}</span>
          <span>{t("columnMethod")}</span>
          <span>{t("columnStatus")}</span>
        </div>

        {rows.map((row) => (
          <PayoutRow
            key={row.id}
            row={row}
            selectable={selectable}
            checked={selected.includes(row.id)}
            onToggle={toggle}
            showSettlement={mode === "settle"}
            paidAction={paidAction}
            failedAction={failedAction}
          />
        ))}
      </div>

      {mode === "approve" && approveAction !== undefined && (
        <ApprovalPanel action={approveAction} rows={selectedRows} />
      )}
      {mode === "settle" && <ExportPanel rows={selectedRows} />}
    </div>
  );
}

/**
 * Eine Zeile. Eigene Komponente, weil „als gezahlt markieren" und
 * „fehlgeschlagen" je Zeile einen eigenen `useActionState` brauchen — Hooks
 * in einer Schleife wären nicht zulässig, und ein gemeinsamer Zustand ließe
 * die Rückmeldung an der falschen Zeile erscheinen.
 */
function PayoutRow({
  row,
  selectable,
  checked,
  onToggle,
  showSettlement,
  paidAction,
  failedAction,
}: {
  row: PayoutRowView;
  selectable: boolean;
  checked: boolean;
  onToggle: (id: string, checked: boolean) => void;
  showSettlement: boolean;
  paidAction?: PayoutAction;
  failedAction?: PayoutAction;
}) {
  const t = useTranslations("admin.affiliate.payouts");
  const idPrefix = useId();
  const style = PAYOUT_STATUS_STYLE[row.status];

  return (
    <div style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <div
        className="rgrid-row px-[18px] py-4 text-[15px] lg:px-[24px]"
        style={{ "--rgrid-cols": PAYOUT_COLS } as React.CSSProperties}
      >
        <span className="flex items-center gap-2" style={{ color: INK }}>
          {selectable ? (
            <>
              {/* Das Kästchen nennt Partner UND Betrag: in einer Liste aus
                  dreißig Kästchen ist „Auswählen" allein wertlos. Der
                  sichtbare Beschriftungstext (der Partnername) steckt im
                  `aria-label` wörtlich drin — sonst bräche WCAG 2.5.3
                  („Label in Name") und Sprachsteuerung fände das Feld nicht.
                  `htmlFor` + `id` statt eines umschließenden Labels (8.5),
                  und das Label ist 40 px hoch: das Kästchen selbst wäre als
                  Klickziel zu klein. */}
              <input
                id={`${idPrefix}-select`}
                type="checkbox"
                checked={checked}
                onChange={(event) => onToggle(row.id, event.target.checked)}
                aria-label={t("selectRow", {
                  partner: row.partnerName,
                  amount: row.totalText,
                })}
                className={`h-5 w-5 shrink-0 ${FOCUS_RING}`}
              />
              <label
                htmlFor={`${idPrefix}-select`}
                className="inline-flex min-h-[40px] cursor-pointer items-center font-semibold"
              >
                {row.partnerName}
              </label>
            </>
          ) : (
            <span className="font-semibold">{row.partnerName}</span>
          )}
        </span>

        <span style={{ color: INK }}>
          <span className="rgrid-label">{t("columnPeriod")}</span>
          {row.periodText}
        </span>
        <span style={{ color: INK }}>
          <span className="rgrid-label">{t("columnGross")}</span>
          {row.grossText}
        </span>
        <span style={{ color: INK }}>
          <span className="rgrid-label">{t("columnReversals")}</span>
          {row.reversalText}
        </span>
        <span className="font-bold" style={{ color: INK }}>
          <span className="rgrid-label">{t("columnAmount")}</span>
          {row.totalText}
        </span>
        <span style={{ color: INK }}>
          <span className="rgrid-label">{t("columnTaxMode")}</span>
          {row.taxModeText}
        </span>
        <span style={{ color: INK }}>
          <span className="rgrid-label">{t("columnMethod")}</span>
          {row.methodText}
        </span>
        <span>
          <span className="rgrid-label">{t("columnStatus")}</span>
          <span
            className="inline-flex items-center rounded-[8px] px-2 py-1 text-[13px] font-bold"
            style={{ color: style.color, background: style.background }}
          >
            {row.statusText}
          </span>
        </span>
      </div>

      {/* Zweite Zeile: Beleg, Referenz, Vollständigkeit — alles als Text. */}
      <div
        className="flex flex-col gap-1 px-[18px] pb-4 text-[15px] lg:px-[24px]"
        style={{ color: MUTED }}
      >
        <span>
          {t("columnDocument")}:{" "}
          <span style={{ color: INK }}>
            {row.documentNo ?? t("documentPending")}
          </span>
          {row.documentNo !== null && !row.documentReady && (
            <span style={{ color: DANGER }}> — {t("documentFileMissing")}</span>
          )}
        </span>
        {row.reference !== null && (
          <span>
            {t("columnReference")}:{" "}
            <span style={{ color: INK }}>{row.reference}</span>
          </span>
        )}
        <span>
          {t("columnCompleteness")}:{" "}
          <span style={{ color: row.complete ? INK : DANGER }}>
            {row.completenessText}
          </span>
        </span>
        <span>
          {t("subtotalLabel")}: <span style={{ color: INK }}>{row.subtotalText}</span>
          {" · "}
          {t("taxLabel")}: <span style={{ color: INK }}>{row.taxText}</span>
        </span>
      </div>

      {showSettlement && paidAction !== undefined && failedAction !== undefined && (
        <SettlementForms
          row={row}
          paidAction={paidAction}
          failedAction={failedAction}
        />
      )}
    </div>
  );
}

/**
 * „Als gezahlt markieren" mit Referenzfeld und „Überweisung fehlgeschlagen"
 * (7.7). Die Referenz ist Pflicht: ohne sie ist der Bankabgleich später eine
 * Suche im Kontoauszug, und genau dafür steht die Belegnummer als
 * `EndToEndId` in der SEPA-Datei.
 */
function SettlementForms({
  row,
  paidAction,
  failedAction,
}: {
  row: PayoutRowView;
  paidAction: PayoutAction;
  failedAction: PayoutAction;
}) {
  const t = useTranslations("admin.affiliate.payouts");
  const idPrefix = useId();

  const [paidState, paidFormAction, paidPending] = useActionState(
    paidAction,
    initialAffiliatePayoutActionState,
  );
  const [failedState, failedFormAction, failedPending] = useActionState(
    failedAction,
    initialAffiliatePayoutActionState,
  );
  const paidRef = useStatusFocus(
    Boolean(paidState.error) || Boolean(paidState.success),
  );
  const failedRef = useStatusFocus(
    Boolean(failedState.error) || Boolean(failedState.success),
  );

  return (
    <div
      className="flex flex-col gap-3 border-t px-[18px] py-4 lg:px-[24px]"
      style={{ borderColor: HAIRLINE }}
    >
      <form
        action={paidFormAction}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="payoutId" value={row.id} />
        <div className="sm:w-[280px]">
          <label
            htmlFor={`${idPrefix}-reference`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("referenceLabel")}
          </label>
          <input
            id={`${idPrefix}-reference`}
            name="reference"
            type="text"
            required
            maxLength={140}
            aria-describedby={`${idPrefix}-reference-hint`}
            className={`${fieldClass} ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          />
        </div>
        <button
          type="submit"
          disabled={paidPending}
          className={`${buttonClass} border ${FOCUS_RING}`}
          style={{
            borderColor: CARD_BORDER,
            color: INK,
            background: "#FFFFFF",
            opacity: paidPending ? 0.7 : 1,
          }}
        >
          {t("markPaid")}
        </button>
      </form>
      <p
        id={`${idPrefix}-reference-hint`}
        className="text-[13px]"
        style={{ color: MUTED }}
      >
        {t("referenceHint")}
      </p>
      <Feedback
        state={paidState}
        statusRef={paidRef}
        successText={t("markPaidDone")}
      />

      <form action={failedFormAction}>
        <input type="hidden" name="payoutId" value={row.id} />
        <button
          type="submit"
          disabled={failedPending}
          className={`${buttonClass} border ${FOCUS_RING}`}
          style={{
            borderColor: CARD_BORDER,
            color: DANGER,
            background: "#FFFFFF",
            opacity: failedPending ? 0.7 : 1,
          }}
        >
          {t("markFailed")}
        </button>
      </form>
      <p className="text-[13px]" style={{ color: MUTED }}>
        {t("markFailedHint")}
      </p>
      <Feedback
        state={failedState}
        statusRef={failedRef}
        successText={t("markFailedDone")}
      />
    </div>
  );
}

/**
 * Die Freigabe in zwei Schritten (7.2, 11.17).
 *
 * Schritt 1 ist ein gewöhnlicher Knopf, der NICHTS abschickt. Schritt 2 ist
 * eine Karte mit dem ausgeschriebenen Betrag je Währung und der Zahl der
 * Empfänger, die den Fokus bekommt — und erst ihr Knopf löst die Server
 * Action aus.
 */
function ApprovalPanel({
  action,
  rows,
}: {
  action: PayoutAction;
  rows: readonly PayoutRowView[];
}) {
  const t = useTranslations("admin.affiliate.payouts");
  const format = useFormatter();
  const idPrefix = useId();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    action,
    initialAffiliatePayoutActionState,
  );
  const statusRef = useStatusFocus(
    Boolean(state.error) || Boolean(state.success),
  );
  const confirmRef = useStatusFocus<HTMLDivElement>(confirming);

  /**
   * Summen je Währung. NIE eine Gesamtzahl über Währungen hinweg (5.11) —
   * „1.247,80 € und 300,00 CHF" ist zwei Sätze wert, eine addierte Zahl wäre
   * schlicht falsch.
   */
  const totals = useMemo(() => {
    const byCurrency = new Map<string, { cents: number; partners: Set<string> }>();
    for (const row of rows) {
      const entry = byCurrency.get(row.currency) ?? {
        cents: 0,
        partners: new Set<string>(),
      };
      entry.cents += row.totalCents;
      entry.partners.add(row.partnerName);
      byCurrency.set(row.currency, entry);
    }
    return [...byCurrency.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([currency, entry]) => ({
        currency,
        cents: entry.cents,
        partners: entry.partners.size,
        amountText: format.number(centsToAmount(entry.cents), {
          style: "currency",
          currency: currencyCode(currency),
        }),
      }));
  }, [rows, format]);

  if (rows.length === 0) {
    return (
      <p className="text-[15px]" style={{ color: MUTED }}>
        {t("selectHint")}
      </p>
    );
  }

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
        {t("releaseHeading")}
      </h2>

      {!confirming && (
        <>
          <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
            {t("releaseSelectedCount", { count: rows.length })}
          </p>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={`${buttonClass} mt-3 text-white ${FOCUS_RING}`}
            style={{ background: NAVY }}
          >
            {t("releaseSelected")}
          </button>
        </>
      )}

      {confirming && (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${idPrefix}-confirm-heading`}
          className="mt-3 rounded-[12px] border p-[18px_20px] outline-none"
          style={{ borderColor: NAVY, background: "#FFFFFF" }}
        >
          <h3
            id={`${idPrefix}-confirm-heading`}
            className="text-[15px] font-bold"
            style={{ color: INK }}
          >
            {t("releaseConfirm", {
              count: rows.length,
              amount: totals.map((entry) => entry.amountText).join(" · "),
            })}
          </h3>
          {/* Der Satz, den der Plan wörtlich verlangt: Betrag UND
              Empfängerzahl im Klartext, je Währung eine eigene Zeile. */}
          <ul
            className="mt-2 flex flex-col gap-1 p-0 text-[15px]"
            style={{ listStyle: "none", color: INK }}
          >
            {totals.map((entry) => (
              <li key={entry.currency}>
                {t("releaseConfirmDetail", {
                  amount: entry.amountText,
                  partners: entry.partners,
                })}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[15px]" style={{ color: MUTED }}>
            {t("releaseConfirmHint")}
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <form action={formAction}>
              {rows.map((row) => (
                <input key={row.id} type="hidden" name="payoutIds" value={row.id} />
              ))}
              {/* Die ANGEZEIGTE Summe wandert mit; die Server Action rechnet
                  sie nach und bricht bei Abweichung ab. */}
              {totals.map((entry) => (
                <input
                  key={entry.currency}
                  type="hidden"
                  name="expected"
                  value={`${entry.currency}:${entry.cents}`}
                />
              ))}
              <input type="hidden" name="confirm" value="yes" />
              <button
                type="submit"
                disabled={pending}
                className={`${buttonClass} text-white ${FOCUS_RING}`}
                style={{ background: "#5663AE", opacity: pending ? 0.7 : 1 }}
              >
                {pending ? t("releasePending") : t("releaseConfirmYes")}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`${buttonClass} border ${FOCUS_RING}`}
              style={{ borderColor: CARD_BORDER, color: INK, background: "#FFFFFF" }}
            >
              {t("releaseConfirmNo")}
            </button>
          </div>
        </div>
      )}

      <Feedback
        state={state}
        statusRef={statusRef}
        successText={t("releaseDone")}
      />
    </section>
  );
}

/**
 * SEPA-XML und CSV (7.7).
 *
 * Ein gewöhnliches `method="post"`-Formular auf den Route Handler, KEINE
 * Server Action und kein `fetch`: die Antwort ist eine Datei mit
 * `Content-Disposition: attachment`, der Browser lädt sie herunter und die
 * Seite bleibt stehen. POST statt Link, weil `verifySameOrigin()`
 * fail-closed ist und ein Browser bei einer gewöhnlichen Navigation keinen
 * `Origin`-Header sendet.
 *
 * Der Auftraggeber (Name, IBAN, optional BIC) wird hier eingegeben und
 * NIRGENDS gespeichert: es gibt im Datenmodell kein Bankkonto des Mandanten
 * (3.13 kennt nur die Zahlungsverbindung des PARTNERS), und ein neues Feld
 * dafür ist weder im Plan vorgesehen noch für eine Datei nötig, die ohnehin
 * in ein Bankportal hochgeladen wird. Die Angabe steht in der erzeugten
 * Datei und sonst an keiner Stelle — auch in keinem Protokoll (§2.11).
 */
function ExportPanel({ rows }: { rows: readonly PayoutRowView[] }) {
  const t = useTranslations("admin.affiliate.payouts");
  const idPrefix = useId();
  const [method, setMethod] = useState<AffiliatePayoutMethod>(
    rows[0]?.method ?? "sepa",
  );

  if (rows.length === 0) {
    return (
      <p className="text-[15px]" style={{ color: MUTED }}>
        {t("selectHint")}
      </p>
    );
  }

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
        {t("exportHeading")}
      </h2>
      <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
        {t("exportDescription", { count: rows.length })}
      </p>

      <form
        method="post"
        action="/api/admin/affiliate/payout-export"
        className="mt-3 flex flex-col gap-4"
      >
        {rows.map((row) => (
          <input key={row.id} type="hidden" name="payoutIds" value={row.id} />
        ))}

        <div className="sm:w-[280px]">
          <label
            htmlFor={`${idPrefix}-method`}
            className={labelClass}
            style={{ color: MUTED }}
          >
            {t("columnMethod")}
          </label>
          <select
            id={`${idPrefix}-method`}
            name="method"
            value={method}
            onChange={(event) =>
              setMethod(event.target.value as AffiliatePayoutMethod)
            }
            aria-describedby={`${idPrefix}-method-hint`}
            className={`${fieldClass} ${FOCUS_RING}`}
            style={{ borderColor: CARD_BORDER, color: INK }}
          >
            <option value="sepa">{t("method.sepa")}</option>
            <option value="paypal">{t("method.paypal")}</option>
            <option value="manual">{t("method.manual")}</option>
          </select>
          <p
            id={`${idPrefix}-method-hint`}
            className="mt-1.5 text-[13px]"
            style={{ color: MUTED }}
          >
            {t("exportMethodHint")}
          </p>
        </div>

        {method === "sepa" && (
          <fieldset className="border-0 p-0">
            <legend
              className="mb-2 text-[15px] font-bold"
              style={{ color: INK }}
            >
              {t("debtorHeading")}
            </legend>
            <p className="mb-3 text-[15px]" style={{ color: MUTED }}>
              {t("debtorHint")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`${idPrefix}-debtor-name`}
                  className={labelClass}
                  style={{ color: MUTED }}
                >
                  {t("debtorName")}
                </label>
                <input
                  id={`${idPrefix}-debtor-name`}
                  name="debtorName"
                  type="text"
                  required
                  maxLength={70}
                  className={`${fieldClass} ${FOCUS_RING}`}
                  style={{ borderColor: CARD_BORDER, color: INK }}
                />
              </div>
              <div>
                <label
                  htmlFor={`${idPrefix}-debtor-iban`}
                  className={labelClass}
                  style={{ color: MUTED }}
                >
                  {t("debtorIban")}
                </label>
                <input
                  id={`${idPrefix}-debtor-iban`}
                  name="debtorIban"
                  type="text"
                  required
                  autoComplete="off"
                  maxLength={42}
                  className={`${fieldClass} ${FOCUS_RING}`}
                  style={{ borderColor: CARD_BORDER, color: INK }}
                />
              </div>
              <div>
                <label
                  htmlFor={`${idPrefix}-debtor-bic`}
                  className={labelClass}
                  style={{ color: MUTED }}
                >
                  {t("debtorBic")}
                </label>
                <input
                  id={`${idPrefix}-debtor-bic`}
                  name="debtorBic"
                  type="text"
                  autoComplete="off"
                  maxLength={11}
                  className={`${fieldClass} ${FOCUS_RING}`}
                  style={{ borderColor: CARD_BORDER, color: INK }}
                />
              </div>
              <div>
                <label
                  htmlFor={`${idPrefix}-execution`}
                  className={labelClass}
                  style={{ color: MUTED }}
                >
                  {t("executionDate")}
                </label>
                <input
                  id={`${idPrefix}-execution`}
                  name="executionDate"
                  type="date"
                  className={`${fieldClass} ${FOCUS_RING}`}
                  style={{ borderColor: CARD_BORDER, color: INK }}
                />
              </div>
            </div>
          </fieldset>
        )}

        <div>
          <button
            type="submit"
            className={`${buttonClass} text-white ${FOCUS_RING}`}
            style={{ background: NAVY }}
          >
            {method === "sepa" ? t("exportSepa") : t("exportCsv")}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Rückmeldung einer Server Action. `role="alert"` für den Fehler,
 * `role="status" aria-live="polite"` für den Erfolg, beide mit
 * `tabIndex={-1}` — `useStatusFocus()` wirft den Fokus dorthin, sobald die
 * Meldung erscheint (8.5, letzter Punkt).
 */
function Feedback({
  state,
  statusRef,
  successText,
}: {
  state: AffiliatePayoutActionState;
  statusRef: React.RefObject<HTMLParagraphElement | null>;
  successText: string;
}) {
  if (state.error !== null) {
    return (
      <p
        ref={statusRef}
        role="alert"
        tabIndex={-1}
        className="mt-3 text-[15px] outline-none"
        style={{ color: DANGER }}
      >
        {state.error}
      </p>
    );
  }
  if (state.success === true) {
    return (
      <p
        ref={statusRef}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        className="mt-3 text-[15px] outline-none"
        style={{ color: SUCCESS }}
      >
        {successText}
      </p>
    );
  }
  return null;
}
