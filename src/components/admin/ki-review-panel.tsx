"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, HelpCircle } from "lucide-react";
import { applyDraftAsCourse } from "@/lib/generator/apply";
import { retryDraft } from "@/lib/generator/actions";
import type { CourseDraft, CourseGenOutput } from "@/lib/generator/schema";

type Status = "queued" | "running" | "done" | "error";

const POLL_INTERVAL_MS = 4000;

/**
 * Fortschritt/Vorschau/Übernehmen für EINEN Entwurf (Design-Import
 * AdminKiGenerator.dc.html, 19.07.2026) — Polling-Logik 1:1 aus dem
 * bisherigen `ki-generator-panel.tsx` übernommen (jetzt entfernt), nur vom
 * Upload-Formular getrennt: diese Seite lebt jetzt unter der eigenen URL
 * `/admin/ki/[jobId]` statt in einem Inline-Panel auf der Listenseite.
 */
export function KiReviewPanel({
  jobId,
  initialStatus,
  initialOutput,
  initialError,
}: {
  jobId: string;
  initialStatus: Status;
  initialOutput: CourseGenOutput;
  initialError: string | null;
}) {
  const t = useTranslations("admin.ki");
  const STEP_LABELS = [t("reviewStep0"), t("queueStep1"), t("queueStep2"), t("queueStep3")];
  const [status, setStatus] = useState<Status>(initialStatus);
  const [step, setStep] = useState(initialOutput.step);
  const [draft, setDraft] = useState<CourseDraft | null>(initialOutput.draft ?? null);
  const [jobError, setJobError] = useState<string | null>(initialError);
  const [appliedCourseId, setAppliedCourseId] = useState<string | null>(initialOutput.appliedCourseId ?? null);

  const [isApplying, startApplyTransition] = useTransition();
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ courseId: string } | null>(
    initialOutput.appliedCourseId ? { courseId: initialOutput.appliedCourseId } : null,
  );

  const [isRetrying, startRetryTransition] = useTransition();

  useEffect(() => {
    if (status === "done" || status === "error") return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/ki/status?jobId=${encodeURIComponent(jobId)}`);
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setStatus(data.status);
        setStep(data.step);
        if (data.draft) setDraft(data.draft);
        if (data.error) setJobError(data.error);
      } catch {
        // Netzwerkfehler beim Polling: nächster Versuch folgt automatisch.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId, status]);

  function handleApply() {
    setApplyError(null);
    startApplyTransition(async () => {
      const result = await applyDraftAsCourse(jobId);
      if (result.ok) {
        setApplyResult({ courseId: result.courseId });
        setAppliedCourseId(result.courseId);
      } else {
        setApplyError(result.error);
      }
    });
  }

  function handleRetry() {
    startRetryTransition(async () => {
      const result = await retryDraft(jobId);
      if (result.error) alert(result.error);
      else location.href = "/admin/ki";
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="status" aria-live="polite" className="rounded-[14px] border bg-white p-[24px_28px]" style={{ borderColor: "#E7E8F2" }}>
        {status === "error" ? (
          <div className="flex flex-col gap-3">
            <p className="text-base font-semibold" style={{ color: "#B24343" }}>
              {t("reviewError", { error: jobError ?? t("unknownError") })}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="self-start rounded-[10px] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              style={{ background: "#5663AE" }}
            >
              {isRetrying ? t("queueStep0") : t("reviewRetryButton")}
            </button>
          </div>
        ) : status === "done" ? (
          <p className="flex items-center gap-2.5 text-base font-semibold">
            <CheckCircle2 size={18} color="#1F8A5B" aria-hidden="true" />
            {t("draftReadyMessage", { title: draft?.title ?? t("fallbackCourseTitle") })}
          </p>
        ) : (
          <p className="text-base font-semibold">{STEP_LABELS[step] ?? t("processingFallback")}</p>
        )}
      </div>

      {status === "done" && draft && (
        <div className="rounded-[14px] border bg-white p-[24px_28px]" style={{ borderColor: "#E7E8F2" }}>
          <h1 className="mb-1 text-xl font-extrabold">{draft.title}</h1>
          {draft.description && (
            <p className="mb-4 text-[15px]" style={{ color: "#66679B" }}>
              {draft.description}
            </p>
          )}
          <ul className="flex flex-col gap-3.5">
            {draft.modules.map((mod, i) => (
              <li key={i} className="rounded-[11px] p-[14px_16px]" style={{ background: "#F7F8FC" }}>
                <p className="font-bold">{mod.title}</p>
                <ul className="ml-5 mt-1.5 list-disc text-[15px]" style={{ color: "#3E3F66" }}>
                  {mod.lessons.map((lesson, j) => (
                    <li key={j}>{lesson.title}</li>
                  ))}
                  {mod.quiz && (
                    <li className="flex items-center gap-1.5">
                      <HelpCircle size={14} aria-hidden="true" />
                      {t("quizSummary", { title: mod.quiz.title, count: mod.quiz.questions.length })}
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ul>

          {applyResult ? (
            <p className="mt-5 text-[15px] font-semibold">
              {t("appliedMessage")}{" "}
              <a href={`/admin/kurse/${applyResult.courseId}`} style={{ color: "#5663AE" }}>
                {t("goToCourseEditorLink")}
              </a>
            </p>
          ) : appliedCourseId ? (
            <p className="mt-5 text-[15px] font-semibold">
              {t("alreadyAppliedMessage")}{" "}
              <a href={`/admin/kurse/${appliedCourseId}`} style={{ color: "#5663AE" }}>
                {t("goToCourseEditorLink")}
              </a>
            </p>
          ) : (
            <>
              {applyError && (
                <p role="alert" className="mt-3 text-sm font-semibold" style={{ color: "#B24343" }}>
                  {applyError}
                </p>
              )}
              <button
                type="button"
                onClick={handleApply}
                disabled={isApplying}
                className="mt-5 rounded-[11px] px-[18px] py-[13px] text-[15px] font-bold text-white disabled:opacity-50"
                style={{ background: "#5663AE" }}
              >
                {isApplying ? t("applying") : t("applyButton")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
