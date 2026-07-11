import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiAuthError, resolveApiKeyTenant } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { csvRowSchema } from "@/lib/users/csv";
import { importOneUser } from "@/lib/users/import";

/**
 * Phase 3, Block 7 — REST-API v1 (SPEC.md §7): `GET/POST /api/v1/users`.
 * Auth über API-Key (`resolveApiKeyTenant`), KEINE Nutzer-Session/RLS —
 * `tenantId` kommt ausschließlich aus dem geprüften Key-Kontext.
 *
 * Paginierung: SPEC nennt keine genaue Seitengröße — Default 100/Seite,
 * maximal 200 (Entscheidung builder, siehe PHASENSTATUS.md Block 7).
 */
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
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
      !(await checkRateLimit("api-v1-users-read", { maxRequests: 60, windowSeconds: 60, extraKey: apiKeyId }))
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
      .from("memberships")
      .select("user_id, role, status, created_at, profiles(email, full_name)", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) {
      return NextResponse.json({ error: "Nutzer konnten nicht geladen werden." }, { status: 500 });
    }

    type Row = {
      user_id: string;
      role: string;
      status: string;
      created_at: string;
      profiles: { email: string; full_name: string | null } | { email: string; full_name: string | null }[] | null;
    };
    const users = ((data ?? []) as Row[]).map((m) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return {
        id: m.user_id,
        email: profile?.email ?? null,
        fullName: profile?.full_name ?? null,
        role: m.role,
        status: m.status,
        createdAt: m.created_at,
      };
    });

    return NextResponse.json({ data: users, page, pageSize, total: count ?? users.length });
  } catch (e) {
    return errorResponse(e, "api/v1/users GET");
  }
}

/**
 * POST /api/v1/users — legt einen Nutzer an (oder verknüpft einen
 * bestehenden per E-Mail) und schreibt ihn optional in einen Kurs ein.
 * Nutzt `importOneUser()` (bisher privat in `src/lib/users/import.ts`,
 * jetzt exportiert — kleine, dokumentierte Abweichung vom Plan-Wortlaut
 * "keine bestehende Logik ändern", technisch zwingend und risikoarm: nur
 * `export` ergänzt, kein Verhalten geändert, siehe PHASENSTATUS.md Block 7).
 * `tenantId` kommt ausschließlich aus dem geprüften API-Key-Kontext, NIE
 * aus dem Request-Body.
 */
export async function POST(request: Request) {
  try {
    const { tenantId, apiKeyId } = await resolveApiKeyTenant(request);

    if (
      !(await checkRateLimit("api-v1-users-write", { maxRequests: 30, windowSeconds: 60, extraKey: apiKeyId }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const json = await request.json().catch(() => null);
    const parsed = csvRowSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const result = await importOneUser(admin, tenantId, parsed.data);
    if (result.status === "error") {
      return NextResponse.json({ error: result.message ?? "Anlegen fehlgeschlagen." }, { status: 500 });
    }

    // Bugfix (Cowork-Verifikation, 11.07.2026): `userId` fehlte hier bisher
    // komplett — ohne sie konnte ein API-Konsument nach dem Anlegen nicht
    // sinnvoll POST /api/v1/enrollments aufrufen (Josips Testfund). Siehe
    // Kommentar an `ImportRowResult.userId` in src/lib/users/import.ts.
    return NextResponse.json(
      { email: result.email, status: result.status, userId: result.userId },
      { status: result.status === "created" ? 201 : 200 },
    );
  } catch (e) {
    return errorResponse(e, "api/v1/users POST");
  }
}
