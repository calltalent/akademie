/**
 * Standard-Kurskategorien für den Kurskatalog-Filter (Referenz:
 * Kurskatalog.dc.html). Genutzt von der Filter-Leiste (kurskatalog-grid.tsx)
 * und der Kategorie-Auswahl im Admin (create-course-form.tsx,
 * CourseCategorySelect). Die DB-Spalte `courses.category` ist freier Text —
 * ein Kurs kann null (keine Kategorie → nur unter „Alle Kurse") oder einen
 * dieser Werte haben.
 */
export const COURSE_CATEGORIES = ["Vertrieb", "Telefonie", "Abschluss", "Mindset"] as const;

export type CourseCategory = (typeof COURSE_CATEGORIES)[number];
