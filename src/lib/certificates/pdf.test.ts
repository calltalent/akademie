import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { MONTSERRAT_BOLD_BASE64 } from "@/lib/certificates/fonts/montserrat-data";
import { base64ToUint8Array } from "@/lib/certificates/fonts/decode";

/**
 * `pdf.ts` selbst hat `import "server-only"` (wie z. B. auch `issue.ts`,
 * siehe Kommentar in `issue.test.ts`) — unter Vitest/Vite lässt sich dieser
 * bloße Spezifizierer nicht auflösen (`server-only` ist kein echtes
 * installiertes npm-Paket, Next.js biegt ihn nur beim eigenen
 * Build/Dev-Server intern um). `generateCertificatePdf()` kann deshalb hier
 * NICHT direkt aufgerufen werden — das ist ein bestehendes, von diesem Fix
 * unabhängiges Test-Infrastruktur-Thema, siehe PHASENSTATUS.md.
 *
 * Stattdessen wird hier genau der Mechanismus geprüft, den `pdf.ts` nutzt:
 * dieselben base64-Font-Rohdaten, dieselbe `base64ToUint8Array()`-Dekodierung,
 * derselbe fontkit-Registrierungsschritt, dasselbe `embedFont()`. Das ist der
 * eigentliche Regressionstest für den Diakritika-Fix vom 01.08.2026 (siehe
 * Dateikopf-/Funktionskommentare in `pdf.ts`): Vor dem Fix
 * (`StandardFonts.HelveticaBold`, WinAnsi-only) wäre `widthOfTextAtSize()`
 * für č/ć/š/ž/đ in `sanitizeForFont()`s Fallback gelaufen (Basisform ohne
 * Diakritikum bzw. "?"). Mit der eingebetteten Montserrat-Bold-Schrift
 * (Unicode/CFF) müssen diese Zeichen direkt und ohne Exception auflösbar
 * sein.
 */
describe("Montserrat-Bold-Einbettung kennt bosnische/kroatische Diakritika", () => {
  it("berechnet widthOfTextAtSize() für č, ć, š, ž, đ ohne Fallback/Exception", async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const fontBold = await pdfDoc.embedFont(base64ToUint8Array(MONTSERRAT_BOLD_BASE64));

    for (const ch of ["č", "ć", "š", "ž", "đ", "Č", "Ć", "Š", "Ž", "Đ"]) {
      expect(() => fontBold.widthOfTextAtSize(ch, 10)).not.toThrow();
      expect(fontBold.widthOfTextAtSize(ch, 10)).toBeGreaterThan(0);
    }
  });

  it("berechnet widthOfTextAtSize() für einen vollständigen Namen mit Diakritika (Josipović Ćurić) ohne Exception", async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const fontBold = await pdfDoc.embedFont(base64ToUint8Array(MONTSERRAT_BOLD_BASE64));

    const name = "Josipović Ćurić";
    expect(() => fontBold.widthOfTextAtSize(name, 24)).not.toThrow();
    expect(fontBold.widthOfTextAtSize(name, 24)).toBeGreaterThan(0);
  });
});
