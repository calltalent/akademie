/**
 * Affiliate-System, Block B8 — SEPA-SAMMELÜBERWEISUNG `pain.001.001.09`
 * (PLAN_Affiliate-System.md 7.7, G16).
 *
 * REINE Funktion, kein `server-only`, kein I/O: aus einer Liste freigegebener
 * Auszahlungen wird eine Zeichenkette. Damit ist sie ohne Datenbank testbar,
 * und der Export-Route-Handler bleibt das, was er sein soll — Autorisierung,
 * Rate-Limit, `Content-Disposition`.
 *
 * ## WARUM STRING-TEMPLATING UND KEINE BIBLIOTHEK
 *
 * G16: keine neue npm-Abhängigkeit. Das Worker-Größenlimit liegt bei 3 MiB
 * gzip, und `sepa`/`xmlbuilder`-Pakete kosten mehr, als dieses Dokument
 * kompliziert ist — es hat genau drei Ebenen und keine Wahlfreiheit. Der Preis
 * dafür ist, dass das Escaping HIER stimmen muss; deshalb geht jeder Textwert
 * durch `sepaText()` und danach durch `escapeXml()`, ohne Ausnahme und ohne
 * eine einzige Stelle, an der ein Wert direkt in die Vorlage eingesetzt wird.
 *
 * ## ZWEI ZEICHENSÄTZE, NICHT EINER
 *
 * Die Datei ist UTF-8, aber der SEPA-Zeichensatz der Rulebooks ist es nicht:
 * erlaubt sind `a-z A-Z 0-9 / - ? : ( ) . , ' +` und Leerzeichen. Banken
 * weisen Aufträge mit anderen Zeichen ab oder ersetzen sie stillschweigend —
 * und „stillschweigend ersetzt" heißt bei einem Kontoinhaber „Name stimmt
 * nicht mit IBAN überein". Deutsche Umlaute werden deshalb transliteriert
 * (ä → ae, ß → ss), alles andere fällt auf ein Leerzeichen zurück. Das ist
 * eine Anzeige-, keine Identitätsänderung: die Zuordnung der Zahlung läuft
 * über IBAN und `EndToEndId`, nicht über die Schreibweise des Namens.
 *
 * `escapeXml()` läuft trotzdem darüber. Nach der Transliteration kann kein
 * `&` oder `<` mehr übrig sein — die Verteidigung bleibt stehen, weil eine
 * spätere Änderung an `sepaText()` sonst unbemerkt eine Injektionslücke
 * aufmachte, und weil `escapeXml()` so eigenständig prüfbar ist.
 *
 * ## KEINE SUMME ÜBER WÄHRUNGEN (5.11)
 *
 * Je Währung entsteht ein eigener `<PmtInf>`-Block mit eigener `CtrlSum`. Die
 * `CtrlSum` im `<GrpHdr>` wird NUR geschrieben, wenn das ganze Dokument eine
 * einzige Währung hat; sonst bleibt sie weg (im Schema optional). Eine Zahl,
 * die 1200 EUR und 800 CHF zu „2000" addiert, ist keine Kontrollsumme,
 * sondern eine Fehlerquelle mit Prüfsiegel.
 */

/** Zielschema. Der Namensraum ist zugleich die Versionsangabe des Dokuments. */
export const SEPA_NAMESPACE = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.09";

/** Längengrenzen aus dem Schema; Überlänge wird abgeschnitten, nie abgewiesen. */
const MAX_MSG_ID = 35;
const MAX_END_TO_END_ID = 35;
const MAX_NAME = 70;
const MAX_REMITTANCE = 140;

// --- Textaufbereitung ---------------------------------------------------

/**
 * Die Steuerzeichen, die XML 1.0 überhaupt nicht kennt (alles unter 0x20 außer
 * Tabulator, Zeilenumbruch und Wagenrücklauf). Ein einziges davon macht das
 * Dokument für jeden Parser unlesbar, also fällt es vor dem Escaping heraus.
 */
const XML_FORBIDDEN_CONTROL_CHARS = new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "g");

/**
 * XML-Escaping für Textknoten und Attributwerte. Fünf Entitäten, mehr braucht
 * XML nicht.
 */
