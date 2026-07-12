import type { z } from "zod";

/**
 * Reine JSON-Extraktions-/Validierungsfunktionen für die Kurs-Generator-
 * Pipeline (Phase 3, Block 5) — kein I/O, kein `server-only`-Import (weder
 * direkt noch transitiv über andere Module), bewusst in eine eigene Datei
 * ausgelagert, damit sie ohne DB-/Env-/Anthropic-Setup aus Vitest heraus
 * importierbar bleiben. Gleiches Muster wie `src/lib/tutor/prompt.ts`
 * (pure Funktion, ausgelagert aus `src/lib/tutor/actions.ts`, das über
 * `createAnthropicClient()` transitiv `server-only` zieht) bzw.
 * `src/lib/ai/chunk.ts` (siehe dortiger Dateikopf-Kommentar).
 * `src/lib/generator/pipeline.ts` importiert diese Funktionen und ergänzt
 * die eigentlichen (nicht direkt testbaren) Claude-Aufrufe.
 */

/**
 * Extrahiert das erste vollständige JSON-Objekt aus einer Claude-Antwort.
 * Claude wird angewiesen, ausschließlich JSON zu liefern, hält sich aber
 * gelegentlich nicht exakt daran (Markdown-Codeblock-Fences, ein
 * einleitender Satz) — robust gegen beides statt sich auf die
 * Antwortdisziplin zu verlassen.
 */
export function extractJsonPayload(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();

  // BUGFIX (E2E-Fund course-generator.spec.ts, Josip, 12.07.2026): bislang
  // wurde IMMER von der ersten "{" bis zur letzten "}" geschnitten — bricht,
  // sobald Claude (entgegen dem geforderten Objekt-Format) ein Array als
  // Wurzel liefert (z. B. nur das rohe "modules"-Array statt
  // {"title":..., "modules":[...]}): die Ausgabe war dann eine
  // kommagetrennte Liste mehrerer Objekte OHNE umschließende Klammern ("{A},
  // {B}") — syntaktisch ungültiges JSON, obwohl die Antwort inhaltlich
  // vollständig war. Fix: die WURZEL-Klammerart wird anhand des zuerst
  // auftretenden Zeichens ("{" oder "[") bestimmt und mit der letzten
  // Vorkommnis der PASSENDEN schließenden Klammer gepaart, statt immer von
  // "{"/"}" auszugehen. Ein Array-Wurzelfall ergibt dadurch weiterhin
  // syntaktisch gültiges JSON (schlägt danach ggf. korrekt an der
  // zod-Validierung fehl, statt hier mit einer irreführenden
  // "kein gültiges JSON"-Meldung zu enden).
  const firstBrace = candidate.indexOf("{");
  const firstBracket = candidate.indexOf("[");
  let start: number;
  let closeChar: string;
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    start = firstBracket;
    closeChar = "]";
  } else {
    start = firstBrace;
    closeChar = "}";
  }
  const end = candidate.lastIndexOf(closeChar);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Keine gültige JSON-Antwort gefunden.");
  }
  return candidate.slice(start, end + 1);
}

/** Parst + validiert eine Claude-JSON-Antwort gegen ein zod-Schema. */
export function parseStepResponse<T>(raw: string, schema: z.ZodType<T>): T {
  const jsonText = extractJsonPayload(raw);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    throw new Error("Antwort ist kein gültiges JSON.");
  }
  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      "Antwort entspricht nicht dem erwarteten Format: " + (result.error.issues[0]?.message ?? "unbekannter Fehler"),
    );
  }
  return result.data;
}
