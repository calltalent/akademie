import { describe, expect, it } from "vitest";
import de from "../../messages/de.json";
import bs from "../../messages/bs.json";
import en from "../../messages/en.json";

/**
 * Schlüsselmengen-Vergleich (Plan Abschnitt 2, A7-Ergänzung zu A4 / Abschnitt
 * 5): `de.json` ist die Struktur-Referenz. Fehlt ein Key in einer weiteren
 * Datei, fällt next-intl zur Laufzeit still auf "de" zurück statt zu
 * brechen — dieser Test macht die Abweichung trotzdem sofort sichtbar,
 * damit sie nicht unbemerkt bestehen bleibt.
 */
function collectKeyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    collectKeyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function getByPath(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined),
      value,
    );
}

/** ICU-Platzhalter wie {count}/{date} müssen unverändert übernommen werden (Plan Abschnitt 2, A7). */
function collectPlaceholders(value: string): string[] {
  return [...value.matchAll(/\{[a-zA-Z0-9_]+\}/g)].map((match) => match[0]).sort();
}

/**
 * Gemeinsame Struktur-Prüfung, wiederverwendet für jede weitere Sprachdatei
 * (bs.json, seit 02.08.2026 auch en.json) — Assertions unverändert gegenüber
 * dem ursprünglichen bs-only-Test, nur aus dem describe-Block herausgezogen,
 * damit eine neue Sprache keinen vollständig duplizierten Testblock braucht.
 */
function expectSameStructure(name: string, messages: unknown) {
  it(`${name}.json enthält exakt dieselben Schlüsselpfade wie de.json`, () => {
    expect(collectKeyPaths(messages).sort()).toEqual(collectKeyPaths(de).sort());
  });

  it(`${name}.json übernimmt ICU-Platzhalter je Schlüssel unverändert`, () => {
    const stringPaths = collectKeyPaths(de).filter((path) => typeof getByPath(de, path) === "string");

    for (const path of stringPaths) {
      const deValue = getByPath(de, path) as string;
      const value = getByPath(messages, path);
      expect(typeof value, `Schlüssel fehlt oder ist kein String in ${name}.json: ${path}`).toBe("string");
      expect(
        collectPlaceholders(value as string),
        `Platzhalter weichen ab bei "${path}"`,
      ).toEqual(collectPlaceholders(deValue));
    }
  });
}

describe("messages/bs.json — Struktur-Abgleich mit messages/de.json", () => {
  expectSameStructure("bs", bs);
});

describe("messages/en.json — Struktur-Abgleich mit messages/de.json", () => {
  expectSameStructure("en", en);
});
