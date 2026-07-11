-- Nachtraeglich lokal rekonstruiert (11.07.2026) aus dem Live-Zustand der
-- Supabase-Datenbank. Urspruenglich am 10.07.2026 (Block 2) nur ueber
-- Supabase-MCP live angewendet, nie als lokale Datei geschrieben - siehe
-- PHASENSTATUS.md. Bildet den historischen Anlage-Zustand nach (Policies
-- branding_public_read/course_assets_public_read wurden am 11.07.2026 durch
-- die Security-Fix-Migration 20260710233735 wieder ersetzt - diese Datei
-- zeigt bewusst den urspruenglichen Stand, die Chronologie bleibt so
-- nachvollziehbar).
--
-- Storage-Buckets fuer Mandanten-Branding, Kurs-Medien, Abgaben und
-- Zertifikate. Pfadkonvention ueberall: {tenant_id}/... als erster
-- Ordner-Segment, dadurch koennen Policies member_role()/is_staff() direkt
-- auf storage.foldername(name)[1] anwenden.

insert into storage.buckets (id, name, public)
values
  ('branding', 'branding', true),
  ('course-assets', 'course-assets', true),
  ('submissions', 'submissions', false),
  ('certificates', 'certificates', false)
on conflict (id) do nothing;

-- branding: oeffentlich lesbar (Logos in Login-Seiten etc.), Schreiben nur
-- fuer Staff (owner/admin/trainer) des jeweiligen Mandanten-Ordners.
create policy branding_public_read on storage.objects
  for select using (bucket_id = 'branding');

create policy branding_staff_write on storage.objects
  for insert with check (
    bucket_id = 'branding'
    and member_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin', 'trainer')
  );

create policy branding_staff_update on storage.objects
  for update using (
    bucket_id = 'branding'
    and member_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin', 'trainer')
  );

create policy branding_staff_delete on storage.objects
  for delete using (
    bucket_id = 'branding'
    and member_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin', 'trainer')
  );

-- course-assets: dieselbe Logik wie branding (Kursbilder/-medien, oeffentlich
-- lesbar, Staff-Schreibrechte).
create policy course_assets_public_read on storage.objects
  for select using (bucket_id = 'course-assets');

create policy course_assets_staff_write on storage.objects
  for insert with check (
    bucket_id = 'course-assets'
    and member_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin', 'trainer')
  );

create policy course_assets_staff_update on storage.objects
  for update using (
    bucket_id = 'course-assets'
    and member_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin', 'trainer')
  );

create policy course_assets_staff_delete on storage.objects
  for delete using (
    bucket_id = 'course-assets'
    and member_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin', 'trainer')
  );

-- submissions: privat. Pfadkonvention {tenant_id}/{user_id}/... - eigener
-- Nutzer hat vollen Zugriff auf seine Abgaben, Staff darf nur lesen
-- (Bewertung folgt in Phase 2, kein Schreibzugriff auf fremde Abgaben noetig).
create policy submissions_own_all on storage.objects
  for all using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
  ) with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy submissions_staff_read on storage.objects
  for select using (
    bucket_id = 'submissions'
    and is_staff(((storage.foldername(name))[1])::uuid)
  );

-- certificates: privat. Pfadkonvention {tenant_id}/{user_id}/... - eigener
-- Nutzer darf sein Zertifikat lesen, Staff darf verwalten (Ausstellung/
-- Widerruf, Phase 2).
create policy certificates_own_read on storage.objects
  for select using (
    bucket_id = 'certificates'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy certificates_staff_all on storage.objects
  for all using (
    bucket_id = 'certificates'
    and is_staff(((storage.foldername(name))[1])::uuid)
  ) with check (
    bucket_id = 'certificates'
    and is_staff(((storage.foldername(name))[1])::uuid)
  );
