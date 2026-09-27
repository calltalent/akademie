const PROBE_ORIGIN = "https://same-origin.invalid";

/**
 * Marketplace M5 — Open-Redirect-Schutz für den `next`-Query-Parameter in
 * `src/app/marketplace/login/page.tsx` (security-reviewer-Fund, 03.08.2026,
 * MITTEL, behoben). Aus der Client-Komponente ausgelagert in eine eigene,
 * reine Funktion: kein React nötig, kein `@testing-library`-Aufbau (im
 * Projekt bislang kein Muster für Component-Tests etabliert — einziger
 * Treffer für `@testing-library` ist `src/test/setup.ts`, ungenutzt) —
 * dadurch isoliert unit-testbar (`redirect.test.ts`) und nebenbei aus der
 * Komponente selbst lesbarer.
 *
 * `next` kommt aus einem Client-Query-Parameter und darf NIE ungeprüft als
 * Sprungziel nach dem Login dienen: `?next=https://evil.example` (absolut)
 * oder `?next=//evil.example` (protokollrelativ) wären sonst ein offenes
 * Weiterleitungsziel. Akzeptiert wird nur ein Ziel, das mit GENAU EINEM `/`
 * beginnt — gleiches Sicherheitsniveau wie das bestehende Vorbild
 * `(auth)/login/login-form.tsx`, das ausschließlich das serverseitig
 * ermittelte `redirectTo` nutzt.
 */
/**
 * Sicherheitsaudit 27.09.2026 (S10, vorher M1): Die reine Präfixprüfung ließ
 * `/\evil.example` durch. Browser behandeln `\` in https-URLs wie `/`, das
 * Ziel wurde also `//evil.example`. Dasselbe gilt für Tab und Zeilenumbruch,
 * die der URL-Parser entfernt (`/\t/evil.example`). Deshalb zusätzlich: kein
 * Backslash, keine Steuerzeichen, und die Auflösung gegen einen Test-Origin
 * muss auf demselben Origin bleiben.
 */
export function resolveSafeNextParam(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  try {
    if (new URL(next, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return null;
  } catch {
    return null;
  }
  return next;
}
