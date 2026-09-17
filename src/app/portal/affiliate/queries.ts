import "server-only";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAffiliateIntegrity } from "@/lib/affiliate/integrity";

/**
 * Datengrundlage der Betreiber-Aufsicht `/portal/affiliate`
 * (PLAN_Affiliate-System.md 7.7 und 8.4), Block B9.
 *
 * WARUM DIESE DATEI NEBEN `page.tsx` LIEGT und nicht darin: die Seite und der
 * CSV-Export (`export/route.ts`) müssen exakt dieselben Zahlen zeigen. Stünde
 * die Abfrage in der Seite, müsste der Export sie nachbauen — und zwei
 * Nachbauten derselben Summe laufen erfahrungsgemäß irgendwann auseinander,
 * ausgerechnet in einem Bericht, nach dem jemand eine Rechnung schreibt. Ein
 * `export`-Bezeichner aus `page.tsx` ist dafür kein Weg: Next.js prüft die
 * erlaubten Exporte einer Route-Datei und bricht bei fremden Namen ab.
 *
 * WAS DER BETREIBER SIEHT UND WAS NICHT (8.4, letzter Absatz): keine
 * Bankverbindung eines Partners, keine Käuferdaten, keine Klickzeilen. Der
 * Betreiber ist beim Partnerprogramm NICHT Vertragspartei — er zahlt die
 * Provision nur aus, weil er Merchant of Record ist (1.3), und muss sie dem
 * Mandanten belasten. Genau dafür, und für nichts weiter, reichen
 * Mandantenname, Monat, Währung und Summe.
 *
 * Deshalb wird `affiliate_partners` hier nur GEZÄHLT und nie gelesen: eine
 * Partnerliste im Betreiber-Portal wäre eine Personendatensammlung ohne
 * Zweck.
 *
 * ZUGRIFF: `requirePlatformAdmin()` läuft in JEDER exportierten Funktion
 * erneut, zusätzlich zum Gate in `portal/layout.tsx` — dasselbe Muster wie
 * `platform/marketplace.ts`. Danach ausschließlich `createAdminClient()`:
 * ein Platform-Admin ist in keinem Mandanten Mitglied, RLS sperrte ihn
 * überall aus.
 */

/** Seitengröße beim Durchblättern; Muster `fetchAllRows()` (reporting/queries.ts). */
const PAGE_SIZE = 1000;

/**
 * Obergrenze für EINEN Bericht. Eine Aufsichtsansicht, die bei genügend
 * Daten in einen Zeitüberschreitungsfehler läuft, ist schlechter als eine,
 * die sagt „hier fehlt etwas" — deshalb ein harter Deckel plus ein
 * sichtbares `truncated`-Feld, das die Seite als eigenen Zustand rendert.
 */
const MAX_COMMISSION_ROWS = 20000;

/** Ab hier gilt eine Stornoquote als auffällig (8.4). */
export const AFFILIATE_REVERSAL_RATE_THRESHOLD = 0.2;

/** Ab hier gilt ein Negativsaldo als alt (8.4). */
export const AFFILIATE_NEGATIVE_BALANCE_DAYS = 90;

/** Ab hier gilt ein unverarbeitetes Zahlungsereignis als liegengeblieben (8.4). */
export const AFFILIATE_EVENT_BACKLOG_HOURS = 24;

const COMMISSION_COLUMNS =
  "tenant_id, partner_id, kind, amount_cents, currency, status, is_test, booked_at, paid_at";

/**
 * Die Buchungsarten, auf die sich eine Stornoquote bezieht: nur was
 * überhaupt zurückgenommen werden kann, zählt in den Nenner (5.8).
 */
const REVERSIBLE_KINDS = new Set(["sale", "reserve", "recurring", "recurring_reserve", "tier2"]);

/** Zustände, in denen eine Provisionszeile noch zum Saldo des Partners zählt. */
const OPEN_COMMISSION_STATUSES = new Set(["pending", "on_hold", "approved"]);

