import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiAuthError, resolveApiKeyTenant } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { translateDbError } from "@/lib/errors/db";

/**
 * Phase 3, Block 7 — REST-API v1 (SPEC.md §7): `GET/POST /api/v1/enrollments`.
 * Gleiches Paginierungs-/Auth-Muster wie `/api/v1/users`.
 */
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  courseId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

const createSchema = z.object({
  userId: z.string().uuid(),
  courseId: z.string().uuid(),
});

function errorResponse(e: unknown, tag: string) {
  if (e instanceof ApiAuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error(`[${tag}]`, e instanceof Error ? e.message : e);
  return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const { tenantId, apiKeyId } = await resolveApiKeyTenant(request);

    if (
      !(await checkRateLimit("api-v1-enrollments-read", {
        maxRequests: 60,
        windowSeconds: 60,
        extraKey: apiKeyId,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const url = new URL(request.url);
    const parsedQuery = listQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      courseId: url.searchParams.get("courseId") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Ungültige Query-Parameter." }, { status: 400 });
    }
    const { page, pageSize, courseId, userId } = parsedQuery.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const admin = createAdminClient();
    let query = admin
      .from("enrollments")
      .select("id, course_id, user_id, source, enrolled_at, expires_at", { count: "exact" })
      .eq("tenant_id", tenantId);
    if (courseId) query = query.eq("course_id", courseId);
    if (userId) query = query.eq("user_id", userId);

    const { data, error, count } = await query
      .order("enrolled_at", { ascending: false })
      .range(from, to);
    if (error) {
      return NextResponse.json({ error: "Einschreibungen konnten nicht geladen werden." }, { status: 500 });
    }

    const enrollments = (data ?? []).map((e) => ({
      id: e.id,
      courseId: e.course_id,
      userId: e.user_id,
      source: e.source,
      enrolledAt: e.enrolled_at,
      expiresAt: e.expires_at,
    }));

    return NextResponse.json({ data: enrollments, page, pageSize, total: count ?? enrollments.length });
  } catch (e) {
    return errorResponse(e, "api/v1/enrollments GET");
  }
}

/**
 * POST /api/v1/enrollments — schreibt einen bestehenden Nutzer (muss
 * bereits ein `profiles`-Konto haben, z. B. über `POST /api/v1/users`
 * angelegt) in einen Kurs des Mandanten ein. `source: "api"` — eigener
 * Enum-Wert (Migration `20260711223000_enrollments_source_add_api`,
 * Josips Entscheidung 11.07.2026 nach ursprünglich dokumentierter
 * Abweichung auf `"manual"`), ermöglicht saubere Unterscheidung zwischen
 * Staff-Admin-UI-Einträgen und externen API-Integrationen im
 * Reporting/Audit.
 */
export async function POST(request: Request) {
  try {
    const { tenantId, apiKeyId } = await resolveApiKeyTenant(request);

    if (
      !(await checkRateLimit("api-v1-enrollments-write", {
        maxRequests: 30,
        windowSeconds: 60,
        extraKey: apiKeyId,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const json = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
        { status: 400 },
      );
    }
    const { userId, courseId } = parsed.data;

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

    const { data: profile } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (!profile) {
      return NextResponse.json(
        { error: "Nutzer nicht gefunden — zuerst über POST /api/v1/users anlegen." },
        { status: 404 },
      );
    }

    // Sicherheits-Fix (security-reviewer-Durchgang Phase 3, 11.07.2026, HOCH-Fund #2):
    // `profiles.id` existiert plattformweit, nicht nur beim aufrufenden Mandanten —
    // ohne diese Prüfung konnte ein API-Key-Inhaber von Mandant A eine beliebige,
    // bereits existierende profiles.id eines Nutzers aus Mandant B einschreiben,
    // obwohl diese Person nie Mitglied von Mandant A war. Die „fremde" Einschreibung
    // wäre danach über GET /api/v1/progress und /api/v1/reports/course/[id] inkl.
    // Name/E-Mail sichtbar gewesen — Cross-Tenant-PII-Leck im Reporting-Pfad.
    const { data: membership } = await admin
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!membership) {
      return NextResponse.json(
        {
          error:
            "Nutzer ist kein aktives Mitglied dieses Mandanten — zuerst über POST /api/v1/users anlegen.",
        },
        { status: 404 },
      );
    }

    const { data: enrollment, error } = await admin
      .from("enrollments")
      .upsert(
        { tenant_id: tenantId, course_id: courseId, user_id: userId, source: "api" },
        { onConflict: "course_id,user_id" },
      )
      .select("id, course_id, user_id, source, enrolled_at")
      .single();
    if (error || !enrollment) {
      return NextResponse.json(
        { error: error ? translateDbError(error) : "Einschreibung fehlgeschlagen." },
        { status: 500 },
      );
    }

    dispatchWebhookEvent(tenantId, "enrollment.created", {
      enrollment_id: enrollment.id,
      course_id: enrollment.course_id,
      user_id: enrollment.user_id,
      source: enrollment.source,
    }).catch(() => {});

    return NextResponse.json(
      {
        id: enrollment.id,
        courseId: enrollment.course_id,
        userId: enrollment.user_id,
        source: enrollment.source,
        enrolledAt: enrollment.enrolled_at,
      },
      { status: 201 },
    );
  } catch (e) {
    return errorResponse(e, "api/v1/enrollments POST");
  }
}
