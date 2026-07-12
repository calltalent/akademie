/**
 * "use server"-Dateien dürfen in Next.js 16 nur async Funktionen
 * exportieren (siehe gleiches Muster in courses/state.ts, quiz/state.ts,
 * submissions/state.ts) — Konstante/Typ deshalb in eigener Datei.
 */
export type ContactActionState = { error: string | null; success?: boolean };

export const initialContactActionState: ContactActionState = { error: null };
