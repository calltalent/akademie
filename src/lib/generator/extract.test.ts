import { describe, expect, it } from "vitest";
import {
  validateGeneratorUpload,
  truncateExtractedText,
  MAX_GENERATOR_FILE_SIZE_BYTES,
  MAX_EXTRACTED_CHARS,
} from "./extract";

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
