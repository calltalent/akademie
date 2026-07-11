import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { embedTexts } from "@/lib/ai/voyage";
import { recordAiJob } from "@/lib/ai/usage";
import { VOYAGE_MODEL } from "@/lib/ai/config";
import { chunkText, extractLessonText } from "@/lib/ai/chunk";
import { blocksSchema, type Block } from "@/lib/courses/schema";

/**
 * Embed-Job für Lektionen (Phase 3, Block 2 — Embeddings/pgvector-
 * Fundament). Schreibt in `public.embeddings`, Grundlage für die
 * semantische Suche (Block 3) und den Tutor-RAG (Block 4).
 *
 * ADMIN-CLIENT-BEGRÜNDUNG (wie beim Vorabcheck von `0001_init.sql`
 * gefordert geprüft): `embeddings` hat laut 0001_init.sql (Zeilen 552-554)
 * ausschließlich die Policy `embeddings_member_select` — Lesen für
 * Mandanten-Mitglieder, KEINE INSERT/UPDATE/DELETE-Policy für irgendeine
 * Rolle (Kommentar dort: "Schreiben nur service_role"). Embedding-Schreiben
 * ist ein Staff-/System-Vorgang, läuft deshalb komplett über den
 * Admin-Client.
 *
 * ZWEITES SICHERHEITSNETZ (wie im Auftrag verlangt): `tenantId` kommt in
 * `embedLesson`/`embedCourse` IMMER aus dem bereits geprüften Aufrufkontext
 * des jeweiligen Aufrufers (`reembedCourse()` in `actions.ts`, das
 * `requireStaffTenant()` UND eine explizite courseId->tenant-Prüfung
 * durchführt) — NIE aus der geladenen Lektion/dem geladenen Kurs selbst.
 * Jede Lade-Query filtert zusätzlich explizit `.eq("tenant_id", tenantId)`,
 * damit ein falsch weitergereichtes `tenantId` (Programmfehler an anderer
 * Stelle) nicht versehentlich fremde Mandanten-Inhalte einbettet.
 *
 * KEIN `enforceQuota()`-Aufruf hier (bewusste Abgrenzung, wie im Auftrag
 * vorgegeben): Embedding ist NICHT Teil von `PLAN_AI_LIMITS`
 * (`src/lib/ai/config.ts`) — diese Grenzen decken ausschließlich
 * `tutorAnswers`/`courseGens` ab (siehe `usage_counters`-Spalten). Die
 * Kostenbremse für Embedding-Aufrufe ist ausschließlich das Rate-Limiting
 * auf `reembedCourse()` in `actions.ts` (10 Aufrufe/Stunde/Mandant).
 *
 * TOKEN-SCHÄTZUNG (dokumentierte Näherung): Voyage AI liefert in der
 * Response-Form, die `voyage.ts` konsumiert (`{ data: { embedding, index
 * }[] }`), KEINE Tokenanzahl zurück (geprüft: kein `usage`-Feld verarbeitet).
 * `estimateTokens()` nähert deshalb grob über `Zeichen / 4` (gängige
 * Faustregel für europäische Sprachen) — für die Kostenprotokollierung in
 * `ai_jobs` ausreichend genau, aber explizit als Schätzung markiert, nicht
 * als exakter Wert.
 */

const DUMMY_UUID = "00000000-0000-0000-0000-000000000000";

