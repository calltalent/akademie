// Testet die reinen JSON-Parsing-Funktionen aus src/lib/generator/parse.ts.
// Datei bewusst nicht in parse.test.ts umbenannt (Tool-Beschränkung dieses
// Auftrags erlaubt kein Datei-Löschen/-Umbenennen) — pipeline.ts selbst
// (Claude-Aufrufe) ist nicht direkt testbar, siehe Dateikopf-Kommentar dort.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJsonPayload, parseStepResponse } from "./parse";

describe("extractJsonPayload", () => {
  it("extrahiert reines JSON unverändert", () => {
    expect(extractJsonPayload('{"a":1}')).toBe('{"a":1}');
  });

  it("entfernt einen ```json-Codeblock", () => {
    const raw = '```json\n{"a":1}\n```';
    expect(extractJsonPayload(raw)).toBe('{"a":1}');
  });

  it("entfernt einen Codeblock ohne Sprachangabe", () => {
    const raw = '```\n{"a":1}\n```';
    expect(extractJsonPayload(raw)).toBe('{"a":1}');
  });

  it("ignoriert einleitenden/nachgestellten Text außerhalb der geschweiften Klammern", () => {
    const raw = 'Hier ist die Antwort:\n{"a":1}\nIch hoffe das hilft.';
    expect(extractJsonPayload(raw)).toBe('{"a":1}');
  });

  it("wirft bei fehlenden geschweiften Klammern", () => {
    expect(() => extractJsonPayload("keine json antwort")).toThrow();
  });
});

describe("parseStepResponse", () => {
  const schema = z.object({ title: z.string().min(1), count: z.number().int() });

  it("parst und validiert eine gültige Antwort", () => {
    const result = parseStepResponse('{"title":"Kurs","count":3}', schema);
    expect(result).toEqual({ title: "Kurs", count: 3 });
  });

  it("wirft bei ungültigem JSON-Text", () => {
    // Klammern bewusst balanciert ("{...}"), damit extractJsonPayload() die
    // Extraktion nicht schon vorher mit einer anderen Fehlermeldung abbricht
    // (kein schließendes "}" gefunden) — dieser Test prüft gezielt den
    // JSON.parse()-Fehlerpfad in parseStepResponse() selbst.
    expect(() => parseStepResponse("{ungültig}", schema)).toThrow(/kein gültiges JSON/);
  });

  it("wirft bei Schema-Validierungsfehler", () => {
    expect(() => parseStepResponse('{"title":"","count":3}', schema)).toThrow(
      /entspricht nicht dem erwarteten Format/,
    );
  });

  it("parst JSON, das in einem Codeblock eingebettet ist", () => {
    const raw = '```json\n{"title":"Kurs","count":1}\n```';
    expect(parseStepResponse(raw, schema)).toEqual({ title: "Kurs", count: 1 });
  });
});
