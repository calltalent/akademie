"use client";

import { useActionState } from "react";
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

/**
 * Formular fuer Produktanlage/-bearbeitung (Auftrag Punkt 10). Ein Formular
 * fuer beide Faelle - `product` gesetzt bindet `updateProduct(product.id,
 * …)`, sonst `createProduct` direkt. Gleiches useActionState-Muster wie
 * src/components/admin/create-course-form.tsx / quiz-editor.tsx.
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
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-md border p-4"
      style={{ borderRadius: "var(--radius)" }}
    >
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${idPrefix}-title`}>
        Titel
        <input
          id={`${idPrefix}-title`}
          name="title"
          type="text"
          required
          defaultValue={product?.title}
          className="rounded-md border px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm" htmlFor={`${idPrefix}-slug`}>
        Slug (URL, z. B. einsteiger-kurs)
        <input
          id={`${idPrefix}-slug`}
          name="slug"
          type="text"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          defaultValue={product?.slug}
          className="rounded-md border px-3 py-2 text-base"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Art</legend>
        {PRODUCT_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-2 text-base" htmlFor={`${idPrefix}-kind-${k}`}>
            <input
              id={`${idPrefix}-kind-${k}`}
              type="radio"
              name="kind"
              value={k}
              defaultChecked={(product?.kind ?? "one_time") === k}
            />
            {PRODUCT_KIND_LABELS[k]}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm" htmlFor={`${idPrefix}-price`}>
        Preis in Euro
        <input
          id={`${idPrefix}-price`}
          name="priceEuro"
          type="text"
          inputMode="decimal"
          required
          defaultValue={product ? centsToEuroInputValue(product.priceCents) : undefined}
          placeholder="9,90"
          className="rounded-md border px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm" htmlFor={`${idPrefix}-course`}>
        Verknüpfter Kurs (optional)
        <select
          id={`${idPrefix}-course`}
          name="courseId"
          defaultValue={product?.courseId ?? ""}
          className="rounded-md border px-3 py-2 text-base"
        >
          <option value="">Kein Kurs</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-base" htmlFor={`${idPrefix}-active`}>
        <input id={`${idPrefix}-active`} name="active" type="checkbox" defaultChecked={product?.active ?? true} />
        Aktiv (im Shop sichtbar)
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && !state.error && (
        <p role="status" aria-live="polite" className="text-sm text-green-700">
          Gespeichert.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
        style={{ background: "var(--color-primary)" }}
      >
        {pending ? "Speichert …" : isEdit ? "Änderungen speichern" : "Produkt anlegen"}
      </button>
    </form>
  );
}
