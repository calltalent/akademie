import "server-only";
import { createClient } from "@/lib/supabase/server";
import { retrieveChunks } from "@/lib/ai/retrieve";

/**
 * Semantische Suche über den kompletten sichtbaren Kursinhalt eines
 * Mandanten (Phase 3, Block 3 — `/suche`). Baut auf `retrieveChunks()`
 * (Block 2) auf.
 *
 * SICHERHEITSKRITISCHER NACHFILTER (Grund, warum diese Datei existiert und
 * nicht direkt `retrieveChunks()` in der Page verwendet wird):
 * `embedLesson()`/`embedCourse()` (Block 2) embedden JEDE Lektion eines
 * Kurses, UNABHÄNGIG von deren `status` — auch Entwurfs-Lektionen, wenn ein
 * Staff-Mitglied „Kurs für KI-Suche einbetten" auf einen Kurs mit gemischtem
 * Lektionsstatus klickt. Die `embeddings`-Tabelle selbst hat keine
 * `status`-Spalte. Ohne die Prüfung unten könnte ein Treffer aus einer
 * unveröffentlichten Entwurfs-Lektion an ein normales Mandanten-Mitglied
 * ausgeliefert werden (Informationsleck). Deshalb wird für jeden von
 * `retrieveChunks()` zurückgegebenen Treffer der AKTUELLE DB-Stand von
 * `lessons.status` UND `courses.status` erneut geprüft — nicht der Stand
 * zum Zeitpunkt des Embeddings. Ein Treffer, dessen Lektion oder Kurs nicht
 * (mehr) `published` ist, wird verworfen, bevor der Nutzer ihn sieht.
 *
 * Alle Datenbankzugriffe laufen über den regulären RLS-Client (Session des
 * angemeldeten Nutzers) — das ist hier ausreichend und kein Admin-Client
 * nötig, weil es sich um ganz normale Leseanfragen eines eingeloggten
 * Mandanten-Mitglieds handelt (RLS `courses_member_select` greift bereits
 * korrekt für Schritt a, und die Lektions-/Kurs-Nachladung in Schritt c
 * fragt nur nach Zeilen, die ohnehin sichtbar sein müssen).
 */

export type SearchResult = {
  lessonId: string;
  lessonTitle: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  snippet: string;
  similarity: number;
};

const RETRIEVE_K = 8;
const SNIPPET_MAX_LENGTH = 200;

function buildSnippet(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= SNIPPET_MAX_LENGTH) return trimmed;

  const cut = trimmed.slice(0, SNIPPET_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const safeCut = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${safeCut}…`;
}

export async function searchLessons(params: {
  tenantId: string;
  userId: string;
  query: string;
}): Promise<SearchResult[]> {
  const { tenantId, query } = params;

  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) return [];

  const supabase = await createClient();

  // a) Für den Mandanten sichtbare, veröffentlichte Kurs-IDs (RLS
  // courses_member_select greift bereits korrekt).
  const { data: visibleCourses } = await supabase
    .from("courses")
    .select("id, title, slug, status")
    .eq("tenant_id", tenantId)
    .eq("status", "published");

  const courseIds = (visibleCourses ?? []).map((c) => c.id);
  if (courseIds.length === 0) return [];

  // b) Retrieval — etwas großzügigeres k als der spätere Tutor-RAG, da hier
  // noch nachgefiltert wird und Treffer durch den Sichtbarkeits-Filter unten
  // wegfallen können.
  const chunks = await retrieveChunks({
    tenantId,
    courseIds,
    query: trimmedQuery,
    k: RETRIEVE_K,
  });
  if (chunks.length === 0) return [];

  // c) Sicherheitskritischer Nachfilter: aktueller DB-Stand, nicht der Stand
  // zum Zeitpunkt des Embeddings.
  const lessonIds = Array.from(new Set(chunks.map((c) => c.lessonId)));
  const { data: currentLessons } = await supabase
    .from("lessons")
    .select("id, title, status, module_id")
    .eq("tenant_id", tenantId)
    .in("id", lessonIds)
    .eq("status", "published");

  const publishedLessonById = new Map((currentLessons ?? []).map((l) => [l.id, l]));
  if (publishedLessonById.size === 0) return [];

  const remainingCourseIds = Array.from(
    new Set(
      chunks
        .filter((c) => publishedLessonById.has(c.lessonId))
        .map((c) => c.courseId),
    ),
  );
  const { data: currentCourses } = await supabase
    .from("courses")
    .select("id, title, slug, status")
    .eq("tenant_id", tenantId)
    .in("id", remainingCourseIds)
    .eq("status", "published");

  const publishedCourseById = new Map((currentCourses ?? []).map((c) => [c.id, c]));

  const results: SearchResult[] = [];
  for (const chunk of chunks) {
    const lesson = publishedLessonById.get(chunk.lessonId);
    if (!lesson) continue; // Lektion nicht (mehr) veröffentlicht

    const course = publishedCourseById.get(chunk.courseId);
    if (!course) continue; // Kurs nicht (mehr) veröffentlicht

    results.push({
      lessonId: chunk.lessonId,
      lessonTitle: lesson.title,
      courseId: chunk.courseId,
      courseTitle: course.title,
      courseSlug: course.slug,
      snippet: buildSnippet(chunk.content),
      similarity: chunk.similarity,
    });
  }

  // e) Nicht deduplizieren (verschiedene Chunks derselben Lektion können
  // beide relevant sein) — nach Ähnlichkeit absteigend sortieren.
  results.sort((a, b) => b.similarity - a.similarity);
  return results;
}
