"use client";

import { useRef, useState } from "react";
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
    return (
      <div className="rounded-md border p-4 text-base" style={{ borderRadius: "var(--radius)" }}>
        <p className="mb-2 font-medium">Abgabe</p>
        <p className="text-gray-700">{instructions}</p>
        <p role="status" aria-live="polite" className="mt-3 font-medium">
          Status: {SUBMISSION_STATUS_LABELS[submitted.status]}
        </p>
        <p className="text-sm text-gray-500">Eingereicht am {formatDate(submitted.createdAt)}</p>
        {submitted.feedback && (
          <div className="mt-2 rounded-md border bg-gray-50 p-3 text-sm">{submitted.feedback}</div>
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
    <div className="rounded-md border p-4 text-base" style={{ borderRadius: "var(--radius)" }}>
      <p className="mb-2 font-medium">Abgabe</p>
      <p className="mb-3 text-gray-700">{instructions}</p>

      <div className="mb-3 flex gap-2" role="group" aria-label="Art der Abgabe">
        <button
          type="button"
          onClick={() => setMode("text")}
          aria-pressed={mode === "text"}
          className="rounded-md border px-3 py-1.5 text-sm"
          style={{
            borderRadius: "var(--radius)",
            background: mode === "text" ? "var(--color-primary)" : "transparent",
            color: mode === "text" ? "#ffffff" : "inherit",
          }}
        >
          Text
        </button>
        <button
          type="button"
          onClick={() => setMode("file")}
          aria-pressed={mode === "file"}
          className="rounded-md border px-3 py-1.5 text-sm"
          style={{
            borderRadius: "var(--radius)",
            background: mode === "file" ? "var(--color-primary)" : "transparent",
            color: mode === "file" ? "#ffffff" : "inherit",
          }}
        >
          Datei
        </button>
      </div>

      {mode === "text" ? (
        <form onSubmit={handleTextSubmit} className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="submission-text">
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
            className="w-full rounded-md border px-3 py-2 text-base"
          />
          <p id="submission-text-count" className="text-xs text-gray-500">
            {text.length} / {MAX_TEXT_LENGTH} Zeichen
          </p>
          <button
            type="submit"
            disabled={pending || text.trim().length === 0}
            className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
            style={{ background: "var(--color-primary)" }}
          >
            {pending ? "Wird eingereicht …" : "Abgabe einreichen"}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="submission-file">
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
          />
        </div>
      )}

      <p aria-live="polite" className="mt-2 text-sm">
        {state.status === "uploading" && <span className="text-gray-500">Datei wird hochgeladen …</span>}
        {state.status === "submitting" && <span className="text-gray-500">Wird übermittelt …</span>}
        {state.status === "error" && (
          <span role="alert" className="text-red-600">
            {state.message}
          </span>
        )}
      </p>
    </div>
  );
}
