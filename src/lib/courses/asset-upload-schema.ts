import { z } from "zod";

/**
 * Upload-Whitelist für den `+Bild`-Block-Upload (Kurs-Editor). Route und
 * Client teilen sich dieselben Konstanten — Muster wie
 * `src/lib/submissions/schema.ts` (ALLOWED_SUBMISSION_MIME_TYPES).
 *
 * Sicherheitsregel CLAUDE.md §2.5: Typ- und Größen-Whitelist bei Uploads.
 * Bewusst OHNE `image/svg+xml`: SVG ist ein XML-Format und kann eingebettetes
 * `<script>` enthalten. Über ein reines `<img src=…>` (siehe
 * block-renderer.tsx) führt der Browser das zwar nicht aus, aber ein SVG
 * könnte an anderer Stelle (z. B. direkt per Storage-URL geöffnet) doch
 * ausgeführt werden — bei einem öffentlich lesbaren Bucket ohne Zusatznutzen
 * für Kursbilder (Fotos/Screenshots) nicht das Risiko wert.
 */
export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export const MAX_IMAGE_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

export const imageUploadUrlRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(300),
  fileSize: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_IMAGE_FILE_SIZE_BYTES, "Datei zu groß (max. 8 MB)."),
  mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES),
});
export type ImageUploadUrlRequest = z.infer<typeof imageUploadUrlRequestSchema>;

/**
 * Josips Auftrag (23.07.2026): "bei Audio, Datei immer die Option
 * ermöglichen Dateien vom PC auszuwählen" — analog zum bestehenden
 * Bild-Upload (siehe imageUploadUrlRequestSchema oben), gleicher Bucket
 * (`course-assets`, öffentlich lesbar, Staff-Schreibrechte per
 * `course_assets_staff_write`), gleiche Route (`/api/course-assets/
 * upload-url`). Diese teilt sich jetzt drei Whitelists über ein
 * `kind`-Feld statt einer einzigen (Bild-spezifischen) — bestehende
 * Aufrufer von `imageUploadUrlRequestSchema`/`ALLOWED_IMAGE_MIME_TYPES`/
 * `MAX_IMAGE_FILE_SIZE_BYTES` (thumbnail-upload.tsx, tenant-logo-Route)
 * bleiben unverändert, sie nutzen einen eigenen Upload-Pfad außerhalb des
 * `+Audio`/`+Datei`-Blocks.
 */
export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
] as const;
export const MAX_AUDIO_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Bewusst kein Video-/Bild-Sonderweg hier (die haben eigene Blocktypen mit
 * eigenem Upload) — der `+Datei`-Block ist für Begleitmaterial gedacht
 * (Handouts, Arbeitsblätter, Vorlagen).
 */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "application/zip",
] as const;
export const MAX_DOCUMENT_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const baseAssetUploadFields = {
  fileName: z.string().trim().min(1).max(300),
  fileSize: z.coerce.number().int().positive(),
};

const imageAssetUploadRequestSchema = z.object({
  ...baseAssetUploadFields,
  kind: z.literal("image"),
  mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES),
  fileSize: z.coerce.number().int().positive().max(MAX_IMAGE_FILE_SIZE_BYTES, "Datei zu groß (max. 8 MB)."),
});

const audioAssetUploadRequestSchema = z.object({
  ...baseAssetUploadFields,
  kind: z.literal("audio"),
  mimeType: z.enum(ALLOWED_AUDIO_MIME_TYPES),
  fileSize: z.coerce.number().int().positive().max(MAX_AUDIO_FILE_SIZE_BYTES, "Datei zu groß (max. 50 MB)."),
});

const documentAssetUploadRequestSchema = z.object({
  ...baseAssetUploadFields,
  kind: z.literal("document"),
  mimeType: z.enum(ALLOWED_DOCUMENT_MIME_TYPES),
  fileSize: z.coerce.number().int().positive().max(MAX_DOCUMENT_FILE_SIZE_BYTES, "Datei zu groß (max. 50 MB)."),
});

/** Deckt Bild-/Audio-/Datei-Upload für die `+Bild`/`+Audio`/`+Datei`-Blöcke ab — ein `kind`-Feld wählt Whitelist + Größenlimit. */
export const courseAssetUploadUrlRequestSchema = z.discriminatedUnion("kind", [
  imageAssetUploadRequestSchema,
  audioAssetUploadRequestSchema,
  documentAssetUploadRequestSchema,
]);
export type CourseAssetUploadUrlRequest = z.infer<typeof courseAssetUploadUrlRequestSchema>;
