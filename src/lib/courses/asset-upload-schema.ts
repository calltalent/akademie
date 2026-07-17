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
