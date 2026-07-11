import "server-only";
import { createClient } from "@/lib/supabase/server";
import { computeCourseProgress, type ModuleSummary } from "@/lib/progress/compute";

/**
 * Block 6 (Phase 2) — Reporting v1 + CSV-Export.
 *
 * Spaltennamen exakt aus supabase/migrations/0001_init.sql:
 *   courses(id, tenant_id, title, …)
 *   modules(id, tenant_id, course_id, …)
 *   lessons(id, tenant_id, module_id, status, …)
 *   enrollments(id, tenant_id, course_id, user_id, …)
 *   progress(id, tenant_id, user_id, lesson_id, status, updated_at, …)
 *   quizzes(id, tenant_id, course_id, lesson_id, title, …)
 *   attempts(id, tenant_id, quiz_id, user_id, submitted_at, score_pct, passed, …)
 *   profiles(id, email, full_name, …)
 *
 * ADMIN-CLIENT-FRAGE (laut Auftrag vorab zu klären): NICHT nötig. Anders als
 * bei certificates/issue.ts oder stripe/storefront.ts gibt es für die hier
 * gelesenen Tabellen bereits vollständige Staff-Read-RLS-Policies in
 * 0001_init.sql:
 *   - progress_staff_select   (Zeilen 495-496): `is_staff(tenant_id)` darf ALLE
 *     progress-Zeilen des Mandanten lesen (nicht nur eigene).
 *   - attempts_staff_select   (Zeilen 513-514): analog für attempts.
 *   - enrollments_staff_all   (Zeilen 489-490): `for all` (inkl. select).
 *   - courses_staff_write / modules_staff_write / lessons_staff_write
 *     (Zeilen 470-471, 475-476, 483-484): jeweils `for all` — Staff darf
 *     auch unveröffentlichte Module/Lektionen lesen.
 *   - quizzes_staff_write     (Zeilen 501-502): `for all`.
 *   - profiles_staff_select   (Zeilen 448-453): Staff sieht Profile aller
 *     Mitglieder des eigenen Mandanten (via memberships-Join).
 * Der reguläre Server-Client (`createClient()`, Session-Cookie des
 * angemeldeten Staff-Nutzers, RLS aktiv) genügt deshalb vollständig. Jede
 * Query setzt zusätzlich explizites `.eq("tenant_id", tenantId)`
 * (Defense-in-Depth, gleiches Muster wie admin/abgaben/zahlungen), obwohl
 * RLS bereits mandantenscharf greift.
 *
 * Aggregation bewusst in TypeScript (Loops/Maps), nicht per SQL-View/RPC —
 * Datenmengen pro Mandant sind in Phase 2 überschaubar (siehe Auftrag).
 */

const DUMMY_UUID = "00000000-0000-0000-0000-000000000000";

export type CourseReportRow = {
  courseId: string;
  courseTitle: string;
  enrolledCount: number;
  activeCount: number;
  completionRatePct: number;
};

export type UserReportRow = {
  userId: string;
  userName: string;
  userEmail: string;
  courseId: string;
  courseTitle: string;
  progressPct: number;
  completedLessonsCount: number;
  totalLessonsCount: number;
  lastActivityAt: string | null;
};

export type QuizReportRow = {
  quizId: string;
  quizTitle: string;
  courseTitle: string;
  attemptsCount: number;
  passedCount: number;
  failedCount: number;
  avgScorePct: number | null;
};

type CourseStructure = {
  id: string;
  title: string;
  moduleSummaries: ModuleSummary[]; // nur veröffentlichte Lektionen, ohne "completed"-Werte
  lessonIds: string[];
};

/**
 * Lädt Kurs-/Modul-/Lektionsstruktur des Mandanten (nur veröffentlichte
 * Lektionen zählen für Fortschritt/Abschluss — exakt dieselbe Definition
 * wie certificates/issue.ts und die Lernansicht). Gemeinsam von
 * getCourseReport() und getUserReport() genutzt, um doppelte Queries zu
 * vermeiden.
 */
