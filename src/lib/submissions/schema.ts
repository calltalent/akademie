import { z } from "zod";

/**
 * Block 3 (Phase 2) — Abgaben-Inbox + Bewertung.
 * Spaltennamen exakt aus supabase/migrations/0001_init.sql:
 *   submissions(id, tenant_id, lesson_id, user_id, kind, content, file_path,
 *               status, grade, feedback, reviewed_by, reviewed_at, created_at)
 * `kind` erlaubt laut DB-Constraint 'text'|'file'|'video'|'audio' — die UI
 * (Block 3, v1) bietet Lernenden bewusst nur 'text'|'file' an (siehe
 * PHASENSTATUS.md, bewusste Vereinfachung: Video-/Audio-Abgaben laufen wie
 * normale Datei-Uploads, kein eigener Player-/Streaming-Weg für
 * Lernenden-Abgaben in v1). `grade` ist in der DB `text`, NICHT numerisch
 * (anders als im Plan-Wortlaut "numerisch falls vorhanden") — das Formular
 * bietet deshalb ein kurzes Freitextfeld (z. B. "1", "A", "bestanden").
 *
 * Die `submissions`-Tabelle hat keine `block_id`-Spalte — ein Abgabe-Block
 * (`submissionBlockSchema` in courses/schema.ts) ist nur über `lesson_id`
 * zugeordnet. `createSubmissionSchema` nimmt deshalb bewusst nur `lessonId`
 * entgegen (kein `blockId`), siehe Bericht/PHASENSTATUS.md: mehrere
 * Abgabe-Blöcke in derselben Lektion würden sich dieselbe Abgaben-Historie
 * teilen — akzeptierte Vereinfachung für v1.
 */

export const SUBMISSION_STATUSES = ["submitted", "approved", "revision", "rejected"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  submitted: "Eingereicht",
  approved: "Angenommen",
  revision: "Überarbeitung nötig",
  rejected: "Abgelehnt",
};

export const SUBMISSION_KINDS = ["text", "file", "video", "audio"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

const MAX_TEXT_LENGTH = 10000;
const MAX_FEEDBACK_LENGTH = 5000;
const MAX_GRADE_LENGTH = 50;

// --- Einreichen (Lernende) ---

const baseCreateSubmission = z.object({
  lessonId: z.string().uuid(),
});

const createSubmissionText = baseCreateSubmission.extend({
  kind: z.literal("text"),
  content: z
    .string()
    .trim()
    .min(1, "Text darf nicht leer sein.")
    .max(MAX_TEXT_LENGTH, `Max. ${MAX_TEXT_LENGTH} Zeichen.`),
});

const createSubmissionFile = baseCreateSubmission.extend({
  kind: z.literal("file"),
  filePath: z.string().min(1).max(500),
});

export const createSubmissionSchema = z.discriminatedUnion("kind", [
  createSubmissionText,
  createSubmissionFile,
]);
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

// --- Bewerten (Staff) ---

const GRADABLE_STATUSES = ["approved", "revision", "rejected"] as const;

export const gradeSubmissionSchema = z.object({
  status: z.enum(GRADABLE_STATUSES),
  grade: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(MAX_GRADE_LENGTH, `Max. ${MAX_GRADE_LENGTH} Zeichen.`).optional(),
  ),
  feedback: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(MAX_FEEDBACK_LENGTH, `Max. ${MAX_FEEDBACK_LENGTH} Zeichen.`).optional(),
  ),
});
export type GradeSubmissionInput = z.infer<typeof gradeSubmissionSchema>;

// --- Upload-Whitelist (Route + Client teilen sich dieselben Konstanten) ---

/**
 * Sicherheitsregel CLAUDE.md §2.5: Typ- und Größen-Whitelist bei Uploads.
 * Bewusst kein Video-Streaming-Typ-Sonderweg (Bunny) für Lernenden-Abgaben
 * in v1 — mp4/mp3 laufen hier wie jede andere Datei über den privaten
 * `submissions`-Bucket.
 */
export const ALLOWED_SUBMISSION_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/png",
  "image/jpeg",
  "application/zip",
  "video/mp4",
  "audio/mpeg",
  "audio/mp4",
] as const;

export const MAX_SUBMISSION_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export const uploadUrlRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(300),
  fileSize: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_SUBMISSION_FILE_SIZE_BYTES, "Datei zu groß (max. 50 MB)."),
  mimeType: z.enum(ALLOWED_SUBMISSION_MIME_TYPES),
});
export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>;
