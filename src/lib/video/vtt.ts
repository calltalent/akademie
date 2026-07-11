/**
 * Reine, testbare Funktion (kein I/O, KEIN `server-only` — Phase 3, Block 6:
 * Auto-Transkript). Wandelt eine WebVTT-Untertiteldatei (von Bunnys
 * Transcribe-AI erzeugt) in reinen Fließtext für `lessons.transcript` um.
 *
 * Block-basierter Ansatz (Cues sind in VTT durch Leerzeilen getrennt — diese
 * Struktur wird bewusst NICHT vorab weggefiltert, sondern als Cue-Grenze
 * genutzt, siehe unten):
 * 1. Text wird an Leerzeilen in Cue-Blöcke zerlegt.
 * 2. Der allererste Block ("WEBVTT" + evtl. Metadaten-Kopfzeilen) wird
 *    verworfen; Blöcke, die mit "NOTE"/"STYLE"/"REGION" beginnen, werden
 *    komplett verworfen (Bunnys Transcribe-AI erzeugt laut Doku keine
 *    STYLE/REGION-Blöcke — bewusste Vereinfachung für den Rest).
 * 3. Innerhalb eines Cue-Blocks: die erste Zeile ist entweder bereits die
 *    Zeitstempel-Zeile ("00:00:01.000 --> 00:00:04.000") ODER ein
 *    Cue-Identifikator (numerisch wie im Standardfall oder benannt, z. B.
 *    "cue-1") gefolgt von der Zeitstempel-Zeile — beide werden übersprungen,
 *    alle danach folgenden Zeilen sind der eigentliche Cue-Text.
 * 4. Einfache VTT-Inline-Tags (`<v Sprecher>`, `<b>`, `<i>`, `<c>` usw.)
 *    werden aus dem Cue-Text entfernt.
 * 5. Aufeinanderfolgende exakt identische Cue-Text-Zeilen werden auf eine
 *    reduziert: viele Whisper-basierte VTT-Generatoren (Bunny inklusive)
 *    wiederholen denselben Text in mehreren aufeinanderfolgenden Cues für
 *    ein "Wort-für-Wort"-Karaoke-Erscheinungsbild im Player — ohne diese
 *    Reduktion würde derselbe Satz im gespeicherten Transkript oft mehrfach
 *    hintereinander auftauchen.
 */

const TIMESTAMP_RE = /-->/;
const INLINE_TAG_RE = /<[^>]+>/g;
const SKIP_BLOCK_RE = /^(NOTE|STYLE|REGION)/;

function stripInlineTags(text: string): string {
  return text.replace(INLINE_TAG_RE, "");
}

export function parseVttToPlainText(vtt: string): string {
  if (!vtt || !vtt.trim()) return "";

  const normalized = vtt.replace(/\r\n/g, "\n");
  const blocks = normalized.split(/\n\s*\n/);

  const textLines: string[] = [];

  blocks.forEach((block, blockIndex) => {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (lines.length === 0) return;

    if (blockIndex === 0 && /^WEBVTT/.test(lines[0])) return;
    if (SKIP_BLOCK_RE.test(lines[0])) return;

    // Zeile 0 ist entweder schon der Zeitstempel, oder ein Cue-Identifikator
    // (dann folgt der Zeitstempel in Zeile 1) — beide werden übersprungen.
    const contentStart = TIMESTAMP_RE.test(lines[0]) ? 1 : 2;

    for (let i = contentStart; i < lines.length; i++) {
      const cleaned = stripInlineTags(lines[i]).trim();
      if (cleaned === "") continue;
      if (textLines.length > 0 && textLines[textLines.length - 1] === cleaned) continue;
      textLines.push(cleaned);
    }
  });

  return textLines.join(" ").replace(/\s+/g, " ").trim();
}
