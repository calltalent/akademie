-- Marketplace M2, Nachschärfung an der M1-RLS (03.08.2026, Plan
-- "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt 6/10). Beim
-- Implementieren von setListingEnabled() (src/lib/marketplace/actions.ts)
-- zeigte sich: `ml_staff_update` (20260803100100_marketplace_listings.sql,
-- verschärft in 20260803100400_marketplace_security_hardening.sql) prüft in
-- `with check` ausschließlich `status in ('draft','submitted')` gegen die
-- RESULTIERENDE (neue) Zeile — unabhängig davon, ob `status` in diesem
-- Update überhaupt geändert wird. Für ein bereits freigegebenes Listing
-- (status='approved') bliebe `status` bei einem reinen
-- `update ... set enabled = false` unverändert 'approved' -> die Prüfung
-- schlägt fehl, RLS blockiert JEDES Update eines freigegebenen Listings
-- komplett. Laut Plan Abschnitt 6 ist "Mandanten-Sichtbarkeits-Schalter für
-- ein freigegebenes Listing" aber genau der Hauptanwendungsfall von
-- setListingEnabled() ("nur sinnvoll für status='approved'"). Ohne diesen
-- Fix wäre M2 wie geplant technisch nicht umsetzbar (CLAUDE.md §1: Abweichung
-- dokumentieren — hier per Korrektur-Migration gelöst statt Funktion
-- wegzulassen).
--
-- Fix: `with check` erlaubt zusätzlich den Fall, dass der neue `status`-Wert
-- exakt dem bereits gespeicherten (alten) Wert entspricht. Staff kann
-- `status` weiterhin NIEMALS selbst auf 'approved'/'rejected'/'suspended'
-- SETZEN (nur 'draft'/'submitted' bleiben neu zuweisbar) — aber alle anderen
-- Spalten (`enabled`, `headline`, `summary`, `cover_url`, `price_cents`, …)
-- frei ändern, ohne den bestehenden Status anzutasten. Der selbstreferenzierende
-- Subquery-Vergleich (`status = (select ... from marketplace_listings where
-- id = ...)`) ist das Standardmuster für "Spalte X darf sich nicht ändern,
-- andere Spalten schon" in Postgres/Supabase-RLS — `with check` sieht sonst
-- nur die neue Zeile, ein Subquery auf dieselbe Tabelle liefert innerhalb
-- desselben Statements zuverlässig den alten, noch nicht committeten Wert
-- (empirisch mit einer Wegwerf-Testtabelle + `set role authenticator` +
-- `row_security = on` gegen die Produktivdatenbank verifiziert, bevor diese
-- Migration angewendet wurde: reines Ändern einer Nicht-Status-Spalte bei
-- status='approved' gelingt, ein direkter Versuch `set status = 'approved'`
-- wird weiterhin mit 42501 abgelehnt).
--
-- NACHSCHÄRFUNG (security-reviewer-Lauf, 03.08.2026, HOCH-Fund): die zuerst
-- geschriebene Fassung dieser Klausel prüfte `status in ('draft','submitted')
-- OR status = <alter Wert>` — das erste OR-Glied wertet den NEUEN Wert aus,
-- unabhängig vom alten. Damit konnte Staff ein bereits freigegebenes
-- (`approved`) oder vom Betreiber gesperrtes (`suspended`) Listing per
-- direktem Supabase-Client-Aufruf (außerhalb von withdrawListing(), das
-- genau das in der Anwendungsschicht verhindern soll, src/lib/marketplace/
-- actions.ts) einfach auf `draft`/`submitted` zurücksetzen — eine
-- unautorisierte Selbst-Rücknahme der Betreiber-Entscheidung. Korrigiert:
-- der "Ziel ist draft/submitted"-Zweig ist jetzt zusätzlich daran gebunden,
-- dass der ALTE Wert bereits draft/submitted war. Der reine
-- Identitäts-Zweig (neuer Wert = alter Wert) bleibt unverändert bestehen
-- und deckt weiterhin den eigentlichen Anwendungsfall dieser Migration ab
-- (enabled/headline/etc. bei status='approved' ändern, ohne status
-- anzutasten).

drop policy if exists ml_staff_update on public.marketplace_listings;

create policy ml_staff_update on public.marketplace_listings
  for update using (public.is_staff(tenant_id))
  with check (
    public.is_staff(tenant_id)
    and exists (
      select 1 from public.courses c
      where c.id = marketplace_listings.course_id and c.tenant_id = marketplace_listings.tenant_id
    )
    and (
      status = (select ml.status from public.marketplace_listings ml where ml.id = marketplace_listings.id)
      or (
        status in ('draft','submitted')
        and (select ml.status from public.marketplace_listings ml where ml.id = marketplace_listings.id) in ('draft','submitted')
      )
    )
  );
