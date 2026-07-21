import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { ProductForm } from "@/components/admin/product-form";
import { ProductRow } from "@/components/admin/product-row";

/**
 * Produkte (Josips Auftrag 19.07.2026: "Unterseite für Produkte" unter
 * INHALTE). Übernimmt die Produkt-Verwaltung 1:1 aus der bisherigen
 * Zahlungen-Seite (Neuanlage, Bearbeiten, Löschen, Kurs-Verknüpfung,
 * Kaufseiten-Text/-Bild) — Zahlungen zeigt seitdem nur noch die
 * tatsächlich getätigten Zahlungen (siehe dortiger Kopfkommentar), keine
 * Produktverwaltung mehr.
 *
 * Gleiches Layout wie zuvor: Produktliste links, "Neues Produkt" rechts
 * sticky. Keine KPI-Reihe hier — die gehörte inhaltlich zu den Zahlungen
 * (Umsatz/Bestellungen), nicht zur Produktverwaltung selbst.
 */
export default async function AdminProdukePage() {
  const tenant = await getTenant();
  const supabase = await createClient();

  const [{ data: products }, { data: courses }] = await Promise.all([
    supabase
      .from("products")
      .select("id, title, slug, kind, price_cents, currency, active, course_ids, description, image_url")
      .eq("tenant_id", tenant!.id)
      .order("title", { ascending: true }),
    supabase
      .from("courses")
      .select("id, title")
      .eq("tenant_id", tenant!.id)
      .order("title", { ascending: true }),
  ]);

  const courseOptions = courses ?? [];
  const courseTitleById = new Map(courseOptions.map((c) => [c.id, c.title]));
  const allProducts = products ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            Inhalte · Produkte
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            Produkte
          </h1>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        {/* Linke Spalte: Produktliste */}
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
              return <ProductRow key={p.id} product={p} courseOptions={courseOptions} courseTitle={courseTitle} />;
            })
          )}
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
