import Link from "next/link";
import { listPendingListings } from "@/lib/platform/marketplace";

/**
 * Prüf-Warteschlange (Marketplace M3, Plan Abschnitt 7): alle eingereichten
 * (`status='submitted'`) Listings, älteste zuerst. Gleiches Layout wie
 * `portal/mandanten/page.tsx` (dunkle Karte, Desktop-Tabelle, Zugriffs-Gate
 * bereits durch `portal/layout.tsx` erledigt — hier kein weiteres
 * `checkPlatformAccess()` nötig, `listPendingListings()` prüft zusätzlich
 * intern per `requirePlatformAdmin()`).
 */

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatPrice(cents: number, currency: string): string {
  if (cents === 0) return "Kostenlos";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

const LIST_COLS = "2fr 1.4fr 1fr 1fr";

export default async function PortalMarketplacePage() {
  const listings = await listPendingListings();

  return (
    <main className="flex flex-col gap-6">
      <div>
        <p className="text-[13px] font-semibold" style={{ color: "#64748B" }}>
          Portal · Marketplace
        </p>
        <h1 className="mt-0.5 text-[26px] font-extrabold text-slate-50" style={{ letterSpacing: "-0.01em" }}>
          Prüf-Warteschlange
        </h1>
      </div>

      {listings.length === 0 ? (
        <div
          className="rounded-[14px] border p-14 text-center"
          style={{ borderColor: "#1e293b", background: "#0f172a", color: "#64748B" }}
        >
          <div className="mb-1.5 text-base font-bold" style={{ color: "#CBD5E1" }}>
            Keine offenen Einreichungen
          </div>
          <div className="text-sm">Neue Marketplace-Einreichungen von Mandanten erscheinen hier zur Prüfung.</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
          <div
            className="hidden gap-0 px-6 pb-3 pt-[18px] text-[13px] font-bold lg:grid"
            style={{ gridTemplateColumns: LIST_COLS, color: "#64748B", borderBottom: "1px solid #1e293b" }}
          >
            <div>Kurs</div>
            <div>Mandant</div>
            <div>Preis</div>
            <div>Eingereicht am</div>
          </div>
          <ul className="flex flex-col">
            {listings.map((l) => (
              <li key={l.id} className="border-b last:border-b-0" style={{ borderColor: "#1e293b" }}>
                <Link
                  href={`/portal/marketplace/${l.id}`}
                  prefetch={false}
                  className="block px-5 py-4 text-base hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950 lg:grid lg:items-center lg:px-6"
                  style={{ gridTemplateColumns: LIST_COLS }}
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-50">{l.headline || l.courseTitle}</div>
                    <div className="mt-0.5 truncate text-xs lg:hidden" style={{ color: "#64748B" }}>
                      {l.tenantName} · {formatPrice(l.priceCents, l.currency)} · {formatDate(l.submittedAt)}
                    </div>
                  </div>
                  <div className="hidden truncate text-sm lg:block" style={{ color: "#CBD5E1" }}>
                    {l.tenantName}
                  </div>
                  <div className="hidden text-sm lg:block" style={{ color: "#CBD5E1" }}>
                    {formatPrice(l.priceCents, l.currency)}
                  </div>
                  <div className="hidden text-sm lg:block" style={{ color: "#64748B" }}>
                    {formatDate(l.submittedAt)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
