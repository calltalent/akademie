import { z } from "zod";
import sanitizeHtml from "sanitize-html";

/**
 * Block-Typen laut SPEC.md §3 (Must-Liste) und Migration-Kommentar
 * (lessons.blocks jsonb): text, image, video, audio, file, quiz, submission,
 * callout, embed. Quiz/Submission referenzieren in Phase 1 nur eine ID
 * (Anlage der eigentlichen quizzes/submissions-Zeilen folgt in Block 3b/Phase 2
 * für Auswertung; hier zählt die Editor-Struktur).
 */

const baseBlock = z.object({
  id: z.string().uuid(),
});

/**
 * Sicherheits-Fix (security-reviewer-Audit 11.07.2026, HOCH — blockierte
 * Phase-1-Abschluss): Text-Block-HTML wurde ungeprüft über
 * dangerouslySetInnerHTML gerendert (src/components/learn/block-renderer.tsx).
 * Jedes Staff-Mitglied inkl. Trainer (RLS lessons_staff_write erlaubt das
 * auch der niedrigsten Staff-Rolle) hätte beliebiges Script einschleusen
 * können — ausgeführt im Browser jedes Members UND jedes Owners/Admins beim
 * Ansehen der Lektion. Fix: striktes Server-seitiges Whitelist-Sanitizing
 * direkt im zod-Schema, greift bei JEDEM Schreibpfad (saveLessonBlocks),
 * unabhängig vom Editor-Frontend.
 */
const ALLOWED_TEXT_TAGS = [
  "p", "br", "strong", "em", "u", "s", "a", "ul", "ol", "li",
  "h2", "h3", "h4", "blockquote", "code", "pre", "span",
];

function sanitizeLessonHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TEXT_TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  });
}

export const textBlockSchema = baseBlock.extend({
  type: z.literal("text"),
  html: z.string().max(20000).transform(sanitizeLessonHtml),
});

export const imageBlockSchema = baseBlock.extend({
  type: z.literal("image"),
  url: z.string().url(),
  alt: z.string().max(300),
});

export const videoBlockSchema = baseBlock.extend({
  type: z.literal("video"),
  bunnyVideoId: z.string().min(1).nullable(),
});

export const audioBlockSchema = baseBlock.extend({
  type: z.literal("audio"),
  url: z.string().url(),
});

export const fileBlockSchema = baseBlock.extend({
  type: z.literal("file"),
  url: z.string().url(),
  filename: z.string().max(300),
});

export const quizBlockSchema = baseBlock.extend({
  type: z.literal("quiz"),
  quizId: z.string().uuid().nullable(),
  title: z.string().max(300),
});

export const submissionBlockSchema = baseBlock.extend({
  type: z.literal("submission"),
  instructions: z.string().max(5000),
});

export const calloutBlockSchema = baseBlock.extend({
  type: z.literal("callout"),
  variant: z.enum(["info", "warning", "success"]),
  text: z.string().max(2000),
});

export const embedBlockSchema = baseBlock.extend({
  type: z.literal("embed"),
  url: z.string().url(),
});

export const blockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  imageBlockSchema,
  videoBlockSchema,
  audioBlockSchema,
  fileBlockSchema,
  quizBlockSchema,
  submissionBlockSchema,
  calloutBlockSchema,
  embedBlockSchema,
]);

export const blocksSchema = z.array(blockSchema).max(200);

export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  text: "Text",
  image: "Bild",
  video: "Video",
  audio: "Audio",
  file: "Datei",
  quiz: "Quiz",
  submission: "Abgabe",
  callout: "Hinweisbox",
  embed: "Einbettung",
};

export function createEmptyBlock(type: BlockType): Block {
  const id = crypto.randomUUID();
  switch (type) {
    case "text":
      return { id, type, html: "" };
    case "image":
      return { id, type, url: "", alt: "" };
    case "video":
      return { id, type, bunnyVideoId: null };
    case "audio":
      return { id, type, url: "" };
    case "file":
      return { id, type, url: "", filename: "" };
    case "quiz":
      return { id, type, quizId: null, title: "" };
    case "submission":
      return { id, type, instructions: "" };
    case "callout":
      return { id, type, variant: "info", text: "" };
    case "embed":
      return { id, type, url: "" };
  }
}

// --- Kurs / Modul / Lektion (Stammdaten) ---

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const courseSchema = z.object({
  title: z.string().min(1, "Titel erforderlich.").max(300),
  slug: z
    .string()
    .min(1, "Slug erforderlich.")
    .max(100)
    .regex(slugPattern, "Nur Kleinbuchstaben, Ziffern, Bindestriche."),
  description: z.string().max(5000).optional(),
});

export const moduleSchema = z.object({
  title: z.string().min(1, "Titel erforderlich.").max(300),
});

/** Sektion (Modul -> Sektion -> Lektion, Migration 20260718150000_sections.sql) — gleiche Form wie moduleSchema, eigener Typ für Klarheit an den Aufrufstellen. */
export const sectionSchema = z.object({
  title: z.string().min(1, "Titel erforderlich.").max(300),
});

export const lessonSchema = z.object({
  title: z.string().min(1, "Titel erforderlich.").max(300),
});

/** Kurskategorie (Migration 20260722180000_course_categories.sql) — Name, mandantenweit eindeutig (DB-Constraint). */
export const courseCategorySchema = z.object({
  name: z.string().trim().min(1, "Name erforderlich.").max(60),
});

export type CourseInput = z.infer<typeof courseSchema>;
export type ModuleInput = z.infer<typeof moduleSchema>;
export type SectionInput = z.infer<typeof sectionSchema>;
export type LessonInput = z.infer<typeof lessonSchema>;
export type CourseCategoryInput = z.infer<typeof courseCategorySchema>;
