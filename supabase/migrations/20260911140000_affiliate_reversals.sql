-- Affiliate-Modul, Block B5 "Storno, Chargeback und Wiedergutschrift"
-- (PLAN_Affiliate-System.md Abschnitt 5.8, 5.9 Beispiel C, 6.1 bis 6.3 und
-- 10/B5, 11.09.2026).
--
-- Diese Datei legt KEINE neue Tabelle an. Eine Gegenbuchung ist keine neue
-- Sache, sondern eine weitere Zeile in `public.affiliate_commissions` (G6:
-- "Es gibt bewusst keinen Status `reversed`"). Ergaenzt wird ausschliesslich
-- EINE Datenbankfunktion:
--
--   public.book_affiliate_reversals(jsonb)
--
-- Sie setzt VORAUS:
--   20260910120000_affiliate_core.sql        affiliate_programs,
--                                            affiliate_partners,
--                                            orders.refunded_cents,
--                                            orders.status 'partially_refunded';
--   20260911130000_affiliate_commissions.sql affiliate_commissions samt Guard,
--                                            book_affiliate_commissions(jsonb).
--
-- ANLASS
-- Eine Erstattung trifft immer MEHRERE Zeilen zugleich (`sale`, `reserve`,
-- `tier2`, bei Abos `recurring`/`recurring_reserve`), und der zu buchende
-- Betrag haengt an dem, was zu derselben Zeile bereits gegengebucht ist.
-- Genau daraus entsteht die Gefahr, gegen die es diese Funktion gibt: Stripe
-- zaehlt `charge.amount_refunded` KUMULATIV (G7). Zwei Teilerstattungen zu je
-- 100,00 EUR stellen also zwei Ereignisse mit den Staenden 10000 und 20000 zu.
-- Wer daraus zweimal denselben Anteil buchte, haette bei 44,5 % Erstattung
-- 60 % Provision storniert (Plan 5.9 Beispiel C). Das Verfahren ist deshalb
-- ein ZIELWERT je Zeile, und gebucht wird nur die Differenz zum bereits
-- Gegengebuchten.
--
-- Diese Differenz ist ein Lesen-Rechnen-Schreiben. Ohne Transaktion und
-- Sperre lesen zwei gleichzeitige Zustellungen denselben Stand und buchen
-- beide das volle Delta -- die Ueberstornierung, die dieser Block
-- ausschliessen soll. `unique (tenant_id, dedup_key)` faengt das NICHT: die
-- Schluessel der beiden Ereignisse sind verschieden, weil der kumulative
-- Stand im Schluessel steht. Deshalb diese Funktion und nicht ein zweiter
-- Aufruf von `book_affiliate_commissions()`.
--
-- ARBEITSTEILUNG MIT DEM TYPESCRIPT (bewusst, nicht aus Bequemlichkeit)
--   * Das VERHAELTNIS (`floor(zeile.amount_cents * kumulativ / charge)`)
--     rechnet `computeReversalDelta()` in `src/lib/affiliate/compute.ts`. Dort
--     steht es mit BigInt, weil das Produkt zweier Cent-Betraege ab rund
--     1 000 000,00 EUR Charge `Number.MAX_SAFE_INTEGER` uebersteigt und das
--     `floor` dann um einen Cent kippt -- genau den Restcent, den das
--     Zielwert-Verfahren ausschliessen soll. Ein Test haelt das fest.
--   * Die DIFFERENZ (`ziel - bereits`) rechnet diese Funktion, UNTER der
--     Sperre und aus frischem Stand. Das ist der einzige Ort, an dem sie
--     verlaesslich ist.
--   * Der Zielwert wird zusaetzlich auf `parent.amount_cents` GEDECKELT.
--     Damit ist die Ueberstornierung nicht nur eine Rechenregel, sondern eine
--     Eigenschaft der Datenbank: mehr als die Ursprungszeile kann auch ein
--     fehlerhafter Aufrufer nicht zuruecknehmen.
--   * Der STATUS-EIMER (G6) kommt vom Aufrufer, weil er eine fachliche Regel
--     ist ("pending erbt hold_until, approved/paid wird sofort approved") und
--     an genau einer Stelle stehen soll -- dort, wo sie ohne Datenbank
--     pruefbar ist (`inheritReversalState()` in reversal.ts). Hier wird nur
--     die Erlaubnisliste geprueft. Verschiebt sich der Status des Elternteils
--     zwischen Lesen und Buchen, heilt das der Freigabelauf: die
--     Gegenbuchung traegt dann ein `hold_until` in der Vergangenheit und wird
--     im naechsten Tick freigegeben.
--
-- WAS HIER NICHT STEHT
-- Die WIEDERGUTSCHRIFT (`kind='recredit'`, gewonnener Dispute) braucht keine
-- eigene Funktion: ihr Betrag ist die exakte Gegenzahl einer BEKANNTEN
-- Gegenbuchung, es gibt nichts zu summieren und nichts zu deckeln. Sie laeuft
-- deshalb ueber `book_affiliate_commissions()` mit `reverses_id` auf die
-- Gegenbuchung und `dedup_key = 'recredit:<reversal_id>:<dispute_id>'`.
-- Eine zweite Funktion mit demselben Rumpf waere eine zweite Stelle, an der
-- sich Spaltenlisten auseinanderentwickeln koennen.


