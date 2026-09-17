import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiAuthError, resolveApiKeyTenant } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Affiliate-System, Block B9 — REST-API v1:
 * `GET /api/v1/affiliates/:id/stats?from=JJJJ-MM-TT&to=JJJJ-MM-TT`.
 *
 * AUSSCHLIESSLICH AGGREGIERTE ZAHLEN (10/B9). Die Klickzahlen kommen aus
 * `affiliate_daily_stats` (3.14) — einer Tabelle, die je Partner, Tag und
 * Kampagne bereits nur Zähler führt und keine einzelne Zeile eines
 * Besuchers kennt. `affiliate_clicks` wird hier NICHT gelesen und darf es
 * nicht: dort stehen IP-Hash, Referrer-Host, Browserklasse und Land je
 * Besuch. Weil `public.api_keys` kein Scope-Feld hat, kann jeder gültige
 * Schlüssel jeden Endpunkt aufrufen; ein Endpunkt, der Klickzeilen
 * ausliefert, wäre damit ein Datenleck mit Ansage.
 *
 * Die Geldzahlen kommen dagegen aus `affiliate_commissions` und werden HIER
 * summiert, nicht aus `daily_stats` übernommen: `daily_stats` ist eine
 * abgeleitete Anzeigetabelle, die der Cron neu aufbaut (3.14), und
 * ausgerechnet ihre Abweichung vom Provisionsbuch ist eine der drei
 * Gleichungen des Kontrollabgleichs (7.6). Wer eine Provision abrechnen
 * will, muss das Buch fragen, nicht die Anzeige.
 *
 * ZEITBEZUG, ausdrücklich: `daily_stats.day` ist ein Kalendertag in
 * Europe/Berlin (3.14), `commissions.booked_at` die Abrechnungsperiode
 * (G14). Beide werden mit denselben Grenzen gefiltert; die Antwort nennt
 * den Zeitraum deshalb mit, damit ein Aufrufer nicht raten muss, worauf
 * sich die Zahlen beziehen.
 *
 * §2.15 — KEIN ENUMERATION-LECK: ein Partner eines FREMDEN Mandanten und
 * eine erfundene UUID bekommen wortgleich dieselbe Antwort („Partner nicht
 * gefunden.", 404). Eine Unterscheidung („gehört einem anderen Mandanten")
 * verriete, dass die ID existiert.
 */

const DEFAULT_RANGE_DAYS = 30;
/** Deckel für EINE Anfrage; darüber wäre die Antwort keine Kennzahl mehr. */
const MAX_RANGE_DAYS = 400;
const PAGE_SIZE = 1000;

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const querySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

const DAILY_STAT_COLUMNS =
  "day, campaign, clicks, unique_clicks, bot_clicks, leads, orders_count, " +
  "revenue_cents, commission_cents, reversal_cents";

const COMMISSION_COLUMNS = "kind, status, amount_cents, currency, booked_at";

type DailyStatRow = {
  clicks: number;
  unique_clicks: number;
  bot_clicks: number;
  leads: number;
  orders_count: number;
  revenue_cents: number;
  commission_cents: number;
  reversal_cents: number;
};

