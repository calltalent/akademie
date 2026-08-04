-- Marketplace M5, Nachschärfung an der M1/M2-RLS (03.08.2026, Plan
-- "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt 5/6/10, Block M5).
-- Gefunden beim Implementieren von submitListing()s Stripe-Produkt-
-- Autoanlage (src/lib/marketplace/actions.ts) — gleiche Fundklasse wie
-- 20260803110000_marketplace_listings_enabled_toggle_fix.sql (M2), diesmal
-- eine andere Zeile derselben Policy.
--
-- `ml_staff_update`s zweiter with-check-Zweig (Stand nach 20260803110000)
-- erlaubt einen Statuswechsel nach 'draft'/'submitted' NUR, wenn der ALTE
-- Wert bereits 'draft' ODER 'submitted' war:
--
--   status in ('draft','submitted')
--   and (select ... alter Wert ...) in ('draft','submitted')
--
-- `submitListing()` (src/lib/marketplace/actions.ts) erlaubt und dokumentiert
-- aber ausdrücklich die Einreichung eines ABGELEHNTEN Listings
-- ("Nur Entwürfe oder abgelehnte Listings können eingereicht werden.",
-- Prüfung `existing.status !== "draft" && existing.status !== "rejected"`) —
-- ein Mandant, dessen Listing vom Betreiber abgelehnt wurde (`status =
-- 'rejected'`, gesetzt durch `rejectListing()` im Betreiber-Portal, M3),
-- soll es nach Korrektur erneut einreichen können. Mit der bisherigen
-- Policy-Fassung scheitert genau dieser `rejected -> submitted`-Übergang
-- mit 42501 ("Du hast keine Berechtigung für diese Aktion.") — der zweite
-- Zweig greift nicht (alter Wert 'rejected' ist nicht in ('draft',
-- 'submitted')), der erste (Identitäts-)Zweig auch nicht (unterschiedliche
-- Werte). Ohne diesen Fix wäre der App-Layer-Workflow ("Ablehnen ->
-- Korrigieren -> erneut einreichen") technisch nicht umsetzbar (CLAUDE.md
-- §1: Abweichung dokumentieren — hier per Korrektur-Migration gelöst statt
-- den Fehlerfall stillschweigend hinzunehmen).
--
-- Fix: der erlaubte ALTE Werte-Bereich im zweiten Zweig wird um 'rejected'
-- erweitert. Die eigentliche Sicherheitseigenschaft bleibt unverändert:
-- der NEUE Wert bleibt in JEDEM Fall auf ('draft','submitted') beschränkt —
-- Staff kann `status` weiterhin NIEMALS selbst auf 'approved'/'suspended'
-- SETZEN. `('approved','suspended') -> ('draft','submitted')` bleibt
-- weiterhin blockiert (nur der Identitäts-Zweig greift für diese beiden
-- Werte, exakt wie zuvor — kein Rückschritt bei `setListingEnabled()` für
-- ein freigegebenes/gesperrtes Listing).

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
        and (select ml.status from public.marketplace_listings ml where ml.id = marketplace_listings.id) in ('draft','submitted','rejected')
      )
    )
  );
