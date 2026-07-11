import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { safeAccentColor } from "@/lib/email/templates";

/**
 * Erzeugt das Zertifikats-PDF mit `pdf-lib` (reines JavaScript, keine
 * native/Node-spezifische Abhängigkeit — wichtig für den Cloudflare-
 * Workers-Deploy via OpenNext, siehe CLAUDE.md §1.7). A4 Querformat,
 * ein Standard-Layout in Phase 2 (SPEC 9.3: "ein Standard-Template",
 * mandantenfähig ausschließlich über die Branding-Akzentfarbe — kein
 * Logo-Bild in v1, siehe PHASENSTATUS.md).
 *
 * Alle eingebetteten Texte laufen über die pdf-lib-Text-API (kein HTML/
 * Markup-Rendering) — kein Injection-Vektor. Trotzdem Längen-Begrenzung
 * (truncate) als Sanity-Check, damit sehr lange Namen/Titel das simple
 * Layout nicht sprengen (kein automatischer Zeilenumbruch in v1).
 */

const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const NEUTRAL_DARK = rgb(0.09, 0.09, 0.09);
const NEUTRAL_GRAY = rgb(0.4, 0.4, 0.4);

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
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
  const page = pdfDoc.addPage(A4_LANDSCAPE);
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 28;
  page.drawRectangle({
    x: margin,
    y: margin,
    width: width - margin * 2,
    height: height - margin * 2,
    borderColor: accent,
    borderWidth: 3,
  });

  const centerText = (
    text: string,
    y: number,
    font: typeof fontRegular,
    size: number,
    color: ReturnType<typeof rgb>,
  ) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
  };

  centerText(truncate(tenantName, 60), height - 110, fontBold, 16, accent);
  centerText("Teilnahmezertifikat", height - 170, fontBold, 30, NEUTRAL_DARK);
  centerText("verliehen an", height - 225, fontRegular, 14, NEUTRAL_GRAY);
  centerText(truncate(recipientName, 55), height - 268, fontBold, 24, NEUTRAL_DARK);
  centerText("für den erfolgreichen Abschluss des Kurses", height - 318, fontRegular, 14, NEUTRAL_GRAY);
  centerText(truncate(courseTitle, 65), height - 352, fontBold, 18, accent);

  const dateLabel = issuedAt.toLocaleDateString("de-DE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  centerText(`Ausgestellt am ${dateLabel}`, 108, fontRegular, 11, NEUTRAL_GRAY);
  centerText(`Seriennummer: ${serial}`, 88, fontRegular, 10, NEUTRAL_GRAY);

  return pdfDoc.save();
}
