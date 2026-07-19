import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { ProductForm } from "@/components/admin/product-form";
import { ProductRow } from "@/components/admin/product-row";
import { OrdersTable, type OrderRow } from "@/components/admin/orders-table";

/** Für die KPI-Summen oben — bewusst fest auf EUR: die App rechnet in der Praxis ausschließlich in Euro, ein Aufsummieren über potenziell verschiedene Währungen hinweg wäre ohnehin falsch. */
function formatEuroCents(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

type DeltaTone = "up" | "down" | "neutral";

function deltaColor(tone: DeltaTone): string {
  return tone === "up" ? "#1F8A5B" : tone === "down" ? "#B24343" : "#A9AAC4";
}

/**
 * Design-Block (19.07.2026, Claude-Design-Import AdminZahlungen.dc.html aus
 * dem Design-Projekt „Calltalent-Akademie Studenten-Portal"). Ersetzt die
 * schlichte Phase-2-Ansicht (reine Listen ohne Kennzahlen/Kartenoptik) durch
 * das Marken-Layout: KPI-Reihe, zweispaltiges Grid (Produkte + Bestellungen
 * links, „Neues Produkt" rechts sticky).
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
 * Bewusste Abweichungen vom Export:
 * - Bestellungen-Kopfzeile zeigt „neueste zuerst" statt der im Export
 *   statischen „letzte 30 Tage" — die Tabelle zeigt tatsächlich die
 *   neuesten (bis zu 200) Bestellungen, nicht auf 30 Tage gefiltert; eine
 *   Beschriftung, die nicht zum echten Verhalten passt, wäre irreführend.
 * - Die „Zahlungsseite ansehen"-Symbole führen auf die echte, bereits
 *   bestehende Kaufseite `/kaufen/[productSlug]`, nicht auf einen
 *   Mockup-Platzhalter.
 * - Die bereits bestehende Bearbeiten-Funktion (aufklappbares Formular je
 *   Produkt, `ProductForm`/`ProductActiveToggle`) bleibt erhalten, obwohl
 *   der Export nur die Neuanlage zeigt — würde sonst eine vorhandene
 *   Funktion ersatzlos verschwinden. Seit demselben Folgeauftrag als
 *   eigenständiges Bearbeiten-Symbol (Stift) statt einer klickbaren
 *   Gesamtzeile, plus ein Löschen-Symbol (`ProductRow`,
 *   `deleteProduct()` in stripe/products.ts) — "die Kaufseite bearbeiten"
 *   ist dasselbe wie "das Produkt bearbeiten", da `/kaufen/[productSlug]`
 *   kein eigenes Inhaltsmodell hat, siehe Kommentar dort.
 * - Die Kopf-Avatar-Kachel des Exports ("AK") fällt weg, wie bei allen
 *   anderen bereits umgestellten Admin-Seiten (Kurse, Teilnehmer) — kein
 *   Vorbild dafür in diesem Bereich, rein dekorativ ohne echte Daten.
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
      productTitle: product?.title ?? "Unbekanntes Produkt",
      productSlug: product?.slug ?? null,
    };
  });

  const courseOptions = courses ?? [];
  const courseTitleById = new Map(courseOptions.map((c) => [c.id, c.title]));
  const allProducts = products ?? [];

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

  const activeProductCount = allProducts.filter((p) => p.active).length;

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
      label: "Gesamtumsatz",
      value: formatEuroCents(totalRevenueCents),
      delta: thisMonthRevenueCents > 0 ? `+${formatEuroCents(thisMonthRevenueCents)} diesen Monat` : "Kein Umsatz diesen Monat",
      tone: thisMonthRevenueCents > 0 ? "up" : "neutral",
    },
    {
      label: "Bestellungen",
      value: String(allOrders.length),
      delta: newOrdersThisWeek > 0 ? `+${newOrdersThisWeek} diese Woche` : "Keine neuen diese Woche",
      tone: newOrdersThisWeek > 0 ? "up" : "neutral",
    },
    {
      label: "Aktive Produkte",
      value: String(activeProductCount),
      delta: `von ${allProducts.length} gesamt`,
      tone: "neutral",
    },
    {
      label: "Ø Bestellwert",
      value: overallAvg !== null ? formatEuroCents(overallAvg) : "—",
      delta:
        thisMonthAvg !== null && lastMonthAvg !== null
          ? `${thisMonthAvg >= lastMonthAvg ? "+" : "−"}${formatEuroCents(Math.abs(thisMonthAvg - lastMonthAvg))} vs. Vormonat`
          : "Noch kein Vergleich möglich",
      tone:
        thisMonthAvg !== null && lastMonthAvg !== null ? (thisMonthAvg >= lastMonthAvg ? "up" : "down") : "neutral",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            Auswertung · Zahlungen
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            Zahlungen
          </h1>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-[22px] lg:grid-cols-4">
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

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        {/* Linke Spalte */}
        <div className="flex min-w-0 flex-col gap-6">
          {/* Produkte */}
          <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
            <div className="p-[24px_28px_16px]">
              <div className="text-[17px] font-bold">Produkte</div>
            </div>
            <div
              className="grid items-center gap-0 px-[28px] pb-2.5 text-[13px] font-bold"
              style={{ gridTemplateColumns: "2fr 1fr 1fr 0.8fr 1fr", color: "#A9AAC4", borderBottom: "1px solid #EEF0F7" }}
            >
              <div>Produkt</div>
              <div>Art</div>
              <div>Preis</div>
              <div>Status</div>
              <div className="text-right">{allProducts.length} gesamt</div>
            </div>
            {allProducts.length === 0 ? (
              <p className="px-[28px] py-6 text-sm" style={{ color: "#A9AAC4" }}>
                Noch keine Produkte angelegt.
              </p>
            ) : (
              allProducts.map((p) => {
                const courseId = (p.course_ids ?? [])[0] ?? null;
                const courseTitle = courseId ? (courseTitleById.get(courseId) ?? "Kurs nicht gefunden") : "Kein verknüpfter Kurs";
                return (
                  <ProductRow key={p.id} product={p} courseOptions={courseOptions} courseTitle={courseTitle} />
                );
              })
            )}
          </div>

          {/* Bestellungen */}
          <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
            <div className="p-[24px_28px_16px]">
              <div className="text-[17px] font-bold">Bestellungen</div>
            </div>
            <OrdersTable orders={orders} />
          </div>
        </div>

        {/* Rechte Spalte: Neues Produkt */}
        <div className="sticky top-4 self-start rounded-[14px] border bg-white p-[26px_28px]" style={{ borderColor: "#E7E8F2" }}>
          <div className="mb-5 text-[17px] font-bold">Neues Produkt</div>
          <ProductForm courses={courseOptions} />
        </div>
      </div>
    </div>
  );
}
