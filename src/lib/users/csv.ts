import { z } from "zod";

/**
 * Erwartetes CSV-Format (Kopfzeile Pflicht):
 *   email,full_name,course_slug
 *   [email protected],Max Mustermann,einfuehrung-produkt
 * `course_slug` optional — leer lassen, wenn keine automatische Kurs-Zuweisung
 * gewünscht ist. Mehrere Kurse pro Zeile werden in Phase 1 bewusst NICHT
 * unterstützt (einfachste tragfähige Lösung, siehe CLAUDE.md §4.5).
 */

export const csvRowSchema = z.object({
  email: z.string().email(),
  fullName: z.string().max(200).optional(),
  courseSlug: z.string().max(100).optional(),
});

export type CsvRow = z.infer<typeof csvRowSchema>;

export type CsvParseResult = {
  rows: CsvRow[];
  errors: { line: number; message: string }[];
};

const REQUIRED_HEADER = ["email", "full_name", "course_slug"];

/** Sehr einfacher CSV-Parser: keine Anführungszeichen-Escapes, reicht für Phase-1-Import (Komma-getrennt, keine Kommas in Feldern). */
export function parseCsv(text: string): CsvParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, message: "Datei ist leer." }] };
  }

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const missing = REQUIRED_HEADER.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: `Fehlende Spalten: ${missing.join(", ")}` }],
    };
  }

  const emailIdx = header.indexOf("email");
  const nameIdx = header.indexOf("full_name");
  const courseIdx = header.indexOf("course_slug");

  const rows: CsvRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const seenEmails = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const candidate = {
      email: cols[emailIdx] ?? "",
      fullName: cols[nameIdx] || undefined,
      courseSlug: cols[courseIdx] || undefined,
    };
    const parsed = csvRowSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({ line: i + 1, message: parsed.error.issues[0]?.message ?? "Ungültige Zeile." });
      continue;
    }
    const emailLower = parsed.data.email.toLowerCase();
    if (seenEmails.has(emailLower)) {
      errors.push({ line: i + 1, message: `Doppelte E-Mail in Datei: ${parsed.data.email}` });
      continue;
    }
    seenEmails.add(emailLower);
    rows.push(parsed.data);
  }

  return { rows, errors };
}
