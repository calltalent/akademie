"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Upload, Sparkles } from "lucide-react";

type CourseOption = { id: string; title: string };

/**
 * "Neuer Entwurf"-Formular (Design-Import AdminKiGenerator.dc.html,
 * 19.07.2026) — echte Drag&Drop-Dropzone statt des bisherigen reinen
 * `<input type="file">`, plus eine neue "Zielkurs"-Auswahl (bisher konnte
 * der Generator ausschließlich neue Kurse anlegen, siehe Kommentar in
 * `lib/generator/apply.ts`). Der bisherige optionale "Arbeitstitel"-Titel
 * entfällt bewusst — der Export sieht dieses Feld nicht vor, und Claude
 * leitet den Titel ohnehin aus dem Dokumentinhalt ab.
 *
 * Nach erfolgreichem Upload direkte Weiterleitung auf die neue
 * Review-Seite `/admin/ki/[jobId]` statt (wie vorher) eines Inline-Panels
 * auf derselben Seite — der Fortschritt/die Vorschau lebt jetzt dort, die
 * Listenseite bleibt die Übersicht über ALLE Entwürfe.
 */
export function KiUploadForm({ courseOptions }: { courseOptions: CourseOption[] }) {
  const t = useTranslations("admin.ki");
  const [file, setFile] = useState<File | null>(null);
  const [targetCourseId, setTargetCourseId] = useState("new");
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const router = useRouter();

  function pickFile(f: File | null) {
    if (f && f.type !== "application/pdf") {
      setError(t("fileRequiredError"));
      return;
    }
    setError(null);
    setFile(f);
  }

  async function handleSubmit() {
    if (!file) {
      setError(t("fileRequiredError"));
      return;
    }
    setError(null);
    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("targetCourseId", targetCourseId);

    try {
      const res = await fetch("/api/admin/ki/generate", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("uploadGenericError"));
        setIsUploading(false);
        return;
      }
      router.push(`/admin/ki/${data.jobId}`);
    } catch {
      setError(t("uploadNetworkError"));
      setIsUploading(false);
    }
  }

  return (
    <div className="rounded-[14px] border bg-white p-[28px]" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-4 text-[17px] font-bold">{t("uploadHeading")}</div>

      <label
        className="flex flex-col items-center justify-center gap-2.5 rounded-[12px] p-[40px_20px] text-center"
        style={{
          border: `2px dashed ${dragActive ? "#5663AE" : "#D6D8EA"}`,
          background: dragActive ? "#F4F5FA" : undefined,
          cursor: "pointer",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          pickFile(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        <span
          className="flex h-[46px] w-[46px] items-center justify-center rounded-[12px]"
          style={{ background: "#EAEBF7" }}
          aria-hidden="true"
        >
          <Upload size={20} color="#5663AE" strokeWidth={2.2} />
        </span>
        <span className="text-[15px] font-semibold">
          {file ? file.name : t("dropzoneLabel")}
        </span>
        <span className="text-[13px]" style={{ color: "#A9AAC4" }}>
          {t("dropzoneHint")}
        </span>
        <input
          type="file"
          accept=".pdf,application/pdf"
          className="sr-only"
          aria-label={t("filePickerAria")}
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <div className="mt-[18px] flex items-center gap-2.5">
        <label htmlFor="ki-target-course" className="flex-none text-[13px] font-semibold" style={{ color: "#66679B" }}>
          {t("targetCourseLabel")}
        </label>
        <select
          id="ki-target-course"
          value={targetCourseId}
          onChange={(e) => setTargetCourseId(e.target.value)}
          className="w-full flex-1 rounded-[10px] border bg-white px-[13px] py-2.5 text-sm"
          style={{ borderColor: "#E7E8F2", color: "#1A1A2E" }}
        >
          <option value="new">{t("newCourseOption")}</option>
          {courseOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold" style={{ color: "#B24343" }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isUploading}
        className="mt-[18px] flex w-full items-center justify-center gap-2 rounded-[11px] px-[18px] py-[13px] text-[15px] font-bold text-white disabled:opacity-50"
        style={{ background: "#5663AE" }}
      >
        <Sparkles size={16} aria-hidden="true" />
        {isUploading ? t("uploading") : t("generateButton")}
      </button>
    </div>
  );
}
