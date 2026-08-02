"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SUBMISSION_STATUSES, type SubmissionKind, type SubmissionStatus } from "@/lib/submissions/schema";
import { GradeForm } from "@/components/admin/grade-form";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { initialsFor } from "@/lib/format/initials";

export type InboxSubmission = {
  id: string;
  lessonTitle: string;
  courseTitle: string;
  userEmail: string;
  userName: string | null;
  kind: SubmissionKind;
  content: string | null;
  filePath: string | null;
  status: SubmissionStatus;
  grade: string | null;
  feedback: string | null;
  createdAt: string;
};

/**
 * Design-Block 6 (13.07.2026, AdminAbgaben.dc.html): der Export kennt nur
 * drei visuelle Zustände (offen/überfällig/bewertet), die reale DB hat vier
 * Status (submitted/approved/revision/rejected, kein "überfällig"-Feld und
 * keine Deadline auf submissions/lessons). Abbildung hier bewusst so:
 * - "bewertet" = jeder abgeschlossene Status (approved/revision/rejected)
 * - "offen"/"überfällig" = beides `submitted`, unterschieden über ein
 *   dokumentiertes 48h-Alters-Kriterium auf `created_at` (keine erfundene
 *   Spalte, nur eine abgeleitete Sicht auf ein echtes Zeitstempel-Feld,
 *   gleiches Muster wie die Abschlussquoten-Formel im Dashboard).
 * Der Status-FILTER darunter bleibt bewusst auf den vier echten DB-Status
 * (nicht den drei Badge-Buckets) — Staff braucht die genaue Unterscheidung
 * (z. B. "Überarbeitung nötig" vs. "Abgelehnt") zum Arbeiten, das würde beim
 * Zusammenfassen auf "Bewertet" verloren gehen.
 */
const OVERDUE_MS = 48 * 60 * 60 * 1000;

type BadgeKey = "offen" | "ueberfaellig" | "bewertet";

const BADGE_COLORS: Record<BadgeKey, { color: string; bg: string }> = {
  offen: { color: "#1A1A2E", bg: "#F7EED4" },
  ueberfaellig: { color: "#B24343", bg: "#F6E4E4" },
  bewertet: { color: "#1F8A5B", bg: "#E3F2EA" },
};

function badgeKeyFor(s: InboxSubmission): BadgeKey {
  if (s.status !== "submitted") return "bewertet";
  const ageMs = Date.now() - new Date(s.createdAt).getTime();
  return ageMs > OVERDUE_MS ? "ueberfaellig" : "offen";
}

/**
 * Liste aller Abgaben des Mandanten mit Status-Filter (Query-Param
 * `?status=`) und Klick-zum-Öffnen der Bewertung (GradeForm). Barrierefrei:
 * echte `<button aria-expanded>` für den Zeilen-Toggle, Filter als Links mit
 * `aria-current="page"`.
 */
export function SubmissionInbox({
  submissions,
  activeStatus,
}: {
  submissions: InboxSubmission[];
  activeStatus: SubmissionStatus | null;
}) {
  const t = useTranslations("submissions.inbox");
  const tStatuses = useTranslations("submissions.statuses");
  const [openId, setOpenId] = useState<string | null>(null);

  const BADGE_LABELS: Record<BadgeKey, string> = {
    offen: t("badgeOpen"),
    ueberfaellig: t("badgeOverdue"),
    bewertet: t("badgeGraded"),
  };

  const filters: { value: SubmissionStatus | null; label: string }[] = [
    { value: null, label: t("filterAll") },
    ...SUBMISSION_STATUSES.map((s) => ({ value: s, label: tStatuses(s) })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t("filterAriaLabel")} className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <a
            key={f.label}
            href={f.value ? `/admin/abgaben?status=${f.value}` : "/admin/abgaben"}
            aria-current={activeStatus === f.value ? "page" : undefined}
            className="inline-flex rounded-[10px] px-[15px] py-[9px] text-sm font-semibold no-underline"
            style={
              activeStatus === f.value
                ? { background: "#5663AE", color: "#fff" }
                : { background: "#fff", color: "#3E3F66", border: "1px solid #E7E8F2" }
            }
          >
            {f.label}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-3.5" style={{ maxWidth: 900 }}>
        {submissions.map((s) => {
          const badgeKey = badgeKeyFor(s);
          const badge = { label: BADGE_LABELS[badgeKey], ...BADGE_COLORS[badgeKey] };
          const isOpen = openId === s.id;
          return (
            <div
              key={s.id}
              className="overflow-hidden rounded-[14px] border bg-white"
              style={{ borderColor: "#E7E8F2" }}
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : s.id)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-[18px] px-[22px] py-[18px] text-left"
              >
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-[11px] text-[15px] font-bold"
                  style={{ background: "#3E3F66", color: "#F7EED4" }}
                >
                  {initialsFor(s.userName, s.userEmail)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold">{s.userName || s.userEmail}</div>
                  <div className="text-sm" style={{ color: "#66679B" }}>
                    {s.lessonTitle} · {s.courseTitle}
                  </div>
                </div>
                <span className="flex-none text-[13px]" style={{ color: "#A9AAC4" }}>
                  {formatRelativeTime(new Date(s.createdAt))}
                </span>
                <span
                  className="flex-none rounded-lg px-3 py-1.5 text-[13px] font-bold"
                  style={{ color: badge.color, background: badge.bg }}
                >
                  {badge.label}
                </span>
                <span
                  className="flex-none rounded-[10px] px-[18px] py-2.5 text-sm font-bold text-white"
                  style={{ background: "#5663AE" }}
                >
                  {t("reviewButton")}
                </span>
              </button>

              {isOpen && (
                <div className="border-t px-[22px] py-[18px]" style={{ borderColor: "#EEF0F7" }}>
                  <GradeForm submission={s} />
                </div>
              )}
            </div>
          );
        })}
        {submissions.length === 0 && (
          <p className="text-sm" style={{ color: "#A9AAC4" }}>
            {t("empty")}
          </p>
        )}
      </div>
    </div>
  );
}
