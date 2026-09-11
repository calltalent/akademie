import { NextResponse } from "next/server";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { requireAffiliatePartner } from "@/lib/affiliate/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  AFFILIATE_STATEMENT_COLUMNS,
  buildStatement,
  collectPages,
  statementCurrencies,
  statementKindKey,
  type AffiliateStatementRow,
  type AffiliateStatsInput,
} from "@/lib/affiliate/statement";
import { toCsv } from "@/lib/reporting/csv";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { CSRF_REJECT_MESSAGE, verifySameOrigin } from "@/lib/security/origin";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Affiliate-System, Block B7-A — CSV-Export DES PARTNERS
 * (PLAN_Affiliate-System.md 8.2 Zeilen 3 und 4, 11.9, 11.12, 11.15;
 * CLAUDE.md §2.9/§2.15).
 *
 * ## Eigene Route, nicht der Admin-Export
 *
 * `/api/admin/affiliate/csv` liegt hinter `requireAffiliateManager()` und
 * exportiert Partnernamen, E-Mail-Adressen und interne Spalten. Diese Route
 * liegt hinter `requireAffiliatePartner()` und exportiert ausschließlich die
 * Zeilen des aufrufenden Partners — mit einer anderen, kürzeren Spaltenmenge.
 * Ein gemeinsamer Endpunkt mit einer Rollenweiche wäre genau die Bauart, bei
 * der ein späterer Parameter beide Mengen vermischt.
 *
 * ## Warum POST und nicht GET
 *
 * `verifySameOrigin()` ist fail-closed — ein fehlender `Origin`-Header gilt
 * als verdächtig (`src/lib/security/origin.ts`). Browser senden `Origin` bei
 * jedem POST, aber NICHT bei einer gewöhnlichen Navigation per Link. Ein
 * Download-Link wäre damit entweder ungeschützt oder kaputt. Ein Formular
 * mit `method="post"` löst beides: der Browser sendet `Origin`, die Antwort
 * mit `Content-Disposition: attachment` lädt herunter, und die Bedienung
 * bleibt ein nativer Knopf — ohne JavaScript.
 *
 * ## EIGENER Rate-Limit (Auftrag B7-A)
 *
 * Der Export lädt Buchungen unaggregiert und ist damit die teuerste Abfrage,
 * die ein Partner auslösen kann. Der Schlüssel ist die PARTNER-ID und nicht
 * die IP: eine IP-Grenze träfe ein ganzes Büro gemeinsam, und ein einzelner
 * Partner umginge sie mit jedem Mobilfunk-Reconnect. `checkRateLimit()` ist
 * fail-open (ein Ausfall des Limiters darf niemanden aussperren) — die
 * Grenze ist Lastschutz, keine Sicherheitszusage; die Sicherheitszusage ist
 * das Gate darüber.
 *
 * ## KEINE KÄUFERDATEN — auch nicht im Export
 *
 * Der Export benutzt dieselbe Spaltenliste wie die Oberfläche
 * (`AFFILIATE_STATEMENT_COLUMNS`) und denselben reinen Auszug
 * (`buildStatement()`). Es gibt hier keine zweite Abfrage, die „für den
 * Export noch eben" eine Bestellnummer mitnimmt: die Spalte ist dem Partner
 * schon im SELECT-Recht entzogen (Migration 20260911130000), eine solche
 * Abfrage bräche mit 42501 ab.
 *
 * ## Zahlen im Export
 *
 * Geldbeträge als `1234.56` mit Punkt, die Währung in einer eigenen Spalte —
 * bewusst KEINE lokalisierte Schreibweise: eine Tabelle, die in einer
 * Buchhaltung weiterverarbeitet wird, darf nicht davon abhängen, in welcher
 * Sprache der Partner angemeldet war. Der Formula-Injection-Schutz und das
 * UTF-8-BOM kommen aus `toCsv()`.
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const bodySchema = z.object({
  type: z.enum(["statement", "stats"]),
  from: z.string().optional(),
  to: z.string().optional(),
  group: z.string().optional(),
});

