"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { gradeSubmission, getSubmissionDownloadUrl } from "@/lib/submissions/actions";
import { initialGradeSubmissionActionState } from "@/lib/submissions/state";
import type { SubmissionStatus } from "@/lib/submissions/schema";
import type { InboxSubmission } from "@/components/admin/submission-inbox";

const GRADABLE_STATUSES: SubmissionStatus[] = ["approved", "revision", "rejected"];

/**
 * Bewertungsformular — `useActionState` + `gradeSubmission` (Muster wie
 * `quiz-editor.tsx`/`updateQuiz`: `.bind(null, submissionId)` bindet die ID,
 * `<form action={formAction}>` übernimmt Status/Note/Feedback als FormData).
 * `revalidatePath("/admin/abgaben")` in der Server Action sorgt dafür, dass
 * die Server-Component-Daten nach dem Speichern automatisch neu geladen
 * werden (kein zusätzliches `router.refresh()` nötig, wie auch in
 * `quiz-editor.tsx` für das Metadaten-Formular).
 */
export function GradeForm({ submission }: { submission: InboxSubmission }) {
  const t = useTranslations("submissions.inbox");
  const tSubmissions = useTranslations("submissions");
  const tStatuses = useTranslations("submissions.statuses");
  const tCommon = useTranslations("admin.common");
  const boundGrade = gradeSubmission.bind(null, submission.id);
  const [state, formAction, pending] = useActionState(boundGrade, initialGradeSubmissionActionState);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadPending, setDownloadPending] = useState(false);

  async function handleDownload() {
    setDownloadPending(true);
    setDownloadError(null);
    const result = await getSubmissionDownloadUrl(submission.id);
    setDownloadPending(false);
    if (!result.ok) {
      setDownloadError(result.error);
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-col gap-4">
      {submission.kind === "text" ? (
        <div>
          <p className="mb-1 text-sm font-medium">{t("submittedTextHeading")}</p>
          <p className="whitespace-pre-wrap rounded-md border bg-gray-50 p-3 text-base">{submission.content}</p>
        </div>
      ) : (
        <div>
          <p className="mb-1 text-sm font-medium">{t("fileSubmissionHeading")}</p>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloadPending}
            className="rounded-md border px-3 py-1.5 text-sm underline disabled:opacity-50"
          >
            {downloadPending ? t("downloadUrlGenerating") : t("download")}
          </button>
          {downloadError && (
            <p role="alert" className="mt-1 text-sm text-red-600">
              {downloadError}
            </p>
          )}
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{tSubmissions("statusLabel")}</legend>
          {GRADABLE_STATUSES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-base" htmlFor={`status-${submission.id}-${s}`}>
              <input
                id={`status-${submission.id}-${s}`}
                type="radio"
                name="status"
                value={s}
                defaultChecked={submission.status === s || (submission.status === "submitted" && s === "approved")}
              />
              {tStatuses(s)}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1 text-sm" htmlFor={`grade-${submission.id}`}>
          {t("gradeLabel")}
          <input
            id={`grade-${submission.id}`}
            name="grade"
            type="text"
            maxLength={50}
            defaultValue={submission.grade ?? ""}
            className="rounded-md border px-3 py-2 text-base"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm" htmlFor={`feedback-${submission.id}`}>
          {t("feedbackToLearner")}
          <textarea
            id={`feedback-${submission.id}`}
            name="feedback"
            rows={4}
            maxLength={5000}
            defaultValue={submission.feedback ?? ""}
            className="rounded-md border px-3 py-2 text-base"
          />
        </label>

        {state.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        {state.success && !state.error && (
          <p role="status" aria-live="polite" className="text-sm text-green-700">
            {t("saved")}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
          style={{ background: "var(--color-primary)" }}
        >
          {pending ? tCommon("saving") : t("save")}
        </button>
      </form>
    </div>
  );
}
