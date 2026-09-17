import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiAuthError, resolveApiKeyTenant } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Affiliate-System, Block B9 — REST-API v1:
 * `GET /api/v1/affiliate-commissions?from=…&to=…&partnerId=…`.
 *
 * LIEFERT SUMMEN, KEINE EINZELBUCHUNGEN — und das ist eine bewusste
 * Auslegung von 10/B9 („Die v1-API liefert ausschließlich AGGREGIERTE
 * Daten"), keine Bequemlichkeit. Eine einzelne Provisionszeile trägt
 * `order_id`, `stripe_invoice_id`, `stripe_charge_id`, `referral_id` und
 * `dedup_key`. Jede dieser Kennungen ist ein Schlüssel auf einen KÄUFER.
 * Weil `public.api_keys` (`0001_init.sql:349-358`) kein Scope-Feld hat, kann
 * jeder gültige Schlüssel des Mandanten jeden v1-Endpunkt aufrufen — auch
 * einer, der in einem fremden Automatisierungsdienst liegt. Eine Liste
 * einzelner Buchungen wäre damit eine Liste von Zeigern auf Käufe
 * identifizierbarer Menschen, ausgeliefert über eine Schnittstelle, die
 * zwischen „Buchhaltung" und „Marketingszenario" nicht unterscheiden kann.
 *
 * Gruppiert wird nach Partner, Abrechnungsmonat, Status und Währung — genau
 * die vier Achsen, nach denen eine Buchhaltung eine Provision verbucht. Wer
 * eine einzelne Buchung braucht (Streitfall, Prüfung), findet sie in
 * `/admin/affiliate/provisionen`, hinter einer angemeldeten Sitzung mit
 * Rolle.
 *
 * Gruppiert wird IN TypeScript und nicht in SQL: der Supabase-Query-Builder
 * kennt kein `group by`, und eine dafür gebaute RPC wäre eine neue Migration
 * — in einem Block, der laut Auftrag keine Datenbankänderung enthält. Der
 * Deckel `MAX_ROWS` hält den Speicher beschränkt und meldet sich im
 * Antwortfeld `complete`, statt eine zu kleine Summe als vollständig
 * auszugeben.
 *
 * WÄHRUNG: nie über Währungen hinweg addiert (5.11) — sie ist Teil des
 * Gruppenschlüssels, nicht eine Anmerkung an der Summe.
 *
 * TESTBUCHUNGEN: `is_test = true` bleibt draußen (4.5). Sie würden jede
 * Zahl verfälschen, die ein Integrationsszenario weiterverarbeitet.
 */

const DEFAULT_RANGE_DAYS = 90;
const MAX_RANGE_DAYS = 400;
const PAGE_SIZE = 1000;
/** Deckel für EINE Anfrage. Darüber meldet die Antwort `complete: false`. */
const MAX_ROWS = 20000;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const querySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  partnerId: z.string().uuid().optional(),
  status: z.enum(["pending", "on_hold", "approved", "paid", "cancelled"]).optional(),
});

const COMMISSION_COLUMNS = "partner_id, kind, status, amount_cents, currency, booked_at";

type CommissionRow = {
  partner_id: string;
  kind: string;
  status: string;
  amount_cents: number;
  currency: string;
  booked_at: string;
};