async function loadCourseStructures(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
): Promise<Map<string, CourseStructure>> {
  const { data: courseRows } = await supabase
    .from("courses")
    .select("id, title")
    .eq("tenant_id", tenantId)
    .order("title", { ascending: true });

  const { data: moduleRows } = await supabase
    .from("modules")
    .select("id, course_id")
    .eq("tenant_id", tenantId);

  const { data: lessonRows } = await supabase
    .from("lessons")
    .select("id, module_id")
    .eq("tenant_id", tenantId)
    .eq("status", "published");

  const lessonsByModule = new Map<string, string[]>();
  for (const l of lessonRows ?? []) {
    const list = lessonsByModule.get(l.module_id) ?? [];
    list.push(l.id);
    lessonsByModule.set(l.module_id, list);
  }

  const modulesByCourse = new Map<string, { id: string; course_id: string }[]>();
  for (const m of moduleRows ?? []) {
    const list = modulesByCourse.get(m.course_id) ?? [];
    list.push(m);
    modulesByCourse.set(m.course_id, list);
  }

  const structures = new Map<string, CourseStructure>();
  for (const c of courseRows ?? []) {
    const modules = modulesByCourse.get(c.id) ?? [];
    const moduleSummaries: ModuleSummary[] = modules.map((m) => ({
      id: m.id,
      lessons: (lessonsByModule.get(m.id) ?? []).map((id) => ({ id, completed: false })),
    }));
    const lessonIds = moduleSummaries.flatMap((m) => m.lessons.map((l) => l.id));
    structures.set(c.id, { id: c.id, title: c.title, moduleSummaries, lessonIds });
  }
  return structures;
}

/** lesson_id -> course_id, für die Zuordnung von progress-Zeilen zu einem Kurs. */
function buildLessonToCourseMap(structures: Map<string, CourseStructure>): Map<string, string> {
  const map = new Map<string, string>();
  for (const structure of structures.values()) {
    for (const lessonId of structure.lessonIds) {
      map.set(lessonId, structure.id);
    }
  }
  return map;
}

type ProgressEntry = { completedIds: Set<string>; lastActivity: string | null };

/**
 * Lädt alle progress-Zeilen des Mandanten und indiziert sie nach
 * `${userId}|${courseId}`. Ein Eintrag existiert genau dann, wenn der
 * Nutzer mindestens eine Lektion dieses Kurses begonnen ODER abgeschlossen
 * hat ("aktiv"). `completedIds` enthält nur tatsächlich abgeschlossene
 * Lektionen.
 */
async function loadProgressIndex(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  lessonToCourse: Map<string, string>,
): Promise<Map<string, ProgressEntry>> {
  const { data: progressRows } = await supabase
    .from("progress")
    .select("user_id, lesson_id, status, updated_at")
    .eq("tenant_id", tenantId);

  const index = new Map<string, ProgressEntry>();
  for (const p of progressRows ?? []) {
    const courseId = lessonToCourse.get(p.lesson_id);
    if (!courseId) continue; // Lektion nicht (mehr) veröffentlicht/gefunden — zählt nicht mit
    const key = `${p.user_id}|${courseId}`;
    let entry = index.get(key);
    if (!entry) {
      entry = { completedIds: new Set(), lastActivity: null };
      index.set(key, entry);
    }
    if (p.status === "completed") entry.completedIds.add(p.lesson_id);
    if (!entry.lastActivity || p.updated_at > entry.lastActivity) entry.lastActivity = p.updated_at;
  }
  return index;
}

async function loadProfilesByIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userIds: string[],
): Promise<Map<string, { email: string; fullName: string | null }>> {
  const ids = userIds.length > 0 ? userIds : [DUMMY_UUID];
  const { data } = await supabase.from("profiles").select("id, email, full_name").in("id", ids);
  const map = new Map<string, { email: string; fullName: string | null }>();
  for (const p of data ?? []) {
    map.set(p.id, { email: p.email, fullName: p.full_name });
  }
  return map;
}

