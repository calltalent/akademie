import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiAuthError, resolveApiKeyTenant } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Affiliate-System, Block B9 — REST-API v1: `GET /api/v1/affiliates`.
 * Die Partnerliste EINES Mandanten (der, dem der API-Schlüssel gehört).
 *
 * WAS DIESER ENDPUNKT NICHT HERAUSGIBT, und warum das keine Vorsicht,
 * sondern eine Notwendigkeit ist: `public.api_keys` (`0001_init.sql:349-358`)
 * hat KEIN Scope-Feld. Jeder gültige Schlüssel eines Mandanten kann jeden
 * v1-Endpunkt aufrufen — es gibt keinen Lese-nur-Schlüssel, keinen
 * Partner-Schlüssel, keine Rechtetrennung. Ein Schlüssel, der einem Zapier-
 * oder Make-Szenario übergeben wurde, liegt damit in einem fremden System.
 *
 * Deshalb liefert dieser Endpunkt nur, was ein Integrationsszenario
 * tatsächlich braucht, um einen Partner WIEDERZUERKENNEN (ID, Code, Name,
 * Firma, Status), und nichts, was ihn KONTAKTIEREN oder BEZAHLEN ließe:
 *
 *   NICHT dabei: `applicant_email` (Kontaktdatum), `application`
 *   (Freitextantworten der Bewerbung), `internal_note` und `status_reason`
 *   (Bewertungen ÜBER die Person), `terms_accepted_ip_hash`
 *   (Zustimmungsnachweis, 11.6), `user_id` (Brücke zum Nutzerkonto) und
 *   alles aus `affiliate_billing_profiles` (Anschrift, Steuernummer, IBAN).
 *
 * KEINE KLICKZEILEN, nirgends in v1 (10/B9): `affiliate_clicks` trägt
 * IP-Hash, Referrer-Host, User-Agent-Klasse und Land je einzelnem Besucher.
 * Das ist personenbezogen; es über eine API auszuliefern, die keine
 * Rechtetrennung kennt, wäre ein Datenleck mit Ansage. Wer Klickzahlen
 * braucht, bekommt sie AGGREGIERT über
 * `GET /api/v1/affiliates/:id/stats` — dieselbe Zahl, ohne die Person.
 *
 * Aufbau, Auth- und Fehlerformat wortgleich zu `api/v1/courses/route.ts`.
 * `tenantId` stammt ausschließlich aus dem aufgelösten Schlüssel, nie aus
 * Query oder Body, und steht auf JEDER Abfrage (CLAUDE.md §2.15).
 */

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

/**
 * Spalten namentlich, nicht `*`: `affiliate_partners` trägt Spalten-Grants
 * (3.3), und die Liste oben ist zugleich die Zusage, was dieser Endpunkt
 * herausgibt. Ein `*` machte jede künftig ergänzte Spalte stillschweigend
 * öffentlich.
 */
const PARTNER_API_COLUMNS =
  "id, program_id, code, display_name, company, status, group_id, referred_by, created_at";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(["pending", "active", "rejected", "suspended"]).optional(),
});

export async function GET(request: Request) {
  try {
    const { tenantId, apiKeyId } = await resolveApiKeyTenant(request);

    if (
      !(await checkRateLimit("api-v1-affiliates-read", {
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
      status: url.searchParams.get("status") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Ungültige Query-Parameter." }, { status: 400 });
    }
    const { page, pageSize, status } = parsedQuery.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const admin = createAdminClient();
    let query = admin
      .from("affiliate_partners")
      .select(PARTNER_API_COLUMNS, { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;
    if (error) {
      // Nur der SQLSTATE ins Log, nie die PostgREST-Meldung (§2.11), und
      // nach außen ein Satz ohne jeden Hinweis auf die Ursache (§2.15).
      console.error("[api/v1/affiliates GET] Abfrage fehlgeschlagen", { code: error.code });
      return NextResponse.json({ error: "Partner konnten nicht geladen werden." }, { status: 500 });
    }

    return NextResponse.json({
      data: data ?? [],
      page,
      pageSize,
      total: count ?? (data ?? []).length,
    });
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[api/v1/affiliates GET]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
