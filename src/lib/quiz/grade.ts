import type { Question } from "@/lib/quiz/schema";

/**
 * Reine, seiteneffektfreie Bewertungsfunktion — keine DB-Zugriffe. Wird
 * ausschließlich serverseitig aus submitAttempt() aufgerufen (nie mit
 * Client-Eingaben für `questions`, die Lösungen enthalten).
 *
 * Entscheidungen (dokumentiert wie von der Aufgabe verlangt):
 * - `multi`: Alles-oder-nichts (keine Teilpunkte) — einfachste, eindeutige
 *   Regel; vermeidet Diskussionen über Teilpunkt-Gewichtung in v1.
 * - `open`-Fragen: `correct: null`, `earnedPoints: 0`, fließen WEDER in den
 *   Zähler NOCH in den Nenner von scorePct ein (SPEC-Abweichung, siehe
 *   PHASENSTATUS.md — freie Textbewertung überschneidet sich mit dem
 *   künftigen Abgaben-Bewertungspfad aus Block 3).
 * - Keine bewertbaren Fragen (Nenner 0): scorePct = 0.
 * - Keine Antwort für eine Frage gegeben: wird wie eine falsche Antwort
 *   behandelt (nie ein Fehler/Absturz).
 * - `passPct` ist Pflichtparameter (nicht Teil von `Question[]`) — die
 *   Bestehensgrenze liegt auf `quizzes.pass_pct`, nicht auf einzelnen Fragen.
 */

export type PerQuestionResult = {
  questionId: string;
  correct: boolean | null;
  points: number;
  earnedPoints: number;
};

export type GradeResult = {
  scorePct: number;
  passed: boolean;
  perQuestion: PerQuestionResult[];
};

function normalizeGapValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function gradeSingle(q: Extract<Question, { kind: "single" }>, given: unknown): boolean {
  return typeof given === "string" && given === q.answer.correctOptionId;
}

function gradeMulti(q: Extract<Question, { kind: "multi" }>, given: unknown): boolean {
  if (!Array.isArray(given)) return false;
  const givenIds = new Set(given.filter((v): v is string => typeof v === "string"));
  const expectedIds = q.answer.correctOptionIds;
  if (givenIds.size !== expectedIds.length) return false;
  return expectedIds.every((id) => givenIds.has(id));
}

function gradeGap(q: Extract<Question, { kind: "gap" }>, given: unknown): boolean {
  if (typeof given !== "string" || given.trim() === "") return false;
  const trimmedGiven = given.trim();
  const normalizedGiven = normalizeGapValue(given);
  return q.answer.values.some((expected) => {
    if (q.answer.mode === "regex") {
      try {
        return new RegExp(expected, "i").test(trimmedGiven);
      } catch {
        return false; // ungültiges Muster -> nie ein Treffer, kein Absturz
      }
    }
    return normalizeGapValue(expected) === normalizedGiven;
  });
}

export function gradeAttempt(
  questions: Question[],
  answers: Record<string, unknown>,
  passPct: number,
): GradeResult {
  const perQuestion: PerQuestionResult[] = questions.map((q) => {
    if (q.kind === "open") {
      return { questionId: q.id, correct: null, points: q.points, earnedPoints: 0 };
    }
    const given = answers[q.id];
    const correct =
      q.kind === "single" ? gradeSingle(q, given) : q.kind === "multi" ? gradeMulti(q, given) : gradeGap(q, given);
    return { questionId: q.id, correct, points: q.points, earnedPoints: correct ? q.points : 0 };
  });

  const gradable = perQuestion.filter((p) => p.correct !== null);
  const totalPoints = gradable.reduce((sum, p) => sum + p.points, 0);
  const earnedPoints = gradable.reduce((sum, p) => sum + p.earnedPoints, 0);
  const scorePct = totalPoints === 0 ? 0 : Math.round((earnedPoints / totalPoints) * 100);
  const passed = scorePct >= passPct;

  return { scorePct, passed, perQuestion };
}
