import { describe, expect, it } from "vitest";
import { buildTutorSystemPrompt, formatSourcesForPrompt } from "./prompt";

describe("buildTutorSystemPrompt", () => {
  it("weist bei leeren Chunks klar auf fehlenden Kurskontext hin", () => {
    const prompt = buildTutorSystemPrompt([]);
    expect(prompt).toContain("Kein passender Kurskontext");
    expect(prompt).toContain("Das steht nicht im Kurs.");
  });

  it("enthält Lektionstitel und Inhalt der übergebenen Chunks", () => {
    const prompt = buildTutorSystemPrompt([
      { lessonTitle: "Einführung in Postgres", content: "Postgres ist ein relationales Datenbanksystem." },
      { lessonTitle: "RLS-Grundlagen", content: "Row Level Security filtert Zeilen je Nutzer." },
    ]);
    expect(prompt).toContain("Einführung in Postgres");
    expect(prompt).toContain("Postgres ist ein relationales Datenbanksystem.");
    expect(prompt).toContain("RLS-Grundlagen");
    expect(prompt).toContain("Row Level Security filtert Zeilen je Nutzer.");
  });

  it("enthält die zentrale Sprachregel (immer Deutsch antworten)", () => {
    const prompt = buildTutorSystemPrompt([]);
    expect(prompt).toContain("Deutsch");
  });

  it("enthält die Regel, ausschließlich aus dem Kurskontext zu antworten", () => {
    const prompt = buildTutorSystemPrompt([]);
    expect(prompt).toContain("Kurskontext");
    expect(prompt).toContain("KEIN allgemeines Weltwissen");
  });

  it("enthält die Regel, Off-Topic-Fragen abzulehnen", () => {
    const prompt = buildTutorSystemPrompt([]);
    expect(prompt).toContain("Off-Topic");
  });

  it("kennzeichnet den Tutor als KI-Assistent, nicht als Mensch", () => {
    const prompt = buildTutorSystemPrompt([]);
    expect(prompt).toContain("KI-Assistent");
  });
});

describe("formatSourcesForPrompt", () => {
  it("liefert einen Hinweistext bei leeren Chunks", () => {
    expect(formatSourcesForPrompt([])).toContain("Kein passender Kurskontext");
  });

  it("nummeriert mehrere Chunks mit Lektionstitel", () => {
    const result = formatSourcesForPrompt([
      { lessonTitle: "Lektion A", content: "Inhalt A" },
      { lessonTitle: "Lektion B", content: "Inhalt B" },
    ]);
    expect(result).toContain("Quelle 1");
    expect(result).toContain("Lektion A");
    expect(result).toContain("Quelle 2");
    expect(result).toContain("Lektion B");
  });
});
