"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { startAttempt, submitAttempt } from "@/lib/quiz/actions";
import type { LearnerQuestion, LearnerQuiz } from "@/lib/quiz/load";

type Phase = "intro" | "running" | "result";

type Answers = Record<string, string | string[]>;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Rendert Fragen OHNE Lösung (bereits durch loadQuizForLearner entfernt),
 * sammelt Antworten im Client-State, ruft submitAttempt() für die
 * serverseitige Auswertung. Zeitlimit ist bewusst nur Anzeige, nicht
 * technisch durchgesetzt (siehe PHASENSTATUS.md).
 */
export function QuizRunner({ quiz }: { quiz: LearnerQuiz }) {
  const t = useTranslations("quiz");
  const [phase, setPhase] = useState<Phase>("intro");
  const [attemptsUsed, setAttemptsUsed] = useState(quiz.attemptsUsed);
  const [answers, setAnswers] = useState<Answers>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ scorePct: number; passed: boolean } | null>(null);
  const [remainingS, setRemainingS] = useState<number | null>(quiz.timeLimitS);

  // Fragenreihenfolge einmal pro Versuch mischen, wenn settings.shuffle
  // gesetzt ist — rein clientseitig/kosmetisch, ändert nichts an der
  // serverseitigen Bewertung (die arbeitet über questionId, nicht Position).
  //
  // Korrektur (Josips Lint-Lauf, 12.07.2026): eslint verlangt ein Array aus
  // "einfachen Ausdrücken" (Identifier), kein Vergleichsausdruck direkt im
  // Deps-Array — deshalb vorher in eine benannte Variable ausgelagert,
  // Verhalten unverändert.
  const isRunning = phase === "running";
  const questions = useMemo<LearnerQuestion[]>(
    () => (quiz.shuffle ? shuffle(quiz.questions) : quiz.questions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isRunning],
  );

  useEffect(() => {
    if (phase !== "running" || quiz.timeLimitS === null) return;
    const interval = setInterval(() => {
      setRemainingS((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, quiz.timeLimitS]);

  const attemptsExhausted = quiz.attemptsAllowed !== null && attemptsUsed >= quiz.attemptsAllowed;

  async function handleStart() {
    setPending(true);
    setError(null);
    const res = await startAttempt(quiz.id);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRemainingS(quiz.timeLimitS);
    setAnswers({});
    setPhase("running");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await submitAttempt(quiz.id, answers);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAttemptsUsed(res.result.attemptsUsed);
    setResult({ scorePct: res.result.scorePct, passed: res.result.passed });
    setPhase("result");
  }

  function updateSingle(questionId: string, optionId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
  }

  function toggleMulti(questionId: string, optionId: string, checked: boolean) {
    setAnswers((prev) => {
      const current = new Set(Array.isArray(prev[questionId]) ? (prev[questionId] as string[]) : []);
      if (checked) current.add(optionId);
      else current.delete(optionId);
      return { ...prev, [questionId]: Array.from(current) };
    });
  }

  function updateText(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  const attemptsLabel =
    quiz.attemptsAllowed === null
      ? t("attemptsUnlimited")
      : t("attemptsRemaining", { count: Math.max(0, quiz.attemptsAllowed - attemptsUsed), total: quiz.attemptsAllowed });

  return (
    <div className="rounded-md border p-4" style={{ borderRadius: "var(--radius)" }}>
      <h3 className="mb-1 text-lg font-medium">{quiz.title}</h3>
      <p className="mb-3 text-sm text-gray-500">
        {quiz.kind === "exam" ? t("kinds.exam") : t("kinds.quiz")} — {t("passThreshold", { passPct: quiz.passPct })} —{" "}
        {t("attemptsPrefix", { attempts: attemptsLabel })}
        {quiz.timeLimitS !== null && ` — ${t("timeLimitLabel", { time: formatSeconds(quiz.timeLimitS) })}`}
      </p>

      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {phase === "intro" && (
        <div>
          {attemptsExhausted ? (
            <p className="text-base text-gray-700">{t("attemptsExhausted")}</p>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={handleStart}
              className="rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
            >
              {pending ? t("starting") : t("start")}
            </button>
          )}
        </div>
      )}

      {phase === "running" && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {remainingS !== null && (
            <p aria-live="polite" className={`text-sm ${remainingS === 0 ? "text-red-600" : "text-gray-500"}`}>
              {t("remainingTimeLabel", { time: formatSeconds(remainingS) })}
            </p>
          )}

          {questions.map((q, idx) => (
            <QuestionField
              key={q.id}
              question={q}
              index={idx}
              answer={answers[q.id]}
              onSingle={(optionId) => updateSingle(q.id, optionId)}
              onMultiToggle={(optionId, checked) => toggleMulti(q.id, optionId, checked)}
              onText={(value) => updateText(q.id, value)}
            />
          ))}

          <button
            type="submit"
            disabled={pending}
            className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
            style={{ background: "var(--color-primary)" }}
          >
            {pending ? t("evaluating") : t("submit")}
          </button>
        </form>
      )}

      {phase === "result" && result && (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <p className={`text-lg font-medium ${result.passed ? "text-green-700" : "text-red-600"}`}>
            {result.passed ? t("passed") : t("failed")} — {result.scorePct}%
          </p>
          <p className="text-sm text-gray-500">{t("attemptsPrefix", { attempts: attemptsLabel })}</p>
          {!attemptsExhausted && (
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setPhase("intro");
              }}
              className="self-start rounded-md border px-3 py-2 text-sm"
            >
              {t("retry")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionField({
  question,
  index,
  answer,
  onSingle,
  onMultiToggle,
  onText,
}: {
  question: LearnerQuestion;
  index: number;
  answer: string | string[] | undefined;
  onSingle: (optionId: string) => void;
  onMultiToggle: (optionId: string, checked: boolean) => void;
  onText: (value: string) => void;
}) {
  const t = useTranslations("quiz");
  return (
    <fieldset className="flex flex-col gap-2 border-t pt-4">
      <legend className="text-base font-medium">
        {index + 1}. {question.prompt}{" "}
        <span className="text-xs text-gray-500">({t("pointsLabel", { points: question.points })})</span>
      </legend>

      {question.kind === "single" &&
        question.options.map((opt) => (
          <div key={opt.id} className="flex items-center gap-2">
            <input
              type="radio"
              id={`${question.id}-${opt.id}`}
              name={question.id}
              checked={answer === opt.id}
              onChange={() => onSingle(opt.id)}
            />
            <label htmlFor={`${question.id}-${opt.id}`} className="text-base">
              {opt.text}
            </label>
          </div>
        ))}

      {question.kind === "multi" &&
        question.options.map((opt) => (
          <div key={opt.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`${question.id}-${opt.id}`}
              checked={Array.isArray(answer) && answer.includes(opt.id)}
              onChange={(e) => onMultiToggle(opt.id, e.target.checked)}
            />
            <label htmlFor={`${question.id}-${opt.id}`} className="text-base">
              {opt.text}
            </label>
          </div>
        ))}

      {question.kind === "gap" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`answer-${question.id}`} className="text-sm">
            {t("answerLabel")}
          </label>
          <input
            id={`answer-${question.id}`}
            type="text"
            value={typeof answer === "string" ? answer : ""}
            onChange={(e) => onText(e.target.value)}
            className="rounded-md border px-3 py-2 text-base"
          />
        </div>
      )}

      {question.kind === "open" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`answer-${question.id}`} className="text-sm">
            {t("openAnswerLabel")}
          </label>
          <textarea
            id={`answer-${question.id}`}
            value={typeof answer === "string" ? answer : ""}
            onChange={(e) => onText(e.target.value)}
            rows={3}
            className="rounded-md border px-3 py-2 text-base"
          />
        </div>
      )}
    </fieldset>
  );
}
