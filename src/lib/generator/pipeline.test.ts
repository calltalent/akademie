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

  // Regressionstest für den E2E-Fund course-generator.spec.ts (Josip,
  // 12.07.2026): Claude lieferte statt {"title":...,"modules":[...]} nur das
  // rohe "modules"-Array als Wurzel zurück. Die alte {}-Suche schnitt dabei
  // vom ersten "{" (Modul 1) bis zum letzten "}" (Modul 2) — verlor die
  // umschließenden []-Klammern und ergab eine ungültige, komma-getrennte
  // Objektliste. Die neue Klammertyp-Erkennung muss die Array-Wurzel
  // unverändert (inkl. []) durchreichen.
  it("bewahrt eine Array-Wurzel mit mehreren Objekten unverändert (statt sie zu einer ungültigen Objektliste zu kürzen)", () => {
    const raw = '[{"title":"Modul 1"},{"title":"Modul 2"}]';
    expect(extractJsonPayload(raw)).toBe(raw);
    expect(() => JSON.parse(extractJsonPayload(raw))).not.toThrow();
  });

  it("entfernt einen Codeblock um eine Array-Wurzel", () => {
    const raw = '```json\n[{"title":"Modul 1"},{"title":"Modul 2"}]\n```';
    expect(extractJsonPayload(raw)).toBe('[{"title":"Modul 1"},{"title":"Modul 2"}]');
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
