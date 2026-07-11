import { describe, expect, it } from "vitest";
import { gradeAttempt } from "./grade";
import type { Question } from "./schema";

const single: Question = {
  id: "q-single",
  kind: "single",
  prompt: "Hauptstadt von Deutschland?",
  points: 2,
  options: [
    { id: "a", text: "Berlin" },
    { id: "b", text: "München" },
  ],
  answer: { correctOptionId: "a" },
};

const multi: Question = {
  id: "q-multi",
  kind: "multi",
  prompt: "Welche sind Primzahlen?",
  points: 3,
  options: [
    { id: "a", text: "2" },
    { id: "b", text: "3" },
    { id: "c", text: "4" },
  ],
  answer: { correctOptionIds: ["a", "b"] },
};

const gapExact: Question = {
  id: "q-gap",
  kind: "gap",
  prompt: "Hauptstadt von Frankreich?",
  points: 1,
  options: [],
  answer: { mode: "exact", values: ["Paris"] },
};

const gapRegex: Question = {
  id: "q-gap-regex",
  kind: "gap",
  prompt: "Nenne eine gerade Zahl (Ziffer).",
  points: 1,
  options: [],
  answer: { mode: "regex", values: ["^[02468]$"] },
};

const open: Question = {
  id: "q-open",
  kind: "open",
  prompt: "Beschreibe deine Motivation.",
  points: 5,
  options: [],
  answer: {},
};

describe("gradeAttempt", () => {
  it("bewertet alles richtig als 100% bestanden", () => {
    const result = gradeAttempt(
      [single, multi, gapExact],
      {
        [single.id]: "a",
        [multi.id]: ["a", "b"],
        [gapExact.id]: "Paris",
      },
      70,
    );
    expect(result.scorePct).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.perQuestion.every((p) => p.correct === true)).toBe(true);
  });

  it("bewertet alles falsch als 0% nicht bestanden", () => {
    const result = gradeAttempt(
      [single, multi, gapExact],
      {
        [single.id]: "b",
        [multi.id]: ["c"],
        [gapExact.id]: "Berlin",
      },
      70,
    );
    expect(result.scorePct).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.perQuestion.every((p) => p.correct === false)).toBe(true);
  });

  it("multi: teilweise richtige Auswahl zählt als falsch (Alles-oder-nichts)", () => {
    const result = gradeAttempt([multi], { [multi.id]: ["a"] }, 0);
    expect(result.perQuestion[0].correct).toBe(false);
    expect(result.perQuestion[0].earnedPoints).toBe(0);
  });

  it("multi: zu viele Antworten (inkl. richtiger) zählt als falsch", () => {
    const result = gradeAttempt([multi], { [multi.id]: ["a", "b", "c"] }, 0);
    expect(result.perQuestion[0].correct).toBe(false);
  });

  it("gap: exakter Modus ist Groß-/Kleinschreibung- und Leerzeichen-tolerant", () => {
    const result = gradeAttempt([gapExact], { [gapExact.id]: "  paris  " }, 0);
    expect(result.perQuestion[0].correct).toBe(true);
  });

  it("gap: exakter Modus lehnt abweichenden Text ab", () => {
    const result = gradeAttempt([gapExact], { [gapExact.id]: "Pariss" }, 0);
    expect(result.perQuestion[0].correct).toBe(false);
  });

  it("gap: Regex-Modus akzeptiert einen Treffer", () => {
    const result = gradeAttempt([gapRegex], { [gapRegex.id]: "4" }, 0);
    expect(result.perQuestion[0].correct).toBe(true);
  });

  it("gap: Regex-Modus lehnt Nicht-Treffer ab", () => {
    const result = gradeAttempt([gapRegex], { [gapRegex.id]: "7" }, 0);
    expect(result.perQuestion[0].correct).toBe(false);
  });

  it("open-Fragen werden ausgeschlossen (weder Zähler noch Nenner)", () => {
    const result = gradeAttempt(
      [single, open],
      { [single.id]: "a", [open.id]: "Lange Freitextantwort …" },
      70,
    );
    const openResult = result.perQuestion.find((p) => p.questionId === open.id)!;
    expect(openResult.correct).toBeNull();
    expect(openResult.earnedPoints).toBe(0);
    // Nur die single-Frage (2 von 2 Punkten) zählt -> 100%, nicht 2/7.
    expect(result.scorePct).toBe(100);
  });

  it("Randfall: keine Fragen -> scorePct 0, passed nur wenn passPct 0", () => {
    const result = gradeAttempt([], {}, 0);
    expect(result.scorePct).toBe(0);
    expect(result.passed).toBe(true);
    expect(gradeAttempt([], {}, 1).passed).toBe(false);
  });

  it("Randfall: nur eine offene Frage -> scorePct 0 (kein bewertbarer Nenner)", () => {
    const result = gradeAttempt([open], { [open.id]: "Text" }, 0);
    expect(result.scorePct).toBe(0);
  });

  it("Randfall: exakt auf der Bestehensgrenze ist bestanden (>=)", () => {
    const result = gradeAttempt([single, gapExact], { [single.id]: "a" }, 66);
    // single (2 Pkt richtig) von 3 Gesamtpunkten = 67% -> besteht 66%-Grenze
    expect(result.scorePct).toBe(67);
    expect(result.passed).toBe(true);
  });

  it("Randfall: keine Antwort für eine Frage gegeben wird wie falsch behandelt", () => {
    const result = gradeAttempt([single, gapExact], { [gapExact.id]: "Paris" }, 0);
    const singleResult = result.perQuestion.find((p) => p.questionId === single.id)!;
    expect(singleResult.correct).toBe(false);
    expect(singleResult.earnedPoints).toBe(0);
  });
});
