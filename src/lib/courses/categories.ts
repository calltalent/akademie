/**
 * Kurskategorien (Migration 20260722180000_course_categories.sql, Josips
 * Auftrag: "Kategorien hinzufügen, bearbeiten, löschen können"). Keine
 * geschlossene, fest codierte Liste mehr (vorher `COURSE_CATEGORIES`-Const,
 * global für alle Mandanten) — jeder Mandant pflegt seine eigenen Zeilen in
 * `course_categories`. Dieser Typ ist die gemeinsame Form, die Server-
 * Komponenten nach dem Laden an die Auswahl-/Verwaltungs-Client-Komponenten
 * durchreichen (create-course-form.tsx, publish-toggle.tsx,
 * course-category-manager.tsx, kurskatalog-grid.tsx).
 */
export type CourseCategoryRow = {
  id: string;
  name: string;
};
