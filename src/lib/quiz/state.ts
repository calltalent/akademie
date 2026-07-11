// Analog zu src/lib/courses/state.ts: "use server"-Dateien dürfen in
// Next.js 16 nur async-Funktionen exportieren, keine Wert-Konstanten
// (siehe PHASENSTATUS.md, Block-3-Bugfix). initialQuizActionState liegt
// deshalb hier, nicht in actions.ts.

export type QuizActionState = { error: string | null; success?: boolean };

export const initialQuizActionState: QuizActionState = { error: null };

export type QuestionActionState = { error: string | null; success?: boolean };

export const initialQuestionActionState: QuestionActionState = { error: null };
