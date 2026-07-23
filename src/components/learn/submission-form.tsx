"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Check, Clock, ClipboardCheck, X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { createSubmission } from "@/lib/submissions/actions";
import {
  ALLOWED_SUBMISSION_MIME_TYPES,
  MAX_SUBMISSION_FILE_SIZE_BYTES,
  SUBMISSION_STATUS_LABELS,
  type SubmissionKind,
  type SubmissionStatus,
} from "@/lib/submissions/schema";

const MAX_TEXT_LENGTH = 10000;

/**
 * Josips Auftrag (23.07.2026): "Design für Abgabe etwas ersichtlicher
 * gestalten" — vorher generische Tailwind-Graustufen (`text-gray-700` etc.),
 * kein Kartenrahmen/-radius aus dem App-Designsystem. Gleiche Status-Farb-
 * Logik wie sonst im Projekt (grün=positiv, amber=Nacharbeit, rot=negativ,
 * Indigo=neutral/wartend — vgl. LESSON_STATUS_META in module-lesson-tree.tsx).
 */
const SUBMISSION_STATUS_META: Record<SubmissionStatus, { color: string; bg: string; Icon: typeof Clock }> = {
  submitted: { color: "#5663AE", bg: "#EAEBF7", Icon: Clock },
  approved: { color: "#1F8A5B", bg: "#E3F2EA", Icon: Check },
  revision: { color: "#8A6D2F", bg: "#FBF6EA", Icon: AlertTriangle },
  rejected: { color: "#B14A4A", bg: "#FBEAEA", Icon: X },
};

export type LastSubmission = {
  id: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  feedback: string | null;
  createdAt: string;
};

type Mode = "text" | "file";

type SubmitState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "submitting" }
  | { status: "error"; message: string };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Barrierefreiheit (CLAUDE.md §3.4): echte `<label htmlFor>`-Zuordnungen,
 * `aria-pressed` für den Text/Datei-Umschalter, `aria-live` für Status-/
 * Fehlermeldungen, Zeichenzähler mit `aria-describedby`.
 *
 * Zeigt nach dem Absenden den Status der letzten eigenen Abgabe statt
 * erneut das Formular (Muster wie QuizRunner-Ergebnis in Block 2) — bewusst
 * KEIN erneutes Einreichen nach `revision`/`rejected` in v1 (siehe
 * PHASENSTATUS.md: SPEC/Plan spezifizieren keinen Mehrfach-Versuch-Flow für
 * Abgaben wie beim Quiz `attemptsAllowed`; nachrüstbar, falls gewünscht).
 */