type Bucket = {
  partner_id: string;
  /** `JJJJ-MM` aus `booked_at` — der Abrechnungsperiode (G14). */
  month: string;
  status: string;
  currency: string;
  /** Summe der positiven Zeilen, in Cent. */
  credited_cents: number;
  /** Summe der negativen Zeilen (Storno, Rückbuchung), in Cent, also <= 0. */
  reversed_cents: number;
  /** `credited_cents + reversed_cents`. */
  net_cents: number;
  lines: number;
};

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dayDifference(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

export async function GET(request: Request) {
  try {
    const { tenantId, apiKeyId } = await resolveApiKeyTenant(request);

    if (
      !(await checkRateLimit("api-v1-affiliate-commissions", {
        maxRequests: 30,
        windowSeconds: 60,
        extraKey: apiKeyId,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      partnerId: url.searchParams.get("partnerId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Ungültige Query-Parameter." }, { status: 400 });
    }

    const today = new Date();
    const to = parsedQuery.data.to ?? isoDate(today);
    const from =
      parsedQuery.data.from ?? isoDate(new Date(today.getTime() - DEFAULT_RANGE_DAYS * 86_400_000));
    const span = dayDifference(from, to);
    if (span < 0 || span > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Zeitraum muss aufsteigend und höchstens ${MAX_RANGE_DAYS} Tage lang sein.` },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    // Eine client-gelieferte Partner-ID wird ZUERST an den Mandanten
    // gebunden (§2.15). Ohne diese Prüfung wäre `partnerId` eines fremden
    // Mandanten zwar durch den `tenant_id`-Filter unten ergebnislos, aber
    // die leere Antwort ließe sich von „keine Buchungen" nicht
    // unterscheiden — und eine 404 mit demselben Text wie für eine
    // erfundene UUID ist die ehrlichere und zugleich dichtere Auskunft.
    if (parsedQuery.data.partnerId) {
      const { data: partner, error: partnerError } = await admin
        .from("affiliate_partners")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", parsedQuery.data.partnerId)
        .maybeSingle();
      if (partnerError) {
        console.error("[api/v1/affiliate-commissions GET] Partner lesen", { code: partnerError.code });
        return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
      }
      if (!partner) {
        return NextResponse.json({ error: "Partner nicht gefunden." }, { status: 404 });
      }
    }

    const rows: CommissionRow[] = [];
    let complete = true;
    let offset = 0;
    for (;;) {
      let query = admin
        .from("affiliate_commissions")
        .select(COMMISSION_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("is_test", false)
        .gte("booked_at", from)
        .lte("booked_at", to)
        .order("booked_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (parsedQuery.data.partnerId) query = query.eq("partner_id", parsedQuery.data.partnerId);
      if (parsedQuery.data.status) query = query.eq("status", parsedQuery.data.status);

      const { data, error } = await query;
      if (error) {
        console.error("[api/v1/affiliate-commissions GET] Abfrage fehlgeschlagen", {
          code: error.code,
        });
        complete = false;
        break;
      }
      const batch = (data ?? []) as unknown as CommissionRow[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      if (rows.length >= MAX_ROWS) {
        complete = false;
        break;
      }
      offset += PAGE_SIZE;
    }

    const buckets = new Map<string, Bucket>();
    for (const row of rows) {
      const month = row.booked_at.slice(0, 7);
      const key = `${row.partner_id} ${month} ${row.status} ${row.currency}`;
      const bucket =
        buckets.get(key) ??
        {
          partner_id: row.partner_id,
          month,
          status: row.status,
          currency: row.currency,
          credited_cents: 0,
          reversed_cents: 0,
          net_cents: 0,
          lines: 0,
        };
      if (row.amount_cents >= 0) bucket.credited_cents += row.amount_cents;
      else bucket.reversed_cents += row.amount_cents;
      bucket.net_cents += row.amount_cents;
      bucket.lines += 1;
      buckets.set(key, bucket);
    }

    const data = [...buckets.values()].sort(
      (a, b) =>
        a.partner_id.localeCompare(b.partner_id) ||
        a.month.localeCompare(b.month) ||
        a.status.localeCompare(b.status) ||
        a.currency.localeCompare(b.currency),
    );

    return NextResponse.json({
      data,
      period: { from, to },
      groupedBy: ["partner_id", "month", "status", "currency"],
      // Siehe Kopf: `false` heißt „unvollständig", nicht „leer".
      complete,
    });
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[api/v1/affiliate-commissions GET]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
