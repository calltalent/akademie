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
export function resolveSafeNextParam(next: string | null): string | null {
  if (!next) return null;
  return next.startsWith("/") && !next.startsWith("//") ? next : null;
}
