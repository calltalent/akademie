import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  TENANT_PLAN_LABELS,
  TENANT_STATUS_LABELS,
  type TenantPlan,
  type TenantStatus,
} from "@/lib/platform/schema";
import { translateDbError } from "@/lib/errors/db";
import { tenantOrigin } from "@/lib/tenant/url";

/**
 * Mandantenliste (Betreiber-Portal, Phase 4 Block 2). Server Component,
 * laedt ausschliesslich ueber den Admin-Client (service_role) — `tenants`-
 * RLS erlaubt SELECT nur Mandanten-Mitgliedern (0001_init.sql Zeile 440),
 * Platform-Admins sind keine. Das Layout (`portal/layout.tsx`) hat die
 * Platform-Admin-Zugriffsprüfung bereits vorher durchgeführt.
 *
 * Design-Update (19.07.2026, Claude-Design-Import Mandanten.dc.html —
 * zweiter Anlauf desselben Masterprompts, DESIGN-MASTERPROMPT-PORTAL-
 * MANDANTEN.md): dieses Mal korrekt im dunklen Portal-Schema geliefert
 * (der erste Export vom 13.07. nutzte fälschlich das helle Kunden-Schema,
 * siehe Git-Historie dieser Datei) — deshalb jetzt direkt übernommen,
 * inklusive Paket- und Angelegt-Spalte, die vorher fehlten.
 *
 * „Teilnehmer" = echte aktive Mitgliederzahl je Mandant (`memberships`,
 * `status='active'`), NICHT die im Export erfundenen Demo-Werte.
 *
 * Domain-Anzeige nutzt jetzt `tenantOrigin()` (lib/tenant/url.ts) statt der
 * bisherigen fest verdrahteten `.localhost:3000`-Annahme — in Produktion
 * war das schlicht falsch (zeigte nie die echte `.calltalent.ai`-Domain).
 */

