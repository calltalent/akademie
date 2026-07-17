import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  TENANT_PLAN_LABELS,
  TENANT_STATUS_LABELS,
  type TenantPlan,
  type TenantStatus,
} from "@/lib/platform/schema";
import { MandantEditForm } from "./mandant-edit-form";
import { MandantDeleteForm } from "./mandant-delete-form";
import { TenantDomainsSection } from "./tenant-domains-section";
import { TenantBrandingForm } from "./tenant-branding-form";
import { TENANT_ACCENT_SWATCHES } from "@/lib/platform/schema";

/**
 * Mandanten-Detailseite (Betreiber-Portal, Phase 4 Block 2): Kopfbereich +
 * Bearbeiten-Formular + Nutzungsübersicht (Mitglieder-/Kurszahl,
 * `usage_counters` aktueller Monat, `ai_jobs`-Kosten letzte 90 Tage —
 * Aggregation in JS, keine neue SQL-Funktion, wie im architect-Plan
 * festgelegt). Alles ausschließlich über den Admin-Client (service_role),
 * exakt wie bereits in `mandanten/page.tsx` begründet.
 */

const AI_JOB_KIND_LABELS: Record<string, string> = {
  course_gen: "Kurs-Generierung",
  quiz_gen: "Quiz-Generierung",
  transcript: "Transkript",
  summary: "Zusammenfassung",
  embed: "Embeddings",
  // Stufe 3 „Untertitel DE+EN" (Plan calm-watching-dewdrop.md):
  // ensureEnglishCaption() (src/lib/video/translate-captions.ts) schreibt
  // ai_jobs mit kind:"translation" — ohne diesen Eintrag würde die englische
  // Kind-Kennung roh in dieser sonst durchgehend deutschen Kostenübersicht
  // auftauchen (Fallback-Verhalten unten: AI_JOB_KIND_LABELS[kind] ?? kind).
  translation: "Untertitel-Übersetzung",
};

