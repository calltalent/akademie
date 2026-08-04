import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { listPublicListings } from "@/lib/marketplace/catalog";

/**
 * Marketplace-Startseite/Katalog (Marketplace M4, Plan Abschnitt 4). Öffentlich,
 * unauthentifiziert — lädt ausschließlich über `listPublicListings()`
 * (`lib/marketplace/catalog.ts`), niemals direkt Supabase. Bewusst eine
 * reine Server Component ohne Client-JS: es gibt in M4 noch keine
 * Interaktion (Filter-Chips o. Ä. wie im tenant-scoped `kurskatalog-grid.tsx`
 * sind hier nicht Teil des Auftrags) — nur Grid + Link zur Detailseite,
 * schnellstmögliches LCP für eine öffentliche Marketing-Seite (CLAUDE.md §3.3).
 */
export default async function MarketplaceHomePage() {
  const [listings, t, format] = await Promise.all([
    listPublicListings(),
    getTranslations("marketplace.catalog"),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-10 max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-accent">{t("eyebrow")}</p>
        <h1 className="mt-1 text-[32px] font-extrabold leading-tight text-ink">{t("title")}</h1>
        <p className="mt-3 text-base text-muted-500">{t("subtitle")}</p>
      </div>

      {listings.length === 0 ? (
        <div className="rounded-2xl border border-border-100 bg-white px-6 py-10 text-center text-sm text-muted-400">
          {t("empty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <Link
              key={listing.slug}
              href={`/kurs/${listing.slug}`}
              className="flex flex-col overflow-hidden rounded-2xl border border-border-100 bg-white text-inherit no-underline shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              {listing.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
                <img src={listing.coverUrl} alt="" className="aspect-video w-full object-cover object-center" />
              ) : (
                <div className="aspect-video w-full bg-bg" aria-hidden="true" />
              )}
              <div className="flex flex-1 flex-col gap-2 p-5">
                {listing.categoryName && (
                  <span className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-400">
                    {listing.categoryName}
                  </span>
                )}
                <h2 className="text-[17px] font-bold leading-snug text-ink">{listing.headline}</h2>
                <p className="text-sm text-muted-500">{t("bySeller", { seller: listing.sellerName })}</p>
                <div className="mt-auto flex items-center justify-between pt-4">
                  <span className="text-base font-extrabold text-ink">
                    {listing.isFree
                      ? t("free")
                      : format.number(listing.priceCents / 100, {
                          style: "currency",
                          currency: listing.currency.toUpperCase(),
                        })}
                  </span>
                  <span className="text-sm font-semibold text-accent">{t("viewCourse")}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
