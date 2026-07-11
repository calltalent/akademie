"use client";

import { useState } from "react";
import {
  SUBMISSION_STATUSES,
  SUBMISSION_STATUS_LABELS,
  type SubmissionKind,
  type SubmissionStatus,
} from "@/lib/submissions/schema";
import { GradeForm } from "@/components/admin/grade-form";

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

const STATUS_BADGE_STYLE: Record<SubmissionStatus, string> = {
  submitted: "border-blue-300 bg-blue-50 text-blue-700",
  approved: "border-green-300 bg-green-50 text-green-700",
  revision: "border-amber-300 bg-amber-50 text-amber-700",
  rejected: "border-red-300 bg-red-50 text-red-700",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
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
  const [openId, setOpenId] = useState<string | null>(null);

  const filters: { value: SubmissionStatus | null; label: string }[] = [
    { value: null, label: "Alle" },
    ...SUBMISSION_STATUSES.map((s) => ({ value: s, label: SUBMISSION_STATUS_LABELS[s] })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Nach Status filtern" className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <a
            key={f.label}
            href={f.value ? `/admin/abgaben?status=${f.value}` : "/admin/abgaben"}
            aria-current={activeStatus === f.value ? "page" : undefined}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
            style={{
              borderRadius: "var(--radius)",
              background: activeStatus === f.value ? "var(--color-primary)" : "transparent",
              color: activeStatus === f.value ? "#ffffff" : "inherit",
            }}
          >
            {f.label}
          </a>
        ))}
      </nav>

      <ul className="flex flex-col gap-3">
        {submissions.map((s) => (
          <li key={s.id} className="rounded-md border" style={{ borderRadius: "var(--radius)" }}>
            <button
              type="button"
              onClick={() => setOpenId(openId === s.id ? null : s.id)}
              aria-expanded={openId === s.id}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
            >
              <div>
                <p className="text-base font-medium">
                  {s.courseTitle} — {s.lessonTitle}
                </p>
                <p className="text-sm text-gray-500">
                  {s.userName || s.userEmail} — {formatDate(s.createdAt)}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium ${STATUS_BADGE_STYLE[s.status]}`}
                style={{ borderRadius: "var(--radius)" }}
              >
                {SUBMISSION_STATUS_LABELS[s.status]}
              </span>
            </button>

            {openId === s.id && (
              <div className="border-t px-4 py-4">
                <GradeForm submission={s} />
              </div>
            )}
          </li>
        ))}
        {submissions.length === 0 && <p className="text-base text-gray-500">Keine Abgaben gefunden.</p>}
      </ul>
    </div>
  );
}
