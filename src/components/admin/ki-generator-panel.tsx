"use client";

import { useEffect, useState, useTransition } from "react";
import { applyDraftAsCourse } from "@/lib/generator/apply";
import type { CourseDraft } from "@/lib/generator/schema";

type JobStatusResponse = {
  jobId: string;
  status: "queued" | "running" | "done" | "error";
  step: number;
  outlineTitle: string | null;
  draft: CourseDraft | null;
  error: string | null;
};

const STEP_LABELS = [
  "Auftrag wird eingereiht …",
  "Gliederung wird erstellt …",
  "Lektionsinhalte werden ausformuliert …",
  "Quiz-Fragen werden erstellt …",
];

const POLL_INTERVAL_MS = 4000;

/**
 * Kurs-Generator-Admin-UI (Phase 3, Block 5, SPEC §4.2 `/admin/ki`):
 * Upload -> Fortschrittsanzeige (Polling) -> Vorschau -> „Als Kurs
 * übernehmen". Ruft die Server Action `applyDraftAsCourse()`
 * (src/lib/generator/apply.ts) direkt auf — gleiches Muster wie
 * `src/components/admin/publish-toggle.tsx` (Server Actions direkt aus der
 * "use client"-Komponente importieren statt über Server-Component-Props
 * durchzureichen).
 *
 * Barrierefreiheit (CLAUDE.md §3.4): Fortschritts-/Fehlermeldungen über
 * `role="status"`/`role="alert"` + `aria-live="polite"`, echte `<label
 * htmlFor>`-Zuordnungen, Buttons mit vollständigem Text, kein reines
 * Farb-Signal.
 */
export function KiGeneratorPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);

  const [isApplying, startApplyTransition] = useTransition();
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ courseId: string } | null>(null);

  useEffect(() => {
    if (!jobId) return;
    if (jobStatus && (jobStatus.status === "done" || jobStatus.status === "error")) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/ki/status?jobId=${encodeURIComponent(jobId)}`);
        const data = (await res.json()) as JobStatusResponse | { error: string };
        if (cancelled) return;
        if (res.ok && "status" in data) {
          setJobStatus(data);
        }
      } catch {
        // Netzwerkfehler beim Polling: nächster Versuch folgt automatisch,
        // kein Nutzer-sichtbarer Fehler nötig für einen einzelnen Ausfall.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId, jobStatus]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) {
      setUploadError("Bitte eine PDF-Datei auswählen.");
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    setApplyResult(null);
    setApplyError(null);

    const formData = new FormData();
    formData.append("file", file);
    if (title.trim()) formData.append("title", title.trim());

    try {
      const res = await fetch("/api/admin/ki/generate", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(typeof data.error === "string" ? data.error : "Hochladen fehlgeschlagen.");
        return;
      }
      setJobId(data.jobId as string);
      setJobStatus({
        jobId: data.jobId,
        status: "queued",
        step: 0,
        outlineTitle: null,
        draft: null,
        error: null,
      });
    } catch {
      setUploadError("Hochladen fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setIsUploading(false);
    }
  }

  function handleApply() {
    if (!jobId) return;
    setApplyError(null);
    startApplyTransition(async () => {
      const result = await applyDraftAsCourse(jobId);
      if (result.ok) {
        setApplyResult({ courseId: result.courseId });
      } else {
        setApplyError(result.error);
      }
    });
  }

  const isBusy = jobStatus !== null && jobStatus.status !== "done" && jobStatus.status !== "error";

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border p-5">
        <div className="flex flex-col gap-1">
          <label htmlFor="ki-file" className="text-base font-medium">
            PDF-Dokument
          </label>
          <input
            id="ki-file"
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-base"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ki-title" className="text-base font-medium">
            Arbeitstitel (optional)
          </label>
          <input
            id="ki-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={300}
            className="rounded-md border px-3 py-2 text-base"
            style={{ borderRadius: "var(--radius)" }}
          />
        </div>
        {uploadError && (
          <p role="alert" className="text-base text-red-700">
            {uploadError}
          </p>
        )}
        <button
          type="submit"
          disabled={isUploading || isBusy}
          className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--color-primary)", borderRadius: "var(--radius)" }}
        >
          {isUploading ? "Wird hochgeladen …" : "Kursentwurf generieren"}
        </button>
      </form>

      {jobStatus && (
        <div role="status" aria-live="polite" className="rounded-lg border p-5">
          {jobStatus.status === "error" ? (
            <p className="text-base text-red-700">Fehler: {jobStatus.error ?? "Unbekannter Fehler."}</p>
          ) : jobStatus.status === "done" ? (
            <p className="text-base">
              Entwurf „{jobStatus.draft?.title ?? jobStatus.outlineTitle ?? "Kurs"}" ist fertig.
            </p>
          ) : (
            <p className="text-base">{STEP_LABELS[jobStatus.step] ?? "Wird verarbeitet …"}</p>
          )}
        </div>
      )}

      {jobStatus?.status === "done" && jobStatus.draft && (
        <div className="rounded-lg border p-5">
          <h2 className="mb-2 text-xl font-semibold">{jobStatus.draft.title}</h2>
          {jobStatus.draft.description && <p className="mb-4 text-base">{jobStatus.draft.description}</p>}
          <ul className="flex flex-col gap-3">
            {jobStatus.draft.modules.map((mod, i) => (
              <li key={i}>
                <p className="font-medium">{mod.title}</p>
                <ul className="ml-5 list-disc text-base">
                  {mod.lessons.map((lesson, j) => (
                    <li key={j}>{lesson.title}</li>
                  ))}
                  {mod.quiz && (
                    <li>
                      Quiz: {mod.quiz.title} ({mod.quiz.questions.length} Fragen)
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ul>

          {applyResult ? (
            <p className="mt-4 text-base">
              Kurs übernommen (als Entwurf, noch nicht veröffentlicht).{" "}
              <a href={`/admin/kurse/${applyResult.courseId}`} className="underline">
                Zum Kurs-Editor →
              </a>
            </p>
          ) : (
            <>
              {applyError && (
                <p role="alert" className="mt-2 text-base text-red-700">
                  {applyError}
                </p>
              )}
              <button
                type="button"
                onClick={handleApply}
                disabled={isApplying}
                className="mt-4 rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--color-primary)", borderRadius: "var(--radius)" }}
              >
                {isApplying ? "Wird übernommen …" : "Als Kurs übernehmen"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
