/**
 * Slug-Erzeugung für Kurse — geteilt zwischen dem KI-Kurs-Generator
 * (`src/lib/generator/apply.ts`) und dem manuellen Umbenennen im
 * Kurs-Editor (`updateCourseTitle`, `src/lib/courses/actions.ts`).
 * Ursprünglich zwei private Kopien in `apply.ts`; hierher gezogen, damit
 * keine dritte Kopie beim Umbenennen-Feature entsteht.
 *
 * Reine Funktionen, kein DB-Zugriff. Die Kollisionsauflösung gegen
 * `unique (tenant_id, slug)` (0001_init.sql:97) braucht einen
 * Supabase-Client und liegt deshalb separat in `resolve-slug.ts`.
 */

/** Entfernt kombinierende diakritische Zeichen (U+0300-U+036F) nach NFKD-Normalisierung (ä -> a, ...). */
export function stripDiacritics(input: string): string {
  return Array.from(input)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return !(code >= 0x0300 && code <= 0x036f);
    })
    .join("");
}

export function slugify(input: string): string {
  const base = stripDiacritics(input.toLowerCase().normalize("NFKD"))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "kurs";
}
