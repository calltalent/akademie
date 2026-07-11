// Analog zu src/lib/courses/state.ts / src/lib/quiz/state.ts: "use server"-
// Dateien duerfen in Next.js 16 nur async-Funktionen exportieren, keine
// Wert-Konstanten (siehe PHASENSTATUS.md, Block-3-Bugfix). Der initiale
// Formular-Zustand fuer product-form.tsx liegt deshalb hier, nicht in
// products.ts.

export type ProductActionState = { error: string | null; success?: boolean };

export const initialProductActionState: ProductActionState = { error: null };
