import { describe, expect, it } from "vitest";
import {
  CLICK_TARGET_FALLBACK_PATH,
  MAX_CLICK_TARGET_LENGTH,
  inspectClickTarget,
  resolveClickTarget,
  type ClickTargetRejection,
} from "./click-target";

/**
 * Affiliate-System, Block B3 — Tests der Open-Redirect-Abwehr
 * (`click-target.ts`, PLAN_Affiliate-System.md 4.2, G11).
 *
 * Stil wie `compute.test.ts`: reine Funktionen, keine Mocks. Jeder in der
 * Aufgabe benannte Angriff steht als EIGENER Testfall mit seinem eigenen
 * Ablehnungsgrund. Das ist Absicht und nicht Umständlichkeit: eine Tabelle
 * „diese zwanzig Werte ergeben alle '/'" würde grün bleiben, wenn eine
 * künftige Änderung zwei Angriffe auf denselben Grund zusammenfallen ließe
 * oder einen Schritt entfernte, den ein anderer zufällig mit abdeckt.
 *
 * Die entscheidende Zusicherung steht ganz unten: KEIN Eingabewert, welcher
 * auch immer, darf einen Rückgabewert ergeben, der nicht mit genau einem „/"
 * beginnt.
 */

/** Kurzform: prüft, dass abgelehnt wurde, und mit welchem Grund. */
function expectRejected(raw: unknown, reason: ClickTargetRejection) {
  const verdict = inspectClickTarget(raw);
  expect(verdict.ok).toBe(false);
  if (verdict.ok) return;
  expect(verdict.reason).toBe(reason);
  expect(verdict.path).toBe(CLICK_TARGET_FALLBACK_PATH);
}

describe("Klickziel — gültige Fälle", () => {
  it("übersetzt ein Kursziel in einen internen Pfad", () => {
    const verdict = inspectClickTarget("kurs/vertrieb-grundlagen");
    expect(verdict).toEqual({
      ok: true,
      path: "/kurs/vertrieb-grundlagen",
      source: "key",
    });
  });

  it("übersetzt ein Kaufziel in einen internen Pfad", () => {
    expect(resolveClickTarget("kaufen/jahrespaket-2026")).toBe("/kaufen/jahrespaket-2026");
  });

  it("erlaubt Ziffern und Bindestriche im Slug", () => {
    expect(resolveClickTarget("kurs/0-a-1-b-2")).toBe("/kurs/0-a-1-b-2");
  });

  it("behandelt den fehlenden Parameter als Startseite, nicht als Fehler", () => {
    const verdict = inspectClickTarget("");
    expect(verdict).toEqual({ ok: true, path: "/", source: "default" });
  });

  it("nutzt die volle erlaubte Sluglänge (61 Zeichen)", () => {
    const slug = `a${"b".repeat(60)}`;
    expect(resolveClickTarget(`kurs/${slug}`)).toBe(`/kurs/${slug}`);
  });
});

