import { NextResponse } from "next/server";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { requireAffiliateManager } from "@/lib/affiliate/access";
import {
  defaultAffiliateRange,
  getAffiliatePartnerListData,
  getAffiliateProgram,
  listAffiliateCommissions,
  listAffiliatePartners,
  listAffiliateProducts,
} from "@/lib/affiliate/queries";
import { AFFILIATE_COMMISSION_STATUSES } from "@/lib/affiliate/types";
import { toCsv } from "@/lib/reporting/csv";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { CSRF_REJECT_MESSAGE, verifySameOrigin } from "@/lib/security/origin";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Affiliate-System, Block B6-B — CSV-Export der Mandanten-Oberfläche
 * (PLAN_Affiliate-System.md 8.1 Zeilen 1 und 5, 9.11, 11.12, 11.15;
 * CLAUDE.md §2.9/§2.15).
 *
 * WARUM POST UND NICHT GET, obwohl nichts geändert wird:
 * `verifySameOrigin()` ist fail-closed — ein fehlender `Origin`-Header gilt
 * als verdächtig (`src/lib/security/origin.ts`). Browser senden `Origin` bei
 * jedem POST, aber NICHT bei einer gewöhnlichen Navigation per Link. Ein
 * Download-Link wäre damit entweder ungeschützt (Prüfung weggelassen) oder
 * kaputt (Prüfung aktiv, Header fehlt). Ein Formular mit `method="post"`
 * löst beides: der Browser sendet `Origin`, die Antwort mit
 * `Content-Disposition: attachment` lädt herunter, ohne die Seite zu
 * verlassen, und die Bedienung bleibt ein nativer Knopf — ohne JavaScript,
 * ohne Blob-Umweg.
 *
 * Der Export ist teuer (er lädt Buchungen und Salden unaggregiert) und
 * enthält personenbezogene Daten; deshalb zusätzlich ein Rate-Limit je
 * Mandant.
 *
 * GATE: `requireAffiliateManager()` als ERSTE Zeile — owner/admin, nicht
 * `trainer` (G10), und darin der Feature-Schalter (9.8). Erst danach wird
 * irgendetwas gelesen; `queries.ts` arbeitet mit `createAdminClient()` und
 * hat ohne dieses Gate nichts zu tun.
 *
 * FILTER: dieselben Werte wie die Liste, dieselbe Weißung — sie passiert in
 * `listAffiliateCommissions()` (Status gegen `as const`-Liste, IDs gegen das
 * UUID-Muster, Daten gegen `JJJJ-MM-TT`). Diese Route baut keinen
 * Filterausdruck (CLAUDE.md §2.12).
 *
 * ZAHLEN IM EXPORT: Geldbeträge stehen als `1234.56` mit Punkt und die
 * Währung in einer eigenen Spalte. Das ist bewusst KEINE lokalisierte
 * Schreibweise: eine Tabelle, die in einer Buchhaltung weiterverarbeitet
 * wird, darf nicht davon abhängen, in welcher Sprache der Betreiber
 * angemeldet war, als er sie erzeugt hat. Der Formula-Injection-Schutz und
 * das UTF-8-BOM kommen aus `toCsv()` (9.11).
 */

