import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { SUBMISSION_STATUSES, type SubmissionKind, type SubmissionStatus } from "@/lib/submissions/schema";
import { SubmissionInbox, type InboxSubmission } from "@/components/admin/submission-inbox";

/**
 * Staff-Inbox aller Abgaben des Mandanten. Erbt das Staff-Gate aus
 * admin/layout.tsx; RLS `submissions_staff_all` erlaubt Lesen mandantenweit
 * — `.eq("tenant_id", …)` trotzdem explizit gesetzt (Defense-in-Depth,
 * gleiches Muster wie überall sonst im Admin-Bereich).
 *
 * `submissions` hat keine direkte `course_id`-Spalte (nur `lesson_id`) —
 * der Kurstitel wird über `lessons.module_id -> modules.course_id ->
 * courses.title` nachgeladen (drei einfache Zusatzabfragen statt eines
 * tief verschachtelten PostgREST-Selects, für Lesbarkeit/Testbarkeit).
 *
 * Design-Block 6 (13.07.2026, AdminAbgaben.dc.html): Kopfzeile mit
 * Breadcrumb + "N offen · M überfällig"-Pille ergänzt. Beide Zahlen sind
 * echte, vom Filter unabhängige Zählungen (nicht die evtl. gefilterte Liste
 * unten) — "überfällig" = `status='submitted'` UND älter als 48h (siehe
 * Begründung in submission-inbox.tsx, dort dieselbe Schwelle für die
 * Zeilen-Badges verwendet).
 */
const OVERDUE_THRESHOLD_MS = 48 * 60 * 60 * 1000;
export default async function AdminAbgabenPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const tenant = await getTenant();
  // Zugriff ist über admin/layout.tsx (checkStaffAccess) gated; ohne Mandant
  // rendert das Layout „Kein Zugriff". Die Seite wird im RSC-Baum dennoch
  // ausgewertet — daher defensiv abbrechen statt auf tenant!.id zu laufen.
  if (!tenant) return null;
  const supabase = await createClient();

  const filterStatus: SubmissionStatus | null =
    status && (SUBMISSION_STATUSES as readonly string[]).includes(status) ? (status as SubmissionStatus) : null;

  // BUGFIX (Josips Testlauf, 12.07.2026, 7. Runde): `profiles(email,
  // full_name)` war ein mehrdeutiger PostgREST-Embed — `submissions` hat
  // ZWEI Fremdschlüssel auf `profiles` (`user_id` und `reviewed_by`,
  // 0001_init.sql). Ohne expliziten Beziehungs-Hinweis kann PostgREST nicht
  // entscheiden, welcher gemeint ist, und liefert einen Fehler
  // (PGRST201, "Could not embed") statt Daten — `submissionRows` wurde
  // dadurch immer `null`. Da unten nur `{ data }` destrukturiert wurde (kein
  // `error`-Check), lief das SILENT durch: die Inbox zeigte fälschlich
  // "Keine Abgaben gefunden.", obwohl Abgaben existierten. Erstmals durch
  // die E2E-Suite (`submission-review.spec.ts`) aufgedeckt — dieser
  // Abfragepfad wurde vorher offenbar nie mit echten Daten durchlaufen.
  // Fix: FK-Constraint-Name als Embed-Hinweis (`profiles!submissions_user_id_fkey`)
  // + Fehler jetzt geloggt statt verschluckt.
  let query = supabase
    .from("submissions")
    .select(
      "id, lesson_id, user_id, kind, content, file_path, status, grade, feedback, created_at, lessons(title, module_id), profiles!submissions_user_id_fkey(email, full_name)",
    )
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false });

  if (filterStatus) query = query.eq("status", filterStatus);

  const { data: submissionRows, error: submissionsError } = await query;
  if (submissionsError) {
    console.error("[admin/abgaben] Abgaben konnten nicht geladen werden:", submissionsError.message);
  }

  // react-hooks/purity: Date.now() gilt fuer Client-Komponenten mit
  // React-Compiler-Memoization als "unrein" (siehe identische Begruendung in
  // portal/mandanten/[id]/page.tsx, Josips Lint-Lauf 12.07.2026). Diese
  // Funktion ist eine async Server Component (einmal pro Request, kein
  // Re-Render), daher hier bewusst deaktiviert statt kuenstlich umgebaut.
  // eslint-disable-next-line react-hooks/purity
  const overdueCutoffIso = new Date(Date.now() - OVERDUE_THRESHOLD_MS).toISOString();
  const { count: openCount } = await supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("status", "submitted")
    .gte("created_at", overdueCutoffIso);
  const { count: overdueCount } = await supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("status", "submitted")
    .lt("created_at", overdueCutoffIso);

  const moduleIds = Array.from(
    new Set(
      (submissionRows ?? [])
        .map((s) => {
          const lesson = Array.isArray(s.lessons) ? s.lessons[0] : s.lessons;
          return lesson?.module_id as string | undefined;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const { data: moduleRows } = moduleIds.length
    ? await supabase.from("modules").select("id, course_id").in("id", moduleIds)
    : { data: [] as { id: string; course_id: string }[] };

  const courseIds = Array.from(new Set((moduleRows ?? []).map((m) => m.course_id)));
  const { data: courseRows } = courseIds.length
    ? await supabase.from("courses").select("id, title").in("id", courseIds)
    : { data: [] as { id: string; title: string }[] };

  const courseTitleByModuleId = new Map<string, string>();
  for (const m of moduleRows ?? []) {
    const course = (courseRows ?? []).find((c) => c.id === m.course_id);
    if (course) courseTitleByModuleId.set(m.id, course.title);
  }

  const submissions: InboxSubmission[] = (submissionRows ?? []).map((s) => {
    const lesson = Array.isArray(s.lessons) ? s.lessons[0] : s.lessons;
    const profile = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
    return {
      id: s.id,
      lessonTitle: lesson?.title ?? "Unbekannte Lektion",
      courseTitle: (lesson?.module_id && courseTitleByModuleId.get(lesson.module_id)) || "Unbekannter Kurs",
      userEmail: profile?.email ?? "",
      userName: profile?.full_name ?? null,
      kind: s.kind as SubmissionKind,
      content: s.content,
      filePath: s.file_path,
      status: s.status as SubmissionStatus,
      grade: s.grade,
      feedback: s.feedback,
      createdAt: s.created_at,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            Inhalte · Abgaben
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            Abgaben
          </h1>
        </div>
        <span
          className="inline-flex flex-none items-center gap-2 rounded-[10px] px-[15px] py-[9px] text-sm font-bold"
          style={{ background: "#F7EED4", color: "#1A1A2E" }}
        >
          {openCount ?? 0} offen · {overdueCount ?? 0} überfällig
        </span>
      </header>
      <SubmissionInbox submissions={submissions} activeStatus={filterStatus} />
    </div>
  );
}
