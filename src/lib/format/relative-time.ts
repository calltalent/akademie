/**
 * Design-Block 6 (13.07.2026): aus admin/page.tsx (Design-Block 5, Dashboard
 * "Letzte Aktivität") extrahiert, damit AdminAbgaben/AdminTeilnehmer
 * dieselbe Logik nutzen statt sie zu duplizieren.
 *
 * Wochen-/Monats-Stufen (13.07.2026, AdminTeilnehmer.dc.html "vor 1 Woche" /
 * "vor 2 Wochen") ergänzt — reine Erweiterung der Bucket-Grenzen um
 * Konsistenz mit dem Export bei "Beigetreten"-Daten zu erreichen, ändert das
 * Verhalten für alle bisherigen Tage/Stunden/Minuten-Fälle NICHT.
 */
export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  if (days < 2) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? "vor 1 Woche" : `vor ${weeks} Wochen`;
  const months = Math.floor(days / 30);
  return months <= 1 ? "vor 1 Monat" : `vor ${months} Monaten`;
}
