import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { ProductForm } from "@/components/admin/product-form";
import { ProductActiveToggle } from "@/components/admin/product-active-toggle";
import { OrdersTable, type OrderRow } from "@/components/admin/orders-table";
import { PRODUCT_KIND_LABELS, type ProductKind } from "@/lib/stripe/schema";

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );
}

/**
 * Admin/Zahlungen (SPEC 4.2, Auftrag Punkt 9) - Server Component, Staff-Gate
 * aus admin/layout.tsx. Zeigt Produktliste (mit Neues-Produkt-Formular) UND
 * Bestellübersicht. `.eq("tenant_id", …)` überall explizit (Defense-in-Depth,
 * gleiches Muster wie im restlichen Admin-Bereich), obwohl RLS
 * `products_staff_all`/`orders_staff_select` bereits mandantenscharf greift.
 */
export default async function AdminZahlungenPage() {
  const tenant = await getTenant();
  const supabase = await createClient();

  const { data: products } = await supabase
    .from("products")
    .select("id, title, slug, kind, price_cents, currency, active, course_ids")
    .eq("tenant_id", tenant!.id)
    .order("title", { ascending: true });

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title")
    .eq("tenant_id", tenant!.id)
    .order("title", { ascending: true });

  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, status, amount_cents, currency, created_at, profiles(email, full_name), products(title)")
    .eq("tenant_id", tenant!.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const orders: OrderRow[] = (orderRows ?? []).map((o) => {
    const profile = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
    const product = Array.isArray(o.products) ? o.products[0] : o.products;
    return {
      id: o.id,
      status: o.status as OrderRow["status"],
      amountCents: o.amount_cents,
      currency: o.currency ?? "eur",
      createdAt: o.created_at,
      userEmail: profile?.email ?? null,
      userName: profile?.full_name ?? null,
      productTitle: product?.title ?? "Unbekanntes Produkt",
    };
  });

  const courseOptions = courses ?? [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold">Zahlungen</h1>
        <p className="text-sm text-gray-500">Produkte, Preise und Bestellungen dieses Mandanten.</p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Neues Produkt</h2>
        <ProductForm courses={courseOptions} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Produkte</h2>
        {(products ?? []).length === 0 && <p className="text-base text-gray-500">Noch keine Produkte angelegt.</p>}
        <ul className="flex flex-col gap-3">
          {(products ?? []).map((p) => (
            <li key={p.id} className="rounded-md border p-4" style={{ borderRadius: "var(--radius)" }}>
              <details>
                <summary className="flex cursor-pointer items-center justify-between gap-4">
                  <span>
                    <span className="font-medium">{p.title}</span>{" "}
                    <span className="text-sm text-gray-500">
                      ({PRODUCT_KIND_LABELS[p.kind as ProductKind]}, {formatPrice(p.price_cents, p.currency)})
                    </span>
                  </span>
                  <span
                    className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium"
                    style={{
                      borderRadius: "var(--radius)",
                      borderColor: p.active ? "#15803d" : "#9ca3af",
                      color: p.active ? "#15803d" : "#6b7280",
                    }}
                  >
                    {p.active ? "Aktiv" : "Deaktiviert"}
                  </span>
                </summary>
                <div className="mt-4 flex flex-col gap-4 border-t pt-4">
                  <ProductActiveToggle productId={p.id} active={p.active} />
                  <ProductForm
                    courses={courseOptions}
                    product={{
                      id: p.id,
                      title: p.title,
                      slug: p.slug,
                      kind: p.kind as ProductKind,
                      priceCents: p.price_cents,
                      active: p.active,
                      courseId: (p.course_ids ?? [])[0] ?? null,
                    }}
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Bestellungen</h2>
        <OrdersTable orders={orders} />
      </section>
    </div>
  );
}
