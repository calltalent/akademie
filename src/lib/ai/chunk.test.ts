import { describe, expect, it } from "vitest";
import { chunkText, extractLessonText } from "./chunk";
import type { Block } from "@/lib/courses/schema";

describe("chunkText", () => {
  it("liefert einen einzigen Chunk bei kurzem Text", () => {
    const result = chunkText("Ein kurzer Satz für den Test.");
    expect(result).toEqual(["Ein kurzer Satz für den Test."]);
  });

  it("liefert ein leeres Ergebnis bei reinem Whitespace", () => {
    expect(chunkText("   \n\t  ")).toEqual([]);
  });

  it("liefert ein leeres Ergebnis bei leerem String", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("liefert genau einen Chunk, wenn die Länge exakt maxChars entspricht", () => {
    const text = "a".repeat(100);
    const result = chunkText(text, { maxChars: 100 });
    expect(result).toEqual([text]);
  });

  it("zerlegt langen Text in mehrere Chunks mit Überlappung", () => {
    // 30 Wörter à 5 Zeichen + Leerzeichen = 180 Zeichen Rohtext.
    const words = Array.from({ length: 30 }, (_, i) => `wort${i}`);
    const text = words.join(" ");
    const result = chunkText(text, { maxChars: 50, overlapChars: 15 });

    expect(result.length).toBeGreaterThan(1);
    // Kein Chunk ist leer oder reines Whitespace.
    for (const chunk of result) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
    // Jedes im Originaltext vorkommende Wort erscheint in mindestens einem
    // Chunk unverändert (kein Wort wurde mitten durchtrennt).
    for (const word of words) {
      expect(result.some((c) => c.includes(word))).toBe(true);
    }
    // Aufeinanderfolgende Chunks überlappen sich (Ende von Chunk[i] taucht
    // am Anfang von Chunk[i+1] auf).
    for (let i = 0; i < result.length - 1; i++) {
      const tailOfCurrent = result[i].slice(-10);
      const lastWordOfTail = tailOfCurrent.trim().split(" ").pop() ?? "";
      if (lastWordOfTail.length > 2) {
        expect(result[i + 1].includes(lastWordOfTail)).toBe(true);
      }
    }
  });

  it("hängt einen sehr kurzen Rest-Chunk an den vorherigen an, statt einen Mini-Chunk zu bilden", () => {
    // Präzise konstruiert: 45 "x" + Leerzeichen (Trennpunkt bei genau
    // Index 45) + 10 "y". Ohne die Sonderbehandlung würde das Chunking bei
    // maxChars=50 einen ersten Chunk ("x"*45) und einen zweiten,
    // 10 Zeichen kurzen Rest-Chunk ("y"*10) erzeugen — der Rest liegt unter
    // MIN_TAIL_CHARS (50) und muss deshalb an den vorherigen Chunk
    // angehängt werden, statt als eigener Mini-Chunk zu erscheinen.
    const text = `${"x".repeat(45)} ${"y".repeat(10)}`;
    const result = chunkText(text, { maxChars: 50, overlapChars: 0 });

    expect(result).toEqual([`${"x".repeat(45)} ${"y".repeat(10)}`]);
  });

  it("schneidet hart bei maxChars, wenn kein Leerzeichen im Suchfenster existiert", () => {
    const text = "a".repeat(3000);
    const result = chunkText(text, { maxChars: 1000, overlapChars: 100 });
    expect(result.length).toBeGreaterThan(1);
    // Erster Chunk ist exakt maxChars lang (harter Schnitt, kein Trennpunkt gefunden).
    expect(result[0].length).toBe(1000);
  });
});

describe("extractLessonText", () => {
  function textBlock(html: string): Block {
    return { id: crypto.randomUUID(), type: "text", html };
  }
  function calloutBlock(text: string): Block {
    return { id: crypto.randomUUID(), type: "callout", variant: "info", text };
  }
  function videoBlock(): Block {
    return { id: crypto.randomUUID(), type: "video", bunnyVideoId: "abc123" };
  }
  function quizBlock(): Block {
    return { id: crypto.randomUUID(), type: "quiz", quizId: null, title: "Abschlussquiz" };
  }
  function submissionBlock(): Block {
    return { id: crypto.randomUUID(), type: "submission", instructions: "Bitte PDF hochladen." };
  }
  function embedBlock(): Block {
    return { id: crypto.randomUUID(), type: "embed", url: "https://example.com" };
  }
  function imageBlock(): Block {
    return { id: crypto.randomUUID(), type: "image", url: "https://example.com/a.png", alt: "Diagramm" };
  }

  it("extrahiert nur Text aus embedbaren Blocktypen (text, callout)", () => {
    const blocks: Block[] = [
      textBlock("<p>Willkommen im Kurs.</p>"),
      videoBlock(),
      quizBlock(),
      calloutBlock("Wichtiger Hinweis zum Kapitel."),
      submissionBlock(),
      embedBlock(),
      imageBlock(),
    ];

    const result = extractLessonText(blocks);

    expect(result).toContain("Willkommen im Kurs.");
    expect(result).toContain("Wichtiger Hinweis zum Kapitel.");
    // Nicht-embedbare Blocktypen dürfen nicht auftauchen.
    expect(result).not.toContain("Abschlussquiz");
    expect(result).not.toContain("Bitte PDF hochladen");
    expect(result).not.toContain("example.com");
    expect(result).not.toContain("Diagramm");
  });

  it("entfernt HTML-Tags aus Text-Blöcken (grobe Tag-Entfernung, kein voller Parser)", () => {
    const blocks: Block[] = [
      textBlock(
        '<p>Erster <strong>Absatz</strong> mit <a href="https://x.de">Link</a> Text.</p><ul><li>Punkt eins</li></ul>',
      ),
    ];
    const result = extractLessonText(blocks);
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).toContain("Erster");
    expect(result).toContain("Absatz");
    expect(result).toContain("Link");
    expect(result).toContain("Text.");
    expect(result).toContain("Punkt eins");
  });

  it("liefert leeren String bei leerer Block-Liste", () => {
    expect(extractLessonText([])).toBe("");
  });

  it("überspringt leere Text-/Callout-Blöcke", () => {
    const blocks: Block[] = [textBlock(""), calloutBlock("   "), textBlock("<p></p>")];
    expect(extractLessonText(blocks)).toBe("");
  });
});