export function SubmissionForm({
  lessonId,
  instructions,
  lastSubmission,
}: {
  lessonId: string;
  instructions: string;
  lastSubmission: LastSubmission | null;
}) {
  const [submitted, setSubmitted] = useState<LastSubmission | null>(lastSubmission);
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (submitted) {
    const meta = SUBMISSION_STATUS_META[submitted.status];
    const StatusIcon = meta.Icon;
    return (
      <div className="rounded-2xl border bg-white p-5" style={{ borderColor: "#E7E8F2" }}>
        <div className="mb-3 flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
            style={{ background: "#EDEEF7" }}
            aria-hidden="true"
          >
            <ClipboardCheck size={17} style={{ color: "var(--color-primary)" }} />
          </span>
          <span className="text-base font-extrabold" style={{ color: "#1A1A2E" }}>
            Abgabe
          </span>
        </div>
        {instructions && (
          <p className="mb-4 text-base leading-relaxed" style={{ color: "#3E3F66" }}>
            {instructions}
          </p>
        )}
        <div
          className="flex flex-wrap items-center gap-3 rounded-xl border p-3.5"
          style={{ borderColor: "#E7E8F2", background: "#FAFAFD" }}
        >
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-bold"
            style={{ color: meta.color, background: meta.bg }}
          >
            <StatusIcon size={14} aria-hidden="true" />
            {SUBMISSION_STATUS_LABELS[submitted.status]}
          </span>
          <span className="text-sm" style={{ color: "#66679B" }}>
            Eingereicht am {formatDate(submitted.createdAt)}
          </span>
        </div>
        {submitted.feedback && (
          <div
            className="mt-3 rounded-xl border p-3.5 text-sm leading-relaxed"
            style={{ borderColor: "#E7E8F2", background: "#F6F7FC", color: "#3E3F66" }}
          >
            <p className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: "#A9AAC4" }}>
              Rückmeldung
            </p>
            {submitted.feedback}
          </div>
        )}
      </div>
    );
  }

  async function handleFileChange(file: File) {
    if (!ALLOWED_SUBMISSION_MIME_TYPES.includes(file.type as (typeof ALLOWED_SUBMISSION_MIME_TYPES)[number])) {
      setState({
        status: "error",
        message: `Dateityp „${file.type || "unbekannt"}" nicht erlaubt. Erlaubt: PDF, Word, PNG/JPG, ZIP, MP4, MP3.`,
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_SUBMISSION_FILE_SIZE_BYTES) {
      setState({ status: "error", message: "Datei zu groß (max. 50 MB)." });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setState({ status: "uploading" });
    const res = await fetch("/api/submissions/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, fileSize: file.size, mimeType: file.type }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setState({ status: "error", message: body.error ?? "Upload-URL konnte nicht erzeugt werden." });
      return;
    }
    const { path, token } = (await res.json()) as { path: string; token: string; signedUrl: string };

    const browserSupabase = createBrowserClient();
    const { error: uploadError } = await browserSupabase.storage
      .from("submissions")
      .uploadToSignedUrl(path, token, file);
    if (uploadError) {
      // uploadError.message kommt von der Supabase-Storage-Bibliothek
      // (technisch/englisch) — Detail nur in der Konsole, Nutzer bekommt
      // einen klaren deutschen Satz.
      console.error("[submission-form] Datei-Upload fehlgeschlagen.", uploadError);
      setState({ status: "error", message: "Datei-Upload fehlgeschlagen. Bitte versuche es erneut." });
      return;
    }

    setState({ status: "submitting" });
    const result = await createSubmission({ lessonId, kind: "file", filePath: path });
    if (!result.ok) {
      setState({ status: "error", message: result.error });
      return;
    }
    setState({ status: "idle" });
    setSubmitted({ id: result.id, kind: "file", status: "submitted", feedback: null, createdAt: new Date().toISOString() });
  }

  async function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "submitting" });
    const result = await createSubmission({ lessonId, kind: "text", content: text });
    if (!result.ok) {
      setState({ status: "error", message: result.error });
      return;
    }
    setState({ status: "idle" });
    setSubmitted({ id: result.id, kind: "text", status: "submitted", feedback: null, createdAt: new Date().toISOString() });
  }

  const pending = state.status === "uploading" || state.status === "submitting";

  return (
    <div className="rounded-2xl border bg-white p-5" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
          style={{ background: "#EDEEF7" }}
          aria-hidden="true"
        >
          <ClipboardCheck size={17} style={{ color: "var(--color-primary)" }} />
        </span>
        <span className="text-base font-extrabold" style={{ color: "#1A1A2E" }}>
          Abgabe
        </span>
      </div>
      {instructions && (
        <p className="mb-4 text-base leading-relaxed" style={{ color: "#3E3F66" }}>
          {instructions}
        </p>
      )}

      <div className="mb-3.5 flex gap-2" role="group" aria-label="Art der Abgabe">
        <button
          type="button"
          onClick={() => setMode("text")}
          aria-pressed={mode === "text"}
          className="rounded-[10px] border px-3.5 py-2 text-sm font-bold"
          style={{
            borderColor: mode === "text" ? "var(--color-primary)" : "#D8DAEA",
            background: mode === "text" ? "var(--color-primary)" : "#fff",
            color: mode === "text" ? "#fff" : "#3E3F66",
          }}
        >
          Text
        </button>
        <button
          type="button"
          onClick={() => setMode("file")}
          aria-pressed={mode === "file"}
          className="rounded-[10px] border px-3.5 py-2 text-sm font-bold"
          style={{
            borderColor: mode === "file" ? "var(--color-primary)" : "#D8DAEA",
            background: mode === "file" ? "var(--color-primary)" : "#fff",
            color: mode === "file" ? "#fff" : "#3E3F66",
          }}
        >
          Datei
        </button>
      </div>

      {mode === "text" ? (
        <form onSubmit={handleTextSubmit} className="flex flex-col gap-2">
          <label className="text-sm font-bold" style={{ color: "#3E3F66" }} htmlFor="submission-text">
            Dein Text
          </label>
          <textarea
            id="submission-text"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_LENGTH))}
            rows={6}
            required
            maxLength={MAX_TEXT_LENGTH}
            aria-describedby="submission-text-count"
            className="w-full rounded-[11px] border px-[15px] py-[13px] text-base"
            style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
          />
          <p id="submission-text-count" className="text-xs" style={{ color: "#A9AAC4" }}>
            {text.length} / {MAX_TEXT_LENGTH} Zeichen
          </p>
          <button
            type="submit"
            disabled={pending || text.trim().length === 0}
            className="mt-1 inline-flex self-start items-center rounded-xl px-5 py-3 text-[15px] font-bold text-white disabled:opacity-50"
            style={{ background: "var(--color-primary)" }}
          >
            {pending ? "Wird eingereicht …" : "Abgabe einreichen"}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold" style={{ color: "#3E3F66" }} htmlFor="submission-file">
            Datei auswählen (PDF, Word, PNG/JPG, ZIP, MP4, MP3 — max. 50 MB)
          </label>
          <input
            id="submission-file"
            ref={fileInputRef}
            type="file"
            disabled={pending}
            accept={ALLOWED_SUBMISSION_MIME_TYPES.join(",")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileChange(file);
            }}
            className="text-sm"
            style={{ color: "#3E3F66" }}
          />
        </div>
      )}

      <p aria-live="polite" className="mt-2.5 text-sm">
        {state.status === "uploading" && <span style={{ color: "#66679B" }}>Datei wird hochgeladen …</span>}
        {state.status === "submitting" && <span style={{ color: "#66679B" }}>Wird übermittelt …</span>}
        {state.status === "error" && (
          <span role="alert" className="font-semibold" style={{ color: "#B14A4A" }}>
            {state.message}
          </span>
        )}
      </p>
    </div>
  );
}
