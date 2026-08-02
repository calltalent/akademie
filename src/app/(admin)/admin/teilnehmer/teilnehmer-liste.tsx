"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { InviteUserDialog } from "@/components/admin/invite-user-dialog";
import { TeilnehmerRowActions } from "@/components/admin/teilnehmer-row-actions";

/**
 * Client-Teil der Teilnehmer-Verwaltung (Referenz AdminTeilnehmer.dc.html):
 * Suchfeld mit client-seitigem Live-Filter (Name/E-Mail) + Tabelle. Die Daten
 * kommen als `rows` echt aus page.tsx; „Profil" führt auf die Detailseite.
 *
 * Aktionsspalte (19.07.2026, Josips Auftrag: "Link erneut senden" +
 * "Löschen"): verbreitert von 0.6fr auf 1.4fr, damit neben „Profil" auch die
 * beiden Icon-Buttons aus `teilnehmer-row-actions.tsx` Platz haben.
 *
 * Kennzahlenzeile + Status-Spalte (25.07.2026, gleiches Prinzip wie beim
 * Kurs-Redesign): Status stand vorher NUR auf der Detailseite — offene
 * Einladungen oder deaktivierte Mitglieder waren in der Liste selbst nicht
 * erkennbar, man musste jede Zeile einzeln öffnen. Beides rein lesend, keine
 * neue Aktion (Status ändern bleibt auf der Detailseite, `membership-row-
 * actions.tsx`).
 */
const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  active: { color: "#1F8A5B", bg: "#E3F2EA" },
  invited: { color: "#8A6D1F", bg: "#F7EED4" },
  deactivated: { color: "#66679B", bg: "#EEF0F7" },
};

export type TeilnehmerRow = {
  userId: string;
  fullName: string | null;
  email: string;
  status: string;
  courseCount: number;
  joined: string;
  initials: string;
};

const COLS = "1.8fr 1.3fr 0.7fr 0.8fr 0.9fr 1.4fr";

export function TeilnehmerListe({ rows }: { rows: TeilnehmerRow[] }) {
  const t = useTranslations("admin.teilnehmer");
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const visible = query
    ? rows.filter(
        (r) =>
          r.email.toLowerCase().includes(query) || (r.fullName ?? "").toLowerCase().includes(query),
      )
    : rows;
  const invitedCount = rows.filter((r) => r.status === "invited").length;

  const statusLabels: Record<string, string> = {
    active: t("statusActive"),
    invited: t("statusInvited"),
    deactivated: t("statusDeactivated"),
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            {t("eyebrow")}
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            {t("title")}
          </h1>
          <p className="mt-1 text-[13.5px]" style={{ color: "#A9AAC4" }}>
            <b style={{ color: "#3E3F66" }}>{rows.length}</b> {t("participantsWord")}
            {" · "}
            <b style={{ color: "#3E3F66" }}>{invitedCount}</b> {t("openInvitationLabel", { count: invitedCount })}
          </p>
        </div>
        <div
          className="flex items-center gap-2.5 rounded-[11px] border bg-white px-[14px] py-2.5"
          style={{ borderColor: "#E7E8F2", width: 280 }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#66679B"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7"></circle>
            <path d="m20 20-3.2-3.2"></path>
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchAriaLabel")}
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "#1A1A2E" }}
          />
        </div>
        <InviteUserDialog />
      </header>

      <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
        <div
          className="rgrid-header px-[26px] pb-3 pt-[18px] text-[13px] font-bold"
          style={{ "--rgrid-cols": COLS, color: "#A9AAC4", borderBottom: "1px solid #EEF0F7" } as React.CSSProperties}
        >
          <div>{t("columnName")}</div>
          <div>{t("columnEmail")}</div>
          <div>{t("columnCourses")}</div>
          <div>{t("columnJoined")}</div>
          <div>{t("columnStatus")}</div>
          <div />
        </div>
        {visible.length === 0 ? (
          <p className="px-[26px] py-6 text-sm" style={{ color: "#A9AAC4" }}>
            {query ? t("noResults") : t("empty")}
          </p>
        ) : (
          visible.map((r) => {
            const colors = STATUS_COLORS[r.status] ?? STATUS_COLORS.active;
            const label = statusLabels[r.status] ?? statusLabels.active;
            return (
            <div
              key={r.userId}
              className="rgrid-row px-[18px] py-[15px] text-[15px] lg:px-[26px]"
              style={{ "--rgrid-cols": COLS, borderBottom: "1px solid #F4F5FA" } as React.CSSProperties}
            >
              <div className="flex items-center gap-3.5">
                <span
                  aria-hidden="true"
                  className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] text-sm font-bold"
                  style={{ background: "#3E3F66", color: "#F7EED4" }}
                >
                  {r.initials}
                </span>
                <span className="truncate font-semibold">{r.fullName || r.email || r.userId}</span>
              </div>
              <div className="truncate text-sm" style={{ color: "#66679B" }}>
                {r.email}
              </div>
              <div>
                <span className="rgrid-label">{t("columnCourses")}</span>
                <span style={{ color: "#3E3F66" }}>{r.courseCount}</span>
              </div>
              <div className="text-sm" style={{ color: "#66679B" }}>
                <span className="rgrid-label">{t("columnJoined")}</span>
                {r.joined}
              </div>
              <div>
                <span className="rgrid-label">{t("columnStatus")}</span>
                <span
                  className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
                  style={{ color: colors.color, background: colors.bg }}
                >
                  {label}
                </span>
              </div>
              <div className="flex items-center gap-3 lg:justify-end">
                <Link
                  href={`/admin/teilnehmer/${r.userId}`}
                  prefetch={false}
                  className="text-sm font-semibold no-underline"
                >
                  {t("profileLink")}
                </Link>
                <TeilnehmerRowActions
                  userId={r.userId}
                  name={r.fullName ?? r.email}
                  email={r.email}
                  courseCount={r.courseCount}
                />
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}
