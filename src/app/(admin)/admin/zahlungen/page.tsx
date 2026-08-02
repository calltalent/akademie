import { getFormatter, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { OrdersTable, type OrderRow } from "@/components/admin/orders-table";

type DeltaTone = "up" | "down" | "neutral";

function deltaColor(tone: DeltaTone): string {
  return tone === "up" ? "#1F8A5B" : tone === "down" ? "#B24343" : "#A9AAC4";
}

/**
 * Design-Block (19.07.2026, Claude-Design-Import AdminZahlungen.dc.html aus
 * dem Design-Projekt „Calltalent-Akademie Studenten-Portal"). Ersetzt die
 * schlichte Phase-2-Ansicht (reine Listen ohne Kennzahlen/Kartenoptik) durch
 * das Marken-Layout: KPI-Reihe + Bestellungen-Tabelle.
 *
 * KPIs sind ECHT berechnet (DESIGN-MASTERPROMPT.md §8.1, kein erfundener
 * Zähler) — der Export zeigte hier Demo-Werte aus einem Script-Objekt:
 * - Gesamtumsatz/Ø Bestellwert nur aus `status = 'paid'`-Bestellungen.
 * - Die Vergleichswerte („+X diesen Monat", „vs. Vormonat") sind echte
 *   Monats-/Wochenvergleiche; fehlt eine Vergleichsbasis (z. B. neuer
 *   Mandant ohne Bestellungen im Vormonat), erscheint ein neutraler Hinweis
 *   statt einer erfundenen/grünen Zahl.
 * - Eine EIGENE, ungefilterte KPI-Abfrage (nur status/amount/created_at)
 *   ergänzt `orderRows` (bleibt bei 200 Zeilen gedeckelt, s. u.): sonst wären
 *   die Kennzahlen bei mehr als 200 Bestellungen falsch.
 *
 * FOLGEAUFTRAG (19.07.2026, Josip: "Unterseite Produkte" unter INHALTE):
 * die komplette Produktverwaltung (Neuanlage/Bearbeiten/Löschen/Kurs-
 * Verknüpfung, Kaufseiten-Text/-Bild) ist nach /admin/produkte umgezogen.
 * Diese Seite zeigt jetzt AUSSCHLIESSLICH getätigte Zahlungen — die KPI
 * „Aktive Produkte" ist deshalb entfallen (das ist eine Produktkennzahl,
 * keine Zahlungskennzahl), die KPI-Reihe hat jetzt 3 statt 4 Spalten. Die
 * `products`/`courses`-Abfragen für die Produktliste sind ebenfalls
 * entfallen — nur noch die Bestellungen bleiben.
 *
 * Bewusste Abweichungen vom Export:
 * - Bestellungen-Kopfzeile zeigt „neueste zuerst" statt der im Export
 *   statischen „letzte 30 Tage" — die Tabelle zeigt tatsächlich die
 *   neuesten (bis zu 200) Bestellungen, nicht auf 30 Tage gefiltert; eine
 *   Beschriftung, die nicht zum echten Verhalten passt, wäre irreführend.
 * - Die Kopf-Avatar-Kachel des Exports ("AK") fällt weg, wie bei allen
 *   anderen bereits umgestellten Admin-Seiten (Kurse, Teilnehmer) — kein
 *   Vorbild dafür in diesem Bereich, rein dekorativ ohne echte Daten.
 */
export default async function AdminZahlungenPage() {
  const t = await getTranslations("payments.admin");
  const format = await getFormatter();
  const tenant = await getTenant();
  const supabase = await createClient();

  /** Bewusst fest auf EUR: die App rechnet in der Praxis ausschließlich in Euro, ein Aufsummieren über potenziell verschiedene Währungen hinweg wäre ohnehin falsch. */
  function formatEuroCents(cents: number): string {
    return format.number(cents / 100, { style: "currency", currency: "EUR" });
  }

  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, status, amount_cents, currency, created_at, profiles(email, full_name), products(title, slug)")
    .eq("tenant_id", tenant!.id)
    .order("created_at", { ascending: false })
    .limit(200);

  // Eigene, ungefilterte Abfrage nur für die KPI-Summen oben (siehe Kopfkommentar).
  const { data: allOrdersForKpi } = await supabase
    .from("orders")
    .select("status, amount_cents, created_at")
    .eq("tenant_id", tenant!.id);

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
      productTitle: product?.title ?? t("unknownProduct"),
      productSlug: product?.slug ?? null,
    };
  });

  // --- KPIs ---
  const allOrders = allOrdersForKpi ?? [];
  const paidOrders = allOrders.filter((o) => o.status === "paid");

  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const totalRevenueCents = paidOrders.reduce((sum, o) => sum + (o.amount_cents ?? 0), 0);
  const thisMonthRevenueCents = paidOrders
    .filter((o) => new Date(o.created_at) >= startOfThisMonth)
    .reduce((sum, o) => sum + (o.amount_cents ?? 0), 0);

  const newOrdersThisWeek = allOrders.filter((o) => new Date(o.created_at) >= sevenDaysAgo).length;

  function averageCents(rows: typeof paidOrders): number | null {
    if (rows.length === 0) return null;
    return rows.reduce((sum, o) => sum + (o.amount_cents ?? 0), 0) / rows.length;
  }
  const overallAvg = averageCents(paidOrders);
  const thisMonthAvg = averageCents(paidOrders.filter((o) => new Date(o.created_at) >= startOfThisMonth));
  const lastMonthAvg = averageCents(
    paidOrders.filter(
      (o) => new Date(o.created_at) >= startOfLastMonth && new Date(o.created_at) < startOfThisMonth,
    ),
  );

  const kpis: { label: string; value: string; delta: string; tone: DeltaTone }[] = [
    {
      label: t("kpiRevenue"),
      value: formatEuroCents(totalRevenueCents),
      delta:
        thisMonthRevenueCents > 0
          ? t("kpiRevenueDeltaThisMonth", { amount: formatEuroCents(thisMonthRevenueCents) })
          : t("kpiRevenueDeltaNone"),
      tone: thisMonthRevenueCents > 0 ? "up" : "neutral",
    },
    {
      label: t("orders"),
      value: String(allOrders.length),
      delta: newOrdersThisWeek > 0 ? t("kpiOrdersDeltaThisWeek", { count: newOrdersThisWeek }) : t("kpiOrdersDeltaNone"),
      tone: newOrdersThisWeek > 0 ? "up" : "neutral",
    },
    {
      label: t("kpiAvgOrder"),
      value: overallAvg !== null ? formatEuroCents(overallAvg) : "—",
      delta:
        thisMonthAvg !== null && lastMonthAvg !== null
          ? thisMonthAvg >= lastMonthAvg
            ? t("kpiAvgDeltaUp", { amount: formatEuroCents(Math.abs(thisMonthAvg - lastMonthAvg)) })
            : t("kpiAvgDeltaDown", { amount: formatEuroCents(Math.abs(thisMonthAvg - lastMonthAvg)) })
          : t("kpiAvgDeltaNone"),
      tone:
        thisMonthAvg !== null && lastMonthAvg !== null ? (thisMonthAvg >= lastMonthAvg ? "up" : "down") : "neutral",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            {t("zahlungenEyebrow")}
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            {t("title")}
          </h1>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-[14px] border bg-white p-[22px_24px]" style={{ borderColor: "#E7E8F2" }}>
            <div className="mb-2.5 text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
              {k.label}
            </div>
            <div className="text-[30px] font-extrabold" style={{ color: "#1A1A2E", letterSpacing: "-0.01em" }}>
              {k.value}
            </div>
            <div className="mt-1.5 text-[13px] font-semibold" style={{ color: deltaColor(k.tone) }}>
              {k.delta}
            </div>
          </div>
        ))}
      </div>

      {/* Bestellungen */}
      <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
        <div className="p-[24px_28px_16px]">
          <div className="text-[17px] font-bold">{t("orders")}</div>
        </div>
        <OrdersTable orders={orders} />
      </div>
    </div>
  );
}
