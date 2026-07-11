import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { getPublicProduct } from "@/lib/stripe/storefront";
import { PRODUCT_KIND_LABELS } from "@/lib/stripe/schema";
import { BuyButton } from "@/components/learn/buy-button";

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );
}

/**
 * Oeffentliche Kaufseite (SPEC 4.1: `/kaufen/[productSlug]`) - erreichbar
 * auch ohne vorheriges Login (Produktinfo laedt ueber getPublicProduct(),
 * die per Admin-Client die tenant-scoped RLS-Grenze fuer anonyme Besucher
 * sicher umgeht, siehe src/lib/stripe/storefront.ts).
 *
 * Login-vor-Kauf (bewusste Vereinfachung/Abweichung, siehe PHASENSTATUS.md):
 * ohne Session zeigt diese Seite einen Login/Registrieren-Hinweis statt
 * direkt zu Stripe zu leiten - kein Account-Anlage-Schritt im Checkout-Flow
 * selbst.
 */
export default async function KaufenPage({
  params,
}: {
  params: Promise<{ productSlug: string }>;
}) {
  const { productSlug } = await params;
  const tenant = await getTenant();

  if (!tenant) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <p className="text-base">Kein Mandant zu diesem Host gefunden.</p>
      </main>
    );
  }

  const paymentsEnabled = tenant.settings.payments_enabled !== false;

  if (!paymentsEnabled) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--color-primary)" }}>
          {tenant.name}
        </h1>
        <p className="mt-4 text-base">Zahlungen sind für diese Akademie aktuell nicht verfügbar.</p>
      </main>
    );
  }

  const product = await getPublicProduct(tenant.id, productSlug);
  if (!product) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--color-primary)" }}>
          {tenant.name}
        </h1>
        <p className="mt-4 text-base">Dieses Produkt ist nicht verfügbar.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-12">
      <p className="text-sm text-gray-500">{tenant.name}</p>
      <h1 className="text-2xl font-semibold" style={{ color: "var(--color-primary)" }}>
        {product.title}
      </h1>
      <p className="text-base text-gray-700">{PRODUCT_KIND_LABELS[product.kind]}</p>
      <p className="text-3xl font-semibold">
        {formatPrice(product.priceCents, product.currency)}
        {product.kind === "subscription" && <span className="text-base font-normal"> / Monat</span>}
      </p>

      {user ? (
        <BuyButton productSlug={product.slug} />
      ) : (
        <div className="flex flex-col gap-3 rounded-md border p-4" style={{ borderRadius: "var(--radius)" }}>
          <p className="text-base">Bitte melde dich an, um dieses Produkt zu kaufen.</p>
          <div className="flex gap-3">
            <a
              href="/login"
              className="rounded-md px-4 py-2 text-base text-white"
              style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
            >
              Anmelden
            </a>
            <a
              href="/registrieren"
              className="rounded-md border px-4 py-2 text-base"
              style={{ borderRadius: "var(--radius)" }}
            >
              Registrieren
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
