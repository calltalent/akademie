import { NextResponse } from "next/server";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { requireAffiliateManager } from "@/lib/affiliate/access";
import { writeAuditEntry } from "@/lib/affiliate/audit";
import { markAffiliatePayoutExported } from "@/lib/affiliate/payout";
import {
  buildSepaCreditTransfer,
  isValidIban,
  normalizeBic,
  normalizeIban,
  type SepaInstruction,
} from "@/lib/affiliate/sepa";
import { listAffiliatePartners } from "@/lib/affiliate/queries";
import type { AffiliatePayoutMethod, AffiliateTaxMode } from "@/lib/affiliate/types";
import { toCsv } from "@/lib/reporting/csv";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { CSRF_REJECT_MESSAGE, verifySameOrigin } from "@/lib/security/origin";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Affiliate-System, Block B8-C — Export der freigegebenen Auszahlungen
 * (PLAN_Affiliate-System.md 7.7, 8.1 Zeile 6, 11.12, 11.15; CLAUDE.md §2.9,
 * §2.11, §2.15).
 *
 * Drei Dateien aus einem Endpunkt, je nach `method`:
 *   `sepa`   — SEPA-Sammelüberweisung als `pain.001.001.09`-XML,
 *   `paypal` — CSV im Massenzahlungsformat,
 *   `manual` — CSV zum Abtippen.
 *
 * ## WARUM POST UND NICHT GET, obwohl nichts geändert würde
 *
 * Es WIRD etwas geändert: der Export setzt `approved → exported` (7.7), damit
 * sichtbar bleibt, welche Sätze bereits in einer Bankdatei stehen — ein
 * zweiter Export derselben Datei ist sonst nicht von einer vergessenen
 * Überweisung zu unterscheiden. Unabhängig davon wäre POST auch für einen
 * reinen Download die richtige Wahl: `verifySameOrigin()` ist fail-closed und
 * ein Browser sendet bei einer gewöhnlichen Navigation keinen `Origin`-Header
 * (gleiche Begründung wie bei `/api/admin/affiliate/csv`).
 *
 * ## DIE DREI GRENZEN, IN DIESER REIHENFOLGE
 *
 *   1. Origin — `route.ts`-Handler tragen den CSRF-Schutz selbst; Next.js'
 *      eingebauter Check gilt nur für Server Actions (CLAUDE.md §2.9).
 *   2. Rolle — `requireAffiliateManager()` (owner/admin, nicht `trainer`,
 *      G10), samt Feature-Schalter.
 *   3. Mandant — jede gelieferte Auszahlungs-ID wird mit `.eq("tenant_id", …)`
 *      gelesen. Nie `where id = :clientId` (§2.15). Sätze, die es nicht gibt,
 *      und Sätze eines fremden Mandanten ergeben dieselbe Antwort.
 *
 * Dazu ein Rate-Limit von 20 Anfragen je Stunde und Mandant (7.7): der Export
 * liest Zahlungsverbindungen und ist damit die sensibelste Abfrage des
 * Moduls.
 *
 * ## WAS NICHT PROTOKOLLIERT WIRD
 *
 * Die Datei enthält IBANs — das ist ihr Zweck. Das Protokoll und das Log
 * enthalten sie NICHT (§2.11): der Audit-Eintrag trägt Zahl, Zahlweg und
 * Summe, und im Fehlerfall wandert ausschließlich der SQLSTATE ins Log. Auch
 * die Bankverbindung des AUFTRAGGEBERS wird nirgends gespeichert; sie kommt
 * aus dem Formular, steht in der erzeugten Datei und sonst an keiner Stelle.
 *
 * ## DER AUFTRAGGEBER KOMMT AUS DEM FORMULAR
 *
 * ABWEICHUNG, bewusst und benannt: der Plan nennt für die SEPA-Datei einen
 * `<Dbtr>`-Block, legt aber kein Feld für das Konto des Mandanten fest — das
 * Datenmodell kennt in 3.13 ausschließlich die Zahlungsverbindung des
 * PARTNERS. Statt dafür eine neue Spalte zu erfinden (und damit eine zweite
 * Bankverbindung dauerhaft zu speichern), wird sie beim Export eingegeben:
 * die Datei wird ohnehin sofort in ein Bankportal geladen, in dem das Konto
 * bereits hinterlegt ist. Einfachste tragfähige Lösung nach CLAUDE.md §4.5;
 * wird sie je öfter gebraucht, gehört sie nach `tenants.legal`.
 */