/** Erster des laufenden Monats als ISO-Datum — Format der `usage_counters.month`-Spalte (analog src/lib/ai/usage.ts, dort nicht exportiert). */
function currentMonthIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export default async function MandantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, slug, name, plan, status, custom_domain, created_at, branding")
    .eq("id", id)
    .maybeSingle();

  if (!tenant) {
    notFound();
  }

  const branding = (tenant.branding ?? {}) as { color_primary?: string; radius?: string };
  const brandingInitial = {
    // Editor bietet bewusst nur die 4 Marken-Akzente aus dem Export an
    // (siehe TENANT_ACCENT_SWATCHES) — ein bereits gesetzter, davon
    // abweichender Wert fällt hier auf den Standard zurück (Anzeige only,
    // nicht automatisch überschrieben, solange nicht gespeichert wird).
    colorPrimary: (TENANT_ACCENT_SWATCHES as readonly string[]).includes(branding.color_primary ?? "")
      ? (branding.color_primary as string)
      : "#5663AE",
    radius: Number.parseInt(branding.radius ?? "14", 10) || 14,
  };

  // Korrektur (Josips Lint-Lauf, 12.07.2026): react-hooks/purity moniert
  // Date.now() als "unreinen Aufruf während des Renderns" — diese Regel ist
  // für Client-Komponenten mit React-Compiler-Memoization gedacht. Diese
  // Funktion ist eine async Server Component (führt pro Request genau
  // einmal aus, kein Re-Render/Memoization-Fall), daher hier bewusst
  // deaktiviert statt künstlich umgebaut.
  // eslint-disable-next-line react-hooks/purity
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: memberCount },
    { count: courseCount },
    { data: usageRow },
    { data: aiJobs },
    { data: tenantDomains },
  ] = await Promise.all([
    admin
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", id)
      .eq("status", "active"),
    admin.from("courses").select("id", { count: "exact", head: true }).eq("tenant_id", id),
    admin
      .from("usage_counters")
      .select("tutor_answers, course_gens")
      .eq("tenant_id", id)
      .eq("month", currentMonthIso())
      .maybeSingle(),
    admin
      .from("ai_jobs")
      .select("kind, cost_usd")
      .eq("tenant_id", id)
      .gte("created_at", ninetyDaysAgoIso),
    // FOLGEAUFTRAG (12.07.2026): zusätzliche Domains, siehe
    // tenant-domains-section.tsx / tenant_domains-Migration.
    admin
      .from("tenant_domains")
      .select("id, domain")
      .eq("tenant_id", id)
      .order("created_at"),
  ]);

  const jobs = aiJobs ?? [];
  const totalCost = jobs.reduce((sum, job) => sum + Number(job.cost_usd ?? 0), 0);
  const costByKind = new Map<string, number>();
  for (const job of jobs) {
    const current = costByKind.get(job.kind) ?? 0;
    costByKind.set(job.kind, current + Number(job.cost_usd ?? 0));
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
          <a
            href={`http://${tenant.slug}.localhost:3000`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            {tenant.slug}.localhost:3000
          </a>
          {tenant.custom_domain && <span>· {tenant.custom_domain}</span>}
          <span>
            {TENANT_PLAN_LABELS[tenant.plan as TenantPlan] ?? tenant.plan} ·{" "}
            {TENANT_STATUS_LABELS[tenant.status as TenantStatus] ?? tenant.status}
          </span>
          <span className="text-slate-500">Erstellt am {formatDateTime(tenant.created_at)}</span>
        </div>
        <a
          href={`/portal/mandanten/${tenant.id}/export`}
          className="w-fit text-sm underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          Mandanten-Daten exportieren (DSGVO, Art. 28)
        </a>
      </div>

      <section aria-labelledby="edit-heading" className="flex flex-col gap-3">
        <h2 id="edit-heading" className="text-lg font-medium">
          Bearbeiten
        </h2>
        <MandantEditForm
          tenant={{
            id: tenant.id,
            name: tenant.name,
            plan: tenant.plan as TenantPlan,
            status: tenant.status as TenantStatus,
            customDomain: tenant.custom_domain,
          }}
        />
        <TenantDomainsSection tenantId={tenant.id} domains={tenantDomains ?? []} />
      </section>

      <section aria-labelledby="branding-heading" className="flex flex-col gap-3">
        <h2 id="branding-heading" className="text-lg font-medium">
          Branding &amp; Theming
        </h2>
        <TenantBrandingForm tenantId={tenant.id} tenantName={tenant.name} initial={brandingInitial} />
      </section>

      <section aria-labelledby="usage-heading" className="flex flex-col gap-4">
        <h2 id="usage-heading" className="text-lg font-medium">
          Nutzungsübersicht
        </h2>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-md border border-slate-800 p-4">
            <dt className="text-sm text-slate-400">Mitglieder</dt>
            <dd className="text-2xl font-semibold">{memberCount ?? 0}</dd>
          </div>
          <div className="rounded-md border border-slate-800 p-4">
            <dt className="text-sm text-slate-400">Kurse</dt>
            <dd className="text-2xl font-semibold">{courseCount ?? 0}</dd>
          </div>
          <div className="rounded-md border border-slate-800 p-4">
            <dt className="text-sm text-slate-400">Tutor-Antworten (Monat)</dt>
            <dd className="text-2xl font-semibold">{usageRow?.tutor_answers ?? 0}</dd>
          </div>
          <div className="rounded-md border border-slate-800 p-4">
            <dt className="text-sm text-slate-400">Kurs-Generierungen (Monat)</dt>
            <dd className="text-2xl font-semibold">{usageRow?.course_gens ?? 0}</dd>
          </div>
        </dl>

        <div className="rounded-md border border-slate-800 p-4">
          <h3 className="text-base font-medium">KI-Kosten (letzte 90 Tage)</h3>
          <p className="mt-1 text-2xl font-semibold">{formatUsd(totalCost)}</p>

          {costByKind.size === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Keine KI-Aufrufe im Zeitraum.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1">
              {Array.from(costByKind.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([kind, cost]) => (
                  <li key={kind} className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">{AI_JOB_KIND_LABELS[kind] ?? kind}</span>
                    <span className="text-slate-50">{formatUsd(cost)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="delete-heading" className="flex flex-col gap-3">
        <h2 id="delete-heading" className="text-lg font-medium text-red-300">
          Gefahrenzone
        </h2>
        <MandantDeleteForm tenantId={tenant.id} slug={tenant.slug} />
      </section>
    </main>
  );
}
