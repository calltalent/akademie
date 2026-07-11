/**
 * Zentrale KI-Konfiguration (Phase 3, Block 1 — KI-Fundament).
 * Reine Konstanten, kein I/O — von jedem KI-Aufrufpfad importierbar, ohne
 * eine `server-only`-Kette zu ziehen (Modellnamen/Preise sind kein Secret,
 * anders als die API-Keys in anthropic.ts/voyage.ts).
 */

/** Anthropic-Modell-Aliase -> konkrete Modellversionen (CLAUDE.md §1.6). */
export const AI_MODELS = {
  sonnet: "claude-sonnet-4-5-20250929",
  haiku: "claude-haiku-4-5-20251001",
} as const;

export type AiModelAlias = keyof typeof AI_MODELS;

/**
 * Kosten-Tarife in USD pro 1 Million Tokens (recherchiert 11.07.2026 via
 * WebSearch, Quelle platform.claude.com/docs/en/about-claude/pricing).
 * "Platzhalter, vor Produktivbetrieb prüfen" (Auftrag) — insbesondere:
 * Claude Sonnet 4.5 hat bis 31.08.2026 Einführungspreise (2$/10$ pro 1M
 * Input-/Output-Tokens); danach gilt der Standardpreis 3$/15$. Vor jedem
 * Produktivbetrieb nach diesem Datum hier aktualisieren.
 */
export const AI_COST_RATES_USD_PER_MILLION: Record<
  AiModelAlias,
  { input: number; output: number }
> = {
  sonnet: { input: 2, output: 10 }, // Einführungspreis bis 31.08.2026, danach 3/15 — vor Produktivbetrieb prüfen
  haiku: { input: 1, output: 5 },
};

/**
 * Voyage-AI-Embedding-Modell. `voyage-3` hat laut Voyage-AI-Dokumentation
 * eine Standard-Embedding-Dimension von 1024 — exakt passend zum
 * DB-Schema `public.embeddings.embedding vector(1024)` (0001_init.sql,
 * Zeile 303). Kosten: 0,06 $ pro 1 Million Tokens (Stand 11.07.2026,
 * "Platzhalter, vor Produktivbetrieb prüfen").
 */
export const VOYAGE_MODEL = "voyage-3";
export const VOYAGE_EMBEDDING_DIMENSION = 1024;
export const VOYAGE_COST_USD_PER_MILLION_TOKENS = 0.06;

/**
 * Bunny Transcribe AI (Phase 3, Block 6 — Auto-Transkript). Kein Claude-/
 * Voyage-Modell, sondern Bunnys native Whisper-basierte STT (Preis lt.
 * Bunny-Dashboard, siehe PHASENSTATUS.md-STT-Entscheidung: 0,10 $ pro
 * Sprachminute). Pseudo-"Modellname" für `ai_jobs.model`/`recordAiJob()` —
 * `computeCost()` (quota.ts) rechnet dafür `tokensIn` als Videolänge in
 * SEKUNDEN (nicht Tokens) in Kosten um, analog zur bereits bestehenden
 * Sonderbehandlung für Voyage-Embeddings (dort tokensIn = echte Tokens,
 * hier tokensIn = Sekunden — beides "die vom jeweiligen Anbieter
 * abgerechnete Einheit").
 */
export const BUNNY_TRANSCRIBE_MODEL = "bunny-transcribe-ai";
export const BUNNY_TRANSCRIBE_COST_USD_PER_MINUTE = 0.1;

/**
 * Monats-Kontingente je Plan (mit Josip abgestimmt, siehe PHASENSTATUS.md
 * "Phase 3 — KI", Entscheidung 4, 11.07.2026). `tutorAnswers`/`courseGens`
 * entsprechen exakt den Spalten `usage_counters.tutor_answers`/`course_gens`
 * (0001_init.sql, Zeilen 335-343).
 */
export const PLAN_AI_LIMITS: Record<
  "trial" | "komplett" | "enterprise",
  { tutorAnswers: number; courseGens: number }
> = {
  trial: { tutorAnswers: 20, courseGens: 1 },
  komplett: { tutorAnswers: 500, courseGens: 5 },
  enterprise: { tutorAnswers: 2000, courseGens: 20 },
};
