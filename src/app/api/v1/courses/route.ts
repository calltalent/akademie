import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiAuthError, resolveApiKeyTenant } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Phase 3, Block 7 — REST-API v1 (SPEC.md §7): `GET /api/v1/courses`.
 * Liste ALLER Kurse des Mandanten (nicht nur `published`) — dieser
 * Endpunkt läuft im Namen des Mandanten-Betreibers selbst (API-Key =
 * eigene Integration, kein anonymer Storefront-Zugriff), daher analog zur
 * Staff-Sicht in `/admin/kurse`.
 */
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export async function GET(request: Request) {
  try {
    const { tenantId, apiKeyId } = await resolveApiKeyTenant(request);

    if (
      !(await checkRateLimit("api-v1-courses-read", { maxRequests: 60, windowSeconds: 60, extraKey: apiKeyId }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const url = new URL(request.url);
    const parsedQuery = listQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Ungültige Query-Parameter." }, { status: 400 });
    }
    const { page, pageSize } = parsedQuery.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const admin = createAdminClient();
    const { data, error, count } = await admin
      .from("courses")
      .select("id, title, slug, status", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("title", { ascending: true })
      .range(from, to);
    if (error) {
      return NextResponse.json({ error: "Kurse konnten nicht geladen werden." }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [], page, pageSize, total: count ?? (data ?? []).length });
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[api/v1/courses GET]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
