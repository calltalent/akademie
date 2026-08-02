-- Sicherheitsfix: avatars-Bucket erlaubte bucket-weites Listing ueber die
-- Storage-List-API (Supabase-Advisor-WARN "Public Bucket Allows Listing").
-- avatar_url wird aktuell ausschliesslich hinter Login gerendert (Ordner
-- (portal)/einstellungen) -> auf authenticated einschraenken schliesst die
-- anonyme Enumeration von {user_id}/avatar.ext, ohne die App zu brechen.
-- Live angewendet am 01.08.2026.
drop policy if exists avatars_public_read on storage.objects;
create policy avatars_authenticated_select on storage.objects
  for select using (bucket_id = 'avatars' and auth.role() = 'authenticated');
