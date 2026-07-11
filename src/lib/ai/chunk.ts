import type { Block } from "@/lib/courses/schema";

/**
 * Reine Chunking-/Textextraktions-Funktionen (kein I/O, kein `server-only` —
 * bewusst importierbar aus Tests ohne DB/Env-Setup). Phase 3, Block 2
 * (Embeddings/pgvector-Fundament).
 *
 * Zeichen-basiertes statt Tokenizer-basiertes Chunking (bewusste
 * Vereinfachung laut Auftrag): eine grobe Zeichen-Heuristik reicht für
 * dieses Fundament, spart eine Tokenizer-Dependency. `maxChars`/
 * `overlapChars` sind bewusst großzügig gewählt (1500/150 Zeichen ≈ grob
 * 300-400 Tokens pro Chunk bei deutschem Text) — sinnvolle Chunk-Größe für
 * Voyage-Embeddings ohne die tatsächliche Tokenanzahl zu kennen.
 */

const DEFAULT_MAX_CHARS = 1500;
const DEFAULT_OVERLAP_CHARS = 150;
/** Sehr kurzer Rest-Chunk wird an den vorherigen angehängt statt einen
 *  eigenen Mini-Chunk zu bilden (vermeidet z. B. einen 5-Zeichen-Chunk am
 *  Textende, der für die Suche kaum Aussagekraft hätte). */
const MIN_TAIL_CHARS = 50;

/**
 * Zerlegt `text` in überlappende Chunks von maximal `maxChars` Zeichen.
 * Regeln (einfache Heuristik, kein echter Satz-/Absatz-Parser):
 * - nie mitten in einem Wort trennen (Trennpunkt an Leerzeichen/Zeilenumbruch
 *   gesucht, rückwärts vom Ziel-Ende innerhalb eines Suchfensters); wird kein
 *   Trennpunkt gefunden (z. B. ein einzelnes sehr langes "Wort"), wird hart
 *   bei `maxChars` geschnitten statt den Chunk beliebig wachsen zu lassen.
 * - leere/reine Whitespace-Eingabe liefert ein leeres Ergebnis-Array.
 * - ein sehr kurzer letzter Rest-Chunk (< `MIN_TAIL_CHARS`) wird an den
 *   vorherigen Chunk angehängt statt einen eigenen Eintrag zu bilden.
 */
