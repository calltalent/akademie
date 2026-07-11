// Analog zu src/lib/courses/state.ts und src/lib/quiz/state.ts:
// "use server"-Dateien dürfen in Next.js 16 nur async-Funktionen
// exportieren, keine Typ-/Wert-Exporte (siehe PHASENSTATUS.md,
// Block-3-Bugfix). Die Rückgabetypen von src/lib/tutor/actions.ts liegen
// deshalb hier, nicht direkt in actions.ts.

export type TutorSource = { lessonId: string; lessonTitle: string };

export type AskTutorResult =
  | { ok: true; conversationId: string; answer: string; sources: TutorSource[] }
  | { ok: false; reason: "quota_exceeded" | "not_found" | "error"; message: string };
