import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { embedTexts } from "@/lib/ai/voyage";
import { translateDbError } from "@/lib/errors/db";

/**
 * Semantische Ähnlichkeitssuche über `embeddings` (Phase 3, Block 2 —
 * Embeddings/pgvector-Fundament). Grundlage für `/suche` (Block 3) und den
 * Tutor-RAG-Kontext (Block 4).
 *
 * VERTRAG FÜR AUFRUFER (Block 3/4, wie im Auftrag verlangt hier
 * dokumentiert): `retrieveChunks()` vertraut darauf, dass `courseIds` VOM
 * AUFRUFER bereits korrekt auf die für den anfragenden Nutzer sichtbaren/
 * erlaubten Kurse eingeschränkt wurde (z. B. nur veröffentlichte Kurse, nur
 * Kurse mit Enrollment — je nach Block-3/4-Anforderung, hier noch nicht
 * festgelegt). Diese Funktion selbst prüft KEINE Sichtbarkeit — sie ist
 * reines Retrieval. Ein leeres `courseIds`-Array liefert sofort ein leeres
 * Ergebnis, OHNE die `match_embeddings`-RPC überhaupt aufzurufen (spart
 * einen unnötigen Voyage-Embedding-Call für die Suchanfrage selbst).
 *
 * ADMIN-CLIENT-BEGRÜNDUNG: `match_embeddings` hat laut
 * `20260711150000_match_embeddings.sql` Grants NUR für `service_role` —
 * über den regulären RLS-Client (Session eines eingeloggten Nutzers) ist
 * die RPC gar nicht aufrufbar. Die eigentliche Sicherheitslogik (Filterung
 * auf `p_tenant`/`p_course_ids`, siehe Migration) liegt bereits INNERHALB
 * der RPC selbst (harter WHERE-Filter, nicht nur RLS).
 */

export type RetrievedChunk = {
  lessonId: string;
  courseId: string;
  chunkIndex: number;
  content: string;
  similarity: number;
};

type MatchEmbeddingsRow = {
  lesson_id: string;
  course_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
};

const DEFAULT_K = 6;

export async function retrieveChunks(params: {
  tenantId: string;
  courseIds: string[];
  query: string;
  k?: number;
}): Promise<RetrievedChunk[]> {
  const { tenantId, courseIds, query, k } = params;

  if (courseIds.length === 0) return [];

  const [queryVector] = await embedTexts([query]);
  if (!queryVector) return [];

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("match_embeddings", {
    p_tenant: tenantId,
    p_course_ids: courseIds,
    p_query: queryVector,
    p_k: k ?? DEFAULT_K,
  });

  if (error) {
    // error.message ist eine rohe Postgres-/RPC-Fehlermeldung (technisch/
    // englisch) — Detail nur loggen, die geworfene Meldung bekommt einen
    // klaren deutschen Satz. Aufrufer (search.ts, tutor/actions.ts) fangen
    // diesen Fehler ohnehin ab und zeigen eine eigene generische Meldung,
    // dieser Text ist die letzte Verteidigungslinie.
    console.error("[ai/retrieve] match_embeddings-RPC fehlgeschlagen.", { tenantId, error: error.message });
    throw new Error(`Semantische Suche fehlgeschlagen: ${translateDbError(error)}`);
  }

  return ((data ?? []) as MatchEmbeddingsRow[]).map((row) => ({
    lessonId: row.lesson_id,
    courseId: row.course_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    similarity: row.similarity,
  }));
}