export function chunkText(
  text: string,
  opts?: { maxChars?: number; overlapChars?: number },
): string[] {
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = opts?.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  // Whitespace normalisieren (mehrfache Leerzeichen/Zeilenumbrüche zu einem
  // Leerzeichen) — vereinfacht die Trennpunkt-Suche und vermeidet leere
  // Chunks durch reine Formatierungs-Whitespace-Läufe.
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);

    if (end < normalized.length) {
      // Rückwärts vom Ziel-Ende nach einem Leerzeichen suchen, aber nicht
      // weiter zurück als die Hälfte von maxChars (sonst würden Chunks bei
      // wortarmem/langem Text unnötig klein).
      const searchWindowStart = start + Math.floor(maxChars * 0.5);
      let breakAt = -1;
      for (let i = end; i > searchWindowStart; i--) {
        if (normalized[i - 1] === " ") {
          breakAt = i - 1;
          break;
        }
      }
      if (breakAt > start) {
        end = breakAt;
      }
      // sonst: kein Trennpunkt im Suchfenster gefunden -> harter Schnitt bei maxChars.
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= normalized.length) break;

    // Überlappung: nächster Chunk beginnt `overlapChars` vor `end`, aber nie
    // vor `start + 1` (garantiert Fortschritt, verhindert Endlosschleife bei
    // sehr kleinen maxChars/overlapChars-Kombinationen).
    let nextStart = Math.max(end - overlapChars, start + 1);

    // Nicht mitten im Wort beginnen: liegt `nextStart` nicht bereits direkt
    // hinter einem Leerzeichen, zur nächsten Wortgrenze innerhalb des schon
    // gechunkten Bereichs (<= `end`) vorwärts springen. Über `end` hinaus
    // NICHT suchen — das würde eine Textlücke erzeugen (der Bereich zwischen
    // `end` und einer weiter entfernten Wortgrenze wäre in keinem Chunk
    // enthalten). Ohne passende Wortgrenze im Overlap-Bereich (z. B. ein
    // einzelnes sehr langes "Wort") bleibt `nextStart` unverändert — bekannte,
    // dokumentierte Heuristik-Grenze.
    if (nextStart > 0 && normalized[nextStart - 1] !== " ") {
      const nextSpace = normalized.indexOf(" ", nextStart);
      if (nextSpace !== -1 && nextSpace <= end) {
        nextStart = nextSpace + 1;
      }
    }
    while (nextStart < normalized.length && normalized[nextStart] === " ") nextStart++;
    start = nextStart;
  }

  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    if (last.length < MIN_TAIL_CHARS) {
      chunks.pop();
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${last}`.trim();
    }
  }

  return chunks;
}

/**
 * Block-Typen mit embedbarem Text, laut Prüfung von `courses/schema.ts`
 * bewusst auf genau diese zwei beschränkt (dokumentierte Vereinfachung):
 * - `text`: `html`-Feld (bereits beim Schreiben über `sanitize-html`
 *   gehärtet, siehe `textBlockSchema` — hier zusätzlich grob zu Klartext
 *   entHTMLt, sonst würden Tags mit-embedded und die Suche verschlechtern).
 * - `callout`: `text`-Feld, reiner Klartext, kein HTML.
 * Bewusst AUSGESCHLOSSEN:
 * - `image` (`alt`): kurzer Barrierefreiheits-Text, kein Lektionsinhalt.
 * - `video`/`audio`/`file`: reine Datei-/Streaming-Referenzen ohne
 *   inhaltliches Textfeld (`file.filename` ist nur ein Dateiname, kein
 *   Inhalt). Video-Transkripte als eigene Content-Quelle kommen erst mit
 *   Block 6 (Bunny Transcribe AI).
 * - `quiz`: nur `quizId` + kurzer `title`-Verweis im Block selbst; die
 *   eigentlichen Fragen/Antworten liegen in einer separaten Tabelle
 *   (`questions`) außerhalb der Lektions-`blocks`, nicht Teil dieses Blocks.
 * - `submission` (`instructions`): laut Auftrag explizit als
 *   "Abgabe-Platzhalter" von der Embedding-Pflicht ausgenommen.
 * - `embed` (`url`): kein Textfeld überhaupt.
 */
const EMBEDDABLE_BLOCK_TYPES = new Set<Block["type"]>(["text", "callout"]);

/** Sehr einfache HTML-zu-Klartext-Reduktion — kein voller Parser, reicht
 *  aber für die Whitelist-Tags aus `textBlockSchema` (p, br, strong, em, u,
 *  s, a, ul, ol, li, h2-h4, blockquote, code, pre, span). Entfernt zuerst
 *  komplette script/style-Blöcke (sollten wegen der Sanitize-Whitelist beim
 *  Schreiben nie vorkommen, aber defensiv trotzdem behandelt), dann alle
 *  übrigen Tags, löst die gängigsten HTML-Entities auf und normalisiert
 *  Whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrahiert den embedbaren Klartext einer Lektion aus ihrer Block-Liste
 * (siehe `EMBEDDABLE_BLOCK_TYPES` oben für die Auswahl-Begründung). Blöcke
 * werden in ihrer gespeicherten Reihenfolge zu Absätzen zusammengefügt.
 */
export function extractLessonText(blocks: Block[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    if (!EMBEDDABLE_BLOCK_TYPES.has(block.type)) continue;

    if (block.type === "text") {
      const text = stripHtml(block.html);
      if (text) parts.push(text);
    } else if (block.type === "callout") {
      const text = block.text.trim();
      if (text) parts.push(text);
    }
  }

  return parts.join("\n\n");
}
