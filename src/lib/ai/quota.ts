import { AI_COST_RATES_USD_PER_MILLION, type AiModelAlias } from "@/lib/ai/config";

/**
 * Reine, testbare Funktionen (kein I/O) — Kostenberechnung und
 * Kontingent-Restberechnung. Phase 3, Block 1 (KI-Fundament).
 */

/** Findet den passenden Kostentarif über den vollen Modellnamen (nicht nur den Alias). */
function findModelAlias(model: string): AiModelAlias | null {
  if (model.startsWith("claude-sonnet")) return "sonnet";
  if (model.startsWith("claude-haiku")) return "haiku";
  return null;
}

/**
 * Berechnet die Kosten in USD für einen Claude-Aufruf. `model` kann sowohl
 * der Alias ("sonnet"/"haiku") als auch der volle Modellname sein (z. B.
 * "claude-sonnet-4-5-20250929", wie er tatsächlich in `ai_jobs.model`/
 * `tutor_messages` gespeichert wird — siehe `recordAiJob()` in usage.ts).
 * Unbekannte Modelle liefern 0 (fail-safe: lieber sichtbar falsche
 * 0-Kosten beim Protokollieren als ein Absturz nach einem bereits
 * erfolgten, kostenpflichtigen KI-Aufruf).
 */
export function computeCost(model: string, tokensIn: number, tokensOut: number): number {
  const alias =
    model in AI_COST_RATES_USD_PER_MILLION ? (model as AiModelAlias) : findModelAlias(model);
  if (!alias) return 0;

  const rates = AI_COST_RATES_USD_PER_MILLION[alias];
  const cost = (tokensIn / 1_000_000) * rates.input + (tokensOut / 1_000_000) * rates.output;
  // 4 Nachkommastellen, passend zu `ai_jobs.cost_usd numeric(10,4)` /
  // `tutor_messages.cost_usd numeric(10,4)` (0001_init.sql).
  return Math.round(cost * 10_000) / 10_000;
}

/** Restkontingent, nie negativ (auch wenn `used` das Limit bereits überschreitet). */
export function remainingQuota(used: number, limit: number): number {
  return Math.max(0, limit - used);
}