type CommissionRow = {
  kind: string;
  status: string;
  amount_cents: number;
  currency: string;
};

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dayDifference(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

/**
 * Blättert eine Abfrage durch; ein Fehler beendet die Schleife sichtbar.
 *
 * Die Rückgabe der Seitenfunktion ist bewusst `unknown`-Daten: der
 * Supabase-Typ einer Abfrage mit SPALTEN-ZEICHENKETTE lässt sich ohne
 * generierte Datenbanktypen nicht auflösen und kommt als Union mit
 * `GenericStringError` heraus. Die enge Zusicherung auf die tatsächliche
 * Zeilenform passiert deshalb einmal hier statt an jeder Aufrufstelle.
 */
async function fetchPaged<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ rows: T[]; ok: boolean }> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1);
    if (error) return { rows, ok: false };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, ok: true };
    offset += PAGE_SIZE;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId, apiKeyId } = await resolveApiKeyTenant(request);

    if (
      !(await checkRateLimit("api-v1-affiliate-stats", {
        maxRequests: 60,
        windowSeconds: 60,
        extraKey: apiKeyId,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return NextResponse.json({ error: "Partner nicht gefunden." }, { status: 404 });
    }

    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
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

    // Mandantenbindung der client-gelieferten ID VOR jeder weiteren Abfrage.
    const { data: partner, error: partnerError } = await admin
      .from("affiliate_partners")
      .select("id, code, status")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (partnerError) {
      console.error("[api/v1/affiliates/[id]/stats GET] Partner lesen", { code: partnerError.code });
      return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
    }
    if (!partner) {
      return NextResponse.json({ error: "Partner nicht gefunden." }, { status: 404 });
    }
    const partnerRow = partner as unknown as { id: string; code: string; status: string };

    const [stats, commissions] = await Promise.all([
      fetchPaged<DailyStatRow>((rangeFrom, rangeTo) =>
        admin
          .from("affiliate_daily_stats")
          .select(DAILY_STAT_COLUMNS)
          .eq("tenant_id", tenantId)
          .eq("partner_id", partnerRow.id)
          .gte("day", from)
          .lte("day", to)
          .order("day", { ascending: true })
          .range(rangeFrom, rangeTo),
      ),
      fetchPaged<CommissionRow>((rangeFrom, rangeTo) =>
        admin
          .from("affiliate_commissions")
          .select(COMMISSION_COLUMNS)
          .eq("tenant_id", tenantId)
          .eq("partner_id", partnerRow.id)
          // Testbuchungen bleiben draußen (4.5) — sie verfälschten jede
          // Kennzahl, die ein Integrationsszenario weiterverarbeitet.
          .eq("is_test", false)
          .gte("booked_at", from)
          .lte("booked_at", to)
          .order("booked_at", { ascending: true })
          .range(rangeFrom, rangeTo),
      ),
    ]);

    const traffic = stats.rows.reduce(
      (acc, row) => ({
        clicks: acc.clicks + row.clicks,
        unique_clicks: acc.unique_clicks + row.unique_clicks,
        bot_clicks: acc.bot_clicks + row.bot_clicks,
        leads: acc.leads + row.leads,
        orders: acc.orders + row.orders_count,
        revenue_cents: acc.revenue_cents + row.revenue_cents,
      }),
      { clicks: 0, unique_clicks: 0, bot_clicks: 0, leads: 0, orders: 0, revenue_cents: 0 },
    );

    // Je Währung ein Eimersatz. NIE über Währungen hinweg addieren (5.11).
    const byCurrency = new Map<
      string,
      { currency: string; booked_cents: number; reversed_cents: number; by_status: Record<string, number> }
    >();
    for (const row of commissions.rows) {
      const bucket =
        byCurrency.get(row.currency) ??
        { currency: row.currency, booked_cents: 0, reversed_cents: 0, by_status: {} };
      if (row.status !== "cancelled") {
        if (row.amount_cents >= 0) bucket.booked_cents += row.amount_cents;
        else bucket.reversed_cents += row.amount_cents;
      }
      bucket.by_status[row.status] = (bucket.by_status[row.status] ?? 0) + row.amount_cents;
      byCurrency.set(row.currency, bucket);
    }

    return NextResponse.json({
      data: {
        partner: { id: partnerRow.id, code: partnerRow.code, status: partnerRow.status },
        period: { from, to },
        traffic,
        commissions: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      },
      // `complete: false` heißt „unvollständig geladen", NICHT „null". Ein
      // Aufrufer, der daraus eine Abrechnung baut, muss das unterscheiden
      // können — dieselbe Ehrlichkeitsregel wie bei `AffiliateMetric`
      // (queries.ts) und `AffiliateIntegrityReport.ok` (integrity.ts).
      complete: stats.ok && commissions.ok,
    });
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[api/v1/affiliates/[id]/stats GET]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
