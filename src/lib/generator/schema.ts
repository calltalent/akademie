import { z } from "zod";

/**
 * Kurs-Generator (Phase 3, Block 5) — zod-Schemas für den KI-generierten
 * Kursentwurf. Wächst über drei Pipeline-Schritte (src/lib/generator/
 * pipeline.ts, src/lib/generator/process.ts):
 *   Schritt 1 (Gliederung)      -> courseOutlineSchema
 *   Schritt 2 (Lektionsinhalte) -> courseContentSchema (erweitert die
 *                                  Gliederung um contentHtml je Lektion)
 *   Schritt 3 (Quiz-Fragen)     -> courseDraftSchema (erweitert Content um
 *                                  ein optionales Quiz je Modul)
 * Jede Stufe behält Titel-/Strukturfelder der vorherigen Stufe bei.
 * src/lib/generator/apply.ts wandelt ausschließlich das Endergebnis
 * (courseDraftSchema) in echte courses/modules/lessons/quizzes/questions-
 * Zeilen um — strukturell kompatibel mit `blocksSchema`
 * (src/lib/courses/schema.ts): jede Lektion wird 1:1 ein `text`-Block,
 * jedes Modul-Quiz wird eine eigene `quizzes`-Zeile + `questions`-Zeilen +
 * ein `quiz`-Block, analog zur bestehenden Quiz-Anlage aus Phase 2 Block 2
 * (src/lib/quiz/schema.ts, src/lib/quiz/actions.ts::upsertQuestion).
 *
 * Bewusst begrenzte Obergrenzen (max. 6 Module, max. 5 Lektionen/Modul,
 * max. 6 Fragen/Quiz-Frage 3-5 Optionen) — hält einzelne Claude-Sonnet-
 * Aufrufe innerhalb eines vernünftigen Token-/Kosten-/Zeit-Rahmens; SPEC-DoD
 * ("aus 3 PDFs entsteht in < 10 Min. ein übernehmbarer Kursentwurf")
 * impliziert einen überschaubaren Kurs, keinen Mega-Kurs. Staff kann nach
 * der Übernahme im bestehenden Kurs-/Quiz-Editor beliebig erweitern.
 *
 * Fragetyp-Vereinfachung (dokumentierte Abweichung, siehe PHASENSTATUS.md):
 * der Generator erzeugt ausschließlich Einfachauswahl-Fragen (kind
 * "single" beim Übernehmen in `questions`) — keine Mehrfachauswahl/
 * Lückentext/Freitext. Reduziert die KI-Fehlerquote (eine eindeutig
 * richtige Option ist zuverlässiger generierbar/validierbar als z. B.
 * Regex-Lückentext) und deckt SPEC §6 "Quiz-Fragen ableiten" ab; weitere
 * Fragetypen kann Staff nachträglich im bestehenden Quiz-Editor ergänzen.
 */

// --- Schritt 1: Gliederung ---

export const draftOutlineLessonSchema = z.object({
  title: z.string().trim().min(1, "Lektionstitel erforderlich.").max(300),
});

export const draftOutlineModuleSchema = z.object({
  title: z.string().trim().min(1, "Modultitel erforderlich.").max(300),
  lessons: z.array(draftOutlineLessonSchema).min(1, "Mind. 1 Lektion je Modul.").max(4, "Max. 4 Lektionen je Modul."),
});

export const courseOutlineSchema = z.object({
  title: z.string().trim().min(1, "Kurstitel erforderlich.").max(300),
  description: z.string().trim().max(2000).optional(),
  modules: z.array(draftOutlineModuleSchema).min(1, "Mind. 1 Modul.").max(4, "Max. 4 Module."),
});
export type CourseOutline = z.infer<typeof courseOutlineSchema>;

// --- Schritt 2: Lektionsinhalte ---

export const draftContentLessonSchema = draftOutlineLessonSchema.extend({
  contentHtml: z.string().trim().min(1, "Lektionsinhalt erforderlich.").max(20000),
});

export const draftContentModuleSchema = z.object({
  title: z.string().trim().min(1, "Modultitel erforderlich.").max(300),
  lessons: z.array(draftContentLessonSchema).min(1, "Mind. 1 Lektion je Modul.").max(4, "Max. 4 Lektionen je Modul."),
});

export const courseContentSchema = z.object({
  title: z.string().trim().min(1, "Kurstitel erforderlich.").max(300),
  description: z.string().trim().max(2000).optional(),
  modules: z.array(draftContentModuleSchema).min(1, "Mind. 1 Modul.").max(4, "Max. 4 Module."),
});
export type CourseContent = z.infer<typeof courseContentSchema>;

