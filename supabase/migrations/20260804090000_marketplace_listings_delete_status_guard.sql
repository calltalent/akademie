-- Marketplace, Gesamtaudit-Nachschärfung (04.08.2026, Plan
-- "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt 10, abschließender
-- security-reviewer-Lauf über M1–M6). Fund: `ml_staff_delete`
-- (20260803100100_marketplace_listings.sql) hat — anders als
-- `ml_staff_insert`/`ml_staff_update`, die beide `status in
-- ('draft','submitted')` erzwingen — GAR KEINE Statuseinschränkung. Ein
-- Mandant konnte damit ein bereits freigegebenes (`approved`) oder vom
-- Betreiber gesperrtes (`suspended`) Listing per direktem
-- Supabase-Client-Aufruf löschen — außerhalb von `withdrawListing()`
-- (src/lib/marketplace/actions.ts), das genau das für `approved` in der
-- Anwendungsschicht ausdrücklich verweigert ("Freigegebene Listings können
-- nicht zurückgezogen werden..."). Eine Löschung räumt zusätzlich die
-- Prüfhistorie (`reviewed_by`/`review_note`) unwiderruflich weg und macht
-- `unique(course_id)` sofort wieder frei für ein neues, unbelastetes
-- Listing — ein Mandant könnte so eine Ablehnung/Sperrung faktisch
-- umgehen, statt den vorgesehenen `rejected -> submitted`-Korrekturweg
-- (20260803120000) zu nutzen.
--
-- Fix: Löschen nur noch aus 'draft'/'rejected' erlaubt — exakt dieselbe
-- Werte-Menge, die `ml_staff_insert`/`ml_staff_update` bereits als einzig
-- zulässige STAFF-seitige Statuswerte kennen. Ein freigegebenes/gesperrtes
-- Listing kann weiterhin nur über den vorgesehenen Weg deaktiviert werden
-- (`setListingEnabled(id, false)`), nicht gelöscht.

drop policy if exists ml_staff_delete on public.marketplace_listings;

create policy ml_staff_delete on public.marketplace_listings
  for delete using (
    public.is_staff(tenant_id)
    and status in ('draft', 'rejected')
  );
