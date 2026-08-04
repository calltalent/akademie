import Link from "next/link";
import { getListingForReview } from "@/lib/platform/marketplace";
import { ReviewForm } from "./review-form";

/**
 * Prüfansicht eines einzelnen Listings (Marketplace M3, Plan Abschnitt 7).
 * Eine Seite für beide Betreiber-Aktionen (Freigeben/Ablehnen bei
 * `status='submitted'`, Sperren bei `status='approved'`) — `ReviewForm`
 * entscheidet anhand des Status, welche Aktionen es zeigt.
 *
 * Kein `notFound()` bei fehlendem Listing — gleiches Muster wie
 * `portal/mandanten/[id]/page.tsx` (dortiger Kommentar: `notFound()` bricht
 * unter dem OpenNext-Cloudflare-Adapter in einem RSC-Zwischenzustand nach
 * einer Server Action, die dieselbe Route neu rendert).
 */

const STATUS_LABELS: Record<string, string> = {
  draft: "Nicht eingereicht",
  submitted: "Wartet auf Prüfung",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  suspended: "Gesperrt",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatPrice(cents: number, currency: string): string {
  if (cents === 0) return "Kostenlos";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function formatCommission(bp: number): string {
  return `${(bp / 100).toString().replace(".", ",")} %`;
}

export default async function MarketplaceReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await getListingForReview(id);

  if (!listing) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-slate-50">Listing nicht gefunden</h1>
        <p className="mt-2 text-sm text-slate-400">
          Dieses Listing wurde nicht gefunden oder wurde bereits gelöscht.
        </p>
        <Link href="/portal/marketplace" className="mt-4 inline-block text-sm font-semibold text-indigo-400">
          Zurück zur Prüf-Warteschlange →
        </Link>
      </div>
    );
  }

  return (
    <main className="flex flex-col gap-6" style={{ maxWidth: 760 }}>
      <div>
        <Link href="/portal/marketplace" className="text-[13px] font-semibold no-underline" style={{ color: "#64748B" }}>
          Marketplace
        </Link>
        <span className="text-[13px] font-semibold" style={{ color: "#64748B" }}>
          {" "}
          / Prüfung
        </span>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-50" style={{ letterSpacing: "-0.01em" }}>
          {listing.headline || listing.courseTitle}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "#64748B" }}>
          {listing.tenantName} · {formatPrice(listing.priceCents, listing.currency)}
        </p>
      </div>

      <section className="rounded-[14px] border p-6" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
        <h2 className="text-[17px] font-bold text-slate-50">Kursdetails</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt style={{ color: "#64748B" }}>Kurs</dt>
            <dd className="text-slate-100">{listing.courseTitle}</dd>
          </div>
          <div>
            <dt style={{ color: "#64748B" }}>Module</dt>
            <dd className="text-slate-100">{listing.moduleCount}</dd>
          </div>
          <div>
            <dt style={{ color: "#64748B" }}>Lektionen</dt>
            <dd className="text-slate-100">{listing.lessonCount}</dd>
          </div>
          <div>
            <dt style={{ color: "#64748B" }}>Eingereicht am</dt>
            <dd className="text-slate-100">{formatDate(listing.submittedAt)}</dd>
          </div>
          <div>
            <dt style={{ color: "#64748B" }}>Provisionssatz</dt>
            <dd className="text-slate-100">{formatCommission(listing.commissionRateBp)}</dd>
          </div>
          <div>
            <dt style={{ color: "#64748B" }}>Status</dt>
            <dd className="text-slate-100">{STATUS_LABELS[listing.status] ?? listing.status}</dd>
          </div>
        </dl>
        {listing.summary && (
          <p className="mt-4 whitespace-pre-line text-sm" style={{ color: "#CBD5E1" }}>
            {listing.summary}
          </p>
        )}
        {listing.reviewNote && (listing.status === "rejected" || listing.status === "suspended") && (
          <p className="mt-4 text-sm" style={{ color: "#F87171" }}>
            <strong>Begründung:</strong> {listing.reviewNote}
          </p>
        )}
      </section>

      {listing.status === "submitted" || listing.status === "approved" ? (
        <ReviewForm listingId={listing.id} status={listing.status} />
      ) : (
        <p className="text-sm" style={{ color: "#64748B" }}>
          Dieses Listing wartet aktuell nicht auf eine Prüfung (Status: {STATUS_LABELS[listing.status] ?? listing.status}).
        </p>
      )}
    </main>
  );
}