export const operatorAffiliateFilterSchema = z.object({
  /** ISO-Datum `JJJJ-MM-TT`, inklusiv. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tenantId: z.string().uuid().optional(),
});

export type OperatorAffiliateFilter = z.infer<typeof operatorAffiliateFilterSchema>;

/** Eine Zeile der Abrechnung gegenüber dem Mandanten: Mandant × Monat × Währung. */
export type OperatorBillingRow = {
  tenantId: string;
  tenantName: string;
  /** `JJJJ-MM`, gebildet aus `paid_at` — dem Monat, in dem das Geld floss. */
  month: string;
  currency: string;
  /** Summe der positiven ausgezahlten Zeilen, in Cent. */
  paidCents: number;
  /** Summe der negativen (Gegenbuchungen), in Cent, also <= 0. */
  reversedCents: number;
  /** `paidCents + reversedCents` — was der Betreiber dem Mandanten belastet. */
  netCents: number;
  /** Anzahl der Provisionszeilen hinter dieser Summe. */
  lines: number;
};

export type OperatorAffiliateFinding = {
  kind: "reversal_rate" | "negative_balance" | "event_backlog" | "integrity";
  severity: "critical" | "warning";
  /** Fertig formulierter deutscher Satz — das Portal ist durchgehend deutsch. */
  text: string;
};

export type OperatorTenantRow = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  programStatus: string;
  programCurrency: string;
  activePartners: number;
  pendingApplications: number;
  /** Ausgezahlt im Zeitraum, je Währung. */
  paid: Array<{ currency: string; netCents: number }>;
  /** Anteil zurückgenommener an gebuchter Provision, `null` = keine Basis. */
  reversalRate: number | null;
  findings: OperatorAffiliateFinding[];
};

export type OperatorAffiliateReport = {
  from: string;
  to: string;
  tenants: OperatorTenantRow[];
  billing: OperatorBillingRow[];
  /** Ereignisse OHNE aufgelösten Mandanten (3.10) — sie gehören keinem Mandanten. */
  unassignedEvents: { pending: number; errored: number; oldestAt: string | null };
  /** `true` = der Deckel hat gegriffen, die Summen sind unvollständig. */
  truncated: boolean;
};

type CommissionRow = {
  tenant_id: string;
  partner_id: string;
  kind: string;
  amount_cents: number;
  currency: string;
  status: string;
  is_test: boolean;
  booked_at: string;
  paid_at: string | null;
};

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Vorgabezeitraum: der laufende Monat und die beiden davor (7.7 rechnet monatlich ab). */
export function defaultOperatorRange(now: Date = new Date()): { from: string; to: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return { from: isoDate(start), to: isoDate(now) };
}

/** Blättert eine Abfrage durch, bis sie leer ist oder der Deckel greift. */
async function fetchPaged<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  limit: number,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1);
    if (error) break;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, truncated: false };
    if (rows.length >= limit) return { rows, truncated: true };
    offset += PAGE_SIZE;
  }
  return { rows, truncated: false };
}

