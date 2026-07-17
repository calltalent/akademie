import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createAnthropicClient } from "@/lib/ai/anthropic";
import { AI_MODELS } from "@/lib/ai/config";
import { recordAiJob } from "@/lib/ai/usage";
import { addCaption, type BunnyCaption } from "@/lib/bunny/client";
import { parseStepResponse } from "@/lib/generator/parse";
import { parseVttCues, serializeVttCues } from "@/lib/video/vtt-cues";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Stufe 3 „Untertitel DE + EN" (Plan `calm-watching-dewdrop.md`). Josips
 * Entscheidung: Bunny transkribiert NUR Deutsch (0,10 $/Min); Englisch
 * entsteht per claude-haiku-Übersetzung des fertigen DE-VTT und wird per
 * Bunny-„Add Caption"-Endpunkt hochgeladen — spart die zweiten 0,10 $/Min
 * gegenüber Bunnys `targetLanguages`.
 *
 * Aufgerufen von `src/lib/video/transcript.ts` NACH dem erfolgreichen
 * `transcript`-`recordAiJob()`, nur wenn die Quell-Caption `srclang==="de"`
 * ist. Sowohl der Bunny-Webhook (Status 9) als auch der manuelle
 * „Transkript aktualisieren"-Ersatzweg laufen dort durch — keine
 * Änderung an api/bunny/webhook/route.ts nötig.
 *
 * Zeitstempel begegnen dem Sprachmodell strukturell NIE (nicht per Prompt
 * gelöst, sondern per Bauweise): `parseVttCues()` trennt Timing/Settings von
 * Text, an Claude geht ausschließlich `{"i": number, "t": string}[]` — die
 * Timing-Zeilen bleiben vollständig in unserer Struktur und werden nach der
 * Antwort per `serializeVttCues()` verbatim wieder angehängt.
 *
 * Fail-soft wie `summarizeTranscript()` (transcript.ts): diese Funktion
 * wirft NIE nach außen — ein Übersetzungsfehler darf das bereits fertige
 * DE-Transkript/die DE-Caption nie gefährden. Bei jedem Fehlschlag (Batch-
 * Validierung nach einem Retry, Bunny-Upload) bleibt es bei einer
 * geloggten/protokollierten Fehlermeldung, NIE bei einem teilweise
 * hochgeladenen EN-Track (Plan: "Falsch synchronisierte Untertitel sind
 * schlimmer als keine — und genau das kann ein blinder Nutzer nicht
 * bemerken").
 */

const BATCH_SIZE = 50;

const cueItemSchema = z.object({ i: z.number().int(), t: z.string() });
const batchResponseSchema = z.array(cueItemSchema);
type CueItem = z.infer<typeof cueItemSchema>;

const TRANSLATION_SYSTEM_PROMPT = [
  "Du übersetzt Untertitel-Segmente eines Video-Kurses von Deutsch ins Englische.",
  'Du bekommst ein JSON-Array von Objekten {"i": number, "t": string}.',
  'Gib GENAU DIESELBE ANZAHL Objekte zurück, mit UNVERÄNDERTEM "i" und dem ins Englische übersetzten Text in "t".',
  "Fasse NIEMALS mehrere Segmente zusammen und teile NIEMALS ein Segment auf, auch wenn es inhaltlich sinnvoll erschiene.",
  "Die Segmente sind Fragmente eines fortlaufenden Vortrags und oft mitten im Satz abgeschnitten — das ist beabsichtigt, behalte den Schnitt exakt bei.",
  "Antworte AUSSCHLIESSLICH mit dem JSON-Array. Kein Markdown, kein Code-Fence, keine Erklärung davor oder danach.",
].join(" ");

function chunkCueItems(items: CueItem[], size: number): CueItem[][] {
  const batches: CueItem[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}

/**
 * Harte Validierung (Plan Schritt 6): exakt gleiche Anzahl UND exakt
 * dieselbe Menge an `i`-Werten wie angefragt — sonst ist die Zuordnung
 * Übersetzung -> Original-Cue nicht mehr sicher rekonstruierbar.
 */
function assertBatchShapeMatches(requested: CueItem[], received: CueItem[]): void {
  if (received.length !== requested.length) {
    throw new Error(`Antwort hat ${received.length} Segmente statt der erwarteten ${requested.length}.`);
  }
  const requestedIds = new Set(requested.map((item) => item.i));
  const receivedIds = new Set(received.map((item) => item.i));
  const idsMatch =
    requestedIds.size === receivedIds.size && [...requestedIds].every((id) => receivedIds.has(id));
  if (!idsMatch) {
    throw new Error('Antwort enthält andere Segment-Indizes ("i") als angefragt.');
  }
}

async function translateBatchOnce(
  anthropic: Anthropic,
  batch: CueItem[],
): Promise<{ items: CueItem[]; tokensIn: number; tokensOut: number }> {
  const response = await anthropic.messages.create({
    model: AI_MODELS.haiku,
    max_tokens: 4096,
    system: TRANSLATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(batch) }],
  });

  const rawText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const received = parseStepResponse(rawText, batchResponseSchema);
  assertBatchShapeMatches(batch, received);

  return {
    items: received,
    tokensIn: response.usage?.input_tokens ?? 0,
    tokensOut: response.usage?.output_tokens ?? 0,
  };
}