export function escapeXml(value: string): string {
  return value
    .replace(XML_FORBIDDEN_CONTROL_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Erlaubter SEPA-Zeichensatz (Rulebook, „basic Latin character set"). */
const SEPA_ALLOWED = /[^A-Za-z0-9/\-?:().,'+ ]/g;

/** Kombinierende Akzentzeichen, die nach der NFKD-Zerlegung übrig bleiben. */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * Transliteration in den SEPA-Zeichensatz. Die Reihenfolge ist wichtig:
 * erst die bekannten Ersetzungen (sonst würde `ü` zu einem Leerzeichen statt
 * zu `ue`), dann die Zerlegung zusammengesetzter Zeichen (`é` → `e`), dann
 * der Rest auf Leerzeichen, dann Leerraum zusammenfassen.
 */
const TRANSLITERATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ä/g, "ae"],
  [/ö/g, "oe"],
  [/ü/g, "ue"],
  [/Ä/g, "Ae"],
  [/Ö/g, "Oe"],
  [/Ü/g, "Ue"],
  [/ß/g, "ss"],
  [/æ/g, "ae"],
  [/Æ/g, "Ae"],
  [/ø/g, "oe"],
  [/Ø/g, "Oe"],
  [/å/g, "aa"],
  [/Å/g, "Aa"],
  [/œ/g, "oe"],
  [/Œ/g, "Oe"],
  [/&/g, " und "],
];

export function sepaText(value: string, maxLength: number): string {
  let text = value ?? "";
  for (const [pattern, replacement] of TRANSLITERATIONS) text = text.replace(pattern, replacement);

  // Unicode-Zerlegung entfernt Akzente von allem, was sich zerlegen lässt
  // (`é` → `e` + Kombinationszeichen). Gleicher Ansatz wie `sanitizeForFont()`
  // im Zertifikats-PDF, dort aus demselben Grund: ein fremder Zeichensatz.
  text = text.normalize("NFKD").replace(COMBINING_MARKS, "");

  text = text.replace(SEPA_ALLOWED, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, maxLength);
}

/**
 * Betrag als ISO-20022-Dezimalzahl: Punkt als Trennzeichen, immer zwei
 * Nachkommastellen, kein Tausenderpunkt. Aus Ganzzahl-Cent gerechnet (G12),
 * nie über `toFixed()` einer Gleitkommazahl — `(0.1+0.2).toFixed(2)` ist der
 * Grund, warum in diesem Modul überhaupt alles in Cent liegt.
 */
export function formatSepaAmount(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("formatSepaAmount: Betrag muss eine ganze Zahl > 0 Cent sein.");
  }
  const euros = Math.trunc(amountCents / 100);
  const cents = amountCents % 100;
  return `${euros}.${String(cents).padStart(2, "0")}`;
}

// --- IBAN ---------------------------------------------------------------

/** Leerzeichen raus, Großbuchstaben — die Schreibweise auf Kontoauszügen ist gruppiert. */
export function normalizeIban(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\s.\-]/g, "").toUpperCase();
}

/**
 * IBAN-Prüfung nach ISO 13616 (Modulo 97 = 1). Sie ersetzt keine Kontoprüfung,
 * fängt aber den Zahlendreher ab — und ein Zahlendreher in einer IBAN ist
 * entweder eine Rückläuferbuchung mit Gebühr oder, bei zufällig gültiger
 * Prüfziffer, eine Zahlung an einen Fremden.
 *
 * Gerechnet wird ziffernweise mit `%`, nicht über eine Zahl: eine 34-stellige
 * IBAN ergibt als Zahl bis zu 10^38 und wäre in `number` längst ungenau.
 */
export function isValidIban(value: string | null | undefined): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const mapped = char >= "A" && char <= "Z" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of mapped) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** BIC nach ISO 9362: 8 oder 11 Stellen. `null`, wenn nicht verwertbar. */
export function normalizeBic(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const bic = value.replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic) ? bic : null;
}

// --- Eingabe ------------------------------------------------------------

/** Eine Überweisung: genau eine freigegebene Auszahlung. */
export type SepaInstruction = {
  /** Belegnummer der Gutschrift — sie ist die `EndToEndId` (7.7). */
  documentNo: string;
  creditorName: string;
  iban: string;
  bic?: string | null;
  /** `affiliate_payouts.total_cents`, also inklusive Steuer. */
  amountCents: number;
  /** Währungskennung, in der Datenbank klein geschrieben (`eur`). */
  currency: string;
  /** Verwendungszweck; ohne Angabe wird die Belegnummer verwendet. */
  remittance?: string | null;
};

