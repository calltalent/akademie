import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  validateGeneratorUpload,
  truncateExtractedText,
  extractTextFromPdf,
  MAX_GENERATOR_FILE_SIZE_BYTES,
  MAX_EXTRACTED_CHARS,
} from "./extract";

/** Erzeugt ein echtes, minimales PDF mit den uebergebenen Zeilen. */
async function buildPdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 400]);
  lines.forEach((line, index) => {
    page.drawText(line, { x: 50, y: 320 - index * 30, size: 14, font });
  });
  return doc.save();
}

/** Erzeugt ein PDF mit einer Seite je uebergebener Zeile. */
async function buildMultiPagePdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of lines) {
    doc.addPage([400, 200]).drawText(line, { x: 40, y: 120, size: 14, font });
  }
  return doc.save();
}

describe("validateGeneratorUpload", () => {
  it("akzeptiert eine gültige PDF-Datei", () => {
    const result = validateGeneratorUpload({ type: "application/pdf", size: 1024 });
    expect(result.ok).toBe(true);
  });

  it("lehnt einen falschen MIME-Typ ab", () => {
    const result = validateGeneratorUpload({ type: "image/png", size: 1024 });
    expect(result.ok).toBe(false);
  });

  it("lehnt eine leere Datei ab", () => {
    const result = validateGeneratorUpload({ type: "application/pdf", size: 0 });
    expect(result.ok).toBe(false);
  });

  it("lehnt eine zu große Datei ab", () => {
    const result = validateGeneratorUpload({
      type: "application/pdf",
      size: MAX_GENERATOR_FILE_SIZE_BYTES + 1,
    });
    expect(result.ok).toBe(false);
  });

  it("akzeptiert eine Datei genau an der Größengrenze", () => {
    const result = validateGeneratorUpload({
      type: "application/pdf",
      size: MAX_GENERATOR_FILE_SIZE_BYTES,
    });
    expect(result.ok).toBe(true);
  });
});

describe("truncateExtractedText", () => {
  it("lässt kurzen Text unverändert", () => {
    const result = truncateExtractedText("Kurzer Text.");
    expect(result).toEqual({ text: "Kurzer Text.", truncated: false });
  });

  it("trimmt umgebenden Whitespace", () => {
    const result = truncateExtractedText("  Text mit Rand.  ");
    expect(result.text).toBe("Text mit Rand.");
  });

  it("kürzt Text genau an der Grenze nicht", () => {
    const text = "a".repeat(100);
    const result = truncateExtractedText(text, 100);
    expect(result).toEqual({ text, truncated: false });
  });

  it("kürzt zu langen Text und meldet truncated:true", () => {
    const text = "a".repeat(101);
    const result = truncateExtractedText(text, 100);
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(100);
  });

  it("verwendet MAX_EXTRACTED_CHARS als Default", () => {
    const text = "a".repeat(MAX_EXTRACTED_CHARS + 1);
    const result = truncateExtractedText(text);
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(MAX_EXTRACTED_CHARS);
  });
});

/**
 * Regressionsschutz fuer den Sprung unpdf 0.12.2 auf 1.8.1 (09.09.2026).
 * Der Wechsel war noetig, weil 0.12.x ueber die optionale Abhaengigkeit
 * `canvas` an `@mapbox/node-pre-gyp` und damit an `tar` haengt (kritische
 * Meldung im npm-Audit); 1.x nutzt stattdessen `@napi-rs/canvas` ohne diese
 * Kette. `extractTextFromPdf` hatte bis dahin keinen Test, obwohl es die
 * einzige Stelle ist, die den unpdf-Vertrag benutzt.
 */
describe("extractTextFromPdf", () => {
  it("liest den Text eines echten PDF aus", async () => {
    const bytes = await buildPdf([
      "Calltalent Akademie Testtext",
      "Zweite Zeile",
    ]);
    const result = await extractTextFromPdf(bytes);
    expect(result.text).toContain("Calltalent Akademie Testtext");
    expect(result.text).toContain("Zweite Zeile");
    expect(result.truncated).toBe(false);
  });

  it("fuehrt mehrere Seiten zu einem Text zusammen", async () => {
    const bytes = await buildMultiPagePdf(["Seite eins", "Seite zwei"]);
    const result = await extractTextFromPdf(bytes);
    expect(result.text).toContain("Seite eins");
    expect(result.text).toContain("Seite zwei");
  });

  it("wirft bei einem PDF ohne Textlayer", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const bytes = await doc.save();
    await expect(extractTextFromPdf(bytes)).rejects.toThrow(/kein Text/);
  });
});
