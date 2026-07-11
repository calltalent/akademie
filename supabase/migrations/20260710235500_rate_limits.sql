-- Security-Fix (security-reviewer-Audit 11.07.2026, MITTEL): kein Rate
-- Limiting auf Auth-/API-Routen. Leichtgewichtiger Postgres-Limiter statt
-- neuem externen Dienst (kein Redis/Upstash im Stack, siehe CLAUDE.md §1) -
-- fuer Phase-1-Traffic ausreichend, spaeter bei Bedarf durch Cloudflare
-- Rate Limiting (WAF-Ebene, kein Code) ergaenzbar.
create table public.rate_limits (
  key         text primary key,
  window_start timestamptz not null default now(),
  count       int not null default 0
);

-- Nur service_role darf lesen/schreiben - App ruft ausschliesslich ueber
-- die RPC unten zu, nie direkt.
alter table public.rate_limits enable row level security;

-- check_rate_limit: atomarer Zaehler pro Key innerhalb eines Zeitfensters.
-- Gibt true zurueck, wenn die Anfrage erlaubt ist (Limit nicht erreicht),
-- sonst false. security definer, damit die App sie ueber den normalen
-- (anon/authenticated) Client aufrufen kann, ohne rate_limits direkt lesen
-- zu muessen.
create or replace function public.check_rate_limit(p_key text, p_max_requests int, p_window_seconds int)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_row public.rate_limits;
  v_allowed boolean;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
      when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
        then 1
      else public.rate_limits.count + 1
    end,
    window_start = case
      when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
        then now()
      else public.rate_limits.window_start
    end
  returning * into v_row;

  v_allowed := v_row.count <= p_max_requests;
  return v_allowed;
end;
$$;

revoke all on function public.check_rate_limit(text, int, int) from public;
grant execute on function public.check_rate_limit(text, int, int) to anon, authenticated, service_role;