describe("Klickziel — abgewehrte Angriffe", () => {
  it("weist eine absolute URL mit Schema ab", () => {
    expectRejected("https://boese.example/phishing", "scheme_or_colon");
    expectRejected("http://boese.example", "scheme_or_colon");
  });

  it("weist ein protokollrelatives Ziel ab (//boese.example)", () => {
    expectRejected("//boese.example", "protocol_relative");
    expectRejected("//boese.example/kurs/echt-aussehend", "protocol_relative");
  });

  it("weist javascript: ab", () => {
    expectRejected("javascript:alert(document.cookie)", "scheme_or_colon");
    // Groß-/Kleinschreibung ändert nichts: geprüft wird der Doppelpunkt.
    expectRejected("JaVaScRiPt:alert(1)", "scheme_or_colon");
  });

  it("weist data: ab", () => {
    expectRejected("data:text/html,<script>alert(1)</script>", "scheme_or_colon");
  });

  it("weist Backslash-Varianten ab", () => {
    expectRejected("\\\\boese.example", "backslash");
    expectRejected("/\\boese.example", "backslash");
    expectRejected("kurs\\..\\admin", "backslash");
  });

  it("weist ..-Segmente ab", () => {
    expectRejected("kurs/../../admin", "dot_segment");
    expectRejected("..", "dot_segment");
    expectRejected("kurs/./x", "dot_segment");
  });

  it("weist kodierte Varianten ab, ohne sie zu dekodieren", () => {
    // Der klassische Fall: nach einem decodeURIComponent() wäre das
    // //boese.example, also ein fremder Origin.
    expectRejected("%2f%2fboese.example", "percent_encoded");
    expectRejected("%2F%2Fboese.example", "percent_encoded");
    // Kodierter Backslash.
    expectRejected("%5cboese.example", "percent_encoded");
    // Doppelt kodiert — derselbe Grund, weil gar nicht erst dekodiert wird.
    expectRejected("%252f%252fboese.example", "percent_encoded");
    // Kodierter Zeilenumbruch (Header-Injection über die kodierte Form).
    expectRejected("kurs/x%0d%0aSet-Cookie:%20ct_aff=fremd", "percent_encoded");
  });

  it("weist Unicode-Homoglyphen ab", () => {
    // Kyrillisches „а" (U+0430) statt lateinischem „a" in „kaufen".
    expectRejected("k\u0430ufen/jahrespaket", "non_ascii");
    // Fullwidth-Solidus (U+FF0F), der in manchen Normalisierungen zu „/" wird.
    expectRejected("kurs\uff0f..\uff0fadmin", "non_ascii");
    // Zero-Width-Space mitten im Slug.
    expectRejected("kurs/ver\u200btrieb", "non_ascii");
    // Right-to-Left-Override, der die Anzeige des Ziels umdreht.
    expectRejected("kurs/\u202etxt.exe", "non_ascii");
  });

  it("weist Steuerzeichen ab", () => {
    expectRejected("kurs/x\t", "control_character");
    expectRejected("kurs/x\u0000", "control_character");
    // C1-Bereich.
    expectRejected("kurs/x\u0085", "control_character");
  });

  it("weist einen eingebetteten Zeilenumbruch ab (Header-Injection)", () => {
    // Der Angriff: der Wert landete ungeprüft im Location-Header und
    // schöbe eine zweite Kopfzeile nach.
    expectRejected("kurs/x\r\nSet-Cookie: ct_aff=fremd", "control_character");
    expectRejected("kurs/x\nLocation: https://boese.example", "control_character");
    expectRejected("kurs/x\rX-Fremd: 1", "control_character");
  });

  it("weist ein Ziel mit Leerzeichen ab", () => {
    expectRejected("kurs/mein kurs", "whitespace");
    expectRejected(" kurs/x", "whitespace");
    expectRejected("kurs/x ", "whitespace");
  });

  it("weist einen absoluten Pfad ab — der Pfad wird hier gebaut, nicht geliefert", () => {
    expectRejected("/admin/affiliate", "absolute_path");
    expectRejected("/", "absolute_path");
  });

  it("weist alles ab, was nicht auf die Positivliste passt", () => {
    expectRejected("admin/affiliate", "pattern");
    expectRejected("kurs", "pattern");
    expectRejected("kurs/", "pattern");
    // Großbuchstaben sind kein gültiger Slug — es wird bewusst nicht
    // kleingeschrieben, weil jede Normalisierung eine zweite Formänderung
    // nach der Prüfung wäre.
    expectRejected("KURS/x", "pattern");
    // Slug beginnt mit einem Bindestrich.
    expectRejected("kurs/-x", "pattern");
    // Ein Zeichen zu lang (61 sind erlaubt).
    expectRejected(`kurs/a${"b".repeat(61)}`, "pattern");
    // Query- und Fragmentanhänge sind kein Teil des Zielschlüssels.
    expectRejected("kurs/x?next=boese.example", "pattern");
    expectRejected("kurs/x#@boese.example", "pattern");
    // Benutzerinfo-Trick ohne Schema.
    expectRejected("kurs/x@boese.example", "pattern");
  });

  it("weist eine überlange Eingabe ab, bevor das Muster sie prüfen muss", () => {
    expectRejected(`kurs/${"a".repeat(MAX_CLICK_TARGET_LENGTH)}`, "too_long");
  });

  it("weist alles ab, was kein String ist", () => {
    // Next.js liefert bei `?z=a&z=b` ein Array, nicht einen String.
    expectRejected(["kurs/a", "kurs/b"], "not_a_string");
    expectRejected(null, "not_a_string");
    expectRejected(undefined, "not_a_string");
    expectRejected(42, "not_a_string");
    // Ein Objekt mit toString() darf nicht stillschweigend zu einem Pfad werden.
    expectRejected({ toString: () => "kurs/x" }, "not_a_string");
  });
});

describe("Klickziel — die Zusicherung, auf die sich der Endpunkt verlässt", () => {
  it("gibt für jede denkbare Eingabe einen eindeutig relativen Pfad zurück", () => {
    const inputs: unknown[] = [
      "kurs/echt",
      "",
      "https://boese.example",
      "//boese.example",
      "javascript:alert(1)",
      "data:text/html,x",
      "\\\\boese.example",
      "/\\boese.example",
      "%2f%2fboese.example",
      "%5cboese.example",
      "kurs/../../admin",
      "k\u0430ufen/x",
      "kurs/x\r\nSet-Cookie: a=b",
      "/admin",
      "kurs/x ",
      null,
      undefined,
      42,
      ["kurs/a"],
      { nope: true },
    ];

    for (const input of inputs) {
      const path = resolveClickTarget(input);
      expect(path.startsWith("/")).toBe(true);
      // Ein zweiter Schrägstrich am Anfang wäre ein fremder Origin, sobald
      // der Endpunkt `new URL(path, request.url)` daraus macht.
      expect(path.startsWith("//")).toBe(false);
      // Und die Probe aufs Exempel: derselbe Origin, egal welche Eingabe.
      expect(new URL(path, "https://akademie.example/api/aff/k").origin).toBe(
        "https://akademie.example",
      );
    }
  });

  it("führt jeden abgelehnten Wert auf denselben Pfad wie den Normalfall — kein Enumerations-Leck", () => {
    // Der Besucher darf nicht unterscheiden können, warum er auf „/" landet
    // (CLAUDE.md §2.15, Plan 11.15).
    expect(resolveClickTarget("https://boese.example")).toBe(resolveClickTarget(""));
    expect(resolveClickTarget("kurs/../../admin")).toBe(CLICK_TARGET_FALLBACK_PATH);
  });
});
