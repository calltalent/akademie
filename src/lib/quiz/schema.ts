import { z } from "zod";

/**
 * Block 2 (Phase 2) — Quiz/Prüfungen + Versuche.
 * Spaltennamen exakt aus supabase/migrations/0001_init.sql:
 *   quizzes(id, tenant_id, course_id, lesson_id, title, kind, pass_pct, settings)
 *   questions(id, tenant_id, quiz_id, position, kind, prompt, options, answer, points)
 *   attempts(id, tenant_id, quiz_id, user_id, started_at, submitted_at, answers, score_pct, passed)
 * `settings` (quizzes) ist jsonb ohne feste Spalten — laut Kommentar in der
 * Migration: time_limit_s, attempts_allowed, shuffle. Diese Datei bildet das
 * über `quizSettingsSchema`/`quizFormSchema` ab, nicht als eigene Spalten.
 */

// --- Quiz-Metadaten ---

export const QUIZ_KINDS = ["quiz", "exam"] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];

export const QUIZ_KIND_LABELS: Record<QuizKind, string> = {
  quiz: "Quiz",
  exam: "Prüfung",
};

export type QuizSettings = {
  timeLimitS: number | null;
  attemptsAllowed: number | null;
  shuffle: boolean;
};

/**
 * Formular-Schema für die Quiz-Metadaten (FormData aus dem Admin-Editor).
 * `attemptsAllowed`/`timeLimitS` leer = unbegrenzt/kein Limit (null).
 */
export const quizFormSchema = z.object({
  title: z.string().trim().min(1, "Titel erforderlich.").max(300),
  kind: z.enum(QUIZ_KINDS),
  passPct: z.coerce.number().int().min(0, "0-100.").max(100, "0-100."),
  attemptsAllowed: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.coerce.number().int().min(1, "Mind. 1 Versuch.").max(50, "Max. 50 Versuche.").nullable(),
  ),
  timeLimitS: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.coerce.number().int().min(0, "Nicht negativ.").max(24 * 3600, "Max. 24 Stunden.").nullable(),
  ),
  shuffle: z.preprocess((v) => v === "on" || v === true, z.boolean()),
});
export type QuizFormInput = z.infer<typeof quizFormSchema>;

// --- Fragen ---

export const QUESTION_KINDS = ["single", "multi", "gap", "open"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  single: "Einfachauswahl (eine richtige Antwort)",
  multi: "Mehrfachauswahl (mehrere richtige Antworten)",
  gap: "Lückentext / Freitext (automatisch bewertet)",
  open: "Freitext (nicht automatisch bewertet)",
};

export const optionSchema = z.object({
  id: z.string().min(1).max(50),
  text: z.string().trim().min(1, "Optionstext erforderlich.").max(1000),
});
export type Option = z.infer<typeof optionSchema>;

const questionBaseFields = {
  prompt: z.string().trim().min(1, "Frage erforderlich.").max(2000),
  points: z.coerce.number().int().min(1, "Mind. 1 Punkt.").max(100, "Max. 100 Punkte."),
};

const singleAnswerSchema = z.object({ correctOptionId: z.string().min(1) });
const multiAnswerSchema = z.object({ correctOptionIds: z.array(z.string().min(1)).min(1, "Mind. 1 richtige Option.") });

/**
 * gap: exakter Abgleich (case-/whitespace-tolerant, siehe grade.ts) oder
 * Regex — `values` sind mehrere akzeptierte Varianten (bei `mode: "exact"`)
 * bzw. mehrere Muster (bei `mode: "regex"`, ein Treffer genügt).
 */
export const gapAnswerSchema = z.object({
  mode: z.enum(["exact", "regex"]),
  values: z.array(z.string().trim().min(1)).min(1, "Mind. 1 akzeptierte Antwort.").max(20),
});

const openAnswerSchema = z.object({}).strict();

const questionCoreSingle = z.object({
  kind: z.literal("single"),
  ...questionBaseFields,
  options: z.array(optionSchema).min(2, "Mind. 2 Optionen.").max(10, "Max. 10 Optionen."),
  answer: singleAnswerSchema,
});
const questionCoreMulti = z.object({
  kind: z.literal("multi"),
  ...questionBaseFields,
  options: z.array(optionSchema).min(2, "Mind. 2 Optionen.").max(10, "Max. 10 Optionen."),
  answer: multiAnswerSchema,
});
const questionCoreGap = z.object({
  kind: z.literal("gap"),
  ...questionBaseFields,
  options: z.array(optionSchema).max(0).default([]),
  answer: gapAnswerSchema,
});
const questionCoreOpen = z.object({
  kind: z.literal("open"),
  ...questionBaseFields,
  options: z.array(optionSchema).max(0).default([]),
  answer: openAnswerSchema.default({}),
});

/** Eingabe-Schema für upsertQuestion (Staff-Formular → Server Action). */
export const questionInputSchema = z
  .discriminatedUnion("kind", [questionCoreSingle, questionCoreMulti, questionCoreGap, questionCoreOpen])
  .superRefine((data, ctx) => {
    if (data.kind === "single") {
      if (!data.options.some((o) => o.id === data.answer.correctOptionId)) {
        ctx.addIssue({
          code: "custom",
          message: "Richtige Antwort muss eine der Optionen sein.",
          path: ["answer", "correctOptionId"],
        });
      }
    }
    if (data.kind === "multi") {
      const optionIds = new Set(data.options.map((o) => o.id));
      if (data.answer.correctOptionIds.some((id) => !optionIds.has(id))) {
        ctx.addIssue({
          code: "custom",
          message: "Richtige Antworten müssen Optionen sein.",
          path: ["answer", "correctOptionIds"],
        });
      }
    }
  });
export type QuestionInput = z.infer<typeof questionInputSchema>;

/** Vollständige DB-Zeile inkl. Lösung (`answer`) — NUR serverseitig verwenden. */
export const questionRecordSchema = z.discriminatedUnion("kind", [
  questionCoreSingle.extend({ id: z.string().uuid() }),
  questionCoreMulti.extend({ id: z.string().uuid() }),
  questionCoreGap.extend({ id: z.string().uuid() }),
  questionCoreOpen.extend({ id: z.string().uuid() }),
]);
export type Question = z.infer<typeof questionRecordSchema>;

/** Von Lernenden übermittelte Antworten (vor der Bewertung). */
export const attemptAnswersSchema = z.record(
  z.string(),
  z.union([z.string().max(5000), z.array(z.string().max(500)).max(50)]),
);
export type AttemptAnswers = z.infer<typeof attemptAnswersSchema>;

// --- Leere Entwürfe für den Editor ---

function newOptionId(): string {
  return crypto.randomUUID();
}

export function createEmptyQuestionDraft(kind: QuestionKind): QuestionInput {
  const base = { prompt: "", points: 1 };
  switch (kind) {
    case "single": {
      const optA = newOptionId();
      return {
        kind,
        ...base,
        options: [
          { id: optA, text: "" },
          { id: newOptionId(), text: "" },
        ],
        answer: { correctOptionId: optA },
      };
    }
    case "multi": {
      const optA = newOptionId();
      return {
        kind,
        ...base,
        options: [
          { id: optA, text: "" },
          { id: newOptionId(), text: "" },
        ],
        answer: { correctOptionIds: [] },
      };
    }
    case "gap":
      return { kind, ...base, options: [], answer: { mode: "exact", values: [""] } };
    case "open":
      return { kind, ...base, options: [], answer: {} };
  }
}
