"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Pencil } from "lucide-react";
import { submitListing, withdrawListing, setListingEnabled } from "@/lib/marketplace/actions";
import type { MarketplaceListingStatus } from "@/lib/marketplace/schema";
import { ListingForm } from "./listing-form";

type Listing = {
  id: string;
  course_id: string;
  public_slug: string;
  headline: string | null;
  summary: string | null;
  cover_url: string | null;
  price_cents: number;
  currency: string;
  status: string;
  enabled: boolean;
  review_note: string | null;
};

/** Geteilt mit admin/marketplace/page.tsx (Kopfzeile) — muss identisch bleiben, sonst laufen Spalten auseinander. */
export const LISTING_LIST_COLS = "2fr 1fr 1fr 1fr 1fr";

const STATUS_STYLES: Record<MarketplaceListingStatus, CSSProperties> = {
  draft: { color: "#66679B", background: "#EEF0F7" },
  submitted: { color: "#8A6D1F", background: "#FBF1DC" },
  approved: { color: "#1F8A5B", background: "#E3F2EA" },
  rejected: { color: "#B24343", background: "#FBEAEA" },
  suspended: { color: "#66679B", background: "#EEF0F7" },
};

/**
 * Eine Listing-Zeile in der Marketplace-Übersicht (M2, Plan Abschnitt 6) —
 * gleiches Aufklapp-Muster wie ProductRow (components/admin/product-row.tsx):
 * Bearbeiten-Symbol klappt das Formular auf, Status-/Sichtbarkeits-Aktionen
 * daneben.
 *
 * Einreichen/Zurückziehen nur im jeweils passenden Status sichtbar (kein
 * UI-Dead-End: ein Button, der ohnehin immer fehlschlagen würde, wird gar
 * nicht erst gezeigt — die serverseitige Prüfung in actions.ts bleibt
 * trotzdem die verbindliche Instanz, das hier ist nur UX).
 *
 * Sichtbarkeits-Schalter (`enabled`) ist nur bei status='approved' aktiv
 * (Plan Abschnitt 6: "nur sinnvoll für status='approved'") — bei jedem
 * anderen Status ist das Listing ohnehin nie öffentlich sichtbar (der
 * spätere Katalog in M4 verlangt zusätzlich status='approved'), der
 * Schalter wäre dort wirkungslos und deshalb deaktiviert statt aktiv, aber
 * folgenlos.
 */
export function ListingRow({ listing: l, courseTitle }: { listing: Listing; courseTitle: string }) {
  const t = useTranslations("admin.marketplace");
  const format = useFormatter();
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function formatPrice(cents: number, currency: string): string {
    if (cents === 0) return t("free");
    return format.number(cents / 100, { style: "currency", currency: currency.toUpperCase() });
  }

  function runAction(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  }

  const status = l.status as MarketplaceListingStatus;
  const canEdit = status === "draft" || status === "rejected";

  return (
    <div style={{ borderBottom: "1px solid #F4F5FA" }}>
      <div
        className="rgrid-row px-[18px] py-4 text-[15px] lg:px-[28px]"
        style={{ "--rgrid-cols": LISTING_LIST_COLS } as CSSProperties}
      >
        <div className="min-w-0">
          <div className="truncate font-semibold">{l.headline || courseTitle}</div>
          <div className="mt-0.5 truncate text-[13px]" style={{ color: "#A9AAC4" }}>
            {courseTitle}
          </div>
        </div>
        <div>
          <span className="rgrid-label">{t("priceColumn")}</span>
          <span className="font-semibold">{formatPrice(l.price_cents, l.currency)}</span>
        </div>
        <div>
          <span className="rgrid-label">{t("statusColumn")}</span>
          <span
            className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
            style={STATUS_STYLES[status] ?? STATUS_STYLES.draft}
          >
            {t(`status.${status}`)}
          </span>
        </div>
        <div>
          <span className="rgrid-label">{t("visibleColumn")}</span>
          <button
            type="button"
            onClick={() => runAction(() => setListingEnabled(l.id, !l.enabled))}
            disabled={pending || status !== "approved"}
            title={status !== "approved" ? t("visibleOnlyWhenApproved") : undefined}
            className="text-[13px] font-semibold underline disabled:no-underline disabled:opacity-50"
            style={{ color: "#5663AE" }}
          >
            {l.enabled ? t("enabledLabel") : t("disabledLabel")}
          </button>
        </div>
        <div className="flex items-center gap-2 lg:justify-end">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={t("editAria", { title: l.headline || courseTitle })}
            title={t("editButtonTitle")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px]"
            style={{ background: expanded ? "#EDEEF7" : "#F4F5FA", color: "#5663AE" }}
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="px-[28px] pb-3 text-sm font-semibold" style={{ color: "#B24343" }}>
          {error}
        </p>
      )}

      {status === "rejected" && l.review_note && (
        <p className="px-[28px] pb-3 text-sm" style={{ color: "#B24343" }}>
          <strong>{t("reviewNoteLabel")}:</strong> {l.review_note}
        </p>
      )}

      {expanded && (
        <div className="flex flex-col gap-4 px-[28px] pb-6" style={{ borderTop: "1px solid #F4F5FA" }}>
          <div className="flex flex-wrap gap-2 pt-4">
            {canEdit && (
              <button
                type="button"
                onClick={() => runAction(() => submitListing(l.id))}
                disabled={pending}
                className="rounded-[9px] border px-3.5 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
              >
                {pending ? t("submitPending") : t("submitAction")}
              </button>
            )}
            {status === "submitted" && (
              <button
                type="button"
                onClick={() => runAction(() => withdrawListing(l.id))}
                disabled={pending}
                className="rounded-[9px] border px-3.5 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
              >
                {pending ? t("withdrawPending") : t("withdrawAction")}
              </button>
            )}
          </div>

          {canEdit ? (
            <ListingForm
              courses={[]}
              listing={{
                id: l.id,
                headline: l.headline,
                summary: l.summary,
                coverUrl: l.cover_url,
                priceCents: l.price_cents,
                courseId: l.course_id,
                courseTitle,
              }}
            />
          ) : (
            <p className="text-sm" style={{ color: "#66679B" }}>
              {t("editLockedHint")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
