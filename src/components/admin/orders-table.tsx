import { PayLinkIcon } from "@/components/admin/pay-link-icon";

export type OrderRow = {
  id: string;
  status: "pending" | "paid" | "refunded" | "failed";
  amountCents: number | null;
  currency: string;
  createdAt: string;
  userEmail: string | null;
  userName: string | null;
  productTitle: string;
  /** Für den "Zahlungsseite ansehen"-Link — fehlt, wenn das verknüpfte Produkt inzwischen gelöscht wurde. */
  productSlug: string | null;
};

const STATUS_META: Record<OrderRow["status"], { label: string; color: string; bg: string }> = {
  paid: { label: "Bezahlt", color: "#1F8A5B", bg: "#E3F2EA" },
  pending: { label: "Offen", color: "#B98A1E", bg: "#FBF1DC" },
  refunded: { label: "Erstattet", color: "#B24343", bg: "#FBE7E7" },
  failed: { label: "Fehlgeschlagen", color: "#B24343", bg: "#FBE7E7" },
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
 * Bestellübersicht (Auftrag Punkt 11) — barrierefreie `<table>`-Struktur mit
 * `scope` auf jeder Kopfzelle (CLAUDE.md §3.4). Design-Update (19.07.2026,
 * AdminZahlungen.dc.html): echtes `<table>` statt der Grid-`<div>`s des
 * Exports beibehalten (Screenreader-Semantik), nur die Optik (Statusfarben,
 * Abstände, "Zahlungsseite ansehen"-Symbol) übernommen.
 *
 * Kopfzeile der letzten Spalte zeigt "neueste zuerst" statt der im Export
 * statischen "letzte 30 Tage" — die Liste ist tatsächlich nach Datum
 * absteigend sortiert (bis zu 200 Zeilen, siehe page.tsx), nicht auf 30 Tage
 * gefiltert; eine Beschriftung, die nicht zum echten Verhalten passt, wäre
 * irreführend.
 */
export function OrdersTable({ orders }: { orders: OrderRow[] }) {
  if (orders.length === 0) {
    return (
      <p className="px-[28px] py-6 text-sm" style={{ color: "#A9AAC4" }}>
        Noch keine Bestellungen.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[14px]">
        <caption className="sr-only">Bestellungen dieses Mandanten</caption>
        <thead>
          <tr style={{ borderBottom: "1px solid #EEF0F7" }}>
            <th scope="col" className="px-[28px] pb-2.5 text-[13px] font-bold" style={{ color: "#A9AAC4" }}>
              Datum
            </th>
            <th scope="col" className="px-3 pb-2.5 text-[13px] font-bold" style={{ color: "#A9AAC4" }}>
              Nutzer
            </th>
            <th scope="col" className="px-3 pb-2.5 text-[13px] font-bold" style={{ color: "#A9AAC4" }}>
              Produkt
            </th>
            <th scope="col" className="px-3 pb-2.5 text-[13px] font-bold" style={{ color: "#A9AAC4" }}>
              Status
            </th>
            <th scope="col" className="px-3 pb-2.5 text-right text-[13px] font-bold" style={{ color: "#A9AAC4" }}>
              Betrag
            </th>
            <th scope="col" className="px-[28px] pb-2.5 text-right text-[13px] font-bold whitespace-nowrap" style={{ color: "#A9AAC4" }}>
              neueste zuerst
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const meta = STATUS_META[o.status];
            return (
              <tr key={o.id} style={{ borderBottom: "1px solid #F4F5FA" }}>
                <td className="px-[28px] py-3.5" style={{ color: "#66679B" }}>
                  {formatDate(o.createdAt)}
                </td>
                <td className="px-3 py-3.5 font-semibold">{o.userName || o.userEmail || "Unbekannt"}</td>
                <td className="px-3 py-3.5" style={{ color: "#3E3F66" }}>
                  {o.productTitle}
                </td>
                <td className="px-3 py-3.5">
                  <span
                    className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
                    style={{ color: meta.color, background: meta.bg }}
                  >
                    {meta.label}
                  </span>
                </td>
                <td className="px-3 py-3.5 text-right font-bold">{formatAmount(o.amountCents, o.currency)}</td>
                <td className="px-[28px] py-3.5 text-right">
                  <PayLinkIcon productSlug={o.productSlug} productTitle={o.productTitle} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
