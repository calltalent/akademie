import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Portal-Übersicht (Josips Auftrag 19.07.2026: "KI-Kosten der jeweiligen
 * Mandanten" + Zeitraum-Auswahl täglich/monatlich/seit Erstellung + Ø pro
 * Mandant + Gesamt). Löst die bisherige reine Platzhalter-Startseite
 * (Phase 4, Block 1) ab — erster echter Inhalt hier.
 *
 * Zeiträume als Query-Param (`?range=`), gleiches Link-Filter-Muster wie
 * admin/abgaben (submission-inbox.tsx) — kein Client-State nötig, einfache
 * `<Link href="?range=...">`-Tabs, Server Component lädt entsprechend
 * gefiltert neu.
 *
 * - `today`: seit Beginn des heutigen Tages (UTC-Tagesgrenze, `created_at`
 *   ist UTC gespeichert).
 * - `month`: seit Beginn des laufenden Monats (UTC), gleiche Grenze wie
 *   `usage_counters.month`/currentMonthIso() in mandanten/[id]/page.tsx.
 * - `all` ("seit Erstellung"): kein Datumsfilter — ein `ai_jobs`-Eintrag
 *   kann per FK ohnehin nie vor der Mandanten-Anlage entstanden sein, ein
 *   expliziter Vergleich gegen `tenant.created_at` wäre deshalb redundant.
 *
 * „Ø KI-Kosten pro Mandant" teilt die Gesamtsumme durch ALLE Mandanten
 * (nicht nur die mit Nutzung im Zeitraum) — die Kennzahl beantwortet "was
 * kostet im Schnitt ein Mandant", nicht "was kostet ein aktiver Mandant".
 * Bei 0 Mandanten wird kein Durchschnitt berechnet (Division durch 0).
 *
 * Nur `platform_admins` sehen diese Seite (Zugriff über portal/layout.tsx
 * bereits gegated) — Admin-Client hier nötig, da `ai_jobs`-RLS nur
 * Mandanten-Mitgliedern erlaubt ist, ein Platform-Admin aber i. A. keines
 * der aufgelisteten Mandanten ist (gleiches Muster wie mandanten/page.tsx).
 */

type Range = "today" | "month" | "all";

const RANGE_LABELS: Record<Range, string> = {
  today: "Täglich",
  month: "Monatlich",
  all: "Seit Erstellung",
};

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export default async function PortalHomePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rawRange } = await searchParams;
  const range: Range = rawRange === "today" || rawRange === "all" ? rawRange : "month";

  const admin = createAdminClient();

  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name, slug")
    .order("name", { ascending: true });

  let jobsQuery = admin.from("ai_jobs").select("tenant_id, cost_usd, created_at");
  if (range === "today") {
    jobsQuery = jobsQuery.gte("created_at", startOfTodayUtc().toISOString());
  } else if (range === "month") {
    jobsQuery = jobsQuery.gte("created_at", startOfMonthUtc().toISOString());
  }
  const { data: jobs } = await jobsQuery;

  const costByTenant = new Map<string, number>();
  for (const job of jobs ?? []) {
    const current = costByTenant.get(job.tenant_id) ?? 0;
    costByTenant.set(job.tenant_id, current + Number(job.cost_usd ?? 0));
  }

  const tenantRows = (tenants ?? [])
    .map((t) => ({ id: t.id, name: t.name, slug: t.slug, cost: costByTenant.get(t.id) ?? 0 }))
    .sort((a, b) => b.cost - a.cost);

  const totalCost = tenantRows.reduce((sum, t) => sum + t.cost, 0);
  const averagePerTenant = tenantRows.length > 0 ? totalCost / tenantRows.length : null;

  return (
    <main className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Portal · Übersicht</p>
        <h1 className="text-2xl font-semibold text-slate-50">Übersicht</h1>
        <p className="mt-1 max-w-xl text-base text-slate-300">
          KI-Kosten aller Mandanten — Zeitraum wählen, um die Kosten je Mandant, den Durchschnitt
          pro Mandant und die Gesamtsumme zu sehen.
        </p>
      </header>

      <div className="flex gap-2" role="tablist" aria-label="Zeitraum">
        {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
          <Link
            key={r}
            href={`/portal?range=${r}`}
            role="tab"
            aria-selected={range === r}
            className="rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
            style={
              range === r
                ? { background: "var(--color-primary)", color: "#fff" }
                : { background: "transparent", color: "#94a3b8", border: "1px solid #1e293b" }
            }
          >
            {RANGE_LABELS[r]}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-slate-800 p-4">
          <p className="text-sm text-slate-400">KI-Kosten gesamt ({RANGE_LABELS[range].toLowerCase()})</p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">{formatUsd(totalCost)}</p>
        </div>
        <div className="rounded-md border border-slate-800 p-4">
          <p className="text-sm text-slate-400">Ø KI-Kosten pro Mandant</p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">
            {averagePerTenant !== null ? formatUsd(averagePerTenant) : "—"}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-800">
        <div className="grid grid-cols-[2fr_1fr] gap-0 border-b border-slate-800 px-5 py-3 text-xs font-semibold text-slate-500">
          <div>Mandant</div>
          <div className="text-right">KI-Kosten</div>
        </div>
        {tenantRows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400">Noch keine Mandanten angelegt.</p>
        ) : (
          <ul className="flex flex-col">
            {tenantRows.map((t) => (
              <li key={t.id} className="border-b border-slate-900 last:border-b-0">
                <Link
                  href={`/portal/mandanten/${t.id}`}
                  className="grid grid-cols-[2fr_1fr] items-center gap-0 px-5 py-3 text-base hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
                >
                  <span className="truncate font-semibold text-slate-50">{t.name}</span>
                  <span className="text-right text-slate-300">{formatUsd(t.cost)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link
        href="/portal/mandanten"
        className="w-fit rounded-md bg-slate-50 px-4 py-2 text-base font-medium text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
      >
        Mandanten verwalten
      </Link>
    </main>
  );
}
