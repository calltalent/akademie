-- Phase 3, Block 1 (KI-Fundament) — Kontingent-Durchsetzung fuer Tutor-
-- Antworten und Kursgenerierungen. Neue Migration statt 0001_init.sql
-- aendern (CLAUDE.md §2.1: "Jede neue Tabelle/Spalte: eigene Migration mit
-- RLS im selben Schritt. Niemals 0001_init.sql aendern." — hier keine neue
-- Tabelle/Spalte noetig, `usage_counters` existiert bereits vollstaendig
-- mit RLS in 0001_init.sql, nur eine neue Funktion).
--
-- increment_usage: atomarer, race-condition-sicherer Upsert+Increment auf
-- usage_counters. `security definer`, damit normale (authenticated) Nutzer
-- sie NIE direkt aufrufen koennen — `usage_counters` hat laut 0001_init.sql
-- nur `usage_staff_select` (Lesen fuer Staff), keine INSERT/UPDATE-Policy
-- fuer irgendeine Rolle (Kommentar Z. 576-578: "Schreiben nur service_role").
-- Einziger Schreibweg ist diese RPC, aufgerufen ausschliesslich ueber den
-- Admin-Client (service_role) aus src/lib/ai/usage.ts — Vertrag: dort MUSS
-- enforceQuota() vor jedem kostenpflichtigen KI-Aufruf laufen (siehe
-- Dateikopf-Kommentar dort).
--
-- Race-Condition-Sicherheit: EIN INSERT ... ON CONFLICT ... DO UPDATE ...
-- WHERE-Statement pro Aufruf (kein separates SELECT davor, kein
-- Read-then-Write in zwei Schritten). Die WHERE-Klausel im DO-UPDATE-Zweig
-- wird von Postgres gegen die bereits gesperrte Konfliktzeile ausgewertet —
-- zwei parallele Aufrufe auf denselben (tenant_id, month)-Schluessel werden
-- dadurch serialisiert; der zweite sieht garantiert den bereits erhoehten
-- Stand des ersten. Ist die WHERE-Bedingung falsch, wird NICHTS aktualisiert
-- und die Zeile erscheint nicht im RETURNING-Ergebnis — genau das nutzen wir,
-- um "erlaubt"/"Limit erreicht" ohne zweite Abfrage zu unterscheiden.
--
-- Annahme (dokumentiert wie in CLAUDE.md §4.5 gefordert): p_limit ist immer
-- >= 1 (kleinstes konfiguriertes Kontingent laut PHASENSTATUS.md ist
-- trial: 20/1) — bei p_limit = 0 wuerde der allererste INSERT einer neuen
-- Monatszeile trotzdem auf 1 setzen (die WHERE-Klausel greift nur beim
-- ON-CONFLICT-Zweig, nicht beim reinen INSERT). Kein Praxisfall aktuell.
create or replace function public.increment_usage(p_tenant uuid, p_kind text, p_limit int)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now())::date;
  v_updated boolean;
begin
  if p_kind not in ('tutor', 'course_gen') then
    raise exception 'increment_usage: unbekannter kind %', p_kind;
  end if;

  if p_kind = 'tutor' then
    insert into public.usage_counters (tenant_id, month, tutor_answers)
    values (p_tenant, v_month, 1)
    on conflict (tenant_id, month) do update
      set tutor_answers = public.usage_counters.tutor_answers + 1
      where public.usage_counters.tutor_answers < p_limit
    returning true into v_updated;
  else
    insert into public.usage_counters (tenant_id, month, course_gens)
    values (p_tenant, v_month, 1)
    on conflict (tenant_id, month) do update
      set course_gens = public.usage_counters.course_gens + 1
      where public.usage_counters.course_gens < p_limit
    returning true into v_updated;
  end if;

  -- Kein Konflikt (erste Zeile des Monats) ODER Konflikt mit erfuellter
  -- WHERE-Bedingung -> v_updated = true. Konflikt mit bereits erschoepftem
  -- Kontingent -> RETURNING liefert keine Zeile -> v_updated bleibt NULL
  -- (PL/pgSQL-Standardverhalten bei 0 betroffenen Zeilen) -> coalesce zu false.
  return coalesce(v_updated, false);
end;
$$;

revoke all on function public.increment_usage(uuid, text, int) from public;
grant execute on function public.increment_usage(uuid, text, int) to service_role;
