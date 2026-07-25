import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  TENANT_PLAN_LABELS,
  TENANT_STATUS_LABELS,
  type TenantPlan,
  type TenantStatus,
} from "@/lib/platform/schema";
import { tenantOrigin } from "@/lib/tenant/url";
import { MandantDetailTabs } from "./mandant-detail-tabs";

/**
 * Mandanten-Detailseite (Betreiber-Portal, Phase 4 Block 2): Kopfbereich +
 * Bearbeiten-Formular + Nutzungsübersicht (Mitglieder-/Kurszahl,
 * `usage_counters` aktueller Monat, `ai_jobs`-Kosten letzte 90 Tage —
 * Aggregation in JS, keine neue SQL-Funktion, wie im architect-Plan
 * festgelegt). Alles ausschließlich über den Admin-Client (service_role),
 * exakt wie bereits in `mandanten/page.tsx` begründet.
 *
 * Design-Update (19.07.2026, Claude-Design-Import MandantenDetail.dc.html,
 * DESIGN-MASTERPROMPT-PORTAL-MANDANTEN.md): Kopfbereich jetzt mit Breadcrumb
 * "Mandanten / {Name}", Avatar-Kachel, Status-/Paket-Badge im Header statt
 * im Fließtext. Jede Sektion (Bearbeiten, Domains, Branding, Gefahrenzone)
 * trägt ihren Titel jetzt SELBST als Karten-Überschrift (siehe die jeweilige
 * Komponente) — die bisherigen Seiten-`<h2>`-Wrapper entfallen, da sie sonst
 * doppelt betitelt wären. Domain-Anzeige nutzt `tenantOrigin()` statt der
 * bisherigen `.localhost:3000`-Annahme (siehe mandanten/page.tsx-Kommentar).
 * Der DSGVO-Export-Link (Art. 28) ist im Export nicht abgebildet, bleibt
 * aber erhalten — echte, bestehende Funktion, kein Mockup-Artefakt.
 *
 * Horizontale Reiter (25.07.2026, Josips Auftrag): die sieben Karten unter
 * dem Kopfbereich (Bearbeiten, Funktionen, Domains, Branding, Login-Inhalt,
 * Nutzungsübersicht, Gefahrenzone) wanderten in `MandantDetailTabs`
 * (mandant-detail-tabs.tsx) — diese Seite lädt unverändert alle Daten,
 * das Rendering übernimmt komplett der neue Client-Wrapper. Der
 * Kopfbereich (Breadcrumb/Avatar/Badges/DSGVO-Export) bleibt außerhalb der
 * Reiter, exakt wie beim Kurs-Editor der Zurück-Link/Kurstitel.
 */

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