const uuidSchema = z.string().uuid();

const bodySchema = z
  .object({
    method: z.enum(["sepa", "paypal", "manual"]),
    payoutIds: z.array(uuidSchema).min(1).max(200),
    debtorName: z.string().trim().max(70).optional(),
    debtorIban: z.string().trim().max(42).optional(),
    debtorBic: z.string().trim().max(11).optional(),
    executionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.method !== "sepa") return;
    if ((value.debtorName ?? "") === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["debtorName"],
        message: "Bitte den Namen des Auftraggebers eintragen.",
      });
    }
    if (!isValidIban(value.debtorIban)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["debtorIban"],
        message: "Die IBAN des Auftraggebers ist nicht gültig.",
      });
    }
  });

/** Genau die Spalten, die eine Zahlungsdatei braucht — `select('*')` bricht mit 42501 ab. */
const PAYOUT_EXPORT_COLUMNS =
  "id, partner_id, period_from, period_to, currency, subtotal_cents, tax_cents, " +
  "total_cents, tax_mode, status, method, document_no";

type PayoutExportRow = {
  id: string;
  partner_id: string;
  period_from: string;
  period_to: string;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  tax_mode: AffiliateTaxMode;
  status: string;
  method: AffiliatePayoutMethod | null;
  document_no: string | null;
};

const BILLING_EXPORT_COLUMNS =
  "partner_id, legal_name, account_holder, iban, bic, paypal_email";

type BillingExportRow = {
  partner_id: string;
  legal_name: string | null;
  account_holder: string | null;
  iban: string | null;
  bic: string | null;
  paypal_email: string | null;
};

/** Cent -> `1234.56`. Kein `Intl`: eine Buchhaltungsdatei darf nicht von der
 *  Anzeigesprache des Betreibers abhängen (gleiche Begründung wie im
 *  CSV-Export der Oberfläche). */
