"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { importCourseFromFile } from "@/lib/import/actions";
import { initialImportActionState } from "@/lib/import/state";

/**
 * Migrations-Importer-Formular (Design-Update 19.07.2026, siehe Kopfkommentar
 * in admin/import/page.tsx). Funktional unverändert zum Phase-4-Original:
 * einfacher JSON-Upload, kein Client-JS für das Datei-Lesen nötig — der
 * Browser übernimmt das über den normalen Formular-Upload (`formData.get
 * ("file")` in der Server Action). Neu ist nur die Dateiname-Anzeige
 * (`fileLabel`-State) fürs eigene Datei-Auswahl-Steuerelement aus dem Export
 * — der native `<input type="file">` bleibt technisch bestehen (Formular-
 * Übermittlung, Tastatur-/Screenreader-Bedienung unverändert), wird aber
 * visuell versteckt und über das umgebende `<label>` ausgelöst.
 * Barrierefreiheit: `label`/`htmlFor`, sichtbarer Fokus-Ring,
 * `role="alert"`/`role="status"` für Fehler/Erfolg (CLAUDE.md §3.4).
 */
export function CourseImportForm() {
  const t = useTranslations("admin.import");
  const tCommon = useTranslations("admin.common");
  const [state, action, pending] = useActionState(
    importCourseFromFile,
    initialImportActionState,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileLabel, setFileLabel] = useState(t("noFileChosen"));

  useEffect(() => {
    if (state.success && fileInputRef.current) {
      fileInputRef.current.value = "";
      setFileLabel(t("noFileChosen"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` ist bei gleichbleibender Locale stabil, nur `state` soll den Effekt auslösen.
  }, [state]);

  return (
    <div className="rounded-[14px] border bg-white p-[28px]" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-2.5 text-[17px] font-bold">{t("cardHeading")}</div>
      <p className="mb-5 text-[15px]" style={{ color: "#66679B" }}>
        {t.rich("description", {
          code: (chunks) => (
            <code className="rounded-[5px] px-1.5 py-0.5 text-[13px]" style={{ background: "#F4F5FA" }}>
              {chunks}
            </code>
          ),
        })}
      </p>

      <form action={action} className="flex flex-col items-start gap-[22px]">
        <div className="w-full">
          <label
            htmlFor="import-file"
            className="mb-2 block text-[13px] font-semibold"
            style={{ color: "#66679B" }}
          >
            {t("fileLabel")}
          </label>
          <label
            htmlFor="import-file"
            className="flex cursor-pointer items-center gap-3 rounded-[10px] border px-4 py-3 focus-within:ring-2 focus-within:ring-offset-2"
            style={{ borderColor: "#E7E8F2" }}
          >
            <span
              className="shrink-0 rounded-lg px-3.5 py-[7px] text-[13px] font-bold"
              style={{ background: "#F4F5FA", color: "#3E3F66" }}
            >
              {t("chooseFileButton")}
            </span>
            <span className="truncate text-sm" style={{ color: "#A9AAC4" }}>
              {fileLabel}
            </span>
            <input
              ref={fileInputRef}
              id="import-file"
              name="file"
              type="file"
              accept=".json,application/json"
              required
              className="sr-only"
              onChange={(e) => setFileLabel(e.target.files?.[0]?.name ?? t("noFileChosen"))}
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-[11px] px-[22px] py-3 text-[15px] font-bold text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ background: "#5663AE" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v13"></path>
            <path d="m7 11 5 5 5-5"></path>
            <path d="M5 21h14"></path>
          </svg>
          {pending ? tCommon("importing") : tCommon("startImportButton")}
        </button>
      </form>

      {state.error && (
        <div role="alert" className="mt-4 flex flex-col gap-1 text-sm" style={{ color: "#B24343" }}>
          <p>{state.error}</p>
          {state.errors && state.errors.length > 0 && (
            <ul className="list-disc pl-5">
              {state.errors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state.success && (
        <div role="status" className="mt-4 flex flex-col gap-1 text-sm" style={{ color: "#1F8A5B" }}>
          <p>
            {t("successMessage", {
              moduleCount: state.moduleCount ?? 0,
              lessonCount: state.lessonCount ?? 0,
              videoCount: state.videoCount ?? 0,
            })}
          </p>
          <a
            href={`/admin/kurse/${state.courseId}`}
            className="underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {t("goToCourseLink")}
          </a>
        </div>
      )}
    </div>
  );
}
