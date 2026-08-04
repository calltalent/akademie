// Analog zu src/lib/stripe/state.ts / src/lib/courses/state.ts: "use server"-
// Dateien duerfen in Next.js 16 nur async-Funktionen exportieren, keine
// Wert-Konstanten. Der initiale Formular-Zustand fuer listing-form.tsx liegt
// deshalb hier, nicht in actions.ts.

export type MarketplaceListingActionState = { error: string | null; success?: boolean };

export const initialMarketplaceListingActionState: MarketplaceListingActionState = { error: null };