-- =================================================================
-- 1. RPC book_affiliate_reversals(jsonb) -- Plan 5.8, G6, G7
-- =================================================================
-- ERWARTETE NUTZLAST:
--   {
--     "tenant_id": "<uuid>",
--     "lock_key":  "charge:<id>" | "dispute:<id>",
--     "rows": [
--       { "reverses_id": "<uuid der stornierten Zeile>",
--         "target_cents": 2647,          -- Zielwert aus computeReversalDelta()
--         "status": "pending",           -- G6, vom Elternteil geerbt
--         "hold_until": "2026-10-11T12:00:00Z",
--         "note": "Erstattung ...",      -- CHECK: reversal ohne note ist nicht schreibbar
--         "stripe_charge_id": "ch_123",  -- optional, sonst der Wert des Elternteils
--         "dedup_key": "reversal:<reverses_id>:<charge_id>:<kumulativ>" }
--     ]
--   }
-- RUECKGABE:
--   { "tenant_id": ..., "lock_key": ..., "booked": 2, "existing": 0,
--     "skipped": 1, "reversed_cents": 2940,
--     "rows": [ { "reverses_id": ..., "id": ..., "dedup_key": ...,
--                 "target_cents": 2647, "already_cents": 0,
--                 "amount_cents": -2647, "inserted": true,
--                 "skipped_reason": null }, ... ] }
--
-- OHNE `security definer` und ausschliesslich fuer `service_role`
-- ausfuehrbar (Plan 11.10). `service_role` traegt bereits `rolbypassrls`;
-- `security definer` waere eine Rechteverstaerkung ohne Gewinn. Gleiche
-- Bauart wie `book_affiliate_commissions()`.
create or replace function public.book_affiliate_reversals(p_payload jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_lock_key  text;
  v_rows      jsonb;
  v_row       jsonb;
  v_result    jsonb := '[]'::jsonb;
  v_booked    int := 0;
  v_existing  int := 0;
  v_skipped   int := 0;
  v_sum       bigint := 0;
  v_parent    public.affiliate_commissions%rowtype;
  v_reverses_id uuid;
  v_dedup_key text;
  v_note      text;
  v_status    text;
  v_hold_until timestamptz;
  v_target    int;
  v_already   int;
  v_delta     int;
  v_reason    text;
  v_id        uuid;
  v_was_new   boolean;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'affiliate_reversal_payload_invalid';
  end if;

  v_tenant_id := nullif(p_payload->>'tenant_id', '')::uuid;
  v_lock_key  := nullif(p_payload->>'lock_key', '');
  v_rows      := p_payload->'rows';

  if v_tenant_id is null or v_lock_key is null then
    raise exception 'affiliate_reversal_payload_incomplete';
  end if;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 then
    raise exception 'affiliate_reversal_rows_empty';
  end if;
  -- Derselbe Deckel wie in book_affiliate_commissions(): der groesste bekannte
  -- Stapel ist ein Vollstorno mit Zweitstufe ueber mehrere Abo-Raten.
  if jsonb_array_length(v_rows) > 50 then
    raise exception 'affiliate_reversal_rows_too_many';
  end if;

  -- DIE SPERRE. Dieselbe Klassenkennung wie in book_affiliate_commissions()
  -- und BEWUSST so: eine Buchung und eine Gegenbuchung desselben Vorgangs
  -- sollen sich gegenseitig serialisieren, nicht nur Gegenbuchung gegen
  -- Gegenbuchung. Sie wird beim Transaktionsende automatisch freigegeben.
  perform pg_advisory_xact_lock(
    hashtext('affiliate_commissions'),
    hashtext(v_tenant_id::text || '|' || v_lock_key)
  );

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    v_reverses_id := nullif(v_row->>'reverses_id', '')::uuid;
    v_dedup_key   := nullif(v_row->>'dedup_key', '');
    v_note        := nullif(v_row->>'note', '');
    v_status      := coalesce(nullif(v_row->>'status', ''), 'pending');
    v_hold_until  := nullif(v_row->>'hold_until', '')::timestamptz;
    v_reason      := null;
    v_id          := null;
    v_was_new     := false;
    v_already     := 0;
    v_delta       := 0;
    -- Zuruecksetzen, nicht nur ueberschreiben: uebersprungene Zeilen weisen
    -- sonst den Zielwert der VORIGEN Schleifenrunde aus.
    v_target      := null;

    if v_reverses_id is null or v_dedup_key is null then
      raise exception 'affiliate_reversal_row_incomplete';
    end if;
    -- Der CHECK der Tabelle verlangt `note is not null` fuer jede
    -- reversal-Zeile. Hier gibt es dafuer eine stabile Kennung statt einer
    -- Constraint-Meldung, die den Schluesselwert im Klartext truege.
    if v_note is null then
      raise exception 'affiliate_reversal_note_missing';
    end if;
    if v_hold_until is null then
      raise exception 'affiliate_reversal_hold_until_missing';
    end if;
    -- Erlaubnisliste statt Sperrliste. 'paid' und 'cancelled' sind hier
    -- unmoeglich: eine Gegenbuchung wird nie als ausgezahlt geboren (der Guard
    -- weist das ab), und eine stornierte Gegenbuchung waere eine Buchung, die
    -- nirgends zaehlt.
    if v_status not in ('pending', 'on_hold', 'approved') then
      raise exception 'affiliate_reversal_status_invalid';
    end if;
    if (v_row->>'target_cents') is null then
      raise exception 'affiliate_reversal_target_missing';
    end if;

    -- Plan 11.15: die Mandantenbindung JEDER client-gelieferten ID wird
    -- serverseitig nachgeprueft. `for no key update` sperrt zusaetzlich die
    -- Elternzeile: zwei Gegenbuchungen auf dieselbe Zeile serialisieren damit
    -- auch dann, wenn sie unter verschiedenen `lock_key` laufen (eine
    -- Erstattung und ein Dispute auf denselben Charge).
    -- `select *` ist hier richtig und widerspricht der Spalten-Regel des
    -- Moduls nicht: der Spalten-Grant gilt fuer `authenticated` ueber
    -- PostgREST; diese Funktion laeuft als `service_role` im Server. Mit
    -- `%rowtype` bleibt sie zugleich unabhaengig von der Spaltenreihenfolge.
    select * into v_parent
      from public.affiliate_commissions c
     where c.id = v_reverses_id and c.tenant_id = v_tenant_id
     for no key update;
    if not found then
      raise exception 'affiliate_reversal_parent_tenant_mismatch';
    end if;

    -- Erlaubnisliste der stornierbaren Arten (Plan 5.8). Eine Gegenbuchung
    -- auf eine Gegenbuchung waere eine Wiedergutschrift und laeuft ueber
    -- book_affiliate_commissions(); eine Handbuchung korrigiert ein Mensch in
    -- B6, nicht ein Stripe-Ereignis.
    if v_parent.kind not in ('sale', 'reserve', 'recurring', 'recurring_reserve', 'tier2') then
      raise exception 'affiliate_reversal_parent_kind_invalid';
    end if;

    -- Was nie werthaltig war, wird nicht zurueckgenommen: eine stornierte
    -- Zeile zaehlt in keinem Saldo (6.1), eine Testzeile ist per CHECK immer
    -- storniert, und eine Zeile ueber 0 Cent hat nichts herzugeben.
    if v_parent.status = 'cancelled' then
      v_reason := 'parent_cancelled';
    elsif v_parent.is_test then
      v_reason := 'parent_test';
    elsif v_parent.amount_cents <= 0 then
      v_reason := 'parent_not_positive';
    end if;

    if v_reason is null then
      -- Der Deckel, der die Ueberstornierung zu einer Eigenschaft der
      -- Datenbank macht: mehr als die Ursprungszeile geht nicht, egal was der
      -- Aufrufer rechnet.
      v_target := least(greatest((v_row->>'target_cents')::int, 0), v_parent.amount_cents);

      -- Bereits gegengebucht, NETTO: die Gegenbuchungen zu dieser Zeile minus
      -- die Wiedergutschriften zu eben diesen Gegenbuchungen. Ohne den zweiten
      -- Teil bliebe nach einem gewonnenen Dispute ein Stand stehen, der
      -- fachlich zurueckgenommen ist -- eine spaetere echte Erstattung
      -- derselben Bestellung buchte dann nichts mehr.
      -- `sum(-amount_cents)` ueber beide Arten: reversal ist negativ (wird
      -- positiv), recredit ist positiv (wird negativ).
      select coalesce(sum(-x.amount_cents), 0)::int into v_already
        from (
          select r.amount_cents
            from public.affiliate_commissions r
           where r.tenant_id = v_tenant_id
             and r.kind = 'reversal'
             and r.reverses_id = v_parent.id
          union all
          select c.amount_cents
            from public.affiliate_commissions c
            join public.affiliate_commissions r2
              on r2.id = c.reverses_id and r2.tenant_id = c.tenant_id
           where c.tenant_id = v_tenant_id
             and c.kind = 'recredit'
             and r2.kind = 'reversal'
             and r2.reverses_id = v_parent.id
        ) x;
      v_already := greatest(v_already, 0);

      v_delta := v_target - v_already;
      if v_delta <= 0 then
        v_reason := 'no_delta';
      end if;
    end if;

    if v_reason is null then
      insert into public.affiliate_commissions (
        tenant_id, program_id, partner_id, kind,
        order_id, stripe_invoice_id, stripe_subscription_id, stripe_charge_id,
        product_id, campaign, referral_id, parent_id, reverses_id,
        base_cents, basis_kind, rate_kind, rate_bp, fixed_cents, amount_cents,
        currency, condition_id, condition_snapshot,
        status, hold_until, is_test, note, dedup_key
      ) values (
        v_tenant_id,
        v_parent.program_id,
        v_parent.partner_id,
        'reversal',
        v_parent.order_id,
        v_parent.stripe_invoice_id,
        v_parent.stripe_subscription_id,
        coalesce(nullif(v_row->>'stripe_charge_id', ''), v_parent.stripe_charge_id),
        v_parent.product_id,
        v_parent.campaign,
        v_parent.referral_id,
        -- BEWUSST null und nicht `v_parent.parent_id`: die Beziehung einer
        -- Gegenbuchung laeuft ueber `reverses_id`. Uebernaehme sie zusaetzlich
        -- den Elternteil ihrer Ursprungszeile, saehe die Gegenbuchung einer
        -- Reserve wie ein Kind der sale-Zeile aus, und die Saldo-Zuordnung
        -- (computeBalances(), Plan 5.10) liefe ueber zwei Kanten statt einer.
        null,
        v_parent.id,
        -- Der eingefrorene Rechenweg der Ursprungszeile wird MITGEFUEHRT, weil
        -- der Beleg zehn Jahre spaeter erklaeren muss, WAS zurueckgenommen
        -- wurde. Er wird nicht neu gerechnet.
        v_parent.base_cents,
        v_parent.basis_kind,
        v_parent.rate_kind,
        v_parent.rate_bp,
        v_parent.fixed_cents,
        -- Das Vorzeichen: eine Gegenbuchung ist negativ (CHECK der Tabelle).
        -v_delta,
        v_parent.currency,
        v_parent.condition_id,
        v_parent.condition_snapshot,
        v_status,
        v_hold_until,
        v_parent.is_test,
        v_note,
        v_dedup_key
      )
      -- `booked_at` bleibt bewusst beim Vorgabewert `current_date`: eine
      -- Gegenbuchung gehoert in die LAUFENDE Abrechnungsperiode (G14), nicht
      -- in die des Elternteils. Liegt die Periode bereits geschlossen vor,
      -- verschiebt der Guard sie und vermerkt das im `note`.
      --
      -- AUSDRUECKLICHES Konfliktziel: nur die Idempotenzachse wird geschluckt.
      -- Ein CHECK-Verstoss wirft weiterhin und rollt den ganzen Stapel zurueck.
      on conflict (tenant_id, dedup_key) do nothing
      returning id into v_id;

      if v_id is null then
        -- Dasselbe Ereignis war schon da (Stripes zweite Zustellung, ein
        -- Reprocess). Die bestehende Zeile wird gelesen und ihr Betrag
        -- zurueckgemeldet -- der Aufrufer soll denselben Bericht bekommen wie
        -- beim ersten Mal.
        select c.id, c.amount_cents into v_id, v_delta
          from public.affiliate_commissions c
         where c.tenant_id = v_tenant_id and c.dedup_key = v_dedup_key;
        if v_id is null then
          raise exception 'affiliate_reversal_conflict_unresolved';
        end if;
        v_delta := -v_delta;
        v_was_new := false;
        v_existing := v_existing + 1;
      else
        v_was_new := true;
        v_booked := v_booked + 1;
        v_sum := v_sum + v_delta;
      end if;
    else
      v_skipped := v_skipped + 1;
      v_delta := 0;
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'reverses_id', v_parent.id,
      'id', v_id,
      'dedup_key', v_dedup_key,
      'parent_kind', v_parent.kind,
      'partner_id', v_parent.partner_id,
      'currency', v_parent.currency,
      'target_cents', coalesce(v_target, 0),
      'already_cents', v_already,
      'amount_cents', case when v_reason is null then -v_delta else 0 end,
      'inserted', v_was_new,
      'skipped_reason', v_reason
    ));
  end loop;

  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'lock_key', v_lock_key,
    'booked', v_booked,
    'existing', v_existing,
    'skipped', v_skipped,
    -- Die Summe der NEU gebuchten Gegenbuchungen, positiv -- die Zahl, die in
    -- die Benachrichtigung an den Partner geht.
    'reversed_cents', v_sum,
    'rows', v_result
  );
end;
$$;


-- =================================================================
-- 2. Ausfuehrungsrechte
-- =================================================================
-- `revoke from public` allein liesse den eigenen anon-Grant stehen, den
-- Supabase ueber `alter default privileges` vergibt (nachgewiesener Fund vom
-- 07.09.2026, 20260907093000_revoke_new_rpcs_from_anon.sql:1-19). Deshalb
-- AUSDRUECKLICH auch `from anon` -- und `from authenticated`, weil diese
-- Funktion Geld schreibt. Einziger Aufrufer ist der Verarbeiter unter
-- `service_role` (Plan 11.10), erreichbar nur ueber den Cron-Endpunkt mit
-- `x-cron-secret`. Nach JEDEM kuenftigen `create or replace` erneut setzen.
revoke execute on function public.book_affiliate_reversals(jsonb) from public;
revoke execute on function public.book_affiliate_reversals(jsonb) from anon;
revoke execute on function public.book_affiliate_reversals(jsonb) from authenticated;
grant  execute on function public.book_affiliate_reversals(jsonb) to service_role;