export default async function MandantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, slug, name, plan, status, custom_domain, created_at, branding, settings")
    .eq("id", id)
    .maybeSingle();

  if (!tenant) {
    notFound();
  }

  // Polarität wie an den jeweiligen Gate-Stellen geprüft (siehe
  // updateTenantFeatures-Kopfkommentar): payments_enabled ist "an, außer
  // explizit false", tutor_enabled/course_generator_enabled sind "aus,
  // außer explizit true".
  const tenantSettings = (tenant.settings ?? {}) as {
    payments_enabled?: boolean;
    tutor_enabled?: boolean;
    course_generator_enabled?: boolean;
  };
  const paymentsEnabled = tenantSettings.payments_enabled !== false;
  const tutorEnabled = tenantSettings.tutor_enabled === true;
  const courseGeneratorEnabled = tenantSettings.course_generator_enabled === true;

  const branding = (tenant.branding ?? {}) as {
    color_primary?: string;
    radius?: string;
    logo_url?: string | null;
    login_bg_opacity?: number;
    login_heading?: string;
    login_subheading?: string;
    login_copyright?: string;
  };
  // Freier Hex-Code (19.07.2026, Josips Auftrag) — TENANT_ACCENT_SWATCHES
  // sind seitdem nur noch die Schnellauswahl in der UI, keine Schema-Grenze
  // mehr; ein bereits gesetzter Wert wird deshalb 1:1 angezeigt, nur ein
  // fehlender/unbrauchbarer Wert fällt auf den Marken-Standard zurück.
  const brandingInitial = {
    colorPrimary: /^#[0-9a-fA-F]{6}$/.test(branding.color_primary ?? "")
      ? (branding.color_primary as string)
      : "#5663AE",
    radius: Number.parseInt(branding.radius ?? "14", 10) || 14,
    logoUrl: branding.logo_url ?? null,
  };

  const loginContentInitial = {
    bgOpacity: typeof branding.login_bg_opacity === "number" ? branding.login_bg_opacity : 100,
    heading: branding.login_heading ?? null,
    subheading: branding.login_subheading ?? null,
    copyright: branding.login_copyright ?? null,
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
  const costByKind = new Map<string, number>();
  for (const job of jobs) {
    const current = costByKind.get(job.kind) ?? 0;
    costByKind.set(job.kind, current + Number(job.cost_usd ?? 0));
  }
  const initial = tenant.name.trim().slice(0, 1).toUpperCase() || "?";
  const domain = tenant.custom_domain || tenantOrigin(tenant).replace(/^https?:\/\//, "");
  const statusStyle: Record<TenantStatus, { color: string; background: string }> = {
    active: { color: "#4ADE80", background: "rgba(74,222,128,.12)" },
    trial: { color: "#FBBF24", background: "rgba(251,191,36,.12)" },
    suspended: { color: "#F87171", background: "rgba(248,113,113,.12)" },
  };
  const badge = statusStyle[tenant.status as TenantStatus] ?? { color: "#CBD5E1", background: "#1e293b" };

  return (
    <main className="flex flex-col gap-6" style={{ maxWidth: 920 }}>
      <header>
        <div>
          <Link href="/portal/mandanten" className="text-[13px] font-semibold no-underline" style={{ color: "#64748B" }}>
            Mandanten
          </Link>
          <span className="text-[13px] font-semibold" style={{ color: "#64748B" }}>
            {" "}
            / {tenant.name}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3.5">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-lg font-extrabold text-white"
            style={{ background: "#5663AE" }}
          >
            {initial}
          </span>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-50" style={{ letterSpacing: "-0.01em" }}>
              {tenant.name}
            </h1>
            <div className="mt-0.5 text-[13px]" style={{ color: "#64748B" }}>
              {domain}
            </div>
          </div>
          <span className="inline-flex rounded-lg px-3 py-1 text-xs font-bold" style={{ color: badge.color, background: badge.background }}>
            {TENANT_STATUS_LABELS[tenant.status as TenantStatus] ?? tenant.status}
          </span>
          <span className="inline-flex rounded-lg px-3 py-1 text-xs font-bold" style={{ color: "#CBD5E1", background: "#1e293b" }}>
            {TENANT_PLAN_LABELS[tenant.plan as TenantPlan] ?? tenant.plan}
          </span>
          <div className="flex-1" />
          <div className="text-[13px]" style={{ color: "#64748B" }}>
            Angelegt am {formatDateTime(tenant.created_at)}
          </div>
        </div>
        <a
          href={`/portal/mandanten/${tenant.id}/export`}
          className="mt-2 inline-block w-fit text-sm underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={{ color: "#94A3B8" }}
        >
          Mandanten-Daten exportieren (DSGVO, Art. 28)
        </a>
      </header>

      <MandantDetailTabs
        tenantId={tenant.id}
        slug={tenant.slug}
        editable={{
          id: tenant.id,
          name: tenant.name,
          plan: tenant.plan as TenantPlan,
          status: tenant.status as TenantStatus,
          customDomain: tenant.custom_domain,
        }}
        features={{ paymentsEnabled, tutorEnabled, courseGeneratorEnabled }}
        domains={tenantDomains ?? []}
        brandingInitial={brandingInitial}
        tenantName={tenant.name}
        loginContentInitial={loginContentInitial}
        usage={{
          memberCount: memberCount ?? 0,
          courseCount: courseCount ?? 0,
          tutorAnswers: usageRow?.tutor_answers ?? 0,
          courseGens: usageRow?.course_gens ?? 0,
          costs: Array.from(costByKind.entries()).sort((a, b) => b[1] - a[1]),
        }}
      />
    </main>
  );
}
