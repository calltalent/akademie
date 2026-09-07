-- Builder-Auftrag 07.09.2026 (tester-Fund, siehe PHASENSTATUS.md):
-- moveModule/moveSection/moveQuestion (src/lib/courses/actions.ts,
-- src/lib/quiz/actions.ts) tauschen die `position` zweier Zeilen über ZWEI
-- getrennte, nicht-atomare update()-Aufrufe. Schlägt der zweite fehl
-- (Netzwerkfehler, abgelaufene Session zwischen den beiden Requests), teilen
-- sich zwei Zeilen dauerhaft dieselbe Position, ohne dass irgendjemand das
-- erfährt — der App-Code prüft inzwischen wenigstens die Fehler beider
-- Aufrufe (siehe Commits vom 07.09.2026), aber "geprüft" heilt keinen bereits
-- halb ausgeführten Tausch, es meldet ihn nur.
--
-- Diese drei Funktionen ziehen den Tausch in EINE Datenbankanweisung (einen
-- RPC-Aufruf = eine implizite Transaktion) — schlägt irgendein Teil fehl,
-- wird die GESAMTE Funktion zurückgerollt, nie ein halb ausgeführter Tausch.
--
-- Bewusst DREI eigene Funktionen statt einer generischen mit Tabellennamen
-- als Parameter: dynamisches SQL mit interpoliertem Tabellennamen würde
-- CLAUDE.md §2.12 verletzen ("keine String-Konkatenation von Nutzereingaben
-- in SQL/Query-Bausteinen — auch bei dynamisch gebauten Filtern"). Jede
-- Funktion ist fest auf ihre Tabelle verdrahtet, kein dynamisches SQL nötig.
--
-- `security definer`, weil der Tausch RLS umgeht (zwei UPDATEs auf fremde
-- Positionswerte) — deshalb der explizite `public.is_staff(p_tenant_id)`-
-- Check als ERSTE Anweisung, bevor irgendetwas gelesen/geschrieben wird.
-- Beide Zeilen werden zusätzlich per `tenant_id` gefiltert (Defense-in-
-- Depth, gleiche Linie wie der bisherige App-Code) — eine ID aus einem
-- FREMDEN Mandanten liefert schlicht "nicht gefunden" statt eines Tauschs
-- über Mandantengrenzen hinweg.
--
-- ABSICHTLICH NUR GESCHRIEBEN, NICHT ANGEWENDET UND NICHT VERDRAHTET
-- (Builder-Auftrag, Begründung im Bericht an tester/Josip): der Auftrag
-- erlaubt diese Migration ausdrücklich als optionale Verbesserung
-- ("wenn du den Tausch atomar machen willst"). Sie in `moveModule`/
-- `moveSection`/`moveQuestion` zu verdrahten, BEVOR Josip sie mit
-- `supabase db push` anwendet, hätte diese aktuell funktionierenden
-- Auf/Ab-Knöpfe bis zur Anwendung komplett lahmgelegt (die RPC existiert in
-- der Live-DB schlicht noch nicht) — das verletzt Regel 5
-- ("nach jedem Feature lauffähiger Zustand"). Sobald Josip diese Migration
-- anwendet, ist das Verdrahten in den drei genannten Funktionen ein
-- kleiner Folge-Commit (swap-Block durch einen `.rpc(...)`-Aufruf ersetzen).

create or replace function public.swap_module_positions(p_tenant_id uuid, p_id_a uuid, p_id_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pos_a int;
  pos_b int;
begin
  if not public.is_staff(p_tenant_id) then
    raise exception 'not authorized';
  end if;

  select position into pos_a from public.modules where id = p_id_a and tenant_id = p_tenant_id;
  select position into pos_b from public.modules where id = p_id_b and tenant_id = p_tenant_id;
  if pos_a is null or pos_b is null then
    raise exception 'module not found for tenant';
  end if;

  update public.modules set position = pos_b where id = p_id_a and tenant_id = p_tenant_id;
  update public.modules set position = pos_a where id = p_id_b and tenant_id = p_tenant_id;
end;
$$;

create or replace function public.swap_section_positions(p_tenant_id uuid, p_id_a uuid, p_id_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pos_a int;
  pos_b int;
begin
  if not public.is_staff(p_tenant_id) then
    raise exception 'not authorized';
  end if;

  select position into pos_a from public.sections where id = p_id_a and tenant_id = p_tenant_id;
  select position into pos_b from public.sections where id = p_id_b and tenant_id = p_tenant_id;
  if pos_a is null or pos_b is null then
    raise exception 'section not found for tenant';
  end if;

  update public.sections set position = pos_b where id = p_id_a and tenant_id = p_tenant_id;
  update public.sections set position = pos_a where id = p_id_b and tenant_id = p_tenant_id;
end;
$$;

create or replace function public.swap_question_positions(p_tenant_id uuid, p_id_a uuid, p_id_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pos_a int;
  pos_b int;
begin
  if not public.is_staff(p_tenant_id) then
    raise exception 'not authorized';
  end if;

  select position into pos_a from public.questions where id = p_id_a and tenant_id = p_tenant_id;
  select position into pos_b from public.questions where id = p_id_b and tenant_id = p_tenant_id;
  if pos_a is null or pos_b is null then
    raise exception 'question not found for tenant';
  end if;

  update public.questions set position = pos_b where id = p_id_a and tenant_id = p_tenant_id;
  update public.questions set position = pos_a where id = p_id_b and tenant_id = p_tenant_id;
end;
$$;

revoke execute on function public.swap_module_positions(uuid, uuid, uuid) from public;
revoke execute on function public.swap_section_positions(uuid, uuid, uuid) from public;
revoke execute on function public.swap_question_positions(uuid, uuid, uuid) from public;
grant execute on function public.swap_module_positions(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.swap_section_positions(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.swap_question_positions(uuid, uuid, uuid) to authenticated, service_role;
