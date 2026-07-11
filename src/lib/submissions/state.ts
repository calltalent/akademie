// Analog zu src/lib/quiz/state.ts: "use server"-Dateien dürfen in Next.js 16
// nur async-Funktionen exportieren, keine Wert-Konstanten (siehe
// PHASENSTATUS.md, Block-3-Bugfix aus Block 2). initialGradeSubmissionActionState
// liegt deshalb hier, nicht in actions.ts.

export type GradeSubmissionActionState = { error: string | null; success?: boolean };

export const initialGradeSubmissionActionState: GradeSubmissionActionState = { error: null };