/** Cent -> `1234.56`. Kein `Intl`, siehe Kopfkommentar. */
function amount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Basispunkte -> `35.00` (Prozent). */
function percent(bp: number): string {
  return (bp / 100).toFixed(2);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type DailyRow = AffiliateStatsInput & { day: string; campaign: string };

export async function POST(request: Request) {
  try {
    // 1. CSRF: state-ändernde UND datenliefernde Route Handler tragen den
    //    Origin-Check selbst — Next.js' eingebauter Schutz gilt nur für
    //    Server Actions.
    if (!verifySameOrigin(request)) {
      return NextResponse.json({ error: CSRF_REJECT_MESSAGE }, { status: 403 });
    }

    // 2. Gate. Es liefert die Partner-ID; aus dem Formular kommt keine.
    const { tenant, partnerId } = await requireAffiliatePartner();

    // 3. Eigener Rate-Limit je Partner.
    if (
      !(await checkRateLimit("affiliate-partner-csv", {
        maxRequests: 10,
        windowSeconds: 3600,
        extraKey: partnerId,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const form = await request.formData();
    const parsed = bodySchema.safeParse({
      type: form.get("type") ?? undefined,
      from: form.get("from") ?? undefined,
      to: form.get("to") ?? undefined,
      group: form.get("group") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const t = await getTranslations("affiliate");

    let csv: string;
    let prefix: string;

    if (parsed.data.type === "statement") {
      const commissions = await collectPages<AffiliateStatementRow>((rangeFrom, rangeTo) =>
        supabase
          .from("affiliate_commissions")
          .select(AFFILIATE_STATEMENT_COLUMNS)
          .eq("tenant_id", tenant.id)
          .eq("partner_id", partnerId)
          .order("id", { ascending: true })
          .range(rangeFrom, rangeTo) as unknown as PromiseLike<{
          data: AffiliateStatementRow[] | null;
          error: unknown;
        }>,
      );

      // Eine unvollständige Zeilenmenge ergäbe einen zu kleinen Saldo, der
      // genauso plausibel aussieht wie ein richtiger — und in einer
      // heruntergeladenen Datei überlebt er jede spätere Korrektur.
      if (!commissions.ok) {
        return NextResponse.json({ error: genericErrorMessage(null) }, { status: 503 });
      }

      // Produkttitel NACH dem Gate über den Admin-Client mit ausdrücklicher
      // Spaltenliste (8.2, 11.10) — ein Partner liest `products` nicht per RLS.
      const productIds = [
        ...new Set(
          commissions.rows
            .map((row) => row.product_id)
            .filter((id): id is string => id !== null),
        ),
      ];
      const titles = new Map<string, string>();
      if (productIds.length > 0) {
        const admin = createAdminClient();
        const { data: products } = await admin
          .from("products")
          .select("id, title")
          .eq("tenant_id", tenant.id)
          .in("id", productIds);
        for (const product of products ?? []) titles.set(product.id, product.title);
      }

      const rows: (string | number)[][] = [];
      // Je Währung ein eigener Auszug mit eigenem laufenden Saldo (5.11).
      // Die Währung steht in einer eigenen Spalte; es gibt keine Summenzeile
      // über Währungen hinweg.
      for (const currency of statementCurrencies(commissions.rows)) {
        const statement = buildStatement(commissions.rows, { currency, order: "asc" });
        for (const entry of statement.entries) {
          const row = entry.row;
          rows.push([
            row.booked_at.slice(0, 10),
            t(`statement.${statementKindKey(row.kind)}`),
            row.product_id === null ? "" : (titles.get(row.product_id) ?? ""),
            row.campaign ?? "",
            amount(row.base_cents),
            row.rate_kind === "percent" ? percent(row.rate_bp) : amount(row.fixed_cents),
            amount(row.amount_cents),
            entry.counts ? amount(entry.balance_cents) : "",
            row.currency.toUpperCase(),
            t(`status.commission.${row.status}`),
            row.hold_until.slice(0, 10),
          ]);
        }
      }

      csv = toCsv(
        [
          t("statement.columnDate"),
          t("statement.columnKind"),
          t("statement.columnProduct"),
          t("statement.columnCampaign"),
          t("statement.baseLabel"),
          t("statement.rateLabel"),
          t("statement.columnAmount"),
          t("statement.columnBalance"),
          t("csv.currencyColumn"),
          t("statement.columnStatus"),
          t("csv.freeFromColumn"),
        ],
        rows,
      );
      prefix = "kontoauszug";
    } else {
      const from =
        typeof parsed.data.from === "string" && ISO_DATE_PATTERN.test(parsed.data.from)
          ? parsed.data.from
          : todayIso();
      const to =
        typeof parsed.data.to === "string" && ISO_DATE_PATTERN.test(parsed.data.to)
          ? parsed.data.to
          : todayIso();
      // Vertauschte Grenzen ergäben eine leere Datei statt einer Fehlermeldung.
      const range = from <= to ? { from, to } : { from: to, to: from };

      const daily = await collectPages<DailyRow>((rangeFrom, rangeTo) =>
        supabase
          .from("affiliate_daily_stats")
          .select("day, campaign, clicks, unique_clicks, leads, orders_count, revenue_cents, commission_cents, reversal_cents")
          .eq("tenant_id", tenant.id)
          .eq("partner_id", partnerId)
          .gte("day", range.from)
          .lte("day", range.to)
          .order("day", { ascending: true })
          .order("campaign", { ascending: true })
          .range(rangeFrom, rangeTo) as unknown as PromiseLike<{
          data: DailyRow[] | null;
          error: unknown;
        }>,
      );

      if (!daily.ok) {
        return NextResponse.json({ error: genericErrorMessage(null) }, { status: 503 });
      }

      csv = toCsv(
        [
          t("statistics.columnDay"),
          t("statistics.columnCampaign"),
          t("statistics.columnClicks"),
          t("statistics.columnUniqueClicks"),
          t("statistics.columnLeads"),
          t("statistics.columnSales"),
          t("statistics.columnCommission"),
          t("csv.reversalColumn"),
        ],
        daily.rows.map((row) => [
          row.day,
          row.campaign,
          row.clicks,
          row.unique_clicks,
          row.leads,
          row.orders_count,
          amount(row.commission_cents),
          amount(row.reversal_cents),
        ]),
      );
      prefix = "statistik";
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${prefix}-${todayIso()}.csv"`,
        // Der Export enthält die Verdienstdaten des Partners — er gehört in
        // keinen gemeinsamen Cache und in keine Zwischeninstanz.
        "Cache-Control": "no-store, private",
      },
    });
  } catch (e) {
    // Kein `error.message` in der Antwort (§2.11): die Meldung eines
    // Datenbankfehlers trägt bei einer Constraint-Verletzung Nutzdaten.
    return NextResponse.json({ error: genericErrorMessage(e) }, { status: 400 });
  }
}
