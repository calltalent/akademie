/**
 * Affiliate-System, Block B3 — Open-Redirect-Abwehr des Klick-Endpunkts
 * (PLAN_Affiliate-System.md 4.2 Schritt 1/2, Grundsatzentscheidung G11,
 * Prüfliste 11.3/11.15).
 *
 * `GET /api/aff/k` ist der einzige öffentliche, unauthentifizierte Endpunkt
 * dieses Moduls, der weiterleitet. Genau diese Kombination — öffentlich,
 * ohne Anmeldung, mit Redirect, beworben über fremde Kanäle — ist die
 * klassische Open-Redirect-Falle: ein Link auf die vertraute Akademie-Domain,
 * der den Besucher auf eine Phishing-Seite wirft. Der Partnerlink wird per
 * Definition von Fremden verteilt; wer einen Zielschlüssel wählen darf, wählt
 * ihn also feindlich.
 *
 * Die Abwehr ist deshalb eine Positivliste und keine Filterkette: es gibt
 * genau eine Form gültiger Ziele (`kurs/<slug>` oder `kaufen/<slug>`,
 * `AFFILIATE_TARGET_PATTERN` aus schema.ts), alles andere fällt auf „/"
 * zurück. Die Prüfungen davor sind kein zweiter Schutz, sondern liefern für
 * jeden bekannten Angriff einen eigenen, benennbaren Ablehnungsgrund — damit
 * ein Test genau festhalten kann, DASS dieser Angriff abgewehrt wurde, und
 * nicht nur, dass irgendetwas abgelehnt wurde.
 *
 * Was hier NICHT passiert und bewusst nicht passieren darf:
 *
 *   - Nichts wird dekodiert. `decodeURIComponent()` wäre der Fehler: aus
 *     `%2f%2fboese.example` würde `//boese.example`, und ob danach noch
 *     einmal geprüft wird, ist eine Frage der Reihenfolge — also eine Frage,
 *     die man falsch beantworten kann. Ein Prozentzeichen wird stattdessen
 *     rundheraus abgelehnt; in einem gültigen Zielschlüssel kommt keines vor.
 *   - Nichts wird normalisiert (kein `trim()`, kein `toLowerCase()`, kein
 *     Entfernen von Segmenten). Jede Normalisierung ist eine weitere Stelle,
 *     an der ein Wert nach der Prüfung noch einmal die Form wechselt.
 *   - Es wird nie eine absolute URL gebaut. Der Rückgabewert ist immer ein
 *     relativer Pfad, aus dem der Endpunkt per
 *     `new URL(pfad, request.url)` eine Adresse auf DEMSELBEN Host macht
 *     (G11) — nur dort wirkt das host-only Cookie aus `cookie.ts`.
 *
 * Rein, ohne I/O, ohne `Date`, ohne Supabase; die zod-Prüfung der Query
 * (`affiliateClickQuerySchema`) bleibt die erste Schicht an der Route
 * (CLAUDE.md §2.3), diese Datei ist die zweite und die engere.
 */

import { AFFILIATE_TARGET_PATTERN } from "@/lib/affiliate/schema";

/** Ziel jeder Ablehnung und zugleich das Ziel ohne `z`-Parameter. */
export const CLICK_TARGET_FALLBACK_PATH = "/";

/**
 * Obergrenze der Rohlänge. Das längste gültige Ziel ist
 * `kaufen/` + 61 Slug-Zeichen = 68 Zeichen; 96 lässt Luft, ohne dass ein
 * Angreifer die Musterprüfung mit einer kilobytelangen Zeichenkette
 * beschäftigen kann (die Route ist unauthentifiziert und damit für jeden
 * beliebig oft aufrufbar).
 */
export const MAX_CLICK_TARGET_LENGTH = 96;

/**
 * Die Ablehnungsgründe, einer je bekanntem Angriff. Sie sind für Tests und
 * für ein späteres Zählen in `affiliate_daily_stats` gedacht — NIEMALS für
 * eine Fehlerseite: der Besucher sieht ausnahmslos den Redirect auf „/"
 * (Plan 4.2: „jeder Abbruch führt zum Redirect ohne Zuordnung, nie zu einer
 * Fehlerseite"), und eine unterscheidbare Antwort wäre zugleich ein
 * Enumerations-Leck (CLAUDE.md §2.15).
 */
export const CLICK_TARGET_REJECTIONS = [
  /** Kein String (z. B. ein wiederholter `?z=`-Parameter, den Next.js als Array liefert). */
  "not_a_string",
  "too_long",
  /** NUL, CR, LF und übrige Steuerzeichen — Header-Injection in `Location`. */
  "control_character",
  /** Alles außerhalb von druckbarem ASCII: Homoglyphen, Bidi-Marken, Zero-Width. */
  "non_ascii",
  /** Leerzeichen im Ziel. */
  "whitespace",
  /** Prozentzeichen, also jede kodierte Variante (`%2f%2f`, `%5c`, `%0d%0a`). */
  "percent_encoded",
  /** Backslash — von Browsern vielfach wie „/" behandelt (`\\boese.example`). */
  "backslash",
  /** Doppelpunkt, also `https:`, `javascript:`, `data:` und jedes andere Schema. */
  "scheme_or_colon",
  /** Beginnt mit „//" — protokollrelative Adresse, fremder Origin. */
  "protocol_relative",
  /** Beginnt mit „/" — der Pfad wird hier gebaut, nicht mitgeliefert. */
  "absolute_path",
  /** Enthält ein „."- oder „.."-Segment — Pfad-Traversal. */
  "dot_segment",
  /** Passt nicht auf die Positivliste `AFFILIATE_TARGET_PATTERN`. */
  "pattern",
  /**
   * Das Ergebnis wäre kein eindeutig relativer Pfad. Unerreichbar, solange
   * `AFFILIATE_TARGET_PATTERN` mit `kurs`/`kaufen` beginnt; steht hier, damit
   * eine spätere Musteränderung den Redirect nicht STILL öffnet, sondern in
   * den Rückfallpfad läuft.
   */
  "postcondition",
] as const;
export type ClickTargetRejection = (typeof CLICK_TARGET_REJECTIONS)[number];