// --- Schritt 3: Quiz-Fragen ---

export const draftQuestionSchema = z
  .object({
    prompt: z.string().trim().min(1, "Frage erforderlich.").max(2000),
    options: z
      .array(z.object({ text: z.string().trim().min(1, "Optionstext erforderlich.").max(1000) }))
      .min(3, "Mind. 3 Optionen.")
      .max(5, "Max. 5 Optionen."),
    correctOptionIndex: z.number().int().min(0, "Ungültiger Index."),
  })
  .refine((q) => q.correctOptionIndex < q.options.length, {
    message: "correctOptionIndex muss auf eine vorhandene Option zeigen.",
    path: ["correctOptionIndex"],
  });
export type DraftQuestion = z.infer<typeof draftQuestionSchema>;

export const draftModuleQuizSchema = z.object({
  title: z.string().trim().min(1, "Quiz-Titel erforderlich.").max(300),
  questions: z.array(draftQuestionSchema).min(3, "Mind. 3 Fragen.").max(6, "Max. 6 Fragen."),
});
export type DraftModuleQuiz = z.infer<typeof draftModuleQuizSchema>;

export const draftFinalModuleSchema = draftContentModuleSchema.extend({
  quiz: draftModuleQuizSchema.nullable(),
});

/**
 * Roh-Ausgabe von Schritt 3 (Quiz-Generierung) — NUR die Quiz-Daten je
 * Modul, IN DERSELBEN REIHENFOLGE wie `content.modules` aus Schritt 2,
 * OHNE die Lektionsinhalte erneut zu enthalten.
 *
 * Fund beim manuellen Test (Josip, 11.07.2026): der ursprüngliche Plan ließ
 * Claude in Schritt 3 den KOMPLETTEN Kursinhalt (alle Lektionstexte aller
 * Module) 1:1 zurückgeben UND die Quiz-Daten ergänzen — bei mehreren langen
 * Lektionen sprengt das zuverlässig `maxTokens: 6000` (src/lib/generator/
 * pipeline.ts), die Antwort wird mitten im JSON abgeschnitten ("Antwort ist
 * kein gültiges JSON."). Fix: Claude gibt nur noch die Quiz-Daten zurück,
 * der bereits validierte Inhalt aus Schritt 2 wird in process.ts per Code
 * (nicht per KI-Abtippen) mit den Quiz-Daten zusammengeführt — spart Tokens,
 * Kosten UND das Risiko, dass Claude beim Abtippen versehentlich Inhalte
 * verändert.
 */
export const quizStepOutputSchema = z.object({
  modules: z
    .array(z.object({ quiz: draftModuleQuizSchema.nullable() }))
    .min(1, "Mind. 1 Modul.")
    .max(4, "Max. 4 Module."),
});
export type QuizStepOutput = z.infer<typeof quizStepOutputSchema>;

export const courseDraftSchema = z.object({
  title: z.string().trim().min(1, "Kurstitel erforderlich.").max(300),
  description: z.string().trim().max(2000).optional(),
  modules: z.array(draftFinalModuleSchema).min(1, "Mind. 1 Modul.").max(4, "Max. 4 Module."),
});
export type CourseDraft = z.infer<typeof courseDraftSchema>;

// --- ai_jobs.input / ai_jobs.output (Zustandsmaschine, src/lib/generator/process.ts) ---

/**
 * `ai_jobs.input` für `kind='course_gen'` — der bereits extrahierte
 * Klartext (nicht die Rohdatei, siehe Abweichungs-Begründung in
 * src/lib/generator/extract.ts) plus optionale Metadaten aus dem
 * Upload-Formular.
 */
export const courseGenInputSchema = z.object({
  sourceText: z.string().min(1, "Kein Text extrahiert.").max(120000),
  sourceFilename: z.string().max(300).optional(),
  titleHint: z.string().trim().max(300).optional(),
});
export type CourseGenInput = z.infer<typeof courseGenInputSchema>;

/**
 * `ai_jobs.output` für `kind='course_gen'` — Fortschritt + Zwischenergebnis
 * der Zustandsmaschine. `step` 0 = noch nicht gestartet, 1 = Gliederung
 * fertig, 2 = Lektionsinhalte fertig, 3 = fertiger Entwurf (Job-Status
 * dann `done`).
 */
export const courseGenOutputSchema = z.object({
  step: z.number().int().min(0).max(3).default(0),
  outline: courseOutlineSchema.optional(),
  content: courseContentSchema.optional(),
  draft: courseDraftSchema.optional(),
});
export type CourseGenOutput = z.infer<typeof courseGenOutputSchema>;