function formatCents(cents: number, currency: string): string {
  const negative = cents < 0;
  const absolute = Math.abs(Math.trunc(cents));
  const rest = String(absolute % 100).padStart(2, "0");
  const grouped = String(Math.trunc(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${rest} ${currency.toUpperCase()}`;
}

export async function getOperatorAffiliateReport(
  filter: OperatorAffiliateFilter = {},
  now: Date = new Date(),
): Promise<OperatorAffiliateReport> {
  await requirePlatformAdmin();
  const admin = createAdminClient();

  const fallback = defaultOperatorRange(now);
  const from = filter.from ?? fallback.from;
  const to = filter.to ?? fallback.to;

  // --- Programme und ihre Mandanten --------------------------------------
  let programQuery = admin
    .from("affiliate_programs")
    .select("id, tenant_id, status, currency")
    .order("tenant_id", { ascending: true });
  if (filter.tenantId) programQuery = programQuery.eq("tenant_id", filter.tenantId);
  const { data: programData } = await programQuery;
  const programs = (programData ?? []) as unknown as Array<{
    tenant_id: string;
    status: string;
    currency: string;
  }>;

  const tenantIds = [...new Set(programs.map((p) => p.tenant_id))];
  if (tenantIds.length === 0) {
    return {
      from,
      to,
      tenants: [],
      billing: [],
      unassignedEvents: { pending: 0, errored: 0, oldestAt: null },
      truncated: false,
    };
  }

  const { data: tenantData } = await admin
    .from("tenants")
    .select("id, name, slug")
    .in("id", tenantIds);
  const tenantsById = new Map(
    ((tenantData ?? []) as unknown as Array<{ id: string; name: string | null; slug: string }>).map(
      (t) => [t.id, { name: t.name ?? t.slug, slug: t.slug }],
    ),
  );

  // --- Partnerzahlen: gezählt, nicht gelesen (8.4) ------------------------
  const { data: partnerData } = await admin
    .from("affiliate_partners")
    .select("tenant_id, status")
    .in("tenant_id", tenantIds);
  const partnerRows = (partnerData ?? []) as unknown as Array<{ tenant_id: string; status: string }>;

  // --- Provisionszeilen des Zeitraums ------------------------------------
  // Gefiltert auf `booked_at`, nicht auf `paid_at`: die Stornoquote braucht
  // AUCH die noch nicht ausgezahlten Zeilen, sonst wäre der Nenner leer,
  // solange ein Mandant noch nichts ausgezahlt hat. Für die Abrechnung
  // (7.7) zählt danach nur, was auf `paid` steht.
  const { rows: commissionRows, truncated } = await fetchPaged<CommissionRow>(
    (rangeFrom, rangeTo) =>
      admin
        .from("affiliate_commissions")
        .select(COMMISSION_COLUMNS)
        .in("tenant_id", tenantIds)
        .eq("is_test", false)
        .gte("booked_at", from)
        .lte("booked_at", to)
        .order("booked_at", { ascending: true })
        .range(rangeFrom, rangeTo),
    MAX_COMMISSION_ROWS,
  );

  // --- Liegengebliebene Zahlungsereignisse -------------------------------
  const backlogCutoff = new Date(now.getTime() - AFFILIATE_EVENT_BACKLOG_HOURS * 3600_000).toISOString();
  const { data: staleEventData } = await admin
    .from("affiliate_events")
    .select("tenant_id, status, created_at")
    .in("status", ["pending", "error"])
    .lt("created_at", backlogCutoff)
    .order("created_at", { ascending: true })
    .limit(PAGE_SIZE);
  const staleEvents = (staleEventData ?? []) as unknown as Array<{
    tenant_id: string | null;
    status: string;
    created_at: string;
  }>;

  const unassigned = staleEvents.filter((e) => e.tenant_id === null);
  const unassignedEvents = {
    pending: unassigned.filter((e) => e.status === "pending").length,
    errored: unassigned.filter((e) => e.status === "error").length,
    oldestAt: unassigned[0]?.created_at ?? null,
  };

  // --- Auswertung je Mandant ---------------------------------------------
  const billingBuckets = new Map<string, OperatorBillingRow>();
  const perTenant = new Map<
    string,
    {
      bookedCents: number;
      reversedCents: number;
      paidByCurrency: Map<string, number>;
      balanceByPartner: Map<string, { cents: number; oldest: string }>;
    }
  >();

  for (const tenantId of tenantIds) {
    perTenant.set(tenantId, {
      bookedCents: 0,
      reversedCents: 0,
      paidByCurrency: new Map(),
      balanceByPartner: new Map(),
    });
  }

  for (const row of commissionRows) {
    const bucket = perTenant.get(row.tenant_id);
    if (bucket === undefined) continue;

    if (row.status !== "cancelled") {
      if (REVERSIBLE_KINDS.has(row.kind) && row.amount_cents > 0) bucket.bookedCents += row.amount_cents;
      if (row.kind === "reversal") bucket.reversedCents += Math.abs(row.amount_cents);
    }

    if (OPEN_COMMISSION_STATUSES.has(row.status)) {
      const current = bucket.balanceByPartner.get(row.partner_id);
      if (current === undefined) {
        bucket.balanceByPartner.set(row.partner_id, { cents: row.amount_cents, oldest: row.booked_at });
      } else {
        current.cents += row.amount_cents;
        if (row.booked_at < current.oldest) current.oldest = row.booked_at;
      }
    }

    if (row.status !== "paid") continue;

    // Der Monat, in dem das Geld geflossen ist. Fehlt `paid_at` (alte Zeile,
    // vor B8 auf `paid` gesetzt), fällt der Bericht auf die Buchungsperiode
    // zurück statt die Zeile zu verschweigen.
    const month = (row.paid_at ?? row.booked_at).slice(0, 7);
    const key = `${row.tenant_id} ${month} ${row.currency}`;
    const existing = billingBuckets.get(key);
    const target =
      existing ??
      {
        tenantId: row.tenant_id,
        tenantName: tenantsById.get(row.tenant_id)?.name ?? row.tenant_id,
        month,
        currency: row.currency,
        paidCents: 0,
        reversedCents: 0,
        netCents: 0,
        lines: 0,
      };
    if (row.amount_cents >= 0) target.paidCents += row.amount_cents;
    else target.reversedCents += row.amount_cents;
    target.netCents += row.amount_cents;
    target.lines += 1;
    billingBuckets.set(key, target);

    bucket.paidByCurrency.set(
      row.currency,
      (bucket.paidByCurrency.get(row.currency) ?? 0) + row.amount_cents,
    );
  }

  // --- Kontrollabgleich je Mandant (7.6) ---------------------------------
  // Ohne `quarantine` — eine Anzeige verändert nichts (siehe
  // `AffiliateIntegrityOptions` in integrity.ts).
  const integrityReports = await Promise.all(
    tenantIds.map((tenantId) => verifyAffiliateIntegrity(admin, tenantId, { now })),
  );

  const negativeCutoff = isoDate(new Date(now.getTime() - AFFILIATE_NEGATIVE_BALANCE_DAYS * 86_400_000));

  const tenants: OperatorTenantRow[] = tenantIds.map((tenantId, index) => {
    const program = programs.find((p) => p.tenant_id === tenantId);
    const bucket = perTenant.get(tenantId);
    const tenant = tenantsById.get(tenantId);
    const report = integrityReports[index];
    const findings: OperatorAffiliateFinding[] = [];

    const reversalRate =
      bucket && bucket.bookedCents > 0 ? bucket.reversedCents / bucket.bookedCents : null;
    if (reversalRate !== null && reversalRate > AFFILIATE_REVERSAL_RATE_THRESHOLD) {
      findings.push({
        kind: "reversal_rate",
        severity: "warning",
        text: `Stornoquote ${(reversalRate * 100).toFixed(1).replace(".", ",")} % im Zeitraum — über der Schwelle von 20 %.`,
      });
    }

    const oldNegative = [...(bucket?.balanceByPartner.values() ?? [])].filter(
      (entry) => entry.cents < 0 && entry.oldest < negativeCutoff,
    );
    if (oldNegative.length > 0) {
      const worst = oldNegative.reduce((a, b) => (a.cents < b.cents ? a : b));
      findings.push({
        kind: "negative_balance",
        severity: "warning",
        text: `${oldNegative.length} Partner mit Negativsaldo älter als ${AFFILIATE_NEGATIVE_BALANCE_DAYS} Tage (größter: ${formatCents(worst.cents, program?.currency ?? "eur")}).`,
      });
    }

    const stale = staleEvents.filter((e) => e.tenant_id === tenantId);
    if (stale.length > 0) {
      findings.push({
        kind: "event_backlog",
        severity: "warning",
        text: `${stale.length} Zahlungsereignisse älter als ${AFFILIATE_EVENT_BACKLOG_HOURS} Stunden unverarbeitet (ältestes vom ${(stale[0]?.created_at ?? "").slice(0, 10)}).`,
      });
    }

    if (!report.ok) {
      findings.push({
        kind: "integrity",
        severity: "warning",
        // `ok: false` heißt „nicht ermittelbar", NICHT „in Ordnung"
        // (integrity.ts) — deshalb steht das hier als eigener Befund und
        // nicht als stiller Leerzustand.
        text: "Kontrollabgleich konnte nicht vollständig durchgeführt werden — Zahlen ungeprüft.",
      });
    } else if (report.findings.length > 0) {
      const critical = report.findings.filter((f) => f.severity === "critical").length;
      findings.push({
        kind: "integrity",
        severity: critical > 0 ? "critical" : "warning",
        text: `Kontrollabgleich: ${report.findings.length} Abweichung(en), davon ${critical} mit Geldbezug.`,
      });
    }

    return {
      tenantId,
      tenantName: tenant?.name ?? tenantId,
      tenantSlug: tenant?.slug ?? "",
      programStatus: program?.status ?? "unbekannt",
      programCurrency: program?.currency ?? "eur",
      activePartners: partnerRows.filter((p) => p.tenant_id === tenantId && p.status === "active").length,
      pendingApplications: partnerRows.filter((p) => p.tenant_id === tenantId && p.status === "pending").length,
      paid: [...(bucket?.paidByCurrency.entries() ?? [])]
        .map(([currency, netCents]) => ({ currency, netCents }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      reversalRate,
      findings,
    };
  });

  const billing = [...billingBuckets.values()].sort(
    (a, b) =>
      a.tenantName.localeCompare(b.tenantName) ||
      a.month.localeCompare(b.month) ||
      a.currency.localeCompare(b.currency),
  );

  return { from, to, tenants, billing, unassignedEvents, truncated };
}

export { formatCents as formatOperatorCents };
