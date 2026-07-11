import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiAuthError, resolveApiKeyTenant } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserReport } from "@/lib/reporting/queries";
import { toCsv } from "@/lib/reporting/csv";

/**
 * Phase 3, Block 7 — REST-API v1 (SPEC.md §7): `GET /api/v1/reports/course/:id.csv`.
 * Reuse `getUserReport()` + `toCsv()` — gleiche Logik wie
 * `src/app/api/admin/reporting/csv/route.ts`, nur API-Key-Auth statt
 * Staff-Session (`getUserReport()` bekommt hier den Admin-Client
 * übergeben, siehe Kommentar dort — Session-Client hätte wegen RLS leere
 * Ergebnisse geliefert).
 *
 * Pfad-Segment `[id]` akzeptiert sowohl `<uuid>` als auch `<uuid>.csv`
 * (SPEC-Notation `reports/course/:id.csv`) — das `.csv`-Suffix wird
 * bewusst toleriert statt strikt verlangt, damit sowohl
 * `/api/v1/reports/course/<uuid>` als auch `/api/v1/reports/course/<uuid>.csv`
 * funktionieren (Next.js-Routing kennt keine Datei-Endungen als
 * Segment-Suffix-Matcher).
 */
const uuidSchema = z.string().uuid();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatLastActivity(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("de-DE") : "—";
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId, apiKeyId } = await resolveApiKeyTenant(request);

    if (
      !(await checkRateLimit("api-v1-reports-course", {
        maxRequests: 20,
        windowSeconds: 3600,
        extraKey: apiKeyId,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const { id } = await params;
    const courseId = id.replace(/\.csv$/i, "");
    if (!uuidSchema.safeParse(courseId).success) {
      return NextResponse.json({ error: "Ungültige Kurs-ID." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: course } = await admin
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!course) {
      return NextResponse.json({ error: "Kurs nicht gefunden." }, { status: 404 });
    }

    const rows = await getUserReport(tenantId, courseId, admin);
    const csv = toCsv(
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

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nutzerbericht-${courseId}-${todayIso()}.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[api/v1/reports/course/[id] GET]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
