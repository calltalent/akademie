"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { createProduct, updateProduct } from "@/lib/stripe/products";
import { initialProductActionState } from "@/lib/stripe/state";
import { PRODUCT_KINDS, PRODUCT_KIND_LABELS, centsToEuroInputValue } from "@/lib/stripe/schema";

type CourseOption = { id: string; title: string };

type EditableProduct = {
  id: string;
  title: string;
  slug: string;
  kind: "one_time" | "subscription";
  priceCents: number;
  active: boolean;
  courseId: string | null;
};

const fieldClass = "w-full rounded-[10px] border px-[13px] py-[11px] text-sm";
const labelClass = "mb-1.5 block text-[13px] font-semibold";

/**
 * Formular fuer Produktanlage/-bearbeitung (Auftrag Punkt 10). Ein Formular
 * fuer beide Faelle - `product` gesetzt bindet `updateProduct(product.id,
 * …)`, sonst `createProduct` direkt. Gleiches useActionState-Muster wie
 * src/components/admin/create-course-form.tsx / quiz-editor.tsx.
 *
 * Design-Update (19.07.2026, AdminZahlungen.dc.html): Felder/Verhalten
 * unverändert, nur an das Marken-Farbschema angeglichen (Rahmen #E7E8F2,
 * Beschriftungen #66679B, Akzent #5663AE) — dient jetzt sowohl der
 * "Neues Produkt"-Karte als auch dem aufklappbaren Bearbeiten je Produkt.
 */
export function ProductForm({
  courses,
  product,
}: {
  courses: CourseOption[];
  product?: EditableProduct;
}) {
  const isEdit = Boolean(product);
  const action = isEdit ? updateProduct.bind(null, product!.id) : createProduct;
  const [state, formAction, pending] = useActionState(action, initialProductActionState);
  const idPrefix = product?.id ?? "new";

  return (
    <form action={formAction} className="flex flex-col">
      <label htmlFor={`${idPrefix}-title`}>
        <span className={labelClass} style={{ color: "#66679B" }}>
          Titel
        </span>
        <input
          id={`${idPrefix}-title`}
          name="title"
          type="text"
          required
          defaultValue={product?.title}
          className={`${fieldClass} mb-4`}
          style={{ borderColor: "#E7E8F2", color: "#1A1A2E" }}
        />
      </label>

      <label htmlFor={`${idPrefix}-slug`}>
        <span className={labelClass} style={{ color: "#66679B" }}>
          Slug (URL, z. B. einsteiger-kurs)
        </span>
        <input
          id={`${idPrefix}-slug`}
          name="slug"
          type="text"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          defaultValue={product?.slug}
          className={`${fieldClass} mb-4`}
          style={{ borderColor: "#E7E8F2", color: "#1A1A2E" }}
        />
      </label>

      <fieldset className="mb-4 flex flex-col gap-2.5">
        <legend className="mb-1.5 text-[13px] font-semibold" style={{ color: "#66679B" }}>
          Art
        </legend>
        {PRODUCT_KINDS.map((k) => (
          <label
            key={k}
            className="flex cursor-pointer items-center gap-2.5 text-sm"
            htmlFor={`${idPrefix}-kind-${k}`}
          >
            <input
              id={`${idPrefix}-kind-${k}`}
              type="radio"
              name="kind"
              value={k}
              defaultChecked={(product?.kind ?? "one_time") === k}
              style={{ accentColor: "#5663AE" }}
            />
            {PRODUCT_KIND_LABELS[k]}
          </label>
        ))}
      </fieldset>

      <label htmlFor={`${idPrefix}-price`}>
        <span className={labelClass} style={{ color: "#66679B" }}>
          Preis in Euro
        </span>
        <input
          id={`${idPrefix}-price`}
          name="priceEuro"
          type="text"
          inputMode="decimal"
          required
          defaultValue={product ? centsToEuroInputValue(product.priceCents) : undefined}
          placeholder="9,90"
          className={`${fieldClass} mb-4`}
          style={{ borderColor: "#E7E8F2", color: "#1A1A2E" }}
        />
      </label>

      <label htmlFor={`${idPrefix}-course`}>
        <span className={labelClass} style={{ color: "#66679B" }}>
          Verknüpfter Kurs (optional)
        </span>
        <select
          id={`${idPrefix}-course`}
          name="courseId"
          defaultValue={product?.courseId ?? ""}
          className={`${fieldClass} mb-4 bg-white`}
          style={{ borderColor: "#E7E8F2", color: "#1A1A2E" }}
        >
          <option value="">Kein Kurs</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-5 flex cursor-pointer items-center gap-2.5 text-sm" htmlFor={`${idPrefix}-active`}>
        <input
          id={`${idPrefix}-active`}
          name="active"
          type="checkbox"
          defaultChecked={product?.active ?? true}
          style={{ accentColor: "#5663AE" }}
        />
        Aktiv (im Shop sichtbar)
      </label>

      {state.error && (
        <p role="alert" className="mb-3 text-sm font-semibold" style={{ color: "#B24343" }}>
          {state.error}
        </p>
      )}
      {state.success && !state.error && (
        <p role="status" aria-live="polite" className="mb-3 text-sm font-semibold" style={{ color: "#1F8A5B" }}>
          Gespeichert.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex items-center justify-center gap-2 rounded-[11px] px-[18px] py-[13px] text-[15px] font-bold text-white disabled:opacity-50"
        style={{ background: "#5663AE" }}
      >
        {!isEdit && <Plus size={16} aria-hidden="true" />}
        {pending ? "Speichert …" : isEdit ? "Änderungen speichern" : "Produkt anlegen"}
      </button>
    </form>
  );
}
