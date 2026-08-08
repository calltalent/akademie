import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminTenant } from "@/lib/auth/staff";
import { parseCsv } from "@/lib/users/csv";
import { importUsers } from "@/lib/users/import";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { verifySameOrigin, CSRF_REJECT_MESSAGE } from "@/lib/security/origin";
import { genericErrorMessage } from "@/lib/errors/generic";

const bodySchema = z.object({
  csv: z.string().min(1).max(2_000_000), // ~2 MB Textlimit, reicht weit über 100 Zeilen hinaus
});

/**
 * POST /api/admin/users/import
 * Admin-only (owner/admin — requireAdminTenant, siehe memberships_admin_write-RLS).
 * DoD: 100 Nutzer < 30 s (siehe import.ts, Batch-Parallelisierung).
 */
export async function POST(request: Request) {
  // CSRF-Fix (08.08.2026): reine Cookie-Session-Autorisierung ohne
  // Signatur-/Secret-Header, siehe src/lib/security/origin.ts-Dateikopf.
  if (!verifySameOrigin(request)) {
    return NextResponse.json({ error: CSRF_REJECT_MESSAGE }, { status: 403 });
  }

  try {
    const { tenant } = await requireAdminTenant();

    // Pro Mandant statt pro IP — Admin könnte hinter wechselnder IP sitzen,
    // aber ein Mandant soll auch nicht beliebig viele Bulk-Importe stoßen
    // können (jede Zeile erzeugt einen Auth-Nutzer bei Supabase).
    if (
      !(await checkRateLimit("csv-import", {
        maxRequests: 5,
        windowSeconds: 300,
        extraKey: tenant.id,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const json = await request.json().catch(() => null);
    const parsedBody = bodySchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: parsedBody.error.issues[0]?.message ?? "Ungültige Anfrage." },
        { status: 400 },
      );
    }

    const { rows, errors: parseErrors } = parseCsv(parsedBody.data.csv);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Keine gültigen Zeilen gefunden.", parseErrors },
        { status: 400 },
      );
    }
    if (rows.length > 500) {
      return NextResponse.json(
        { error: "Maximal 500 Zeilen pro Import (Phase 1)." },
        { status: 400 },
      );
    }

    const summary = await importUsers(tenant, rows);

    return NextResponse.json({ ...summary, parseErrors });
  } catch (e) {
    const rawMessage = e instanceof Error ? e.message : "Unbekannter Fehler.";
    const status = rawMessage.includes("Nicht angemeldet") || rawMessage.includes("Inhaber")
      ? 403
      : 500;
    return NextResponse.json({ error: genericErrorMessage(e) }, { status });
  }
}
