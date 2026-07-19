import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffTenant } from "@/lib/auth/staff";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { getCourseReport, getUserReport, getQuizReport } from "@/lib/reporting/queries";
import { toCsv } from "@/lib/reporting/csv";
import { genericErrorMessage } from "@/lib/errors/generic";

const querySchema = z.object({
  type: z.enum(["courses", "users", "quiz"]),
  courseId: z.string().uuid().optional(),
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatLastActivity(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("de-DE") : "—";
}

/**
 * GET /api/admin/reporting/csv?type=courses|users|quiz[&courseId=…]
 * Staff-only (requireStaffTenant — owner/admin/trainer, siehe
 * progress_staff_select/attempts_staff_select/… in queries.ts). Export ist
 * potenziell teuer bei großen Mandanten (lädt alle Kurs-/Nutzer-/Quiz-Daten
 * unaggregiert und rechnet in TypeScript) — deshalb Rate-Limiting.
 *
 * SICHERHEITSKRITISCH (Auftrag Block 6): `courseId` kommt aus dem
 * Query-String, also vom Client. `tenant.id` kommt AUSSCHLIESSLICH aus dem
 * bereits geprüften Server-Kontext (requireStaffTenant()). Bevor `courseId`
 * an getUserReport() weitergereicht wird, wird hier zusätzlich geprüft,
 * dass der Kurs tatsächlich zu `tenant.id` gehört — sonst könnte ein
 * Mandant über die courseId eines fremden Mandanten dessen Nutzerdaten
 * abgreifen. (queries.ts filtert enrollments zusätzlich ohnehin nach
 * tenant_id, das hier ist Defense-in-Depth mit einer sauberen 404 statt
 * einer stillschweigend leeren CSV.)
 */
export async function GET(request: Request) {
  try {
    const { tenant, supabase } = await requireStaffTenant();

    if (
      !(await checkRateLimit("reporting-csv", {
        maxRequests: 30,
        windowSeconds: 3600,
        extraKey: tenant.id,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      type: url.searchParams.get("type") ?? undefined,
      courseId: url.searchParams.get("courseId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." },
        { status: 400 },
      );
    }
    const { type, courseId } = parsed.data;

    if (type === "users" && courseId) {
      const { data: course } = await supabase
        .from("courses")
        .select("id")
        .eq("id", courseId)
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (!course) {
        return NextResponse.json({ error: "Kurs nicht gefunden." }, { status: 404 });
      }
    }

    let csv: string;
    let filenamePrefix: string;

    if (type === "courses") {
      const rows = await getCourseReport(tenant.id);
      csv = toCsv(
        ["Kurs", "Eingeschrieben", "Aktiv", "Abschlussquote (%)"],
        rows.map((r) => [r.courseTitle, r.enrolledCount, r.activeCount, r.completionRatePct]),
      );
      filenamePrefix = "kursbericht";
    } else if (type === "users") {
      const rows = await getUserReport(tenant.id, courseId);
      csv = toCsv(
        ["Name", "E-Mail", "Kurs", "Fortschritt (%)", "Abgeschlossene Lektionen", "Letzte Aktivität"],
        rows.map((r) => [
          r.userName,
          r.userEmail,
          r.courseTitle,
          r.progressPct,
          r.completedLessonsCount,
          formatLastActivity(r.lastActivityAt),
        ]),
      );
      filenamePrefix = "nutzerbericht";
    } else {
      // Granularität seit 19.07.2026 eine Zeile je Quiz+Nutzer statt der
      // vorherigen Mandanten-weiten Aggregation je Quiz — siehe Kommentar in
      // lib/reporting/queries.ts (QuizReportRow).
      const rows = await getQuizReport(tenant.id);
      csv = toCsv(
        ["Quiz", "Kurs", "Nutzer", "Versuche", "Bestes Ergebnis (%)"],
        rows.map((r) => [r.quizTitle, r.courseTitle, r.userName, r.attemptsCount, r.bestScorePct ?? "—"]),
      );
      filenamePrefix = "quizauswertung";
    }

    const filename = `${filenamePrefix}-${tenant.slug}-${todayIso()}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const rawMessage = e instanceof Error ? e.message : "Unbekannter Fehler.";
    const status =
      rawMessage.includes("Nicht angemeldet") || rawMessage.includes("nur für Team-Mitglieder") ? 403 : 500;
    return NextResponse.json({ error: genericErrorMessage(e) }, { status });
  }
}
