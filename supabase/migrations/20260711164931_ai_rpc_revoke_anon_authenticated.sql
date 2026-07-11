-- Sicherheitskorrektur, gefunden beim Advisor-Check direkt nach Anwendung
-- von ai_quota + match_embeddings (11.07.2026): "revoke all ... from public"
-- in den urspruenglichen Migrationen reicht bei Supabase NICHT aus, um
-- anon/authenticated auszuschliessen. Supabase setzt beim Anlegen neuer
-- Funktionen im public-Schema per ALTER DEFAULT PRIVILEGES automatisch
-- EXECUTE-Grants fuer anon UND authenticated (unabhaengig vom PUBLIC-
-- Pseudo-Rollen-Revoke). Der Advisor bestaetigte: beide Rollen konnten
-- increment_usage UND match_embeddings direkt ueber /rest/v1/rpc/... ohne
-- jede serverseitige Pruefung aufrufen — bei match_embeddings ein
-- KRITISCHER cross-tenant Datenleck (jeder anonyme Aufrufer haette per
-- frei waehlbarem p_tenant/p_course_ids fremde Lektionsinhalte auslesen
-- koennen), bei increment_usage eine Kontingent-Manipulation fremder
-- Mandanten (frei waehlbares p_limit).
revoke execute on function public.increment_usage(uuid, text, int) from anon, authenticated;
revoke execute on function public.match_embeddings(uuid, uuid[], extensions.vector, int) from anon, authenticated;
