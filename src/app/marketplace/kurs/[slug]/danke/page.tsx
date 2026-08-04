import { notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getListingSellerLink } from "@/lib/marketplace/catalog";
import { buildTenantUrl } from "@/lib/tenant/url";

/**
 * Marketplace-Dankeseite (M5, Plan Abschnitt 5 + 8) — Ziel des
 * Gratis-Erwerbs (`acquire.ts`) UND der `success_url` des bezahlten Kaufs
 * (`checkout.ts`). Zeigt Bestätigung + Button "Zum Kurs".
 *
 * `buildTenantUrl(seller, "/kurs/" + courseSlug)` zeigt bewusst auf die
 * VERKÄUFER-Domain, NICHT auf eine Marketplace-URL (Plan Abschnitt 5.5):
 * KEINE Session-Übertragung zwischen Marketplace- und Mandanten-Domain
 * (Supabase-Auth-Cookies sind domain-gebunden, bei Custom Domains ohnehin
 * unmöglich) — fehlt dort die Session, greift der normale Login mit
 * denselben Zugangsdaten.
 *
 * Datenbeschaffung (Design-Entscheidung, siehe Kopfkommentar
 * `getListingSellerLink()` in `marketplace/catalog.ts`): eigene, gezielte
 * Funktion statt einer Erweiterung von `PublicListing` — hält den
 * Blast-Radius auf genau diese Seite begrenzt.
 */
export default async function MarketplaceThankYouPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [seller, t] = await Promise.all([
    getListingSellerLink(slug),
    getTranslations("marketplace.thankYou"),
  ]);
  if (!seller) notFound();

  const courseUrl = buildTenantUrl(
    { slug: seller.sellerSlug, custom_domain: seller.sellerCustomDomain },
    `/kurs/${seller.courseSlug}`,
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-16 text-center">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10"
        aria-hidden="true"
      >
        <CheckCircle2 size={28} className="text-accent" strokeWidth={2.2} />
      </span>
      <h1 className="text-2xl font-extrabold text-ink">{t("heading")}</h1>
      <p className="text-base text-muted-500">{t("body", { course: seller.courseTitle })}</p>
      <Link
        href={courseUrl}
        className="mt-2 inline-flex items-center justify-center rounded-[10px] bg-accent px-6 py-3 text-sm font-bold text-white no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        {t("goToCourse")}
      </Link>
      <p className="mt-4 text-xs text-muted-400">{t("loginHint")}</p>
    </div>
  );
}
