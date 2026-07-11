"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { updateQuiz, deleteQuiz, deleteQuestion, moveQuestion } from "@/lib/quiz/actions";
import { initialQuizActionState } from "@/lib/quiz/state";
import { QUIZ_KIND_LABELS, QUIZ_KINDS, QUESTION_KIND_LABELS, type Question, type QuizKind } from "@/lib/quiz/schema";
import { QuestionForm } from "@/components/admin/question-form";

type QuizMeta = {
  title: string;
  kind: QuizKind;
  passPct: number;
  timeLimitS: number | null;
  attemptsAllowed: number | null;
  shuffle: boolean;
};

/**
 * Metadaten-Formular + Fragenliste. Die Fragenliste wird bewusst NICHT in
 * lokalem State gehalten (kein Duplikat der Server-Wahrheit) — nach jeder
 * Mutation (Anlegen/Bearbeiten/Löschen/Verschieben) ruft die Komponente
 * `router.refresh()`, die Server Component (page.tsx) liefert die
 * aktualisierte `initialQuestions`-Prop neu.
 */
export function QuizEditor({
  courseId,
  quizId,
  initialMeta,
  initialQuestions,
}: {
  courseId: string;
  quizId: string;
  initialMeta: QuizMeta;
  initialQuestions: Question[];
}) {
  const router = useRouter();
  const boundUpdate = updateQuiz.bind(null, quizId, courseId);
  const [metaState, metaAction, metaPending] = useActionState(boundUpdate, initialQuizActionState);

  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  async function handleDeleteQuiz() {
    if (!confirm(`Quiz „${initialMeta.title}" wirklich löschen? Alle Fragen und Versuche werden entfernt.`)) return;
    const result = await deleteQuiz(quizId, courseId);
    if (result.ok) {
      window.location.href = `/admin/kurse/${courseId}`;
    } else {
      alert(result.error);
    }
  }

  async function handleDeleteQuestion(questionId: string) {
    if (!confirm("Frage wirklich löschen?")) return;
    await deleteQuestion(questionId, quizId, courseId);
    router.refresh();
  }

  async function handleMove(questionId: string, direction: "up" | "down") {
    await moveQuestion(questionId, quizId, courseId, direction);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-md border p-4" style={{ borderRadius: "var(--radius)" }}>
        <h2 className="mb-3 text-lg font-medium">Metadaten</h2>
        <form action={metaAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm" htmlFor="quiz-title">
            Titel
            <input
              id="quiz-title"
              name="title"
              defaultValue={initialMeta.title}
              required
              maxLength={300}
              className="rounded-md border px-3 py-2 text-base"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="quiz-kind">
            Art
            <select
              id="quiz-kind"
              name="kind"
              defaultValue={initialMeta.kind}
              className="rounded-md border px-3 py-2 text-base"
            >
              {QUIZ_KINDS.map((k) => (
                <option key={k} value={k}>
                  {QUIZ_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="quiz-pass-pct">
            Bestehensgrenze (%)
            <input
              id="quiz-pass-pct"
              name="passPct"
              type="number"
              min={0}
              max={100}
              defaultValue={initialMeta.passPct}
              required
              className="rounded-md border px-3 py-2 text-base"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="quiz-attempts">
            Erlaubte Versuche (leer = unbegrenzt)
            <input
              id="quiz-attempts"
              name="attemptsAllowed"
              type="number"
              min={1}
              max={50}
              defaultValue={initialMeta.attemptsAllowed ?? ""}
              className="rounded-md border px-3 py-2 text-base"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="quiz-time-limit">
            Zeitlimit in Sekunden (leer = kein Limit — nur Anzeige, nicht serverseitig durchgesetzt)
            <input
              id="quiz-time-limit"
              name="timeLimitS"
              type="number"
              min={0}
              defaultValue={initialMeta.timeLimitS ?? ""}
              className="rounded-md border px-3 py-2 text-base"
            />
          </label>

          <label className="flex items-center gap-2 text-sm" htmlFor="quiz-shuffle">
            <input id="quiz-shuffle" type="checkbox" name="shuffle" defaultChecked={initialMeta.shuffle} />
            Reihenfolge der Fragen für Lernende mischen
          </label>

          {metaState.error && (
            <p role="alert" className="text-sm text-red-600">
              {metaState.error}
            </p>
          )}
          {metaState.success && !metaState.error && <p className="text-sm text-green-700">Gespeichert.</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={metaPending}
              className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
            >
              Speichern
            </button>
            <button type="button" onClick={handleDeleteQuiz} className="text-sm text-red-600">
              Quiz löschen
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Fragen ({initialQuestions.length})</h2>
        <ul className="flex flex-col gap-3">
          {initialQuestions.map((q, idx) => (
            <li key={q.id} className="rounded-md border p-3" style={{ borderRadius: "var(--radius)" }}>
              {editingQuestionId === q.id ? (
                <QuestionForm
                  quizId={quizId}
                  courseId={courseId}
                  questionId={q.id}
                  initial={q}
                  onDone={() => {
                    setEditingQuestionId(null);
                    router.refresh();
                  }}
                  onCancel={() => setEditingQuestionId(null)}
                />
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500">{QUESTION_KIND_LABELS[q.kind]}</p>
                    <p className="text-base">{q.prompt || "(ohne Text)"}</p>
                    <p className="text-xs text-gray-500">{q.points} Punkt(e)</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      aria-label="Frage nach oben"
                      disabled={idx === 0}
                      onClick={() => handleMove(q.id, "up")}
                      className="text-sm disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Frage nach unten"
                      disabled={idx === initialQuestions.length - 1}
                      onClick={() => handleMove(q.id, "down")}
                      className="text-sm disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button type="button" onClick={() => setEditingQuestionId(q.id)} className="text-sm underline">
                      Bearbeiten
                    </button>
                    <button type="button" onClick={() => handleDeleteQuestion(q.id)} className="text-sm text-red-600">
                      Löschen
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {initialQuestions.length === 0 && (
            <p className="text-sm text-gray-500">Noch keine Fragen angelegt.</p>
          )}
        </ul>

        {addingNew ? (
          <div className="mt-3 rounded-md border p-3" style={{ borderRadius: "var(--radius)" }}>
            <QuestionForm
              quizId={quizId}
              courseId={courseId}
              questionId={null}
              initial={null}
              onDone={() => {
                setAddingNew(false);
                router.refresh();
              }}
              onCancel={() => setAddingNew(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            className="mt-3 rounded-md border px-3 py-2 text-sm"
            style={{ borderRadius: "var(--radius)" }}
          >
            + Frage hinzufügen
          </button>
        )}
      </section>
    </div>
  );
}
