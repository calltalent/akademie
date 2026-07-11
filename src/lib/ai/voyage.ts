import "server-only";
import { getServerEnv } from "@/lib/env";
import { VOYAGE_MODEL } from "@/lib/ai/config";

/**
 * Voyage-AI-Embeddings über rohes `fetch` (kein SDK — "wenigste bewegliche
 * Teile", architect-Plan Phase 3 Block 1/2: ein einziger Endpunkt, eine
 * einfache Anfrage/Antwort-Form, ein SDK wäre hier reiner Overhead).
 *
 * `VOYAGE_API_KEY` ist Stand 11.07.2026 NOCH NICHT gesetzt (Josip besorgt
 * ihn parallel, siehe PHASENSTATUS.md "Phase 3 — KI", Entscheidung 1).
 * Dieser Zustand ist AKTUELL ERWARTET, kein Bug — deshalb eine klare
 * deutsche Fehlermeldung statt Absturz/kryptischem Fetch-Fehler. Aufrufer
 * (Block 2: Embed-Job, Block 3: semantische Suche, Block 4: Tutor-RAG)
 * müssen diesen Fehler abfangen und die jeweilige Funktion als "aktuell
 * nicht verfügbar" behandeln, statt die ganze Anfrage abstürzen zu lassen.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = getServerEnv().VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Voyage-AI-Key noch nicht konfiguriert, semantische Suche/Tutor nicht verfügbar.",
    );
  }
  if (texts.length === 0) return [];

  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: texts, model: VOYAGE_MODEL }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Voyage-AI-Anfrage fehlgeschlagen (${response.status}): ${detail || response.statusText}`,
    );
  }

  const json = (await response.json()) as {
    data: { embedding: number[]; index: number }[];
  };

  // Voyage garantiert die Antwortreihenfolge nicht explizit im Dokument —
  // sicherer, über `index` zu sortieren, statt der Array-Reihenfolge blind
  // zu vertrauen (sonst könnten Embeddings versehentlich falschen Chunks
  // zugeordnet werden).
  return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