/**
 * Kursberichte: pro Kurs Anzahl eingeschriebener/aktiver Lernender und
 * Abschlussquote (%). "Aktiv" = mindestens eine Lektion begonnen oder
 * abgeschlossen (KEIN 30-Tage-Zeitfenster — das ist eine separate
 * `/admin`-Dashboard-Kachel, nicht Teil dieses Blocks). "Abgeschlossen" =
 * alle veröffentlichten Lektionen des Kurses abgeschlossen
 * (computeCourseProgress().isComplete, dieselbe Definition wie bei der
 * Zertifikats-Ausstellung).
 */
export async function getCourseReport(tenantId: string): Promise<CourseReportRow[]> {
  const supabase = await createClient();
  const structures = await loadCourseStructures(supabase, tenantId);
  const lessonToCourse = buildLessonToCourseMap(structures);
  const progressIndex = await loadProgressIndex(supabase, tenantId, lessonToCourse);

  const { data: enrollmentRows } = await supabase
    .from("enrollments")
    .select("course_id, user_id")
    .eq("tenant_id", tenantId);

  const enrollmentsByCourse = new Map<string, string[]>();
  for (const e of enrollmentRows ?? []) {
    const list = enrollmentsByCourse.get(e.course_id) ?? [];
    list.push(e.user_id);
    enrollmentsByCourse.set(e.course_id, list);
  }

  const rows: CourseReportRow[] = [];
  for (const structure of structures.values()) {
    const enrolledUserIds = enrollmentsByCourse.get(structure.id) ?? [];
    let activeCount = 0;
    let completedCount = 0;

    for (const userId of enrolledUserIds) {
      const entry = progressIndex.get(`${userId}|${structure.id}`);
      if (entry) activeCount += 1;

      const completedIds = entry?.completedIds ?? new Set<string>();
      const moduleSummaries: ModuleSummary[] = structure.moduleSummaries.map((m) => ({
        id: m.id,
        lessons: m.lessons.map((l) => ({ id: l.id, completed: completedIds.has(l.id) })),
      }));
      if (computeCourseProgress(moduleSummaries).isComplete) completedCount += 1;
    }

    rows.push({
      courseId: structure.id,
      courseTitle: structure.title,
      enrolledCount: enrolledUserIds.length,
      activeCount,
      completionRatePct:
        enrolledUserIds.length === 0 ? 0 : Math.round((completedCount / enrolledUserIds.length) * 100),
    });
  }
  return rows;
}

/**
 * Nutzerberichte: eine Zeile je Einschreibung (Nutzer + Kurs), optional
 * gefiltert auf einen einzelnen Kurs. `courseId` MUSS vom Aufrufer bereits
 * gegen `tenantId` geprüft sein (siehe Route-Handler) — hier zusätzlich
 * per `.eq("tenant_id", tenantId)` auf der enrollments-Query abgesichert,
 * sodass eine fremde courseId ohnehin nie Zeilen liefert (Defense-in-Depth).
 */
