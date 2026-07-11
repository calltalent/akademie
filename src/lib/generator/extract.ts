import { extractText, getDocumentProxy } from "unpdf";

/**
 * Textextraktion aus hochgeladenen Dokumenten (Phase 3, Block 5 —
 * Kurs-Generator). PDF ist in diesem Block das Minimum (Auftrag) — DOCX/
 * PPTX/Transkript stehen laut SPEC §6 auf der Wunschliste, sind aber ohne
 * vertretbare Zusatzdependency (Zip-/OOXML-Parser bzw. STT-Anbindung, die
 * laut PHASENSTATUS.md "Phase 3 — KI" ohnehin erst mit Block 6/Bunny
 * Transcribe AI kommt) in diesem Block nicht umsetzbar — als "offen" in
 * PHASENSTATUS.md vermerkt.
 *
 * `unpdf` statt z. B. `pdf-parse` gewählt: eine isomorphe, reine JS/WASM-
 * Implementierung auf pdf.js-Basis ohne Node-`fs`-Zugriff — explizit für
 * Edge-/Worker-Laufzeiten gebaut (Cloudflare Workers via OpenNext,
 * CLAUDE.md §1.7), im Gegensatz zu den meisten Node-PDF-Bibliotheken, die
 * beim Cloudflare-Workers-Deploy vermutlich brechen würden.
 *
 * KEIN `server-only`-Import (bewusst, gleiches Muster wie src/lib/ai/
 * chunk.ts): diese Datei verarbeitet keine Secrets (weder API-Keys noch
 * Anmeldedaten) — `unpdf` braucht keinen Key. `server-only` würde nur die
 * direkte Importierbarkeit der reinen Funktionen (`validateGeneratorUpload`,
 * `truncateExtractedText`) aus Vitest-Tests heraus blockieren (das Paket
 * wirft beim Import außerhalb der "react-server"-Bedingung), ohne einen
 * echten Sicherheitsgewinn zu bringen. Aufgerufen wird `extractTextFromPdf`
 * ohnehin ausschließlich aus einem Route Handler (server-seitiger Kontext).
 */

export const ALLOWED_GENERATOR_MIME_TYPES = ["application/pdf"] as const;
export type GeneratorMimeType = (typeof ALLOWED_GENERATOR_MIME_TYPES)[number];

/** Serverseitige Größen-Whitelist (Sicherheitsregel CLAUDE.md §2.5). */
export const MAX_GENERATOR_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

/** Kontextfenster-/Kosten-Deckel für die nachfolgende Claude-Pipeline. */
export const MAX_EXTRACTED_CHARS = 60000;

/**
 * Serverseitige Datei-Whitelist-Prüfung (Typ UND Größe) — niemals nur
 * clientseitig, wie überall im Projekt (CLAUDE.md §2.5, analog
 * `src/lib/submissions/schema.ts::ALLOWED_SUBMISSION_MIME_TYPES`).
 */
export function validateGeneratorUpload(file: {
  type: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  if (!ALLOWED_GENERATOR_MIME_TYPES.includes(file.type as GeneratorMimeType)) {
    return { ok: false, error: "Nur PDF-Dateien werden unterstützt." };
  }
  if (file.size <= 0) {
    return { ok: false, error: "Datei ist leer." };
  }
  if (file.size > MAX_GENERATOR_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `Datei zu groß (max. ${Math.floor(MAX_GENERATOR_FILE_SIZE_BYTES / 1024 / 1024)} MB).`,
    };
  }
  return { ok: true };
}

/**
 * Reine Funktion (testbar): kürzt Text auf `maxChars`, meldet ob gekürzt
 * wurde. Von `extractTextFromPdf()` verwendet, aber unabhängig von PDF-
 * Parsing testbar.
 */
export function truncateExtractedText(
  text: string,
  maxChars: number = MAX_EXTRACTED_CHARS,
): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, maxChars), truncated: true };
}

/**
 * Extrahiert Klartext aus einer PDF-Datei (serverseitig).
 *
 * Bewusste Vereinfachung/Abweichung vom Plan-Wortlaut ("serverseitig,
 * Supabase Storage"): die Rohdatei wird NICHT in Supabase Storage
 * zwischengespeichert. Die Extraktion läuft synchron im selben Request wie
 * der Upload (POST /api/admin/ki/generate) — die architect-Entscheidung für
 * eine ASYNCHRONE Zustandsmaschine (`ai_jobs`) betrifft ausdrücklich die
 * MEHRSTUFIGE CLAUDE-GENERIERUNG (mehrere potenziell lange LLM-Aufrufe
 * hintereinander sprengen das Cloudflare-Workers-CPU-Zeit-Limit), nicht die
 * PDF-Textextraktion selbst (ein einzelner, schneller lokaler Rechenschritt
 * im Rahmen der normalen Workers-Anfragedauer). Der extrahierte Klartext
 * wird direkt in `ai_jobs.input.sourceText` gespeichert (jsonb-Spalte aus
 * 0001_init.sql, keine neue Spalte nötig) — vermeidet eine zusätzliche
 * private Storage-Bucket-Migration für rohe Kunden-Uploaddateien, die nach
 * der Extraktion ohnehin nicht mehr gebraucht würden.
 */
export async function extractTextFromPdf(
  fileBytes: Uint8Array,
): Promise<{ text: string; truncated: boolean }> {
  const pdf = await getDocumentProxy(fileBytes);
  const result = await extractText(pdf, { mergePages: true });
  const merged = Array.isArray(result.text) ? result.text.join("\n") : result.text;

  if (!merged || merged.trim().length === 0) {
    throw new Error(
      "Aus dem Dokument konnte kein Text extrahiert werden (evtl. ein reines Bild-PDF ohne Textlayer).",
    );
  }

  return truncateExtractedText(merged);
}
