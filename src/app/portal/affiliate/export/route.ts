import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { toCsv } from "@/lib/reporting/csv";
import { genericErrorMessage } from "@/lib/errors/generic";
import { getOperatorAffiliateReport, operatorAffiliateFilterSchema } from "../queries";

/**
 * `GET /portal/affiliate/export?tenantId=…&from=…&to=…` — die CSV für die
 * Betreiber-Buchhaltung (PLAN_Affiliate-System.md 7.7, letzter Absatz;
 * Block B9).
 *
 * ABWEICHUNG VOM DATEIPLAN, begründet: die Blockliste in 10/B9 nennt für die
 * Aufsicht nur `src/app/portal/affiliate/page.tsx`, 7.7 und 8.4 verlangen
 * aber ausdrücklich eine CSV. Eine `page.tsx` kann keine Datei mit
 * `Content-Disposition: attachment` ausliefern — sie rendert HTML. Deshalb
 * dieser zusätzliche Route Handler, exakt nach dem Vorbild von
 * `portal/marketplace/auszahlungen/export/route.ts`.
 *
 * Reihenfolge wie dort: `requirePlatformAdmin()` zuerst (liefert zugleich
 * `user.id` fürs Rate-Limit), dann das Rate-Limit, dann zod auf die
 * Query-Parameter, dann die Daten. `getOperatorAffiliateReport()` prüft die
 * Berechtigung intern ein zweites Mal — Defense in Depth, dasselbe Muster
 * wie bei `getPayoutRows()`.
 *
 * STRENGER ALS DIE SEITE: ein unbrauchbarer Filter liefert hier 400 und
 * nicht still den Vorgabezeitraum. Eine Seite ist eine Ansicht; eine
 * heruntergeladene Datei landet in einer Buchhaltung, und ein Zeitraum, der
 * anders ist als der angeforderte, wäre dort nicht mehr erkennbar.
 *
 * `toCsv()` wird wiederverwendet und nicht nachgebaut (9.11): UTF-8-BOM für
 * Excel, CRLF, und vor allem der Schutz gegen Formula-Injection — der
 * Mandantenname ist ein frei eingegebenes Feld, und ein Name, der mit `=`
 * beginnt, wäre in Excel sonst eine Formel.
 *
 * KEINE PERSONENDATEN IN DER DATEI: Mandant, Monat, Währung, Summen. Kein
 * Partnername, keine Bankverbindung, keine Bestellung — siehe 8.4.
 */

function formatAmount(cents: number): string {
  // Ohne Währungssymbol, mit deutschem Dezimalkomma: die Währung steht in
  // einer eigenen Spalte, damit die Buchhaltung den Betrag rechnen kann,
  // statt ihn aus einer Zeichenkette zu schneiden.
  const negative = cents < 0;
  const absolute = Math.abs(Math.trunc(cents));
  return `${negative ? "-" : ""}${Math.trunc(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    const { user } = await requirePlatformAdmin();

    if (
      !(await checkRateLimit("portal-affiliate-csv", {
        maxRequests: 20,
        windowSeconds: 3600,
        extraKey: user.id,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const url = new URL(request.url);
    const parsed = operatorAffiliateFilterSchema.safeParse({
      tenantId: url.searchParams.get("tenantId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }

    const report = await getOperatorAffiliateReport(parsed.data);

    const csv = toCsv(
      ["Mandant", "Monat", "Währung", "Ausgezahlt", "Storniert", "Netto", "Zeilen", "Zeitraum"],
      report.billing.map((row) => [
        row.tenantName,
        row.month,
        row.currency.toUpperCase(),
        formatAmount(row.paidCents),
        formatAmount(row.reversedCents),
        formatAmount(row.netCents),
        row.lines,
        // Der ausgewertete Zeitraum auf JEDER Zeile — wie im
        // Marketplace-Export: ein einzelner Ausdruck muss für sich
        // verständlich bleiben, ohne dass jemand den Filter-Link kennt.
        `${report.from}–${report.to}`,
      ]),
    );

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="partnerprogramm-weiterbelastung-${todayIso()}.csv"`,
      },
    });
  } catch (e) {
    // Status-Ermittlung braucht die ROHE Meldung von requirePlatformAdmin()
    // (feste Strings aus platform/auth.ts) — die zurückgegebene Meldung
    // bleibt trotzdem generisch, gleiches Muster wie in
    // `portal/mandanten/[id]/export/route.ts`.
    const rawMessage = e instanceof Error ? e.message : "";
    const status =
      rawMessage.includes("Nicht angemeldet") || rawMessage.includes("nur für") ? 403 : 500;
    return NextResponse.json({ error: genericErrorMessage(e) }, { status });
  }
}
