"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { updateCourseGoals, updateCourseAuthor } from "@/lib/courses/actions";

/**
 * Kursinformation für den Information-Tab der Lernansicht (Josips Auftrag,
 * 24.07.2026 — Informations-Tab nach Baulig-Vorbild, Migration
 * 20260724130000_course_information.sql). Zwei unabhängige Abschnitte in
 * einer Karte:
 *
 * - Kursziele: dynamische Liste, Speichern erst per Klick (kein Auto-Save
 *   pro Tastenanschlag wie bei der Kursbeschreibung — bewusst einfacher, da
 *   Array-Änderungen sonst bei jedem Tastenanschlag das gesamte Array
 *   überschreiben würden).
 * - Autor: `<select>` mit sofortiger Übernahme bei Auswahl (`useTransition`),
 *   exaktes Vorbild `CourseCategorySelect` (publish-toggle.tsx).
 */
export function CourseInfoEditor({
  courseId,
  initialGoals,
  initialAuthorId,
  trainers,
}: {
  courseId: string;
  initialGoals: string[];
  initialAuthorId: string | null;
  trainers: { id: string; name: string }[];
}) {
  return (
    <section className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-1.5 text-[17px] font-bold">Kursinformation (Information-Tab)</div>
      <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
        Kursziele und Autor erscheinen im „Information“-Tab der Lernansicht.
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <GoalsEditor courseId={courseId} initialGoals={initialGoals} />
        <AuthorSelect courseId={courseId} initialAuthorId={initialAuthorId} trainers={trainers} />
      </div>
    </section>
  );
}

function GoalsEditor({ courseId, initialGoals }: { courseId: string; initialGoals: string[] }) {
  const [goals, setGoals] = useState<string[]>(initialGoals.length > 0 ? initialGoals : [""]);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function updateGoal(index: number, value: string) {
    setGoals((prev) => prev.map((g, i) => (i === index ? value : g)));
    setSaved(false);
  }

  function removeGoal(index: number) {
    setGoals((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  }

  function addGoal() {
    setGoals((prev) => [...prev, ""]);
    setSaved(false);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const cleaned = goals.map((g) => g.trim()).filter((g) => g.length > 0);
      const result = await updateCourseGoals(courseId, cleaned);
      if (result.error) {
        setError(result.error);
        return;
      }
      setGoals(cleaned.length > 0 ? cleaned : [""]);
      setSaved(true);
    });
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 text-[13px] font-bold" style={{ color: "#3E3F66" }}>
        Kursziele
      </div>
      <div className="flex flex-col gap-2">
        {goals.map((goal, index) => (
          <div key={index} className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`goal-${courseId}-${index}`}>
              Kursziel {index + 1}
            </label>
            <input
              id={`goal-${courseId}-${index}`}
              type="text"
              maxLength={300}
              value={goal}
              onChange={(e) => updateGoal(index, e.target.value)}
              placeholder="z. B. Kundengespräche sicher führen"
              className="w-full rounded-[10px] border px-3 py-2 text-[15px]"
              style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
            />
            <button
              type="button"
              aria-label={`Kursziel ${index + 1} entfernen`}
              onClick={() => removeGoal(index)}
              className="flex-none rounded-md border px-2 py-2 text-sm"
              style={{ borderColor: "#D8DAEA", color: "#66679B" }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={addGoal}
          className="rounded-[10px] border px-4 py-2 text-sm font-semibold"
          style={{ borderColor: "#D8DAEA", color: "#3E3F66" }}
        >
          + Ziel hinzufügen
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded-[10px] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          {pending ? "Speichert…" : "Kursziele speichern"}
        </button>
        {!pending && saved && (
          <span role="status" className="text-sm font-semibold" style={{ color: "#3E8F5C" }}>
            Gespeichert
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function AuthorSelect({
  courseId,
  initialAuthorId,
  trainers,
}: {
  courseId: string;
  initialAuthorId: string | null;
  trainers: { id: string; name: string }[];
}) {
  const [authorId, setAuthorId] = useState(initialAuthorId ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <label
      className="flex w-full max-w-[260px] flex-none flex-col gap-1.5 text-[13px] font-bold"
      style={{ color: "#3E3F66" }}
    >
      Autor
      <select
        value={authorId}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value || null;
          setAuthorId(next ?? "");
          startTransition(() => {
            updateCourseAuthor(courseId, next);
          });
        }}
        className="min-w-[150px] rounded-[11px] border bg-white px-3 py-2.5 text-[15px] font-semibold disabled:opacity-50"
        style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
      >
        <option value="">— kein Autor —</option>
        {trainers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
