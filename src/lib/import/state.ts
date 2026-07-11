/**
 * ABWEICHUNG vom architect-Plan (dokumentiert, technisch notwendig, gleiches
 * Muster wie src/lib/courses/state.ts und src/lib/platform/schema.ts):
 * Next.js 16 erlaubt in "use server"-Dateien ausschließlich async-
 * Funktions-Exporte. Typ und Startwert für den Import-Formular-State dürfen
 * deshalb nicht aus src/lib/import/actions.ts exportiert werden.
 */
export type ImportActionState = {
  error: string | null;
  errors?: string[];
  success?: boolean;
  courseId?: string;
  moduleCount?: number;
  lessonCount?: number;
  videoCount?: number;
};

export const initialImportActionState: ImportActionState = { error: null };
