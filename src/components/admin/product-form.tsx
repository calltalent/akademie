"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createProduct, updateProduct, updateProductImageUrl } from "@/lib/stripe/products";
import { initialProductActionState } from "@/lib/stripe/state";
import { PRODUCT_KINDS, PRODUCT_KIND_LABELS, centsToEuroInputValue } from "@/lib/stripe/schema";
import { ThumbnailUpload } from "@/components/admin/thumbnail-upload";

type CourseOption = { id: string; title: string };

type EditableProduct = {
  id: string;
  title: string;
  slug: string;
  kind: "one_time" | "subscription";
  priceCents: number;
  active: boolean;
  courseId: string | null;
  description: string | null;
  imageUrl: string | null;
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
 *
 * Pflicht-Kursverknüpfung (Josips Auftrag 19.07.2026: "es darf keine andere
 * Option geben"): der bisherige "Kein Kurs"-Eintrag entfällt, `required`
 * erzwingt die Auswahl schon im Browser (zusätzlich serverseitig in
 * lib/stripe/schema.ts geprüft, nie nur clientseitig bei einer Pflichtangabe
 * für eine Kauf-relevante Verknüpfung). Ohne mindestens einen Kurs im
 * Mandanten ist ein neues Produkt gar nicht sinnvoll anlegbar — die
 * "Neues Produkt"-Karte zeigt dann statt des Formulars einen Hinweis mit
 * Link zu /admin/kurse, statt ein Formular zu zeigen, das man nie absenden
 * kann (kein UI-Dead-End, CLAUDE.md §3.2).
 *
 * Kaufseiten-Texte/-Bild (19.07.2026, Josips Auftrag "Unterseite Produkte"):
 * `description` ist ein normales Formularfeld (Teil von productFormSchema,
 * gilt für Neuanlage UND Bearbeiten). Das Bild dagegen nutzt dieselbe
 * `ThumbnailUpload`-Kachel wie Kurs-/Modulbilder — die braucht eine
 * bestehende Produkt-ID zum sofortigen Hochladen (kein Zwischenspeichern vor
 * dem ersten Speichern), erscheint deshalb NUR im Bearbeiten-Formular
 * (`product` gesetzt), nicht bei der Neuanlage — analog zum Kursbild, das
 * ebenfalls erst nach dem Anlegen des Kurses gesetzt werden kann.
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

  if (!isEdit && courses.length === 0) {
    return (
      <div className="text-sm" style={{ color: "#66679B" }}>
        <p className="mb-3">
          Ein Produkt muss mit einem bestehenden Kurs verknüpft werden — dieser Mandant hat
          noch keinen Kurs.
        </p>
        <Link
          href="/admin/kurse"
          className="inline-flex items-center justify-center gap-2 rounded-[11px] px-[18px] py-[13px] text-[15px] font-bold text-white no-underline"
          style={{ background: "#5663AE" }}
        >
          Zuerst einen Kurs anlegen
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col">
      {isEdit && (
        <div className="mb-4 flex items-center gap-3">
          <ThumbnailUpload
            initialUrl={product!.imageUrl}
            entityLabel="Kaufseiten-Bild"
            entityTitle={product!.title}
            onUpload={updateProductImageUrl.bind(null, product!.id)}
          />
          <span className={labelClass} style={{ color: "#66679B", marginBottom: 0 }}>
            Bild auf der Kaufseite
          </span>
        </div>
      )}

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

      <label htmlFor={`${idPrefix}-description`}>
        <span className={labelClass} style={{ color: "#66679B" }}>
          Beschreibung (auf der Kaufseite sichtbar, optional)
        </span>
        <textarea
          id={`${idPrefix}-description`}
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={product?.description ?? undefined}
          placeholder="Kurzer Text, der Kaufinteressenten auf /kaufen/… zeigt, was sie bekommen."
          className={`${fieldClass} mb-4 resize-y`}
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
          Verknüpfter Kurs
        </span>
        <select
          id={`${idPrefix}-course`}
          name="courseId"
          required
          defaultValue={product?.courseId ?? ""}
          className={`${fieldClass} mb-4 bg-white`}
          style={{ borderColor: "#E7E8F2", color: "#1A1A2E" }}
        >
          <option value="" disabled>
            Kurs auswählen
          </option>
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
