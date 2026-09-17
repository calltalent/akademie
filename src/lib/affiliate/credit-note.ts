import "server-only";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { MONTSERRAT_BOLD_BASE64, MONTSERRAT_REGULAR_BASE64 } from "@/lib/certificates/fonts/montserrat-data";
import { base64ToUint8Array } from "@/lib/certificates/fonts/decode";
import type { LegalEntity } from "@/lib/legal/company";
import type { AffiliatePayoutMethod, AffiliateTaxMode } from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B8 — DIE GUTSCHRIFT ALS PDF
 * (PLAN_Affiliate-System.md 7.2, 7.3, 7.4; § 14 Abs. 2 und Abs. 4 UStG).
 *
 * ## WAS EINE GUTSCHRIFT IST — UND WER SIE AUSSTELLT
 *
 * Eine Gutschrift im Sinne des § 14 Abs. 2 UStG ist eine Rechnung, die der
 * LEISTUNGSEMPFÄNGER ausstellt. Die Richtung ist also umgekehrt zu allem
 * anderen in diesem Projekt: der Rechtsträger des Mandanten (bzw. der
 * Betreiber als Merchant of Record, 1.3) stellt sie über die Vermittlungs-
 * leistung des PARTNERS aus. Der Partner ist der leistende Unternehmer, und
 * seine Steuernummer bzw. USt-IdNr. gehört auf den Beleg, nicht die des
 * Ausstellers allein.
 *
 * Wer das verwechselt, produziert ein Papier, das zwar aussieht wie eine
 * Gutschrift, aber keine ist — mit der Folge, dass der Vorsteuerabzug daraus
 * versagt wird.
 *
 * ## DIE DATEI IST NICHT DER BELEG
 *
 * Der Beleg sind die eingefrorenen Zahlen auf `affiliate_payouts` (7.2); diese
 * Funktion ist ihre deterministische Darstellung. Deshalb bekommt sie
 * ausschließlich fertige Werte übergeben und rechnet NICHTS nach: kein
 * `subtotal = gross + reversal`, keine Steuer, keine Rundung. Rechnete sie
 * mit, könnte ein Reparaturlauf ein PDF erzeugen, das von seinem eigenen
 * Belegkopf abweicht — und niemand wüsste, welche der beiden Zahlen gilt.
 *
 * ## PDF-LIB, KEINE NEUE ABHÄNGIGKEIT (G16)
 *
 * Gleiche Bauart wie `src/lib/certificates/pdf.ts`: `pdf-lib` in reinem
 * JavaScript (kein natives Modul, Voraussetzung für den Workers-Deploy) mit
 * der dort bereits eingebetteten Montserrat über `@pdf-lib/fontkit`. Die
 * Schrift wird wiederverwendet und nicht ein zweites Mal ins Bundle gelegt.
 *
 * ## BARRIEREFREIHEIT
 *
 * Der Auftraggeber ist stark sehbehindert, und dieser Beleg ist ein Dokument,
 * das er lesen können muss. Deshalb:
 *   - Fließtext 11 pt, Beschriftungen 10 pt, nichts unter 10 pt.
 *   - Zwei Textfarben, beide nach WCAG 2.1 gegen Weiß (#FFFFFF) ausgerechnet:
 *       #1A1A2E → Kontrast 17,06:1  (Fließtext, Beträge, Überschriften)
 *       #66679B → Kontrast  5,28:1  (Beschriftungen, Fußzeile)
 *     Beide liegen über 4,5:1. Die hellen Grautöne des Zertifikats-Designs
 *     werden hier AUSDRÜCKLICH NICHT für Text verwendet: #A9AAC4 kommt auf
 *     2,27:1 und #C9CBE6 auf 1,59:1. #C9CBE6 erscheint nur als Trennlinie —
 *     sie ist reine Zierde und trägt keine Information, die nicht auch im
 *     Text steht, weshalb für sie auch die 3:1-Grenze für grafische Objekte
 *     nicht einschlägig ist.
 *   - Jede Zahl steht ausgeschrieben im Text; es gibt keine Information, die
 *     allein aus einer Position, Farbe oder Einrückung hervorgeht.
 */

// --- Farben und Maße ----------------------------------------------------

const A4_PORTRAIT: [number, number] = [595.28, 841.89];

/** #1A1A2E auf Weiß: Kontrast 17,06:1 (nachgerechnet nach WCAG 2.1, SC 1.4.3). */
const INK = rgb(26 / 255, 26 / 255, 46 / 255);
/** #66679B auf Weiß: Kontrast 5,28:1 — über 4,5:1, nur für Beschriftungen. */
const LABEL = rgb(102 / 255, 103 / 255, 155 / 255);
/** #C9CBE6, Kontrast 1,59:1 — ausschließlich Zierlinie, nie Text, nie Bedeutungsträger. */
const RULE = rgb(201 / 255, 203 / 255, 230 / 255);

const MARGIN = 56;
const LINE = 15;

// --- Textaufbereitung ---------------------------------------------------

/**
 * Kombinierende Akzentzeichen (U+0300 bis U+036F), die nach der NFKD-Zerlegung
 * übrig bleiben. Als `new RegExp(...)` geschrieben statt als Literal, damit im
 * Quelltext keine rohen Kombinationszeichen stehen — sie hängen sich sonst an
 * die eckige Klammer und sind weder lesbar noch zuverlässig editierbar.
 */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * Letztes Sicherheitsnetz gegen ein Zeichen außerhalb des Montserrat-
 * Zeichensatzes (Kyrillisch, CJK, Emoji in einem Firmennamen).
 * `font.widthOfTextAtSize()` würfe dort, und ein geworfener Fehler hieße: der
 * Beleg existiert als Zahlenwerk, aber niemand bekommt ihn zu sehen. Gleiche
 * Funktion und gleiche Begründung wie in `src/lib/certificates/pdf.ts`.
 */
function sanitizeForFont(font: PDFFont, text: string): string {
  const canEncode = (value: string) => {
    try {
      font.widthOfTextAtSize(value, 10);
      return true;
    } catch {
      return false;
    }
  };

  if (canEncode(text)) return text;
  const decomposed = text.normalize("NFKD").replace(COMBINING_MARKS, "");
  if (canEncode(decomposed)) return decomposed;
  return [...decomposed].map((char) => (canEncode(char) ? char : "?")).join("");
}

/**
 * Betrag in deutscher Schreibweise plus ISO-Währungscode („188,60 EUR").
 *
 * Bewusst von Hand statt über `Intl.NumberFormat`: der Workers-Laufzeit fehlt
 * je nach Build die vollständige ICU-Datenbank, und ein Beleg, der je nach
 * Deploy-Ziel „188.60" oder „188,60" schreibt, ist kein Beleg. Der ISO-Code
 * statt eines Symbols, weil derselbe Beleg auch in CHF ausgestellt wird.
 */
export function formatCreditNoteAmount(cents: number, currency: string): string {
  const negative = cents < 0;
  const absolute = Math.abs(Math.trunc(cents));
  const euros = Math.trunc(absolute / 100);
  const rest = String(absolute % 100).padStart(2, "0");
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${rest} ${currency.toUpperCase()}`;
}

/** ISO-Datum `JJJJ-MM-TT` als `TT.MM.JJJJ`; unlesbare Eingabe bleibt stehen. */
export function formatCreditNoteDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return match === null ? isoDate : `${match[3]}.${match[2]}.${match[1]}`;
}

// --- Eingabe ------------------------------------------------------------

/** Der Aussteller: der Rechtsträger des Mandanten (`tenants.legal.entity`, 7.1). */
export type AffiliateCreditNoteIssuer = {
  legalEntity: LegalEntity;
  /** USt-IdNr. des Ausstellers — bei Reverse Charge Pflichtangabe. */
  vatId?: string | null;
};

/** Der Leistende: der Partner. Werte aus `affiliate_billing_profiles` (3.13). */
export type AffiliateCreditNoteRecipient = {
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  vatId?: string | null;
  taxNumber?: string | null;
};

export type AffiliateCreditNoteInput = {
  /** Lückenlose Belegnummer, `GS-<SLUG>-<JAHR>-<6-stellig>` (7.3). */
  documentNo: string;
  issuedAt: Date;
  /** Leistungszeitraum, ISO-Datum `JJJJ-MM-TT`. */
  periodFrom: string;
  periodTo: string;
  currency: string;

  // Die eingefrorenen Zahlen des Belegkopfs. Werden NICHT nachgerechnet.
  grossCents: number;
  /** Summe der Gegenbuchungen, kleiner oder gleich 0. */
  reversalCents: number;
  subtotalCents: number;
  taxMode: AffiliateTaxMode;
  taxRateBp: number;
  taxCents: number;
  totalCents: number;
  /** Pflichthinweis mit festem Wortlaut aus `tax.ts` (7.4). */
  taxHint: string;

  issuer: AffiliateCreditNoteIssuer;
  recipient: AffiliateCreditNoteRecipient;
  /** Anzeigename des Mandanten für die Kopfzeile (White Label). */
  tenantName: string;
  method?: AffiliatePayoutMethod | null;
};

/** Ablagepfad im privaten Bucket — beginnt mit `{tenant_id}/` (CLAUDE.md §2.5). */
export function affiliateCreditNotePath(tenantId: string, payoutId: string): string {
  return `${tenantId}/affiliate/payouts/${payoutId}.pdf`;
}

// --- Zeichenhilfen ------------------------------------------------------

type Writer = {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  y: number;
};

function text(
  writer: Writer,
  value: string,
  options: { x?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {},
): void {
  const font = options.bold === true ? writer.bold : writer.regular;
  writer.page.drawText(sanitizeForFont(font, value), {
    x: options.x ?? MARGIN,
    y: writer.y,
    size: options.size ?? 11,
    font,
    color: options.color ?? INK,
  });
}

/** Rechtsbündig — für Beträge, damit Stellenwerte untereinander stehen. */
function textRight(
  writer: Writer,
  value: string,
  right: number,
  options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {},
): void {
  const font = options.bold === true ? writer.bold : writer.regular;
  const size = options.size ?? 11;
  const safe = sanitizeForFont(font, value);
  writer.page.drawText(safe, {
    x: right - font.widthOfTextAtSize(safe, size),
    y: writer.y,
    size,
    font,
    color: options.color ?? INK,
  });
}

function rule(writer: Writer, width: number): void {
  writer.page.drawRectangle({
    x: MARGIN,
    y: writer.y,
    width,
    height: 0.8,
    color: RULE,
  });
}

// --- Erzeugung ----------------------------------------------------------

/**
 * Erzeugt das Gutschrift-PDF.
 *
 * Die Reihenfolge der Abschnitte folgt § 14 Abs. 4 UStG, damit beim
 * Gegenlesen jede Pflichtangabe an einer festen Stelle steht:
 *
 *   1. das Wort „Gutschrift" (Nr. 10 — ohne dieses Wort ist der Beleg
 *      unwirksam, und kein anderes Wort ersetzt es),
 *   2. Aussteller und Leistender mit vollständiger Anschrift (Nr. 1),
 *   3. Steuernummer bzw. USt-IdNr. des LEISTENDEN, also des Partners (Nr. 2),
 *   4. Ausstellungsdatum (Nr. 3) und fortlaufende Belegnummer (Nr. 4),
 *   5. Art und Umfang der Leistung samt Leistungszeitraum (Nr. 5 und 6),
 *   6. Entgelt, aufgeschlüsselt (Nr. 7), Steuersatz und Steuerbetrag bzw. der
 *      Hinweis auf die Steuerbefreiung (Nr. 8),
 *   7. bei Reverse Charge zusätzlich die USt-IdNr. beider Beteiligten und der
 *      Hinweis auf die Steuerschuldnerschaft (§ 14a Abs. 5 UStG).
 */
export async function generateAffiliateCreditNotePdf(
  input: AffiliateCreditNoteInput,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  // fontkit als Glyph-Parser für eine echte TrueType-Schrift; pdf-lib bringt
  // ihn aus Bundle-Größen-Gründen nicht selbst mit.
  pdfDoc.registerFontkit(fontkit);

  const page = pdfDoc.addPage(A4_PORTRAIT);
  const { width: W, height: H } = page.getSize();
  const contentWidth = W - MARGIN * 2;
  const rightEdge = W - MARGIN;

  const regular = await pdfDoc.embedFont(base64ToUint8Array(MONTSERRAT_REGULAR_BASE64));
  const bold = await pdfDoc.embedFont(base64ToUint8Array(MONTSERRAT_BOLD_BASE64));
  const writer: Writer = { page, regular, bold, y: H - MARGIN };

  pdfDoc.setTitle(`Gutschrift ${input.documentNo}`);
  pdfDoc.setSubject("Provisionsabrechnung (Gutschrift nach § 14 Abs. 2 UStG)");
  // Erzeuger statt Produktname: der Beleg soll bei einer Prüfung erkennen
  // lassen, aus welchem System er stammt.
  pdfDoc.setProducer("Calltalent-Akademie");

  // --- Kopf: Aussteller ---
  text(writer, input.tenantName, { bold: true, size: 13 });
  writer.y -= LINE;
  text(writer, input.issuer.legalEntity.name, { size: 10, color: LABEL });
  for (const line of input.issuer.legalEntity.addressLines) {
    writer.y -= LINE - 2;
    text(writer, line, { size: 10, color: LABEL });
  }
  writer.y -= LINE - 2;
  text(writer, input.issuer.legalEntity.email, { size: 10, color: LABEL });
  if (input.issuer.legalEntity.registrationNumber !== null) {
    writer.y -= LINE - 2;
    text(writer, `Registernummer: ${input.issuer.legalEntity.registrationNumber}`, {
      size: 10,
      color: LABEL,
    });
  }
  if (typeof input.issuer.vatId === "string" && input.issuer.vatId.trim() !== "") {
    writer.y -= LINE - 2;
    text(writer, `USt-IdNr. des Ausstellers: ${input.issuer.vatId}`, { size: 10, color: LABEL });
  }

  // --- Titel: das Wort „Gutschrift" ist Pflichtangabe (§ 14 Abs. 4 Nr. 10) ---
  writer.y -= LINE * 2.5;
  text(writer, "Gutschrift", { bold: true, size: 24 });
  writer.y -= LINE + 4;
  rule(writer, contentWidth);

  // --- Belegdaten ---
  writer.y -= LINE + 6;
  text(writer, "Belegnummer", { size: 10, color: LABEL });
  textRight(writer, input.documentNo, rightEdge, { bold: true });
  writer.y -= LINE;
  text(writer, "Ausstellungsdatum", { size: 10, color: LABEL });
  textRight(writer, formatCreditNoteDate(input.issuedAt.toISOString().slice(0, 10)), rightEdge);
  writer.y -= LINE;
  text(writer, "Leistungszeitraum", { size: 10, color: LABEL });
  textRight(
    writer,
    `${formatCreditNoteDate(input.periodFrom)} bis ${formatCreditNoteDate(input.periodTo)}`,
    rightEdge,
  );

  // --- Leistender (der Partner) ---
  writer.y -= LINE * 2;
  text(writer, "Leistender Unternehmer (Empfänger dieser Gutschrift)", {
    bold: true,
    size: 12,
  });
  writer.y -= LINE + 2;
  text(writer, input.recipient.legalName);
  writer.y -= LINE;
  text(writer, input.recipient.street);
  writer.y -= LINE;
  text(writer, `${input.recipient.postalCode} ${input.recipient.city}`);
  writer.y -= LINE;
  text(writer, input.recipient.country);

  // § 14 Abs. 4 Nr. 2: Steuernummer ODER USt-IdNr. des LEISTENDEN. Die
  // USt-IdNr. hat Vorrang, weil sie bei Reverse Charge ohnehin Pflicht ist.
  const recipientTaxId =
    typeof input.recipient.vatId === "string" && input.recipient.vatId.trim() !== ""
      ? { label: "USt-IdNr.", value: input.recipient.vatId }
      : typeof input.recipient.taxNumber === "string" && input.recipient.taxNumber.trim() !== ""
        ? { label: "Steuernummer", value: input.recipient.taxNumber }
        : null;
  if (recipientTaxId !== null) {
    writer.y -= LINE;
    text(writer, `${recipientTaxId.label}: ${recipientTaxId.value}`);
  }

  // --- Leistungsbeschreibung ---
  writer.y -= LINE * 2;
  text(writer, "Abrechnung", { bold: true, size: 12 });
  writer.y -= LINE + 4;
  rule(writer, contentWidth);

  writer.y -= LINE + 6;
  text(
    writer,
    `Vermittlungsleistung (Partnerprogramm) im Zeitraum ${formatCreditNoteDate(
      input.periodFrom,
    )} bis ${formatCreditNoteDate(input.periodTo)}`,
  );

  writer.y -= LINE + 6;
  text(writer, "Provisionen", { size: 10, color: LABEL });
  textRight(writer, formatCreditNoteAmount(input.grossCents, input.currency), rightEdge);

  // Die Gegenbuchungen stehen als eigene Zeile und nicht saldiert: ein Partner
  // muss sehen, dass und wie viel storniert wurde — sonst ist die Differenz
  // zum erwarteten Betrag unerklärlich.
  if (input.reversalCents !== 0) {
    writer.y -= LINE;
    text(writer, "Stornierungen und Rückbuchungen", { size: 10, color: LABEL });
    textRight(writer, formatCreditNoteAmount(input.reversalCents, input.currency), rightEdge);
  }

  writer.y -= LINE + 4;
  rule(writer, contentWidth);
  writer.y -= LINE + 6;
  text(writer, "Entgelt (netto)", { bold: true });
  textRight(writer, formatCreditNoteAmount(input.subtotalCents, input.currency), rightEdge, {
    bold: true,
  });

  writer.y -= LINE;
  if (input.taxMode === "regular") {
    const rate = `${(input.taxRateBp / 100).toFixed(2).replace(".", ",")} %`;
    text(writer, `Umsatzsteuer ${rate}`, { size: 10, color: LABEL });
    textRight(writer, formatCreditNoteAmount(input.taxCents, input.currency), rightEdge);
  } else {
    // Kein Steuerausweis — und genau das muss dastehen. Eine leere Zeile wäre
    // hier eine fehlende Pflichtangabe (§ 14 Abs. 4 Nr. 8).
    text(writer, "Umsatzsteuer", { size: 10, color: LABEL });
    textRight(writer, `nicht ausgewiesen (${formatCreditNoteAmount(0, input.currency)})`, rightEdge);
  }

  writer.y -= LINE + 4;
  rule(writer, contentWidth);
  writer.y -= LINE + 6;
  text(writer, "Auszahlungsbetrag", { bold: true, size: 13 });
  textRight(writer, formatCreditNoteAmount(input.totalCents, input.currency), rightEdge, {
    bold: true,
    size: 13,
  });

  // --- Pflichthinweis zum Steuermodus (7.4) ---
  writer.y -= LINE * 2;
  for (const line of wrap(regular, input.taxHint, 11, contentWidth)) {
    text(writer, line);
    writer.y -= LINE;
  }

  if (input.taxMode === "reverse_charge") {
    // § 14a Abs. 5 UStG: beide USt-IdNr. gehören auf den Beleg. Fehlt eine,
    // ist der Reverse Charge formal nicht belegt.
    writer.y -= 2;
    text(
      writer,
      `USt-IdNr. Aussteller: ${input.issuer.vatId ?? "—"} · USt-IdNr. Leistender: ${
        input.recipient.vatId ?? "—"
      }`,
      { size: 10, color: LABEL },
    );
    writer.y -= LINE;
  }

  writer.y -= LINE;
  text(
    writer,
    "Diese Gutschrift wurde vom Leistungsempfänger ausgestellt (§ 14 Abs. 2 Satz 2 UStG).",
    { size: 10, color: LABEL },
  );

  if (input.method !== null && input.method !== undefined) {
    writer.y -= LINE;
    text(writer, `Auszahlung per ${payoutMethodLabel(input.method)}.`, { size: 10, color: LABEL });
  }

  // --- Fußzeile ---
  writer.y = MARGIN;
  text(writer, `${input.tenantName} · Beleg ${input.documentNo}`, { size: 10, color: LABEL });

  return pdfDoc.save();
}

/** Deutsche Bezeichnung des Zahlwegs; Belegtext, deshalb nicht übersetzt. */
function payoutMethodLabel(method: AffiliatePayoutMethod): string {
  if (method === "sepa") return "SEPA-Überweisung";
  if (method === "paypal") return "PayPal";
  return "manuelle Überweisung";
}

/**
 * Zeilenumbruch an Wortgrenzen. Ein einzelnes Wort, das breiter ist als die
 * Spalte, bleibt stehen und läuft über — in diesem Dokument kann das nur eine
 * überlange USt-IdNr. sein, und die abzuschneiden wäre schlimmer als ein
 * Überstand.
 */
function wrap(font: PDFFont, value: string, size: number, maxWidth: number): string[] {
  const words = sanitizeForFont(font, value).split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    current = word;
  }
  if (current !== "") lines.push(current);
  return lines.length === 0 ? [""] : lines;
}
