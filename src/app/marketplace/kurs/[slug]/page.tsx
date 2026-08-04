import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { getPublicListing } from "@/lib/marketplace/catalog";
import { createClient } from "@/lib/supabase/server";
import { MarketplaceBuyButton } from "@/components/marketplace/buy-button";

/**
 * Marketplace-Detailseite (Marketplace M4/M5, Plan Abschnitt 4/6/9).
 * Öffentlich, unauthentifiziert, lädt ausschließlich über `getPublicListing()`.
 *
 * M5 (Auftragstext Punkt 9, "Kaufbutton auf der Detailseite aktivieren"):
 * der bis M4 fest `disabled`e Button ist jetzt echt — bei `isFree` ruft er
 * `acquireFreeListing(slug)`, sonst `createMarketplaceCheckout(slug)`
 * (`MarketplaceBuyButton`, Client-Komponente). Ohne Session zeigt diese
 * Seite einen Login-Hinweis statt des Kaufbuttons (Login-Vorbild:
 * `kaufen/[productSlug]/page.tsx`/`components/learn/buy-button.tsx`) — mit
 * EINER bewussten Abweichung: kein "Registrieren"-Link. Grund (Abweichung
 * dokumentiert, CLAUDE.md §4/1, siehe PHASENSTATUS.md "Marketplace M5"):
 * `signUpWithPassword()` (`lib/auth/actions.ts`) verlangt zwingend
 * `getTenant()` — auf dem Marketplace-Host per Definition `null`, jeder
 * Registrierungsversuch würde mit "Kein Mandant zu diesem Host gefunden."
 * scheitern. Eine mandantenlose Selbstregistrierung ist eine eigene,
 * größere Änderung an einer von JEDEM Mandanten genutzten Kernfunktion —
 * außerhalb des Auftrags dieses Blocks ("Checkout und Webhook"). Stattdessen
 * ein Hinweis auf `office@calltalent.ai` für Interessenten ohne bestehendes
 * Konto. Login selbst funktioniert (`signInWithPassword()`/
 * `signInWithMagicLink()` sind bereits host-unabhängig) — neue Seite
 * `src/app/marketplace/login/page.tsx`, ebenfalls Teil dieses Blocks.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getPublicListing(slug);
  if (!listing) return {};
  return { title: listing.headline, description: listing.summary ?? undefined };
}

export default async function MarketplaceListingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [listing, t, format, supabase] = await Promise.all([
    getPublicListing(slug),
    getTranslations("marketplace.detail"),
    getFormatter(),
    createClient(),
  ]);
  if (!listing) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const priceLabel = listing.isFree
    ? t("free")
    : format.number(listing.priceCents / 100, { style: "currency", currency: listing.currency.toUpperCase() });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {listing.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
        <img
          src={listing.coverUrl}
          alt=""
          className="mb-8 aspect-video w-full rounded-2xl border border-border-100 object-cover"
        />
      ) : (
        <div className="mb-8 aspect-video w-full rounded-2xl border border-border-100 bg-bg" aria-hidden="true" />
      )}

      {listing.categoryName && (
        <p className="text-sm font-semibold uppercase tracking-[0.03em] text-muted-400">{listing.categoryName}</p>
      )}
      <h1 className="mt-1 text-[30px] font-extrabold leading-tight text-ink">{listing.headline}</h1>
      <p className="mt-2 text-base text-muted-500">{t("offeredBy", { seller: listing.sellerName })}</p>

      {listing.summary && <p className="mt-6 text-base leading-relaxed text-ink">{listing.summary}</p>}

      <dl className="mt-8 grid grid-cols-3 gap-4 rounded-2xl border border-border-100 bg-white p-6 text-center">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-400">{t("modulesLabel")}</dt>
          <dd className="mt-1 text-lg font-bold text-ink">{listing.moduleCount}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-400">{t("lessonsLabel")}</dt>
          <dd className="mt-1 text-lg font-bold text-ink">{listing.lessonCount}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-400">{t("durationLabel")}</dt>
          <dd className="mt-1 text-lg font-bold text-ink">
            {listing.totalMinutes > 0 ? t("minutesValue", { minutes: listing.totalMinutes }) : "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-border-100 bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-2xl font-extrabold text-ink">{priceLabel}</span>
        {user ? (
          <MarketplaceBuyButton slug={listing.slug} isFree={listing.isFree} />
        ) : (
          <div className="flex flex-col items-end gap-2">
            <p className="text-sm font-semibold text-muted-500">{t("loginRequired")}</p>
            <Link
              href={`/login?next=${encodeURIComponent(`/kurs/${listing.slug}`)}`}
              className="inline-flex items-center justify-center rounded-[10px] bg-accent px-6 py-3 text-sm font-bold text-white no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              {t("loginButton")}
            </Link>
          </div>
        )}
      </div>
      {!user && (
        <p className="mt-2 text-sm text-muted-400">{t("noAccountHint")}</p>
      )}

      {/* DSGVO-Transparenzhinweis (Plan Abschnitt 9). */}
      <p className="mt-8 text-xs text-muted-400">{t("dataTransferNotice", { seller: listing.sellerName })}</p>
    </div>
  );
}
