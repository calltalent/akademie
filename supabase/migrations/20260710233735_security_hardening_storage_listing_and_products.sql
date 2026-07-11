-- Security-Fix (security-reviewer-Audit 11.07.2026, MITTEL):
-- 1) storage.objects SELECT-Policies fuer branding/course-assets erlaubten
--    bucket-weites Listing (jeder anon konnte alle Tenant-Ordner/Dateinamen
--    per Storage-List-API enumerieren). Die eigentliche Bild-Auslieferung
--    (<img src="https://.../storage/v1/object/public/...">) laeuft ueber die
--    public-Bucket-Route und umgeht RLS komplett (public=true bestaetigt) -
--    das Einschraenken der SELECT-Policy auf Staff des jeweiligen
--    Tenant-Ordners bricht also keine Bildanzeige, schliesst aber das
--    Enumerations-Leck.
drop policy if exists branding_public_read on storage.objects;
create policy branding_staff_select on storage.objects
  for select using (
    bucket_id = 'branding'
    and member_role(((storage.foldername(name))[1])::uuid) is not null
  );

drop policy if exists course_assets_public_read on storage.objects;
create policy course_assets_staff_select on storage.objects
  for select using (
    bucket_id = 'course-assets'
    and member_role(((storage.foldername(name))[1])::uuid) is not null
  );

-- 2) products_public_select erlaubte anon-Lesen ueber ALLE Mandanten hinweg
--    (kein tenant_id-Filter). Tabelle ist Phase-2 (Stripe-Produkte), aktuell
--    0 Zeilen, aber die Luecke ist bereits live. Oeffentliches Storefront-
--    Browsing (vor Login) braucht eine tenant-scoped Server-Route (analog
--    src/lib/tenant/resolve.ts mit Admin-Client + explizitem tenant_id-
--    Filter), nicht direkten anon-REST-Zugriff via RLS - das kann RLS
--    strukturell nicht sicher abbilden, da anon keine Tenant-Zugehoerigkeit
--    hat. Bis diese Route in Phase 2 gebaut ist: nur Mitglieder duerfen
--    aktive Produkte ihres eigenen Mandanten lesen.
drop policy if exists products_public_select on public.products;
create policy products_member_select on public.products
  for select using (active = true and member_role(tenant_id) is not null);