function amount(cents: number): string {
  return (cents / 100).toFixed(2);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  try {
    // 1. CSRF.
    if (!verifySameOrigin(request)) {
      return NextResponse.json({ error: CSRF_REJECT_MESSAGE }, { status: 403 });
    }

    // 2. Gate.
    const { tenant, user } = await requireAffiliateManager();

    // 3. Rate-Limit je Mandant (fail-open, siehe rate-limit.ts).
    if (
      !(await checkRateLimit("affiliate-payout-export", {
        maxRequests: 20,
        windowSeconds: 3600,
        extraKey: tenant.id,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const form = await request.formData();
    const parsed = bodySchema.safeParse({
      method: form.get("method") ?? undefined,
      payoutIds: form.getAll("payoutIds").map(String),
      debtorName: form.get("debtorName") ?? undefined,
      debtorIban: form.get("debtorIban") ?? undefined,
      debtorBic: form.get("debtorBic") ?? undefined,
      executionDate: form.get("executionDate") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const t = await getTranslations("admin.affiliate.payouts");
    const admin = createAdminClient();

    // 4. Sätze lesen — Mandant zuerst, Status und Zahlweg als Filter. Ein
    //    Entwurf hat keine Belegnummer und gehört in keine Zahlungsdatei.
    const { data: payoutData, error: payoutError } = await admin
      .from("affiliate_payouts")
      .select(PAYOUT_EXPORT_COLUMNS)
      .eq("tenant_id", tenant.id)
      .in("id", input.payoutIds)
      .in("status", ["approved", "exported"])
      .eq("method", input.method)
      .order("document_no", { ascending: true });

    if (payoutError) {
      console.error(
        `[api/admin/affiliate/payout-export] Lesen fehlgeschlagen (Code ${
          (payoutError as { code?: string }).code ?? "unbekannt"
        }).`,
      );
      return NextResponse.json({ error: genericErrorMessage(payoutError) }, { status: 500 });
    }

    const payouts = (payoutData ?? []) as unknown as PayoutExportRow[];
    if (payouts.length === 0) {
      // Derselbe Text für „gibt es nicht", „gehört jemand anderem" und „hat
      // einen anderen Zahlweg" (11.15).
      return NextResponse.json({ error: t("exportNothing") }, { status: 404 });
    }

    const partnerIds = [...new Set(payouts.map((row) => row.partner_id))];
    const [{ data: billingData, error: billingError }, partners] = await Promise.all([
      admin
        .from("affiliate_billing_profiles")
        .select(BILLING_EXPORT_COLUMNS)
        .eq("tenant_id", tenant.id)
        .in("partner_id", partnerIds),
      listAffiliatePartners(tenant.id),
    ]);

    if (billingError) {
      console.error(
        `[api/admin/affiliate/payout-export] Abrechnungsprofile nicht lesbar (Code ${
          (billingError as { code?: string }).code ?? "unbekannt"
        }).`,
      );
      return NextResponse.json({ error: genericErrorMessage(billingError) }, { status: 500 });
    }

    const billing = new Map(
      ((billingData ?? []) as unknown as BillingExportRow[]).map((row) => [row.partner_id, row]),
    );
    const partnerNameById = new Map(partners.rows.map((row) => [row.id, row.display_name]));

    /** Der Name, der auf die Überweisung gehört: die Firmierung aus dem
     *  Abrechnungsprofil, ersatzweise der Kontoinhaber, ersatzweise der
     *  Anzeigename. Ein leerer Name ließe die Bank den Auftrag ablehnen. */
    const creditorName = (row: PayoutExportRow): string => {
      const profile = billing.get(row.partner_id);
      return (
        profile?.legal_name?.trim() ||
        profile?.account_holder?.trim() ||
        partnerNameById.get(row.partner_id) ||
        ""
      );
    };

    let body: string;
    let contentType: string;
    let extension: string;

    if (input.method === "sepa") {
      const instructions: SepaInstruction[] = [];
      const unusable: string[] = [];

      for (const row of payouts) {
        const profile = billing.get(row.partner_id);
        const documentNo = row.document_no ?? "";
        if (documentNo === "" || !isValidIban(profile?.iban) || creditorName(row) === "") {
          // Die Belegnummer benennt den Fall eindeutig und trägt keinen
          // Kontobezug — anders als die IBAN, die hier nie auftauchen darf.
          unusable.push(documentNo === "" ? row.id : documentNo);
          continue;
        }
        instructions.push({
          documentNo,
          creditorName: creditorName(row),
          iban: normalizeIban(profile?.iban),
          bic: normalizeBic(profile?.bic),
          amountCents: row.total_cents,
          currency: row.currency,
          remittance: documentNo,
        });
      }

      if (unusable.length > 0) {
        return NextResponse.json(
          { error: t("exportUnusable", { documents: unusable.join(", ") }) },
          { status: 400 },
        );
      }

      const now = new Date();
      body = buildSepaCreditTransfer({
        // Eindeutig je Datei, höchstens 35 Zeichen (`sepaText()` kürzt sonst).
        messageId: `AFF-${todayIso().replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        createdAt: now,
        requestedExecutionDate:
          input.executionDate === undefined
            ? now
            : new Date(`${input.executionDate}T00:00:00Z`),
        debtor: {
          name: input.debtorName ?? "",
          iban: input.debtorIban ?? "",
          bic: input.debtorBic ?? null,
        },
        instructions,
      });
      contentType = "application/xml; charset=utf-8";
      extension = "xml";
    } else if (input.method === "paypal") {
      // PayPal-Massenzahlung: Empfängeradresse, Betrag, Währung, eigene
      // Kennung, Hinweistext. Der Formula-Injection-Schutz und das UTF-8-BOM
      // kommen aus `toCsv()` — bei frei eingegebenen Partnernamen
      // unverzichtbar (9.11).
      body = toCsv(
        [
          t("csv.paypalEmail"),
          t("csv.amount"),
          t("csv.currency"),
          t("csv.documentNo"),
          t("csv.partner"),
        ],
        payouts.map((row) => [
          billing.get(row.partner_id)?.paypal_email ?? "",
          amount(row.total_cents),
          row.currency.toUpperCase(),
          row.document_no ?? "",
          creditorName(row),
        ]),
      );
      contentType = "text/csv; charset=utf-8";
      extension = "csv";
    } else {
      // „Zum Abtippen": hier gehören Kontoinhaber und IBAN hinein, denn genau
      // dafür ist die Datei da. Sie geht als Download an den Menschen, der
      // die Überweisung ausführt — und in kein Protokoll.
      body = toCsv(
        [
          t("csv.partner"),
          t("csv.accountHolder"),
          t("csv.iban"),
          t("csv.bic"),
          t("csv.amount"),
          t("csv.currency"),
          t("csv.documentNo"),
          t("csv.period"),
          t("csv.taxMode"),
        ],
        payouts.map((row) => {
          const profile = billing.get(row.partner_id);
          return [
            creditorName(row),
            profile?.account_holder ?? "",
            normalizeIban(profile?.iban),
            normalizeBic(profile?.bic) ?? "",
            amount(row.total_cents),
            row.currency.toUpperCase(),
            row.document_no ?? "",
            `${row.period_from} – ${row.period_to}`,
            row.tax_mode,
          ];
        }),
      );
      contentType = "text/csv; charset=utf-8";
      extension = "csv";
    }

    // 5. `approved → exported` (7.7). Der Compare-and-Swap in
    //    `markAffiliatePayoutExported()` fasst nur `approved` an; ein erneuter
    //    Export bereits exportierter Sätze ist damit erlaubt und ändert
    //    nichts — er soll die Datei wiederherstellen können.
    const exported = await markAffiliatePayoutExported(admin, {
      tenantId: tenant.id,
      payoutIds: payouts.map((row) => row.id),
    });

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "payout",
      action: "payout.export",
      after: {
        method: input.method,
        payouts: payouts.length,
        newly_exported: exported.exported.length,
        // Summen je Währung, nie eine Gesamtzahl über Währungen hinweg (5.11).
        totals: payouts.reduce<Record<string, number>>((acc, row) => {
          acc[row.currency] = (acc[row.currency] ?? 0) + row.total_cents;
          return acc;
        }, {}),
      },
    });

    const filename = `affiliate-auszahlungen-${input.method}-${tenant.slug}-${todayIso()}.${extension}`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Zahlungsverbindungen gehören in keinen Zwischenspeicher.
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // §2.11: nie `e.message` in die Antwort. Die Gate-Meldungen aus
    // `access.ts` sind die einzigen, die hier auftreten dürfen — sie sind
    // Aussagen über den Anfragenden selbst (kein Enumeration-Leck, §2.15).
    const raw = e instanceof Error ? e.message : "";
    const status =
      raw.includes("Nicht angemeldet") ||
      raw.includes("Kein Zugriff") ||
      raw.includes("nicht aktiviert") ||
      raw.includes("Kein Mandant")
        ? 403
        : 500;
    if (status === 500) {
      console.error("[api/admin/affiliate/payout-export] Export fehlgeschlagen.");
    }
    return NextResponse.json(
      { error: status === 403 ? raw : genericErrorMessage(e) },
      { status },
    );
  }
}
