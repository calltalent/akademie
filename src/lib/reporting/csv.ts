/**
 * Block 6 (Phase 2) — Reporting v1 + CSV-Export.
 *
 * Reine Funktion, bewusst OHNE I/O (keine Supabase-, Request- oder
 * Dateisystem-Zugriffe), damit sie ohne Mocking per Vitest testbar ist
 * (gleiches Prinzip wie src/lib/progress/compute.ts).
 *
 * RFC-4180-artiges Escaping: ein Feld wird in `"…"` eingeschlossen, wenn es
 * ein Komma, Anführungszeichen oder einen Zeilenumbruch enthält; enthaltene
 * `"` werden verdoppelt. Zeilentrenner CRLF (`\r\n`, RFC-4180-Standard,
 * beste Excel-Kompatibilität). UTF-8-BOM (`﻿`) vorangestellt, damit
 * Excel deutsche Umlaute (ä/ö/ü/ß) korrekt als UTF-8 statt Windows-1252
 * interpretiert.
 */

const BOM = "﻿";

function escapeCsvField(raw: string | number): string {
  const value = String(raw);
  const needsQuoting = /["\n\r,]/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(","));
  }
  return BOM + lines.join("\r\n");
}
