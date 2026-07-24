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
 * BUGFIX (23.07.2026, Block-Audit auf Josips Anfrage): `z.string().url()`
 * allein lehnt einen leeren String ab — genau der Zustand eines frisch per
 * "+Bild"/"+Audio"/"+Datei"/"+Einbettung" angelegten, noch nicht befüllten
 * Blocks (`createEmptyBlock()` unten setzt `url: ""`). Der 1s-Autosave in
 * block-editor.tsx parst das GESAMTE `blocks`-Array auf einmal — ein
 * einzelner ungültiger Block ließ dadurch die Lektion komplett nicht mehr
 * speichern (auch unabhängige Text-/Bearbeitungen anderer Blöcke), mit einem
 * unspezifischen "Fehler beim Speichern" ohne Hinweis, welcher Block
 * betroffen ist. Erlaubt jetzt zusätzlich den leeren String ("noch nicht
 * befüllt") — `block-renderer.tsx` zeigt für diesen Zustand in der
 * Lernansicht einen eigenen Platzhaltertext statt eines kaputten
 * `<img>`/`<audio>`/Downloads/iframes.
 */
const emptyOrUrl = z.union([z.literal(""), z.string().url()]);

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
  url: emptyOrUrl,
  alt: z.string().max(300),
});

export const videoBlockSchema = baseBlock.extend({
  type: z.literal("video"),
  bunnyVideoId: z.string().min(1).nullable(),
});

export const audioBlockSchema = baseBlock.extend({
  type: z.literal("audio"),
  url: emptyOrUrl,
});

/** Standardtext unter dem Dateinamen (Karten-Darstellung, block-renderer.tsx) — vorbelegt bei neuen Blöcken, Fallback für ältere Blöcke ohne `description`. */
export const DEFAULT_FILE_BLOCK_DESCRIPTION = "Zum Öffnen oder Herunterladen klicken";

export const fileBlockSchema = baseBlock.extend({
  type: z.literal("file"),
  url: emptyOrUrl,
  filename: z.string().max(300),
  // NEU (23.07.2026, Josips Auftrag): Beschreibungstext unter dem Dateinamen
  // editierbar statt fest im Renderer verdrahtet. `.optional()`, nicht
  // Pflichtfeld — ältere, bereits gespeicherte Datei-Blöcke haben dieses
  // Feld noch nicht; ein Pflichtfeld hätte ihr Parsing (blocksSchema.parse
  // in block-renderer.tsx) rückwirkend zum Scheitern gebracht.
  // block-renderer.tsx fällt bei "" oder fehlendem Feld auf
  // DEFAULT_FILE_BLOCK_DESCRIPTION zurück.
  description: z.string().max(300).optional(),
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
  url: emptyOrUrl,
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
      return { id, type, url: "", filename: "", description: DEFAULT_FILE_BLOCK_DESCRIPTION };
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
  /** Kursziele (Information-Tab, Migration 20260724130000_course_information.sql) — Checkmark-Liste, optional. */
  goals: z.array(z.string().min(1).max(300)).max(20).optional(),
});

/** Kurze Beschreibung unter Modul-/Sektions-Überschrift (23.07.2026, Migration 20260723190000) — optional, leer = keine Beschreibung. */
export const moduleSectionDescriptionSchema = z.string().max(500, "Max. 500 Zeichen.");

export const moduleSchema = z.object({
  title: z.string().min(1, "Titel erforderlich.").max(300),
  description: moduleSectionDescriptionSchema.optional(),
});

/** Sektion (Modul -> Sektion -> Lektion, Migration 20260718150000_sections.sql) — gleiche Form wie moduleSchema, eigener Typ für Klarheit an den Aufrufstellen. */
export const sectionSchema = z.object({
  title: z.string().min(1, "Titel erforderlich.").max(300),
  description: moduleSectionDescriptionSchema.optional(),
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
