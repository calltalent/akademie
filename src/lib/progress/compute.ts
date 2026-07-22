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

/**
 * Sektions-/Modul-Abschluss-Bildschirm (Josips Auftrag, 22.07.2026, mit
 * Konkurrenz-Screenshot als funktionale Referenz — Design bewusst NICHT
 * übernommen, siehe CLAUDE.md §3.1). Reine Grenz-Erkennung: ist die gerade
 * abgeschlossene Lektion die LETZTE ihrer Sektion bzw. ihres Moduls (nach
 * `position`)? Modul gewinnt, falls beides zutrifft — eine Lektion, die
 * zugleich letzte ihrer Sektion UND letzte ihres Moduls ist, zeigt den
 * Modul-Bildschirm, nicht den Sektion-Bildschirm (höhere Ebene ist das
 * bedeutendere Ereignis). Lektionen ohne `sectionId` (lose, vor der
 * Sections-Migration angelegt) können trotzdem eine Modul-Grenze auslösen,
 * nie eine Sektion-Grenze (sie gehören zu keiner).
 */
export type LessonPos = { id: string; moduleId: string; sectionId: string | null; position: number };
export type SectionPos = { id: string; moduleId: string; position: number };
export type ModulePos = { id: string; position: number };

export function computeLessonBoundary(
  lessons: LessonPos[],
  currentLessonId: string,
): { kind: "module" | "section" | "none"; sectionId?: string; moduleId?: string } {
  const current = lessons.find((l) => l.id === currentLessonId);
  if (!current) return { kind: "none" };

  const moduleLessons = lessons
    .filter((l) => l.moduleId === current.moduleId)
    .sort((a, b) => a.position - b.position);
  const isLastInModule = moduleLessons[moduleLessons.length - 1]?.id === current.id;
  if (isLastInModule) return { kind: "module", moduleId: current.moduleId };

  if (current.sectionId) {
    const sectionLessons = lessons
      .filter((l) => l.sectionId === current.sectionId)
      .sort((a, b) => a.position - b.position);
    const isLastInSection = sectionLessons[sectionLessons.length - 1]?.id === current.id;
    if (isLastInSection) {
      return { kind: "section", sectionId: current.sectionId, moduleId: current.moduleId };
    }
  }

  return { kind: "none" };
}

/**
 * Nächste Sektion: höhere `position` im selben Modul, sonst erste Sektion
 * (niedrigste `position`) des nächsten Moduls. Bewusste Vereinfachung: findet
 * sich auch dort keine Sektion, `null` — kein rekursives Weitersuchen über
 * mehrere Module hinweg (seltener Randfall, Modul-Editor legt Sektionen
 * durchgängig an).
 */
export function findNextSection(
  sections: SectionPos[],
  modules: ModulePos[],
  currentSectionId: string,
  currentModuleId: string,
): { sectionId: string; moduleId: string } | null {
  const current = sections.find((s) => s.id === currentSectionId);
  if (!current) return null;

  const sameModuleNext = sections
    .filter((s) => s.moduleId === currentModuleId && s.position > current.position)
    .sort((a, b) => a.position - b.position)[0];
  if (sameModuleNext) return { sectionId: sameModuleNext.id, moduleId: currentModuleId };

  const nextModule = findNextModule(modules, currentModuleId);
  if (!nextModule) return null;

  const nextModuleFirstSection = sections
    .filter((s) => s.moduleId === nextModule.moduleId)
    .sort((a, b) => a.position - b.position)[0];
  if (!nextModuleFirstSection) return null;

  return { sectionId: nextModuleFirstSection.id, moduleId: nextModule.moduleId };
}

export function findNextModule(
  modules: ModulePos[],
  currentModuleId: string,
): { moduleId: string } | null {
  const current = modules.find((m) => m.id === currentModuleId);
  if (!current) return null;

  const next = modules
    .filter((m) => m.position > current.position)
    .sort((a, b) => a.position - b.position)[0];
  return next ? { moduleId: next.id } : null;
}
