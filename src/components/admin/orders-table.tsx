export type OrderRow = {
  id: string;
  status: "pending" | "paid" | "refunded" | "failed";
  amountCents: number | null;
  currency: string;
  createdAt: string;
  userEmail: string | null;
  userName: string | null;
  productTitle: string;
};

const STATUS_LABELS: Record<OrderRow["status"], string> = {
  pending: "Ausstehend",
  paid: "Bezahlt",
  refunded: "Erstattet",
  failed: "Fehlgeschlagen",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

function formatAmount(cents: number | null, currency: string): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );
}

/**
 * Bestellübersicht (Auftrag Punkt 11) - barrierefreie `<table>`-Struktur mit
 * `scope` auf jeder Kopfzelle (CLAUDE.md §3.4: Barrierefreiheit bei jeder
 * Komponente).
 */
export function OrdersTable({ orders }: { orders: OrderRow[] }) {
  if (orders.length === 0) {
    return <p className="text-base text-gray-500">Noch keine Bestellungen.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Bestellungen dieses Mandanten</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="px-3 py-2 font-medium">
              Datum
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Nutzer
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Produkt
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Betrag
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b">
              <td className="px-3 py-2">{formatDate(o.createdAt)}</td>
              <td className="px-3 py-2">{o.userName || o.userEmail || "Unbekannt"}</td>
              <td className="px-3 py-2">{o.productTitle}</td>
              <td className="px-3 py-2">{STATUS_LABELS[o.status]}</td>
              <td className="px-3 py-2">{formatAmount(o.amountCents, o.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
