import "server-only";
import { PDFDocument, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { safeAccentColor } from "@/lib/email/templates";
import { MONTSERRAT_REGULAR_BASE64, MONTSERRAT_BOLD_BASE64 } from "./fonts/montserrat-data";
import { base64ToUint8Array } from "./fonts/decode";

/**
 * Erzeugt das Zertifikats-PDF mit `pdf-lib` (reines JavaScript, keine
 * native/Node-spezifische Abhängigkeit — wichtig für den Cloudflare-
 * Workers-Deploy via OpenNext, siehe CLAUDE.md §1.7). A4 Querformat.
 *
 * Design-Import (22.07.2026, Josips Auftrag: Claude-Design-Projekt
 * "Calltalent-Akademie Studenten-Portal", Datei `Zertifikat.dc.html`, via
 * DesignSync-MCP geholt). Layout/Farben/Ikonografie sind bewusst NACH-
 * gebaut, keine 1:1-Pixelübernahme: das Design ist HTML/CSS (Montserrat-
 * Webfont, Prozent-Insets relativ zu einer 1400×1080-Vorschau-Leinwand),
 * dieser Code hat keine CSS-Engine und keinen Headless-Browser zur
 * Verfügung (genau der Grund, warum das Projekt überhaupt bei `pdf-lib`
 * geblieben ist). Übernommen: Doppelrahmen + vier Eck-Klammern, das
 * Marken-Lockup (Quadrat-Logomarke + Wortmarke, analog `BrandLogo`,
 * src/components/shell/brand-logo.tsx — hier aber mit dem ECHTEN
 * Mandantennamen statt "CALLTALENT" fest zu verdrahten, weiß-label-Fall
 * beachten), Eyebrow/Titel/Divider-Raute/Namen/Kurstitel-Hierarchie, die
 * Fußzeile mit rundem Haken-Abzeichen zwischen Datum und Seriennummer.
 * Schrift: die Google-Font "Montserrat" (Regular + Bold, SIL Open Font
 * License, siehe `fonts/OFL.txt`) genau wie im Design — ursprünglich nicht
 * eingebettet (Helvetica-Fallback), seit dem Diakritika-Fix vom 01.08.2026
 * aber schon (siehe `sanitizeForFont()`-Kommentar unten: der eigentliche
 * Auslöser war, dass Helvetica/WinAnsi bosnische/kroatische Sonderzeichen
 * wie č/ć/š/ž/đ lautlos verschluckt hat). Die Rohdaten liegen als
 * `fonts/Montserrat-Regular.ttf` / `fonts/Montserrat-Bold.ttf` im Repo,
 * base64-kodiert re-exportiert über `fonts/montserrat-data.ts`
 * (generiert von `scripts/build-certificate-fonts.mjs` — dort auch die
 * Begründung, warum kein `fs.readFileSync()` zur Laufzeit).
 *
 * Nachsync (22.07.2026, gleicher Tag): Josip hat `Zertifikat.dc.html` im
 * Editor überarbeitet, bevor der erste Import überhaupt gesichtet werden
 * konnte — Eyebrow jetzt größer/fett, Titel kleiner (fester Wert statt
 * responsiv bis 46px), Name deutlich kleiner (fester Wert statt responsiv bis
 * 50px) und Kurstitel größer (jetzt genauso groß wie der Titel). Das DREHT
 * die bisherige Hierarchie um: der Name war zuvor das größte Element, jetzt
 * sind Titel und Kurstitel die größten, der Name ist das kleinste der drei —
 * unverändert nachvollzogen, nicht als Fehler im Design behandelt.
 */

const A4_LANDSCAPE: [number, number] = [841.89, 595.28];

// Feste, nicht mandantenabhängige Töne aus dem Design (nur die Akzentfarbe
// selbst kommt aus `tenant.branding.color_primary`, siehe `accent` unten).
const DARK = rgb(26 / 255, 26 / 255, 46 / 255); // #1A1A2E
const NAVY = rgb(62 / 255, 63 / 255, 102 / 255); // #3E3F66
const GRAY_TEXT = rgb(102 / 255, 103 / 255, 155 / 255); // #66679B
const GRAY_LIGHT = rgb(169 / 255, 170 / 255, 196 / 255); // #A9AAC4
const GRAY_LABEL = rgb(134 / 255, 136 / 255, 184 / 255); // #8688B8
const BORDER_INNER = rgb(201 / 255, 203 / 255, 230 / 255); // #C9CBE6
const DIVIDER = rgb(238 / 255, 240 / 255, 247 / 255); // #EEF0F7
const CREAM = rgb(247 / 255, 238 / 255, 212 / 255); // #F7EED4

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Letztes Sicherheitsnetz, nicht mehr die primäre Verteidigungslinie: seit
 * dem Diakritika-Fix vom 01.08.2026 ist Montserrat (Unicode/CFF, via
 * `@pdf-lib/fontkit` eingebettet) die tatsächliche Schrift — bosnische/
 * kroatische Zeichen (č, ć, š, ž, đ) werden jetzt korrekt dargestellt statt
 * (wie zuvor mit dem WinAnsi-only Helvetica-Fallback) lautlos auf die
 * Basisform ohne Diakritikum reduziert. Diese Funktion bleibt trotzdem
 * bestehen: Montserrats Zeichensatz deckt zwar Latin Extended-A/B ab, aber
 * nicht jedes denkbare Unicode-Zeichen (z. B. Kyrillisch, CJK, Emoji) — für
 * den (nun sehr seltenen) Fall eines Zeichens außerhalb dieses Zeichensatzes
 * würde `font.widthOfTextAtSize()` sonst werfen. `issueCertificateIfEligible()`
 * fängt das zwar ohnehin fail-soft ab (die Lektion bleibt korrekt
 * abgeschlossen), aber der Lernende bekäme dann STILLSCHWEIGEND nie ein
 * Zertifikat. Fällt ein Zeichen aus der Schrift heraus, wird zuerst die
 * unicode-zerlegte Basisform ohne Diakritikum probiert (im Montserrat-Fall
 * praktisch nie nötig), erst als letzter Ausweg "?" statt Absturz.
 */
function sanitizeForFont(font: PDFFont, text: string): string {
  const canEncode = (s: string) => {
    try {
      font.widthOfTextAtSize(s, 10);
      return true;
    } catch {
      return false;
    }
  };
  return [...text]
    .map((ch) => {
      if (canEncode(ch)) return ch;
      // Kombinierende diakritische Zeichen (U+0300–U+036F), z. B. der Caron in č.
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (base && canEncode(base)) return base;
      return "?";
    })
    .join("");
}

/** Hex ("#rrggbb" oder "#rgb") -> pdf-lib RGB (0..1). Farbwert wurde bereits über safeAccentColor validiert. */
function hexToPdfRgb(hex: string) {
  let h = hex.slice(1);
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(h, 16);
  return rgb(((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255);
}

/** Verkleinert die Schriftgröße schrittweise, bis der Text in `maxWidth` passt (Ersatz für CSS `clamp()`/Zeilenumbruch-Vermeidung). */
function fitSize(font: PDFFont, text: string, maxWidth: number, startSize: number, minSize: number): number {
  let size = startSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 1;
  return size;
}

function centerText(
  page: PDFPage,
  text: string,
  centerX: number,
  y: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
) {
  const textWidth = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: centerX - textWidth / 2, y, size, font, color });
}

/** Buchstaben-Sperrung (CSS `letter-spacing`) — pdf-lib kennt kein Tracking, deshalb Zeichen einzeln mit Zusatzabstand gesetzt. */
function trackedWidth(font: PDFFont, text: string, size: number, tracking: number): number {
  const chars = [...text];
  const glyphs = chars.reduce((sum, c) => sum + font.widthOfTextAtSize(c, size), 0);
  return glyphs + tracking * Math.max(0, chars.length - 1);
}

function drawTrackedTextCentered(
  page: PDFPage,
  text: string,
  centerX: number,
  y: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  tracking: number,
) {
  const chars = [...text];
  let x = centerX - trackedWidth(font, text, size, tracking) / 2;
  for (const c of chars) {
    page.drawText(c, { x, y, size, font, color });
    x += font.widthOfTextAtSize(c, size) + tracking;
  }
}

export type GenerateCertificatePdfInput = {
  tenantName: string;
  courseTitle: string;
  recipientName: string;
  issuedAt: Date;
  serial: string;
  /** Akzentfarbe aus tenant.branding.color_primary; ungültig/fehlend -> neutraler Fallback (safeAccentColor). */
  accentColor?: string;
};

export async function generateCertificatePdf({
  tenantName,
  courseTitle,
  recipientName,
  issuedAt,
  serial,
  accentColor,
}: GenerateCertificatePdfInput): Promise<Uint8Array> {
  const accent = hexToPdfRgb(safeAccentColor(accentColor));

  const pdfDoc = await PDFDocument.create();
  // `embedFont()` mit einer echten TrueType-Schrift (statt einer der 14
  // eingebauten StandardFonts) braucht fontkit als Glyph-Parser/Subsetter —
  // pdf-lib bringt das aus Bundle-Größen-Gründen nicht selbst mit.
  pdfDoc.registerFontkit(fontkit);
  const page = pdfDoc.addPage(A4_LANDSCAPE);
  const { width: W, height: H } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(base64ToUint8Array(MONTSERRAT_REGULAR_BASE64));
  const fontBold = await pdfDoc.embedFont(base64ToUint8Array(MONTSERRAT_BOLD_BASE64));

  // Dynamische, nicht selbst verfasste Werte (Nutzername, Kurstitel,
  // Mandantenname) gegen die WinAnsi-Lücke absichern — siehe sanitizeForFont().
  const safeTenantName = sanitizeForFont(fontBold, tenantName);
  const safeCourseTitle = sanitizeForFont(fontBold, courseTitle);
  const safeRecipientName = sanitizeForFont(fontBold, recipientName);

  const centerX = W / 2;

  // --- Doppelrahmen (5,2 % / 6 % Inset, wie im Design) ---
  const insetX1 = W * 0.052;
  const insetY1 = H * 0.052;
  page.drawRectangle({
    x: insetX1,
    y: insetY1,
    width: W - insetX1 * 2,
    height: H - insetY1 * 2,
    borderColor: NAVY,
    borderWidth: 1,
  });

  const insetX2 = W * 0.06;
  const insetY2 = H * 0.06;
  page.drawRectangle({
    x: insetX2,
    y: insetY2,
    width: W - insetX2 * 2,
    height: H - insetY2 * 2,
    borderColor: BORDER_INNER,
    borderWidth: 1,
  });

  // --- Vier Eck-Klammern (L-Form, Akzentfarbe) ---
  const bracket = 30;
  const bracketThickness = 2;
  const drawBracket = (corner: "tl" | "tr" | "bl" | "br") => {
    const top = H - insetY2;
    const bottom = insetY2;
    const left = insetX2;
    const right = W - insetX2;
    if (corner === "tl") {
      page.drawLine({ start: { x: left, y: top }, end: { x: left + bracket, y: top }, thickness: bracketThickness, color: accent });
      page.drawLine({ start: { x: left, y: top }, end: { x: left, y: top - bracket }, thickness: bracketThickness, color: accent });
    } else if (corner === "tr") {
      page.drawLine({ start: { x: right - bracket, y: top }, end: { x: right, y: top }, thickness: bracketThickness, color: accent });
      page.drawLine({ start: { x: right, y: top }, end: { x: right, y: top - bracket }, thickness: bracketThickness, color: accent });
    } else if (corner === "bl") {
      page.drawLine({ start: { x: left, y: bottom }, end: { x: left + bracket, y: bottom }, thickness: bracketThickness, color: accent });
      page.drawLine({ start: { x: left, y: bottom }, end: { x: left, y: bottom + bracket }, thickness: bracketThickness, color: accent });
    } else {
      page.drawLine({ start: { x: right - bracket, y: bottom }, end: { x: right, y: bottom }, thickness: bracketThickness, color: accent });
      page.drawLine({ start: { x: right, y: bottom }, end: { x: right, y: bottom + bracket }, thickness: bracketThickness, color: accent });
    }
  };
  drawBracket("tl");
  drawBracket("tr");
  drawBracket("bl");
  drawBracket("br");

  const maxTextWidth = W * 0.62;

  // --- Marken-Lockup: Quadrat-Logomarke (Initiale, Akzentfarbe) + Wortmarke (echter Mandantenname, kein "CALLTALENT" fest verdrahtet) ---
  const squareSize = 34;
  const squareTop = 500;
  const cleanTenantName = safeTenantName.trim() || "Akademie";
  const initial = cleanTenantName[0]?.toUpperCase() ?? "?";
  const wordmark = truncate(cleanTenantName, 28).toUpperCase();
  const sublabel = "AKADEMIE";
  const wordmarkSize = 14;
  const sublabelSize = 9;
  const sublabelTracking = sublabelSize * 0.3;
  const textBlockWidth = Math.max(
    fontBold.widthOfTextAtSize(wordmark, wordmarkSize),
    trackedWidth(fontBold, sublabel, sublabelSize, sublabelTracking),
  );
  const gapSquareText = 12;
  const rowWidth = squareSize + gapSquareText + textBlockWidth;
  const squareX = centerX - rowWidth / 2;
  const textBlockX = squareX + squareSize + gapSquareText;

  page.drawRectangle({ x: squareX, y: squareTop - squareSize, width: squareSize, height: squareSize, color: accent });
  const initialSize = 17;
  const initialWidth = fontBold.widthOfTextAtSize(initial, initialSize);
  page.drawText(initial, {
    x: squareX + squareSize / 2 - initialWidth / 2,
    y: squareTop - squareSize / 2 - initialSize / 2 + 2,
    size: initialSize,
    font: fontBold,
    color: CREAM,
  });
  page.drawText(wordmark, { x: textBlockX, y: squareTop - 14, size: wordmarkSize, font: fontBold, color: NAVY });
  let sx = textBlockX;
  for (const c of sublabel) {
    page.drawText(c, { x: sx, y: squareTop - 29, size: sublabelSize, font: fontBold, color: GRAY_LABEL });
    sx += fontBold.widthOfTextAtSize(c, sublabelSize) + sublabelTracking;
  }

  // --- Eyebrow (Design-Update 22.07.2026: jetzt fett + größer, 11px -> 15px) ---
  drawTrackedTextCentered(page, "TEILNAHMEZERTIFIKAT", centerX, 440, fontBold, 12, GRAY_LABEL, 12 * 0.18);

  // --- Titel (Design-Update: fester Wert 30px statt bisher responsiv bis 46px -> zurückhaltender) ---
  centerText(page, "Zertifikat des Abschlusses", centerX, 405, fontBold, 27, DARK);

  // --- Trenner (Strich – Raute – Strich) ---
  const dividerY = 383;
  const dashLen = 30;
  const diamondSize = 6;
  page.drawLine({ start: { x: centerX - dashLen - diamondSize, y: dividerY }, end: { x: centerX - diamondSize, y: dividerY }, thickness: 1, color: BORDER_INNER });
  page.drawLine({ start: { x: centerX + diamondSize, y: dividerY }, end: { x: centerX + dashLen + diamondSize, y: dividerY }, thickness: 1, color: BORDER_INNER });
  // pdf-lib rotiert `drawRectangle` um den Ursprungspunkt (x,y) selbst, nicht
  // um die Mitte des Rechtecks — (x,y) bleibt nach der Rotation fix, der
  // Flächenschwerpunkt wandert dabei um (0, diamondSize/√2) nach oben (bei
  // 45°). Deshalb y um genau diesen Betrag nach unten vorverlegt, damit die
  // fertig gedrehte Raute exakt auf (centerX, dividerY) zentriert landet.
  page.drawRectangle({
    x: centerX,
    y: dividerY - diamondSize / Math.SQRT2,
    width: diamondSize,
    height: diamondSize,
    color: accent,
    rotate: degrees(45),
  });

  // --- "verliehen an" ---
  centerText(page, "verliehen an", centerX, 360, fontRegular, 13, GRAY_TEXT);

  // --- Name (Empfänger:in) — Design-Update: fester Wert 25px statt bisher
  // responsiv bis 50px. Dreht die vorherige Hierarchie um: der Name ist jetzt
  // das KLEINSTE der drei Kopfelemente (Titel/Name/Kurstitel), nicht mehr das
  // größte — bewusst so übernommen, nicht als Fehler behandelt. ---
  const nameText = truncate(safeRecipientName, 55);
  const nameSize = fitSize(fontBold, nameText, maxTextWidth, 24, 16);
  centerText(page, nameText, centerX, 320, fontBold, nameSize, NAVY);

  // --- Unterstrich ---
  const underlineWidth = Math.min(300, maxTextWidth * 0.55);
  page.drawRectangle({ x: centerX - underlineWidth / 2, y: 305, width: underlineWidth, height: 2, color: accent });

  // --- "für den erfolgreichen Abschluss des Kurses" ---
  centerText(page, "für den erfolgreichen Abschluss des Kurses", centerX, 282, fontRegular, 13, GRAY_TEXT);

  // --- Kurstitel — Design-Update: fester Wert 30px statt bisher responsiv bis
  // 28px, jetzt genauso groß wie der Titel oben (statt kleiner). ---
  const courseText = truncate(safeCourseTitle, 65);
  const courseSize = fitSize(fontBold, courseText, maxTextWidth, 27, 18);
  centerText(page, courseText, centerX, 250, fontBold, courseSize, accent);

  // --- Fußzeile: Trennlinie + Datum / Haken-Abzeichen / Seriennummer ---
  const footerDividerY = 110;
  page.drawLine({
    start: { x: insetX2 + 40, y: footerDividerY },
    end: { x: W - insetX2 - 40, y: footerDividerY },
    thickness: 1,
    color: DIVIDER,
  });

  const dateLabel = issuedAt.toLocaleDateString("de-DE", { year: "numeric", month: "long", day: "numeric" });
  const footerValueY = 90;
  const footerLabelY = 76;
  const footerLabelSize = 9;
  const footerLabelTracking = footerLabelSize * 0.08;
  const footerLeftX = insetX2 + 46;
  const footerRightEdgeX = W - insetX2 - 46;

  page.drawText(dateLabel, { x: footerLeftX, y: footerValueY, size: 13, font: fontBold, color: NAVY });
  let lx = footerLeftX;
  for (const c of "AUSSTELLUNGSDATUM") {
    page.drawText(c, { x: lx, y: footerLabelY, size: footerLabelSize, font: fontRegular, color: GRAY_LIGHT });
    lx += fontRegular.widthOfTextAtSize(c, footerLabelSize) + footerLabelTracking;
  }

  // `serial` trägt das Präfix bereits ("CT-<Jahr>-<Code>", siehe serial.ts) — kein weiteres Voranstellen nötig.
  const serialWidth = fontBold.widthOfTextAtSize(serial, 13);
  page.drawText(serial, { x: footerRightEdgeX - serialWidth, y: footerValueY, size: 13, font: fontBold, color: NAVY });
  const serialLabelWidth = trackedWidth(fontRegular, "SERIENNUMMER", footerLabelSize, footerLabelTracking);
  let rx = footerRightEdgeX - serialLabelWidth;
  for (const c of "SERIENNUMMER") {
    page.drawText(c, { x: rx, y: footerLabelY, size: footerLabelSize, font: fontRegular, color: GRAY_LIGHT });
    rx += fontRegular.widthOfTextAtSize(c, footerLabelSize) + footerLabelTracking;
  }

  // Rundes Haken-Abzeichen zwischen den beiden Fußzeilen-Spalten.
  const badgeRadius = 24;
  const badgeCenterY = 100;
  page.drawEllipse({ x: centerX, y: badgeCenterY, xScale: badgeRadius, yScale: badgeRadius, borderColor: accent, borderWidth: 2 });
  // Haken-Icon (SVG-Pfad "M20 6 9 17l-5-5" aus dem Design, 24×24-Viewbox) als zwei Linien nachgebaut —
  // vermeidet die Koordinaten-Unsicherheit von drawSvgPath (SVG y-down vs. PDF y-up).
  const s = 26 / 24;
  const p1 = { x: centerX + 8 * s, y: badgeCenterY + 6 * s };
  const p2 = { x: centerX - 3 * s, y: badgeCenterY - 5 * s };
  const p3 = { x: centerX - 8 * s, y: badgeCenterY + 0 * s };
  page.drawLine({ start: p1, end: p2, thickness: 2.4, color: accent });
  page.drawLine({ start: p2, end: p3, thickness: 2.4, color: accent });

  return pdfDoc.save();
}
