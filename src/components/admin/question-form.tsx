"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { upsertQuestion } from "@/lib/quiz/actions";
import {
  createEmptyQuestionDraft,
  QUESTION_KINDS,
  type Question,
  type QuestionInput,
  type QuestionKind,
} from "@/lib/quiz/schema";

function toDraft(initial: Question | null): QuestionInput {
  if (!initial) return createEmptyQuestionDraft("single");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- absichtliches Omit-Idiom: "id" aus dem Objekt herausdestrukturieren, um es aus "rest" auszuschließen
  const { id: _id, ...rest } = initial;
  return rest;
}

/**
 * Ein Formular je Fragetyp, analog zu block-form.tsx (dynamisches Formular
 * je nach `kind`). Kein <form action=…> mit useActionState, weil die
 * Antwort-/Optionen-Struktur pro Fragetyp zu unterschiedlich ist, um sie
 * über FormData abzubilden — stattdessen ein JSON-Objekt (`draft`) direkt an
 * upsertQuestion() übergeben, serverseitig per questionInputSchema geprüft.
 */
export function QuestionForm({
  quizId,
  courseId,
  questionId,
  initial,
  onDone,
  onCancel,
}: {
  quizId: string;
  courseId: string;
  questionId: string | null;
  initial: Question | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("admin.courseEditor.question");
  const tCommon = useTranslations("common");
  const tAdminCommon = useTranslations("admin.common");
  const tQuestionKinds = useTranslations("quiz.questionKinds");
  const [draft, setDraft] = useState<QuestionInput>(() => toDraft(initial));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function switchKind(newKind: QuestionKind) {
    const empty = createEmptyQuestionDraft(newKind);
    setDraft({ ...empty, prompt: draft.prompt, points: draft.points } as QuestionInput);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    // Leere Zeilen aus dem Zeilen-Textarea (gap) entfernen, bevor validiert
    // wird — während des Tippens sind Leerzeilen im lokalen State erlaubt.
    const payload: QuestionInput =
      draft.kind === "gap"
        ? { ...draft, answer: { ...draft.answer, values: draft.answer.values.map((v) => v.trim()).filter((v) => v.length > 0) } }
        : draft;
    const result = await upsertQuestion(quizId, courseId, questionId, payload);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm" htmlFor="question-kind">
        {t("kindLabel")}
        <select
          id="question-kind"
          value={draft.kind}
          onChange={(e) => switchKind(e.target.value as QuestionKind)}
          className="rounded-md border px-3 py-2 text-base"
        >
          {QUESTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {tQuestionKinds(k)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm" htmlFor="question-prompt">
        {t("promptLabel")}
        <textarea
          id="question-prompt"
          value={draft.prompt}
          onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          rows={2}
          required
          className="w-full rounded-md border px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm" htmlFor="question-points">
        {t("pointsLabel")}
        <input
          id="question-points"
          type="number"
          min={1}
          max={100}
          value={draft.points}
          onChange={(e) => setDraft({ ...draft, points: Number(e.target.value) })}
          className="w-32 rounded-md border px-3 py-2 text-base"
        />
      </label>

      {(draft.kind === "single" || draft.kind === "multi") && (
        <OptionsFields draft={draft} onChange={setDraft} />
      )}

      {draft.kind === "gap" && <GapFields draft={draft} onChange={setDraft} />}

      {draft.kind === "open" && (
        <p className="text-sm text-gray-500">{t("openAnswerHint")}</p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
          style={{ background: "var(--color-primary)" }}
        >
          {pending ? tAdminCommon("saving") : t("saveButton")}
        </button>
        <button type="button" onClick={onCancel} className="text-sm underline">
          {tCommon("cancel")}
        </button>
      </div>
    </form>
  );
}

function OptionsFields({
  draft,
  onChange,
}: {
  draft: Extract<QuestionInput, { kind: "single" | "multi" }>;
  onChange: (next: QuestionInput) => void;
}) {
  const t = useTranslations("admin.courseEditor.question");
  function updateOptionText(optionId: string, text: string) {
    onChange({
      ...draft,
      options: draft.options.map((o) => (o.id === optionId ? { ...o, text } : o)),
    });
  }

  function addOption() {
    onChange({ ...draft, options: [...draft.options, { id: crypto.randomUUID(), text: "" }] });
  }

  function removeOption(optionId: string) {
    const options = draft.options.filter((o) => o.id !== optionId);
    if (draft.kind === "single") {
      const correctOptionId =
        draft.answer.correctOptionId === optionId ? (options[0]?.id ?? "") : draft.answer.correctOptionId;
      onChange({ ...draft, options, answer: { correctOptionId } });
    } else {
      onChange({
        ...draft,
        options,
        answer: { correctOptionIds: draft.answer.correctOptionIds.filter((id) => id !== optionId) },
      });
    }
  }

  function setCorrectSingle(optionId: string) {
    if (draft.kind !== "single") return;
    onChange({ ...draft, answer: { correctOptionId: optionId } });
  }

  function toggleCorrectMulti(optionId: string, checked: boolean) {
    if (draft.kind !== "multi") return;
    const current = new Set(draft.answer.correctOptionIds);
    if (checked) current.add(optionId);
    else current.delete(optionId);
    onChange({ ...draft, answer: { correctOptionIds: Array.from(current) } });
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">
        {draft.kind === "single" ? t("optionsLegendSingle") : t("optionsLegendMulti")}
      </legend>
      {draft.options.map((option, idx) => (
        <div key={option.id} className="flex items-center gap-2">
          {draft.kind === "single" ? (
            <input
              type="radio"
              id={`correct-${option.id}`}
              name="correct-option"
              checked={draft.answer.correctOptionId === option.id}
              onChange={() => setCorrectSingle(option.id)}
              aria-label={t("optionCorrectAria", { n: idx + 1 })}
            />
          ) : (
            <input
              type="checkbox"
              id={`correct-${option.id}`}
              checked={draft.answer.correctOptionIds.includes(option.id)}
              onChange={(e) => toggleCorrectMulti(option.id, e.target.checked)}
              aria-label={t("optionCorrectAria", { n: idx + 1 })}
            />
          )}
          <label htmlFor={`option-text-${option.id}`} className="sr-only">
            {t("optionTextLabel", { n: idx + 1 })}
          </label>
          <input
            id={`option-text-${option.id}`}
            value={option.text}
            onChange={(e) => updateOptionText(option.id, e.target.value)}
            placeholder={t("optionPlaceholder", { n: idx + 1 })}
            required
            className="flex-1 rounded-md border px-3 py-2 text-base"
          />
          <button
            type="button"
            aria-label={t("optionRemoveAria", { n: idx + 1 })}
            disabled={draft.options.length <= 2}
            onClick={() => removeOption(option.id)}
            className="text-sm text-red-600 disabled:opacity-30"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addOption}
        disabled={draft.options.length >= 10}
        className="self-start rounded-md border px-3 py-1 text-sm disabled:opacity-30"
      >
        {t("addOptionButton")}
      </button>
    </fieldset>
  );
}

function GapFields({
  draft,
  onChange,
}: {
  draft: Extract<QuestionInput, { kind: "gap" }>;
  onChange: (next: QuestionInput) => void;
}) {
  const t = useTranslations("admin.courseEditor.question");
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{t("gapFieldsLegend")}</legend>
      <label className="flex flex-col gap-1 text-sm" htmlFor="gap-mode">
        {t("gapModeLabel")}
        <select
          id="gap-mode"
          value={draft.answer.mode}
          onChange={(e) => onChange({ ...draft, answer: { ...draft.answer, mode: e.target.value as "exact" | "regex" } })}
          className="rounded-md border px-3 py-2 text-base"
        >
          <option value="exact">{t("gapModeExact")}</option>
          <option value="regex">{t("gapModeRegex")}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor="gap-values">
        {draft.answer.mode === "regex" ? t("gapValuesLabelRegex") : t("gapValuesLabelExact")}
        <textarea
          id="gap-values"
          value={draft.answer.values.join("\n")}
          onChange={(e) =>
            onChange({
              ...draft,
              answer: {
                ...draft.answer,
                values: e.target.value.split("\n"),
              },
            })
          }
          rows={3}
          className="w-full rounded-md border px-3 py-2 text-base font-mono text-sm"
        />
      </label>
    </fieldset>
  );
}
