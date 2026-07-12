import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  TENANT_PLAN_LABELS,
  TENANT_STATUS_LABELS,
  type TenantPlan,
  type TenantStatus,
} from "@/lib/platform/schema";
import { translateDbError } from "@/lib/errors/db";

/**
 * Mandantenliste (Betreiber-Portal, Phase 4 Block 2). Server Component,
 * laedt ausschliesslich ueber den Admin-Client (service_role) — `tenants`-
 * RLS erlaubt SELECT nur Mandanten-Mitgliedern (0001_init.sql Zeile 440),
 * Platform-Admins sind keine. Das Layout (`portal/layout.tsx`) hat die
 * Platform-Admin-Zugriffsprüfung bereits vorher durchgeführt.
 *
 * Design-Block 6 (13.07.2026, Mandanten.dc.html): Kartenliste mit Avatar/
 * Teilnehmerzahl/Status-Badge statt der bisherigen schlichten Zeilenliste —
 * ABSICHTLICH weiterhin im dunklen Portal-Farbschema (Slate/`--color-primary`)
 * statt der hellen Export-Farben (`#F4F5FA`/weiße Karten): Design-Block 2
 * hat das dunkle Schema fürs Betreiber-Portal bewusst als Verwechslungsschutz
 * festgelegt ("darf nie wie eine normale Mandanten-Oberfläche aussehen",
 * siehe portal-shell.tsx-Kommentar) — dieser Export widerspricht dem, ohne
 * dass Josip die frühere Entscheidung revidiert hätte. Übernommen wird daher
 * nur die STRUKTUR (Avatar+Name+Domain, Teilnehmerzahl-Spalte, Status-Badge),
 * nicht die Farben.
 *
 * „Teilnehmer" = echte aktive Mitgliederzahl je Mandant (`memberships`,
 * `status='active'`), NICHT die im Export erfundenen Werte ("1.284", "212" …).
 */

const STATUS_BADGE_CLASSES: Record<TenantStatus, string> = {
  active: "bg-green-950 text-green-300",
  trial: "bg-amber-950 text-amber-300",
  suspended: "bg-red-950 text-red-300",
};

export default async function MandantenPage() {
  const admin = createAdminClient();
  const [{ data: tenants, error }, { data: memberships }] = await Promise.all([
    admin
      .from("tenants")
      .select("id, slug, name, plan, status, custom_domain, created_at, branding")
      .order("created_at", { ascending: false }),
    admin.from("memberships").select("tenant_id").eq("status", "active"),
  ]);

  const memberCountByTenant = new Map<string, number>();
  for (const m of memberships ?? []) {
    memberCountByTenant.set(m.tenant_id, (memberCountByTenant.get(m.tenant_id) ?? 0) + 1);
  }

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Plattform · Mandanten</p>
          <h1 className="text-2xl font-semibold text-slate-50">Mandanten</h1>
        </div>
        <Link
          href="/portal/mandanten/neu"
          className="w-fit rounded-md px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={{ background: "var(--color-primary)" }}
        >
          + Mandant anlegen
        </Link>
      </div>

      {error && (
        <p role="alert" className="text-base text-red-400">
          Mandanten konnten nicht geladen werden: {translateDbError(error)}
        </p>
      )}

      {!error && (tenants ?? []).length === 0 && (
        <p className="text-base text-slate-300">Noch keine Mandanten angelegt.</p>
      )}

      {!error && (tenants ?? []).length > 0 && (
        <div className="overflow-hidden rounded-md border border-slate-800">
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-0 border-b border-slate-800 px-5 py-3 text-xs font-semibold text-slate-500">
            <div>Mandant</div>
            <div>Teilnehmer</div>
            <div>Status</div>
          </div>
          <ul className="flex flex-col">
            {(tenants ?? []).map((tenant) => {
              const branding = (tenant.branding ?? {}) as { color_primary?: string };
              const accent = branding.color_primary || "#5663AE";
              const initial = tenant.name.trim().slice(0, 1).toUpperCase() || "?";
              const domain = tenant.custom_domain || `${tenant.slug}.localhost:3000`;
              return (
                <li key={tenant.id} className="border-b border-slate-900 last:border-b-0">
                  <Link
                    href={`/portal/mandanten/${tenant.id}`}
                    className="grid grid-cols-[2fr_1fr_1fr] items-center gap-0 px-5 py-3.5 text-base hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] text-[15px] font-bold text-white"
                        style={{ background: accent }}
                      >
                        {initial}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-50">{tenant.name}</div>
                        <div className="truncate text-xs text-slate-500">
                          {domain} · {TENANT_PLAN_LABELS[tenant.plan as TenantPlan] ?? tenant.plan}
                        </div>
                      </div>
                    </div>
                    <div className="text-slate-300">{memberCountByTenant.get(tenant.id) ?? 0}</div>
                    <div>
                      <span
                        className={`inline-flex rounded-lg px-3 py-1 text-xs font-bold ${
                          STATUS_BADGE_CLASSES[tenant.status as TenantStatus] ?? "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {TENANT_STATUS_LABELS[tenant.status as TenantStatus] ?? tenant.status}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </main>
  );
}