/** EIN Retry bei Validierungs-/Parse-Fehler (Plan Schritt 6), danach wird der Fehler nach oben gereicht. */
async function translateBatchWithRetry(
  anthropic: Anthropic,
  batch: CueItem[],
): Promise<{ items: CueItem[]; tokensIn: number; tokensOut: number }> {
  try {
    return await translateBatchOnce(anthropic, batch);
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : "Ungültige Antwort.";
    console.error("[video/translate-captions] Batch-Validierung fehlgeschlagen, ein Retry:", message);
    return await translateBatchOnce(anthropic, batch);
  }
}

export type EnsureEnglishCaptionParams = {
  bunnyVideoId: string;
  tenantId: string;
  deVtt: string;
  existingCaptions: BunnyCaption[];
};

export async function ensureEnglishCaption(params: EnsureEnglishCaptionParams): Promise<void> {
  const { bunnyVideoId, tenantId, deVtt, existingCaptions } = params;

  const cues = parseVttCues(deVtt);
  if (cues.length === 0) {
    console.info("[video/translate-captions] DE-VTT enthält keine Cues, Übersetzung übersprungen:", bunnyVideoId);
    return;
  }

  // Idempotenz (Plan: "ohne neues Schema") — deckt Webhook-Retries und
  // wiederholtes Klicken auf "Transkript aktualisieren". Benignes TOCTOU
  // (zwei parallele Läufe könnten beide "kein EN" sehen): Bunnys
  // addCaption() ist pro srclang ein Upsert, schlimmstenfalls eine doppelte
  // Haiku-Anfrage — kein Lock nötig (Plan-Begründung).
  const hasEnglishCaption = existingCaptions.some((caption) => caption.srclang.toLowerCase() === "en");
  if (hasEnglishCaption) {
    console.info("[video/translate-captions] EN-Untertitel existiert bereits, Übersetzung übersprungen:", bunnyVideoId);
    return;
  }

  const items: CueItem[] = cues.map((cue, index) => ({ i: index, t: cue.text }));
  const batches = chunkCueItems(items, BATCH_SIZE);
  const anthropic = createAnthropicClient();

  const translatedTextByIndex = new Map<number, string>();
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    for (const batch of batches) {
      const result = await translateBatchWithRetry(anthropic, batch);
      tokensIn += result.tokensIn;
      tokensOut += result.tokensOut;
      for (const item of result.items) {
        translatedTextByIndex.set(item.i, item.t);
      }
    }
  } catch (e) {
    // Kompletter Abbruch (Plan Schritt 6): NIE ein teilweise übersetztes
    // Ergebnis hochladen, egal wie viele Batches zuvor schon erfolgreich
    // waren — falsch synchronisierte Untertitel sind schlimmer als keine.
    const rawMessage = e instanceof Error ? e.message : "Unbekannter Fehler bei der Untertitel-Übersetzung.";
    console.error(
      "[video/translate-captions] Übersetzung abgebrochen (fail-soft, DE-Transkript bleibt erhalten, KEIN EN-Track):",
      rawMessage,
    );
    const message = genericErrorMessage(e);
    await recordAiJob({
      tenantId,
      kind: "translation",
      model: AI_MODELS.haiku,
      tokensIn: 0,
      tokensOut: 0,
      status: "error",
      input: { bunnyVideoId, cueCount: cues.length, batchCount: batches.length, targetLang: "en" },
      error: message,
    });
    return;
  }

  const englishCues = cues.map((cue, index) => ({
    ...cue,
    // Fallback auf den DE-Text ist rein defensiv — assertBatchShapeMatches()
    // garantiert bereits, dass jeder Index in der Antwort vorkommt.
    text: translatedTextByIndex.get(index) ?? cue.text,
  }));
  const enVtt = serializeVttCues(englishCues);

  // EINE ai_jobs-Zeile pro Übersetzung, Tokens über alle Batches summiert
  // (Plan) — bewusst KEIN enforceQuota() (gleiche Begründung wie
  // transcript.ts: automatischer Betriebskosten-Posten, keine
  // nutzerausgelöste, kontingentierte Aktion).
  await recordAiJob({
    tenantId,
    kind: "translation",
    model: AI_MODELS.haiku,
    tokensIn,
    tokensOut,
    status: "done",
    input: { bunnyVideoId, cueCount: cues.length, batchCount: batches.length, targetLang: "en" },
  });

  try {
    await addCaption(bunnyVideoId, "en", "English", enVtt);
  } catch (e) {
    // Die Übersetzung selbst ist bereits gelaufen und protokolliert (Kosten
    // sind entstanden) — ein reiner Bunny-Upload-Fehler darf trotzdem nicht
    // nach außen werfen (Fail-soft-Vertrag dieser Funktion, siehe Dateikopf).
    const rawMessage = e instanceof Error ? e.message : "Unbekannter Fehler beim Hochladen des EN-Untertitels.";
    console.error("[video/translate-captions] addCaption (EN) fehlgeschlagen:", rawMessage);
  }
}
