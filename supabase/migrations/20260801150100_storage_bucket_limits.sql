-- Sicherheitsfix: Bucket-seitige Typ-/Groessen-Whitelist fuer alle Storage-
-- Buckets setzen (CLAUDE.md §2.5). Bisher galt die Whitelist nur fuer die
-- Anfrage der signierten Upload-URL (zod-Validierung in der Route); der
-- tatsaechliche PUT gegen die Signed URL lief ungeprueft direkt gegen
-- Supabase Storage (file_size_limit/allowed_mime_types standen bei allen
-- 5 Buckets auf NULL). Werte synchron zu den bestehenden zod-Konstanten:
--   branding      -> src/lib/courses/asset-upload-schema.ts (ALLOWED_IMAGE_MIME_TYPES / MAX_IMAGE_FILE_SIZE_BYTES)
--   course-assets -> dito, Vereinigung Bild/Audio/Dokument (courseAssetUploadUrlRequestSchema)
--   submissions   -> src/lib/submissions/schema.ts (ALLOWED_SUBMISSION_MIME_TYPES / MAX_SUBMISSION_FILE_SIZE_BYTES)
--   certificates  -> serverseitig erzeugte PDFs (src/lib/certificates/issue.ts)
--   avatars       -> src/lib/account/actions.ts (AVATAR_EXT / AVATAR_MAX_BYTES)
-- Live angewendet am 01.08.2026.

update storage.buckets set
  file_size_limit = 8 * 1024 * 1024,
  allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
where id = 'branding';

update storage.buckets set
  file_size_limit = 50 * 1024 * 1024,
  allowed_mime_types = array[
    'image/png','image/jpeg','image/webp','image/gif',
    'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/x-m4a','audio/webm',
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','application/zip'
  ]
where id = 'course-assets';

update storage.buckets set
  file_size_limit = 50 * 1024 * 1024,
  allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/png','image/jpeg',
    'application/zip',
    'video/mp4',
    'audio/mpeg','audio/mp4'
  ]
where id = 'submissions';

update storage.buckets set
  file_size_limit = 10 * 1024 * 1024,
  allowed_mime_types = array['application/pdf']
where id = 'certificates';

update storage.buckets set
  file_size_limit = 2 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg','image/png']
where id = 'avatars';
