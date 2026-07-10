/**
 * Reine Fortschrittsberechnung — bewusst ohne DB-Zugriff, damit sie ohne
 * Mocking per Vitest testbar ist (CLAUDE.md-Arbeitsweise: nach jedem
 * Feature tester-Agent, hier Unit-Test statt E2E für die Logik selbst).
 */

export type LessonSummary = { id: string; completed: boolean };
export type ModuleSummary = { id: string; lessons: LessonSummary[] };

export type CourseProgress = {
  total: number;
  completed: number;
  percent: number;
  isComplete: boolean;
};

export function computeCourseProgress(modules: ModuleSummary[]): CourseProgress {
  const lessons = modules.flatMap((m) => m.lessons);
  const total = lessons.length;
  const completed = lessons.filter((l) => l.completed).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { total, completed, percent, isComplete: total > 0 && completed === total };
}

/** Flache, geordnete Lektions-ID-Liste über alle Module hinweg (für Vor/Zurück). */
export function flattenLessonIds(modules: ModuleSummary[]): string[] {
  return modules.flatMap((m) => m.lessons.map((l) => l.id));
}

export function findAdjacentLessonIds(
  flatLessonIds: string[],
  currentLessonId: string,
): { prevId: string | null; nextId: string | null } {
  const idx = flatLessonIds.indexOf(currentLessonId);
  if (idx === -1) return { prevId: null, nextId: null };
  return {
    prevId: idx > 0 ? flatLessonIds[idx - 1] : null,
    nextId: idx < flatLessonIds.length - 1 ? flatLessonIds[idx + 1] : null,
  };
}
