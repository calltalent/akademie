import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  TENANT_PLAN_LABELS,
  TENANT_STATUS_LABELS,
  type TenantPlan,
  type TenantStatus,
} from "@/lib/platform/schema";

/**
 * Mandantenliste (Betreiber-Portal, Phase 4 Block 2). Server Component,
 * laedt ausschliesslich ueber den Admin-Client (service_role) — `tenants`-
 * RLS erlaubt SELECT nur Mandanten-Mitgliedern (0001_init.sql Zeile 440),
 * Platform-Admins sind keine. Das Layout (`portal/layout.tsx`) hat die
 * Platform-Admin-Zugriffsprüfung bereits vorher durchgeführt.
 */

const STATUS_BADGE_CLASSES: Record<TenantStatus, string> = {
  active: "bg-green-950 text-green-300",
  trial: "bg-amber-950 text-amber-300",
  suspended: "bg-red-950 text-red-300",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function MandantenPage() {
  const admin = createAdminClient();
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, slug, name, plan, status, custom_domain, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Mandanten</h1>
          <p className="text-base text-slate-300">
            Alle Akademie-Mandanten anlegen und verwalten.
          </p>
        </div>
        <Link
          href="/portal/mandanten/neu"
          className="w-fit rounded-md bg-slate-50 px-4 py-2 text-base font-medium text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          + Neuer Mandant
        </Link>
      </div>

      {error && (
        <p role="alert" className="text-base text-red-400">
          Mandanten konnten nicht geladen werden: {error.message}
        </p>
      )}

      {!error && (tenants ?? []).length === 0 && (
        <p className="text-base text-slate-300">Noch keine Mandanten angelegt.</p>
      )}

      {!error && (tenants ?? []).length > 0 && (
        <ul className="flex flex-col gap-2">
          {(tenants ?? []).map((tenant) => (
            <li key={tenant.id}>
              <Link
                href={`/portal/mandanten/${tenant.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800 px-4 py-3 text-base hover:border-slate-600 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-slate-50">{tenant.name}</span>
                  <span className="text-sm text-slate-400">
                    {tenant.slug}.localhost:3000
                    {tenant.custom_domain ? ` · ${tenant.custom_domain}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-300">
                    {TENANT_PLAN_LABELS[tenant.plan as TenantPlan] ?? tenant.plan}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      STATUS_BADGE_CLASSES[tenant.status as TenantStatus] ??
                      "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {TENANT_STATUS_LABELS[tenant.status as TenantStatus] ?? tenant.status}
                  </span>
                  <span className="text-sm text-slate-500">{formatDate(tenant.created_at)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
