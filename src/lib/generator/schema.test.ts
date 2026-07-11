import { describe, expect, it } from "vitest";
import {
  courseOutlineSchema,
  courseContentSchema,
  courseDraftSchema,
  courseGenInputSchema,
  draftQuestionSchema,
} from "./schema";

const validOutline = {
  title: "Kundenservice-Grundlagen",
  description: "Ein Einstiegskurs.",
  modules: [
    { title: "Modul 1", lessons: [{ title: "Lektion 1" }, { title: "Lektion 2" }] },
  ],
};

describe("courseOutlineSchema", () => {
  it("akzeptiert eine gültige Gliederung", () => {
    expect(courseOutlineSchema.safeParse(validOutline).success).toBe(true);
  });

  it("lehnt eine Gliederung ohne Module ab", () => {
    const result = courseOutlineSchema.safeParse({ title: "Kurs", modules: [] });
    expect(result.success).toBe(false);
  });

  it("lehnt mehr als 4 Module ab", () => {
    // Obergrenze bewusst auf 4 gesenkt (Fund beim manuellen Test, Josip,
    // 11.07.2026, siehe PHASENSTATUS.md) — bei 6 Modulen x 5 Lektionen
    // sprengte Schritt 2 (Lektionsinhalte) zuverlässig das Token-Budget.
    const modules = Array.from({ length: 5 }, (_, i) => ({
      title: `Modul ${i + 1}`,
      lessons: [{ title: "Lektion" }],
    }));
    const result = courseOutlineSchema.safeParse({ title: "Kurs", modules });
    expect(result.success).toBe(false);
  });

  it("lehnt ein Modul ohne Lektionen ab", () => {
    const result = courseOutlineSchema.safeParse({
      title: "Kurs",
      modules: [{ title: "Modul", lessons: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("lehnt einen leeren Kurstitel ab", () => {
    const result = courseOutlineSchema.safeParse({ ...validOutline, title: "" });
    expect(result.success).toBe(false);
  });
});

describe("courseContentSchema", () => {
  it("akzeptiert eine Gliederung erweitert um contentHtml", () => {
    const content = {
      title: validOutline.title,
      modules: [
        {
          title: "Modul 1",
          lessons: [
            { title: "Lektion 1", contentHtml: "<p>Inhalt</p>" },
            { title: "Lektion 2", contentHtml: "<p>Mehr Inhalt</p>" },
          ],
        },
      ],
    };
    expect(courseContentSchema.safeParse(content).success).toBe(true);
  });

  it("lehnt eine Lektion ohne contentHtml ab", () => {
    const content = {
      title: "Kurs",
      modules: [{ title: "Modul", lessons: [{ title: "Lektion", contentHtml: "" }] }],
    };
    expect(courseContentSchema.safeParse(content).success).toBe(false);
  });
});

describe("draftQuestionSchema", () => {
  const baseQuestion = {
    prompt: "Was ist 1+1?",
    options: [{ text: "1" }, { text: "2" }, { text: "3" }],
    correctOptionIndex: 1,
  };

  it("akzeptiert eine gültige Frage", () => {
    expect(draftQuestionSchema.safeParse(baseQuestion).success).toBe(true);
  });

  it("lehnt einen correctOptionIndex außerhalb der Optionen ab", () => {
    const result = draftQuestionSchema.safeParse({ ...baseQuestion, correctOptionIndex: 5 });
    expect(result.success).toBe(false);
  });

  it("lehnt weniger als 3 Optionen ab", () => {
    const result = draftQuestionSchema.safeParse({
      ...baseQuestion,
      options: [{ text: "1" }, { text: "2" }],
    });
    expect(result.success).toBe(false);
  });

  it("lehnt einen negativen Index ab", () => {
    const result = draftQuestionSchema.safeParse({ ...baseQuestion, correctOptionIndex: -1 });
    expect(result.success).toBe(false);
  });
});

describe("courseDraftSchema", () => {
  it("akzeptiert einen fertigen Entwurf mit Quiz und ohne Quiz gemischt", () => {
    const draft = {
      title: "Kurs",
      modules: [
        {
          title: "Modul 1",
          lessons: [{ title: "Lektion 1", contentHtml: "<p>Inhalt</p>" }],
          quiz: {
            title: "Modul-1-Quiz",
            questions: [
              {
                prompt: "Frage 1",
                options: [{ text: "A" }, { text: "B" }, { text: "C" }],
                correctOptionIndex: 0,
              },
              {
                prompt: "Frage 2",
                options: [{ text: "A" }, { text: "B" }, { text: "C" }],
                correctOptionIndex: 1,
              },
              {
                prompt: "Frage 3",
                options: [{ text: "A" }, { text: "B" }, { text: "C" }],
                correctOptionIndex: 2,
              },
            ],
          },
        },
        {
          title: "Modul 2",
          lessons: [{ title: "Lektion 1", contentHtml: "<p>Inhalt</p>" }],
          quiz: null,
        },
      ],
    };
    expect(courseDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("lehnt ein Quiz mit weniger als 3 Fragen ab", () => {
    const draft = {
      title: "Kurs",
      modules: [
        {
          title: "Modul 1",
          lessons: [{ title: "Lektion 1", contentHtml: "<p>Inhalt</p>" }],
          quiz: {
            title: "Quiz",
            questions: [
              {
                prompt: "Frage 1",
                options: [{ text: "A" }, { text: "B" }, { text: "C" }],
                correctOptionIndex: 0,
              },
            ],
          },
        },
      ],
    };
    expect(courseDraftSchema.safeParse(draft).success).toBe(false);
  });
});

describe("courseGenInputSchema", () => {
  it("akzeptiert Eingaben mit nur sourceText", () => {
    expect(courseGenInputSchema.safeParse({ sourceText: "Ein extrahierter Text." }).success).toBe(true);
  });

  it("lehnt leeren sourceText ab", () => {
    expect(courseGenInputSchema.safeParse({ sourceText: "" }).success).toBe(false);
  });

  it("lehnt zu langen sourceText ab (>120000 Zeichen)", () => {
    const long = "a".repeat(120001);
    expect(courseGenInputSchema.safeParse({ sourceText: long }).success).toBe(false);
  });
});
