/**
 * Reine, testbare Cue-Struktur-Funktionen (kein I/O, KEIN `server-only`) für
 * Stufe 3 „Untertitel DE + EN" (Plan `calm-watching-dewdrop.md`). Anders als
 * `src/lib/video/vtt.ts` (wandelt VTT in reinen Fließtext für
 * `lessons.transcript` um — Zeitstempel gehen dabei bewusst verloren) muss
 * `src/lib/video/translate-captions.ts` die Zeitstempel jedes Cues UNVERÄNDERT
 * behalten, während nur der Text übersetzt wird. `vtt.ts` bleibt dafür
 * unangetastet (getestet, anderer Zweck) — die Block-Splitting-Logik ist hier
 * bewusst eigenständig noch einmal implementiert statt sie zu teilen/zu
 * refactoren (kein Umbau an getestetem Code mitten im Feature).
 *
 * `parseVttCues()`/`serializeVttCues()` sind so gebaut, dass die
 * Zeitstempel-/Settings-Zeile beim Rundlauf (parse -> Text ändern ->
 * serialize) BYTE-IDENTISCH zur Quelle bleibt — das ist die Grundlage dafür,
 * dass `translate-captions.ts` Zeitstempel niemals selbst neu zusammensetzen
 * muss (und sie dem Sprachmodell dadurch strukturell nie begegnen).
 */

export type VttCue = {
  /** Cue-Identifikator (numerisch oder benannt) vor der Zeitstempel-Zeile, oder `null` wenn keiner vorhanden ist. */
  id: string | null;
  /** Zeitstempel-Teil der Timing-Zeile, z. B. "00:00:01.000 --> 00:00:04.000" — OHNE Cue-Settings. */
  timing: string;
  /** Cue-Settings nach dem Zeitstempel (z. B. "align:start position:0%"), oder "" wenn keine vorhanden sind. */
  settings: string;
  /** Cue-Text, mehrzeilige Cues bleiben mit "\n" verbunden. */
  text: string;
};

const TIMING_LINE_RE = /-->/;
const SKIP_BLOCK_RE = /^(NOTE|STYLE|REGION)/;

/**
 * Zerlegt eine WebVTT-Timing-Zeile ("<start> --> <end> [settings]") in
 * Zeitstempel- und Settings-Anteil. Split über Whitespace-Tokens (nicht per
 * Gesamt-Regex auf die Zeitstempel-Syntax) — robust auch gegen
 * Stunden-lose Zeitstempel (mm:ss.mmm) und mehrfache Leerzeichen, ohne das
 * exakte Zeitformat selbst nachbilden zu müssen.
 */
function splitTimingLine(line: string): { timing: string; settings: string } {
  const tokens = line.trim().split(/\s+/);
  const arrowIndex = tokens.indexOf("-->");
  if (arrowIndex <= 0 || arrowIndex >= tokens.length - 1) {
    // Unerwartetes Format — kompletten Inhalt als "timing" behandeln, statt
    // eine kaputte Zeile zu verwerfen (Cue bleibt zumindest sichtbar/zählbar).
    return { timing: line.trim(), settings: "" };
  }
  const timing = `${tokens[arrowIndex - 1]} --> ${tokens[arrowIndex + 1]}`;
  const settings = tokens.slice(arrowIndex + 2).join(" ");
  return { timing, settings };
}

/**
 * Parst eine WebVTT-Datei in Cue-Objekte. Übersprungen werden (wie in
 * `vtt.ts`): der WEBVTT-Kopfblock und NOTE/STYLE/REGION-Blöcke — für die
 * Übersetzung sind ausschließlich echte Cues relevant, Bunnys Transcribe-AI
 * erzeugt laut Doku ohnehin keine STYLE/REGION-Blöcke (siehe `vtt.ts`-
 * Dateikopf). Cue-Blöcke ohne erkennbare Timing-Zeile werden übersprungen
 * (defensiv gegen kaputte/unvollständige VTT, statt abzustürzen).
 */
export function parseVttCues(vtt: string): VttCue[] {
  if (!vtt || !vtt.trim()) return [];

  const normalized = vtt.replace(/\r\n/g, "\n");
  const blocks = normalized.split(/\n\s*\n/);
  const cues: VttCue[] = [];

  blocks.forEach((block, blockIndex) => {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (lines.length === 0) return;

    if (blockIndex === 0 && /^WEBVTT/.test(lines[0])) return;
    if (SKIP_BLOCK_RE.test(lines[0])) return;

    // Zeile 0 ist entweder schon die Timing-Zeile, oder ein Cue-Identifikator
    // (dann folgt die Timing-Zeile in Zeile 1).
    const hasId = !TIMING_LINE_RE.test(lines[0]);
    const timingLineIndex = hasId ? 1 : 0;
    const timingLine = lines[timingLineIndex];
    if (!timingLine || !TIMING_LINE_RE.test(timingLine)) return;

    const { timing, settings } = splitTimingLine(timingLine);
    const text = lines.slice(timingLineIndex + 1).join("\n");

    cues.push({ id: hasId ? lines[0] : null, timing, settings, text });
  });

  return cues;
}

/**
 * Baut aus Cue-Objekten wieder eine gültige WebVTT-Datei zusammen. Die
 * Timing-Zeile wird aus `timing`+`settings` REKONSTRUIERT (nicht aus einem
 * gespeicherten Roh-String) — für Cues, die unverändert aus `parseVttCues()`
 * kommen, ist das Ergebnis byte-identisch zur Quelle (Grundlage für den
 * EN-Rundlauf-Test aus dem Plan: "EN-Timestamps byte-identisch zu DE").
 */
export function serializeVttCues(cues: VttCue[]): string {
  if (cues.length === 0) return "WEBVTT\n";

  const blocks = cues.map((cue) => {
    const timingLine = cue.settings ? `${cue.timing} ${cue.settings}` : cue.timing;
    const headLines = cue.id !== null ? [cue.id, timingLine] : [timingLine];
    return [...headLines, cue.text].join("\n");
  });

  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}