const STATUS_BADGE_STYLE: Record<TenantStatus, { color: string; background: string }> = {
  active: { color: "#4ADE80", background: "rgba(74,222,128,.12)" },
  trial: { color: "#FBBF24", background: "rgba(251,191,36,.12)" },
  suspended: { color: "#F87171", background: "rgba(248,113,113,.12)" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

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
          <p className="text-[13px] font-semibold" style={{ color: "#64748B" }}>
            Portal · Mandanten
          </p>
          <h1 className="mt-0.5 text-[26px] font-extrabold text-slate-50" style={{ letterSpacing: "-0.01em" }}>
            Mandanten
          </h1>
        </div>
        <Link
          href="/portal/mandanten/neu"
          className="inline-flex w-fit items-center gap-2 rounded-[11px] px-[18px] py-3 text-[15px] font-bold text-white focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={{ background: "var(--color-primary)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14"></path>
            <path d="M5 12h14"></path>
          </svg>
          Neuer Mandant
        </Link>
      </div>

      {error && (
        <p role="alert" className="text-base text-red-400">
          Mandanten konnten nicht geladen werden: {translateDbError(error)}
        </p>
      )}

      {!error && (tenants ?? []).length === 0 && (
        <div className="rounded-[14px] border p-14 text-center" style={{ borderColor: "#1e293b", background: "#0f172a", color: "#64748B" }}>
          <div className="mb-1.5 text-base font-bold" style={{ color: "#CBD5E1" }}>
            Noch keine Mandanten
          </div>
          <div className="text-sm">Lege den ersten Mandanten an, um loszulegen.</div>
        </div>
      )}

      {!error && (tenants ?? []).length > 0 && (
        <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
          <div
            className="hidden gap-0 px-6 pb-3 pt-[18px] text-[13px] font-bold lg:grid"
            style={{ gridTemplateColumns: "2.2fr 1fr 1fr 0.9fr 1fr", color: "#64748B", borderBottom: "1px solid #1e293b" }}
          >
            <div>Mandant</div>
            <div>Paket</div>
            <div>Teilnehmer</div>
            <div>Status</div>
            <div>Angelegt</div>
          </div>
          <ul className="flex flex-col">
            {(tenants ?? []).map((tenant) => {
              const branding = (tenant.branding ?? {}) as { color_primary?: string };
              const accent = branding.color_primary || "#5663AE";
              const initial = tenant.name.trim().slice(0, 1).toUpperCase() || "?";
              const domain = tenantOrigin(tenant).replace(/^https?:\/\//, "");
              const status = STATUS_BADGE_STYLE[tenant.status as TenantStatus] ?? {
                color: "#CBD5E1",
                background: "#1e293b",
              };
              return (
                <li key={tenant.id} className="border-b last:border-b-0" style={{ borderColor: "#1e293b" }}>
                  <Link
                    href={`/portal/mandanten/${tenant.id}`}
                    prefetch={false}
                    className="block px-5 py-4 text-base hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950 lg:grid lg:items-center lg:gap-0 lg:px-6"
                    style={{ gridTemplateColumns: "2.2fr 1fr 1fr 0.9fr 1fr" }}
                  >
                    {/* Mobile-Karte (22.07.2026, Josips Auftrag "Mandantenbereich für
                        Mobile optimieren"): die 5-spaltige Desktop-Tabelle (feste
                        fr-Verhältnisse für eine breite Fläche gedacht) quetschte auf
                        375px Breite Wörter einzeln um. Eigene, gestapelte Darstellung
                        unter `lg` statt die Tabelle nur zu verschmälern — dieselben
                        Daten, andere Anordnung. */}
                    <div className="flex min-w-0 items-center gap-3 lg:hidden">
                      <span
                        aria-hidden="true"
                        className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] text-[15px] font-bold text-white"
                        style={{ background: accent }}
                      >
                        {initial}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-50">{tenant.name}</div>
                        <div className="truncate text-xs" style={{ color: "#64748B" }}>
                          {domain}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs lg:hidden">
                      <span
                        className="inline-flex rounded-lg px-3 py-1 font-bold"
                        style={{ color: "#CBD5E1", background: "#1e293b" }}
                      >
                        {TENANT_PLAN_LABELS[tenant.plan as TenantPlan] ?? tenant.plan}
                      </span>
                      <span
                        className="inline-flex rounded-lg px-3 py-1 font-bold"
                        style={{ color: status.color, background: status.background }}
                      >
                        {TENANT_STATUS_LABELS[tenant.status as TenantStatus] ?? tenant.status}
                      </span>
                      <span style={{ color: "#64748B" }}>
                        {memberCountByTenant.get(tenant.id) ?? 0} Teilnehmer
                      </span>
                      <span style={{ color: "#64748B" }}>· {formatDate(tenant.created_at)}</span>
                    </div>

                    {/* Desktop-Tabelle (unverändert) */}
                    <div className="hidden min-w-0 items-center gap-3 lg:flex">
                      <span
                        aria-hidden="true"
                        className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] text-[15px] font-bold text-white"
                        style={{ background: accent }}
                      >
                        {initial}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-50">{tenant.name}</div>
                        <div className="truncate text-xs" style={{ color: "#64748B" }}>
                          {domain}
                        </div>
                      </div>
                    </div>
                    <div className="hidden lg:block">
                      <span
                        className="inline-flex rounded-lg px-3 py-1 text-xs font-bold"
                        style={{ color: "#CBD5E1", background: "#1e293b" }}
                      >
                        {TENANT_PLAN_LABELS[tenant.plan as TenantPlan] ?? tenant.plan}
                      </span>
                    </div>
                    <div className="hidden text-slate-300 lg:block">{memberCountByTenant.get(tenant.id) ?? 0}</div>
                    <div className="hidden lg:block">
                      <span
                        className="inline-flex rounded-lg px-3 py-1 text-xs font-bold"
                        style={{ color: status.color, background: status.background }}
                      >
                        {TENANT_STATUS_LABELS[tenant.status as TenantStatus] ?? tenant.status}
                      </span>
                    </div>
                    <div className="hidden text-sm lg:block" style={{ color: "#64748B" }}>
                      {formatDate(tenant.created_at)}
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