/**
 * Ergebnis der Prüfung. `ok: true` mit `source: "default"` ist der Normalfall
 * „kein `z`-Parameter" und KEINE Ablehnung — der Endpunkt unterscheidet
 * beides: ein fehlendes Ziel führt zu Redirect auf „/" MIT Zuordnung, ein
 * ungültiges zu Redirect auf „/" OHNE Zuordnung (Plan 4.2 Schritt 1:
 * „Ungültig -> Ziel '/', weiter mit Schritt 8").
 */
export type ClickTargetVerdict =
  | { ok: true; path: string; source: "key" | "default" }
  | {
      ok: false;
      path: typeof CLICK_TARGET_FALLBACK_PATH;
      reason: ClickTargetRejection;
    };

/** C0- und C1-Steuerzeichen inklusive NUL, CR und LF. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

/** Alles, was nicht druckbares ASCII ist (Steuerzeichen sind schon vorher weg). */
const NON_PRINTABLE_ASCII = /[^\u0020-\u007E]/;

function reject(reason: ClickTargetRejection): ClickTargetVerdict {
  return { ok: false, path: CLICK_TARGET_FALLBACK_PATH, reason };
}

/**
 * Prüft einen rohen Zielschlüssel und gibt den internen Pfad oder den
 * Ablehnungsgrund zurück.
 *
 * Die Reihenfolge der Prüfungen bestimmt nur, WELCHER Grund gemeldet wird —
 * abgelehnt wird in jedem Fall, und die Musterprüfung am Ende würde jeden
 * dieser Werte ohnehin verwerfen. Sie ist trotzdem festgelegt und getestet,
 * weil ein Grund, der sich beim Nachziehen einer Regel still verschiebt,
 * einen Test wertlos macht, der genau diesen Angriff festhalten soll.
 */
export function inspectClickTarget(raw: unknown): ClickTargetVerdict {
  if (typeof raw !== "string") return reject("not_a_string");

  // Der fehlende Parameter. Kein Fehler: der Partner darf auf die Startseite
  // verlinken, und `affiliateClickQuerySchema` lässt `z` ausdrücklich weg.
  if (raw.length === 0) {
    return { ok: true, path: CLICK_TARGET_FALLBACK_PATH, source: "default" };
  }

  if (raw.length > MAX_CLICK_TARGET_LENGTH) return reject("too_long");

  // Zeichenklassen zuerst: ein Zeilenumbruch im Ziel landete sonst über
  // `Location:` in einem Antwort-Header und ließe einen zweiten Header
  // einschleusen — in der Praxis fängt das die Runtime ab, aber darauf
  // verlässt sich hier nichts.
  if (CONTROL_CHARACTERS.test(raw)) return reject("control_character");
  // Homoglyphen (kyrillisches „а", Fullwidth-Zeichen), Bidi-Overrides und
  // Zero-Width-Zeichen: sie sehen im Browser wie ein gültiges Ziel aus und
  // wären nach einer Normalisierung ein anderes. Es gibt keine gültigen
  // Nicht-ASCII-Slugs (DB-CHECK auf `code`/Slug ist ASCII), also raus.
  if (NON_PRINTABLE_ASCII.test(raw)) return reject("non_ascii");
  if (/\s/.test(raw)) return reject("whitespace");

  // Nicht dekodieren, ablehnen: siehe Kopfkommentar.
  if (raw.includes("%")) return reject("percent_encoded");
  // `\boese.example` und `/\boese.example` werden von mehreren Browsern wie
  // `//boese.example` aufgelöst, obwohl die URL-Norm das nicht vorsieht.
  if (raw.includes("\\")) return reject("backslash");
  // Ein Doppelpunkt kann in einem internen Pfad nicht vorkommen und ist der
  // gemeinsame Nenner von `https:`, `javascript:` und `data:`.
  if (raw.includes(":")) return reject("scheme_or_colon");

  if (raw.startsWith("//")) return reject("protocol_relative");
  if (raw.startsWith("/")) return reject("absolute_path");

  // `.`/`..` als vollständiges Segment. Das Muster unten ließe sie ohnehin
  // nicht durch; die eigene Prüfung überlebt eine Lockerung des Musters.
  if (raw.split("/").some((segment) => segment === "." || segment === "..")) {
    return reject("dot_segment");
  }

  // Die eigentliche Grenze: eine Positivliste, kein Ausschluss.
  if (!AFFILIATE_TARGET_PATTERN.test(raw)) return reject("pattern");

  const path = `/${raw}`;

  // Nachbedingung, siehe „postcondition" oben.
  if (!path.startsWith("/") || path.startsWith("//")) return reject("postcondition");

  return { ok: true, path, source: "key" };
}

/**
 * Bequeme Form für die Route: immer ein sicherer interner Pfad, nie ein
 * Fehler. Wer zwischen „kein Ziel" und „ungültiges Ziel" unterscheiden muss
 * — und das muss der Endpunkt, siehe `ClickTargetVerdict` —, nimmt
 * `inspectClickTarget()`.
 */
export function resolveClickTarget(raw: unknown): string {
  return inspectClickTarget(raw).path;
}
