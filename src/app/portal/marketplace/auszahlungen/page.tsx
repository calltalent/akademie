import Link from "next/link";
import { getPayoutRows, listTenantsForPayoutFilter } from "@/lib/platform/marketplace";
import { payoutFilterQuerySchema } from "@/lib/platform/schema";
import { PayoutTable } from "./payout-table";

/**
 * Auszahlungs-Ansicht (Marketplace M6, Plan Abschnitt 7 "Betreiber-Portal",
 * die Auszahlungs-Zeilen, die in M3 bewusst ausgelassen wurden). Filter
 * (Mandant/Zeitraum) läuft über einfache GET-Query-Parameter statt eines
 * Client-seitigen Zustands — gleiches Prinzip wie
 * `admin/abgaben/page.tsx?status=…`: eine Server Component liest
 * `searchParams`, kein zusätzliches JavaScript nötig, funktioniert auch ganz
 * ohne aktiviertes JS (Barrierefreiheit/Robustheit).
 *
 * `requirePlatformAdmin()`-Gate ist bereits durch `portal/layout.tsx`
 * sichergestellt — Defense-in-Depth trotzdem vorhanden: `getPayoutRows()`/
 * `listTenantsForPayoutFilter()` (`platform/marketplace.ts`) prüfen beide
 * intern erneut, gleiches Muster wie `portal/marketplace/page.tsx`.
 */

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

const INPUT_STYLE = { borderColor: "#1e293b", background: "#0f172a", color: "#f8fafc" } as const;

export default async function AuszahlungenPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; from?: string; to?: string }>;
}) {
  const rawParams = await searchParams;
  const parsed = payoutFilterQuerySchema.safeParse({
    tenantId: rawParams.tenantId || undefined,
    from: rawParams.from || undefined,
    to: rawParams.to || undefined,
  });
  // Ungültige/manipulierte Query-Parameter (z. B. ein Datum im falschen
  // Format über einen manuell bearbeiteten Link) führen still zu einem
  // ungefilterten Ergebnis statt zu einer Fehlerseite — dieselbe Toleranz,
  // die auch der CSV-Export NICHT hat (dort ist eine 400-Antwort
  // angemessener, siehe export/route.ts): hier ist es nur eine Ansicht ohne
  // Seiteneffekt, ein harter Fehler wäre unverhältnismäßig.
  const filter = parsed.success ? parsed.data : {};

  const [{ rows, summaryByTenant }, tenants] = await Promise.all([
    getPayoutRows(filter),
    listTenantsForPayoutFilter(),
  ]);

  const exportParams = new URLSearchParams();
  if (filter.tenantId) exportParams.set("tenantId", filter.tenantId);
  if (filter.from) exportParams.set("from", filter.from);
  if (filter.to) exportParams.set("to", filter.to);
  const exportHref = `/portal/marketplace/auszahlungen/export${exportParams.size > 0 ? `?${exportParams.toString()}` : ""}`;

  const hasActiveFilter = Boolean(filter.tenantId || filter.from || filter.to);

  return (
    <main className="flex flex-col gap-6">
      <div>
        <Link href="/portal/marketplace" className="text-[13px] font-semibold no-underline" style={{ color: "#64748B" }}>
          Marketplace
        </Link>
        <span className="text-[13px] font-semibold" style={{ color: "#64748B" }}>
          {" "}
          / Auszahlungen
        </span>
        <h1 className="mt-0.5 text-[26px] font-extrabold text-slate-50" style={{ letterSpacing: "-0.01em" }}>
          Auszahlungen
        </h1>
        <p className="mt-1 text-sm" style={{ color: "#64748B" }}>
          Provisions-Ledger je Mandant und Bestellung, manuelle Auszahlung per Überweisung.
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-4 rounded-[14px] border p-5"
        style={{ borderColor: "#1e293b", background: "#0f172a" }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tenantId" className="text-sm font-semibold text-slate-200">
            Mandant
          </label>
          <select
            id="tenantId"
            name="tenantId"
            defaultValue={filter.tenantId ?? ""}
            className="w-56 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            style={INPUT_STYLE}
          >
            <option value="">Alle Mandanten</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="from" className="text-sm font-semibold text-slate-200">
            Von
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={filter.from ?? ""}
            className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            style={INPUT_STYLE}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="to" className="text-sm font-semibold text-slate-200">
            Bis
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={filter.to ?? ""}
            className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            style={INPUT_STYLE}
          />
        </div>
        <button
          type="submit"
          className="rounded-[10px] px-[18px] py-2.5 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={{ background: "var(--color-primary)" }}
        >
          Filtern
        </button>
        {hasActiveFilter && (
          <Link
            href="/portal/marketplace/auszahlungen"
            className="text-sm font-semibold"
            style={{ color: "#64748B" }}
          >
            Filter zurücksetzen
          </Link>
        )}
        <a
          href={exportHref}
          className="ml-auto rounded-[10px] border px-[18px] py-2.5 text-sm font-bold no-underline focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={{ borderColor: "#1e293b", color: "#CBD5E1" }}
        >
          CSV exportieren
        </a>
      </form>

      {summaryByTenant.length > 0 && (
        <section className="overflow-hidden rounded-[14px] border" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
          <h2 className="px-6 pb-3 pt-5 text-[17px] font-bold text-slate-50">Summen je Mandant</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Offene und ausgezahlte Netto-Summen je Mandant</caption>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  <th scope="col" className="px-6 py-3 text-left font-bold" style={{ color: "#64748B" }}>
                    Mandant
                  </th>
                  <th scope="col" className="px-6 py-3 text-right font-bold" style={{ color: "#64748B" }}>
                    Offen (netto)
                  </th>
                  <th scope="col" className="px-6 py-3 text-right font-bold" style={{ color: "#64748B" }}>
                    Ausgezahlt (netto)
                  </th>
                </tr>
              </thead>
              <tbody>
                {summaryByTenant.map((s) => (
                  <tr key={`${s.tenantId}-${s.currency}`} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td className="px-6 py-3 text-slate-100">{s.tenantName}</td>
                    <td className="px-6 py-3 text-right text-slate-100">
                      {formatAmount(s.openNetCents)} {s.currency.toUpperCase()}
                    </td>
                    <td className="px-6 py-3 text-right text-slate-100">
                      {formatAmount(s.paidNetCents)} {s.currency.toUpperCase()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <PayoutTable rows={rows} />
    </main>
  );
}