/** Grobe Tokens-Schätzung, siehe Dateikopf-Kommentar — Voyage liefert keine
 *  Tokenzahl im aktuellen `voyage.ts`-Response-Format. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function embedLesson(
  lessonId: string,
  tenantId: string,
): Promise<{ chunksWritten: number }> {
  const admin = createAdminClient();

  // (a) Lektion laden — inkl. Mandantenprüfung (Defense-in-Depth, siehe
  // Dateikopf).
  const { data: lesson, error: lessonError } = await admin
    .from("lessons")
    .select("id, tenant_id, module_id, blocks")
    .eq("id", lessonId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (lessonError || !lesson) {
    throw new Error("Lektion nicht gefunden oder falscher Mandant.");
  }

  // `lessons` hat keine eigene `course_id`-Spalte (nur `module_id`) —
  // course_id kommt über `modules.course_id`, siehe 0001_init.sql Zeilen
  // 101-109/111-126. Zusätzliche Mandantenprüfung auch hier.
  const { data: moduleRow, error: moduleError } = await admin
    .from("modules")
    .select("course_id")
    .eq("id", lesson.module_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (moduleError || !moduleRow) {
    throw new Error("Modul der Lektion nicht gefunden oder falscher Mandant.");
  }
  const courseId = moduleRow.course_id as string;

  // (b) Blocks zod-validieren (Eingabegrenze CLAUDE.md §2.3 — `blocks` kommt
  // hier aus der DB, nicht direkt vom Client, aber die Spalte ist `jsonb`
  // ohne DB-seitige Struktur-Prüfung; ein `safeParse` schützt vor Absturz
  // bei künftig abweichenden/älteren Datensätzen statt blind zu casten).
  const parsedBlocks = blocksSchema.safeParse(lesson.blocks ?? []);
  const blocks: Block[] = parsedBlocks.success ? parsedBlocks.data : [];

  // (c) Text extrahieren + chunken (reine Funktionen aus chunk.ts).
  const fullText = extractLessonText(blocks);
  const chunks = chunkText(fullText);

  // (d) Sauberer Re-Embed: bestehende Chunks dieser Lektion zuerst löschen
  // (kein Zombie-Chunk-Müll bei Textänderungen) — einfacher als ein
  // Upsert-Diff; `unique(lesson_id, chunk_index)` verhindert zwar ohnehin
  // Duplikate bei gleicher Chunk-Anzahl, aber nicht das Übrigbleiben
  // überzähliger alter Chunks, wenn der neue Text WENIGER Chunks braucht.
  const { error: deleteError } = await admin
    .from("embeddings")
    .delete()
    .eq("lesson_id", lessonId)
    .eq("tenant_id", tenantId);
  if (deleteError) {
    throw new Error(`Alte Embeddings konnten nicht gelöscht werden: ${deleteError.message}`);
  }

  if (chunks.length === 0) {
    // Lektion hat (mehr) keinen embedbaren Text — sauber geleert, nichts
    // Neues zu schreiben. Kein Fehler.
    return { chunksWritten: 0 };
  }

  // (e) Embeddings via Voyage AI erzeugen. Fehler werden protokolliert
  // (status: "error") UND weitergeworfen, damit `embedCourse()`/
  // `reembedCourse()` den Fehlschlag sichtbar machen können.
  let vectors: number[][];
  try {
    vectors = await embedTexts(chunks);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unbekannter Voyage-Fehler.";
    await recordAiJob({
      tenantId,
      kind: "embed",
      model: VOYAGE_MODEL,
      tokensIn: estimateTokens(chunks.join("\n")),
      tokensOut: 0,
      status: "error",
      input: { lessonId, courseId, chunkCount: chunks.length },
      error: message,
    });
    throw e;
  }

  const rows = chunks.map((content, index) => ({
    tenant_id: tenantId,
    course_id: courseId,
    lesson_id: lessonId,
    chunk_index: index,
    content,
    embedding: vectors[index],
  }));

  const { error: insertError } = await admin.from("embeddings").insert(rows);
  if (insertError) {
    await recordAiJob({
      tenantId,
      kind: "embed",
      model: VOYAGE_MODEL,
      tokensIn: estimateTokens(chunks.join("\n")),
      tokensOut: 0,
      status: "error",
      input: { lessonId, courseId, chunkCount: chunks.length },
      error: insertError.message,
    });
    throw new Error(`Embeddings konnten nicht gespeichert werden: ${insertError.message}`);
  }

  // (f) Kostenprotokoll bei Erfolg (CLAUDE.md §3.7).
  await recordAiJob({
    tenantId,
    kind: "embed",
    model: VOYAGE_MODEL,
    tokensIn: estimateTokens(chunks.join("\n")),
    tokensOut: 0,
    status: "done",
    input: { lessonId, courseId, chunkCount: chunks.length },
    output: { chunksWritten: rows.length },
  });

  return { chunksWritten: rows.length };
}

/**
 * Embedded alle Lektionen eines Kurses nacheinander (bewusst SEQUENTIELL,
 * nicht parallel — vermeidet, den Voyage-API-Rahmen/-Rate-Limit mit vielen
 * gleichzeitigen Anfragen aus einem einzigen Staff-Klick zu belasten;
 * einfachste Lösung, die Kostenkontrolle bleibt zusätzlich beim
 * Rate-Limiting auf `reembedCourse()`). Ein einzelner Lektions-Fehlschlag
 * lässt die gesamte Operation abbrechen (kein teilweises, unklares
 * Zwischenergebnis) — der Aufrufer (`reembedCourse()`) fängt den Fehler ab
 * und meldet ihn dem Staff-Nutzer.
 */
export async function embedCourse(
  courseId: string,
  tenantId: string,
): Promise<{ lessonsEmbedded: number; chunksWritten: number }> {
  const admin = createAdminClient();

  const { data: modules, error: modulesError } = await admin
    .from("modules")
    .select("id")
    .eq("course_id", courseId)
    .eq("tenant_id", tenantId);
  if (modulesError) {
    throw new Error(`Module konnten nicht geladen werden: ${modulesError.message}`);
  }
  const moduleIds = (modules ?? []).map((m) => m.id);

  if (moduleIds.length === 0) {
    return { lessonsEmbedded: 0, chunksWritten: 0 };
  }

  const { data: lessons, error: lessonsError } = await admin
    .from("lessons")
    .select("id")
    .in("module_id", moduleIds.length > 0 ? moduleIds : [DUMMY_UUID])
    .eq("tenant_id", tenantId);
  if (lessonsError) {
    throw new Error(`Lektionen konnten nicht geladen werden: ${lessonsError.message}`);
  }

  let lessonsEmbedded = 0;
  let chunksWritten = 0;
  for (const lesson of lessons ?? []) {
    const result = await embedLesson(lesson.id, tenantId);
    lessonsEmbedded += 1;
    chunksWritten += result.chunksWritten;
  }

  return { lessonsEmbedded, chunksWritten };
}
