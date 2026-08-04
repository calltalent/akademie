import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { payoutFilterQuerySchema } from "@/lib/platform/schema";
import { getPayoutRows } from "@/lib/platform/marketplace";
import { toCsv } from "@/lib/reporting/csv";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * GET /portal/marketplace/auszahlungen/export?tenantId=…&from=…&to=…
 * CSV-Export des Provisions-Ledgers für die Buchhaltung (Marketplace M6,
 * Plan Abschnitt 7). Vorbild `api/admin/reporting/csv/route.ts`:
 * `requirePlatformAdmin()`-Gate zuerst (liefert außerdem `user.id` fürs
 * Rate-Limiting, deshalb hier — zusätzlich zur internen Prüfung in
 * `getPayoutRows()` — nochmal aufgerufen, exakt dasselbe Muster wie
 * `portal/mandanten/[id]/export/route.ts`), dann Rate-Limit, dann
 * zod-Validierung der Query-Parameter, dann Datenladung + CSV-Formatierung
 * über `toCsv()` (wiederverwendet, nicht neu geschrieben).
 *
 * Spalten in GENAU dieser Reihenfolge (Auftrag/Plan Abschnitt 7): Mandant,
 * Zeitraum, Bestellung, Datum, Brutto, Provisionssatz, Provision, Netto,
 * Währung, Auszahlungsstatus, Referenz. "Zeitraum" ist bewusst KEIN
 * Datenbankfeld der einzelnen Ledger-Zeile, sondern der aus den
 * Filter-Parametern abgeleitete, für den gesamten Export gültige Zeitraum
 * (z. B. "01.08.2026–04.08.2026" oder "Gesamter Zeitraum" ohne Filter) —
 * auf jeder Zeile wiederholt, damit ein einzelner CSV-Ausdruck/eine
 * einzelne Excel-Tabelle für sich verständlich bleibt, ohne dass die
 * Buchhaltung den ursprünglichen Filter-Link kennen muss.
 */

const PAYOUT_STATUS_LABELS: Record<string, string> = {
  open: "Offen",
  paid: "Ausgezahlt",
  cancelled: "Storniert",
};

function formatDateDe(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** `from`/`to` sind reine JJJJ-MM-TT-Strings aus dem Query-Parameter (kein
 * ISO-Timestamp) — `new Date("2026-08-01")` parst das zuverlässig als UTC
 * Mitternacht, für eine reine Anzeige im Zeitraum-Feld ausreichend genau. */
function formatFilterDateDe(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00.000Z`).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function formatCommission(bp: number): string {
  return `${(bp / 100).toString().replace(".", ",")} %`;
}

function formatPeriod(from?: string, to?: string): string {
  if (from && to) return `${formatFilterDateDe(from)}–${formatFilterDateDe(to)}`;
  if (from) return `ab ${formatFilterDateDe(from)}`;
  if (to) return `bis ${formatFilterDateDe(to)}`;
  return "Gesamter Zeitraum";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    const { user } = await requirePlatformAdmin();

    if (
      !(await checkRateLimit("marketplace-payouts-csv", {
        maxRequests: 20,
        windowSeconds: 3600,
        extraKey: user.id,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const url = new URL(request.url);
    const parsed = payoutFilterQuerySchema.safeParse({
      tenantId: url.searchParams.get("tenantId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." },
        { status: 400 },
      );
    }
    const filter = parsed.data;

    const { rows } = await getPayoutRows(filter);
    const period = formatPeriod(filter.from, filter.to);

    const csv = toCsv(
      [
        "Mandant",
        "Zeitraum",
        "Bestellung",
        "Datum",
        "Brutto",
        "Provisionssatz",
        "Provision",
        "Netto",
        "Währung",
        "Auszahlungsstatus",
        "Referenz",
      ],
      rows.map((r) => [
        r.tenantName,
        period,
        r.orderId,
        formatDateDe(r.createdAt),
        formatAmount(r.grossCents),
        formatCommission(r.commissionRateBp),
        formatAmount(r.commissionCents),
        formatAmount(r.netCents),
        r.currency.toUpperCase(),
        PAYOUT_STATUS_LABELS[r.payoutStatus] ?? r.payoutStatus,
        r.payoutReference ?? "",
      ]),
    );

    const filename = `marketplace-auszahlungen-${todayIso()}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    // Status-Ermittlung braucht die ROHE Meldung von requirePlatformAdmin()
    // (feste Strings "Nicht angemeldet."/"...nur für..." aus platform/auth.ts)
    // — die an die UI zurückgegebene Meldung bleibt trotzdem generisch,
    // gleiches Muster wie `portal/mandanten/[id]/export/route.ts`.
    const rawMessage = e instanceof Error ? e.message : "";
    const status =
      rawMessage.includes("Nicht angemeldet") || rawMessage.includes("nur für") ? 403 : 500;
    return NextResponse.json({ error: genericErrorMessage(e) }, { status });
  }
}
