import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "@/lib/ai/anthropic";
import { AI_MODELS } from "@/lib/ai/config";
import { parseStepResponse } from "@/lib/generator/parse";
import { buildShiftPlanPrompt, type ShiftPlanPromptContext } from "@/lib/calendar/ai/prompt";
import { shiftPlanModelOutputSchema, type ShiftPlanModelOutput } from "@/lib/calendar/ai/schema";

/**
 * Claude-Aufruf für die KI-Schichtplanung (Block S4, 08.08.2026) — EIN
 * einzelner Sonnet-Aufruf (kein Mehrschritt-Zustandsautomat wie beim
 * Kurs-Generator, siehe `src/lib/calendar/ai/process.ts`-Dateikopf).
 *
 * Wiederverwendet `parseStepResponse()`/`extractJsonPayload()` aus
 * `src/lib/generator/parse.ts` (JSON-Extraktion + zod-Validierung, inkl. der
 * Array-Wurzel-Bugfix-Logik dort) statt eine zweite JSON-Extraktion zu
 * schreiben — exakt das im S4-Bauauftrag geforderte Muster.
 *
 * Bei Validierungsfehler GENAU EIN Retry mit dem konkreten zod-Fehler als
 * Korrekturhinweis (gleiches Muster wie `src/lib/generator/pipeline.ts`,
 * `callClaudeJsonStep()`). Kein Unit-Test für diese Datei (echter
 * API-Aufruf) — gleiche bewusste Entscheidung wie beim Kurs-Generator, siehe
 * `src/lib/generator/pipeline.ts`-Dateikopf.
 */

export type ShiftPlanModelResult = { data: ShiftPlanModelOutput; tokensIn: number; tokensOut: number };

async function callClaude(system: string, user: string, extraInstruction?: string) {
  const anthropic = createAnthropicClient();
  return anthropic.messages.create({
    model: AI_MODELS.sonnet,
    max_tokens: 12000,
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

export async function callShiftPlanModel(context: ShiftPlanPromptContext): Promise<ShiftPlanModelResult> {
  const { system, user } = buildShiftPlanPrompt(context);

  async function attempt(extraInstruction?: string): Promise<ShiftPlanModelResult> {
    const response = await callClaude(system, user, extraInstruction);
    const rawText = extractText(response);
    try {
      const data = parseStepResponse(rawText, shiftPlanModelOutputSchema);
      return {
        data,
        tokensIn: response.usage?.input_tokens ?? 0,
        tokensOut: response.usage?.output_tokens ?? 0,
      };
    } catch (parseError) {
      // Rohtext einer gescheiterten Antwort NUR gekürzt (4000 Zeichen) ins
      // Server-Log, NIE in die UI — gleiches Muster wie
      // src/lib/generator/pipeline.ts.
      console.error(
        "[calendar/ai/pipeline] Rohtext der fehlgeschlagenen Antwort (gekürzt):",
        rawText.slice(0, 4000),
      );
      throw parseError;
    }
  }

  try {
    return await attempt();
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : "Ungültige Antwort.";
    console.error("[calendar/ai/pipeline] Validierung fehlgeschlagen, ein Retry:", message);
    return await attempt(
      `Deine vorherige Antwort war ungültig (${message}). Antworte jetzt ausschließlich mit einem einzigen gültigen JSON-Objekt exakt im geforderten Format, ohne Markdown, ohne Erklärung.`,
    );
  }
}