/** Der Auftraggeber: der Rechtsträger, der tatsächlich überweist. */
export type SepaDebtor = {
  name: string;
  iban: string;
  bic?: string | null;
};

export type SepaBuildInput = {
  messageId: string;
  createdAt: Date;
  /** Ausführungstag; Datum ohne Uhrzeit, wie `<ReqdExctnDt><Dt>` es verlangt. */
  requestedExecutionDate: Date;
  debtor: SepaDebtor;
  instructions: readonly SepaInstruction[];
};

/** ISO-Datum `JJJJ-MM-TT` in UTC — dieselbe Ableitung wie `toIsoDate()` im Reporting. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** `CreDtTm` ohne Millisekunden; einige Bankportale weisen die Form mit ab. */
function isoDateTime(value: Date): string {
  return `${value.toISOString().slice(0, 19)}Z`;
}

function assertValidInput(input: SepaBuildInput): void {
  if (input.instructions.length === 0) {
    throw new Error("buildSepaCreditTransfer: keine Überweisungen im Auftrag.");
  }
  if (!isValidIban(input.debtor.iban)) {
    throw new Error("buildSepaCreditTransfer: IBAN des Auftraggebers ist ungültig.");
  }
  for (const instruction of input.instructions) {
    if (!isValidIban(instruction.iban)) {
      // Bewusst ohne die IBAN selbst in der Meldung (CLAUDE.md §2.11) — die
      // Belegnummer benennt den Fall eindeutig und trägt keinen Kontobezug.
      throw new Error(
        `buildSepaCreditTransfer: ungültige IBAN bei Beleg ${sepaText(
          instruction.documentNo,
          MAX_END_TO_END_ID,
        )}.`,
      );
    }
  }
}

/**
 * Baut die Sammelüberweisung. Ein `<PmtInf>` je Währung, eine
 * `<CdtTrfTxInf>` je Auszahlung, `<EndToEndId>` = Belegnummer (7.7) — damit
 * findet der Bankabgleich später jede Zeile über genau die Nummer wieder, die
 * auch auf der Gutschrift steht.
 *
 * Die Reihenfolge ist deterministisch (Währung, dann Belegnummer): zwei Läufe
 * über denselben Bestand ergeben dieselbe Datei, was die Voraussetzung dafür
 * ist, dass man einen erneuten Export mit dem ersten vergleichen kann.
 */
