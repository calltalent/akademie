"use client";

import { useState } from "react";
import Link from "next/link";
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
 */
export type TeilnehmerRow = {
  userId: string;
  fullName: string | null;
  email: string;
  courseCount: number;
  joined: string;
  initials: string;
};

const COLS = "2fr 1.4fr 1fr 1fr 1.4fr";

export function TeilnehmerListe({ rows }: { rows: TeilnehmerRow[] }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const visible = query
    ? rows.filter(
        (r) =>
          r.email.toLowerCase().includes(query) || (r.fullName ?? "").toLowerCase().includes(query),
      )
    : rows;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            Nutzer · Teilnehmer
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            Teilnehmer
          </h1>
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
            placeholder="Teilnehmer suchen …"
            aria-label="Teilnehmer nach Name oder E-Mail suchen"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "#1A1A2E" }}
          />
        </div>
        <InviteUserDialog />
      </header>

      <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
        <div
          className="grid gap-0 px-[26px] pb-3 pt-[18px] text-[13px] font-bold"
          style={{ gridTemplateColumns: COLS, color: "#A9AAC4", borderBottom: "1px solid #EEF0F7" }}
        >
          <div>Name</div>
          <div>E-Mail</div>
          <div>Kurse</div>
          <div>Beigetreten</div>
          <div />
        </div>
        {visible.length === 0 ? (
          <p className="px-[26px] py-6 text-sm" style={{ color: "#A9AAC4" }}>
            {query ? "Keine Treffer für diese Suche." : "Noch keine Mitglieder."}
          </p>
        ) : (
          visible.map((r) => (
            <div
              key={r.userId}
              className="grid items-center gap-0 px-[26px] py-[15px] text-[15px]"
              style={{ gridTemplateColumns: COLS, borderBottom: "1px solid #F4F5FA" }}
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
              <div style={{ color: "#3E3F66" }}>{r.courseCount}</div>
              <div className="text-sm" style={{ color: "#66679B" }}>
                {r.joined}
              </div>
              <div className="flex items-center justify-end gap-3">
                <Link
                  href={`/admin/teilnehmer/${r.userId}`}
                  className="text-sm font-semibold no-underline"
                >
                  Profil
                </Link>
                <TeilnehmerRowActions
                  userId={r.userId}
                  name={r.fullName ?? r.email}
                  email={r.email}
                  courseCount={r.courseCount}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
