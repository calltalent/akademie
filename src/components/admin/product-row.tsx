"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { deleteProduct } from "@/lib/stripe/products";
import { PRODUCT_KIND_LABELS, type ProductKind } from "@/lib/stripe/schema";
import { PayLinkIcon } from "@/components/admin/pay-link-icon";
import { ProductActiveToggle } from "@/components/admin/product-active-toggle";
import { ProductForm } from "@/components/admin/product-form";

type CourseOption = { id: string; title: string };

type Product = {
  id: string;
  title: string;
  slug: string;
  kind: string;
  price_cents: number;
  currency: string;
  active: boolean;
  course_ids: string[] | null;
  description: string | null;
  image_url: string | null;
};

/** Geteilt mit admin/produkte/page.tsx (Kopfzeile) — muss identisch bleiben, sonst laufen Spalten auseinander. */
export const PRODUCT_LIST_COLS = "2fr 1fr 1fr 0.8fr 1fr";

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );
}

/**
 * Eine Produktzeile in der Zahlungen-Übersicht (19.07.2026, Josips Auftrag:
 * "Löschen" + "Bearbeiten" je als eigenes Symbol statt der bisherigen
 * `<details>`-Klapzeile). "Bearbeitung der Kaufseite" aus demselben Auftrag
 * ist hier dasselbe Bearbeiten-Symbol: `/kaufen/[productSlug]` hat kein
 * eigenes Inhaltsmodell, sie wird komplett aus dieser `products`-Zeile
 * gerendert (Titel, Art, Preis, verknüpfter Kurs) — ihren Inhalt ändern
 * heißt zwangsläufig, dieses Produkt zu bearbeiten.
 *
 * Client-Komponente statt `<details>`: drei eigenständige Aktionen
 * (Ansehen/Bearbeiten/Löschen) nebeneinander lassen sich mit einem einzigen
 * `<summary>`-Klickbereich nicht sauber trennen (jeder Klick würde die
 * native Klapp-Logik mit auslösen) — gleiches Muster wie bereits
 * `teilnehmer-row-actions.tsx` in diesem Bereich.
 */
export function ProductRow({
  product: p,
  courseOptions,
  courseTitle,
}: {
  product: Product;
  courseOptions: CourseOption[];
  courseTitle: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (
      !confirm(
        `Produkt „${p.title}“ wirklich löschen? Bestehende Bestellungen bleiben erhalten (ohne Produktbezug), die Kaufseite ist danach nicht mehr erreichbar.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteProduct(p.id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div style={{ borderBottom: "1px solid #F4F5FA" }}>
      <div
        className="rgrid-row px-[18px] py-4 text-[15px] lg:px-[28px]"
        style={{ "--rgrid-cols": PRODUCT_LIST_COLS } as React.CSSProperties}
      >
        <div className="min-w-0">
          <div className="truncate font-semibold">{p.title}</div>
          <div className="mt-0.5 truncate text-[13px]" style={{ color: "#A9AAC4" }}>
            {courseTitle}
          </div>
        </div>
        <div>
          <span className="rgrid-label">Art</span>
          <span style={{ color: "#3E3F66" }}>{PRODUCT_KIND_LABELS[p.kind as ProductKind]}</span>
        </div>
        <div>
          <span className="rgrid-label">Preis</span>
          <span className="font-semibold">{formatPrice(p.price_cents, p.currency)}</span>
        </div>
        <div>
          <span
            className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
            style={p.active ? { color: "#1F8A5B", background: "#E3F2EA" } : { color: "#66679B", background: "#EEF0F7" }}
          >
            {p.active ? "Aktiv" : "Inaktiv"}
          </span>
        </div>
        <div className="flex items-center gap-2 lg:justify-end">
          <PayLinkIcon productSlug={p.slug} productTitle={p.title} />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`Produkt bearbeiten: ${p.title}`}
            title="Bearbeiten"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px]"
            style={{ background: expanded ? "#EDEEF7" : "#F4F5FA", color: "#5663AE" }}
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            aria-label={`Produkt löschen: ${p.title}`}
            title="Löschen"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] disabled:opacity-50"
            style={{ background: "#FBEAEA", color: "#B14A4A" }}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="px-[28px] pb-3 text-sm font-semibold" style={{ color: "#B24343" }}>
          {error}
        </p>
      )}

      {expanded && (
        <div className="flex flex-col gap-4 px-[28px] pb-6" style={{ borderTop: "1px solid #F4F5FA" }}>
          <div className="pt-4">
            <ProductActiveToggle productId={p.id} active={p.active} />
          </div>
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
              description: p.description,
              imageUrl: p.image_url,
            }}
          />
        </div>
      )}
    </div>
  );
}
