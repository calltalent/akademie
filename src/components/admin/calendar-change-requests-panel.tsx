"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { decideShiftChangeRequest } from "@/lib/calendar/actions";
import type { CalendarChangeRequestRow } from "@/lib/calendar/schema";
import { formatDayLabel, formatTimeRange } from "@/lib/calendar/date";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { initialsFor } from "@/lib/format/initials";

/**
 * Änderungsanfragen-Inbox (Block S3, 09.08.2026) — Vorbild `submission-inbox.tsx`
 * (Abgaben-Bewertung): Filterleiste als echte `<a>`-Links mit
 * `aria-current="page"`, aufklappbare Zeilen mit `<button aria-expanded>`,
 * Entscheidungsformular nur bei `status === "pending"` sichtbar.
 *
 * KEIN `router.refresh()` nach einer Entscheidung (Abweichung von der
 * ursprünglichen Formulierung des Bauauftrags) — `decideShiftChangeRequest()`
 * ruft bereits `revalidatePath(ADMIN_PATH)` auf, Next.js lädt die
 * Server-Component-Daten dieser Route dadurch automatisch neu (gleiches,
 * bereits im Repo etablierte Prinzip wie `grade-form.tsx`/
 * `calendar-shifts-panel.tsx` — dort ebenfalls ohne `router.refresh()`).
 */
function shiftLabelFor(startsAt: string, endsAt: string, breakMinutes: number, pauseLabel: (n: number) => string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const base = `${formatDayLabel(start)}, ${formatTimeRange(start, end)} Uhr`;
  return breakMinutes > 0 ? `${base} · ${pauseLabel(breakMinutes)}` : base;
}

