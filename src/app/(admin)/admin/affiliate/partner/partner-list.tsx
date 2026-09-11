"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AffiliatePartnerStatus } from "@/lib/affiliate/types";
import {
  CARD_BORDER,
  CARD_CLASS,
  FOCUS_RING,
  HAIRLINE,
  INK,
  MUTED,
  NAVY,
  PARTNER_STATUS_STYLE,
} from "../affiliate-format";

/**
 * Affiliate-System, Block B6-B — die Partnerliste mit clientseitigem Filter
 * (PLAN_Affiliate-System.md 8.1, Zeile 2; 8.5).
 *
 * Alle Zahlen kommen FERTIG FORMATIERT aus der Server Component. Diese Datei
 * rechnet nichts und formatiert keinen Geldbetrag — sonst gäbe es zwei Orte,
 * an denen eine Provision zu einer Zeichenkette wird, und zwei Orte können
 * sich unterscheiden.
 *
 * Barrierefreiheit:
 *   - `<input type="search">` mit sichtbarem Label (kein Platzhalter als
 *     Ersatz für ein Label) und `aria-controls` auf die Liste.
 *   - Die Trefferzahl steht in einer `role="status" aria-live="polite"`-Zeile:
 *     ohne sie ändert sich beim Tippen lautlos die Liste, und ein
 *     Screenreader-Nutzer erfährt nicht, dass sie leer geworden ist.
 *   - Jede Zelle mit bloßer Zahl trägt ein `rgrid-label` (unter 1024 px
 *     stapelt die Zeile zur Karte und die Spaltenüberschrift fehlt).
 *   - Der Status steht als Wort im Chip; die Farbe wiederholt ihn nur.
 */

export type PartnerListRow = {
  id: string;
  displayName: string;
  email: string;
  code: string;
  groupName: string | null;
  status: AffiliatePartnerStatus;
  payoutHold: boolean;
  clicksText: string;
  ordersText: string;
  availableText: string;
};

const COLS = "1.6fr 0.9fr 0.9fr 1fr 0.7fr 0.7fr 1.1fr";

export function PartnerList({ rows }: { rows: PartnerListRow[] }) {
  const t = useTranslations("admin.affiliate");
  const [query, setQuery] = useState("");
  const searchId = useId();
  const listId = useId();

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter(
        (row) =>
          row.displayName.toLowerCase().includes(needle) ||
          row.email.toLowerCase().includes(needle) ||
          row.code.toLowerCase().includes(needle),
      )
    : rows;

  return (
    <section
      aria-labelledby="affiliate-partner-list-heading"
      className="flex flex-col gap-4"
    >
      <div
        className={`${CARD_CLASS} p-[20px_24px]`}
        style={{ borderColor: CARD_BORDER }}
      >
        <h2
          id="affiliate-partner-list-heading"
          className="text-[17px] font-bold"
          style={{ color: INK }}
        >
          {t("partners.title")}
        </h2>
        <label
          htmlFor={searchId}
          className="mb-1.5 mt-3 block text-[13px] font-semibold"
          style={{ color: MUTED }}
        >
          {t("partners.searchLabel")}
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("partners.searchPlaceholder")}
          aria-controls={listId}
          className={`w-full min-h-[40px] rounded-[10px] border px-[13px] py-[11px] text-[15px] ${FOCUS_RING}`}
          style={{ borderColor: CARD_BORDER, color: INK }}
        />
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-[15px]"
          style={{ color: MUTED }}
        >
          {t("partners.countSuffix", { count: visible.length })}
        </p>
      </div>

      <div
        id={listId}
        className={`${CARD_CLASS} overflow-hidden`}
        style={{ borderColor: CARD_BORDER }}
      >
        <div
          className="rgrid-header px-[24px] pb-2.5 pt-[20px] text-[13px] font-bold"
          style={
            {
              "--rgrid-cols": COLS,
              color: MUTED,
              borderBottom: `1px solid ${HAIRLINE}`,
            } as React.CSSProperties
          }
        >
          <div>{t("partners.columnName")}</div>
          <div>{t("partners.columnCode")}</div>
          <div>{t("partners.columnGroup")}</div>
          <div>{t("partners.columnStatus")}</div>
          <div>{t("partners.columnClicks")}</div>
          <div>{t("partners.columnSales")}</div>
          <div>{t("partners.columnAvailable")}</div>
        </div>

        {visible.length === 0 ? (
          <p className="px-[24px] py-6 text-[15px]" style={{ color: MUTED }}>
            {t("partners.empty")}
          </p>
        ) : (
          visible.map((row) => (
            <div
              key={row.id}
              className="rgrid-row px-[18px] py-4 text-[15px] lg:px-[24px]"
              style={
                {
                  "--rgrid-cols": COLS,
                  borderBottom: `1px solid ${HAIRLINE}`,
                } as React.CSSProperties
              }
            >
              <div className="min-w-0">
                <Link
                  href={`/admin/affiliate/partner/${row.id}`}
                  prefetch={false}
                  className={`block font-semibold underline ${FOCUS_RING}`}
                  style={{ color: NAVY }}
                >
                  {row.displayName}
                </Link>
                <span
                  className="block truncate text-[13px]"
                  style={{ color: MUTED }}
                >
                  {row.email}
                </span>
              </div>
              <div>
                <span className="rgrid-label">{t("partners.columnCode")}</span>
                <span style={{ color: MUTED }}>{row.code}</span>
              </div>
              <div>
                <span className="rgrid-label">{t("partners.columnGroup")}</span>
                <span style={{ color: MUTED }}>
                  {row.groupName ?? t("partners.noGroup")}
                </span>
              </div>
              <div>
                <span className="rgrid-label">
                  {t("partners.columnStatus")}
                </span>
                <span
                  className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
                  style={PARTNER_STATUS_STYLE[row.status]}
                >
                  {t(`status.partner.${row.status}`)}
                </span>
                {row.payoutHold && (
                  <span
                    className="mt-1 block text-[13px] font-bold"
                    style={{ color: "#B24343" }}
                  >
                    {t("partners.payoutHoldChip")}
                  </span>
                )}
              </div>
              <div>
                <span className="rgrid-label">
                  {t("partners.columnClicks")}
                </span>
                <span style={{ color: INK }}>{row.clicksText}</span>
              </div>
              <div>
                <span className="rgrid-label">{t("partners.columnSales")}</span>
                <span style={{ color: INK }}>{row.ordersText}</span>
              </div>
              <div>
                <span className="rgrid-label">
                  {t("partners.columnAvailable")}
                </span>
                <span className="font-semibold" style={{ color: INK }}>
                  {row.availableText}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