const bodySchema = z.object({
  type: z.enum(["commissions", "partners"]),
  status: z.string().optional(),
  partnerId: z.string().optional(),
  productId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  flagged: z.string().optional(),
  test: z.string().optional(),
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

/** Leerer Formularwert -> `null`, damit die Abfrage den Filter weglässt. */
function orNull(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export async function POST(request: Request) {
  try {
    // 1. CSRF: state-ändernde UND datenliefernde Route Handler tragen den
    //    Origin-Check selbst — Next.js' eingebauter Schutz gilt nur für
    //    Server Actions (origin.ts).
    if (!verifySameOrigin(request)) {
      return NextResponse.json({ error: CSRF_REJECT_MESSAGE }, { status: 403 });
    }

    // 2. Gate.
    const { tenant } = await requireAffiliateManager();

    // 3. Rate-Limit je Mandant (fail-open, siehe rate-limit.ts).
    if (
      !(await checkRateLimit("affiliate-csv", {
        maxRequests: 20,
        windowSeconds: 3600,
        extraKey: tenant.id,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const form = await request.formData();
    const parsed = bodySchema.safeParse({
      type: form.get("type") ?? undefined,
      status: form.get("status") ?? undefined,
      partnerId: form.get("partnerId") ?? undefined,
      productId: form.get("productId") ?? undefined,
      from: form.get("from") ?? undefined,
      to: form.get("to") ?? undefined,
      flagged: form.get("flagged") ?? undefined,
      test: form.get("test") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const t = await getTranslations("admin.affiliate");

    let csv: string;
    let prefix: string;

    if (input.type === "commissions") {
      const statusValue =
        AFFILIATE_COMMISSION_STATUSES.find((value) => value === input.status) ??
        null;

      const [rows, partners, products] = await Promise.all([
        listAffiliateCommissions(tenant.id, {
          status: statusValue,
          partnerId: orNull(input.partnerId),
          productId: orNull(input.productId),
          from: orNull(input.from),
          to: orNull(input.to),
          flagged: input.flagged === "1" ? true : null,
          includeTest: input.test === "1",
          limit: 500,
        }),
        listAffiliatePartners(tenant.id),
        listAffiliateProducts(tenant.id),
      ]);

      const partnerNameById = new Map(
        partners.rows.map((row) => [row.id, row.display_name]),
      );
      const productTitleById = new Map(
        products.map((product) => [product.id, product.title]),
      );

      csv = toCsv(
        [
          t("commissions.columnDate"),
          t("commissions.columnPartner"),
          t("partners.columnCode"),
          t("commissions.columnProduct"),
          t("commissions.columnCampaign"),
          t("commissions.kindLabel"),
          t("commissions.columnBase"),
          t("commissions.columnRate"),
          t("commissions.columnAmount"),
          t("csv.currency"),
          t("commissions.columnStatus"),
          t("commissions.flaggedChip"),
          t("commissions.testChip"),
          t("commissions.orderLabel"),
          t("commissions.dedupLabel"),
        ],
        rows.map((row) => [
          row.booked_at.slice(0, 10),
          partnerNameById.get(row.partner_id) ?? "",
          partners.rows.find((partner) => partner.id === row.partner_id)
            ?.code ?? "",
          row.product_id === null
            ? ""
            : (productTitleById.get(row.product_id) ?? ""),
          row.campaign ?? "",
          row.kind,
          amount(row.base_cents),
          row.rate_kind === "percent"
            ? percent(row.rate_bp)
            : amount(row.fixed_cents),
          amount(row.amount_cents),
          row.currency.toUpperCase(),
          row.status,
          row.flagged ? "1" : "0",
          row.is_test ? "1" : "0",
          row.order_id ?? "",
          row.dedup_key,
        ]),
      );
      prefix = "provisionen";
    } else {
      const program = await getAffiliateProgram(tenant.id);
      const range = {
        from: orNull(input.from) ?? defaultAffiliateRange().from,
        to: orNull(input.to) ?? defaultAffiliateRange().to,
      };
      const data = await getAffiliatePartnerListData(tenant.id, { range });

      // Eine Zeile je Partner UND Währung: Salden werden nie über Währungen
      // hinweg summiert (5.11), und eine Spalte „Verfügbar" ohne Währung wäre
      // genau diese Summe in Tarnung.
      const rows: (string | number)[][] = [];
      for (const row of data.rows) {
        const balances =
          row.balances.length > 0
            ? row.balances
            : [
                {
                  currency: program?.currency ?? "eur",
                  open_cents: 0,
                  reserved_cents: 0,
                  in_review_cents: 0,
                  available_cents: 0,
                  paid_cents: 0,
                  partner_id: row.partner.id,
                },
              ];
        for (const balance of balances) {
          rows.push([
            row.partner.display_name,
            row.partner.applicant_email,
            row.partner.code,
            row.groupName ?? "",
            row.partner.status,
            row.clicks30d,
            row.uniqueClicks30d,
            row.orders30d,
            balance.currency.toUpperCase(),
            amount(balance.open_cents),
            amount(balance.reserved_cents),
            amount(balance.in_review_cents),
            amount(balance.available_cents),
            amount(balance.paid_cents),
          ]);
        }
      }

      csv = toCsv(
        [
          t("partners.columnName"),
          t("partner.master.emailLabel"),
          t("partners.columnCode"),
          t("partners.columnGroup"),
          t("partners.columnStatus"),
          t("partners.columnClicks"),
          t("csv.uniqueClicks"),
          t("partners.columnSales"),
          t("csv.currency"),
          t("partner.balances.open"),
          t("partner.balances.reserved"),
          t("partner.balances.inReview"),
          t("partner.balances.available"),
          t("partner.balances.paid"),
        ],
        rows,
      );
      prefix = "partner";
    }

    const filename = `affiliate-${prefix}-${tenant.slug}-${todayIso()}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Der Export enthält personenbezogene Daten und Geldbeträge — er
        // gehört in keinen Zwischenspeicher.
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // CLAUDE.md §2.11: nie `e.message` in die Antwort. Die Gate-Meldungen aus
    // `access.ts` sind die einzigen, die hier überhaupt auftreten dürfen —
    // sie unterscheiden „nicht angemeldet" von „keine Rolle", und beides weiß
    // der Anfragende ohnehin über sich selbst (kein Enumeration-Leck, §2.15).
    const raw = e instanceof Error ? e.message : "";
    const status =
      raw.includes("Nicht angemeldet") ||
      raw.includes("Kein Zugriff") ||
      raw.includes("nicht aktiviert") ||
      raw.includes("Kein Mandant")
        ? 403
        : 500;
    if (status === 500) {
      console.error("[api/admin/affiliate/csv] Export fehlgeschlagen.");
    }
    return NextResponse.json(
      { error: status === 403 ? raw : genericErrorMessage(e) },
      { status },
    );
  }
}
