import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiAuthError, resolveApiKeyTenant } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserReport } from "@/lib/reporting/queries";

/**
 * Phase 3, Block 7 — REST-API v1 (SPEC.md §7): `GET /api/v1/progress?course_id=`.
 * Reuse `getUserReport()` aus `src/lib/reporting/queries.ts` (gleiche
 * Datenquelle wie der bestehende CSV-Export, hier als JSON statt CSV, mit
 * API-Key-Auth statt Staff-Session). `getUserReport()` selbst nutzt
 * `createClient()` (Nutzer-Session-Client) — das funktioniert hier NICHT
 * (kein eingeloggter Nutzer bei API-Key-Auth), deshalb wird `course_id`
 * hier stattdessen direkt per Admin-Client geprüft/aufgelöst, siehe unten.
 *
 * `course_id` ist Pflicht (SPEC-Notation `?course_id=` ohne
 * Optional-Kennzeichnung, anders als bei den übrigen Endpunkten).
 */
const querySchema = z.object({ courseId: z.string().uuid() });

export async function GET(request: Request) {
  try {
    const { tenantId, apiKeyId } = await resolveApiKeyTenant(request);

    if (
      !(await checkRateLimit("api-v1-progress-read", { maxRequests: 30, windowSeconds: 60, extraKey: apiKeyId }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ courseId: url.searchParams.get("course_id") ?? undefined });
    if (!parsed.success) {
      return NextResponse.json({ error: "course_id (UUID) ist erforderlich." }, { status: 400 });
    }
    const { courseId } = parsed.data;

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

    // getUserReport() nutzt standardmäßig den Nutzer-Session-Client (RLS) —
    // bei API-Key-Auth existiert keine Session. Reporting-Staff-RLS-Policies
    // (progress_staff_select/attempts_staff_select/...) verlangen
    // `is_staff(tenant_id)`, was ohne Session nie erfüllt ist. Deshalb wird
    // hier der bereits vorhandene `admin`-Client als dritter Parameter
    // durchgereicht (Bugfix, Cowork-Verifikation 11.07.2026 — der Aufruf
    // fehlte trotz korrektem Kommentar, `getUserReport()` fiel dadurch auf
    // den Session-Client zurück und hätte wegen RLS immer eine leere
    // `data`-Liste geliefert, ohne Fehler). Die Funktion selbst filtert
    // intern zusätzlich nach `tenant_id` (Defense-in-Depth bleibt erhalten,
    // siehe queries.ts).
    const rows = await getUserReport(tenantId, courseId, admin);

    return NextResponse.json({
      data: rows.map((r) => ({
        userId: r.userId,
        userName: r.userName,
        userEmail: r.userEmail,
        courseId: r.courseId,
        courseTitle: r.courseTitle,
        progressPct: r.progressPct,
        completedLessonsCount: r.completedLessonsCount,
        totalLessonsCount: r.totalLessonsCount,
        lastActivityAt: r.lastActivityAt,
      })),
    });
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[api/v1/progress GET]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
