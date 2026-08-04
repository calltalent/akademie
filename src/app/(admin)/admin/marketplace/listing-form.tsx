"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { createListing, updateListing } from "@/lib/marketplace/actions";
import { initialMarketplaceListingActionState } from "@/lib/marketplace/state";
import { centsToEuroInputValue } from "@/lib/marketplace/schema";

type CourseOption = { id: string; title: string };

type EditableListing = {
  id: string;
  headline: string | null;
  summary: string | null;
  coverUrl: string | null;
  priceCents: number;
  courseId: string;
  courseTitle: string;
};

const fieldClass = "w-full rounded-[10px] border px-[13px] py-[11px] text-sm";
const labelClass = "mb-1.5 block text-[13px] font-semibold";

/**
 * Formular für Listing-Anlage/-Bearbeitung (Marketplace M2, Plan Abschnitt 6)
 * — ein Formular für beide Fälle, gleiches Muster wie ProductForm
 * (components/admin/product-form.tsx): `listing` gesetzt bindet
 * `updateListing(listing.id, …)`, sonst `createListing` direkt.
 *
 * Kurs-Auswahl NUR bei Neuanlage editierbar (`<select>`, Pflichtfeld) — beim
 * Bearbeiten ist die Zuordnung fix (siehe updateListing()-Kommentar in
 * lib/marketplace/actions.ts, `unique(course_id)` in der DB). Das Formular
 * sendet die vorhandene courseId trotzdem über ein verstecktes Feld mit
 * (nötig, weil `listingFormSchema` `courseId` als Pflichtfeld definiert,
 * damit dieselbe Schema-Validierung für beide Fälle greift), zeigt den
 * Kursnamen selbst aber nur noch als reinen Text — kein editierbares
 * `<select>` für einen Wert, der ohnehin nicht änderbar ist.
 *
 * Kein Kurs ohne Listing verfügbar -> gleicher "kein UI-Dead-End"-Hinweis
 * wie ProductForm bei fehlenden Kursen, hier mit Link zurück zu den Kursen.
 */
export function ListingForm({
  courses,
  listing,
}: {
  courses: CourseOption[];
  listing?: EditableListing;
}) {
  const t = useTranslations("admin.marketplace");
  const tCommon = useTranslations("admin.common");
  const isEdit = Boolean(listing);
  const action = isEdit ? updateListing.bind(null, listing!.id) : createListing;
  const [state, formAction, pending] = useActionState(action, initialMarketplaceListingActionState);
  const idPrefix = listing?.id ?? "new";

  if (!isEdit && courses.length === 0) {
    return (
      <div className="text-sm" style={{ color: "#66679B" }}>
        <p className="mb-3">{t("noCoursesAvailable")}</p>
        <Link
          href="/admin/kurse"
          className="inline-flex items-center justify-center gap-2 rounded-[11px] px-[18px] py-[13px] text-[15px] font-bold text-white no-underline"
          style={{ background: "#5663AE" }}
        >
          {t("createCourseFirstLink")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col">
      {isEdit ? (
        <div className="mb-4">
          <span className={labelClass} style={{ color: "#66679B" }}>
            {t("courseLabel")}
          </span>
          <p className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
            {listing!.courseTitle}
          </p>
          <input type="hidden" name="courseId" value={listing!.courseId} />
        </div>
      ) : (
        <label htmlFor={`${idPrefix}-course`}>
          <span className={labelClass} style={{ color: "#66679B" }}>
            {t("courseLabel")}
          </span>
          <select
            id={`${idPrefix}-course`}
            name="courseId"
            required
            defaultValue=""
            className={`${fieldClass} mb-4 bg-white`}
            style={{ borderColor: "#E7E8F2", color: "#1A1A2E" }}
          >
            <option value="" disabled>
              {t("selectCoursePlaceholder")}
            </option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      )}

      <label htmlFor={`${idPrefix}-headline`}>
        <span className={labelClass} style={{ color: "#66679B" }}>
          {t("headlineLabel")}
        </span>
        <input
          id={`${idPrefix}-headline`}
          name="headline"
          type="text"
          maxLength={200}
          defaultValue={listing?.headline ?? undefined}
          placeholder={t("headlinePlaceholder")}
          className={`${fieldClass} mb-4`}
          style={{ borderColor: "#E7E8F2", color: "#1A1A2E" }}
        />
      </label>

      <label htmlFor={`${idPrefix}-summary`}>
        <span className={labelClass} style={{ color: "#66679B" }}>
          {t("summaryLabel")}
        </span>
        <textarea
          id={`${idPrefix}-summary`}
          name="summary"
          rows={4}
          maxLength={2000}
          defaultValue={listing?.summary ?? undefined}
          placeholder={t("summaryPlaceholder")}
          className={`${fieldClass} mb-4 resize-y`}
          style={{ borderColor: "#E7E8F2", color: "#1A1A2E" }}
        />
      </label>

      <label htmlFor={`${idPrefix}-cover`}>
        <span className={labelClass} style={{ color: "#66679B" }}>
          {t("coverUrlLabel")}
        </span>
        <input
          id={`${idPrefix}-cover`}
          name="coverUrl"
          type="url"
          defaultValue={listing?.coverUrl ?? undefined}
          className={`${fieldClass} mb-4`}
          style={{ borderColor: "#E7E8F2", color: "#1A1A2E" }}
        />
      </label>

      <label htmlFor={`${idPrefix}-price`}>
        <span className={labelClass} style={{ color: "#66679B" }}>
          {t("priceLabel")}
        </span>
        <input
          id={`${idPrefix}-price`}
          name="priceEuro"
          type="text"
          inputMode="decimal"
          required
          defaultValue={listing ? centsToEuroInputValue(listing.priceCents) : "0"}
          placeholder={t("pricePlaceholder")}
          className={`${fieldClass} mb-5`}
          style={{ borderColor: "#E7E8F2", color: "#1A1A2E" }}
        />
      </label>

      {state.error && (
        <p role="alert" className="mb-3 text-sm font-semibold" style={{ color: "#B24343" }}>
          {state.error}
        </p>
      )}
      {state.success && !state.error && (
        <p role="status" aria-live="polite" className="mb-3 text-sm font-semibold" style={{ color: "#1F8A5B" }}>
          {t("saved")}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex items-center justify-center gap-2 rounded-[11px] px-[18px] py-[13px] text-[15px] font-bold text-white disabled:opacity-50"
        style={{ background: "#5663AE" }}
      >
        {!isEdit && <Plus size={16} aria-hidden="true" />}
        {pending ? tCommon("saving") : isEdit ? t("save") : t("create")}
      </button>
    </form>
  );
}