export async function getUserReport(tenantId: string, courseId?: string): Promise<UserReportRow[]> {
  const supabase = await createClient();
  const structures = await loadCourseStructures(supabase, tenantId);
  const lessonToCourse = buildLessonToCourseMap(structures);
  const progressIndex = await loadProgressIndex(supabase, tenantId, lessonToCourse);

  let enrollmentQuery = supabase
    .from("enrollments")
    .select("course_id, user_id")
    .eq("tenant_id", tenantId);
  if (courseId) enrollmentQuery = enrollmentQuery.eq("course_id", courseId);
  const { data: enrollmentRows } = await enrollmentQuery;

  const userIds = Array.from(new Set((enrollmentRows ?? []).map((e) => e.user_id)));
  const profiles = await loadProfilesByIds(supabase, userIds);

  const rows: UserReportRow[] = [];
  for (const e of enrollmentRows ?? []) {
    const structure = structures.get(e.course_id);
    if (!structure) continue; // Kurs nicht (mehr) im Mandanten gefunden

    const entry = progressIndex.get(`${e.user_id}|${e.course_id}`);
    const completedIds = entry?.completedIds ?? new Set<string>();
    const moduleSummaries: ModuleSummary[] = structure.moduleSummaries.map((m) => ({
      id: m.id,
      lessons: m.lessons.map((l) => ({ id: l.id, completed: completedIds.has(l.id) })),
    }));
    const progress = computeCourseProgress(moduleSummaries);
    const profile = profiles.get(e.user_id);

    rows.push({
      userId: e.user_id,
      userName: profile?.fullName || profile?.email || "Unbekannt",
      userEmail: profile?.email ?? "",
      courseId: structure.id,
      courseTitle: structure.title,
      progressPct: progress.percent,
      completedLessonsCount: progress.completed,
      totalLessonsCount: progress.total,
      lastActivityAt: entry?.lastActivity ?? null,
    });
  }

  rows.sort((a, b) => a.userName.localeCompare(b.userName, "de") || a.courseTitle.localeCompare(b.courseTitle, "de"));
  return rows;
}

/**
 * Quiz-Auswertung: pro Quiz Anzahl Versuche, bestanden/nicht bestanden und
 * Durchschnittsergebnis (%). "Versuche" zählt ALLE attempts-Zeilen
 * (begonnen + abgeschickt); bestanden/nicht-bestanden/Durchschnitt
 * berücksichtigen NUR abgeschickte Versuche (`submitted_at is not null`),
 * da `score_pct`/`passed` erst dann gesetzt sind (siehe attempts-Schema,
 * 0001_init.sql Zeilen 185-197).
 */
export async function getQuizReport(tenantId: string): Promise<QuizReportRow[]> {
  const supabase = await createClient();

  const { data: quizRows } = await supabase
    .from("quizzes")
    .select("id, title, course_id")
    .eq("tenant_id", tenantId)
    .order("title", { ascending: true });

  const courseIds = Array.from(
    new Set((quizRows ?? []).map((q) => q.course_id).filter((id): id is string => Boolean(id))),
  );
  const { data: courseRows } = courseIds.length
    ? await supabase.from("courses").select("id, title").in("id", courseIds)
    : { data: [] as { id: string; title: string }[] };
  const courseTitleById = new Map((courseRows ?? []).map((c) => [c.id, c.title]));

  const { data: attemptRows } = await supabase
    .from("attempts")
    .select("quiz_id, submitted_at, score_pct, passed")
    .eq("tenant_id", tenantId);

  const attemptsByQuiz = new Map<string, { submitted_at: string | null; score_pct: number | null; passed: boolean | null }[]>();
  for (const a of attemptRows ?? []) {
    const list = attemptsByQuiz.get(a.quiz_id) ?? [];
    list.push(a);
    attemptsByQuiz.set(a.quiz_id, list);
  }

  return (quizRows ?? []).map((q) => {
    const attempts = attemptsByQuiz.get(q.id) ?? [];
    const submitted = attempts.filter((a) => a.submitted_at !== null);
    const passedCount = submitted.filter((a) => a.passed === true).length;
    const failedCount = submitted.filter((a) => a.passed === false).length;
    const avgScorePct =
      submitted.length === 0
        ? null
        : Math.round(submitted.reduce((sum, a) => sum + (a.score_pct ?? 0), 0) / submitted.length);

    return {
      quizId: q.id,
      quizTitle: q.title,
      courseTitle: (q.course_id && courseTitleById.get(q.course_id)) || "Kein Kurs zugeordnet",
      attemptsCount: attempts.length,
      passedCount,
      failedCount,
      avgScorePct,
    };
  });
}