export function buildSepaCreditTransfer(input: SepaBuildInput): string {
  assertValidInput(input);

  const debtorName = escapeXml(sepaText(input.debtor.name, MAX_NAME));
  const debtorIban = normalizeIban(input.debtor.iban);
  const debtorBic = normalizeBic(input.debtor.bic);

  // Gruppierung je Währung. `Map` statt Objekt, damit die Einfügereihenfolge
  // erhalten bleibt und anschließend bewusst sortiert wird.
  const byCurrency = new Map<string, SepaInstruction[]>();
  for (const instruction of input.instructions) {
    const currency = instruction.currency.trim().toUpperCase();
    const list = byCurrency.get(currency);
    if (list === undefined) byCurrency.set(currency, [instruction]);
    else list.push(instruction);
  }

  const currencies = [...byCurrency.keys()].sort((a, b) => a.localeCompare(b));
  const totalCount = input.instructions.length;

  const blocks: string[] = [];
  for (const [index, currency] of currencies.entries()) {
    const list = [...(byCurrency.get(currency) ?? [])].sort((a, b) =>
      a.documentNo.localeCompare(b.documentNo),
    );
    const sumCents = list.reduce((acc, item) => acc + item.amountCents, 0);

    const transactions = list
      .map((item) => {
        const remittance = sepaText(item.remittance ?? item.documentNo, MAX_REMITTANCE);
        const creditorBic = normalizeBic(item.bic);
        return [
          `      <CdtTrfTxInf>`,
          `        <PmtId>`,
          `          <EndToEndId>${escapeXml(
            sepaText(item.documentNo, MAX_END_TO_END_ID),
          )}</EndToEndId>`,
          `        </PmtId>`,
          `        <Amt>`,
          `          <InstdAmt Ccy="${escapeXml(currency)}">${formatSepaAmount(
            item.amountCents,
          )}</InstdAmt>`,
          `        </Amt>`,
          ...(creditorBic
            ? [
                `        <CdtrAgt>`,
                `          <FinInstnId>`,
                `            <BICFI>${escapeXml(creditorBic)}</BICFI>`,
                `          </FinInstnId>`,
                `        </CdtrAgt>`,
              ]
            : []),
          `        <Cdtr>`,
          `          <Nm>${escapeXml(sepaText(item.creditorName, MAX_NAME))}</Nm>`,
          `        </Cdtr>`,
          `        <CdtrAcct>`,
          `          <Id>`,
          `            <IBAN>${escapeXml(normalizeIban(item.iban))}</IBAN>`,
          `          </Id>`,
          `        </CdtrAcct>`,
          `        <RmtInf>`,
          `          <Ustrd>${escapeXml(remittance)}</Ustrd>`,
          `        </RmtInf>`,
          `      </CdtTrfTxInf>`,
        ].join("\n");
      })
      .join("\n");

    blocks.push(
      [
        `    <PmtInf>`,
        `      <PmtInfId>${escapeXml(
          sepaText(`${input.messageId}-${index + 1}`, MAX_MSG_ID),
        )}</PmtInfId>`,
        `      <PmtMtd>TRF</PmtMtd>`,
        `      <BtchBookg>true</BtchBookg>`,
        `      <NbOfTxs>${list.length}</NbOfTxs>`,
        `      <CtrlSum>${formatSepaAmount(sumCents)}</CtrlSum>`,
        // Das Dienstleistungsniveau „SEPA" gilt ausschließlich für Euro. Es
        // auch an einen CHF-Block zu schreiben wäre eine falsche Zusage an die
        // Bank; der Block läuft dann als gewöhnliche Auslandsüberweisung.
        ...(currency === "EUR"
          ? [
              `      <PmtTpInf>`,
              `        <SvcLvl>`,
              `          <Cd>SEPA</Cd>`,
              `        </SvcLvl>`,
              `      </PmtTpInf>`,
            ]
          : []),
        `      <ReqdExctnDt>`,
        `        <Dt>${isoDate(input.requestedExecutionDate)}</Dt>`,
        `      </ReqdExctnDt>`,
        `      <Dbtr>`,
        `        <Nm>${debtorName}</Nm>`,
        `      </Dbtr>`,
        `      <DbtrAcct>`,
        `        <Id>`,
        `          <IBAN>${escapeXml(debtorIban)}</IBAN>`,
        `        </Id>`,
        `      </DbtrAcct>`,
        ...(debtorBic
          ? [
              `      <DbtrAgt>`,
              `        <FinInstnId>`,
              `          <BICFI>${escapeXml(debtorBic)}</BICFI>`,
              `        </FinInstnId>`,
              `      </DbtrAgt>`,
            ]
          : []),
        `      <ChrgBr>SLEV</ChrgBr>`,
        transactions,
        `    </PmtInf>`,
      ].join("\n"),
    );
  }

  // Siehe Kopfkommentar: die Gesamtkontrollsumme gibt es nur bei einer
  // einzigen Währung. Das Element ist im Schema optional.
  const groupControlSum =
    currencies.length === 1
      ? `      <CtrlSum>${formatSepaAmount(
          input.instructions.reduce((acc, item) => acc + item.amountCents, 0),
        )}</CtrlSum>\n`
      : "";

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Document xmlns="${SEPA_NAMESPACE}">`,
    `  <CstmrCdtTrfInitn>`,
    `    <GrpHdr>`,
    `      <MsgId>${escapeXml(sepaText(input.messageId, MAX_MSG_ID))}</MsgId>`,
    `      <CreDtTm>${isoDateTime(input.createdAt)}</CreDtTm>`,
    `      <NbOfTxs>${totalCount}</NbOfTxs>`,
    `${groupControlSum}      <InitgPty>`,
    `        <Nm>${debtorName}</Nm>`,
    `      </InitgPty>`,
    `    </GrpHdr>`,
    ...blocks,
    `  </CstmrCdtTrfInitn>`,
    `</Document>`,
    ``,
  ].join("\n");
}
