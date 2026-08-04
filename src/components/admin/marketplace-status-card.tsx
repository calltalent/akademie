"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { MarketplaceListingStatus } from "@/lib/marketplace/schema";

type MarketplaceListingSummary = { status: MarketplaceListingStatus; reviewNote: string | null } | null;

const STATUS_STYLES: Record<MarketplaceListingStatus, CSSProperties> = {
  draft: { color: "#66679B", background: "#EEF0F7" },
  submitted: { color: "#8A6D1F", background: "#FBF1DC" },
  approved: { color: "#1F8A5B", background: "#E3F2EA" },
  rejected: { color: "#B24343", background: "#FBEAEA" },
  suspended: { color: "#66679B", background: "#EEF0F7" },
};

/**
 * Kompakte Statuskarte im "Veröffentlichen"-Schritt des Kurs-Editors (M2,
 * Plan "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt 6: "Marketplace:
 * nicht gelistet/eingereicht/freigegeben/abgelehnt (+ Begründung)"). Rein
 * informativ + Link zur eigentlichen Verwaltung — Anlegen/Bearbeiten/
 * Einreichen/Zurückziehen passiert ausschließlich unter /admin/marketplace
 * (ListingForm/ListingRow), damit es nur eine einzige Stelle mit der vollen
 * Formular-/Aktions-Logik gibt, statt sie hier zu duplizieren.
 */
export function MarketplaceStatusCard({ listing }: { listing: MarketplaceListingSummary }) {
  const t = useTranslations("admin.marketplace");

  return (
    <div
      className="flex flex-col gap-2 rounded-[12px] border p-5"
      style={{ borderColor: "#E7E8F2", background: "#FAFAFD" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[14.5px] font-bold" style={{ color: "#3E3F66" }}>
          {t("statusCardHeading")}
        </div>
        <span
          className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
          style={listing ? STATUS_STYLES[listing.status] : { color: "#66679B", background: "#EEF0F7" }}
        >
          {listing ? t(`status.${listing.status}`) : t("statusCardNotListed")}
        </span>
      </div>
      {listing?.status === "rejected" && listing.reviewNote && (
        <p className="text-[13px]" style={{ color: "#B24343" }}>
          <strong>{t("reviewNoteLabel")}:</strong> {listing.reviewNote}
        </p>
      )}
      <Link
        href="/admin/marketplace"
        className="self-start text-[13px] font-semibold underline"
        style={{ color: "#5663AE" }}
      >
        {listing ? t("statusCardLinkManage") : t("statusCardLinkCreate")}
      </Link>
    </div>
  );
}
