-- Phase 3, Block 2 (Embeddings/pgvector-Fundament) — semantische
-- Aehnlichkeitssuche ueber public.embeddings. Neue Migration statt
-- 0001_init.sql aendern (CLAUDE.md §2.1) — embeddings existiert bereits
-- vollstaendig mit RLS (embeddings_member_select), hier nur eine neue
-- Funktion.
--
-- Vorabpruefung 0001_init.sql (wie vorgeschrieben zuerst gelesen):
-- embeddings(id, tenant_id, course_id, lesson_id, chunk_index, content,
-- embedding vector(1024), unique(lesson_id, chunk_index)), Indizes
-- embeddings_tenant_idx/embeddings_course_idx/embeddings_vec_idx (hnsw,
-- vector_cosine_ops) — exakt wie vom architect-Plan erwartet, keine
-- Abweichung bei Spaltennamen/Constraints.
--
-- Vorgezeichneter Kommentar-Entwurf aus 0001_init.sql (Zeilen 601-603) als
-- Ausgangsbasis uebernommen: "match_embeddings(tenant, course_ids,
-- query_vector, k) als security definer mit Enrollment-Pruefung." Bewusste,
-- dokumentierte Abweichung vom Wortlaut "Enrollment-Pruefung": diese RPC
-- prueft NICHT selbst, welche Kurse ein Nutzer sehen darf — das passiert
-- VORHER in TypeScript (src/lib/ai/retrieve.ts), der Aufrufer uebergibt
-- bereits die Menge der fuer den anfragenden Nutzer erlaubten course_ids.
-- Begruendung: die RPC ist security definer, Grants ausschliesslich
-- service_role, wird nie direkt von einem eingeloggten Nutzer aufgerufen —
-- eine zusaetzliche Sichtbarkeitspruefung INNERHALB der RPC waere doppelte
-- Business-Logik in SQL UND TypeScript und koennte bei kuenftigen
-- Sichtbarkeitsregeln (z. B. "nur veroeffentlichte Kurse" vs. "nur Kurse
-- mit Enrollment", je nach Block-3/4-Anforderung) auseinanderlaufen.
--
-- Zusaetzlicher Fund bei der Vorabpruefung (Migration 20260710205205_
-- hardening2.sql): die vector-Extension wurde aus dem public-Schema in ein
-- dediziertes extensions-Schema verschoben. Der Parametertyp wird deshalb
-- explizit als extensions.vector(1024) qualifiziert (nicht nur "vector") —
-- verlaesst sich nicht auf einen zufaelligen search_path zum Zeitpunkt der
-- Migrationsanwendung. Aus demselben Grund steht "extensions" zusaetzlich zu
-- "public" im search_path der Funktion, damit der <=>-Operator (ebenfalls in
-- extensions definiert) im Funktionskoerper aufloesbar ist.
--
-- KRITISCH (zentrale Sicherheitsanforderung dieses Blocks): RLS
-- embeddings_member_select (nur "ist Mandanten-Mitglied") reicht als
-- alleiniger Schutz fuer die pgvector-HNSW-Aehnlichkeitssuche NICHT aus —
-- security definer-Funktionen umgehen RLS ohnehin vollstaendig. Deshalb
-- filtert die Query selbst hart auf tenant_id UND course_id (WHERE-Klausel
-- in der SQL-Query, nicht nur ueber RLS), BEVOR der HNSW-Index sortiert —
-- kein fremder Mandanten-Chunk darf ueberhaupt in die Kandidatenmenge
-- gelangen (Sicherheit UND Performance).
create or replace function public.match_embeddings(
  p_tenant uuid,
  p_course_ids uuid[],
  p_query extensions.vector(1024),
  p_k int
)
returns table (
  lesson_id   uuid,
  course_id   uuid,
  chunk_index int,
  content     text,
  similarity  float
)
language sql stable security definer
set search_path = public, extensions
as $$
  select
    e.lesson_id,
    e.course_id,
    e.chunk_index,
    e.content,
    1 - (e.embedding <=> p_query) as similarity
  from public.embeddings e
  where e.tenant_id = p_tenant
    and e.course_id = any(p_course_ids)
  order by e.embedding <=> p_query
  limit p_k;
$$;

-- Grants NUR service_role — gleiches Muster wie increment_usage
-- (20260711140000_ai_quota.sql): normale Nutzer (auch Staff) rufen diese
-- RPC nie direkt auf, nur ueber src/lib/ai/retrieve.ts mit dem Admin-Client.
-- Die Sicherheitslogik "welche Kurse sind fuer wen sichtbar" ist bereits
-- VOR dem RPC-Aufruf in TypeScript geprueft — die RPC selbst vertraut blind
-- auf die uebergebene p_course_ids-Liste.
revoke all on function public.match_embeddings(uuid, uuid[], extensions.vector, int) from public;
grant execute on function public.match_embeddings(uuid, uuid[], extensions.vector, int) to service_role;
