import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "@/lib/ai/anthropic";
import { AI_MODELS } from "@/lib/ai/config";
import { parseStepResponse } from "@/lib/generator/parse";
import { buildHolidayResearchPrompt, type HolidayResearchPromptContext } from "@/lib/calendar/ai/holidays/prompt";
import { holidayModelOutputSchema, type HolidayModelOutput } from "@/lib/calendar/ai/holidays/schema";

/**
 * Claude-Aufruf für die KI-Feiertagsrecherche (Block S5b, 08.08.2026) — EIN
 * einzelner Sonnet-Aufruf, exakt das Muster von `src/lib/calendar/ai/
 * pipeline.ts` (S4-Vorbild): kein Mehrschritt-Zustandsautomat wie beim
 * Kurs-Generator, siehe `src/lib/calendar/ai/holidays/process.ts`-
 * Dateikopf.
 *
 * `max_tokens: 8000` — bemessen für bis zu acht Regionen × rund 15
 * Feiertage (architect-Plan Abschnitt 6.1, "konservativ, mind. 4000"; hier
 * mit Sicherheitsabstand für die JSON-Struktur/Namen gewählt).
 *
 * Wiederverwendet `parseStepResponse()`/`extractJsonPayload()` aus
 * `src/lib/generator/parse.ts` (JSON-Extraktion + zod-Validierung) statt
 * eine zweite JSON-Extraktion zu schreiben — exakt das im S5-Bauauftrag
 * geforderte Muster.
 *
 * Bei Validierungsfehler GENAU EIN Retry mit dem konkreten zod-Fehler als
 * Korrekturhinweis (gleiches Muster wie `calendar/ai/pipeline.ts`/
 * `generator/pipeline.ts::callClaudeJsonStep()`). KEIN Unit-Test für diese
 * Datei (echter API-Aufruf) — gleiche bewusste Entscheidung wie beim S4-
 * Vorbild.
 */

export type HolidayResearchModelResult = { data: HolidayModelOutput; tokensIn: number; tokensOut: number };

async function callClaude(system: string, user: string, extraInstruction?: string) {
  const anthropic = createAnthropicClient();
  return anthropic.messages.create({
    model: AI_MODELS.sonnet,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: extraInstruction ? `${user}\n\n${extraInstruction}` : user }],
  });
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export async function callHolidayResearchModel(
  context: HolidayResearchPromptContext,
): Promise<HolidayResearchModelResult> {
  const { system, user } = buildHolidayResearchPrompt(context);

  async function attempt(extraInstruction?: string): Promise<HolidayResearchModelResult> {
    const response = await callClaude(system, user, extraInstruction);
    const rawText = extractText(response);
    try {
      const data = parseStepResponse(rawText, holidayModelOutputSchema);
      return {
        data,
        tokensIn: response.usage?.input_tokens ?? 0,
        tokensOut: response.usage?.output_tokens ?? 0,
      };
    } catch (parseError) {
      // Rohtext einer gescheiterten Antwort NUR gekürzt (4000 Zeichen) ins
      // Server-Log, NIE in die UI — gleiches Muster wie
      // src/lib/calendar/ai/pipeline.ts.
      console.error(
        "[calendar/ai/holidays/pipeline] Rohtext der fehlgeschlagenen Antwort (gekürzt):",
        rawText.slice(0, 4000),
      );
      throw parseError;
    }
  }

  try {
    return await attempt();
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : "Ungültige Antwort.";
    console.error("[calendar/ai/holidays/pipeline] Validierung fehlgeschlagen, ein Retry:", message);
    return await attempt(
      `Deine vorherige Antwort war ungültig (${message}). Antworte jetzt ausschließlich mit einem einzigen gültigen JSON-Objekt exakt im geforderten Format, ohne Markdown, ohne Erklärung.`,
    );
  }
}
