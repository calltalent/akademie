"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { askTutor, escalateToTrainer } from "@/lib/tutor/actions";
import type { AskTutorResult, TutorSource } from "@/lib/tutor/state";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: TutorSource[];
};

type PanelStatus =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "error"; message: string }
  | { status: "quota_exceeded"; message: string };

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Tutor-Chat-UI (Phase 3, Block 4). Nachrichtenverlauf lebt bewusst nur im
 * Client-State der aktuellen Seitenansicht (siehe PHASENSTATUS.md, bewusste
 * Vereinfachung) — `tutor_messages` wird trotzdem vollständig serverseitig
 * über `askTutor()`/`recordTutorMessage()` protokolliert.
 *
 * Barrierefreiheit (CLAUDE.md §3.4): `<label>` (sr-only) für das
 * Eingabefeld, Nachrichtenverlauf als `role="log"` + `aria-live="polite"`,
 * kein Fokusverlust nach dem Absenden (Eingabefeld wird nie `disabled`,
 * nur der Absenden-Button; Fokus wird nach dem Absenden aktiv
 * zurückgesetzt), Buttons mit vollständigem Text statt reinem Icon.
 *
 * PFLICHT-Kennzeichnung (CLAUDE.md §3.6, Art. 50 KI-VO, SPEC Zeile 83):
 * das "KI-Assistent"-Badge neben der Überschrift ist IMMER sichtbar,
 * unabhängig vom Konversationsverlauf oder Ladezustand.
 */
export function TutorPanel({
  courseId,
  courseSlug,
  currentLessonId,
}: {
  courseId: string;
  courseSlug: string;
  currentLessonId: string;
}) {
  const inputId = useId();
  const headingId = `${inputId}-heading`;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [state, setState] = useState<PanelStatus>({ status: "idle" });
  const [escalated, setEscalated] = useState(false);
  const [escalationMessage, setEscalationMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed.length === 0) return;

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: trimmed }]);
    setInput("");
    setState({ status: "sending" });
    // Fokus sofort zurück ins Eingabefeld (der Klick auf den Absenden-Button
    // hätte den Fokus sonst dorthin verschoben).
    inputRef.current?.focus();

    startTransition(async () => {
      const result: AskTutorResult = await askTutor({ courseId, conversationId, message: trimmed });
      if (result.ok) {
        setConversationId(result.conversationId);
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: result.answer, sources: result.sources },
        ]);
        setState({ status: "idle" });
      } else if (result.reason === "quota_exceeded") {
        setState({ status: "quota_exceeded", message: result.message });
      } else {
        setState({ status: "error", message: result.message });
      }
      inputRef.current?.focus();
    });
  }

  function handleEscalate() {
    if (!conversationId) return;
    startTransition(async () => {
      const result = await escalateToTrainer(conversationId);
      setEscalationMessage(result.message);
      if (result.success) setEscalated(true);
    });
  }

  const sending = pending && state.status === "sending";

  return (
    <section aria-labelledby={headingId} className="rounded-md border p-4" style={{ borderRadius: "var(--radius)" }}>
      <div className="mb-3 flex items-center gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          Tutor
        </h2>
        <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600">
          KI-Assistent
        </span>
      </div>

      <div
        role="log"
        aria-live="polite"
        aria-label="Tutor-Konversation"
        className="mb-3 flex max-h-80 flex-col gap-3 overflow-y-auto"
      >
        {messages.length === 0 && (
          <p className="text-sm text-gray-500">
            Stelle eine Frage zu diesem Kurs — der KI-Assistent antwortet ausschließlich auf Basis der
            Kursinhalte und sagt ehrlich, wenn etwas nicht im Kurs steht.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "self-end text-right" : "self-start"}>
            <p
              className="inline-block px-3 py-2 text-sm"
              style={{
                borderRadius: "var(--radius)",
                background: m.role === "user" ? "var(--color-primary)" : "#f3f4f6",
                color: m.role === "user" ? "#ffffff" : "inherit",
              }}
            >
              {m.content}
            </p>
            {m.sources && m.sources.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-gray-500">
                {m.sources.map((s) => (
                  <li key={s.lessonId}>
                    Quelle:{" "}
                    {s.lessonId === currentLessonId ? (
                      s.lessonTitle
                    ) : (
                      <a href={`/kurs/${courseSlug}/l/${s.lessonId}`} className="underline">
                        {s.lessonTitle}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {state.status === "quota_exceeded" && (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {state.message} Bitte wende dich an dein Team oder versuche es im nächsten Monat erneut.
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {state.message}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="sr-only">
          Frage an den Tutor
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
          rows={2}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Frage zum Kurs stellen …"
          className="w-full rounded-md border px-3 py-2 text-base"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={pending || input.trim().length === 0}
            className="rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
            style={{ background: "var(--color-primary)" }}
          >
            {sending ? "Wird gesendet …" : "Frage senden"}
          </button>
          {conversationId && !escalated && (
            <button
              type="button"
              onClick={handleEscalate}
              disabled={pending}
              className="rounded-md border px-4 py-2 text-base disabled:opacity-50"
            >
              An Trainer weiterleiten
            </button>
          )}
          {escalated && <span className="text-sm text-green-700">An Trainer weitergeleitet ✓</span>}
        </div>
        {escalationMessage && !escalated && (
          <p role="alert" className="text-sm text-red-600">
            {escalationMessage}
          </p>
        )}
      </form>
    </section>
  );
}