export function CalendarChangeRequestsPanel({
  requests,
  status,
  weekIso,
  year,
}: {
  requests: CalendarChangeRequestRow[];
  status: "pending" | "decided" | "all";
  weekIso: string;
  year: number;
}) {
  const t = useTranslations("admin.shiftCalendar.requests");
  const uid = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function buildFilterHref(filter: "pending" | "decided" | "all"): string {
    const params = new URLSearchParams();
    params.set("tab", "requests");
    if (weekIso) params.set("week", weekIso);
    if (year) params.set("year", String(year));
    params.set("requestStatus", filter);
    return `?${params.toString()}`;
  }

  function handleDecide(requestId: string, decision: "approved" | "rejected") {
    setErrors((prev) => ({ ...prev, [requestId]: "" }));
    setDecidingId(requestId);
    startTransition(async () => {
      const result = await decideShiftChangeRequest(requestId, {
        decision,
        decisionNote: (notes[requestId] ?? "").trim() === "" ? undefined : notes[requestId].trim(),
      });
      setDecidingId(null);
      if (!result.ok) {
        setErrors((prev) => ({ ...prev, [requestId]: result.error }));
        return;
      }
      setOpenId(null);
    });
  }

  const filters: { value: "pending" | "decided" | "all"; label: string }[] = [
    { value: "pending", label: t("filterPending") },
    { value: "decided", label: t("filterDecided") },
    { value: "all", label: t("filterAll") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="p-[24px_28px_0]">
        <h2 className="text-[17px] font-bold text-ink">{t("heading")}</h2>
        <p className="mt-1 text-sm text-muted-500">{t("description")}</p>
      </div>

      <nav aria-label={t("filterAriaLabel")} className="flex flex-wrap gap-2 px-[28px]">
        {filters.map((f) => (
          <a
            key={f.value}
            href={buildFilterHref(f.value)}
            aria-current={status === f.value ? "page" : undefined}
            className="inline-flex rounded-[10px] px-[15px] py-[9px] text-sm font-semibold no-underline"
            style={
              status === f.value
                ? { background: "#5663AE", color: "#fff" }
                : { background: "#fff", color: "#3E3F66", border: "1px solid #E7E8F2" }
            }
          >
            {f.label}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-3.5 px-[28px] pb-6" style={{ maxWidth: 900 }}>
        {requests.length === 0 && <p className="text-sm text-muted-500">{t("empty")}</p>}

        {requests.map((r) => {
          const isOpen = openId === r.id;
          const isDeciding = pending && decidingId === r.id;
          const currentLabel = shiftLabelFor(r.shiftStartsAt, r.shiftEndsAt, r.shiftBreakMinutes, (n) => `${n} Min. Pause`);
          const proposedLabel =
            r.kind === "update" && r.proposedStartsAt && r.proposedEndsAt
              ? shiftLabelFor(r.proposedStartsAt, r.proposedEndsAt, r.proposedBreakMinutes ?? 0, (n) => `${n} Min. Pause`)
              : null;
          const statusLabel =
            r.status === "pending" ? t("statusPending") : r.status === "approved" ? t("statusApproved") : t("statusRejected");
          const statusColor =
            r.status === "pending"
              ? { color: "#1A1A2E", bg: "#F7EED4" }
              : r.status === "approved"
                ? { color: "#1F8A5B", bg: "#E3F2EA" }
                : { color: "#B24343", bg: "#F6E4E4" };

          return (
            <div key={r.id} className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : r.id)}
                aria-expanded={isOpen}
                className="flex w-full flex-wrap items-center gap-[18px] px-[22px] py-[18px] text-left"
              >
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-[11px] text-[15px] font-bold"
                  style={{ background: "#3E3F66", color: "#F7EED4" }}
                >
                  {initialsFor(r.workerName, r.workerName ?? "")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold">{r.workerName ?? "—"}</div>
                  <div className="flex items-center gap-2 text-sm" style={{ color: "#66679B" }}>
                    {r.projectColor && (
                      <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full" style={{ background: r.projectColor }} />
                    )}
                    <span>{r.projectName ?? ""}</span>
                    <span>{r.kind === "update" ? t("kindUpdate") : t("kindCancel")}</span>
                  </div>
                </div>
                <span className="flex-none text-[13px]" style={{ color: "#A9AAC4" }}>
                  {formatRelativeTime(new Date(r.createdAt))}
                </span>
                <span
                  className="flex-none rounded-lg px-3 py-1.5 text-[13px] font-bold"
                  style={{ color: statusColor.color, background: statusColor.bg }}
                >
                  {statusLabel}
                </span>
                <span
                  className="flex-none rounded-[10px] px-[18px] py-2.5 text-sm font-bold text-white"
                  style={{ background: "#5663AE" }}
                >
                  {t("openButton")}
                </span>
              </button>

              {isOpen && (
                <div className="flex flex-col gap-3 border-t px-[22px] py-[18px]" style={{ borderColor: "#EEF0F7" }}>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-500">{t("currentLabel")}</p>
                    <p className="text-sm text-ink">{currentLabel}</p>
                  </div>
                  {r.kind === "update" && proposedLabel && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-500">{t("proposedLabel")}</p>
                      <p className="text-sm text-ink">{proposedLabel}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-500">{t("reasonLabel")}</p>
                    <p className="text-sm text-ink">{r.reason || t("noReason")}</p>
                  </div>

                  {r.status !== "pending" && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-500">
                        {r.decidedAt ? t("decidedAtLabel", { date: new Date(r.decidedAt).toLocaleString("de-DE") }) : ""}
                      </p>
                      {r.decisionNote && <p className="text-sm text-ink">{r.decisionNote}</p>}
                    </div>
                  )}

                  {r.status === "pending" && (
                    <div className="flex flex-col gap-3">
                      <div>
                        <label htmlFor={`${uid}-${r.id}-note`} className="mb-1.5 block text-sm font-semibold text-navy">
                          {t("decisionNoteLabel")}
                        </label>
                        <textarea
                          id={`${uid}-${r.id}-note`}
                          value={notes[r.id] ?? ""}
                          onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          rows={2}
                          className="w-full rounded-sm border border-border-300 bg-white px-3 py-2.5 text-sm text-ink"
                        />
                      </div>
                      {r.kind === "update" && <p className="text-xs text-muted-500">{t("conflictHint")}</p>}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => handleDecide(r.id, "approved")}
                          className="rounded-sm px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                          style={{ background: "#1F8A5B" }}
                        >
                          {isDeciding ? t("decidingButton") : t("approveButton")}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => handleDecide(r.id, "rejected")}
                          className="rounded-sm border px-4 py-2.5 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                          style={{ borderColor: "#E3C0C0", color: "#B24343" }}
                        >
                          {isDeciding ? t("decidingButton") : t("rejectButton")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpenId(null)}
                          className="rounded-sm border border-border-300 bg-white px-4 py-2.5 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          {t("closeButton")}
                        </button>
                      </div>
                      {errors[r.id] && (
                        <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
                          {errors[r.id]}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
