export type CourseActionState = {
  error: string | null;
  success?: boolean;
  /** Nur von createCourse() gesetzt — für die Weiterleitung in den neuen Kurs-Editor. */
  courseId?: string;
};

export const initialCourseActionState: CourseActionState = { error: null };
